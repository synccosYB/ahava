import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth";
import { insertDepartmentSchema, insertTimeOffRequestSchema } from "@shared/schema";
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

  app.get("/api/time-off/pending", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
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

  app.get("/api/attendance/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const current = await storage.getCurrentAttendance(userId);
      const todayHours = await storage.getTodayHours(userId);
      const weekHours = await storage.getWeekHours(userId);
      const ptoBalance = await storage.computeTimeOffBalance(userId);
      res.json({
        isClockedIn: !!current,
        currentRecord: current || null,
        todayHours: Math.round(todayHours * 10) / 10,
        weekHours: Math.round(weekHours * 10) / 10,
        ptoBalance,
      });
    } catch (error) {
      console.error("Error fetching status:", error);
      res.status(500).json({ message: "Failed to fetch attendance status" });
    }
  });

  app.post("/api/attendance/clock-in", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/attendance/clock-out", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/attendance/records", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/time-off", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/time-off", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const requests = await storage.getTimeOffRequestsByUser(userId);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time off requests:", error);
      res.status(500).json({ message: "Failed to fetch time off requests" });
    }
  });

  app.get("/api/time-off/balance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.authUser.id;
      const balance = await storage.computeTimeOffBalance(userId);
      res.json(balance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ message: "Failed to fetch PTO balance" });
    }
  });

  app.get("/api/time-off/team", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/manager/team-stats", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
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

  app.get("/api/manager/team-status", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
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

  app.post("/api/time-off/:id/approve", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
    const user = (req as any).authUser as User;
    const parsed = approvalSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const request = await storage.getTimeOffRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

    const teamIds = await getTeamUserIds(user);
    if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to approve this request" });

    const updated = await storage.updateTimeOffRequest(req.params.id, {
      status: "approved",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      ...(comment ? { reason: `${request.reason || ""}\n[Manager comment: ${comment}]` } : {}),
    });
    res.json(updated);
  });

  app.post("/api/time-off/:id/deny", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
    const user = (req as any).authUser as User;
    const parsed = approvalSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;
    const request = await storage.getTimeOffRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") return res.status(400).json({ message: "Request already processed" });

    const teamIds = await getTeamUserIds(user);
    if (!teamIds.has(request.userId)) return res.status(403).json({ message: "Not authorized to deny this request" });

    const updated = await storage.updateTimeOffRequest(req.params.id, {
      status: "denied",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      ...(comment ? { reason: `${request.reason || ""}\n[Manager comment: ${comment}]` } : {}),
    });
    res.json(updated);
  });

  app.get("/api/time-off/processed", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
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

  app.get("/api/admin/company-stats", isAuthenticated, requireRole("admin"), async (_req, res) => {
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

  app.get("/api/admin/department-breakdown", isAuthenticated, requireRole("admin"), async (_req, res) => {
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

  app.get("/api/admin/recent-activity", isAuthenticated, requireRole("admin"), async (_req, res) => {
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

  app.post("/api/reports/generate", isAuthenticated, requireRole("manager", "admin"), async (req, res) => {
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

  return httpServer;
}
