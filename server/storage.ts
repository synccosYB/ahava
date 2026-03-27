import {
  type User,
  type UpsertUser,
  users,
  departments,
  type Department,
  type InsertDepartment,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserDepartment(id: string, departmentId: string): Promise<User | undefined>;

  getDepartment(id: string): Promise<Department | undefined>;
  getAllDepartments(): Promise<Department[]>;
  createDepartment(dept: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department | undefined>;
  deleteDepartment(id: string): Promise<void>;

  getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined>;
  getAttendanceByUser(userId: string): Promise<AttendanceRecord[]>;
  getAttendanceByDate(date: string): Promise<AttendanceRecord[]>;
  createAttendanceRecord(record: InsertAttendanceRecord): Promise<AttendanceRecord>;
  updateAttendanceRecord(id: string, record: Partial<InsertAttendanceRecord>): Promise<AttendanceRecord | undefined>;

  getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined>;
  getTimeOffRequestsByUser(userId: string): Promise<TimeOffRequest[]>;
  getPendingTimeOffRequests(): Promise<TimeOffRequest[]>;
  createTimeOffRequest(request: InsertTimeOffRequest): Promise<TimeOffRequest>;
  updateTimeOffRequest(id: string, request: Partial<InsertTimeOffRequest & { reviewedBy: string; reviewedAt: Date }>): Promise<TimeOffRequest | undefined>;

  getTimeOffBalance(userId: string, type: string, year: number): Promise<TimeOffBalance | undefined>;
  getTimeOffBalancesByUser(userId: string, year: number): Promise<TimeOffBalance[]>;
  createTimeOffBalance(balance: InsertTimeOffBalance): Promise<TimeOffBalance>;
  updateTimeOffBalance(id: string, balance: Partial<InsertTimeOffBalance>): Promise<TimeOffBalance | undefined>;

  getEmployeePin(userId: string): Promise<EmployeePin | undefined>;
  createEmployeePin(pin: InsertEmployeePin): Promise<EmployeePin>;
  updateEmployeePin(userId: string, pin: string): Promise<EmployeePin | undefined>;
  deleteEmployeePin(userId: string): Promise<void>;

  getKioskDevice(id: string): Promise<KioskDevice | undefined>;
  getAllKioskDevices(): Promise<KioskDevice[]>;
  createKioskDevice(device: InsertKioskDevice): Promise<KioskDevice>;
  updateKioskDevice(id: string, device: Partial<InsertKioskDevice>): Promise<KioskDevice | undefined>;
  deleteKioskDevice(id: string): Promise<void>;
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

  async getDepartment(id: string): Promise<Department | undefined> {
    const [dept] = await db.select().from(departments).where(eq(departments.id, id));
    return dept;
  }

  async getAllDepartments(): Promise<Department[]> {
    return db.select().from(departments);
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

  async getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined> {
    const [request] = await db.select().from(timeOffRequests).where(eq(timeOffRequests.id, id));
    return request;
  }

  async getTimeOffRequestsByUser(userId: string): Promise<TimeOffRequest[]> {
    return db.select().from(timeOffRequests).where(eq(timeOffRequests.userId, userId));
  }

  async getPendingTimeOffRequests(): Promise<TimeOffRequest[]> {
    return db.select().from(timeOffRequests).where(eq(timeOffRequests.status, "pending"));
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
}

export const storage = new DatabaseStorage();
