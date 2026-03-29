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
  type Department,
  type InsertDepartment,
  userEmploymentProfiles,
  type EmploymentProfile,
  type InsertEmploymentProfile,
  attendanceRecords,
  type AttendanceRecord,
  type InsertAttendanceRecord,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, ilike, gte, lte, desc, ne, count, sql, inArray } from "drizzle-orm";

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

  getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined>;
  getAttendanceByUser(userId: string): Promise<AttendanceRecord[]>;
  getAttendanceByDate(date: string): Promise<AttendanceRecord[]>;
  createAttendanceRecord(record: InsertAttendanceRecord): Promise<AttendanceRecord>;
  updateAttendanceRecord(id: string, record: Partial<InsertAttendanceRecord>): Promise<AttendanceRecord | undefined>;

  clockIn(userId: string): Promise<AttendanceRecord>;
  clockOut(userId: string): Promise<AttendanceRecord | undefined>;
  getCurrentAttendance(userId: string): Promise<AttendanceRecord | undefined>;
  getAttendanceRecords(userId: string, startDate?: string, endDate?: string): Promise<AttendanceRecord[]>;
  getTodayHours(userId: string): Promise<number>;
  getWeekHours(userId: string): Promise<number>;

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
  getLatestAttendanceForUser(userId: string): Promise<AttendanceRecord | undefined>;

  getUsersByDepartment(departmentId: string): Promise<User[]>;
  getProcessedTimeOffRequests(reviewerId?: string): Promise<TimeOffRequest[]>;
  getAttendanceByDateRange(startDate: string, endDate: string): Promise<AttendanceRecord[]>;

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
    await db.delete(departments).where(eq(departments.id, id));
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

  async getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined> {
    const [record] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, id));
    return record;
  }

  async getAttendanceByUser(userId: string): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords).where(eq(attendanceRecords.userId, userId));
  }

  async getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords).where(eq(attendanceRecords.date, date));
  }

  async createAttendanceRecord(record: InsertAttendanceRecord): Promise<AttendanceRecord> {
    const [created] = await db.insert(attendanceRecords).values(record).returning();
    return created;
  }

  async updateAttendanceRecord(id: string, record: Partial<InsertAttendanceRecord>): Promise<AttendanceRecord | undefined> {
    const [updated] = await db.update(attendanceRecords).set(record).where(eq(attendanceRecords.id, id)).returning();
    return updated;
  }

  async clockIn(userId: string): Promise<AttendanceRecord> {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const [record] = await db.insert(attendanceRecords).values({
      userId,
      date: dateStr,
      clockIn: now,
      status: "in-progress",
    }).returning();
    return record;
  }

  async clockOut(userId: string): Promise<AttendanceRecord | undefined> {
    const current = await this.getCurrentAttendance(userId);
    if (!current || !current.clockIn) return undefined;

    const now = new Date();
    const clockInTime = new Date(current.clockIn).getTime();
    const totalMs = now.getTime() - clockInTime;
    const breakMs = (current.breakMinutes || 0) * 60 * 1000;
    const totalHours = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;

    const [updated] = await db
      .update(attendanceRecords)
      .set({ clockOut: now, totalHours, status: totalHours > 8 ? "overtime" : "complete" })
      .where(eq(attendanceRecords.id, current.id))
      .returning();
    return updated;
  }

  async getCurrentAttendance(userId: string): Promise<AttendanceRecord | undefined> {
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.userId, userId), eq(attendanceRecords.status, "in-progress")))
      .orderBy(desc(attendanceRecords.clockIn))
      .limit(1);
    return record;
  }

  async getAttendanceRecords(userId: string, startDate?: string, endDate?: string): Promise<AttendanceRecord[]> {
    const conditions = [eq(attendanceRecords.userId, userId)];
    if (startDate) conditions.push(gte(attendanceRecords.date, startDate));
    if (endDate) conditions.push(lte(attendanceRecords.date, endDate));

    return db
      .select()
      .from(attendanceRecords)
      .where(and(...conditions))
      .orderBy(desc(attendanceRecords.date));
  }

  async getTodayHours(userId: string): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const records = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.userId, userId), eq(attendanceRecords.date, today)));

    let total = 0;
    for (const r of records) {
      if (r.totalHours) {
        total += r.totalHours;
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
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.userId, userId), gte(attendanceRecords.date, startDate)));

    let total = 0;
    for (const r of records) {
      if (r.totalHours) {
        total += r.totalHours;
      } else if (r.status === "in-progress" && r.clockIn) {
        const elapsed = (Date.now() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
        total += Math.round(elapsed * 100) / 100;
      }
    }
    return total;
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

  async getLatestAttendanceForUser(userId: string): Promise<AttendanceRecord | undefined> {
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.userId, userId))
      .orderBy(desc(attendanceRecords.createdAt))
      .limit(1);
    return record;
  }

  async getUsersByDepartment(departmentId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.departmentId, departmentId));
  }

  async getProcessedTimeOffRequests(reviewerId?: string): Promise<TimeOffRequest[]> {
    if (reviewerId) {
      return db.select().from(timeOffRequests)
        .where(and(ne(timeOffRequests.status, "pending"), eq(timeOffRequests.reviewedBy, reviewerId)))
        .orderBy(desc(timeOffRequests.reviewedAt))
        .limit(20);
    }
    return db.select().from(timeOffRequests)
      .where(ne(timeOffRequests.status, "pending"))
      .orderBy(desc(timeOffRequests.reviewedAt))
      .limit(20);
  }

  async getAttendanceByDateRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords)
      .where(and(gte(attendanceRecords.date, startDate), lte(attendanceRecords.date, endDate)));
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
}

export const storage = new DatabaseStorage();
