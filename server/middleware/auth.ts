import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { authStorage } from "../replit_integrations/auth/storage";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET or SESSION_SECRET must be set in production");
    }
    console.warn("[auth] WARNING: Using fallback JWT secret. Set JWT_SECRET for production.");
    return "dev-jwt-secret-not-for-production";
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

export function generateToken(user: { id: string; email: string | null; role: string; companyId: string | null }): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      const user = await authStorage.getUser(payload.userId);
      if (user) {
        if (user.deactivatedAt) {
          return res.status(403).json({ message: "Account has been deactivated", code: "ACCOUNT_DEACTIVATED" });
        }
        (req as any).authUser = user;
        return next();
      }
    } catch {
    }
  }

  const userId = (req.session as any)?.userId;
  if (userId) {
    const user = await authStorage.getUser(userId);
    if (user) {
      if (user.deactivatedAt) {
        return res.status(403).json({ message: "Account has been deactivated", code: "ACCOUNT_DEACTIVATED" });
      }
      (req as any).authUser = user;
      return next();
    }
  }

  return res.status(401).json({ message: "Unauthorized" });
};

export const requirePasswordChanged: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  let user = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      user = await authStorage.getUser(payload.userId);
    } catch {}
  }

  if (!user) {
    const userId = (req.session as any)?.userId;
    if (userId) {
      user = await authStorage.getUser(userId);
    }
  }

  if (user?.forcePasswordChange) {
    return res.status(403).json({ message: "Password change required", code: "FORCE_PASSWORD_CHANGE" });
  }
  next();
};
