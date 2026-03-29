import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { requireAuth } from "./middleware/auth";
import { requirePermission } from "./middleware/rbac";
import { insertDepartmentSchema, insertTimeOffRequestSchema, insertCompanySchema, insertLocationSchema, insertEmploymentProfileSchema, insertPtoPolicySchema, insertEmployeePtoSettingsSchema } from "@shared/schema";
import type { User, AttendanceRecord, TimeOffRequest } from "@shared/schema";

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

  app.get("/api/attendance/status", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const userRole = req.authUser.role;
      const current = await storage.getCurrentAttendance(userId);
      const todayHours = await storage.getTodayHours(userId);
      const weekHours = await storage.getWeekHours(userId);

      const response: any = {
        isClockedIn: !!current,
        currentRecord: current || null,
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
      const current = await storage.getCurrentAttendance(userId);
      if (current) {
        return res.status(400).json({ message: "Already clocked in" });
      }
      const record = await storage.clockIn(userId);
      res.json(record);
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(500).json({ message: "Failed to clock in" });
    }
  });

  app.post("/api/attendance/clock-out", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const record = await storage.clockOut(userId);
      if (!record) {
        return res.status(400).json({ message: "Not currently clocked in" });
      }
      res.json(record);
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
      res.json(records);
    } catch (error) {
      console.error("Error fetching records:", error);
      res.status(500).json({ message: "Failed to fetch attendance records" });
    }
  });

  app.post("/api/time-off", requireAuth, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
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

      const empSettings = await storage.getEmployeePtoSettings(userId);
      const policy = await storage.getEmployeePtoPolicy(userId);

      if (policy && empSettings?.hireDate && policy.waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000;
        if (Date.now() < waitingEnd) {
          return res.status(400).json({ message: "You are still within the waiting period and cannot request time off yet" });
        }
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
    const clockedIn = todayAttendance.filter(a => teamIds.has(a.userId) && a.clockIn && !a.clockOut).length;

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
      const todayRecord = todayAttendance.find(a => a.userId === member.id && a.clockIn && !a.clockOut);
      const todayRecords = todayAttendance.filter(a => a.userId === member.id);
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
      const memberWeekRecords = weekAttendance.filter(a => a.userId === member.id);
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

    await storage.createAuditLog({
      action: "pto.approved",
      module: "pto",
      targetId: requestId,
      targetType: "time_off_request",
      performedBy: user.id,
      details: { employeeId: request.userId, type: request.type, days: request.daysRequested, comment },
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

    await storage.createAuditLog({
      action: "pto.denied",
      module: "pto",
      targetId: requestId,
      targetType: "time_off_request",
      performedBy: user.id,
      details: { employeeId: request.userId, type: request.type, days: request.daysRequested, comment },
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
      const active = todayAttendance.filter(a => deptIds.has(a.userId) && a.clockIn && !a.clockOut).length;
      const onLeave = allTimeOff.filter(r =>
        deptIds.has(r.userId) && r.status === "approved" && r.startDate <= today && r.endDate >= today
      ).length;

      let totalHours = 0;
      let recordCount = 0;
      weekAttendance.filter(a => deptIds.has(a.userId)).forEach(r => {
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
      const active = todayAttendance.filter(a => unassignedIds.has(a.userId) && a.clockIn && !a.clockOut).length;
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
    const filteredAttendance = attendance.filter(a => userIds.has(a.userId));
    let filteredTimeOff = timeOff.filter(r =>
      userIds.has(r.userId) &&
      r.startDate <= endDate &&
      r.endDate >= startDate
    );

    if (status && status !== "all") {
      filteredTimeOff = filteredTimeOff.filter(r => r.status === status);
    }

    const reportData = filteredUsers.map(user => {
      const userAttendance = filteredAttendance.filter(a => a.userId === user.id);
      let totalHours = 0;
      let daysWorked = new Set<string>();
      userAttendance.forEach(r => {
        if (r.clockIn) {
          const end = r.clockOut ? new Date(r.clockOut) : new Date();
          totalHours += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
          daysWorked.add(r.date);
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

  return httpServer;
}
