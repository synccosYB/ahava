import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, date, boolean, real, jsonb, unique, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  users,
  companies,
  locations,
  locationCompanies,
  locationAddresses,
  departments,
  departmentManagers,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  userPermissionOverrides,
  userAccessScopes,
  employeeDepartments,
  employeeLocations,
  policyTypes,
} from "./models/auth";

export {
  users,
  sessions,
  companies,
  companies as divisions,
  locations,
  locationCompanies,
  locationAddresses,
  departments,
  departmentManagers,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  userPermissionOverrides,
  userAccessScopes,
  employeeDepartments,
  employeeLocations,
  policyTypes,
  passwordResetTokens,
  normalizeEmail,
  userDepartmentIds,
  userLocationIds,
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
  LocationCompany,
  InsertLocationCompany,
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
  EmployeeDepartment,
  InsertEmployeeDepartment,
  EmployeeLocation,
  InsertEmployeeLocation,
  PolicyType,
  InsertPolicyType,
  PasswordResetToken,
  InsertPasswordResetToken,
} from "./models/auth";
export {
  insertCompanySchema,
  insertCompanySchema as insertDivisionSchema,
  insertLocationSchema,
  insertLocationCompanySchema,
  insertLocationAddressSchema,
  insertDepartmentSchema,
  insertDepartmentManagerSchema,
  insertEmployeeDepartmentSchema,
  insertEmployeeLocationSchema,
  insertRoleSchema,
  insertPermissionSchema,
  insertPolicyTypeSchema,
  insertPasswordResetTokenSchema,
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

export const payrollDocuments = pgTable("payroll_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  documentCategory: varchar("document_category", { length: 30 }).notNull(),
  documentName: varchar("document_name", { length: 500 }).notNull(),
  payPeriod: varchar("pay_period", { length: 100 }).notNull(),
  grossPay: real("gross_pay"),
  netPay: real("net_pay"),
  fileName: varchar("file_name", { length: 500 }),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertPayrollDocumentSchema = createInsertSchema(payrollDocuments).omit({
  id: true,
  uploadedAt: true,
});
export type InsertPayrollDocument = z.infer<typeof insertPayrollDocumentSchema>;
export type PayrollDocument = typeof payrollDocuments.$inferSelect;

export const payrollDocumentsRelations = relations(payrollDocuments, ({ one }) => ({
  employee: one(users, { fields: [payrollDocuments.employeeId], references: [users.id] }),
  uploader: one(users, { fields: [payrollDocuments.uploadedBy], references: [users.id] }),
}));

export const policies = pgTable("policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  policyTypeId: varchar("policy_type_id").notNull().references(() => policyTypes.id),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  version: integer("version").default(1).notNull(),
  isSystemDefault: boolean("is_system_default").default(false).notNull(),
  requiresAcknowledgment: boolean("requires_acknowledgment").default(false).notNull(),
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
  roleId: varchar("role_id").references(() => roles.id),
  employmentType: varchar("employment_type", { length: 30 }),
  payType: varchar("pay_type", { length: 20 }),
  effectiveDate: timestamp("effective_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

const baseInsertPolicyAssignmentSchema = createInsertSchema(policyAssignments).omit({
  id: true,
  createdAt: true,
});

export const POLICY_ASSIGNMENT_TARGET_FIELDS = [
  "companyId",
  "locationId",
  "departmentId",
  "userId",
  "roleId",
  "employmentType",
  "payType",
] as const;

export const POLICY_ASSIGNMENT_EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "per_diem"] as const;
export const POLICY_ASSIGNMENT_PAY_TYPES = ["hourly", "daily", "salary"] as const;

export const insertPolicyAssignmentSchema = baseInsertPolicyAssignmentSchema.superRefine((val, ctx) => {
  const set = POLICY_ASSIGNMENT_TARGET_FIELDS.filter(
    (k) => val[k] !== null && val[k] !== undefined && val[k] !== ""
  );
  if (set.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one assignment target must be set (companyId, locationId, departmentId, userId, roleId, employmentType, or payType).",
    });
  } else if (set.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Only one assignment target may be set per row. Got: ${set.join(", ")}`,
    });
  }
  if (
    val.employmentType &&
    !(POLICY_ASSIGNMENT_EMPLOYMENT_TYPES as readonly string[]).includes(val.employmentType)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["employmentType"],
      message: `employmentType must be one of: ${POLICY_ASSIGNMENT_EMPLOYMENT_TYPES.join(", ")}`,
    });
  }
  if (
    val.payType &&
    !(POLICY_ASSIGNMENT_PAY_TYPES as readonly string[]).includes(val.payType)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payType"],
      message: `payType must be one of: ${POLICY_ASSIGNMENT_PAY_TYPES.join(", ")}`,
    });
  }
});

export type InsertPolicyAssignment = z.infer<typeof insertPolicyAssignmentSchema>;
export type PolicyAssignment = typeof policyAssignments.$inferSelect;

export const policyAcknowledgments = pgTable("policy_acknowledgments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  policyId: varchar("policy_id").notNull().references(() => policies.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  policyVersion: integer("policy_version").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
}, (table) => ({
  uniqueAck: unique("policy_acknowledgments_unique").on(table.policyId, table.userId, table.policyVersion),
}));

export const insertPolicyAcknowledgmentSchema = createInsertSchema(policyAcknowledgments).omit({
  id: true,
  acknowledgedAt: true,
});
export type InsertPolicyAcknowledgment = z.infer<typeof insertPolicyAcknowledgmentSchema>;
export type PolicyAcknowledgment = typeof policyAcknowledgments.$inferSelect;

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
  taxClassification: varchar("tax_classification", { length: 10 }).default("W-2").notNull(),
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
  roundedClockIn: timestamp("rounded_clock_in"),
  roundedClockOut: timestamp("rounded_clock_out"),
  breakMinutes: integer("break_minutes").default(0),
  hoursWorked: real("hours_worked"),
  status: varchar("status", { length: 20 }).default("present").notNull(),
  notes: text("notes"),
  source: varchar("source", { length: 20 }).default("web").notNull(),
  kioskDeviceId: varchar("kiosk_device_id"),
  punchLatitude: real("punch_latitude"),
  punchLongitude: real("punch_longitude"),
  approved: boolean("approved").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("punch_logs_employee_work_date_idx").on(table.employeeId, table.workDate),
  index("punch_logs_work_date_idx").on(table.workDate),
  // Task #315: at most one open punch (clock-in with no clock-out) per
  // employee, enforced by the database so a clock-in race can't create two.
  uniqueIndex("idx_punch_logs_one_open_per_employee")
    .on(table.employeeId)
    .where(sql`${table.clockOut} IS NULL AND ${table.clockIn} IS NOT NULL`),
]);

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
  wasCorrected?: boolean;
  kioskDeviceName?: string | null;
  kiosk?: { id: string; name: string } | null;
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
  reopenRequestedBy: varchar("reopen_requested_by").references(() => users.id),
  reopenRequestedAt: timestamp("reopen_requested_at"),
  reopenMessage: text("reopen_message"),
  reopenStatus: varchar("reopen_status", { length: 20 }),
  reopenDecidedBy: varchar("reopen_decided_by").references(() => users.id),
  reopenDecidedAt: timestamp("reopen_decided_at"),
  reopenDecisionNote: text("reopen_decision_note"),
  reopenConsumedAt: timestamp("reopen_consumed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  employeeDateStatusIdx: index("attendance_exceptions_employee_date_status_idx").on(
    t.employeeId,
    t.exceptionDate,
    t.status,
  ),
}));

export const insertAttendanceExceptionSchema = createInsertSchema(attendanceExceptions).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNotes: true,
  punchLogId: true,
  reopenRequestedBy: true,
  reopenRequestedAt: true,
  reopenMessage: true,
  reopenStatus: true,
  reopenDecidedBy: true,
  reopenDecidedAt: true,
  reopenDecisionNote: true,
  reopenConsumedAt: true,
});
export type InsertAttendanceException = z.infer<typeof insertAttendanceExceptionSchema>;
export type AttendanceException = typeof attendanceExceptions.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  targetId: varchar("target_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  context: jsonb("context"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  actorIdx: index("audit_logs_actor_user_id_idx").on(t.actorUserId),
  targetIdx: index("audit_logs_target_id_idx").on(t.targetId),
  createdAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
}));

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
  hoursRequested: real("hours_requested").notNull().default(8),
  hoursApproved: real("hours_approved"),
  approvedEndDate: date("approved_end_date"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reason: text("reason"),
  exceedsBalance: boolean("exceeds_balance").default(false).notNull(),
  balanceAtSubmission: real("balance_at_submission"),
  exceedsMaxConsecutive: boolean("exceeds_max_consecutive").default(false).notNull(),
  maxConsecutiveAtSubmission: real("max_consecutive_at_submission"),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  userStartDateIdx: index("time_off_requests_user_start_date_idx").on(t.userId, t.startDate),
}));

// Maximum hours a single time-off request can plausibly span. A standard
// full-time year is ~2080 work hours, so anything above this cap is treated as
// corrupt/garbage input (see task #230 — `hours_requested`/`hours_approved` are
// `real` columns, and a single absurd row was poisoning the running balance
// calculation with values like `4.25e+37`).
//
// Task #235 mirrors this cap at the DB level via CHECK constraints
// `time_off_requests_hours_requested_check` and
// `time_off_requests_hours_approved_check` (migration 0042). If this value
// changes, ship a follow-up migration that drops + re-adds those constraints
// with the new bound.
export const MAX_TIME_OFF_HOURS_PER_REQUEST = 2000;

export function isSaneTimeOffHours(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_TIME_OFF_HOURS_PER_REQUEST
  );
}

const timeOffHoursField = z
  .number()
  .finite("Hours must be a finite number")
  .positive("Hours must be greater than zero")
  .max(
    MAX_TIME_OFF_HOURS_PER_REQUEST,
    `Hours must be ${MAX_TIME_OFF_HOURS_PER_REQUEST} or less`,
  );

export const insertTimeOffRequestSchema = createInsertSchema(timeOffRequests).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  editedAt: true,
}).extend({
  hoursRequested: timeOffHoursField,
  hoursApproved: timeOffHoursField.nullable().optional(),
});
export type InsertTimeOffRequest = z.infer<typeof insertTimeOffRequestSchema>;
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;

export const timeOffBalances = pgTable("time_off_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 30 }).notNull(),
  totalHours: integer("total_hours").default(0).notNull(),
  usedHours: integer("used_hours").default(0).notNull(),
  year: integer("year").notNull(),
});

export const insertTimeOffBalanceSchema = createInsertSchema(timeOffBalances).omit({
  id: true,
});
export type InsertTimeOffBalance = z.infer<typeof insertTimeOffBalanceSchema>;
export type TimeOffBalance = typeof timeOffBalances.$inferSelect;

export type TimeOffBalanceBucket = {
  total: number;
  used: number;
  remaining: number;
};

export type TimeOffBalanceDetailed = {
  vacation: TimeOffBalanceBucket;
  sick: TimeOffBalanceBucket;
  personal: TimeOffBalanceBucket;
};

export type PtoPolicyInfo = {
  hasPolicy: boolean;
  policyName?: string | null;
  accrualType?: "annual" | "per_pay_period" | "per_hours_worked" | null;
  accrualHoursPerYear?: number | null;
  vacationAccrualPerHoursWorked?: number | null;
  vacationAccrualHoursPerThreshold?: number | null;
  yearlyCapHours?: number | null;
  carryoverCapHours?: number | null;
  hoursWorkedThisYear?: number;
  earnedThisYear?: number;
  hasOverride?: boolean;
  vacationHoursOverride?: number | null;
  waitingPeriod?: {
    active: boolean;
    daysRemaining?: number;
    endDate?: string | null;
  } | null;
};

export const BALANCE_TRACKED_TIME_OFF_TYPES = ["vacation", "sick", "personal"] as const;
export type BalanceTrackedTimeOffType = (typeof BALANCE_TRACKED_TIME_OFF_TYPES)[number];

export function isBalanceTrackedTimeOffType(type: string): type is BalanceTrackedTimeOffType {
  return (BALANCE_TRACKED_TIME_OFF_TYPES as readonly string[]).includes(type);
}

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
  pairingCode: varchar("pairing_code", { length: 16 }),
  pairingCodeExpiresAt: timestamp("pairing_code_expires_at"),
  pairedAt: timestamp("paired_at"),
  status: varchar("status", { length: 20 }).default("unpaired").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKioskDeviceSchema = createInsertSchema(kioskDevices).omit({
  id: true,
  createdAt: true,
  lastHeartbeat: true,
  pairingCode: true,
  pairingCodeExpiresAt: true,
  pairedAt: true,
  status: true,
});
export type InsertKioskDevice = z.infer<typeof insertKioskDeviceSchema>;
export type KioskDevice = typeof kioskDevices.$inferSelect;

export const ptoPolicies = pgTable("pto_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  companyId: varchar("company_id").references(() => companies.id),
  accrualType: varchar("accrual_type", { length: 30 }).default("annual").notNull(),
  accrualHoursPerYear: real("accrual_hours_per_year").default(120).notNull(),
  yearlyCapHours: real("yearly_cap_hours"),
  carryoverCapHours: real("carryover_cap_hours").default(0),
  waitingPeriodDays: integer("waiting_period_days").default(0).notNull(),
  sickAccrualEnabled: boolean("sick_accrual_enabled").default(true).notNull(),
  sickAccrualRatePerHours: real("sick_accrual_rate_per_hours").default(1).notNull(),
  sickAccrualPerHoursWorked: real("sick_accrual_per_hours_worked").default(30).notNull(),
  sickYearlyCapHours: real("sick_yearly_cap_hours").default(40).notNull(),
  vacationAccrualPerHoursWorked: real("vacation_accrual_per_hours_worked").default(30).notNull(),
  vacationAccrualHoursPerThreshold: real("vacation_accrual_hours_per_threshold").default(1).notNull(),
  personalHoursPerYear: real("personal_hours_per_year").default(40).notNull(),
  holidayPayEnabled: boolean("holiday_pay_enabled").default(true).notNull(),
  holidayPtoDeduction: boolean("holiday_pto_deduction").default(false).notNull(),
  holidayOtExclusion: boolean("holiday_ot_exclusion").default(true).notNull(),
  expirationDate: date("expiration_date"),
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPtoPolicySchema = createInsertSchema(ptoPolicies)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .superRefine((data, ctx) => {
    if (data.accrualType === "per_hours_worked") {
      const perHours = (data as { vacationAccrualPerHoursWorked?: number }).vacationAccrualPerHoursWorked;
      const earned = (data as { vacationAccrualHoursPerThreshold?: number }).vacationAccrualHoursPerThreshold;
      if (perHours === undefined || perHours === null || !Number.isFinite(perHours) || perHours <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vacationAccrualPerHoursWorked"],
          message: "Hours worked per accrual must be a number greater than 0 when accrual type is per_hours_worked",
        });
      }
      if (earned === undefined || earned === null || !Number.isFinite(earned) || earned < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vacationAccrualHoursPerThreshold"],
          message: "PTO hours earned per threshold must be a number greater than or equal to 0 when accrual type is per_hours_worked",
        });
      }
    }
  });
export type InsertPtoPolicy = z.infer<typeof insertPtoPolicySchema>;
export type PtoPolicy = typeof ptoPolicies.$inferSelect;

export const employeePtoSettings = pgTable("employee_pto_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id),
  ptoPolicyId: varchar("pto_policy_id").references(() => ptoPolicies.id),
  vacationHoursOverride: real("vacation_hours_override"),
  sickHoursOverride: real("sick_hours_override"),
  personalHoursOverride: real("personal_hours_override"),
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
  companies: many(locationCompanies),
}));

export const locationCompaniesRelations = relations(locationCompanies, ({ one }) => ({
  location: one(locations, { fields: [locationCompanies.locationId], references: [locations.id] }),
  company: one(companies, { fields: [locationCompanies.companyId], references: [companies.id] }),
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
  employeeDepartments: many(employeeDepartments),
  employeeLocations: many(employeeLocations),
}));

export const employeeDepartmentsRelations = relations(employeeDepartments, ({ one }) => ({
  user: one(users, { fields: [employeeDepartments.userId], references: [users.id] }),
  department: one(departments, { fields: [employeeDepartments.departmentId], references: [departments.id] }),
}));

export const employeeLocationsRelations = relations(employeeLocations, ({ one }) => ({
  user: one(users, { fields: [employeeLocations.userId], references: [users.id] }),
  location: one(locations, { fields: [employeeLocations.locationId], references: [locations.id] }),
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
  punchLog: one(punchLogs, {
    fields: [attendanceExceptions.punchLogId],
    references: [punchLogs.id],
  }),
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
  bonusAmount: real("bonus_amount").default(0).notNull(),
  bonusHours: real("bonus_hours").default(0).notNull(),
  bonusDescription: text("bonus_description"),
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

export const workflows = pgTable("workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  policyTypeId: varchar("policy_type_id").references(() => policyTypes.id),
  triggerType: varchar("trigger_type", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  nodeGraph: jsonb("node_graph").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowSchema = createInsertSchema(workflows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflows.$inferSelect;

export const scheduleTemplates = pgTable("schedule_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  companyId: varchar("company_id").references(() => companies.id),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScheduleTemplateSchema = createInsertSchema(scheduleTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduleTemplate = z.infer<typeof insertScheduleTemplateSchema>;
export type ScheduleTemplate = typeof scheduleTemplates.$inferSelect;

export const scheduleTemplateDays = pgTable("schedule_template_days", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => scheduleTemplates.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull().default("09:00"),
  endTime: varchar("end_time", { length: 5 }).notNull().default("17:00"),
  isWorkDay: boolean("is_work_day").default(true).notNull(),
}, (table) => [
  unique("schedule_template_day_unique").on(table.templateId, table.dayOfWeek),
]);

export const insertScheduleTemplateDaySchema = createInsertSchema(scheduleTemplateDays).omit({
  id: true,
});
export type InsertScheduleTemplateDay = z.infer<typeof insertScheduleTemplateDaySchema>;
export type ScheduleTemplateDay = typeof scheduleTemplateDays.$inferSelect;

export const scheduleTemplatesRelations = relations(scheduleTemplates, ({ many }) => ({
  days: many(scheduleTemplateDays),
}));

export const scheduleTemplateDaysRelations = relations(scheduleTemplateDays, ({ one }) => ({
  template: one(scheduleTemplates, { fields: [scheduleTemplateDays.templateId], references: [scheduleTemplates.id] }),
}));

export const employeeSchedules = pgTable("employee_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(),
  endTime: varchar("end_time", { length: 5 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  scheduleTemplateId: varchar("schedule_template_id").references(() => scheduleTemplates.id, { onDelete: "set null" }),
});

export const insertEmployeeScheduleSchema = createInsertSchema(employeeSchedules).omit({
  id: true,
});
export type InsertEmployeeSchedule = z.infer<typeof insertEmployeeScheduleSchema>;
export type EmployeeSchedule = typeof employeeSchedules.$inferSelect;

export const employeeSchedulesRelations = relations(employeeSchedules, ({ one }) => ({
  employee: one(users, { fields: [employeeSchedules.employeeId], references: [users.id] }),
}));

export const roleAssignmentRules = pgTable("role_assignment_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  conditions: jsonb("conditions").notNull(),
  targetRole: varchar("target_role", { length: 20 }).notNull(),
  priority: integer("priority").default(100).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("role_assignment_rules_active_priority_idx").on(table.isActive, table.priority),
]);

export const insertRoleAssignmentRuleSchema = createInsertSchema(roleAssignmentRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRoleAssignmentRule = z.infer<typeof insertRoleAssignmentRuleSchema>;
export type RoleAssignmentRule = typeof roleAssignmentRules.$inferSelect;

// ===== Flexible lifecycle template helper types =====
export type DueRule =
  | { kind: "none" }
  | { kind: "relative"; days: number; anchor?: "hire_date" | "start_date" | "termination_date" }
  | { kind: "absolute"; date: string }
  | { kind: "end_of_section"; days?: number };

export type CustomFieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export const dueRuleSchema: z.ZodType<DueRule> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("relative"), days: z.number().int(), anchor: z.enum(["hire_date", "start_date", "termination_date"]).optional() }),
  z.object({ kind: z.literal("absolute"), date: z.string() }),
  z.object({ kind: z.literal("end_of_section"), days: z.number().int().optional() }),
]);

export const customFieldDefSchema: z.ZodType<CustomFieldDef> = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "number", "date", "select", "checkbox"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

export const onboardingTemplates = pgTable("onboarding_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertOnboardingTemplateSchema = createInsertSchema(onboardingTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOnboardingTemplate = z.infer<typeof insertOnboardingTemplateSchema>;
export type OnboardingTemplate = typeof onboardingTemplates.$inferSelect;

export const onboardingTemplateSections = pgTable("onboarding_template_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => onboardingTemplates.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertOnboardingTemplateSectionSchema = createInsertSchema(onboardingTemplateSections).omit({ id: true, createdAt: true });
export type InsertOnboardingTemplateSection = z.infer<typeof insertOnboardingTemplateSectionSchema>;
export type OnboardingTemplateSection = typeof onboardingTemplateSections.$inferSelect;

export const onboardingTemplateScopes = pgTable("onboarding_template_scopes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => onboardingTemplates.id, { onDelete: "cascade" }),
  scopeKind: varchar("scope_kind", { length: 30 }).notNull(),
  scopeRef: varchar("scope_ref", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertOnboardingTemplateScopeSchema = createInsertSchema(onboardingTemplateScopes).omit({ id: true, createdAt: true });
export type InsertOnboardingTemplateScope = z.infer<typeof insertOnboardingTemplateScopeSchema>;
export type OnboardingTemplateScope = typeof onboardingTemplateScopes.$inferSelect;

export const onboardingTemplateTasks = pgTable("onboarding_template_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => onboardingTemplates.id, { onDelete: "cascade" }),
  sectionId: varchar("section_id").references(() => onboardingTemplateSections.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  instructions: text("instructions"),
  category: varchar("category", { length: 100 }).default("paperwork").notNull(),
  taskType: varchar("task_type", { length: 30 }).default("checkbox").notNull(),
  ownerKind: varchar("owner_kind", { length: 20 }).default("role").notNull(),
  ownerRole: varchar("owner_role", { length: 30 }).default("hr").notNull(),
  ownerUserId: varchar("owner_user_id").references(() => users.id),
  ownerDepartmentId: varchar("owner_department_id").references(() => departments.id),
  isRequired: boolean("is_required").default(true).notNull(),
  documentType: varchar("document_type", { length: 50 }),
  linkUrl: varchar("link_url", { length: 500 }),
  dueOffsetDays: integer("due_offset_days").default(0).notNull(),
  dueRule: jsonb("due_rule").$type<DueRule | null>(),
  customFields: jsonb("custom_fields").$type<CustomFieldDef[] | null>(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOnboardingTemplateTaskSchema = createInsertSchema(onboardingTemplateTasks).omit({
  id: true,
  createdAt: true,
});
export type InsertOnboardingTemplateTask = z.infer<typeof insertOnboardingTemplateTaskSchema>;
export type OnboardingTemplateTask = typeof onboardingTemplateTasks.$inferSelect;

export const onboardingChecklists = pgTable("onboarding_checklists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  templateId: varchar("template_id").references(() => onboardingTemplates.id),
  status: varchar("status", { length: 20 }).default("in_progress").notNull(),
  hireDate: date("hire_date"),
  startedAt: timestamp("started_at").defaultNow(),
  startedBy: varchar("started_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: varchar("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
}, (t) => ({
  employeeIdx: index("idx_onb_checklists_employee").on(t.employeeId),
  statusIdx: index("idx_onb_checklists_status").on(t.status),
  employeeStatusIdx: index("idx_onb_checklists_employee_status").on(t.employeeId, t.status),
  uniqEmployeeInProgress: uniqueIndex("uniq_onb_checklist_employee_in_progress")
    .on(t.employeeId)
    .where(sql`status = 'in_progress'`),
}));

export const insertOnboardingChecklistSchema = createInsertSchema(onboardingChecklists).omit({
  id: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
});
export type InsertOnboardingChecklist = z.infer<typeof insertOnboardingChecklistSchema>;
export type OnboardingChecklist = typeof onboardingChecklists.$inferSelect;

export const onboardingTasks = pgTable("onboarding_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistId: varchar("checklist_id").notNull().references(() => onboardingChecklists.id, { onDelete: "cascade" }),
  templateTaskId: varchar("template_task_id").references(() => onboardingTemplateTasks.id),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  instructions: text("instructions"),
  category: varchar("category", { length: 100 }).default("paperwork").notNull(),
  sectionTitle: varchar("section_title", { length: 200 }),
  sectionSortOrder: integer("section_sort_order").default(0).notNull(),
  taskType: varchar("task_type", { length: 30 }).default("checkbox").notNull(),
  ownerKind: varchar("owner_kind", { length: 20 }).default("role").notNull(),
  ownerRole: varchar("owner_role", { length: 30 }).default("hr").notNull(),
  ownerUserId: varchar("owner_user_id").references(() => users.id),
  ownerDepartmentId: varchar("owner_department_id").references(() => departments.id),
  isRequired: boolean("is_required").default(true).notNull(),
  documentType: varchar("document_type", { length: 50 }),
  linkUrl: varchar("link_url", { length: 500 }),
  attachmentUrl: varchar("attachment_url", { length: 500 }),
  customFields: jsonb("custom_fields").$type<CustomFieldDef[] | null>(),
  responseValue: jsonb("response_value").$type<Record<string, unknown> | null>(),
  dueDate: date("due_date"),
  sortOrder: integer("sort_order").default(0).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  notes: text("notes"),
  skippedReason: text("skipped_reason"),
  documentId: varchar("document_id").references(() => documents.id),
  completedBy: varchar("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOnboardingTaskSchema = createInsertSchema(onboardingTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  completedBy: true,
});
export type InsertOnboardingTask = z.infer<typeof insertOnboardingTaskSchema>;
export type OnboardingTask = typeof onboardingTasks.$inferSelect;

export const onboardingTemplatesRelations = relations(onboardingTemplates, ({ many, one }) => ({
  company: one(companies, { fields: [onboardingTemplates.companyId], references: [companies.id] }),
  tasks: many(onboardingTemplateTasks),
}));

export const onboardingTemplateTasksRelations = relations(onboardingTemplateTasks, ({ one }) => ({
  template: one(onboardingTemplates, { fields: [onboardingTemplateTasks.templateId], references: [onboardingTemplates.id] }),
  section: one(onboardingTemplateSections, { fields: [onboardingTemplateTasks.sectionId], references: [onboardingTemplateSections.id] }),
}));
export const onboardingTemplateSectionsRelations = relations(onboardingTemplateSections, ({ one, many }) => ({
  template: one(onboardingTemplates, { fields: [onboardingTemplateSections.templateId], references: [onboardingTemplates.id] }),
  tasks: many(onboardingTemplateTasks),
}));
export const onboardingTemplateScopesRelations = relations(onboardingTemplateScopes, ({ one }) => ({
  template: one(onboardingTemplates, { fields: [onboardingTemplateScopes.templateId], references: [onboardingTemplates.id] }),
}));

export const onboardingChecklistsRelations = relations(onboardingChecklists, ({ one, many }) => ({
  employee: one(users, { fields: [onboardingChecklists.employeeId], references: [users.id] }),
  template: one(onboardingTemplates, { fields: [onboardingChecklists.templateId], references: [onboardingTemplates.id] }),
  tasks: many(onboardingTasks),
}));

export const onboardingTasksRelations = relations(onboardingTasks, ({ one }) => ({
  checklist: one(onboardingChecklists, { fields: [onboardingTasks.checklistId], references: [onboardingChecklists.id] }),
}));

export const offboardingTemplates = pgTable("offboarding_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertOffboardingTemplateSchema = createInsertSchema(offboardingTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOffboardingTemplate = z.infer<typeof insertOffboardingTemplateSchema>;
export type OffboardingTemplate = typeof offboardingTemplates.$inferSelect;

export const offboardingTemplateSections = pgTable("offboarding_template_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => offboardingTemplates.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertOffboardingTemplateSectionSchema = createInsertSchema(offboardingTemplateSections).omit({ id: true, createdAt: true });
export type InsertOffboardingTemplateSection = z.infer<typeof insertOffboardingTemplateSectionSchema>;
export type OffboardingTemplateSection = typeof offboardingTemplateSections.$inferSelect;

export const offboardingTemplateScopes = pgTable("offboarding_template_scopes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => offboardingTemplates.id, { onDelete: "cascade" }),
  scopeKind: varchar("scope_kind", { length: 30 }).notNull(),
  scopeRef: varchar("scope_ref", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertOffboardingTemplateScopeSchema = createInsertSchema(offboardingTemplateScopes).omit({ id: true, createdAt: true });
export type InsertOffboardingTemplateScope = z.infer<typeof insertOffboardingTemplateScopeSchema>;
export type OffboardingTemplateScope = typeof offboardingTemplateScopes.$inferSelect;

export const offboardingTemplateTasks = pgTable("offboarding_template_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => offboardingTemplates.id, { onDelete: "cascade" }),
  sectionId: varchar("section_id").references(() => offboardingTemplateSections.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  instructions: text("instructions"),
  category: varchar("category", { length: 100 }).default("access").notNull(),
  taskType: varchar("task_type", { length: 30 }).default("checkbox").notNull(),
  ownerKind: varchar("owner_kind", { length: 20 }).default("role").notNull(),
  ownerRole: varchar("owner_role", { length: 30 }).default("hr").notNull(),
  ownerUserId: varchar("owner_user_id").references(() => users.id),
  ownerDepartmentId: varchar("owner_department_id").references(() => departments.id),
  isRequired: boolean("is_required").default(true).notNull(),
  blocksDeactivation: boolean("blocks_deactivation").default(false).notNull(),
  linkUrl: varchar("link_url", { length: 500 }),
  dueOffsetDays: integer("due_offset_days").default(0).notNull(),
  dueRule: jsonb("due_rule").$type<DueRule | null>(),
  customFields: jsonb("custom_fields").$type<CustomFieldDef[] | null>(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOffboardingTemplateTaskSchema = createInsertSchema(offboardingTemplateTasks).omit({
  id: true,
  createdAt: true,
});
export type InsertOffboardingTemplateTask = z.infer<typeof insertOffboardingTemplateTaskSchema>;
export type OffboardingTemplateTask = typeof offboardingTemplateTasks.$inferSelect;

export const offboardingChecklists = pgTable("offboarding_checklists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  templateId: varchar("template_id").references(() => offboardingTemplates.id),
  status: varchar("status", { length: 20 }).default("in_progress").notNull(),
  terminationDate: date("termination_date").notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  startedBy: varchar("started_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  accountDeactivatedAt: timestamp("account_deactivated_at"),
  accountDeactivatedBy: varchar("account_deactivated_by").references(() => users.id),
}, (t) => ({
  employeeIdx: index("idx_off_checklists_employee").on(t.employeeId),
  statusIdx: index("idx_off_checklists_status").on(t.status),
  employeeStatusIdx: index("idx_off_checklists_employee_status").on(t.employeeId, t.status),
  uniqEmployeeInProgress: uniqueIndex("uniq_off_checklist_employee_in_progress")
    .on(t.employeeId)
    .where(sql`status = 'in_progress'`),
}));

export const insertOffboardingChecklistSchema = createInsertSchema(offboardingChecklists).omit({
  id: true,
  startedAt: true,
  completedAt: true,
  accountDeactivatedAt: true,
  accountDeactivatedBy: true,
});
export type InsertOffboardingChecklist = z.infer<typeof insertOffboardingChecklistSchema>;
export type OffboardingChecklist = typeof offboardingChecklists.$inferSelect;

export const offboardingTasks = pgTable("offboarding_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistId: varchar("checklist_id").notNull().references(() => offboardingChecklists.id, { onDelete: "cascade" }),
  templateTaskId: varchar("template_task_id").references(() => offboardingTemplateTasks.id),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  instructions: text("instructions"),
  category: varchar("category", { length: 100 }).default("access").notNull(),
  sectionTitle: varchar("section_title", { length: 200 }),
  sectionSortOrder: integer("section_sort_order").default(0).notNull(),
  taskType: varchar("task_type", { length: 30 }).default("checkbox").notNull(),
  ownerKind: varchar("owner_kind", { length: 20 }).default("role").notNull(),
  ownerRole: varchar("owner_role", { length: 30 }).default("hr").notNull(),
  ownerUserId: varchar("owner_user_id").references(() => users.id),
  ownerDepartmentId: varchar("owner_department_id").references(() => departments.id),
  isRequired: boolean("is_required").default(true).notNull(),
  blocksDeactivation: boolean("blocks_deactivation").default(false).notNull(),
  linkUrl: varchar("link_url", { length: 500 }),
  attachmentUrl: varchar("attachment_url", { length: 500 }),
  customFields: jsonb("custom_fields").$type<CustomFieldDef[] | null>(),
  responseValue: jsonb("response_value").$type<Record<string, unknown> | null>(),
  dueDate: date("due_date"),
  sortOrder: integer("sort_order").default(0).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  notes: text("notes"),
  skippedReason: text("skipped_reason"),
  completedBy: varchar("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOffboardingTaskSchema = createInsertSchema(offboardingTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  completedBy: true,
});
export type InsertOffboardingTask = z.infer<typeof insertOffboardingTaskSchema>;
export type OffboardingTask = typeof offboardingTasks.$inferSelect;

export const offboardingTemplatesRelations = relations(offboardingTemplates, ({ many, one }) => ({
  company: one(companies, { fields: [offboardingTemplates.companyId], references: [companies.id] }),
  tasks: many(offboardingTemplateTasks),
}));

export const offboardingTemplateTasksRelations = relations(offboardingTemplateTasks, ({ one }) => ({
  template: one(offboardingTemplates, { fields: [offboardingTemplateTasks.templateId], references: [offboardingTemplates.id] }),
  section: one(offboardingTemplateSections, { fields: [offboardingTemplateTasks.sectionId], references: [offboardingTemplateSections.id] }),
}));
export const offboardingTemplateSectionsRelations = relations(offboardingTemplateSections, ({ one, many }) => ({
  template: one(offboardingTemplates, { fields: [offboardingTemplateSections.templateId], references: [offboardingTemplates.id] }),
  tasks: many(offboardingTemplateTasks),
}));
export const offboardingTemplateScopesRelations = relations(offboardingTemplateScopes, ({ one }) => ({
  template: one(offboardingTemplates, { fields: [offboardingTemplateScopes.templateId], references: [offboardingTemplates.id] }),
}));

export const offboardingChecklistsRelations = relations(offboardingChecklists, ({ one, many }) => ({
  employee: one(users, { fields: [offboardingChecklists.employeeId], references: [users.id] }),
  template: one(offboardingTemplates, { fields: [offboardingChecklists.templateId], references: [offboardingTemplates.id] }),
  tasks: many(offboardingTasks),
}));

export const offboardingTasksRelations = relations(offboardingTasks, ({ one }) => ({
  checklist: one(offboardingChecklists, { fields: [offboardingTasks.checklistId], references: [offboardingChecklists.id] }),
}));

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type", { length: 64 }).notNull(),
  payload: jsonb("payload"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  error: text("error"),
  attempts: integer("attempts").default(0).notNull(),
  startedAt: timestamp("started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  startedAt: true,
  attempts: true,
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

// Per-job-type health/monitoring aggregate. One row per recurring job type,
// upserted every time a job of that type runs. Surfaces last run / last success
// / last failure / retry count / last error so silent job failures (auto
// clock-out, biometric retention, stale punches) become visible to admins.
export const jobStatus = pgTable("job_status", {
  type: varchar("type", { length: 64 }).primaryKey(),
  lastRunAt: timestamp("last_run_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  lastError: text("last_error"),
  retryCount: integer("retry_count").default(0).notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  totalRuns: integer("total_runs").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type JobStatus = typeof jobStatus.$inferSelect;

export const ptoAnniversaryAdjustments = pgTable(
  "pto_anniversary_adjustments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    employeeId: varchar("employee_id").notNull().references(() => users.id),
    effectiveDate: date("effective_date").notNull(),
    oldAccrualRate: real("old_accrual_rate"),
    newAccrualRate: real("new_accrual_rate").notNull(),
    oldTierLabel: varchar("old_tier_label", { length: 100 }),
    newTierLabel: varchar("new_tier_label", { length: 100 }),
    yearsOfService: integer("years_of_service").notNull(),
    hoursAdded: real("hours_added").notNull(),
    ptoPolicyId: varchar("pto_policy_id").references(() => ptoPolicies.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("pto_anniversary_adjustments_employee_effective_unique").on(
      table.employeeId,
      table.effectiveDate,
    ),
  ],
);

export const insertPtoAnniversaryAdjustmentSchema = createInsertSchema(
  ptoAnniversaryAdjustments,
).omit({
  id: true,
  createdAt: true,
});
export type InsertPtoAnniversaryAdjustment = z.infer<typeof insertPtoAnniversaryAdjustmentSchema>;
export type PtoAnniversaryAdjustment = typeof ptoAnniversaryAdjustments.$inferSelect;

export const ptoAnniversaryAdjustmentsRelations = relations(
  ptoAnniversaryAdjustments,
  ({ one }) => ({
    employee: one(users, {
      fields: [ptoAnniversaryAdjustments.employeeId],
      references: [users.id],
    }),
    ptoPolicy: one(ptoPolicies, {
      fields: [ptoAnniversaryAdjustments.ptoPolicyId],
      references: [ptoPolicies.id],
    }),
  }),
);

export const performanceReviewCycles = pgTable("performance_review_cycles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: varchar("name", { length: 200 }).notNull(),
  cadence: varchar("cadence", { length: 30 }).notNull(),
  anchor: varchar("anchor", { length: 30 }).notNull(),
  leadTimes: jsonb("lead_times").$type<number[]>().default(sql`'[14,7,0]'::jsonb`).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPerformanceReviewCycleSchema = createInsertSchema(
  performanceReviewCycles,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  cadence: z.enum(["annual", "semi_annual", "quarterly", "new_hire_90"]),
  anchor: z.enum(["hire_date", "calendar_year"]),
  leadTimes: z.array(z.number().int().min(0)).optional(),
});
export type InsertPerformanceReviewCycle = z.infer<typeof insertPerformanceReviewCycleSchema>;
export type PerformanceReviewCycle = typeof performanceReviewCycles.$inferSelect;

export const performanceReviewCyclesRelations = relations(
  performanceReviewCycles,
  ({ one, many }) => ({
    company: one(companies, {
      fields: [performanceReviewCycles.companyId],
      references: [companies.id],
    }),
    reminders: many(performanceReviewReminders),
  }),
);

export const performanceReviewReminders = pgTable(
  "performance_review_reminders",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    employeeId: varchar("employee_id").notNull().references(() => users.id),
    cycleId: varchar("cycle_id").notNull().references(() => performanceReviewCycles.id),
    dueDate: date("due_date").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    completedBy: varchar("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("performance_review_reminders_employee_cycle_due_unique").on(
      table.employeeId,
      table.cycleId,
      table.dueDate,
    ),
  ],
);

export const insertPerformanceReviewReminderSchema = createInsertSchema(
  performanceReviewReminders,
).omit({
  id: true,
  createdAt: true,
  completedBy: true,
  completedAt: true,
});
export type InsertPerformanceReviewReminder = z.infer<typeof insertPerformanceReviewReminderSchema>;
export type PerformanceReviewReminder = typeof performanceReviewReminders.$inferSelect;

export const performanceReviewRemindersRelations = relations(
  performanceReviewReminders,
  ({ one }) => ({
    employee: one(users, {
      fields: [performanceReviewReminders.employeeId],
      references: [users.id],
    }),
    cycle: one(performanceReviewCycles, {
      fields: [performanceReviewReminders.cycleId],
      references: [performanceReviewCycles.id],
    }),
    completer: one(users, {
      fields: [performanceReviewReminders.completedBy],
      references: [users.id],
    }),
  }),
);
export const REQUIRED_DOCUMENT_TYPE_KEYS = [
  "w9",
  "i9",
  "direct_deposit",
  "emergency_contact",
  "handbook_ack",
] as const;
export type RequiredDocumentTypeKey = (typeof REQUIRED_DOCUMENT_TYPE_KEYS)[number];

export const certifications = pgTable("certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  issuer: varchar("issuer", { length: 200 }),
  issueDate: date("issue_date"),
  expirationDate: date("expiration_date"),
  documentId: varchar("document_id").references(() => documents.id),
  notes: text("notes"),
  status: varchar("status", { length: 20 }).default("valid").notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// Biometric Kiosk (Phase 1) — Face Recognition + Consent + Governance
// All face descriptors are stored ENCRYPTED. No raw images are ever stored.
// ============================================================================

export const biometricSettings = pgTable("biometric_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Singleton row identified by `key = 'global'` to allow future multi-tenant rows.
  key: varchar("key", { length: 32 }).notNull().unique().default("global"),
  featureEnabled: boolean("feature_enabled").default(false).notNull(),
  faceEnabled: boolean("face_enabled").default(false).notNull(),
  // Tiered confidence thresholds (1.0 - euclidean distance, where 1.0 = identical).
  thresholdAutoApprove: real("threshold_auto_approve").default(0.90).notNull(),
  thresholdReview: real("threshold_review").default(0.75).notNull(),
  thresholdReject: real("threshold_reject").default(0.60).notNull(),
  requiredSampleCount: integer("required_sample_count").default(3).notNull(),
  minSamplesPerEnrollment: integer("min_samples_per_enrollment").default(3).notNull(),
  maxSamplesPerEnrollment: integer("max_samples_per_enrollment").default(5).notNull(),
  livenessRequired: boolean("liveness_required").default(true).notNull(),
  maxAttemptsBeforeLockout: integer("max_attempts_before_lockout").default(5).notNull(),
  lockoutDurationMinutes: integer("lockout_duration_minutes").default(10).notNull(),
  supervisorOverrideRequiresPin: boolean("supervisor_override_requires_pin").default(true).notNull(),
  matchTimeoutMs: integer("match_timeout_ms").default(3000).notNull(),
  defaultRetentionDays: integer("default_retention_days").default(180).notNull(),
  supervisorOverrideThreshold: integer("supervisor_override_threshold").default(3).notNull(),
  allowNonKioskEnrollment: boolean("allow_non_kiosk_enrollment").default(false).notNull(),
  encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by").references(() => users.id),
});

export const insertBiometricSettingsSchema = createInsertSchema(biometricSettings).omit({
  id: true,
  updatedAt: true,
});
export type BiometricSettings = typeof biometricSettings.$inferSelect;
export type InsertBiometricSettings = z.infer<typeof insertBiometricSettingsSchema>;

export const biometricLegalProfiles = pgTable("biometric_legal_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  consentText: text("consent_text").notNull(),
  consentVersion: integer("consent_version").default(1).notNull(),
  retentionDays: integer("retention_days").default(180).notNull(),
  // Profile-level enable: even if global flag is on, a disabled profile blocks face for its scope.
  isEnabled: boolean("is_enabled").default(false).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCertificationSchema = createInsertSchema(certifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertBiometricLegalProfileSchema = createInsertSchema(biometricLegalProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCertification = z.infer<typeof insertCertificationSchema>;
export type Certification = typeof certifications.$inferSelect;

export const certificationsRelations = relations(certifications, ({ one }) => ({
  employee: one(users, { fields: [certifications.employeeId], references: [users.id] }),
  document: one(documents, { fields: [certifications.documentId], references: [documents.id] }),
  creator: one(users, { fields: [certifications.createdBy], references: [users.id] }),
}));

export const requiredDocumentRules = pgTable("required_document_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  scopeType: varchar("scope_type", { length: 20 }).notNull(),
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id").references(() => departments.id),
  employeeId: varchar("employee_id").references(() => users.id),
  dueOffsetDays: integer("due_offset_days").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRequiredDocumentRuleSchema = createInsertSchema(requiredDocumentRules).omit({
  id: true,
  createdAt: true,
});
export type InsertRequiredDocumentRule = z.infer<typeof insertRequiredDocumentRuleSchema>;
export type RequiredDocumentRule = typeof requiredDocumentRules.$inferSelect;

export const requiredDocumentRulesRelations = relations(requiredDocumentRules, ({ one }) => ({
  company: one(companies, { fields: [requiredDocumentRules.companyId], references: [companies.id] }),
  location: one(locations, { fields: [requiredDocumentRules.locationId], references: [locations.id] }),
  department: one(departments, { fields: [requiredDocumentRules.departmentId], references: [departments.id] }),
  employee: one(users, { fields: [requiredDocumentRules.employeeId], references: [users.id] }),
}));

export type BiometricLegalProfile = typeof biometricLegalProfiles.$inferSelect;
export type InsertBiometricLegalProfile = z.infer<typeof insertBiometricLegalProfileSchema>;

export const biometricLegalProfileScopes = pgTable("biometric_legal_profile_scopes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").notNull().references(() => biometricLegalProfiles.id, { onDelete: "cascade" }),
  // Either companyId or locationId may be set; null/null means "fallback (Default profile)".
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBiometricLegalProfileScopeSchema = createInsertSchema(biometricLegalProfileScopes).omit({
  id: true,
  createdAt: true,
});
export type BiometricLegalProfileScope = typeof biometricLegalProfileScopes.$inferSelect;
export type InsertBiometricLegalProfileScope = z.infer<typeof insertBiometricLegalProfileScopeSchema>;

export const biometricConsents = pgTable("biometric_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  legalProfileId: varchar("legal_profile_id").notNull().references(() => biometricLegalProfiles.id),
  consentVersion: integer("consent_version").notNull(),
  consentTextSnapshot: text("consent_text_snapshot").notNull(),
  acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
  acceptedIp: varchar("accepted_ip", { length: 64 }),
  acceptedUserAgent: text("accepted_user_agent"),
  revokedAt: timestamp("revoked_at"),
  revokedBy: varchar("revoked_by").references(() => users.id),
  revokedReason: text("revoked_reason"),
  legalHold: boolean("legal_hold").default(false).notNull(),
}, (table) => ({
  userIdx: index("biometric_consents_user_idx").on(table.userId),
}));

export const insertBiometricConsentSchema = createInsertSchema(biometricConsents).omit({
  id: true,
  acceptedAt: true,
  revokedAt: true,
});
export type BiometricConsent = typeof biometricConsents.$inferSelect;
export type InsertBiometricConsent = z.infer<typeof insertBiometricConsentSchema>;

export const biometricTemplates = pgTable("biometric_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Extensible: 'face' for Phase 1, 'fingerprint' future. Per-user-per-type uniqueness enforced below.
  type: varchar("type", { length: 20 }).notNull(),
  // Strict company isolation — matching ALWAYS scopes by this column.
  companyId: varchar("company_id").references(() => companies.id),
  // Encrypted payload (AES-256-GCM): base64(iv || authTag || ciphertext) of the JSON-encoded
  // descriptor array (or array of arrays for multi-sample). NEVER stored in cleartext.
  encryptedTemplate: text("encrypted_template").notNull(),
  encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
  sampleCount: integer("sample_count").default(1).notNull(),
  enrolledKioskId: varchar("enrolled_kiosk_id").references(() => kioskDevices.id),
  enrolledByUserId: varchar("enrolled_by_user_id").references(() => users.id),
  lastMatchedAt: timestamp("last_matched_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userTypeIdx: unique("biometric_templates_user_type_unique").on(table.userId, table.type),
  companyTypeIdx: index("biometric_templates_company_type_idx").on(table.companyId, table.type),
}));

export const insertBiometricTemplateSchema = createInsertSchema(biometricTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMatchedAt: true,
});
export type BiometricTemplate = typeof biometricTemplates.$inferSelect;
export type InsertBiometricTemplate = z.infer<typeof insertBiometricTemplateSchema>;

export const biometricAttempts = pgTable("biometric_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type", { length: 20 }).default("face").notNull(),
  // Attempt may not match a candidate; candidateUserId is nullable.
  candidateUserId: varchar("candidate_user_id").references(() => users.id),
  kioskDeviceId: varchar("kiosk_device_id").references(() => kioskDevices.id),
  companyId: varchar("company_id").references(() => companies.id),
  outcome: varchar("outcome", { length: 32 }).notNull(),
  // Score in [0,1]. Null when no candidate / camera failed / liveness failed before match.
  confidence: real("confidence"),
  livenessPassed: boolean("liveness_passed"),
  fallbackUsed: varchar("fallback_used", { length: 32 }),
  consecutiveFailureCount: integer("consecutive_failure_count").default(0).notNull(),
  // Optional context: detection error code, light-level, user-agent — NEVER includes any descriptor or image.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("biometric_attempts_created_at_idx").on(table.createdAt),
  kioskIdx: index("biometric_attempts_kiosk_idx").on(table.kioskDeviceId),
  candidateIdx: index("biometric_attempts_candidate_idx").on(table.candidateUserId),
  outcomeIdx: index("biometric_attempts_outcome_idx").on(table.outcome),
}));

export const insertBiometricAttemptSchema = createInsertSchema(biometricAttempts).omit({
  id: true,
  createdAt: true,
});
export type BiometricAttempt = typeof biometricAttempts.$inferSelect;
export type InsertBiometricAttempt = z.infer<typeof insertBiometricAttemptSchema>;

export const biometricSupervisorOverrides = pgTable("biometric_supervisor_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supervisorUserId: varchar("supervisor_user_id").notNull().references(() => users.id),
  employeeUserId: varchar("employee_user_id").notNull().references(() => users.id),
  kioskDeviceId: varchar("kiosk_device_id").references(() => kioskDevices.id),
  punchType: varchar("punch_type", { length: 16 }).notNull(),
  reason: text("reason"),
  priorFailedAttempts: integer("prior_failed_attempts").default(0).notNull(),
  punchLogId: varchar("punch_log_id").references(() => punchLogs.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("biometric_overrides_created_at_idx").on(table.createdAt),
}));

export const insertBiometricSupervisorOverrideSchema = createInsertSchema(biometricSupervisorOverrides).omit({
  id: true,
  createdAt: true,
});
export type BiometricSupervisorOverride = typeof biometricSupervisorOverrides.$inferSelect;
export type InsertBiometricSupervisorOverride = z.infer<typeof insertBiometricSupervisorOverrideSchema>;

export const biometricLegalProfilesRelations = relations(biometricLegalProfiles, ({ many }) => ({
  scopes: many(biometricLegalProfileScopes),
  consents: many(biometricConsents),
}));

export const biometricLegalProfileScopesRelations = relations(biometricLegalProfileScopes, ({ one }) => ({
  profile: one(biometricLegalProfiles, {
    fields: [biometricLegalProfileScopes.profileId],
    references: [biometricLegalProfiles.id],
  }),
  company: one(companies, {
    fields: [biometricLegalProfileScopes.companyId],
    references: [companies.id],
  }),
  location: one(locations, {
    fields: [biometricLegalProfileScopes.locationId],
    references: [locations.id],
  }),
}));

export const biometricTemplatesRelations = relations(biometricTemplates, ({ one }) => ({
  user: one(users, { fields: [biometricTemplates.userId], references: [users.id] }),
  company: one(companies, { fields: [biometricTemplates.companyId], references: [companies.id] }),
  enrolledKiosk: one(kioskDevices, {
    fields: [biometricTemplates.enrolledKioskId],
    references: [kioskDevices.id],
  }),
}));

export const biometricConsentsRelations = relations(biometricConsents, ({ one }) => ({
  user: one(users, { fields: [biometricConsents.userId], references: [users.id] }),
  legalProfile: one(biometricLegalProfiles, {
    fields: [biometricConsents.legalProfileId],
    references: [biometricLegalProfiles.id],
  }),
}));

export const biometricAttemptsRelations = relations(biometricAttempts, ({ one }) => ({
  candidate: one(users, { fields: [biometricAttempts.candidateUserId], references: [users.id] }),
  kiosk: one(kioskDevices, { fields: [biometricAttempts.kioskDeviceId], references: [kioskDevices.id] }),
}));

export const biometricSupervisorOverridesRelations = relations(biometricSupervisorOverrides, ({ one }) => ({
  supervisor: one(users, {
    fields: [biometricSupervisorOverrides.supervisorUserId],
    references: [users.id],
  }),
  employee: one(users, {
    fields: [biometricSupervisorOverrides.employeeUserId],
    references: [users.id],
  }),
  kiosk: one(kioskDevices, {
    fields: [biometricSupervisorOverrides.kioskDeviceId],
    references: [kioskDevices.id],
  }),
  punchLog: one(punchLogs, {
    fields: [biometricSupervisorOverrides.punchLogId],
    references: [punchLogs.id],
  }),
}));
