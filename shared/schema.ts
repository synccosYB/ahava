import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, date, boolean, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  users,
  companies,
  locations,
  departments,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  userPermissionOverrides,
  userAccessScopes,
  policyTypes,
} from "./models/auth";

export {
  users,
  sessions,
  companies,
  locations,
  departments,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  userPermissionOverrides,
  userAccessScopes,
  policyTypes,
} from "./models/auth";
export type {
  User,
  UpsertUser,
  Company,
  InsertCompany,
  Location,
  InsertLocation,
  Department,
  InsertDepartment,
  Role,
  InsertRole,
  Permission,
  InsertPermission,
  RolePermission,
  UserRole,
  UserPermissionOverride,
  UserAccessScope,
  PolicyType,
  InsertPolicyType,
} from "./models/auth";
export {
  insertCompanySchema,
  insertLocationSchema,
  insertDepartmentSchema,
  insertRoleSchema,
  insertPermissionSchema,
  insertPolicyTypeSchema,
} from "./models/auth";

export const userEmploymentProfiles = pgTable("user_employment_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  employmentType: varchar("employment_type", { length: 30 }).default("full_time").notNull(),
  payType: varchar("pay_type", { length: 20 }).default("hourly").notNull(),
  hourlyRate: real("hourly_rate"),
  weeklySalary: real("weekly_salary"),
  dailySalary: real("daily_salary"),
  overtimeEligible: boolean("overtime_eligible").default(false).notNull(),
  holidayPayEnabled: boolean("holiday_pay_enabled").default(false).notNull(),
  voluntaryPayEnabled: boolean("voluntary_pay_enabled").default(false).notNull(),
  hireDate: date("hire_date"),
  terminationDate: date("termination_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmploymentProfileSchema = createInsertSchema(userEmploymentProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmploymentProfile = z.infer<typeof insertEmploymentProfileSchema>;
export type EmploymentProfile = typeof userEmploymentProfiles.$inferSelect;

export const attendanceRecords = pgTable("attendance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  breakMinutes: integer("break_minutes").default(0),
  totalHours: real("total_hours"),
  status: varchar("status", { length: 20 }).default("present").notNull(),
  notes: text("notes"),
  source: varchar("source", { length: 20 }).default("web").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({
  id: true,
  createdAt: true,
  totalHours: true,
});
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

export const timeOffRequests = pgTable("time_off_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 30 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  daysRequested: integer("days_requested").notNull().default(1),
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

export const ptoPolicies = pgTable("pto_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  companyId: varchar("company_id").references(() => companies.id),
  accrualType: varchar("accrual_type", { length: 30 }).default("annual").notNull(),
  accrualRate: real("accrual_rate").default(15).notNull(),
  yearlyCapHours: real("yearly_cap_hours"),
  carryoverCapHours: real("carryover_cap_hours").default(0),
  waitingPeriodDays: integer("waiting_period_days").default(0).notNull(),
  sickAccrualEnabled: boolean("sick_accrual_enabled").default(true).notNull(),
  sickAccrualRatePerHours: real("sick_accrual_rate_per_hours").default(1).notNull(),
  sickAccrualPerHoursWorked: real("sick_accrual_per_hours_worked").default(30).notNull(),
  sickYearlyCapHours: real("sick_yearly_cap_hours").default(40).notNull(),
  personalDaysPerYear: real("personal_days_per_year").default(5).notNull(),
  holidayPayEnabled: boolean("holiday_pay_enabled").default(true).notNull(),
  holidayPtoDeduction: boolean("holiday_pto_deduction").default(false).notNull(),
  holidayOtExclusion: boolean("holiday_ot_exclusion").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPtoPolicySchema = createInsertSchema(ptoPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPtoPolicy = z.infer<typeof insertPtoPolicySchema>;
export type PtoPolicy = typeof ptoPolicies.$inferSelect;

export const employeePtoSettings = pgTable("employee_pto_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  ptoPolicyId: varchar("pto_policy_id").references(() => ptoPolicies.id),
  vacationBalanceOverride: real("vacation_balance_override"),
  sickBalanceOverride: real("sick_balance_override"),
  personalBalanceOverride: real("personal_balance_override"),
  hireDate: date("hire_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmployeePtoSettingsSchema = createInsertSchema(employeePtoSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmployeePtoSettings = z.infer<typeof insertEmployeePtoSettingsSchema>;
export type EmployeePtoSettings = typeof employeePtoSettings.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: varchar("action", { length: 100 }).notNull(),
  module: varchar("module", { length: 50 }).notNull(),
  targetId: varchar("target_id"),
  targetType: varchar("target_type", { length: 50 }),
  performedBy: varchar("performed_by").references(() => users.id),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const companiesRelations = relations(companies, ({ many }) => ({
  locations: many(locations),
  users: many(users),
  departments: many(departments),
  roles: many(roles),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  company: one(companies, { fields: [locations.companyId], references: [companies.id] }),
  departments: many(departments),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  location: one(locations, { fields: [users.locationId], references: [locations.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  attendanceRecords: many(attendanceRecords),
  timeOffRequests: many(timeOffRequests),
  timeOffBalances: many(timeOffBalances),
  employeePin: one(employeePins, { fields: [users.id], references: [employeePins.userId] }),
  employmentProfile: one(userEmploymentProfiles, { fields: [users.id], references: [userEmploymentProfiles.userId] }),
  userRoles: many(userRoles),
  userPermissionOverrides: many(userPermissionOverrides),
  userAccessScopes: many(userAccessScopes),
  ptoSettings: one(employeePtoSettings, { fields: [users.id], references: [employeePtoSettings.userId] }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  company: one(companies, { fields: [roles.companyId], references: [companies.id] }),
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userPermissionOverrides: many(userPermissionOverrides),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
  company: one(companies, { fields: [userRoles.companyId], references: [companies.id] }),
}));

export const userPermissionOverridesRelations = relations(userPermissionOverrides, ({ one }) => ({
  user: one(users, { fields: [userPermissionOverrides.userId], references: [users.id] }),
  permission: one(permissions, { fields: [userPermissionOverrides.permissionId], references: [permissions.id] }),
}));

export const userAccessScopesRelations = relations(userAccessScopes, ({ one }) => ({
  user: one(users, { fields: [userAccessScopes.userId], references: [users.id] }),
  company: one(companies, { fields: [userAccessScopes.companyId], references: [companies.id] }),
  location: one(locations, { fields: [userAccessScopes.locationId], references: [locations.id] }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  manager: one(users, { fields: [departments.managerId], references: [users.id] }),
  company: one(companies, { fields: [departments.companyId], references: [companies.id] }),
  location: one(locations, { fields: [departments.locationId], references: [locations.id] }),
  kioskDevices: many(kioskDevices),
}));

export const employmentProfilesRelations = relations(userEmploymentProfiles, ({ one }) => ({
  user: one(users, { fields: [userEmploymentProfiles.userId], references: [users.id] }),
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

export const ptoPoliciesRelations = relations(ptoPolicies, ({ one, many }) => ({
  company: one(companies, { fields: [ptoPolicies.companyId], references: [companies.id] }),
  employeePtoSettings: many(employeePtoSettings),
}));

export const employeePtoSettingsRelations = relations(employeePtoSettings, ({ one }) => ({
  user: one(users, { fields: [employeePtoSettings.userId], references: [users.id] }),
  ptoPolicy: one(ptoPolicies, { fields: [employeePtoSettings.ptoPolicyId], references: [ptoPolicies.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  performer: one(users, { fields: [auditLogs.performedBy], references: [users.id] }),
}));
