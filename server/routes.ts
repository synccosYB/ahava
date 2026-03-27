import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth";
import { insertDepartmentSchema } from "@shared/schema";
import { z } from "zod";

const roleSchema = z.object({
  role: z.enum(["employee", "manager", "admin"]),
});

export const requireRole = (...roles: string[]): RequestHandler => {
  return async (req, res, next) => {
    const user = (req as any).authUser;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/users", isAuthenticated, requireRole("admin"), async (_req, res) => {
    const users = await storage.getAllUsers();
    res.json(users);
  });

  app.patch("/api/users/:id/role", isAuthenticated, requireRole("admin"), async (req, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid role", errors: parsed.error.flatten() });
    }
    const id = req.params.id as string;
    const user = await storage.updateUserRole(id, parsed.data.role);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.get("/api/departments", isAuthenticated, async (_req, res) => {
    const depts = await storage.getAllDepartments();
    res.json(depts);
  });

  app.post("/api/departments", isAuthenticated, requireRole("admin"), async (req, res) => {
    const parsed = insertDepartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    const dept = await storage.createDepartment(parsed.data);
    res.status(201).json(dept);
  });

  app.get("/api/time-off/pending", isAuthenticated, requireRole("manager", "admin"), async (_req, res) => {
    const requests = await storage.getPendingTimeOffRequests();
    res.json(requests);
  });

  return httpServer;
}
