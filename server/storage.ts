import {
  type User,
  type UpsertUser,
  users,
  companies,
  type Company,
  type InsertCompany,
  locations,
  type Location,
  type InsertLocation,
  departments,
  departmentManagers,
  type Department,
  type InsertDepartment,
  type DepartmentManager,
  userEmploymentProfiles,
  type EmploymentProfile,
  type InsertEmploymentProfile,
  punchLogs,
  type PunchLog,
  type InsertPunchLog,
  attendanceExceptions,
  type AttendanceException,
  type InsertAttendanceException,
  auditLogs,
  type AuditLog,
  type InsertAuditLog,
  timeOffRequests,
  type TimeOffRequest,
  type InsertTimeOffRequest,
  timeOffBalances,
  type TimeOffBalance,
  type InsertTimeOffBalance,
  employeePins,
  type EmployeePin,
  type InsertEmployeePin,
  kioskDevices,
  type KioskDevice,
  type InsertKioskDevice,
  roles,
  type Role,
  type InsertRole,
  permissions,
  type Permission,
  rolePermissions,
  type RolePermission,
  userRoles,
  type UserRole,
  userPermissionOverrides,
  type UserPermissionOverride,
  userAccessScopes,
  type UserAccessScope,
  ptoPolicies,
  type PtoPolicy,
  type InsertPtoPolicy,
  employeePtoSettings,
  type EmployeePtoSettings,
  type InsertEmployeePtoSettings,
  policies,
  type Policy,
  type InsertPolicy,
  policyRules,
  type PolicyRule,
  type InsertPolicyRule,
  policyAssignments,
  type PolicyAssignment,
  type InsertPolicyAssignment,
  policyTypes,
  payrollExports,
  type PayrollExport,
  type InsertPayrollExport,
  payrollBatchRecords,
  type PayrollBatchRecord,
  type InsertPayrollBatchRecord,
  payrollAdjustments,
  type PayrollAdjustment,
  type InsertPayrollAdjustment,
  systemAlerts,
  type SystemAlert,
  type InsertSystemAlert,
  documents,
  type Document,
  type InsertDocument,
  employeeSchedules,
  type EmployeeSchedule,
  type InsertEmployeeSchedule,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, ilike, gte, lte, desc, ne, count, sql, inArray } from "drizzle-orm";

export type AttendanceRecord = PunchLog;
export type InsertAttendanceRecord = InsertPunchLog;

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserDepartment(id: string, departmentId: string): Promise<User | undefined>;

  getCompany(id: string): Promise<Company | undefined>;
  getAllCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, company: Partial<InsertCompany>): Promise<Company | undefined>;
  deleteCompany(id: string): Promise<void>;

  getLocation(id: string): Promise<Location | undefined>;
  getLocationsByCompany(companyId: string): Promise<Location[]>;
  getAllLocations(): Promise<Location[]>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<void>;

  getDepartment(id: string): Promise<Department | undefined>;
  getAllDepartments(): Promise<Department[]>;
  getDepartmentsByCompany(companyId: string): Promise<Department[]>;
  getDepartmentsByLocation(locationId: string): Promise<Department[]>;
  createDepartment(dept: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department | undefined>;
  deleteDepartment(id: string): Promise<void>;

  getEmploymentProfile(userId: string): Promise<EmploymentProfile | undefined>;
  createEmploymentProfile(profile: InsertEmploymentProfile): Promise<EmploymentProfile>;
  updateEmploymentProfile(userId: string, profile: Partial<InsertEmploymentProfile>): Promise<EmploymentProfile | undefined>;

  getPunchLog(id: string): Promise<PunchLog | undefined>;
  getPunchLogsByEmployee(employeeId: string): Promise<PunchLog[]>;
  getPunchLogsByDate(date: string): Promise<PunchLog[]>;
  createPunchLog(record: InsertPunchLog): Promise<PunchLog>;
  updatePunchLog(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined>;

  getAttendanceRecord(id: string): Promise<PunchLog | undefined>;
  getAttendanceByUser(userId: string): Promise<PunchLog[]>;
  getAttendanceByDate(date: string): Promise<PunchLog[]>;
  createAttendanceRecord(record: InsertPunchLog): Promise<PunchLog>;
  updateAttendanceRecord(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined>;

  clockIn(userId: string, source?: string): Promise<PunchLog>;
  clockOut(userId: string, otThresholdDaily?: number): Promise<PunchLog | undefined>;
  getCurrentAttendance(userId: string): Promise<PunchLog | undefined>;
  getAttendanceRecords(userId: string, startDate?: string, endDate?: string): Promise<PunchLog[]>;
  getTodayHours(userId: string): Promise<number>;
  getWeekHours(userId: string): Promise<number>;

  getAttendanceException(id: string): Promise<AttendanceException | undefined>;
  getAttendanceExceptionsByEmployee(employeeId: string): Promise<AttendanceException[]>;
  getPendingAttendanceExceptions(): Promise<AttendanceException[]>;
  getAllAttendanceExceptions(): Promise<AttendanceException[]>;
  createAttendanceException(exception: InsertAttendanceException): Promise<AttendanceException>;
  updateAttendanceException(id: string, data: Partial<AttendanceException>): Promise<AttendanceException | undefined>;

  createAuditLog(entry: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(targetType?: string, targetId?: string): Promise<AuditLog[]>;

  getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined>;
  getTimeOffRequestsByUser(userId: string): Promise<TimeOffRequest[]>;
  getPendingTimeOffRequests(): Promise<TimeOffRequest[]>;
  getAllTimeOffRequests(): Promise<TimeOffRequest[]>;
  createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest>;
  updateTimeOffRequest(id: string, request: Partial<InsertTimeOffRequest & { reviewedBy: string; reviewedAt: Date }>): Promise<TimeOffRequest | undefined>;

  getTimeOffBalance(userId: string, type: string, year: number): Promise<TimeOffBalance | undefined>;
  getTimeOffBalancesByUser(userId: string, year: number): Promise<TimeOffBalance[]>;
  createTimeOffBalance(balance: InsertTimeOffBalance): Promise<TimeOffBalance>;
  updateTimeOffBalance(id: string, balance: Partial<InsertTimeOffBalance>): Promise<TimeOffBalance | undefined>;
  computeTimeOffBalance(userId: string): Promise<{ vacation: number; sick: number; personal: number }>;
  getOverlappingTimeOffRequests(userId: string, startDate: string, endDate: string): Promise<TimeOffRequest[]>;

  getEmployeePin(userId: string): Promise<EmployeePin | undefined>;
  createEmployeePin(pin: InsertEmployeePin): Promise<EmployeePin>;
  updateEmployeePin(userId: string, pin: string): Promise<EmployeePin | undefined>;
  deleteEmployeePin(userId: string): Promise<void>;

  getKioskDevice(id: string): Promise<KioskDevice | undefined>;
  getAllKioskDevices(): Promise<KioskDevice[]>;
  createKioskDevice(device: InsertKioskDevice): Promise<KioskDevice>;
  updateKioskDevice(id: string, device: Partial<InsertKioskDevice>): Promise<KioskDevice | undefined>;
  deleteKioskDevice(id: string): Promise<void>;

  getUserByPin(pin: string): Promise<User | undefined>;
  searchUsersByName(query: string): Promise<User[]>;
  getLatestAttendanceForUser(userId: string): Promise<PunchLog | undefined>;

  getUsersByDepartment(departmentId: string): Promise<User[]>;
  getProcessedTimeOffRequests(filters?: {
    reviewerId?: string;
    departmentId?: string;
    locationId?: string;
    type?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    userIds?: string[];
  }): Promise<TimeOffRequest[]>;
  getAttendanceByDateRange(startDate: string, endDate: string): Promise<PunchLog[]>;

  getPtoPolicy(id: string): Promise<PtoPolicy | undefined>;
  getAllPtoPolicies(): Promise<PtoPolicy[]>;
  getDefaultPtoPolicy(): Promise<PtoPolicy | undefined>;
  createPtoPolicy(policy: InsertPtoPolicy): Promise<PtoPolicy>;
  updatePtoPolicy(id: string, policy: Partial<InsertPtoPolicy>): Promise<PtoPolicy | undefined>;

  getEmployeePtoSettings(userId: string): Promise<EmployeePtoSettings | undefined>;
  createEmployeePtoSettings(settings: InsertEmployeePtoSettings): Promise<EmployeePtoSettings>;
  updateEmployeePtoSettings(userId: string, settings: Partial<InsertEmployeePtoSettings>): Promise<EmployeePtoSettings | undefined>;

  getEmployeePtoPolicy(userId: string): Promise<PtoPolicy | undefined>;
  computeTimeOffBalance(userId: string): Promise<{ vacation: number; sick: number; personal: number }>;
  computeTotalHoursWorked(userId: string, year: number): Promise<number>;

  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(module?: string, limit?: number): Promise<AuditLog[]>;

  getCompany(id: string): Promise<Company | undefined>;
  getAllCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, company: Partial<InsertCompany>): Promise<Company | undefined>;
  deleteCompany(id: string): Promise<void>;

  getLocation(id: string): Promise<Location | undefined>;
  getLocationsByCompany(companyId: string): Promise<Location[]>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<void>;
  getRole(id: string): Promise<Role | undefined>;
  getAllRoles(): Promise<Role[]>;
  getRolesByCompany(companyId: string | null): Promise<Role[]>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, role: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<void>;

  getPermission(id: string): Promise<Permission | undefined>;
  getPermissionByKey(key: string): Promise<Permission | undefined>;
  getAllPermissions(): Promise<Permission[]>;

  getRolePermissions(roleId: string): Promise<Permission[]>;
  addRolePermission(roleId: string, permissionId: string): Promise<RolePermission>;
  removeRolePermission(roleId: string, permissionId: string): Promise<void>;

  getUserRoles(userId: string): Promise<(UserRole & { role?: Role })[]>;
  assignUserRole(userId: string, roleId: string, companyId?: string): Promise<UserRole>;
  removeUserRole(userId: string, roleId: string): Promise<void>;

  getUserPermissionOverrides(userId: string): Promise<UserPermissionOverride[]>;
  setUserPermissionOverride(userId: string, permissionId: string, allowed: boolean, reason?: string, createdBy?: string): Promise<UserPermissionOverride>;
  removeUserPermissionOverride(userId: string, permissionId: string): Promise<void>;

  getUserAccessScopes(userId: string): Promise<UserAccessScope[]>;
  addUserAccessScope(userId: string, scopeType: string, scope: { companyId?: string; locationId?: string; departmentId?: string }): Promise<UserAccessScope>;
  removeUserAccessScope(id: string): Promise<void>;

  getScopedUserIds(user: User): Promise<Set<string>>;

  getPolicy(id: string): Promise<Policy | undefined>;
  getPoliciesByCompany(companyId: string | null): Promise<Policy[]>;
  getAllPolicies(): Promise<Policy[]>;
  createPolicy(policy: InsertPolicy): Promise<Policy>;
  updatePolicy(id: string, policy: Partial<InsertPolicy>): Promise<Policy | undefined>;

  getPolicyRulesByPolicy(policyId: string): Promise<PolicyRule[]>;
  upsertPolicyRules(policyId: string, rules: Record<string, any>): Promise<PolicyRule>;

  getPolicyAssignment(id: string): Promise<PolicyAssignment | undefined>;
  getPolicyAssignmentsByPolicy(policyId: string): Promise<PolicyAssignment[]>;
  getAllPolicyAssignments(): Promise<PolicyAssignment[]>;
  createPolicyAssignment(assignment: InsertPolicyAssignment): Promise<PolicyAssignment>;
  updatePolicyAssignment(id: string, assignment: Partial<InsertPolicyAssignment>): Promise<PolicyAssignment | undefined>;
  deletePolicyAssignment(id: string): Promise<void>;

  getPolicyTypeByKey(key: string): Promise<{ id: string; key: string; name: string } | undefined>;
  getAllPolicyTypes(): Promise<{ id: string; key: string; name: string; description: string | null; module: string | null; isActive: boolean }[]>;

  getPayrollExport(id: string): Promise<PayrollExport | undefined>;
  getPayrollExports(companyId?: string): Promise<PayrollExport[]>;
  getOverlappingPayrollExports(startDate: string, endDate: string, companyId?: string): Promise<PayrollExport[]>;
  createPayrollExport(data: InsertPayrollExport): Promise<PayrollExport>;
  updatePayrollExport(id: string, data: Partial<InsertPayrollExport>): Promise<PayrollExport | undefined>;

  getPayrollBatchRecords(exportId: string): Promise<PayrollBatchRecord[]>;
  createPayrollBatchRecord(data: InsertPayrollBatchRecord): Promise<PayrollBatchRecord>;
  deletePayrollBatchRecords(exportId: string): Promise<void>;

  getPayrollAdjustment(id: string): Promise<PayrollAdjustment | undefined>;
  getPayrollAdjustmentsByExport(exportId: string): Promise<PayrollAdjustment[]>;
  getPendingPayrollAdjustments(): Promise<PayrollAdjustment[]>;
  createPayrollAdjustment(data: InsertPayrollAdjustment): Promise<PayrollAdjustment>;
  updatePayrollAdjustment(id: string, data: Partial<InsertPayrollAdjustment>): Promise<PayrollAdjustment | undefined>;

  getExportedBatchRecordsByPunchLog(punchLogId: string): Promise<(PayrollBatchRecord & { payrollExport?: PayrollExport })[]>;

  getSystemAlert(id: string): Promise<SystemAlert | undefined>;
  getAllSystemAlerts(filters?: { type?: string; status?: string; severity?: string }): Promise<SystemAlert[]>;
  createSystemAlert(alert: InsertSystemAlert): Promise<SystemAlert>;
  updateSystemAlert(id: string, data: Partial<SystemAlert>): Promise<SystemAlert | undefined>;
  getAuditLogsFiltered(filters: { actorUserId?: string; action?: string; targetType?: string; startDate?: string; endDate?: string; search?: string; limit?: number; offset?: number }): Promise<{ logs: AuditLog[]; total: number }>;

  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: Partial<UpsertUser>): Promise<User | undefined>;

  getDocumentsByEmployee(employeeId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  createDocument(doc: InsertDocument): Promise<Document>;
  updateDocument(id: string, data: Partial<Document>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;

  getEmployeeSchedules(employeeId: string): Promise<EmployeeSchedule[]>;
  getEmployeeScheduleByDay(employeeId: string, dayOfWeek: number): Promise<EmployeeSchedule | undefined>;
  upsertEmployeeSchedule(schedule: InsertEmployeeSchedule): Promise<EmployeeSchedule>;
  deleteEmployeeSchedules(employeeId: string): Promise<void>;
}

function punchLogToLegacy(log: PunchLog): PunchLog & { userId: string; date: string; totalHours: number | null } {
  return {
    ...log,
    userId: log.employeeId,
    date: log.workDate,
    totalHours: log.hoursWorked,
  };
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return user;
  }

  async updateUserDepartment(id: string, departmentId: string): Promise<User | undefined> {
    const [user] = await db.update(users).set({ departmentId, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return user;
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async getAllCompanies(): Promise<Company[]> {
    return db.select().from(companies);
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async updateCompany(id: string, company: Partial<InsertCompany>): Promise<Company | undefined> {
    const [updated] = await db.update(companies).set(company).where(eq(companies.id, id)).returning();
    return updated;
  }

  async deleteCompany(id: string): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  async getLocation(id: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async getLocationsByCompany(companyId: string): Promise<Location[]> {
    return db.select().from(locations).where(eq(locations.companyId, companyId));
  }

  async getAllLocations(): Promise<Location[]> {
    return db.select().from(locations);
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(locations).values(location).returning();
    return created;
  }

  async updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updated] = await db.update(locations).set(location).where(eq(locations.id, id)).returning();
    return updated;
  }

  async deleteLocation(id: string): Promise<void> {
    await db.delete(locations).where(eq(locations.id, id));
  }

  async getDepartment(id: string): Promise<Department | undefined> {
    const [dept] = await db.select().from(departments).where(eq(departments.id, id));
    return dept;
  }

  async getAllDepartments(): Promise<Department[]> {
    return db.select().from(departments);
  }

  async getDepartmentsByCompany(companyId: string): Promise<Department[]> {
    return db.select().from(departments).where(eq(departments.companyId, companyId));
  }

  async getDepartmentsByLocation(locationId: string): Promise<Department[]> {
    return db.select().from(departments).where(eq(departments.locationId, locationId));
  }

  async createDepartment(dept: InsertDepartment): Promise<Department> {
    const [created] = await db.insert(departments).values(dept).returning();
    return created;
  }

  async updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department | undefined> {
    const [updated] = await db.update(departments).set(dept).where(eq(departments.id, id)).returning();
    return updated;
  }

  async deleteDepartment(id: string): Promise<void> {
    await db.delete(departmentManagers).where(eq(departmentManagers.departmentId, id));
    await db.delete(departments).where(eq(departments.id, id));
  }

  async getDepartmentManagers(departmentId: string): Promise<DepartmentManager[]> {
    return db.select().from(departmentManagers).where(eq(departmentManagers.departmentId, departmentId));
  }

  async setDepartmentManagers(departmentId: string, userIds: string[]): Promise<void> {
    await db.delete(departmentManagers).where(eq(departmentManagers.departmentId, departmentId));
    if (userIds.length > 0) {
      await db.insert(departmentManagers).values(
        userIds.map(userId => ({ departmentId, userId }))
      );
    }
  }

  async getDepartmentsForManager(userId: string): Promise<Department[]> {
    const managerEntries = await db.select().from(departmentManagers).where(eq(departmentManagers.userId, userId));
    if (managerEntries.length === 0) return [];
    const deptIds = managerEntries.map(e => e.departmentId);
    return db.select().from(departments).where(inArray(departments.id, deptIds));
  }

  async getEmploymentProfile(userId: string): Promise<EmploymentProfile | undefined> {
    const [profile] = await db.select().from(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, userId));
    return profile;
  }

  async createEmploymentProfile(profile: InsertEmploymentProfile): Promise<EmploymentProfile> {
    const [created] = await db.insert(userEmploymentProfiles).values(profile).returning();
    return created;
  }

  async updateEmploymentProfile(userId: string, profile: Partial<InsertEmploymentProfile>): Promise<EmploymentProfile | undefined> {
    const [updated] = await db.update(userEmploymentProfiles).set({ ...profile, updatedAt: new Date() }).where(eq(userEmploymentProfiles.userId, userId)).returning();
    return updated;
  }

  async getPunchLog(id: string): Promise<PunchLog | undefined> {
    const [record] = await db.select().from(punchLogs).where(eq(punchLogs.id, id));
    return record ? punchLogToLegacy(record) : undefined;
  }

  async getPunchLogsByEmployee(employeeId: string): Promise<PunchLog[]> {
    const records = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, employeeId));
    return records.map(punchLogToLegacy);
  }

  async getPunchLogsByDate(date: string): Promise<PunchLog[]> {
    const records = await db.select().from(punchLogs).where(eq(punchLogs.workDate, date));
    return records.map(punchLogToLegacy);
  }

  async createPunchLog(record: InsertPunchLog): Promise<PunchLog> {
    const [created] = await db.insert(punchLogs).values(record).returning();
    return punchLogToLegacy(created);
  }

  async updatePunchLog(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined> {
    const [updated] = await db.update(punchLogs).set(record).where(eq(punchLogs.id, id)).returning();
    return updated ? punchLogToLegacy(updated) : undefined;
  }

  async getAttendanceRecord(id: string): Promise<PunchLog | undefined> {
    return this.getPunchLog(id);
  }

  async getAttendanceByUser(userId: string): Promise<PunchLog[]> {
    return this.getPunchLogsByEmployee(userId);
  }

  async getAttendanceByDate(date: string): Promise<PunchLog[]> {
    return this.getPunchLogsByDate(date);
  }

  async createAttendanceRecord(record: InsertPunchLog): Promise<PunchLog> {
    return this.createPunchLog(record);
  }

  async updateAttendanceRecord(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined> {
    return this.updatePunchLog(id, record);
  }

  async clockIn(userId: string, source: string = "web"): Promise<PunchLog> {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const [record] = await db.insert(punchLogs).values({
      employeeId: userId,
      workDate: dateStr,
      clockIn: now,
      status: "in-progress",
      source,
      approved: true,
    }).returning();
    return punchLogToLegacy(record);
  }

  async clockOut(userId: string, otThresholdDaily?: number): Promise<PunchLog | undefined> {
    const current = await this.getCurrentAttendance(userId);
    if (!current || !current.clockIn) return undefined;

    const now = new Date();
    const clockInTime = new Date(current.clockIn).getTime();
    const totalMs = now.getTime() - clockInTime;
    const breakMs = (current.breakMinutes || 0) * 60 * 1000;
    const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;

    const threshold = otThresholdDaily ?? 8;

    const [updated] = await db
      .update(punchLogs)
      .set({ clockOut: now, hoursWorked, status: hoursWorked > threshold ? "overtime" : "complete" })
      .where(eq(punchLogs.id, current.id))
      .returning();
    return punchLogToLegacy(updated);
  }

  async getCurrentAttendance(userId: string): Promise<PunchLog | undefined> {
    const [record] = await db
      .select()
      .from(punchLogs)
      .where(and(eq(punchLogs.employeeId, userId), eq(punchLogs.status, "in-progress")))
      .orderBy(desc(punchLogs.clockIn))
      .limit(1);
    return record ? punchLogToLegacy(record) : undefined;
  }

  async getAttendanceRecords(userId: string, startDate?: string, endDate?: string): Promise<PunchLog[]> {
    const conditions = [eq(punchLogs.employeeId, userId)];
    if (startDate) conditions.push(gte(punchLogs.workDate, startDate));
    if (endDate) conditions.push(lte(punchLogs.workDate, endDate));

    const records = await db
      .select()
      .from(punchLogs)
      .where(and(...conditions))
      .orderBy(desc(punchLogs.workDate));
    return records.map(punchLogToLegacy);
  }

  async getTodayHours(userId: string): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const records = await db
      .select()
      .from(punchLogs)
      .where(and(eq(punchLogs.employeeId, userId), eq(punchLogs.workDate, today)));

    let total = 0;
    for (const r of records) {
      if (r.hoursWorked) {
        total += r.hoursWorked;
      } else if (r.status === "in-progress" && r.clockIn) {
        const elapsed = (Date.now() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        total += Math.round(elapsed * 100) / 100;
      }
    }
    return total;
  }

  async getWeekHours(userId: string): Promise<number> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const startDate = monday.toISOString().split("T")[0];

    const records = await db
      .select()
      .from(punchLogs)
      .where(and(eq(punchLogs.employeeId, userId), gte(punchLogs.workDate, startDate)));

    let total = 0;
    for (const r of records) {
      if (r.hoursWorked) {
        total += r.hoursWorked;
      } else if (r.status === "in-progress" && r.clockIn) {
        const elapsed = (Date.now() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        total += Math.round(elapsed * 100) / 100;
      }
    }
    return total;
  }

  async getAttendanceException(id: string): Promise<AttendanceException | undefined> {
    const [record] = await db.select().from(attendanceExceptions).where(eq(attendanceExceptions.id, id));
    return record;
  }

  async getAttendanceExceptionsByEmployee(employeeId: string): Promise<AttendanceException[]> {
    return db.select().from(attendanceExceptions)
      .where(eq(attendanceExceptions.employeeId, employeeId))
      .orderBy(desc(attendanceExceptions.createdAt));
  }

  async getPendingAttendanceExceptions(): Promise<AttendanceException[]> {
    return db.select().from(attendanceExceptions)
      .where(eq(attendanceExceptions.status, "pending"))
      .orderBy(desc(attendanceExceptions.createdAt));
  }

  async getAllAttendanceExceptions(): Promise<AttendanceException[]> {
    return db.select().from(attendanceExceptions).orderBy(desc(attendanceExceptions.createdAt));
  }

  async createAttendanceException(exception: InsertAttendanceException): Promise<AttendanceException> {
    const [created] = await db.insert(attendanceExceptions).values(exception).returning();
    return created;
  }

  async updateAttendanceException(id: string, data: Partial<AttendanceException>): Promise<AttendanceException | undefined> {
    const [updated] = await db.update(attendanceExceptions).set(data).where(eq(attendanceExceptions.id, id)).returning();
    return updated;
  }

  async createAuditLog(entry: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(entry).returning();
    return created;
  }

  async getAuditLogs(targetType?: string, targetId?: string): Promise<AuditLog[]> {
    const conditions = [];
    if (targetType) conditions.push(eq(auditLogs.targetType, targetType));
    if (targetId) conditions.push(eq(auditLogs.targetId, targetId));
    if (conditions.length > 0) {
      return db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt));
    }
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
  }

  async getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined> {
    const [request] = await db.select().from(timeOffRequests).where(eq(timeOffRequests.id, id));
    return request;
  }

  async getTimeOffRequestsByUser(userId: string): Promise<TimeOffRequest[]> {
    return db.select().from(timeOffRequests)
      .where(eq(timeOffRequests.userId, userId))
      .orderBy(desc(timeOffRequests.createdAt));
  }

  async getPendingTimeOffRequests(): Promise<TimeOffRequest[]> {
    return db.select().from(timeOffRequests).where(eq(timeOffRequests.status, "pending"));
  }

  async getAllTimeOffRequests(): Promise<TimeOffRequest[]> {
    return db.select().from(timeOffRequests).orderBy(desc(timeOffRequests.createdAt));
  }

  async createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest> {
    const [created] = await db.insert(timeOffRequests).values(request).returning();
    return created;
  }

  async updateTimeOffRequest(id: string, request: Partial<InsertTimeOffRequest & { reviewedBy: string; reviewedAt: Date }>): Promise<TimeOffRequest | undefined> {
    const [updated] = await db.update(timeOffRequests).set(request).where(eq(timeOffRequests.id, id)).returning();
    return updated;
  }

  async getTimeOffBalance(userId: string, type: string, year: number): Promise<TimeOffBalance | undefined> {
    const [balance] = await db.select().from(timeOffBalances).where(
      and(eq(timeOffBalances.userId, userId), eq(timeOffBalances.type, type), eq(timeOffBalances.year, year))
    );
    return balance;
  }

  async getTimeOffBalancesByUser(userId: string, year: number): Promise<TimeOffBalance[]> {
    return db.select().from(timeOffBalances).where(
      and(eq(timeOffBalances.userId, userId), eq(timeOffBalances.year, year))
    );
  }

  async createTimeOffBalance(balance: InsertTimeOffBalance): Promise<TimeOffBalance> {
    const [created] = await db.insert(timeOffBalances).values(balance).returning();
    return created;
  }

  async updateTimeOffBalance(id: string, balance: Partial<InsertTimeOffBalance>): Promise<TimeOffBalance | undefined> {
    const [updated] = await db.update(timeOffBalances).set(balance).where(eq(timeOffBalances.id, id)).returning();
    return updated;
  }

  async computeTimeOffBalance(userId: string): Promise<{ vacation: number; sick: number; personal: number }> {
    const ANNUAL_VACATION = 15;
    const ANNUAL_SICK = 10;
    const ANNUAL_PERSONAL = 5;

    const requests = await db
      .select()
      .from(timeOffRequests)
      .where(eq(timeOffRequests.userId, userId));

    let usedVacation = 0;
    let usedSick = 0;
    let usedPersonal = 0;

    for (const r of requests) {
      if (r.status !== "approved") continue;
      const days = r.daysRequested || 1;
      if (r.type === "vacation") usedVacation += days;
      else if (r.type === "sick") usedSick += days;
      else if (r.type === "personal") usedPersonal += days;
    }

    return {
      vacation: ANNUAL_VACATION - usedVacation,
      sick: ANNUAL_SICK - usedSick,
      personal: ANNUAL_PERSONAL - usedPersonal,
    };
  }

  async getOverlappingTimeOffRequests(userId: string, startDate: string, endDate: string): Promise<TimeOffRequest[]> {
    const userRequests = await db
      .select()
      .from(timeOffRequests)
      .where(eq(timeOffRequests.userId, userId));

    return userRequests.filter(r =>
      r.status !== "denied" &&
      r.startDate <= endDate &&
      r.endDate >= startDate
    );
  }

  async getEmployeePin(userId: string): Promise<EmployeePin | undefined> {
    const [pin] = await db.select().from(employeePins).where(eq(employeePins.userId, userId));
    return pin;
  }

  async createEmployeePin(pin: InsertEmployeePin): Promise<EmployeePin> {
    const [created] = await db.insert(employeePins).values(pin).returning();
    return created;
  }

  async updateEmployeePin(userId: string, pin: string): Promise<EmployeePin | undefined> {
    const [updated] = await db.update(employeePins).set({ pin }).where(eq(employeePins.userId, userId)).returning();
    return updated;
  }

  async deleteEmployeePin(userId: string): Promise<void> {
    await db.delete(employeePins).where(eq(employeePins.userId, userId));
  }

  async getKioskDevice(id: string): Promise<KioskDevice | undefined> {
    const [device] = await db.select().from(kioskDevices).where(eq(kioskDevices.id, id));
    return device;
  }

  async getAllKioskDevices(): Promise<KioskDevice[]> {
    return db.select().from(kioskDevices);
  }

  async createKioskDevice(device: InsertKioskDevice): Promise<KioskDevice> {
    const [created] = await db.insert(kioskDevices).values(device).returning();
    return created;
  }

  async updateKioskDevice(id: string, device: Partial<InsertKioskDevice>): Promise<KioskDevice | undefined> {
    const [updated] = await db.update(kioskDevices).set(device).where(eq(kioskDevices.id, id)).returning();
    return updated;
  }

  async deleteKioskDevice(id: string): Promise<void> {
    await db.delete(kioskDevices).where(eq(kioskDevices.id, id));
  }

  async getUserByPin(pin: string): Promise<User | undefined> {
    const results = await db
      .select({ user: users })
      .from(employeePins)
      .innerJoin(users, eq(employeePins.userId, users.id))
      .where(eq(employeePins.pin, pin));
    return results[0]?.user;
  }

  async searchUsersByName(query: string): Promise<User[]> {
    const pattern = `%${query}%`;
    return db
      .select()
      .from(users)
      .where(
        or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern)
        )
      );
  }

  async getLatestAttendanceForUser(userId: string): Promise<PunchLog | undefined> {
    const [record] = await db
      .select()
      .from(punchLogs)
      .where(eq(punchLogs.employeeId, userId))
      .orderBy(desc(punchLogs.createdAt))
      .limit(1);
    return record ? punchLogToLegacy(record) : undefined;
  }

  async getUsersByDepartment(departmentId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.departmentId, departmentId));
  }

  async getProcessedTimeOffRequests(filters?: {
    reviewerId?: string;
    departmentId?: string;
    locationId?: string;
    type?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    userIds?: string[];
  }): Promise<TimeOffRequest[]> {
    const conditions: any[] = [ne(timeOffRequests.status, "pending")];

    if (filters?.reviewerId) {
      conditions.push(eq(timeOffRequests.reviewedBy, filters.reviewerId));
    }
    if (filters?.type) {
      conditions.push(eq(timeOffRequests.type, filters.type));
    }
    if (filters?.status) {
      conditions.push(eq(timeOffRequests.status, filters.status));
    }
    if (filters?.startDate) {
      conditions.push(gte(timeOffRequests.startDate, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(timeOffRequests.endDate, filters.endDate));
    }
    if (filters?.userIds !== undefined) {
      if (filters.userIds.length === 0) {
        return [];
      }
      conditions.push(inArray(timeOffRequests.userId, filters.userIds));
    }

    return db.select().from(timeOffRequests)
      .where(and(...conditions))
      .orderBy(desc(timeOffRequests.reviewedAt))
      .limit(100);
  }

  async getAttendanceByDateRange(startDate: string, endDate: string): Promise<PunchLog[]> {
    const records = await db.select().from(punchLogs)
      .where(and(gte(punchLogs.workDate, startDate), lte(punchLogs.workDate, endDate)));
    return records.map(punchLogToLegacy);
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async getAllCompanies(): Promise<Company[]> {
    return db.select().from(companies);
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async updateCompany(id: string, company: Partial<InsertCompany>): Promise<Company | undefined> {
    const [updated] = await db.update(companies).set(company).where(eq(companies.id, id)).returning();
    return updated;
  }

  async deleteCompany(id: string): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  async getLocation(id: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async getLocationsByCompany(companyId: string): Promise<Location[]> {
    return db.select().from(locations).where(eq(locations.companyId, companyId));
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(locations).values(location).returning();
    return created;
  }

  async updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updated] = await db.update(locations).set(location).where(eq(locations.id, id)).returning();
    return updated;
  }

  async deleteLocation(id: string): Promise<void> {
    await db.delete(locations).where(eq(locations.id, id));
  }

  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }

  async getAllRoles(): Promise<Role[]> {
    return db.select().from(roles);
  }

  async getRolesByCompany(companyId: string | null): Promise<Role[]> {
    if (companyId === null) {
      return db.select().from(roles).where(sql`${roles.companyId} IS NULL`);
    }
    return db.select().from(roles).where(eq(roles.companyId, companyId));
  }

  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }

  async updateRole(id: string, role: Partial<InsertRole>): Promise<Role | undefined> {
    const [updated] = await db.update(roles).set(role).where(eq(roles.id, id)).returning();
    return updated;
  }

  async deleteRole(id: string): Promise<void> {
    await db.delete(roles).where(eq(roles.id, id));
  }

  async getPermission(id: string): Promise<Permission | undefined> {
    const [perm] = await db.select().from(permissions).where(eq(permissions.id, id));
    return perm;
  }

  async getPermissionByKey(key: string): Promise<Permission | undefined> {
    const [perm] = await db.select().from(permissions).where(eq(permissions.key, key));
    return perm;
  }

  async getAllPermissions(): Promise<Permission[]> {
    return db.select().from(permissions);
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const results = await db
      .select({ permission: permissions })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));
    return results.map((r) => r.permission);
  }

  async addRolePermission(roleId: string, permissionId: string): Promise<RolePermission> {
    const [created] = await db.insert(rolePermissions).values({ roleId, permissionId }).returning();
    return created;
  }

  async removeRolePermission(roleId: string, permissionId: string): Promise<void> {
    await db.delete(rolePermissions).where(
      and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId))
    );
  }

  async getUserRoles(userId: string): Promise<(UserRole & { role?: Role })[]> {
    const results = await db
      .select({ userRole: userRoles, role: roles })
      .from(userRoles)
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));
    return results.map((r) => ({ ...r.userRole, role: r.role || undefined }));
  }

  async assignUserRole(userId: string, roleId: string, companyId?: string): Promise<UserRole> {
    const [created] = await db
      .insert(userRoles)
      .values({ userId, roleId, companyId: companyId || null })
      .returning();
    return created;
  }

  async removeUserRole(userId: string, roleId: string): Promise<void> {
    await db.delete(userRoles).where(
      and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId))
    );
  }

  async getUserPermissionOverrides(userId: string): Promise<UserPermissionOverride[]> {
    return db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));
  }

  async setUserPermissionOverride(userId: string, permissionId: string, allowed: boolean, reason?: string, createdBy?: string): Promise<UserPermissionOverride> {
    const existing = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, userId),
          eq(userPermissionOverrides.permissionId, permissionId)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(userPermissionOverrides)
        .set({ allowed, reason: reason || null, updatedAt: new Date() })
        .where(eq(userPermissionOverrides.id, existing[0].id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(userPermissionOverrides)
      .values({ userId, permissionId, allowed, reason: reason || null, createdBy: createdBy || null })
      .returning();
    return created;
  }

  async removeUserPermissionOverride(userId: string, permissionId: string): Promise<void> {
    await db.delete(userPermissionOverrides).where(
      and(
        eq(userPermissionOverrides.userId, userId),
        eq(userPermissionOverrides.permissionId, permissionId)
      )
    );
  }

  async getUserAccessScopes(userId: string): Promise<UserAccessScope[]> {
    return db.select().from(userAccessScopes).where(eq(userAccessScopes.userId, userId));
  }

  async addUserAccessScope(userId: string, scopeType: string, scope: { companyId?: string; locationId?: string; departmentId?: string }): Promise<UserAccessScope> {
    const [created] = await db
      .insert(userAccessScopes)
      .values({
        userId,
        scopeType,
        companyId: scope.companyId || null,
        locationId: scope.locationId || null,
        departmentId: scope.departmentId || null,
      })
      .returning();
    return created;
  }

  async removeUserAccessScope(id: string): Promise<void> {
    await db.delete(userAccessScopes).where(eq(userAccessScopes.id, id));
  }

  async getScopedUserIds(user: User): Promise<Set<string>> {
    if (user.role === "admin") {
      const allUsers = await this.getAllUsers();
      return new Set(allUsers.map(u => u.id));
    }

    const conditions: any[] = [];

    if (user.companyId) {
      conditions.push(eq(users.companyId, user.companyId));
    }
    if (user.locationId) {
      conditions.push(eq(users.locationId, user.locationId));
    }
    if (user.departmentId) {
      conditions.push(eq(users.departmentId, user.departmentId));
    }

    if (conditions.length === 0) {
      return new Set([user.id]);
    }

    const scopedUsers = await db.select().from(users).where(and(...conditions));
    return new Set(scopedUsers.map(u => u.id));
  }

  async getPtoPolicy(id: string): Promise<PtoPolicy | undefined> {
    const [policy] = await db.select().from(ptoPolicies).where(eq(ptoPolicies.id, id));
    return policy;
  }

  async getAllPtoPolicies(): Promise<PtoPolicy[]> {
    return db.select().from(ptoPolicies).orderBy(desc(ptoPolicies.createdAt));
  }

  async getDefaultPtoPolicy(): Promise<PtoPolicy | undefined> {
    const [policy] = await db.select().from(ptoPolicies)
      .where(and(eq(ptoPolicies.isDefault, true), eq(ptoPolicies.isActive, true)));
    return policy;
  }

  async createPtoPolicy(policy: InsertPtoPolicy): Promise<PtoPolicy> {
    if (policy.isDefault) {
      await db.update(ptoPolicies).set({ isDefault: false }).where(eq(ptoPolicies.isDefault, true));
    }
    const [created] = await db.insert(ptoPolicies).values(policy).returning();
    return created;
  }

  async updatePtoPolicy(id: string, policy: Partial<InsertPtoPolicy>): Promise<PtoPolicy | undefined> {
    if (policy.isDefault) {
      await db.update(ptoPolicies).set({ isDefault: false }).where(eq(ptoPolicies.isDefault, true));
    }
    const [updated] = await db.update(ptoPolicies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(ptoPolicies.id, id))
      .returning();
    return updated;
  }

  async getEmployeePtoSettings(userId: string): Promise<EmployeePtoSettings | undefined> {
    const [settings] = await db.select().from(employeePtoSettings)
      .where(eq(employeePtoSettings.userId, userId));
    return settings;
  }

  async createEmployeePtoSettings(settings: InsertEmployeePtoSettings): Promise<EmployeePtoSettings> {
    const [created] = await db.insert(employeePtoSettings).values(settings).returning();
    return created;
  }

  async updateEmployeePtoSettings(userId: string, settings: Partial<InsertEmployeePtoSettings>): Promise<EmployeePtoSettings | undefined> {
    const [updated] = await db.update(employeePtoSettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(employeePtoSettings.userId, userId))
      .returning();
    return updated;
  }

  async getEmployeePtoPolicy(userId: string): Promise<PtoPolicy | undefined> {
    const empSettings = await this.getEmployeePtoSettings(userId);
    if (empSettings?.ptoPolicyId) {
      const policy = await this.getPtoPolicy(empSettings.ptoPolicyId);
      if (policy) return policy;
    }
    return this.getDefaultPtoPolicy();
  }

  async computeTotalHoursWorked(userId: string, year: number): Promise<number> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const records = await db.select().from(punchLogs)
      .where(and(
        eq(punchLogs.employeeId, userId),
        gte(punchLogs.workDate, startDate),
        lte(punchLogs.workDate, endDate)
      ));

    let total = 0;
    for (const r of records) {
      if (r.hoursWorked) {
        total += r.hoursWorked;
      } else if (r.clockIn) {
        const end = r.clockOut ? new Date(r.clockOut) : new Date();
        total += (end.getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
      }
    }
    return total;
  }

  async computeTimeOffBalance(userId: string): Promise<{ vacation: number; sick: number; personal: number }> {
    const policy = await this.getEmployeePtoPolicy(userId);
    const empSettings = await this.getEmployeePtoSettings(userId);
    const currentYear = new Date().getFullYear();

    let annualVacation: number;
    let annualSick: number;
    let annualPersonal: number;

    if (policy) {
      annualVacation = policy.accrualRate;

      if (policy.sickAccrualEnabled) {
        const hoursWorked = await this.computeTotalHoursWorked(userId, currentYear);
        const accruedSickHours = Math.floor(hoursWorked / policy.sickAccrualPerHoursWorked) * policy.sickAccrualRatePerHours;
        const cappedSickHours = Math.min(accruedSickHours, policy.sickYearlyCapHours);
        annualSick = cappedSickHours / 8;
      } else {
        annualSick = 0;
      }

      annualPersonal = policy.personalDaysPerYear;

      if (policy.holidayPayEnabled && policy.holidayPtoDeduction) {
        const holidayRequests = await db.select().from(timeOffRequests)
          .where(and(
            eq(timeOffRequests.userId, userId),
            eq(timeOffRequests.type, "holiday"),
            eq(timeOffRequests.status, "approved")
          ));
        let holidayDays = 0;
        for (const r of holidayRequests) {
          holidayDays += r.daysRequested || 1;
        }
        annualVacation = Math.max(0, annualVacation - holidayDays);
      }
    } else {
      annualVacation = 15;
      annualSick = 10;
      annualPersonal = 5;
    }

    if (empSettings) {
      if (empSettings.vacationBalanceOverride !== null && empSettings.vacationBalanceOverride !== undefined) {
        annualVacation = empSettings.vacationBalanceOverride;
      }
      if (empSettings.sickBalanceOverride !== null && empSettings.sickBalanceOverride !== undefined) {
        annualSick = empSettings.sickBalanceOverride;
      }
      if (empSettings.personalBalanceOverride !== null && empSettings.personalBalanceOverride !== undefined) {
        annualPersonal = empSettings.personalBalanceOverride;
      }

      if (empSettings.hireDate && policy && policy.waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000;
        if (Date.now() < waitingEnd) {
          return { vacation: 0, sick: 0, personal: 0 };
        }
      }
    }

    const requests = await db.select().from(timeOffRequests)
      .where(eq(timeOffRequests.userId, userId));

    let usedVacation = 0;
    let usedSick = 0;
    let usedPersonal = 0;

    for (const r of requests) {
      if (r.status !== "approved") continue;
      const days = r.daysRequested || 1;
      if (r.type === "vacation") usedVacation += days;
      else if (r.type === "sick") usedSick += days;
      else if (r.type === "personal") usedPersonal += days;
    }

    return {
      vacation: Math.round((annualVacation - usedVacation) * 100) / 100,
      sick: Math.round((annualSick - usedSick) * 100) / 100,
      personal: Math.round((annualPersonal - usedPersonal) * 100) / 100,
    };
  }

  async getHolidayPayInfo(userId: string): Promise<{
    holidayPayEnabled: boolean;
    holidayPtoDeduction: boolean;
    holidayOtExclusion: boolean;
  }> {
    const policy = await this.getEmployeePtoPolicy(userId);
    if (!policy) {
      return { holidayPayEnabled: true, holidayPtoDeduction: false, holidayOtExclusion: true };
    }
    return {
      holidayPayEnabled: policy.holidayPayEnabled,
      holidayPtoDeduction: policy.holidayPtoDeduction,
      holidayOtExclusion: policy.holidayOtExclusion,
    };
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  async getAuditLogs(targetType?: string, limit: number = 50): Promise<AuditLog[]> {
    if (targetType) {
      return db.select().from(auditLogs)
        .where(eq(auditLogs.targetType, targetType))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    }
    return db.select().from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async getPolicy(id: string): Promise<Policy | undefined> {
    const [policy] = await db.select().from(policies).where(eq(policies.id, id));
    return policy;
  }

  async getPoliciesByCompany(companyId: string | null): Promise<Policy[]> {
    if (companyId === null) {
      return db.select().from(policies).where(sql`${policies.companyId} IS NULL`).orderBy(desc(policies.createdAt));
    }
    return db.select().from(policies).where(eq(policies.companyId, companyId)).orderBy(desc(policies.createdAt));
  }

  async getAllPolicies(): Promise<Policy[]> {
    return db.select().from(policies).orderBy(desc(policies.createdAt));
  }

  async createPolicy(policy: InsertPolicy): Promise<Policy> {
    const [created] = await db.insert(policies).values(policy).returning();
    return created;
  }

  async updatePolicy(id: string, policy: Partial<InsertPolicy>): Promise<Policy | undefined> {
    const [updated] = await db.update(policies)
      .set({ ...policy, updatedAt: new Date() })
      .where(eq(policies.id, id))
      .returning();
    return updated;
  }

  async getPolicyRulesByPolicy(policyId: string): Promise<PolicyRule[]> {
    return db.select().from(policyRules).where(eq(policyRules.policyId, policyId));
  }

  async upsertPolicyRules(policyId: string, rules: Record<string, any>): Promise<PolicyRule> {
    const existing = await db.select().from(policyRules).where(eq(policyRules.policyId, policyId));
    if (existing.length > 0) {
      const [updated] = await db.update(policyRules)
        .set({ rules, updatedAt: new Date() })
        .where(eq(policyRules.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(policyRules).values({ policyId, rules }).returning();
    return created;
  }

  async getPolicyAssignment(id: string): Promise<PolicyAssignment | undefined> {
    const [assignment] = await db.select().from(policyAssignments).where(eq(policyAssignments.id, id));
    return assignment;
  }

  async getPolicyAssignmentsByPolicy(policyId: string): Promise<PolicyAssignment[]> {
    return db.select().from(policyAssignments).where(eq(policyAssignments.policyId, policyId));
  }

  async getAllPolicyAssignments(): Promise<PolicyAssignment[]> {
    return db.select().from(policyAssignments);
  }

  async createPolicyAssignment(assignment: InsertPolicyAssignment): Promise<PolicyAssignment> {
    const [created] = await db.insert(policyAssignments).values(assignment).returning();
    return created;
  }

  async updatePolicyAssignment(id: string, assignment: Partial<InsertPolicyAssignment>): Promise<PolicyAssignment | undefined> {
    const [updated] = await db.update(policyAssignments)
      .set(assignment)
      .where(eq(policyAssignments.id, id))
      .returning();
    return updated;
  }

  async deletePolicyAssignment(id: string): Promise<void> {
    await db.delete(policyAssignments).where(eq(policyAssignments.id, id));
  }

  async getPolicyTypeByKey(key: string): Promise<{ id: string; key: string; name: string } | undefined> {
    const [pt] = await db.select().from(policyTypes).where(eq(policyTypes.key, key));
    return pt ? { id: pt.id, key: pt.key, name: pt.name } : undefined;
  }

  async getAllPolicyTypes(): Promise<{ id: string; key: string; name: string; description: string | null; module: string | null; isActive: boolean }[]> {
    return db.select().from(policyTypes);
  }

  async getPayrollExport(id: string): Promise<PayrollExport | undefined> {
    const [record] = await db.select().from(payrollExports).where(eq(payrollExports.id, id));
    return record;
  }

  async getPayrollExports(companyId?: string): Promise<PayrollExport[]> {
    if (companyId) {
      return db.select().from(payrollExports)
        .where(eq(payrollExports.companyId, companyId))
        .orderBy(desc(payrollExports.createdAt));
    }
    return db.select().from(payrollExports).orderBy(desc(payrollExports.createdAt));
  }

  async getOverlappingPayrollExports(startDate: string, endDate: string, companyId?: string): Promise<PayrollExport[]> {
    const conditions = [
      lte(payrollExports.startDate, endDate),
      gte(payrollExports.endDate, startDate),
      ne(payrollExports.status, "draft"),
    ];
    if (companyId) {
      conditions.push(eq(payrollExports.companyId, companyId));
    }
    return db.select().from(payrollExports).where(and(...conditions));
  }

  async createPayrollExport(data: InsertPayrollExport): Promise<PayrollExport> {
    const [created] = await db.insert(payrollExports).values(data).returning();
    return created;
  }

  async updatePayrollExport(id: string, data: Partial<InsertPayrollExport>): Promise<PayrollExport | undefined> {
    const [updated] = await db.update(payrollExports).set(data).where(eq(payrollExports.id, id)).returning();
    return updated;
  }

  async getPayrollBatchRecords(exportId: string): Promise<PayrollBatchRecord[]> {
    return db.select().from(payrollBatchRecords)
      .where(eq(payrollBatchRecords.payrollExportId, exportId))
      .orderBy(payrollBatchRecords.employeeId, payrollBatchRecords.workDate);
  }

  async createPayrollBatchRecord(data: InsertPayrollBatchRecord): Promise<PayrollBatchRecord> {
    const [created] = await db.insert(payrollBatchRecords).values(data).returning();
    return created;
  }

  async deletePayrollBatchRecords(exportId: string): Promise<void> {
    await db.delete(payrollBatchRecords).where(eq(payrollBatchRecords.payrollExportId, exportId));
  }

  async getPayrollAdjustment(id: string): Promise<PayrollAdjustment | undefined> {
    const [record] = await db.select().from(payrollAdjustments).where(eq(payrollAdjustments.id, id));
    return record;
  }

  async getPayrollAdjustmentsByExport(exportId: string): Promise<PayrollAdjustment[]> {
    return db.select().from(payrollAdjustments)
      .where(eq(payrollAdjustments.payrollExportId, exportId))
      .orderBy(desc(payrollAdjustments.createdAt));
  }

  async getPendingPayrollAdjustments(): Promise<PayrollAdjustment[]> {
    return db.select().from(payrollAdjustments)
      .where(eq(payrollAdjustments.status, "pending"))
      .orderBy(desc(payrollAdjustments.createdAt));
  }

  async createPayrollAdjustment(data: InsertPayrollAdjustment): Promise<PayrollAdjustment> {
    const [created] = await db.insert(payrollAdjustments).values(data).returning();
    return created;
  }

  async updatePayrollAdjustment(id: string, data: Partial<InsertPayrollAdjustment>): Promise<PayrollAdjustment | undefined> {
    const [updated] = await db.update(payrollAdjustments).set(data).where(eq(payrollAdjustments.id, id)).returning();
    return updated;
  }

  async getExportedBatchRecordsByPunchLog(punchLogId: string): Promise<(PayrollBatchRecord & { payrollExport?: PayrollExport })[]> {
    const results = await db
      .select({ batchRecord: payrollBatchRecords, payrollExport: payrollExports })
      .from(payrollBatchRecords)
      .innerJoin(payrollExports, eq(payrollExports.id, payrollBatchRecords.payrollExportId))
      .where(
        and(
          eq(payrollBatchRecords.punchLogId, punchLogId),
          or(eq(payrollExports.status, "exported"), eq(payrollExports.status, "locked"))
        )
      );
    return results.map(r => ({ ...r.batchRecord, payrollExport: r.payrollExport }));
  }

  async getSystemAlert(id: string): Promise<SystemAlert | undefined> {
    const [alert] = await db.select().from(systemAlerts).where(eq(systemAlerts.id, id));
    return alert;
  }

  async getAllSystemAlerts(filters?: { type?: string; status?: string; severity?: string }): Promise<SystemAlert[]> {
    const conditions: any[] = [];
    if (filters?.type) conditions.push(eq(systemAlerts.type, filters.type));
    if (filters?.status) conditions.push(eq(systemAlerts.status, filters.status));
    if (filters?.severity) conditions.push(eq(systemAlerts.severity, filters.severity));

    if (conditions.length > 0) {
      return db.select().from(systemAlerts).where(and(...conditions)).orderBy(desc(systemAlerts.createdAt));
    }
    return db.select().from(systemAlerts).orderBy(desc(systemAlerts.createdAt));
  }

  async createSystemAlert(alert: InsertSystemAlert): Promise<SystemAlert> {
    const [created] = await db.insert(systemAlerts).values(alert).returning();
    return created;
  }

  async updateSystemAlert(id: string, data: Partial<SystemAlert>): Promise<SystemAlert | undefined> {
    const [updated] = await db.update(systemAlerts).set(data).where(eq(systemAlerts.id, id)).returning();
    return updated;
  }

  async getAuditLogsFiltered(filters: {
    actorUserId?: string;
    action?: string;
    targetType?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    const conditions: any[] = [];
    if (filters.actorUserId) conditions.push(eq(auditLogs.actorUserId, filters.actorUserId));
    if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
    if (filters.targetType) conditions.push(eq(auditLogs.targetType, filters.targetType));
    if (filters.startDate) conditions.push(gte(auditLogs.createdAt, new Date(filters.startDate)));
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setDate(endDate.getDate() + 1);
      conditions.push(lte(auditLogs.createdAt, endDate));
    }
    if (filters.search) {
      conditions.push(
        or(
          ilike(auditLogs.action, `%${filters.search}%`),
          ilike(auditLogs.targetType, `%${filters.search}%`),
          ilike(auditLogs.targetId, `%${filters.search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const lim = filters.limit || 50;
    const off = filters.offset || 0;

    const [totalResult] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(whereClause);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(lim)
      .offset(off);

    return { logs, total: totalResult?.count || 0 };
  }

  async createUser(user: UpsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: string, data: Partial<UpsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated;
  }

  async getDocumentsByEmployee(employeeId: string): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.employeeId, employeeId)).orderBy(desc(documents.uploadedAt));
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  async createDocument(doc: InsertDocument): Promise<Document> {
    const [created] = await db.insert(documents).values(doc).returning();
    return created;
  }

  async updateDocument(id: string, data: Partial<Document>): Promise<Document | undefined> {
    const [updated] = await db.update(documents).set(data).where(eq(documents.id, id)).returning();
    return updated;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  async getEmployeeSchedules(employeeId: string): Promise<EmployeeSchedule[]> {
    return db.select().from(employeeSchedules).where(eq(employeeSchedules.employeeId, employeeId));
  }

  async getEmployeeScheduleByDay(employeeId: string, dayOfWeek: number): Promise<EmployeeSchedule | undefined> {
    const [schedule] = await db.select().from(employeeSchedules).where(
      and(eq(employeeSchedules.employeeId, employeeId), eq(employeeSchedules.dayOfWeek, dayOfWeek), eq(employeeSchedules.isActive, true))
    );
    return schedule;
  }

  async upsertEmployeeSchedule(schedule: InsertEmployeeSchedule): Promise<EmployeeSchedule> {
    const existing = await db.select().from(employeeSchedules).where(
      and(eq(employeeSchedules.employeeId, schedule.employeeId), eq(employeeSchedules.dayOfWeek, schedule.dayOfWeek))
    );
    if (existing.length > 0) {
      const [updated] = await db.update(employeeSchedules)
        .set({ startTime: schedule.startTime, endTime: schedule.endTime, isActive: schedule.isActive ?? true })
        .where(eq(employeeSchedules.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(employeeSchedules).values(schedule).returning();
    return created;
  }

  async deleteEmployeeSchedules(employeeId: string): Promise<void> {
    await db.delete(employeeSchedules).where(eq(employeeSchedules.employeeId, employeeId));
  }
}

export const storage = new DatabaseStorage();
