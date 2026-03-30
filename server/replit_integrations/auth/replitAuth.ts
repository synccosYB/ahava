import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authStorage } from "./storage";
import { generateToken } from "../../middleware/auth";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      partitioned: true,
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
          const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-jwt-secret-not-for-production";
          const decoded = jwt.verify(authHeader.slice(7), secret) as { userId: string };
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
