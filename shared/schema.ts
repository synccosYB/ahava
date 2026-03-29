import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export { users, sessions } from "./models/auth";
export type { User, UpsertUser } from "./models/auth";

export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  managerId: varchar("manager_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDepartmentSchema = createInsertSchema(departments).omit({
  id: true,
  createdAt: true,
});
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departments.$inferSelect;

export const attendanceRecords = pgTable("attendance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  status: varchar("status", { length: 20 }).default("present").notNull(),
  notes: text("notes"),
  source: varchar("source", { length: 20 }).default("web").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({
  id: true,
  createdAt: true,
});
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

export const timeOffRequests = pgTable("time_off_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 30 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reason: text("reason"),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
});
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;

export const timeOffBalances = pgTable("time_off_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 30 }).notNull(),
  totalDays: integer("total_days").default(0).notNull(),
  usedDays: integer("used_days").default(0).notNull(),
  year: integer("year").notNull(),
});

export const insertTimeOffBalanceSchema = createInsertSchema(timeOffBalances).omit({
  id: true,
});
export type InsertTimeOffBalance = z.infer<typeof insertTimeOffBalanceSchema>;
export type TimeOffBalance = typeof timeOffBalances.$inferSelect;

export const employeePins = pgTable("employee_pins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  pin: varchar("pin", { length: 128 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEmployeePinSchema = createInsertSchema(employeePins).omit({
  id: true,
  createdAt: true,
});
export type InsertEmployeePin = z.infer<typeof insertEmployeePinSchema>;
export type EmployeePin = typeof employeePins.$inferSelect;

export const kioskDevices = pgTable("kiosk_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  locationDescription: text("location_description"),
  departmentId: varchar("department_id").references(() => departments.id),
  isActive: boolean("is_active").default(true).notNull(),
  lastHeartbeat: timestamp("last_heartbeat"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKioskDeviceSchema = createInsertSchema(kioskDevices).omit({
  id: true,
  createdAt: true,
  lastHeartbeat: true,
});
export type InsertKioskDevice = z.infer<typeof insertKioskDeviceSchema>;
export type KioskDevice = typeof kioskDevices.$inferSelect;

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  attendanceRecords: many(attendanceRecords),
  timeOffRequests: many(timeOffRequests),
  timeOffBalances: many(timeOffBalances),
  employeePin: one(employeePins, { fields: [users.id], references: [employeePins.userId] }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  manager: one(users, { fields: [departments.managerId], references: [users.id] }),
  kioskDevices: many(kioskDevices),
}));

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  user: one(users, { fields: [attendanceRecords.userId], references: [users.id] }),
}));

export const timeOffRequestsRelations = relations(timeOffRequests, ({ one }) => ({
  user: one(users, { fields: [timeOffRequests.userId], references: [users.id] }),
  reviewer: one(users, { fields: [timeOffRequests.reviewedBy], references: [users.id] }),
}));

export const timeOffBalancesRelations = relations(timeOffBalances, ({ one }) => ({
  user: one(users, { fields: [timeOffBalances.userId], references: [users.id] }),
}));

export const employeePinsRelations = relations(employeePins, ({ one }) => ({
  user: one(users, { fields: [employeePins.userId], references: [users.id] }),
}));

export const kioskDevicesRelations = relations(kioskDevices, ({ one }) => ({
  department: one(departments, { fields: [kioskDevices.departmentId], references: [departments.id] }),
}));
