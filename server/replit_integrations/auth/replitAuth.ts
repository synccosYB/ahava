import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authStorage } from "./storage";
import { generateToken, getJwtSecret } from "../../middleware/auth";
import { rateLimit } from "../../lib/rateLimit";
import { writeAuditLog, getAuditContext } from "../../services/audit";
import {
  buildResetUrl,
  getEmailServiceStatus,
  sendPasswordResetEmail,
} from "../../services/email";
import {
  consumeResetToken,
  createResetTokenForUser,
  findResetTokenByRaw,
  invalidateOtherTokensForUser,
  isUserEligibleForReset,
  setUserPassword,
  validateNewPassword,
} from "../../services/passwordReset";

const FORGOT_PW_PER_TARGET_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_PW_PER_TARGET_MAX = 5;
const forgotPwAttempts = new Map<string, { count: number; resetAt: number }>();

function checkPerEmailIpThrottle(email: string, ip: string | null): boolean {
  const key = `${(ip || "unknown")}|${email.toLowerCase()}`;
  const now = Date.now();
  const bucket = forgotPwAttempts.get(key);
  if (!bucket || bucket.resetAt < now) {
    forgotPwAttempts.set(key, { count: 1, resetAt: now + FORGOT_PW_PER_TARGET_WINDOW_MS });
    return true;
  }
  if (bucket.count >= FORGOT_PW_PER_TARGET_MAX) {
    return false;
  }
  bucket.count += 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  forgotPwAttempts.forEach((bucket, key) => {
    if (bucket.resetAt < now) forgotPwAttempts.delete(key);
  });
}, 5 * 60 * 1000).unref?.();

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  // The Replit preview embeds the dev app in a cross-site iframe, which requires
  // `sameSite: "none"` + `partitioned` so the cookie is sent at all. But that
  // same config is unreliable for the DEPLOYED domain opened directly at the top
  // level (commonly dropped on mobile Safari/Chrome and when third-party cookies
  // are restricted). On a real deployment the app is first-party, so `sameSite:
  // "lax"` keeps the session working there. Token auth (Authorization: Bearer)
  // remains the primary mechanism; this cookie is defense in depth.
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1";
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: isDeployment ? ("lax" as const) : ("none" as const),
      ...(isDeployment ? {} : { partitioned: true }),
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await authStorage.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const hashToCheck = user.passwordHash || user.password;
    if (!hashToCheck) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, hashToCheck);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = generateToken(user);

    (req.session as any).userId = user.id;
    req.session.save((err) => {
      if (err) {
        console.error("[auth] Session save error:", err);
        return res.status(500).json({ message: "Session error" });
      }
      console.log("[auth] Session saved for userId:", (req.session as any).userId);
      const { password: _, passwordHash: _ph, ...safeUser } = user;
      res.json({ ...safeUser, token, forcePasswordChange: user.forcePasswordChange || false });
    });
  });

  const forgotPasswordIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
  app.post("/api/auth/forgot-password", forgotPasswordIpLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const generic = {
      message:
        "If an account with that email exists, we've sent a password reset link.",
    };

    const auditCtx = getAuditContext(req);
    const ip = (auditCtx.ipAddress as string | undefined) ?? null;

    const status = getEmailServiceStatus();
    if (!status.configured) {
      try {
        await writeAuditLog({
          actorUserId: null,
          targetType: "system",
          targetId: "password_reset",
          action: "password_reset.requested_unavailable",
          newValue: { email, reason: status.reason ?? "email_service_not_configured" },
          ...auditCtx,
        });
      } catch {}
      return res.status(503).json({
        message: "Email service not configured",
        code: "EMAIL_NOT_CONFIGURED",
      });
    }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      try {
        await writeAuditLog({
          actorUserId: null,
          targetType: "system",
          targetId: "password_reset",
          action: "password_reset.requested_invalid",
          newValue: { email: email || null, reason: "invalid_email_format" },
          ...auditCtx,
        });
      } catch {}
      return res.json(generic);
    }

    if (!checkPerEmailIpThrottle(email, ip)) {
      try {
        await writeAuditLog({
          actorUserId: null,
          targetType: "system",
          targetId: "password_reset",
          action: "password_reset.requested_throttled",
          newValue: { email, reason: "per_email_ip_throttle" },
          ...auditCtx,
        });
      } catch {}
      // Don't disclose throttling to the caller — return generic message.
      return res.json(generic);
    }

    const user = await authStorage.getUserByEmail(email);

    if (!user || !isUserEligibleForReset(user)) {
      if (user) {
        try {
          await writeAuditLog({
            actorUserId: user.id,
            targetType: "user",
            targetId: user.id,
            action: "password_reset.requested_ineligible",
            context: { reason: user.deactivatedAt ? "deactivated" : "no_email" },
            ...auditCtx,
          });
        } catch {}
      } else {
        try {
          await writeAuditLog({
            actorUserId: null,
            targetType: "system",
            targetId: "password_reset",
            action: "password_reset.requested_unknown_email",
            newValue: { email, reason: "no_matching_user" },
            ...auditCtx,
          });
        } catch {}
      }
      return res.json(generic);
    }

    try {
      const { token, record } = await createResetTokenForUser(user.id, ip);
      const resetUrl = buildResetUrl(token);

      await writeAuditLog({
        actorUserId: user.id,
        targetType: "user",
        targetId: user.id,
        action: "password_reset.requested",
        newValue: { tokenId: record.id, expiresAt: record.expiresAt, source: "self_service" },
        ...auditCtx,
      });

      if (!resetUrl) {
        // APP_URL not configured — refuse to send rather than embed an
        // attacker-influenced host.
        await writeAuditLog({
          actorUserId: user.id,
          targetType: "user",
          targetId: user.id,
          action: "password_reset.email_failed",
          newValue: {
            tokenId: record.id,
            provider: status.provider,
            source: "self_service",
            error: "APP_URL not configured",
          },
          ...auditCtx,
        });
      } else {
        const result = await sendPasswordResetEmail(user, resetUrl);
        await writeAuditLog({
          actorUserId: user.id,
          targetType: "user",
          targetId: user.id,
          action: result.ok ? "password_reset.email_sent" : "password_reset.email_failed",
          newValue: {
            tokenId: record.id,
            provider: result.provider,
            source: "self_service",
            error: result.ok ? undefined : result.error,
          },
          ...auditCtx,
        });
      }
    } catch (err) {
      console.error("[auth] forgot-password error:", err);
    }

    return res.json(generic);
  });

  const resetPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
  app.post("/api/auth/reset-password", resetPasswordLimiter, async (req, res) => {
    const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    const auditCtx = getAuditContext(req);

    if (!rawToken) {
      return res.status(400).json({ message: "Reset token is required", code: "INVALID_TOKEN" });
    }

    const lookup = await findResetTokenByRaw(rawToken);
    if (!lookup) {
      // Unknown token hash — record a system-attributed audit entry so
      // brute-force / scanning attempts are observable even though we have
      // no associated userId.
      try {
        await writeAuditLog({
          actorUserId: null,
          targetType: "system",
          targetId: "password_reset",
          action: "password_reset.failed",
          newValue: { reason: "unknown_token" },
          ...auditCtx,
        });
      } catch {}
      return res.status(400).json({
        message: "This reset link is no longer valid. Please request a new one.",
        code: "INVALID_TOKEN",
      });
    }
    if (lookup.status !== "valid") {
      try {
        await writeAuditLog({
          actorUserId: lookup.token.userId,
          targetType: "user",
          targetId: lookup.token.userId,
          action: "password_reset.failed",
          newValue: { tokenId: lookup.token.id, reason: lookup.status },
          ...auditCtx,
        });
      } catch {}
      return res.status(400).json({
        message: "This reset link is no longer valid. Please request a new one.",
        code: lookup.status === "used" ? "TOKEN_USED" : "TOKEN_EXPIRED",
      });
    }

    // Validate password AFTER we know the userId so we can audit weak-password attempts.
    const pwError = validateNewPassword(newPassword);
    if (pwError) {
      try {
        await writeAuditLog({
          actorUserId: lookup.token.userId,
          targetType: "user",
          targetId: lookup.token.userId,
          action: "password_reset.failed",
          newValue: { tokenId: lookup.token.id, reason: "weak_password" },
          ...auditCtx,
        });
      } catch {}
      return res.status(400).json({ message: pwError, code: "WEAK_PASSWORD" });
    }

    const user = await authStorage.getUser(lookup.token.userId);
    if (!user || !isUserEligibleForReset(user)) {
      try {
        await writeAuditLog({
          actorUserId: lookup.token.userId,
          targetType: "user",
          targetId: lookup.token.userId,
          action: "password_reset.failed",
          newValue: { tokenId: lookup.token.id, reason: "user_ineligible" },
          ...auditCtx,
        });
      } catch {}
      return res.status(400).json({
        message: "This reset link is no longer valid. Please request a new one.",
        code: "INVALID_TOKEN",
      });
    }

    // Consume the token FIRST and gate on the row being updated. This is an
    // atomic compare-and-swap on (id, used_at IS NULL) and prevents two
    // concurrent submissions of the same token from both succeeding.
    const consumed = await consumeResetToken(lookup.token.id);
    if (!consumed) {
      try {
        await writeAuditLog({
          actorUserId: lookup.token.userId,
          targetType: "user",
          targetId: lookup.token.userId,
          action: "password_reset.failed",
          newValue: { tokenId: lookup.token.id, reason: "race_already_used" },
          ...auditCtx,
        });
      } catch {}
      return res.status(400).json({
        message: "This reset link is no longer valid. Please request a new one.",
        code: "TOKEN_USED",
      });
    }

    await setUserPassword(user.id, newPassword);
    await invalidateOtherTokensForUser(user.id, lookup.token.id);

    await writeAuditLog({
      actorUserId: user.id,
      targetType: "user",
      targetId: user.id,
      action: "password_reset.used",
      newValue: { tokenId: lookup.token.id },
      ...getAuditContext(req),
    });

    const refreshed = (await authStorage.getUser(user.id)) || user;
    const token = generateToken(refreshed);
    (req.session as any).userId = refreshed.id;
    req.session.save((err) => {
      if (err) {
        console.error("[auth] Session save error after reset:", err);
      }
      const { password: _p, passwordHash: _ph, ...safeUser } = refreshed as any;
      res.json({ ...safeUser, token, forcePasswordChange: false });
    });
  });

  // Preflight check used by the /reset-password page on mount so users
  // see "link no longer valid" immediately instead of after typing a new
  // password. Read-only — does NOT consume the token.
  app.get("/api/auth/reset-token-status", async (req, res) => {
    const rawToken = typeof req.query?.token === "string" ? req.query.token : "";
    if (!rawToken) return res.json({ status: "invalid" });
    const lookup = await findResetTokenByRaw(rawToken);
    if (!lookup) return res.json({ status: "invalid" });
    return res.json({ status: lookup.status });
  });

  app.get("/api/auth/email-status", (_req, res) => {
    const status = getEmailServiceStatus();
    res.json({
      configured: status.configured,
      provider: status.provider,
      reason: status.reason,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/user", async (req, res) => {
    let userId = (req.session as any)?.userId;

    if (!userId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const decoded = jwt.verify(authHeader.slice(7), getJwtSecret()) as { userId: string };
          userId = decoded.userId;
        } catch {
        }
      }
    }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await authStorage.getUser(userId);
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { password: _, passwordHash: _ph, ...safeUser } = user;
    res.json({ ...safeUser, forcePasswordChange: user.forcePasswordChange || false });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await authStorage.getUser(userId);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  (req as any).authUser = user;
  next();
};
