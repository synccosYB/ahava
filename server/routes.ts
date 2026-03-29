import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth";
import { insertDepartmentSchema } from "@shared/schema";
import type { User } from "@shared/schema";

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

function sanitizeUserForKiosk(user: User, departmentName?: string) {
  return {
    id: user.id,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    department: departmentName || "Unassigned",
    employeeId: user.id,
  };
}

const pinLookupSchema = z.object({
  pin: z.string().min(4).max(6),
});

const kioskPunchSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["clock_in", "clock_out"]),
});

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

  async function getDepartmentName(departmentId: string | null): Promise<string> {
    if (!departmentId) return "Unassigned";
    const dept = await storage.getDepartment(departmentId);
    return dept?.name || "Unassigned";
  }

  app.post("/api/kiosk/lookup-pin", async (req, res) => {
    const parsed = pinLookupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid PIN is required" });
    }
    const user = await storage.getUserByPin(parsed.data.pin);
    if (!user) {
      return res.status(404).json({ error: "Invalid PIN" });
    }
    const deptName = await getDepartmentName(user.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(user.id);
    const kioskLastRecord = lastRecord ? {
      id: lastRecord.id,
      type: lastRecord.clockOut ? "clock_out" : (lastRecord.clockIn ? "clock_in" : null),
      timestamp: lastRecord.clockOut || lastRecord.clockIn,
    } : null;
    return res.json({ employee: sanitizeUserForKiosk(user, deptName), lastRecord: kioskLastRecord });
  });

  app.get("/api/kiosk/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query || query.length < 1) {
      return res.json([]);
    }
    const matchedUsers = await storage.searchUsersByName(query);
    const results = await Promise.all(
      matchedUsers.map(async (u) => {
        const deptName = await getDepartmentName(u.departmentId);
        return sanitizeUserForKiosk(u, deptName);
      })
    );
    return res.json(results);
  });

  app.get("/api/kiosk/employee/:id", async (req, res) => {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "Invalid employee ID" });
    }
    const user = await storage.getUser(id);
    if (!user) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const deptName = await getDepartmentName(user.departmentId);
    const lastRecord = await storage.getLatestAttendanceForUser(user.id);
    const kioskLastRecord = lastRecord ? {
      id: lastRecord.id,
      type: lastRecord.clockOut ? "clock_out" : (lastRecord.clockIn ? "clock_in" : null),
      timestamp: lastRecord.clockOut || lastRecord.clockIn,
    } : null;
    return res.json({ employee: sanitizeUserForKiosk(user, deptName), lastRecord: kioskLastRecord });
  });

  app.post("/api/kiosk/punch", async (req, res) => {
    const parsed = kioskPunchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid employee ID and type (clock_in/clock_out) are required" });
    }
    const { employeeId, type } = parsed.data;
    const user = await storage.getUser(employeeId);
    if (!user) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const today = new Date().toISOString().split("T")[0];
    const deptName = await getDepartmentName(user.departmentId);

    if (type === "clock_in") {
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      if (lastRecord && lastRecord.clockIn && !lastRecord.clockOut && lastRecord.date === today) {
        return res.status(400).json({ error: "Employee is already clocked in" });
      }
      const record = await storage.createAttendanceRecord({
        userId: user.id,
        date: today,
        clockIn: new Date(),
        status: "present",
        source: "kiosk",
      });
      return res.json({
        record: { id: record.id, type: "clock_in", timestamp: record.clockIn },
        employee: sanitizeUserForKiosk(user, deptName),
      });
    } else {
      const lastRecord = await storage.getLatestAttendanceForUser(user.id);
      if (!lastRecord || !lastRecord.clockIn || lastRecord.clockOut) {
        return res.status(400).json({ error: "Employee is not clocked in" });
      }
      const updated = await storage.updateAttendanceRecord(lastRecord.id, {
        clockOut: new Date(),
      });
      return res.json({
        record: { id: updated?.id, type: "clock_out", timestamp: updated?.clockOut },
        employee: sanitizeUserForKiosk(user, deptName),
      });
    }
  });

  return httpServer;
}
