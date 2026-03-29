import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { db } from "./db";
import { payrollExports as payrollExportsTable, payrollBatchRecords as payrollBatchRecordsTable } from "@shared/schema";
import { requireAuth } from "./middleware/auth";
import { requirePermission } from "./middleware/rbac";
import { insertDepartmentSchema, insertTimeOffRequestSchema, insertCompanySchema, insertLocationSchema, insertEmploymentProfileSchema, insertPtoPolicySchema, insertEmployeePtoSettingsSchema, insertAttendanceExceptionSchema, insertPolicySchema, insertPolicyAssignmentSchema } from "@shared/schema";
import type { User, PunchLog, InsertPunchLog, TimeOffRequest } from "@shared/schema";
import { writeAuditLog, getAuditContext } from "./services/audit";
import { getEffectivePolicy, getDefaultRulesForType, DEFAULT_ATTENDANCE_RULES, DEFAULT_PTO_RULES } from "./policyEngine";

const roleSchema = z.object({
  role: z.enum(["employee", "manager", "admin"]),
});

async function checkPostExportModification(punchLogId: string, modifiedBy: string) {
  try {
    const exportedRecords = await storage.getExportedBatchRecordsByPunchLog(punchLogId);
    for (const record of exportedRecords) {
      if (record.payrollExport) {
        const existingAdjustments = await storage.getPayrollAdjustmentsByExport(record.payrollExport.id);
        const alreadyFlagged = existingAdjustments.some(
          a => a.punchLogId === punchLogId && a.status === "pending"
        );
        if (alreadyFlagged) continue;

        const punchLog = await storage.getPunchLog(punchLogId);
        await storage.createPayrollAdjustment({
          payrollExportId: record.payrollExport.id,
          employeeId: record.employeeId,
          punchLogId,
          adjustmentDate: punchLog?.workDate || new Date().toISOString().split("T")[0],
          reason: "Record modified after payroll export — review in next payroll cycle",
          status: "pending",
          reviewedBy: null,
          reviewedAt: null,
        });
      }
    }
  } catch (error) {
    console.error("Error checking post-export modification:", error);
  }
}

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

function punchLogToApiResponse(record: any) {
  return {
    ...record,
    userId: record.employeeId || record.userId,
    date: record.workDate || record.date,
    totalHours: record.hoursWorked ?? record.totalHours ?? null,
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
  app.get("/api/users", requireAuth, requireRole("admin"), requirePermission("users.view"), async (_req, res) => {
    const users = await storage.getAllUsers();
    res.json(users);
  });

  app.patch("/api/users/:id/role", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid role", errors: parsed.error.flatten() });
    }
    const id = req.params.id as string;
    const user = await storage.updateUserRole(id, parsed.data.role);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.get("/api/companies", requireAuth, requirePermission("company.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    if (user.role === "admin") {
      const allCompanies = await storage.getAllCompanies();
      return res.json(allCompanies);
    }
    if (user.companyId) {
      const company = await storage.getCompany(user.companyId);
      return res.json(company ? [company] : []);
    }
    return res.json([]);
  });

  app.get("/api/companies/:id", requireAuth, requirePermission("company.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const company = await storage.getCompany(req.params.id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    if (user.role !== "admin" && user.companyId !== company.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(company);
  });

  app.post("/api/companies", requireAuth, requireRole("admin"), requirePermission("company.create"), async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid company data", errors: parsed.error.flatten() });
    }
    const company = await storage.createCompany(parsed.data);
    res.status(201).json(company);
  });

  app.patch("/api/companies/:id", requireAuth, requireRole("admin"), requirePermission("company.edit"), async (req, res) => {
    const parsed = insertCompanySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid company data", errors: parsed.error.flatten() });
    }
    const company = await storage.updateCompany(req.params.id, parsed.data);
    if (!company) return res.status(404).json({ message: "Company not found" });
    res.json(company);
  });

  app.delete("/api/companies/:id", requireAuth, requireRole("admin"), requirePermission("company.edit"), async (req, res) => {
    const company = await storage.getCompany(req.params.id);
    if (!company) return res.status(404).json({ message: "Company not found" });
    await storage.deleteCompany(req.params.id);
    res.status(204).send();
  });

  app.get("/api/locations", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const companyId = req.query.companyId as string | undefined;

    if (user.role === "admin") {
      if (companyId) {
        return res.json(await storage.getLocationsByCompany(companyId));
      }
      return res.json(await storage.getAllLocations());
    }
    if (user.companyId) {
      const locs = await storage.getLocationsByCompany(user.companyId);
      if (user.locationId) {
        return res.json(locs.filter(l => l.id === user.locationId));
      }
      return res.json(locs);
    }
    return res.json([]);
  });

  app.get("/api/locations/:id", requireAuth, requirePermission("locations.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const location = await storage.getLocation(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });
    if (user.role !== "admin" && user.companyId !== location.companyId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role !== "admin" && user.locationId && user.locationId !== location.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(location);
  });

  app.post("/api/locations", requireAuth, requireRole("admin"), requirePermission("locations.create"), async (req, res) => {
    const parsed = insertLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location data", errors: parsed.error.flatten() });
    }
    const location = await storage.createLocation(parsed.data);
    res.status(201).json(location);
  });

  app.patch("/api/locations/:id", requireAuth, requireRole("admin"), requirePermission("locations.edit"), async (req, res) => {
    const parsed = insertLocationSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location data", errors: parsed.error.flatten() });
    }
    const location = await storage.updateLocation(req.params.id, parsed.data);
    if (!location) return res.status(404).json({ message: "Location not found" });
    res.json(location);
  });

  app.delete("/api/locations/:id", requireAuth, requireRole("admin"), requirePermission("locations.edit"), async (req, res) => {
    const location = await storage.getLocation(req.params.id);
    if (!location) return res.status(404).json({ message: "Location not found" });
    await storage.deleteLocation(req.params.id);
    res.status(204).send();
  });

  app.get("/api/departments", requireAuth, requirePermission("departments.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const companyId = req.query.companyId as string | undefined;
    const locationId = req.query.locationId as string | undefined;

    if (user.role === "admin") {
      if (locationId) {
        return res.json(await storage.getDepartmentsByLocation(locationId));
      }
      if (companyId) {
        return res.json(await storage.getDepartmentsByCompany(companyId));
      }
      return res.json(await storage.getAllDepartments());
    }

    if (user.departmentId && !user.companyId && !user.locationId) {
      const dept = await storage.getDepartment(user.departmentId);
      return res.json(dept ? [dept] : []);
    }

    if (!user.companyId) {
      return res.json([]);
    }

    let depts = await storage.getDepartmentsByCompany(user.companyId);
    if (user.locationId) {
      depts = depts.filter(d => d.locationId === user.locationId);
    }
    res.json(depts);
  });

  app.post("/api/departments", requireAuth, requireRole("admin"), requirePermission("departments.create"), async (req, res) => {
    const parsed = insertDepartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    if (parsed.data.locationId && parsed.data.companyId) {
      const location = await storage.getLocation(parsed.data.locationId);
      if (!location || location.companyId !== parsed.data.companyId) {
        return res.status(400).json({ message: "Location does not belong to the specified company" });
      }
    }
    const dept = await storage.createDepartment(parsed.data);
    res.status(201).json(dept);
  });

  app.patch("/api/departments/:id", requireAuth, requireRole("admin"), requirePermission("departments.edit"), async (req, res) => {
    const parsed = insertDepartmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid department data", errors: parsed.error.flatten() });
    }
    const dept = await storage.updateDepartment(req.params.id, parsed.data);
    if (!dept) return res.status(404).json({ message: "Department not found" });
    res.json(dept);
  });

  app.delete("/api/departments/:id", requireAuth, requireRole("admin"), requirePermission("departments.edit"), async (req, res) => {
    await storage.deleteDepartment(req.params.id);
    res.status(204).send();
  });

  app.get("/api/employment-profiles/:userId", requireAuth, async (req, res) => {
    const authUser = (req as any).authUser as User;
    const targetUserId = req.params.userId;

    if (authUser.role !== "admin" && authUser.id !== targetUserId) {
      if (authUser.role === "manager") {
        const scopedIds = await storage.getScopedUserIds(authUser);
        if (!scopedIds.has(targetUserId)) {
          return res.status(403).json({ message: "Forbidden" });
        }
      } else {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const profile = await storage.getEmploymentProfile(targetUserId);
    if (!profile) return res.status(404).json({ message: "Employment profile not found" });
    res.json(profile);
  });

  app.post("/api/employment-profiles", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertEmploymentProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid employment profile data", errors: parsed.error.flatten() });
    }
    const existing = await storage.getEmploymentProfile(parsed.data.userId);
    if (existing) {
      return res.status(409).json({ message: "Employment profile already exists for this user" });
    }
    const profile = await storage.createEmploymentProfile(parsed.data);
    res.status(201).json(profile);
  });

  app.patch("/api/employment-profiles/:userId", requireAuth, requireRole("admin"), requirePermission("users.edit"), async (req, res) => {
    const parsed = insertEmploymentProfileSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid employment profile data", errors: parsed.error.flatten() });
    }
    const profile = await storage.updateEmploymentProfile(req.params.userId, parsed.data);
    if (!profile) return res.status(404).json({ message: "Employment profile not found" });
    res.json(profile);
  });

  async function getTeamUserIds(user: User): Promise<Set<string>> {
    if (user.role === "admin") {
      const allUsers = await storage.getAllUsers();
      return new Set(allUsers.filter(u => u.id !== user.id).map(u => u.id));
    }
    if (user.departmentId) {
      const deptUsers = await storage.getUsersByDepartment(user.departmentId);
      return new Set(deptUsers.filter(u => u.id !== user.id).map(u => u.id));
    }
    return new Set();
  }

  app.get("/api/time-off/pending", requireAuth, requireRole("manager", "admin"), requirePermission("pto.approve"), async (req, res) => {
    const user = (req as any).authUser as User;
    const teamIds = await getTeamUserIds(user);
    const requests = await storage.getPendingTimeOffRequests();
    const scopedRequests = requests.filter(r => teamIds.has(r.userId));
    const allUsers = await storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const enriched = scopedRequests.map(r => ({
      ...r,
      employeeName: (() => {
        const u = userMap.get(r.userId);
        return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
      })(),
    }));
    res.json(enriched);
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
      if (lastRecord && lastRecord.clockIn && !lastRecord.clockOut && lastRecord.workDate === today) {
        return res.status(400).json({ error: "Employee is already clocked in" });
      }
      const record = await storage.createAttendanceRecord({
        employeeId: user.id,
        workDate: today,
        clockIn: new Date(),
        status: "present",
        source: "kiosk",
        approved: true,
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
      const now = new Date();
      const clockInTime = new Date(lastRecord.clockIn).getTime();
      const totalMs = now.getTime() - clockInTime;
      const breakMs = (lastRecord.breakMinutes || 0) * 60 * 1000;
      const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;

      const updated = await storage.updatePunchLog(lastRecord.id, {
        clockOut: now,
        hoursWorked,
        status: hoursWorked > 8 ? "overtime" : "complete",
      });
      await checkPostExportModification(lastRecord.id, user.id);
      return res.json({
        record: { id: updated?.id, type: "clock_out", timestamp: updated?.clockOut },
        employee: sanitizeUserForKiosk(user, deptName),
      });
    }
  });

  app.get("/api/attendance/status", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const userRole = req.authUser.role;
      const current = await storage.getCurrentAttendance(userId);
      const todayHours = await storage.getTodayHours(userId);
      const weekHours = await storage.getWeekHours(userId);

      const response: any = {
        isClockedIn: !!current,
        currentRecord: current ? punchLogToApiResponse(current) : null,
        todayHours: Math.round(todayHours * 10) / 10,
        weekHours: Math.round(weekHours * 10) / 10,
      };

      if (userRole === "admin" || userRole === "manager") {
        response.ptoBalance = await storage.computeTimeOffBalance(userId);
      }

      res.json(response);
    } catch (error) {
      console.error("Error fetching status:", error);
      res.status(500).json({ message: "Failed to fetch attendance status" });
    }
  });

  app.post("/api/attendance/clock-in", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const current = await storage.getCurrentAttendance(userId);
      if (current) {
        return res.status(400).json({ message: "Already clocked in" });
      }

      const source = req.body?.source || "web";
      const attendancePolicy = await getEffectivePolicy(user.companyId, userId, "attendance", user);
      const rules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
      const allowedSources: string[] = rules.allowedPunchSources || ["web", "kiosk", "mobile"];
      if (!allowedSources.includes(source)) {
        return res.status(403).json({ message: `Punch source '${source}' is not allowed by attendance policy` });
      }

      const record = await storage.clockIn(userId, source);
      res.json(punchLogToApiResponse(record));
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(500).json({ message: "Failed to clock in" });
    }
  });

  app.post("/api/attendance/clock-out", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;

      const attendancePolicy = await getEffectivePolicy(user.companyId, userId, "attendance", user);
      const rules = attendancePolicy?.rules || DEFAULT_ATTENDANCE_RULES;
      const otThreshold = rules.otThresholdDaily ?? 8;

      const record = await storage.clockOut(userId, otThreshold);
      if (!record) {
        return res.status(400).json({ message: "Not currently clocked in" });
      }
      await checkPostExportModification(record.id, userId);
      res.json(punchLogToApiResponse(record));
    } catch (error) {
      console.error("Error clocking out:", error);
      res.status(500).json({ message: "Failed to clock out" });
    }
  });

  app.get("/api/attendance/records", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const { startDate, endDate } = req.query;
      const records = await storage.getAttendanceRecords(
        userId,
        startDate as string | undefined,
        endDate as string | undefined
      );
      res.json(records.map(punchLogToApiResponse));
    } catch (error) {
      console.error("Error fetching records:", error);
      res.status(500).json({ message: "Failed to fetch attendance records" });
    }
  });

  app.post("/api/attendance/exceptions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const { exceptionDate, exceptionTime, type, reason } = req.body;

      if (!exceptionDate || !type || !reason) {
        return res.status(400).json({ message: "Date, type, and reason are required" });
      }

      const validTypes = ["missing_punch", "time_correction", "forgotten_clock_in", "forgotten_clock_out"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      const exception = await storage.createAttendanceException({
        employeeId: userId,
        exceptionDate,
        exceptionTime: exceptionTime ? new Date(exceptionTime) : null,
        type,
        reason,
        status: "pending",
      });
      res.status(201).json(exception);
    } catch (error) {
      console.error("Error creating attendance exception:", error);
      res.status(500).json({ message: "Failed to create attendance exception" });
    }
  });

  app.get("/api/attendance/exceptions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;

      if (user.role === "admin" || user.role === "manager") {
        const all = await storage.getAllAttendanceExceptions();
        const allUsers = await storage.getAllUsers();
        const userMap = new Map(allUsers.map(u => [u.id, u]));
        const enriched = all.map(e => ({
          ...e,
          employeeName: (() => {
            const u = userMap.get(e.employeeId);
            return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
          })(),
        }));
        return res.json(enriched);
      }

      const exceptions = await storage.getAttendanceExceptionsByEmployee(userId);
      res.json(exceptions);
    } catch (error) {
      console.error("Error fetching attendance exceptions:", error);
      res.status(500).json({ message: "Failed to fetch attendance exceptions" });
    }
  });

  app.get("/api/attendance/exceptions/pending", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const teamIds = await getTeamUserIds(user);
      const pending = await storage.getPendingAttendanceExceptions();
      const scopedPending = pending.filter(e => teamIds.has(e.employeeId));
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const enriched = scopedPending.map(e => ({
        ...e,
        employeeName: (() => {
          const u = userMap.get(e.employeeId);
          return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
        })(),
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching pending exceptions:", error);
      res.status(500).json({ message: "Failed to fetch pending exceptions" });
    }
  });

  const exceptionReviewSchema = z.object({
    action: z.enum(["approve", "deny"]),
    reviewNotes: z.string().optional(),
    correctedTime: z.string().optional(),
  });

  app.post("/api/attendance/exceptions/:id/resolve", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const reviewer = req.authUser as User;
      const exceptionId = req.params.id as string;
      const parsed = exceptionReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid review data", errors: parsed.error.flatten() });
      }

      const exception = await storage.getAttendanceException(exceptionId);
      if (!exception) {
        return res.status(404).json({ message: "Exception not found" });
      }
      if (exception.status !== "pending") {
        return res.status(400).json({ message: "Exception already processed" });
      }

      const teamIds = await getTeamUserIds(reviewer);
      if (!teamIds.has(exception.employeeId)) {
        return res.status(403).json({ message: "Not authorized to resolve this exception" });
      }

      const { action, reviewNotes, correctedTime } = parsed.data;
      const auditCtx = getAuditContext(req);

      if (action === "deny") {
        const updated = await storage.updateAttendanceException(exceptionId, {
          status: "denied",
          reviewedBy: reviewer.id,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes || null,
        });

        await writeAuditLog({
          actorUserId: reviewer.id,
          targetType: "attendance_exception",
          targetId: exceptionId,
          action: "exception.denied",
          oldValue: { status: "pending" },
          newValue: { status: "denied" },
          context: { reviewNotes },
          ...auditCtx,
        });

        return res.json(updated);
      }

      if (exception.type === "time_correction" && !correctedTime) {
        return res.status(400).json({ message: "correctedTime is required for time_correction exceptions" });
      }

      let punchLog: PunchLog | undefined | null = null;
      const correctedTimestamp = correctedTime ? new Date(correctedTime) : exception.exceptionTime;

      if (exception.type === "forgotten_clock_in" || exception.type === "missing_punch") {
        const existingOpen = await storage.getCurrentAttendance(exception.employeeId);
        if (existingOpen && existingOpen.workDate === exception.exceptionDate) {
          return res.status(400).json({ message: "Employee already has an open punch for this date" });
        }

        punchLog = await storage.createPunchLog({
          employeeId: exception.employeeId,
          workDate: exception.exceptionDate,
          clockIn: correctedTimestamp || new Date(),
          status: "present",
          source: "exception",
          approved: true,
        });
      } else if (exception.type === "forgotten_clock_out") {
        const latestRecord = await storage.getLatestAttendanceForUser(exception.employeeId);
        if (latestRecord && latestRecord.clockIn && !latestRecord.clockOut && latestRecord.workDate === exception.exceptionDate) {
          const clockOutTime = correctedTimestamp || new Date();
          const clockInTime = new Date(latestRecord.clockIn).getTime();
          const totalMs = clockOutTime.getTime() - clockInTime;
          const breakMs = (latestRecord.breakMinutes || 0) * 60 * 1000;
          const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;

          punchLog = await storage.updatePunchLog(latestRecord.id, {
            clockOut: clockOutTime,
            hoursWorked,
            status: hoursWorked > 8 ? "overtime" : "complete",
          });
          await checkPostExportModification(latestRecord.id, reviewer.id);
        } else {
          return res.status(400).json({ message: "No open punch record found for this date to close" });
        }
      } else if (exception.type === "time_correction") {
        const latestRecord = await storage.getLatestAttendanceForUser(exception.employeeId);
        if (!latestRecord || latestRecord.workDate !== exception.exceptionDate) {
          return res.status(400).json({ message: "No punch record found for this date to correct" });
        }

        const oldValue = {
          clockIn: latestRecord.clockIn,
          clockOut: latestRecord.clockOut,
          hoursWorked: latestRecord.hoursWorked,
        };

        const updateData: Partial<InsertPunchLog> = {};
        if (!latestRecord.clockOut) {
          updateData.clockIn = correctedTimestamp!;
        } else {
          updateData.clockOut = correctedTimestamp!;
          const clockInTime = new Date(latestRecord.clockIn!).getTime();
          const totalMs = correctedTimestamp!.getTime() - clockInTime;
          const breakMs = (latestRecord.breakMinutes || 0) * 60 * 1000;
          const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;
          updateData.hoursWorked = hoursWorked;
          updateData.status = hoursWorked > 8 ? "overtime" : "complete";
        }

        punchLog = await storage.updatePunchLog(latestRecord.id, updateData);
        await checkPostExportModification(latestRecord.id, reviewer.id);

        await writeAuditLog({
          actorUserId: reviewer.id,
          targetType: "punch_log",
          targetId: latestRecord.id,
          action: "punch_log.corrected",
          oldValue,
          newValue: {
            clockIn: punchLog?.clockIn,
            clockOut: punchLog?.clockOut,
            hoursWorked: punchLog?.hoursWorked,
          },
          context: { exceptionId, reason: exception.reason },
          ...auditCtx,
        });
      }

      const updated = await storage.updateAttendanceException(exceptionId, {
        status: "approved",
        reviewedBy: reviewer.id,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || null,
        punchLogId: punchLog?.id || null,
      });

      await writeAuditLog({
        actorUserId: reviewer.id,
        targetType: "attendance_exception",
        targetId: exceptionId,
        action: "exception.approved",
        oldValue: { status: "pending" },
        newValue: { status: "approved", punchLogId: punchLog?.id },
        context: { reviewNotes, exceptionType: exception.type },
        ...auditCtx,
      });

      return res.json(updated);
    } catch (error) {
      console.error("Error resolving attendance exception:", error);
      res.status(500).json({ message: "Failed to resolve attendance exception" });
    }
  });

  app.post("/api/time-off", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const user = req.authUser as User;
      const parsed = insertTimeOffRequestSchema.parse({ ...req.body, userId, status: "pending" });

      const startMs = new Date(parsed.startDate + "T00:00:00Z").getTime();
      const endMs = new Date(parsed.endDate + "T00:00:00Z").getTime();
      if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
        return res.status(400).json({ message: "Invalid date range" });
      }
      let computedDays = 0;
      const cur = new Date(startMs);
      while (cur.getTime() <= endMs) {
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) computedDays++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      if (computedDays === 0) {
        return res.status(400).json({ message: "Request must include at least one business day" });
      }

      const ptoPolicy = await getEffectivePolicy(user.companyId, userId, "pto", user);
      const ptoRules = ptoPolicy?.rules || DEFAULT_PTO_RULES;

      const empSettings = await storage.getEmployeePtoSettings(userId);
      const legacyPolicy = await storage.getEmployeePtoPolicy(userId);

      const waitingPeriodDays = ptoRules.waitingPeriodDays ?? legacyPolicy?.waitingPeriodDays ?? 0;
      if (empSettings?.hireDate && waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = hireMs + waitingPeriodDays * 24 * 60 * 60 * 1000;
        if (Date.now() < waitingEnd) {
          return res.status(400).json({ message: "You are still within the waiting period and cannot request time off yet" });
        }
      }

      const maxConsecutiveDays = ptoRules.maxConsecutiveDays ?? 10;
      if (computedDays > maxConsecutiveDays) {
        return res.status(400).json({
          message: `Request exceeds the maximum consecutive days allowed (${maxConsecutiveDays}).`,
        });
      }

      const balance = await storage.computeTimeOffBalance(userId);
      const requestType = parsed.type as string;
      const availableBalance = requestType === "vacation" ? balance.vacation
        : requestType === "sick" ? balance.sick
        : requestType === "personal" ? balance.personal : null;

      if (availableBalance !== null && computedDays > availableBalance) {
        return res.status(400).json({
          message: `Insufficient ${requestType} balance. You have ${availableBalance} day(s) remaining but requested ${computedDays}.`,
        });
      }

      const request = await storage.createTimeOffRequest({
        ...parsed,
        status: "pending",
        daysRequested: computedDays,
      });
      res.json(request);
    } catch (error: any) {
      console.error("Error creating time off request:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create time off request" });
    }
  });

  app.get("/api/time-off", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const requests = await storage.getTimeOffRequestsByUser(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time off requests:", error);
      res.status(500).json({ message: "Failed to fetch time off requests" });
    }
  });

  app.get("/api/time-off/balance", requireAuth, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const targetUserId = req.query.userId as string || user.id;

      if (targetUserId !== user.id) {
        const teamIds = await getTeamUserIds(user);
        if (!teamIds.has(targetUserId)) {
          return res.status(403).json({ message: "Not authorized to view this employee's balance" });
        }
      }

      const balance = await storage.computeTimeOffBalance(targetUserId);
      res.json(balance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ message: "Failed to fetch PTO balance" });
    }
  });

  app.get("/api/time-off/team", requireAuth, async (req: any, res) => {
    try {
      const allRequests = await storage.getAllTimeOffRequests();
      const calendarEntries = allRequests
        .filter((r) => r.status === "approved" || r.status === "pending")
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          type: r.type,
          startDate: r.startDate,
          endDate: r.endDate,
          status: r.status,
          daysRequested: r.daysRequested,
        }));
      res.json(calendarEntries);
    } catch (error) {
      console.error("Error fetching team time off:", error);
      res.status(500).json({ message: "Failed to fetch team time off" });
    }
  });

  app.get("/api/manager/team-stats", requireAuth, requireRole("manager", "admin"), requirePermission("attendance.view_team"), async (req, res) => {
    const user = (req as any).authUser as User;
    const allUsers = await storage.getAllUsers();
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const pendingRequests = await storage.getPendingTimeOffRequests();

    let teamMembers: User[];
    if (user.role === "admin") {
      teamMembers = allUsers.filter(u => u.id !== user.id);
    } else {
      teamMembers = user.departmentId
        ? (await storage.getUsersByDepartment(user.departmentId)).filter(u => u.id !== user.id)
        : [];
    }

    const teamIds = new Set(teamMembers.map(u => u.id));
    const clockedIn = todayAttendance.filter(a => teamIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;

    const allTimeOff = await storage.getAllTimeOffRequests();
    const onLeave = allTimeOff.filter(r =>
      teamIds.has(r.userId) &&
      r.status === "approved" &&
      r.startDate <= today &&
      r.endDate >= today
    ).length;

    const teamPending = pendingRequests.filter(r => teamIds.has(r.userId)).length;

    res.json({
      teamSize: teamMembers.length,
      clockedIn,
      onLeave,
      pendingApprovals: teamPending,
    });
  });

  app.get("/api/manager/team-status", requireAuth, requireRole("manager", "admin"), requirePermission("attendance.view_team"), async (req, res) => {
    const user = (req as any).authUser as User;
    const today = new Date().toISOString().split("T")[0];

    let teamMembers: User[];
    if (user.role === "admin") {
      teamMembers = (await storage.getAllUsers()).filter(u => u.id !== user.id);
    } else {
      teamMembers = user.departmentId
        ? (await storage.getUsersByDepartment(user.departmentId)).filter(u => u.id !== user.id)
        : [];
    }

    const todayAttendance = await storage.getAttendanceByDate(today);
    const allTimeOff = await storage.getAllTimeOffRequests();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekAttendance = await storage.getAttendanceByDateRange(weekStartStr, today);

    const teamStatus = teamMembers.map(member => {
      const todayRecord = todayAttendance.find(a => a.employeeId === member.id && a.clockIn && !a.clockOut);
      const todayRecords = todayAttendance.filter(a => a.employeeId === member.id);
      const isOnLeave = allTimeOff.some(r =>
        r.userId === member.id && r.status === "approved" && r.startDate <= today && r.endDate >= today
      );

      let todayHours = 0;
      todayRecords.forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          todayHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        }
      });

      let weekHours = 0;
      const memberWeekRecords = weekAttendance.filter(a => a.employeeId === member.id);
      memberWeekRecords.forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          weekHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        }
      });

      let status = "Clocked Out";
      if (isOnLeave) status = "On Leave";
      else if (todayRecord) {
        const clockInTime = new Date(todayRecord.clockIn!);
        status = `Clocked In (${clockInTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })})`;
      }

      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        status,
        todayHours: Math.round(todayHours * 10) / 10,
        weekHours: Math.round(weekHours * 10) / 10,
      };
    });

    res.json(teamStatus);
  });

  const approvalSchema = z.object({
    comment: z.string().optional(),
  });

  app.post("/api/time-off/:id/approve", requireAuth, requireRole("manager", "admin"), requirePermission("pto.approve"), async (req, res) => {
    const user = (req as any).authUser as User;
    const parsed = approvalSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const requestId = req.params.id as string;
    const request = await storage.getTimeOffRequest(requestId);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

    const teamIds = await getTeamUserIds(user);
    if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to approve this request" });

    const updated = await storage.updateTimeOffRequest(requestId, {
      status: "approved",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      ...(comment ? { reason: `${request.reason || ""}\n[Manager comment: ${comment}]` } : {}),
    });

    const auditCtx = getAuditContext(req);
    await writeAuditLog({
      actorUserId: user.id,
      targetType: "time_off_request",
      targetId: requestId,
      action: "time_off.approved",
      oldValue: { status: "pending" },
      newValue: { status: "approved" },
      context: { comment, employeeId: request.userId, type: request.type, days: request.daysRequested },
      ...auditCtx,
    });

    res.json(updated);
  });

  app.post("/api/time-off/:id/deny", requireAuth, requireRole("manager", "admin"), requirePermission("pto.approve"), async (req, res) => {
    const user = (req as any).authUser as User;
    const parsed = approvalSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const requestId = req.params.id as string;
    const request = await storage.getTimeOffRequest(requestId);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

    const teamIds = await getTeamUserIds(user);
    if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to deny this request" });

    const updated = await storage.updateTimeOffRequest(requestId, {
      status: "denied",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      ...(comment ? { reason: `${request.reason || ""}\n[Manager comment: ${comment}]` } : {}),
    });

    const auditCtx = getAuditContext(req);
    await writeAuditLog({
      actorUserId: user.id,
      targetType: "time_off_request",
      targetId: requestId,
      action: "time_off.denied",
      oldValue: { status: "pending" },
      newValue: { status: "denied" },
      context: { comment, employeeId: request.userId, type: request.type, days: request.daysRequested },
      ...auditCtx,
    });

    res.json(updated);
  });

  app.get("/api/time-off/processed", requireAuth, requireRole("manager", "admin"), requirePermission("pto.view_team"), async (req, res) => {
    const user = (req as any).authUser as User;
    const requests = await storage.getProcessedTimeOffRequests(user.role === "manager" ? user.id : undefined);
    const allUsers = await storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    const enriched = requests.map(r => ({
      ...r,
      employeeName: (() => {
        const u = userMap.get(r.userId);
        return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
      })(),
      reviewerName: (() => {
        if (!r.reviewedBy) return "N/A";
        const u = userMap.get(r.reviewedBy);
        return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown";
      })(),
    }));
    res.json(enriched);
  });

  app.get("/api/admin/company-stats", requireAuth, requireRole("admin"), requirePermission("company.view"), async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const pendingRequests = await storage.getPendingTimeOffRequests();
    const allTimeOff = await storage.getAllTimeOffRequests();

    const activeNow = todayAttendance.filter(a => a.clockIn && !a.clockOut).length;
    const onLeave = allTimeOff.filter(r =>
      r.status === "approved" && r.startDate <= today && r.endDate >= today
    ).length;

    res.json({
      totalEmployees: allUsers.length,
      activeNow,
      onLeave,
      pendingRequests: pendingRequests.length,
    });
  });

  app.get("/api/admin/department-breakdown", requireAuth, requireRole("admin"), requirePermission("departments.view"), async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const depts = await storage.getAllDepartments();
    const today = new Date().toISOString().split("T")[0];
    const todayAttendance = await storage.getAttendanceByDate(today);
    const allTimeOff = await storage.getAllTimeOffRequests();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekAttendance = await storage.getAttendanceByDateRange(weekStartStr, today);

    const breakdown = depts.map(dept => {
      const deptUsers = allUsers.filter(u => u.departmentId === dept.id);
      const deptIds = new Set(deptUsers.map(u => u.id));
      const active = todayAttendance.filter(a => deptIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;
      const onLeave = allTimeOff.filter(r =>
        deptIds.has(r.userId) && r.status === "approved" && r.startDate <= today && r.endDate >= today
      ).length;

      let totalHours = 0;
      let recordCount = 0;
      weekAttendance.filter(a => deptIds.has(a.employeeId)).forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          totalHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
          recordCount++;
        }
      });
      const avgHrs = deptUsers.length > 0 ? Math.round((totalHours / deptUsers.length) * 10) / 10 : 0;

      return {
        id: dept.id,
        name: dept.name,
        employees: deptUsers.length,
        active,
        onLeave,
        avgHoursPerWeek: avgHrs,
      };
    });

    const unassigned = allUsers.filter(u => !u.departmentId);
    if (unassigned.length > 0) {
      const unassignedIds = new Set(unassigned.map(u => u.id));
      const active = todayAttendance.filter(a => unassignedIds.has(a.employeeId) && a.clockIn && !a.clockOut).length;
      breakdown.push({
        id: "unassigned",
        name: "Unassigned",
        employees: unassigned.length,
        active,
        onLeave: 0,
        avgHoursPerWeek: 0,
      });
    }

    res.json(breakdown);
  });

  app.get("/api/admin/recent-activity", requireAuth, requireRole("admin"), requirePermission("company.view"), async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const pendingRequests = await storage.getPendingTimeOffRequests();
    const processed = await storage.getProcessedTimeOffRequests();

    const today = new Date().toISOString().split("T")[0];
    const todayProcessed = processed.filter(r => {
      if (!r.reviewedAt) return false;
      return new Date(r.reviewedAt).toISOString().split("T")[0] === today;
    });

    const activities: { text: string; timestamp: string }[] = [];

    if (pendingRequests.length > 0) {
      activities.push({ text: `${pendingRequests.length} pending time-off request(s)`, timestamp: new Date().toISOString() });
    }
    if (todayProcessed.length > 0) {
      const approved = todayProcessed.filter(r => r.status === "approved").length;
      const denied = todayProcessed.filter(r => r.status === "denied").length;
      if (approved > 0) activities.push({ text: `${approved} request(s) approved today`, timestamp: new Date().toISOString() });
      if (denied > 0) activities.push({ text: `${denied} request(s) denied today`, timestamp: new Date().toISOString() });
    }

    const recentUsers = allUsers
      .filter(u => u.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, 3);
    if (recentUsers.length > 0) {
      activities.push({ text: `${recentUsers.length} newest employee(s) added`, timestamp: recentUsers[0].createdAt?.toISOString() || new Date().toISOString() });
    }

    res.json(activities);
  });

  const reportSchema = z.object({
    reportType: z.enum(["employee", "team", "company"]),
    startDate: z.string(),
    endDate: z.string(),
    department: z.string().optional(),
    employeeId: z.string().optional(),
    status: z.string().optional(),
  });

  app.post("/api/reports/generate", requireAuth, requireRole("manager", "admin"), requirePermission("reports.view"), async (req, res) => {
    const user = (req as any).authUser as User;
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid report parameters", errors: parsed.error.flatten() });
    }

    const { reportType, startDate, endDate, department, employeeId, status } = parsed.data;
    const allUsers = await storage.getAllUsers();
    const depts = await storage.getAllDepartments();
    const deptMap = new Map(depts.map(d => [d.id, d.name]));
    const attendance = await storage.getAttendanceByDateRange(startDate, endDate);
    const timeOff = await storage.getAllTimeOffRequests();

    const teamIds = await getTeamUserIds(user);
    let filteredUsers = allUsers.filter(u => teamIds.has(u.id));

    if (reportType === "employee" && employeeId) {
      filteredUsers = filteredUsers.filter(u => u.id === employeeId);
    } else if (reportType === "team") {
      if (user.departmentId) {
        filteredUsers = filteredUsers.filter(u => u.departmentId === user.departmentId);
      }
    }

    if (department && department !== "all") {
      filteredUsers = filteredUsers.filter(u => u.departmentId === department);
    }
    if (employeeId && reportType !== "employee") {
      filteredUsers = filteredUsers.filter(u => u.id === employeeId);
    }

    const userIds = new Set(filteredUsers.map(u => u.id));
    const filteredAttendance = attendance.filter(a => userIds.has(a.employeeId));
    let filteredTimeOff = timeOff.filter(r =>
      userIds.has(r.userId) &&
      r.startDate <= endDate &&
      r.endDate >= startDate
    );

    if (status && status !== "all") {
      filteredTimeOff = filteredTimeOff.filter(r => r.status === status);
    }

    const reportData = filteredUsers.map(user => {
      const userAttendance = filteredAttendance.filter(a => a.employeeId === user.id);
      let totalHours = 0;
      let daysWorked = new Set<string>();
      userAttendance.forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          totalHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
          daysWorked.add(r.workDate);
        }
      });

      const userTimeOff = filteredTimeOff.filter(r => r.userId === user.id && r.status === "approved");
      let daysOff = 0;
      userTimeOff.forEach(r => {
        const start = new Date(r.startDate);
        const end = new Date(r.endDate);
        daysOff += Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      });

      const overtime = Math.max(0, totalHours - (daysWorked.size * 8));

      return {
        employeeId: user.id,
        employeeName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown",
        department: user.departmentId ? (deptMap.get(user.departmentId) || "Unassigned") : "Unassigned",
        totalHours: Math.round(totalHours * 10) / 10,
        daysWorked: daysWorked.size,
        daysOff,
        overtime: Math.round(overtime * 10) / 10,
      };
    });

    res.json(reportData);
  });

  app.get("/api/pto-policies", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const policies = await storage.getAllPtoPolicies();
      res.json(policies);
    } catch (error) {
      console.error("Error fetching PTO policies:", error);
      res.status(500).json({ message: "Failed to fetch PTO policies" });
    }
  });

  app.get("/api/pto-policies/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const policy = await storage.getPtoPolicy(req.params.id);
      if (!policy) return res.status(404).json({ message: "Policy not found" });
      res.json(policy);
    } catch (error) {
      console.error("Error fetching PTO policy:", error);
      res.status(500).json({ message: "Failed to fetch PTO policy" });
    }
  });

  app.post("/api/pto-policies", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = insertPtoPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy data", errors: parsed.error.flatten() });
      }
      const policy = await storage.createPtoPolicy(parsed.data);

      await storage.createAuditLog({
        action: "pto_policy.created",
        module: "pto",
        targetId: policy.id,
        targetType: "pto_policy",
        performedBy: req.authUser.id,
        details: { name: policy.name },
      });

      res.status(201).json(policy);
    } catch (error) {
      console.error("Error creating PTO policy:", error);
      res.status(500).json({ message: "Failed to create PTO policy" });
    }
  });

  app.patch("/api/pto-policies/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.updatePtoPolicy(req.params.id, req.body);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await storage.createAuditLog({
        action: "pto_policy.updated",
        module: "pto",
        targetId: policy.id,
        targetType: "pto_policy",
        performedBy: req.authUser.id,
        details: { name: policy.name, changes: Object.keys(req.body) },
      });

      res.json(policy);
    } catch (error) {
      console.error("Error updating PTO policy:", error);
      res.status(500).json({ message: "Failed to update PTO policy" });
    }
  });

  app.get("/api/employee-pto-settings/:userId", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const settings = await storage.getEmployeePtoSettings(req.params.userId);
      if (!settings) return res.json(null);
      res.json(settings);
    } catch (error) {
      console.error("Error fetching employee PTO settings:", error);
      res.status(500).json({ message: "Failed to fetch employee PTO settings" });
    }
  });

  app.post("/api/employee-pto-settings", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = insertEmployeePtoSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings data", errors: parsed.error.flatten() });
      }

      const existing = await storage.getEmployeePtoSettings(parsed.data.userId);
      let settings;
      if (existing) {
        settings = await storage.updateEmployeePtoSettings(parsed.data.userId, parsed.data);
      } else {
        settings = await storage.createEmployeePtoSettings(parsed.data);
      }

      await storage.createAuditLog({
        action: existing ? "employee_pto.updated" : "employee_pto.created",
        module: "pto",
        targetId: parsed.data.userId,
        targetType: "employee_pto_settings",
        performedBy: req.authUser.id,
        details: { changes: Object.keys(parsed.data).filter(k => k !== "userId") },
      });

      res.json(settings);
    } catch (error) {
      console.error("Error saving employee PTO settings:", error);
      res.status(500).json({ message: "Failed to save employee PTO settings" });
    }
  });

  app.patch("/api/employee-pto-settings/:userId", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const settings = await storage.updateEmployeePtoSettings(req.params.userId, req.body);
      if (!settings) return res.status(404).json({ message: "Employee PTO settings not found" });

      await storage.createAuditLog({
        action: "employee_pto.balance_adjusted",
        module: "pto",
        targetId: req.params.userId,
        targetType: "employee_pto_settings",
        performedBy: req.authUser.id,
        details: { changes: req.body },
      });

      res.json(settings);
    } catch (error) {
      console.error("Error updating employee PTO settings:", error);
      res.status(500).json({ message: "Failed to update employee PTO settings" });
    }
  });

  app.get("/api/employee-pto-policy/:userId", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const policy = await storage.getEmployeePtoPolicy(req.params.userId);
      res.json(policy || null);
    } catch (error) {
      console.error("Error fetching employee PTO policy:", error);
      res.status(500).json({ message: "Failed to fetch employee PTO policy" });
    }
  });

  app.get("/api/audit-logs", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const module = req.query.module as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getAuditLogs(module, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/policy-types", requireAuth, async (_req, res) => {
    try {
      const types = await storage.getAllPolicyTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching policy types:", error);
      res.status(500).json({ message: "Failed to fetch policy types" });
    }
  });

  app.get("/api/policies", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const policies = companyId
        ? await storage.getPoliciesByCompany(companyId)
        : await storage.getAllPolicies();
      res.json(policies);
    } catch (error) {
      console.error("Error fetching policies:", error);
      res.status(500).json({ message: "Failed to fetch policies" });
    }
  });

  app.get("/api/policies/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const policy = await storage.getPolicy(req.params.id);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const rules = await storage.getPolicyRulesByPolicy(policy.id);
      const assignments = await storage.getPolicyAssignmentsByPolicy(policy.id);
      res.json({ ...policy, rules: rules[0]?.rules || {}, assignments });
    } catch (error) {
      console.error("Error fetching policy:", error);
      res.status(500).json({ message: "Failed to fetch policy" });
    }
  });

  app.post("/api/policies", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = insertPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid policy data", errors: parsed.error.flatten() });
      }
      const policy = await storage.createPolicy(parsed.data);

      if (req.body.rules) {
        await storage.upsertPolicyRules(policy.id, req.body.rules);
      }

      await storage.createAuditLog({
        action: "policy.created",
        module: "policies",
        targetId: policy.id,
        targetType: "policy",
        performedBy: req.authUser.id,
        details: { name: policy.name, status: policy.status },
      });

      res.status(201).json(policy);
    } catch (error) {
      console.error("Error creating policy:", error);
      res.status(500).json({ message: "Failed to create policy" });
    }
  });

  app.patch("/api/policies/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const { rules, ...policyData } = req.body;
      const policy = await storage.updatePolicy(req.params.id, policyData);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      if (rules) {
        await storage.upsertPolicyRules(policy.id, rules);
      }

      await storage.createAuditLog({
        action: "policy.updated",
        module: "policies",
        targetId: policy.id,
        targetType: "policy",
        performedBy: req.authUser.id,
        details: { name: policy.name, changes: Object.keys(req.body) },
      });

      res.json(policy);
    } catch (error) {
      console.error("Error updating policy:", error);
      res.status(500).json({ message: "Failed to update policy" });
    }
  });

  app.post("/api/policies/:id/activate", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.updatePolicy(req.params.id, { status: "active" });
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await storage.createAuditLog({
        action: "policy.activated",
        module: "policies",
        targetId: policy.id,
        targetType: "policy",
        performedBy: req.authUser.id,
        details: { name: policy.name },
      });

      res.json(policy);
    } catch (error) {
      console.error("Error activating policy:", error);
      res.status(500).json({ message: "Failed to activate policy" });
    }
  });

  app.post("/api/policies/:id/archive", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.updatePolicy(req.params.id, { status: "archived" });
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      await storage.createAuditLog({
        action: "policy.archived",
        module: "policies",
        targetId: policy.id,
        targetType: "policy",
        performedBy: req.authUser.id,
        details: { name: policy.name },
      });

      res.json(policy);
    } catch (error) {
      console.error("Error archiving policy:", error);
      res.status(500).json({ message: "Failed to archive policy" });
    }
  });

  app.get("/api/policies/:id/rules", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const rules = await storage.getPolicyRulesByPolicy(req.params.id);
      res.json(rules[0]?.rules || {});
    } catch (error) {
      console.error("Error fetching policy rules:", error);
      res.status(500).json({ message: "Failed to fetch policy rules" });
    }
  });

  app.put("/api/policies/:id/rules", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const policy = await storage.getPolicy(req.params.id);
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const rule = await storage.upsertPolicyRules(req.params.id, req.body);

      await storage.createAuditLog({
        action: "policy_rules.updated",
        module: "policies",
        targetId: policy.id,
        targetType: "policy_rules",
        performedBy: req.authUser.id,
        details: { policyName: policy.name, ruleKeys: Object.keys(req.body) },
      });

      res.json(rule);
    } catch (error) {
      console.error("Error updating policy rules:", error);
      res.status(500).json({ message: "Failed to update policy rules" });
    }
  });

  app.get("/api/policy-assignments", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const policyId = req.query.policyId as string | undefined;
      const assignments = policyId
        ? await storage.getPolicyAssignmentsByPolicy(policyId)
        : await storage.getAllPolicyAssignments();
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching policy assignments:", error);
      res.status(500).json({ message: "Failed to fetch policy assignments" });
    }
  });

  app.post("/api/policy-assignments", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = insertPolicyAssignmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid assignment data", errors: parsed.error.flatten() });
      }
      const assignment = await storage.createPolicyAssignment(parsed.data);

      await storage.createAuditLog({
        action: "policy_assignment.created",
        module: "policies",
        targetId: assignment.id,
        targetType: "policy_assignment",
        performedBy: req.authUser.id,
        details: { policyId: parsed.data.policyId, companyId: parsed.data.companyId, locationId: parsed.data.locationId, departmentId: parsed.data.departmentId, userId: parsed.data.userId },
      });

      res.status(201).json(assignment);
    } catch (error) {
      console.error("Error creating policy assignment:", error);
      res.status(500).json({ message: "Failed to create policy assignment" });
    }
  });

  app.patch("/api/policy-assignments/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const assignment = await storage.updatePolicyAssignment(req.params.id, req.body);
      if (!assignment) return res.status(404).json({ message: "Policy assignment not found" });
      res.json(assignment);
    } catch (error) {
      console.error("Error updating policy assignment:", error);
      res.status(500).json({ message: "Failed to update policy assignment" });
    }
  });

  app.delete("/api/policy-assignments/:id", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      await storage.deletePolicyAssignment(req.params.id);

      await storage.createAuditLog({
        action: "policy_assignment.deleted",
        module: "policies",
        targetId: req.params.id,
        targetType: "policy_assignment",
        performedBy: req.authUser.id,
        details: {},
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting policy assignment:", error);
      res.status(500).json({ message: "Failed to delete policy assignment" });
    }
  });

  app.get("/api/effective-policy", requireAuth, async (req: any, res) => {
    try {
      const user = req.authUser as User;
      const targetUserId = (req.query.userId as string) || user.id;
      const policyTypeKey = req.query.policyType as string;

      if (!policyTypeKey) {
        return res.status(400).json({ message: "policyType query parameter is required" });
      }

      if (targetUserId !== user.id) {
        if (user.role === "admin") {
        } else if (user.role === "manager") {
          const scopedIds = await storage.getScopedUserIds(user);
          if (!scopedIds.has(targetUserId)) {
            return res.status(403).json({ message: "Not authorized to view this user's effective policy" });
          }
        } else {
          return res.status(403).json({ message: "Not authorized to view this user's effective policy" });
        }
      }

      let targetUser: User | undefined;
      if (targetUserId === user.id) {
        targetUser = user;
      } else {
        targetUser = await storage.getUser(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ message: "User not found" });
        }
      }

      const effectivePolicy = await getEffectivePolicy(
        targetUser.companyId,
        targetUserId,
        policyTypeKey,
        targetUser
      );

      if (!effectivePolicy) {
        const defaultRules = getDefaultRulesForType(policyTypeKey);
        return res.json({
          policyId: null,
          policyName: `Default ${policyTypeKey} policy`,
          policyTypeKey,
          assignmentLevel: "default",
          rules: defaultRules,
        });
      }

      res.json(effectivePolicy);
    } catch (error) {
      console.error("Error fetching effective policy:", error);
      res.status(500).json({ message: "Failed to fetch effective policy" });
    }
  });

  app.get("/api/policy-defaults/:policyType", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const defaults = getDefaultRulesForType(req.params.policyType);
      if (Object.keys(defaults).length === 0) {
        return res.status(404).json({ message: "Unknown policy type" });
      }
      res.json(defaults);
    } catch (error) {
      console.error("Error fetching policy defaults:", error);
      res.status(500).json({ message: "Failed to fetch policy defaults" });
    }
  });

  const payrollBatchCreateSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    companyId: z.string().optional(),
    notes: z.string().optional(),
  });

  app.get("/api/payroll/exports", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const exports = await storage.getPayrollExports(companyId);
      res.json(exports);
    } catch (error) {
      console.error("Error fetching payroll exports:", error);
      res.status(500).json({ message: "Failed to fetch payroll exports" });
    }
  });

  app.get("/api/payroll/exports/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });
      res.json(exp);
    } catch (error) {
      console.error("Error fetching payroll export:", error);
      res.status(500).json({ message: "Failed to fetch payroll export" });
    }
  });

  app.post("/api/payroll/exports", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const parsed = payrollBatchCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payroll batch data", errors: parsed.error.flatten() });
      }

      const { startDate, endDate, companyId, notes } = parsed.data;
      const adminUser = req.authUser as User;

      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }

      const unresolvedExceptions = await storage.getPendingAttendanceExceptions();
      const attendanceRecords = await storage.getAttendanceByDateRange(startDate, endDate);
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const missingPunches = attendanceRecords.filter(
        r => r.clockIn && !r.clockOut && r.status !== "in-progress"
      );

      const dateRangeExceptions = unresolvedExceptions.filter(
        e => e.exceptionDate >= startDate && e.exceptionDate <= endDate
      );

      if (dateRangeExceptions.length > 0) {
        return res.status(400).json({
          message: `Cannot create payroll batch: ${dateRangeExceptions.length} unresolved attendance exception(s) in date range`,
          unresolvedExceptions: dateRangeExceptions.length,
        });
      }

      if (missingPunches.length > 0) {
        return res.status(400).json({
          message: `Cannot create payroll batch: ${missingPunches.length} record(s) with missing clock-out in date range`,
          missingPunches: missingPunches.length,
        });
      }

      const unapprovedEdits = attendanceRecords.filter(r => !r.approved);
      if (unapprovedEdits.length > 0) {
        return res.status(400).json({
          message: `Cannot create payroll batch: ${unapprovedEdits.length} unapproved attendance record(s) in date range`,
          unapprovedEdits: unapprovedEdits.length,
        });
      }

      const overlapping = await storage.getOverlappingPayrollExports(startDate, endDate, companyId);
      let overlapWarning: string | undefined;
      if (overlapping.length > 0) {
        overlapWarning = `Warning: ${overlapping.length} existing export(s) overlap with this date range`;
      }

      const timeOffRequests = await storage.getAllTimeOffRequests();
      const approvedTimeOff = timeOffRequests.filter(
        r => r.status === "approved" && r.startDate <= endDate && r.endDate >= startDate
      );

      const totalRecordCount = attendanceRecords.length + approvedTimeOff.length;

      const payrollExport = await db.transaction(async (tx) => {
        const [created] = await tx.insert(payrollExportsTable).values({
          startDate,
          endDate,
          companyId: companyId || null,
          status: "draft",
          notes: notes || null,
          createdBy: adminUser.id,
          recordCount: totalRecordCount,
          exportedAt: null,
          exportedBy: null,
          lockedAt: null,
          lockedBy: null,
          reopenedAt: null,
          reopenedBy: null,
        }).returning();

        for (const record of attendanceRecords) {
          const hours = record.hoursWorked || 0;
          const hasIssue = !record.clockIn || (!record.clockOut && record.status !== "in-progress");

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: record.employeeId,
            punchLogId: record.id,
            timeOffRequestId: null,
            recordType: "attendance",
            workDate: record.workDate,
            regularHours: Math.min(hours, 8),
            overtimeHours: Math.max(0, hours - 8),
            ptoHours: 0,
            hasIssues: hasIssue,
            issueDescription: hasIssue ? `Missing punch data on ${record.workDate}` : null,
          });
        }

        for (const tor of approvedTimeOff) {
          const ptoHours = (tor.daysRequested || 1) * 8;
          const effectiveStart = tor.startDate > startDate ? tor.startDate : startDate;

          await tx.insert(payrollBatchRecordsTable).values({
            payrollExportId: created.id,
            employeeId: tor.userId,
            punchLogId: null,
            timeOffRequestId: tor.id,
            recordType: "pto",
            workDate: effectiveStart,
            regularHours: 0,
            overtimeHours: 0,
            ptoHours,
            hasIssues: false,
            issueDescription: null,
          });
        }

        return created;
      });

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: payrollExport.id,
        action: "payroll_export.created",
        newValue: { startDate, endDate, recordCount: attendanceRecords.length + approvedTimeOff.length },
        ...auditCtx,
      });

      res.status(201).json({
        ...payrollExport,
        recordCount: attendanceRecords.length + approvedTimeOff.length,
        overlapWarning,
      });
    } catch (error) {
      console.error("Error creating payroll batch:", error);
      res.status(500).json({ message: "Failed to create payroll batch" });
    }
  });

  app.get("/api/payroll/exports/:id/records", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const records = await storage.getPayrollBatchRecords(req.params.id);
      res.json(records);
    } catch (error) {
      console.error("Error fetching batch records:", error);
      res.status(500).json({ message: "Failed to fetch batch records" });
    }
  });

  app.get("/api/payroll/exports/:id/summary", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const records = await storage.getPayrollBatchRecords(req.params.id);
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const summary = new Map<string, { employeeId: string; employeeName: string; regularHours: number; overtimeHours: number; ptoHours: number; hasIssues: boolean }>();

      for (const r of records) {
        if (!summary.has(r.employeeId)) {
          const user = userMap.get(r.employeeId);
          summary.set(r.employeeId, {
            employeeId: r.employeeId,
            employeeName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
            regularHours: 0,
            overtimeHours: 0,
            ptoHours: 0,
            hasIssues: false,
          });
        }
        const emp = summary.get(r.employeeId)!;
        emp.regularHours += r.regularHours || 0;
        emp.overtimeHours += r.overtimeHours || 0;
        emp.ptoHours += r.ptoHours || 0;
        if (r.hasIssues) emp.hasIssues = true;
      }

      res.json(Array.from(summary.values()));
    } catch (error) {
      console.error("Error fetching payroll summary:", error);
      res.status(500).json({ message: "Failed to fetch payroll summary" });
    }
  });

  app.post("/api/payroll/exports/:id/export-csv", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status === "locked") {
        return res.status(400).json({ message: "Cannot export a locked payroll batch. Reopen it first." });
      }

      const records = await storage.getPayrollBatchRecords(req.params.id);
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const summary = new Map<string, { employeeName: string; regularHours: number; overtimeHours: number; ptoHours: number; hasIssues: boolean }>();

      for (const r of records) {
        if (!summary.has(r.employeeId)) {
          const user = userMap.get(r.employeeId);
          summary.set(r.employeeId, {
            employeeName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
            regularHours: 0,
            overtimeHours: 0,
            ptoHours: 0,
            hasIssues: false,
          });
        }
        const emp = summary.get(r.employeeId)!;
        emp.regularHours += r.regularHours || 0;
        emp.overtimeHours += r.overtimeHours || 0;
        emp.ptoHours += r.ptoHours || 0;
        if (r.hasIssues) emp.hasIssues = true;
      }

      const overlapping = await storage.getOverlappingPayrollExports(exp.startDate, exp.endDate, exp.companyId || undefined);
      const previousExports = overlapping.filter(o => o.id !== exp.id);
      let reexportWarning: string | undefined;
      if (previousExports.length > 0) {
        reexportWarning = `Warning: Re-exporting data that overlaps with ${previousExports.length} previous export(s)`;
      }

      let csv = "Employee,Regular Hours,OT Hours,PTO Hours,Issues\n";
      for (const [, emp] of summary) {
        const issueFlag = emp.hasIssues ? "Yes" : "No";
        csv += `"${emp.employeeName}",${Math.round(emp.regularHours * 100) / 100},${Math.round(emp.overtimeHours * 100) / 100},${Math.round(emp.ptoHours * 100) / 100},${issueFlag}\n`;
      }

      const adminUser = req.authUser as User;
      await storage.updatePayrollExport(exp.id, {
        status: "exported",
        exportedAt: new Date(),
        exportedBy: adminUser.id,
      });

      if (reexportWarning) {
        res.setHeader("X-Payroll-Overlap-Warning", reexportWarning);
      }

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: "payroll_export.exported",
        newValue: { status: "exported", employeeCount: summary.size },
        ...auditCtx,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="payroll_${exp.startDate}_to_${exp.endDate}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting payroll CSV:", error);
      res.status(500).json({ message: "Failed to export payroll CSV" });
    }
  });

  app.post("/api/payroll/exports/:id/lock", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status !== "exported") {
        return res.status(400).json({ message: "Only exported batches can be locked" });
      }

      const adminUser = req.authUser as User;
      const updated = await storage.updatePayrollExport(exp.id, {
        status: "locked",
        lockedAt: new Date(),
        lockedBy: adminUser.id,
      });

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: "payroll_export.locked",
        oldValue: { status: "exported" },
        newValue: { status: "locked" },
        ...auditCtx,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error locking payroll batch:", error);
      res.status(500).json({ message: "Failed to lock payroll batch" });
    }
  });

  app.post("/api/payroll/exports/:id/reopen", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      if (exp.status !== "locked" && exp.status !== "exported") {
        return res.status(400).json({ message: "Only locked or exported batches can be reopened" });
      }

      const adminUser = req.authUser as User;
      const updated = await storage.updatePayrollExport(exp.id, {
        status: "reopened",
        reopenedAt: new Date(),
        reopenedBy: adminUser.id,
      });

      const auditCtx = getAuditContext(req);
      await writeAuditLog({
        actorUserId: adminUser.id,
        targetType: "payroll_export",
        targetId: exp.id,
        action: "payroll_export.reopened",
        oldValue: { status: exp.status },
        newValue: { status: "reopened" },
        ...auditCtx,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error reopening payroll batch:", error);
      res.status(500).json({ message: "Failed to reopen payroll batch" });
    }
  });

  app.get("/api/payroll/exports/:id/adjustments", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const exp = await storage.getPayrollExport(req.params.id);
      if (!exp) return res.status(404).json({ message: "Payroll export not found" });

      const adjustments = await storage.getPayrollAdjustmentsByExport(req.params.id);
      res.json(adjustments);
    } catch (error) {
      console.error("Error fetching payroll adjustments:", error);
      res.status(500).json({ message: "Failed to fetch payroll adjustments" });
    }
  });

  app.get("/api/payroll/adjustments/pending", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const adjustments = await storage.getPendingPayrollAdjustments();
      res.json(adjustments);
    } catch (error) {
      console.error("Error fetching pending adjustments:", error);
      res.status(500).json({ message: "Failed to fetch pending adjustments" });
    }
  });

  app.post("/api/payroll/adjustments/:id/acknowledge", requireAuth, requireRole("admin"), async (req: any, res) => {
    try {
      const adjustment = await storage.getPayrollAdjustment(req.params.id);
      if (!adjustment) return res.status(404).json({ message: "Adjustment not found" });

      const adminUser = req.authUser as User;
      const updated = await storage.updatePayrollAdjustment(adjustment.id, {
        status: "acknowledged",
        reviewedBy: adminUser.id,
        reviewedAt: new Date(),
      });

      res.json(updated);
    } catch (error) {
      console.error("Error acknowledging adjustment:", error);
      res.status(500).json({ message: "Failed to acknowledge adjustment" });
    }
  });

  app.get("/api/payroll/overlap-check", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const companyId = req.query.companyId as string | undefined;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }

      const overlapping = await storage.getOverlappingPayrollExports(startDate, endDate, companyId);
      res.json({
        hasOverlap: overlapping.length > 0,
        overlappingExports: overlapping,
      });
    } catch (error) {
      console.error("Error checking overlap:", error);
      res.status(500).json({ message: "Failed to check overlap" });
    }
  });

  return httpServer;
}
