import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, date, boolean, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  users,
  companies,
  locations,
  locationAddresses,
  departments,
  departmentManagers,
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
  companies as divisions,
  locations,
  locationAddresses,
  departments,
  departmentManagers,
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
  Company as Division,
  InsertCompany,
  InsertCompany as InsertDivision,
  Location,
  InsertLocation,
  LocationAddress,
  InsertLocationAddress,
  Department,
  InsertDepartment,
  DepartmentManager,
  InsertDepartmentManager,
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
  insertCompanySchema as insertDivisionSchema,
  insertLocationSchema,
  insertLocationAddressSchema,
  insertDepartmentSchema,
  insertDepartmentManagerSchema,
  insertRoleSchema,
  insertPermissionSchema,
  insertPolicyTypeSchema,
} from "./models/auth";

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  filePath: varchar("file_path", { length: 1000 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: integer("file_size"),
  status: varchar("status", { length: 20 }).default("uploaded").notNull(),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadedAt: true,
  reviewedBy: true,
  reviewedAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export const documentsRelations = relations(documents, ({ one }) => ({
  employee: one(users, { fields: [documents.employeeId], references: [users.id] }),
  uploader: one(users, { fields: [documents.uploadedBy], references: [users.id] }),
  reviewer: one(users, { fields: [documents.reviewedBy], references: [users.id] }),
}));

export const policies = pgTable("policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  policyTypeId: varchar("policy_type_id").notNull().references(() => policyTypes.id),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPolicySchema = createInsertSchema(policies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type Policy = typeof policies.$inferSelect;

export const policyRules = pgTable("policy_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  policyId: varchar("policy_id").notNull().references(() => policies.id),
  rules: jsonb("rules").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPolicyRuleSchema = createInsertSchema(policyRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPolicyRule = z.infer<typeof insertPolicyRuleSchema>;
export type PolicyRule = typeof policyRules.$inferSelect;

export const policyAssignments = pgTable("policy_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  policyId: varchar("policy_id").notNull().references(() => policies.id),
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id").references(() => departments.id),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPolicyAssignmentSchema = createInsertSchema(policyAssignments).omit({
  id: true,
  createdAt: true,
});
export type InsertPolicyAssignment = z.infer<typeof insertPolicyAssignmentSchema>;
export type PolicyAssignment = typeof policyAssignments.$inferSelect;

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

export const punchLogs = pgTable("punch_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  workDate: date("work_date").notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  breakMinutes: integer("break_minutes").default(0),
  hoursWorked: real("hours_worked"),
  status: varchar("status", { length: 20 }).default("present").notNull(),
  notes: text("notes"),
  source: varchar("source", { length: 20 }).default("web").notNull(),
  approved: boolean("approved").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const attendanceRecords = punchLogs;

export const insertPunchLogSchema = createInsertSchema(punchLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertPunchLog = z.infer<typeof insertPunchLogSchema>;
export type PunchLog = typeof punchLogs.$inferSelect;

export const insertAttendanceRecordSchema = insertPunchLogSchema;
export type InsertAttendanceRecord = InsertPunchLog;
export type AttendanceRecord = PunchLog & {
  userId: string;
  date: string;
  totalHours: number | null;
};

export const attendanceExceptions = pgTable("attendance_exceptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  exceptionDate: date("exception_date").notNull(),
  exceptionTime: timestamp("exception_time"),
  type: varchar("type", { length: 30 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  punchLogId: varchar("punch_log_id").references(() => punchLogs.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceExceptionSchema = createInsertSchema(attendanceExceptions).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNotes: true,
  punchLogId: true,
});
export type InsertAttendanceException = z.infer<typeof insertAttendanceExceptionSchema>;
export type AttendanceException = typeof attendanceExceptions.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id").notNull().references(() => users.id),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  targetId: varchar("target_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  context: jsonb("context"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const timeOffRequests = pgTable("time_off_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 30 }).notNull(),
  requestCategory: varchar("request_category", { length: 20 }).default("time_off").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  daysRequested: integer("days_requested").notNull().default(1),
  daysApproved: integer("days_approved"),
  approvedEndDate: date("approved_end_date"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reason: text("reason"),
  exceedsBalance: boolean("exceeds_balance").default(false).notNull(),
  balanceAtSubmission: integer("balance_at_submission"),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  editedAt: true,
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
  expirationDate: date("expiration_date"),
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

export const companiesRelations = relations(companies, ({ many }) => ({
  locations: many(locations),
  users: many(users),
  departments: many(departments),
  roles: many(roles),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  company: one(companies, { fields: [locations.companyId], references: [companies.id] }),
  departments: many(departments),
  addresses: many(locationAddresses),
}));

export const locationAddressesRelations = relations(locationAddresses, ({ one }) => ({
  location: one(locations, { fields: [locationAddresses.locationId], references: [locations.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  location: one(locations, { fields: [users.locationId], references: [locations.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  punchLogs: many(punchLogs),
  timeOffRequests: many(timeOffRequests),
  timeOffBalances: many(timeOffBalances),
  employeePin: one(employeePins, { fields: [users.id], references: [employeePins.userId] }),
  employmentProfile: one(userEmploymentProfiles, { fields: [users.id], references: [userEmploymentProfiles.userId] }),
  userRoles: many(userRoles),
  userPermissionOverrides: many(userPermissionOverrides),
  userAccessScopes: many(userAccessScopes),
  ptoSettings: one(employeePtoSettings, { fields: [users.id], references: [employeePtoSettings.userId] }),
  attendanceExceptions: many(attendanceExceptions),
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
  company: one(companies, { fields: [departments.companyId], references: [companies.id] }),
  location: one(locations, { fields: [departments.locationId], references: [locations.id] }),
  managers: many(departmentManagers),
  kioskDevices: many(kioskDevices),
}));

export const departmentManagersRelations = relations(departmentManagers, ({ one }) => ({
  department: one(departments, { fields: [departmentManagers.departmentId], references: [departments.id] }),
  user: one(users, { fields: [departmentManagers.userId], references: [users.id] }),
}));

export const employmentProfilesRelations = relations(userEmploymentProfiles, ({ one }) => ({
  user: one(users, { fields: [userEmploymentProfiles.userId], references: [users.id] }),
}));

export const punchLogsRelations = relations(punchLogs, ({ one }) => ({
  employee: one(users, { fields: [punchLogs.employeeId], references: [users.id] }),
}));

export const attendanceExceptionsRelations = relations(attendanceExceptions, ({ one }) => ({
  employee: one(users, { fields: [attendanceExceptions.employeeId], references: [users.id] }),
  reviewer: one(users, { fields: [attendanceExceptions.reviewedBy], references: [users.id] }),
  punchLog: one(punchLogs, { fields: [attendanceExceptions.punchLogId], references: [punchLogs.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }),
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

export const policiesRelations = relations(policies, ({ one, many }) => ({
  company: one(companies, { fields: [policies.companyId], references: [companies.id] }),
  policyType: one(policyTypes, { fields: [policies.policyTypeId], references: [policyTypes.id] }),
  policyRules: many(policyRules),
  policyAssignments: many(policyAssignments),
}));

export const policyRulesRelations = relations(policyRules, ({ one }) => ({
  policy: one(policies, { fields: [policyRules.policyId], references: [policies.id] }),
}));

export const policyAssignmentsRelations = relations(policyAssignments, ({ one }) => ({
  policy: one(policies, { fields: [policyAssignments.policyId], references: [policies.id] }),
  company: one(companies, { fields: [policyAssignments.companyId], references: [companies.id] }),
  location: one(locations, { fields: [policyAssignments.locationId], references: [locations.id] }),
  department: one(departments, { fields: [policyAssignments.departmentId], references: [departments.id] }),
  user: one(users, { fields: [policyAssignments.userId], references: [users.id] }),
}));

export const systemAlerts = pgTable("system_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("medium").notNull(),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  employeeId: varchar("employee_id").references(() => users.id),
  message: text("message").notNull(),
  details: jsonb("details"),
  acknowledgedBy: varchar("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSystemAlertSchema = createInsertSchema(systemAlerts).omit({
  id: true,
  createdAt: true,
  acknowledgedBy: true,
  acknowledgedAt: true,
  resolvedBy: true,
  resolvedAt: true,
});
export type InsertSystemAlert = z.infer<typeof insertSystemAlertSchema>;
export type SystemAlert = typeof systemAlerts.$inferSelect;

export const systemAlertsRelations = relations(systemAlerts, ({ one }) => ({
  employee: one(users, { fields: [systemAlerts.employeeId], references: [users.id] }),
  acknowledger: one(users, { fields: [systemAlerts.acknowledgedBy], references: [users.id] }),
  resolver: one(users, { fields: [systemAlerts.resolvedBy], references: [users.id] }),
}));

export const payrollExports = pgTable("payroll_exports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  exportedAt: timestamp("exported_at"),
  exportedBy: varchar("exported_by").references(() => users.id),
  lockedAt: timestamp("locked_at"),
  lockedBy: varchar("locked_by").references(() => users.id),
  reopenedAt: timestamp("reopened_at"),
  reopenedBy: varchar("reopened_by").references(() => users.id),
  notes: text("notes"),
  recordCount: integer("record_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertPayrollExportSchema = createInsertSchema(payrollExports).omit({
  id: true,
  createdAt: true,
});
export type InsertPayrollExport = z.infer<typeof insertPayrollExportSchema>;
export type PayrollExport = typeof payrollExports.$inferSelect;

export const payrollBatchRecords = pgTable("payroll_batch_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollExportId: varchar("payroll_export_id").notNull().references(() => payrollExports.id),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  punchLogId: varchar("punch_log_id").references(() => punchLogs.id),
  timeOffRequestId: varchar("time_off_request_id").references(() => timeOffRequests.id),
  recordType: varchar("record_type", { length: 20 }).notNull(),
  workDate: date("work_date").notNull(),
  regularHours: real("regular_hours").default(0),
  overtimeHours: real("overtime_hours").default(0),
  ptoHours: real("pto_hours").default(0),
  hasIssues: boolean("has_issues").default(false).notNull(),
  issueDescription: text("issue_description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayrollBatchRecordSchema = createInsertSchema(payrollBatchRecords).omit({
  id: true,
  createdAt: true,
});
export type InsertPayrollBatchRecord = z.infer<typeof insertPayrollBatchRecordSchema>;
export type PayrollBatchRecord = typeof payrollBatchRecords.$inferSelect;

export const payrollAdjustments = pgTable("payroll_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollExportId: varchar("payroll_export_id").notNull().references(() => payrollExports.id),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  punchLogId: varchar("punch_log_id").references(() => punchLogs.id),
  adjustmentDate: date("adjustment_date").notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayrollAdjustmentSchema = createInsertSchema(payrollAdjustments).omit({
  id: true,
  createdAt: true,
});
export type InsertPayrollAdjustment = z.infer<typeof insertPayrollAdjustmentSchema>;
export type PayrollAdjustment = typeof payrollAdjustments.$inferSelect;

export const payrollExportsRelations = relations(payrollExports, ({ one, many }) => ({
  company: one(companies, { fields: [payrollExports.companyId], references: [companies.id] }),
  exporter: one(users, { fields: [payrollExports.exportedBy], references: [users.id] }),
  creator: one(users, { fields: [payrollExports.createdBy], references: [users.id] }),
  batchRecords: many(payrollBatchRecords),
  adjustments: many(payrollAdjustments),
}));

export const payrollBatchRecordsRelations = relations(payrollBatchRecords, ({ one }) => ({
  payrollExport: one(payrollExports, { fields: [payrollBatchRecords.payrollExportId], references: [payrollExports.id] }),
  employee: one(users, { fields: [payrollBatchRecords.employeeId], references: [users.id] }),
  punchLog: one(punchLogs, { fields: [payrollBatchRecords.punchLogId], references: [punchLogs.id] }),
  timeOffRequest: one(timeOffRequests, { fields: [payrollBatchRecords.timeOffRequestId], references: [timeOffRequests.id] }),
}));

export const payrollAdjustmentsRelations = relations(payrollAdjustments, ({ one }) => ({
  payrollExport: one(payrollExports, { fields: [payrollAdjustments.payrollExportId], references: [payrollExports.id] }),
  employee: one(users, { fields: [payrollAdjustments.employeeId], references: [users.id] }),
  punchLog: one(punchLogs, { fields: [payrollAdjustments.punchLogId], references: [punchLogs.id] }),
}));

export const employeeSchedules = pgTable("employee_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(),
  endTime: varchar("end_time", { length: 5 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const insertEmployeeScheduleSchema = createInsertSchema(employeeSchedules).omit({
  id: true,
});
export type InsertEmployeeSchedule = z.infer<typeof insertEmployeeScheduleSchema>;
export type EmployeeSchedule = typeof employeeSchedules.$inferSelect;

export const employeeSchedulesRelations = relations(employeeSchedules, ({ one }) => ({
  employee: one(users, { fields: [employeeSchedules.employeeId], references: [users.id] }),
}));
