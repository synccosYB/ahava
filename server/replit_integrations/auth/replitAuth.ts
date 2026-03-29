import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { authStorage } from "./storage";

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
    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    (req.session as any).userId = user.id;
    req.session.save((err) => {
      if (err) {
        console.error("[auth] Session save error:", err);
        return res.status(500).json({ message: "Session error" });
      }
      console.log("[auth] Session saved, id:", req.sessionID, "userId:", (req.session as any).userId);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
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
    const userId = (req.session as any)?.userId;
    console.log("[auth] GET /api/auth/user - sessionID:", req.sessionID, "userId:", userId, "cookie:", req.headers.cookie?.substring(0, 50));
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await authStorage.getUser(userId);
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
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
