import crypto from "crypto";
import {
  type User,
  type UpsertUser,
  normalizeEmail,
  users,
  companies,
  type Company,
  type InsertCompany,
  locations,
  type Location,
  type InsertLocation,
  locationCompanies,
  type LocationCompany,
  locationAddresses,
  type LocationAddress,
  type InsertLocationAddress,
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
  attendanceChangeLedger,
  type AttendanceChangeLedger,
  timeOffRequests,
  type TimeOffRequest,
  type InsertTimeOffRequest,
  timeOffBalances,
  type TimeOffBalance,
  type InsertTimeOffBalance,
  type TimeOffBalanceDetailed,
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
  employeeDepartments,
  employeeLocations,
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
  policyAcknowledgments,
  type PolicyAcknowledgment,
  type InsertPolicyAcknowledgment,
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
  payrollDocuments,
  type PayrollDocument,
  type InsertPayrollDocument,
  employeeSchedules,
  type EmployeeSchedule,
  type InsertEmployeeSchedule,
  workflows,
  type Workflow,
  type InsertWorkflow,
  ptoAnniversaryAdjustments,
  type PtoAnniversaryAdjustment,
  type InsertPtoAnniversaryAdjustment,
  performanceReviewCycles,
  type PerformanceReviewCycle,
  type InsertPerformanceReviewCycle,
  performanceReviewReminders,
  type PerformanceReviewReminder,
  type InsertPerformanceReviewReminder,
  roleAssignmentRules,
  type RoleAssignmentRule,
  type InsertRoleAssignmentRule,
  scheduleTemplates,
  type ScheduleTemplate,
  type InsertScheduleTemplate,
  scheduleTemplateDays,
  type ScheduleTemplateDay,
  type InsertScheduleTemplateDay,
  certifications,
  type Certification,
  type InsertCertification,
  requiredDocumentRules,
  type RequiredDocumentRule,
  type InsertRequiredDocumentRule,
  onboardingTemplates,
  type OnboardingTemplate,
  type InsertOnboardingTemplate,
  onboardingTemplateSections,
  type OnboardingTemplateSection,
  type InsertOnboardingTemplateSection,
  onboardingTemplateScopes,
  type OnboardingTemplateScope,
  type InsertOnboardingTemplateScope,
  onboardingTemplateTasks,
  type OnboardingTemplateTask,
  type InsertOnboardingTemplateTask,
  onboardingChecklists,
  type OnboardingChecklist,
  type InsertOnboardingChecklist,
  onboardingTasks,
  type OnboardingTask,
  type InsertOnboardingTask,
  offboardingTemplates,
  type OffboardingTemplate,
  type InsertOffboardingTemplate,
  offboardingTemplateSections,
  type OffboardingTemplateSection,
  type InsertOffboardingTemplateSection,
  offboardingTemplateScopes,
  type OffboardingTemplateScope,
  type InsertOffboardingTemplateScope,
  offboardingTemplateTasks,
  type OffboardingTemplateTask,
  type InsertOffboardingTemplateTask,
  offboardingChecklists,
  type OffboardingChecklist,
  type InsertOffboardingChecklist,
  offboardingTasks,
  type OffboardingTask,
  type InsertOffboardingTask,
  biometricSettings,
  type BiometricSettings,
  type InsertBiometricSettings,
  biometricLegalProfiles,
  type BiometricLegalProfile,
  type InsertBiometricLegalProfile,
  biometricLegalProfileScopes,
  type BiometricLegalProfileScope,
  type InsertBiometricLegalProfileScope,
  biometricConsents,
  type BiometricConsent,
  type InsertBiometricConsent,
  biometricTemplates,
  type BiometricTemplate,
  type InsertBiometricTemplate,
  biometricAttempts,
  type BiometricAttempt,
  type InsertBiometricAttempt,
  biometricSupervisorOverrides,
  type BiometricSupervisorOverride,
  type InsertBiometricSupervisorOverride,
  isSaneTimeOffHours,
  MAX_TIME_OFF_HOURS_PER_REQUEST,
  userDepartmentIds,
  userLocationIds,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, ilike, gte, lte, desc, ne, count, sql, inArray, isNull, isNotNull, type SQL } from "drizzle-orm";
import {
  CORRECTION_COUNT_TYPES,
  CORRECTION_COUNT_WINDOW_DAYS,
  DEFAULT_PAY_PERIOD_TYPE,
  emptyCorrectionCountSummary,
  getCurrentMonthStart,
  getCurrentPayPeriodStart,
  getCurrentWeekStart,
  getCurrentYearStart,
  type CorrectionCountBucket,
  type CorrectionCountSummary,
  type PayPeriodType,
} from "@shared/correctionCounts";
import { getEffectivePolicy, buildPtoPolicyFromRules } from "./policyEngine";
import { resolvePayCalcPolicy, splitDailyHours, DEFAULT_PAY_CALC_POLICY } from "./payrollEngine";
import { computeBreakElapsedMinutes } from "./punchHours";

export type AttendanceRecord = PunchLog;
export type InsertAttendanceRecord = InsertPunchLog;

export interface ClockInOptions {
  status?: string;
  kioskDeviceId?: string;
  punchLatitude?: number | null;
  punchLongitude?: number | null;
}

// Result of a start/end break action. `ok: false` carries a machine-readable
// reason the route maps to a friendly 4xx (no open shift / already on break /
// not on break) so break logic never leaks HTTP concerns into storage.
export type BreakActionResult =
  | { ok: true; punch: PunchLog; elapsedMinutes: number }
  | { ok: false; reason: "not_clocked_in" | "already_on_break" | "not_on_break" };

// Thrown when a clock-in would create a second open punch for an employee.
// Routes map this to a 409 ("You're already clocked in.") instead of a 500.
export class DuplicateOpenPunchError extends Error {
  readonly status = 409;
  constructor(message = "You're already clocked in.") {
    super(message);
    this.name = "DuplicateOpenPunchError";
  }
}

// Postgres unique-violation code, plus the name of the partial unique index
// that enforces "one open punch per employee" (migration 0048).
const PG_UNIQUE_VIOLATION = "23505";
export const OPEN_PUNCH_UNIQUE_INDEX = "idx_punch_logs_one_open_per_employee";

// Kiosk/supervisor PINs are stored as a peppered keyed hash, never plaintext,
// so a database or backup read cannot recover them. HMAC (a keyed hash) keeps
// the PIN->employee lookup an O(1) exact match while making the stored value
// useless without the server-side pepper. Because PINs are low-entropy (4-6
// digits), the pepper's secrecy plus request rate-limiting are what defend
// against brute force. The pepper falls back to the app's JWT/session secret,
// which is mandatory in production (see getJwtSecret / getSession).
function getPinPepper(): string {
  const pepper =
    process.env.PIN_PEPPER || process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!pepper) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PIN_PEPPER (or JWT_SECRET/SESSION_SECRET) must be set in production to hash employee PINs",
      );
    }
    return "dev-pin-pepper-not-for-production";
  }
  return pepper;
}

function hashPin(pin: string): string {
  return crypto.createHmac("sha256", getPinPepper()).update(String(pin).trim()).digest("hex");
}

function isOpenPunchUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string } | null;
  if (!e || e.code !== PG_UNIQUE_VIOLATION) return false;
  return (
    e.constraint === OPEN_PUNCH_UNIQUE_INDEX ||
    (e.message?.includes(OPEN_PUNCH_UNIQUE_INDEX) ?? false)
  );
}

export interface UsersPageOptions {
  search?: string;
  departmentId?: string;
  locationId?: string;
  companyId?: string;
  taxClass?: string;
  // "none" = users with no certifications; any other value = users with at
  // least one certification of that status.
  certStatus?: string;
  excludeUserIds?: string[];
  limit: number;
  offset: number;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersPage(opts: UsersPageOptions): Promise<{ rows: User[]; total: number }>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserDepartment(id: string, departmentId: string): Promise<User | undefined>;
  getUserDepartmentIds(userId: string): Promise<string[]>;
  getUserLocationIds(userId: string): Promise<string[]>;
  getEmployeeGeofencedAddresses(userId: string): Promise<LocationAddress[]>;
  setUserDepartmentIds(userId: string, departmentIds: string[]): Promise<string[]>;
  setUserLocationIds(userId: string, locationIds: string[]): Promise<string[]>;

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
  getLocationCompanyIds(locationId: string): Promise<string[]>;
  getLocationCompanyIdsMap(locationIds: string[]): Promise<Record<string, string[]>>;
  setLocationCompanyIds(locationId: string, companyIds: string[]): Promise<string[]>;

  getLocationAddresses(locationId: string): Promise<LocationAddress[]>;
  getLocationAddress(id: string): Promise<LocationAddress | undefined>;
  createLocationAddress(address: InsertLocationAddress): Promise<LocationAddress>;
  updateLocationAddress(id: string, address: Partial<InsertLocationAddress>): Promise<LocationAddress | undefined>;
  deleteLocationAddress(id: string): Promise<void>;

  getDepartment(id: string): Promise<Department | undefined>;
  getAllDepartments(): Promise<Department[]>;
  getDepartmentsByCompany(companyId: string): Promise<Department[]>;
  getDepartmentsByLocation(locationId: string): Promise<Department[]>;
  createDepartment(dept: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, dept: Partial<InsertDepartment>): Promise<Department | undefined>;
  deleteDepartment(id: string): Promise<void>;

  getEmploymentProfile(userId: string): Promise<EmploymentProfile | undefined>;
  getAllEmploymentProfiles(): Promise<EmploymentProfile[]>;
  getEmploymentProfilesByUserIds(userIds: string[]): Promise<Map<string, EmploymentProfile>>;
  createEmploymentProfile(profile: InsertEmploymentProfile): Promise<EmploymentProfile>;
  updateEmploymentProfile(userId: string, profile: Partial<InsertEmploymentProfile>): Promise<EmploymentProfile | undefined>;

  getPunchLog(id: string): Promise<PunchLog | undefined>;
  getPunchLogsByEmployee(employeeId: string): Promise<PunchLog[]>;
  getPunchLogsByDate(date: string): Promise<PunchLog[]>;
  createPunchLog(record: InsertPunchLog): Promise<PunchLog>;
  updatePunchLog(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined>;
  deletePunchLog(id: string): Promise<PunchLog | undefined>;

  getAttendanceRecord(id: string): Promise<PunchLog | undefined>;
  getAttendanceByUser(userId: string): Promise<PunchLog[]>;
  getAttendanceByDate(date: string): Promise<PunchLog[]>;
  createAttendanceRecord(record: InsertPunchLog): Promise<PunchLog>;
  updateAttendanceRecord(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined>;

  clockIn(userId: string, source?: string, roundedTime?: Date, opts?: ClockInOptions): Promise<PunchLog>;
  clockOut(userId: string): Promise<PunchLog | undefined>;
  startBreak(userId: string): Promise<BreakActionResult>;
  endBreak(userId: string): Promise<BreakActionResult>;
  closeOpenPunch(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined>;
  getCurrentAttendance(userId: string): Promise<PunchLog | undefined>;
  getOpenPunchLogs(): Promise<PunchLog[]>;
  getAttendanceRecords(userId: string, startDate?: string, endDate?: string): Promise<PunchLog[]>;
  getTodayHours(userId: string): Promise<number>;
  getWeekHours(userId: string): Promise<number>;

  getAttendanceException(id: string): Promise<AttendanceException | undefined>;
  getAttendanceExceptionsByEmployee(employeeId: string): Promise<AttendanceException[]>;
  getPendingAttendanceExceptions(): Promise<AttendanceException[]>;
  getAllAttendanceExceptions(): Promise<AttendanceException[]>;
  getAttendanceExceptionsPage(opts: { limit: number; offset: number }): Promise<{ rows: AttendanceException[]; total: number }>;
  getReopenPendingAttendanceExceptions(): Promise<AttendanceException[]>;
  getLatestResolvedAttendanceExceptionForDate(employeeId: string, date: string): Promise<AttendanceException | undefined>;
  createAttendanceException(exception: InsertAttendanceException): Promise<AttendanceException>;
  updateAttendanceException(id: string, data: Partial<AttendanceException>): Promise<AttendanceException | undefined>;
  getCorrectionRequestCounts(
    employeeId: string,
    options?: { excludeId?: string; payPeriodType?: PayPeriodType }
  ): Promise<CorrectionCountSummary>;
  getCorrectionRequestCountsBulk(
    employeeIds: string[],
    options?: { payPeriodTypeByEmployee?: Map<string, PayPeriodType> }
  ): Promise<Map<string, CorrectionCountSummary>>;

  createAuditLog(entry: InsertAuditLog): Promise<AuditLog>;

  getTimeOffRequest(id: string): Promise<TimeOffRequest | undefined>;
  getTimeOffRequestsByUser(userId: string): Promise<TimeOffRequest[]>;
  getPendingTimeOffRequests(): Promise<TimeOffRequest[]>;
  getAllTimeOffRequests(): Promise<TimeOffRequest[]>;
  createTimeOffRequest(request: InsertTimeOffRequest & { reviewedBy?: string | null; reviewedAt?: Date | null }): Promise<TimeOffRequest>;
  updateTimeOffRequest(id: string, request: Partial<InsertTimeOffRequest & { reviewedBy: string; reviewedAt: Date; editedAt: Date; hoursApproved: number; approvedEndDate: string }>): Promise<TimeOffRequest | undefined>;

  getTimeOffBalance(userId: string, type: string, year: number): Promise<TimeOffBalance | undefined>;
  getTimeOffBalancesByUser(userId: string, year: number): Promise<TimeOffBalance[]>;
  createTimeOffBalance(balance: InsertTimeOffBalance): Promise<TimeOffBalance>;
  updateTimeOffBalance(id: string, balance: Partial<InsertTimeOffBalance>): Promise<TimeOffBalance | undefined>;
  incrementTimeOffBalance(id: string, deltas: { totalHoursDelta?: number; usedHoursDelta?: number }): Promise<TimeOffBalance | undefined>;
  computeTimeOffBalance(userId: string): Promise<{ vacation: number; sick: number; personal: number }>;
  computeTimeOffBalanceDetailed(userId: string): Promise<TimeOffBalanceDetailed>;
  getOverlappingTimeOffRequests(userId: string, startDate: string, endDate: string): Promise<TimeOffRequest[]>;

  getEmployeePin(userId: string): Promise<EmployeePin | undefined>;
  createEmployeePin(pin: InsertEmployeePin): Promise<EmployeePin>;
  updateEmployeePin(userId: string, pin: string): Promise<EmployeePin | undefined>;
  deleteEmployeePin(userId: string): Promise<void>;

  getKioskDevice(id: string): Promise<KioskDevice | undefined>;
  getAllKioskDevices(): Promise<KioskDevice[]>;
  createKioskDevice(device: InsertKioskDevice): Promise<KioskDevice>;
  updateKioskDevice(id: string, device: Partial<KioskDevice>): Promise<KioskDevice | undefined>;
  deleteKioskDevice(id: string): Promise<void>;
  setKioskPairingCode(id: string, code: string, expiresAt: Date): Promise<KioskDevice | undefined>;
  getKioskByPairingCode(code: string): Promise<KioskDevice | undefined>;
  markKioskPaired(id: string): Promise<KioskDevice | undefined>;
  unpairKioskDevice(id: string): Promise<KioskDevice | undefined>;
  updateKioskHeartbeat(id: string): Promise<KioskDevice | undefined>;
  getRecentPunchesByKiosk(deviceId: string, limit: number): Promise<Array<PunchLog & { userId: string; date: string; totalHours: number | null; employeeName: string }>>;
  getKioskPunchTotalsToday(deviceId: string): Promise<{ clockIns: number; clockOuts: number; uniqueEmployees: number }>;

  getUserByPin(pin: string): Promise<User | undefined>;
  searchUsersByName(query: string): Promise<User[]>;
  getLatestAttendanceForUser(userId: string): Promise<PunchLog | undefined>;
  getAttendanceForUserOnDate(userId: string, workDate: string): Promise<PunchLog | undefined>;

  getUsersByDepartment(departmentId: string): Promise<User[]>;
  getUsersByLocation(locationId: string): Promise<User[]>;
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
  getAttendanceAggregatesByDateRange(
    startDate: string,
    endDate: string,
    userIds?: string[],
    now?: Date,
  ): Promise<Map<string, { totalHours: number; daysWorked: number }>>;
  getDailyHoursByDateRange(
    startDate: string,
    endDate: string,
    userIds?: string[],
    now?: Date,
  ): Promise<Map<string, Array<{ workDate: string; hours: number }>>>;
  getTimeOffDaysOffByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
    status?: string,
  ): Promise<Map<string, number>>;
  getTimeOffRequestsByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
    status?: string,
  ): Promise<TimeOffRequest[]>;
  getIncompletePunchesByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
  ): Promise<PunchLog[]>;
  getAttendanceExceptionsByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
    status?: string,
  ): Promise<AttendanceException[]>;

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
  computeTimeOffBalanceDetailed(userId: string): Promise<TimeOffBalanceDetailed>;
  computeTotalHoursWorked(userId: string, year: number, fromDate?: string): Promise<number>;
  computeAnnualVacationEntitlement(userId: string): Promise<number>;

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

  getLocationAddresses(locationId: string): Promise<LocationAddress[]>;
  getLocationAddress(id: string): Promise<LocationAddress | undefined>;
  createLocationAddress(address: InsertLocationAddress): Promise<LocationAddress>;
  updateLocationAddress(id: string, address: Partial<InsertLocationAddress>): Promise<LocationAddress | undefined>;
  deleteLocationAddress(id: string): Promise<void>;

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
  setRolePermissions(roleId: string, permissionIds: string[]): Promise<void>;

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
  deletePolicy(id: string): Promise<void>;

  getPolicyRulesByPolicy(policyId: string): Promise<PolicyRule[]>;
  upsertPolicyRules(policyId: string, rules: Record<string, any>): Promise<PolicyRule>;

  getSelectablePtoPolicies(): Promise<Policy[]>;
  getEmployeePtoAssignment(userId: string): Promise<PolicyAssignment | undefined>;
  getPolicyAssignment(id: string): Promise<PolicyAssignment | undefined>;
  getPolicyAssignmentsByPolicy(policyId: string): Promise<PolicyAssignment[]>;
  getAllPolicyAssignments(): Promise<PolicyAssignment[]>;
  createPolicyAssignment(assignment: InsertPolicyAssignment): Promise<PolicyAssignment>;
  updatePolicyAssignment(id: string, assignment: Partial<InsertPolicyAssignment>): Promise<PolicyAssignment | undefined>;
  deletePolicyAssignment(id: string): Promise<void>;

  getPolicyAcknowledgmentsByUser(userId: string): Promise<PolicyAcknowledgment[]>;
  getPolicyAcknowledgment(policyId: string, userId: string, policyVersion: number): Promise<PolicyAcknowledgment | undefined>;
  createPolicyAcknowledgment(ack: InsertPolicyAcknowledgment): Promise<PolicyAcknowledgment>;

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
  getAuditLogsByUser(userId: string, options?: { limit?: number; offset?: number; startDate?: string; endDate?: string }): Promise<{ logs: AuditLog[]; total: number }>;
  getLedgerEntriesByEmployee(employeeId: string, options?: { category?: string; startDate?: string; endDate?: string; limit?: number; offset?: number }): Promise<{ entries: AttendanceChangeLedger[]; total: number }>;

  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: Partial<UpsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getDocumentsByEmployee(employeeId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  createDocument(doc: InsertDocument): Promise<Document>;
  updateDocument(id: string, data: Partial<Document>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;

  getPayrollDocumentsByEmployee(employeeId: string): Promise<PayrollDocument[]>;
  getAllPayrollDocuments(): Promise<PayrollDocument[]>;
  getPayrollDocument(id: string): Promise<PayrollDocument | undefined>;
  createPayrollDocument(doc: InsertPayrollDocument): Promise<PayrollDocument>;
  deletePayrollDocument(id: string): Promise<void>;

  getEmployeeSchedules(employeeId: string): Promise<EmployeeSchedule[]>;
  getEmployeeScheduleByDay(employeeId: string, dayOfWeek: number): Promise<EmployeeSchedule | undefined>;
  upsertEmployeeSchedule(schedule: InsertEmployeeSchedule): Promise<EmployeeSchedule>;
  deleteEmployeeSchedules(employeeId: string): Promise<void>;

  getWorkflow(id: string): Promise<Workflow | undefined>;
  getAllWorkflows(): Promise<Workflow[]>;
  getWorkflowsByTriggerType(triggerType: string): Promise<Workflow[]>;
  createWorkflow(workflow: InsertWorkflow): Promise<Workflow>;
  updateWorkflow(id: string, workflow: Partial<InsertWorkflow>): Promise<Workflow | undefined>;
  deleteWorkflow(id: string): Promise<void>;

  listPtoAnniversaryAdjustments(employeeId: string): Promise<PtoAnniversaryAdjustment[]>;
  recordPtoAnniversaryAdjustment(data: InsertPtoAnniversaryAdjustment): Promise<PtoAnniversaryAdjustment | undefined>;

  getReviewCycle(id: string): Promise<PerformanceReviewCycle | undefined>;
  getReviewCycles(filters?: { companyId?: string | null; isActive?: boolean }): Promise<PerformanceReviewCycle[]>;
  createReviewCycle(data: InsertPerformanceReviewCycle): Promise<PerformanceReviewCycle>;
  updateReviewCycle(id: string, data: Partial<InsertPerformanceReviewCycle>): Promise<PerformanceReviewCycle | undefined>;
  getReviewReminder(id: string): Promise<PerformanceReviewReminder | undefined>;
  listReviewReminders(filters?: { employeeId?: string; status?: string; cycleId?: string }): Promise<PerformanceReviewReminder[]>;
  upsertReviewReminder(data: InsertPerformanceReviewReminder): Promise<PerformanceReviewReminder>;
  updateReviewReminder(id: string, data: { status: string; completedBy?: string; notes?: string }): Promise<PerformanceReviewReminder | undefined>;
  resolveReviewDueAlertsFor(reminderId: string, resolverUserId: string): Promise<number>;

  getRoleAssignmentRule(id: string): Promise<RoleAssignmentRule | undefined>;
  getAllRoleAssignmentRules(): Promise<RoleAssignmentRule[]>;
  getActiveRoleAssignmentRules(): Promise<RoleAssignmentRule[]>;
  createRoleAssignmentRule(rule: InsertRoleAssignmentRule): Promise<RoleAssignmentRule>;
  updateRoleAssignmentRule(id: string, rule: Partial<InsertRoleAssignmentRule>): Promise<RoleAssignmentRule | undefined>;
  deleteRoleAssignmentRule(id: string): Promise<void>;

  getScheduleTemplate(id: string): Promise<ScheduleTemplate | undefined>;
  getAllScheduleTemplates(): Promise<ScheduleTemplate[]>;
  getScheduleTemplatesByCompany(companyId: string | null): Promise<ScheduleTemplate[]>;
  createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate>;
  updateScheduleTemplate(id: string, template: Partial<InsertScheduleTemplate>): Promise<ScheduleTemplate | undefined>;
  deleteScheduleTemplate(id: string): Promise<void>;

  getScheduleTemplateDays(templateId: string): Promise<ScheduleTemplateDay[]>;
  replaceScheduleTemplateDays(templateId: string, days: Omit<InsertScheduleTemplateDay, "templateId">[]): Promise<ScheduleTemplateDay[]>;
  getAllEmploymentProfiles(): Promise<EmploymentProfile[]>;

  getCertification(id: string): Promise<Certification | undefined>;
  getCertificationsByEmployee(employeeId: string): Promise<Certification[]>;
  getAllCertifications(filters?: { status?: string }): Promise<Certification[]>;
  createCertification(data: InsertCertification): Promise<Certification>;
  updateCertification(id: string, data: Partial<InsertCertification>): Promise<Certification | undefined>;
  deleteCertification(id: string): Promise<void>;

  getRequiredDocumentRule(id: string): Promise<RequiredDocumentRule | undefined>;
  getAllRequiredDocumentRules(filters?: { documentType?: string; isActive?: boolean; scopeType?: string }): Promise<RequiredDocumentRule[]>;
  createRequiredDocumentRule(data: InsertRequiredDocumentRule): Promise<RequiredDocumentRule>;
  updateRequiredDocumentRule(id: string, data: Partial<InsertRequiredDocumentRule>): Promise<RequiredDocumentRule | undefined>;
  deleteRequiredDocumentRule(id: string): Promise<void>;

  // Onboarding templates / tasks / checklists
  getOnboardingTemplate(id: string): Promise<OnboardingTemplate | undefined>;
  getOnboardingTemplates(filters: { companyId?: string | null; isActive?: boolean }): Promise<OnboardingTemplate[]>;
  getDefaultOnboardingTemplate(companyId: string | null): Promise<OnboardingTemplate | undefined>;
  createOnboardingTemplate(data: InsertOnboardingTemplate): Promise<OnboardingTemplate>;
  updateOnboardingTemplate(id: string, data: Partial<InsertOnboardingTemplate>): Promise<OnboardingTemplate | undefined>;
  getOnboardingTemplateTasks(templateId: string): Promise<OnboardingTemplateTask[]>;
  getOnboardingTemplateTask(id: string): Promise<OnboardingTemplateTask | undefined>;
  createOnboardingTemplateTask(data: InsertOnboardingTemplateTask): Promise<OnboardingTemplateTask>;
  updateOnboardingTemplateTask(id: string, data: Partial<InsertOnboardingTemplateTask>): Promise<OnboardingTemplateTask | undefined>;
  deleteOnboardingTemplateTask(id: string): Promise<void>;
  deleteOnboardingTemplate(id: string): Promise<void>;
  duplicateOnboardingTemplate(id: string, actorUserId: string): Promise<OnboardingTemplate | undefined>;
  getOnboardingTemplateSections(templateId: string): Promise<OnboardingTemplateSection[]>;
  createOnboardingTemplateSection(data: InsertOnboardingTemplateSection): Promise<OnboardingTemplateSection>;
  updateOnboardingTemplateSection(id: string, data: Partial<InsertOnboardingTemplateSection>): Promise<OnboardingTemplateSection | undefined>;
  deleteOnboardingTemplateSection(id: string): Promise<void>;
  getOnboardingTemplateScopes(templateId: string): Promise<OnboardingTemplateScope[]>;
  setOnboardingTemplateScopes(templateId: string, scopes: { scopeKind: string; scopeRef: string }[]): Promise<OnboardingTemplateScope[]>;
  suggestOnboardingTemplatesForEmployee(employee: User): Promise<Array<OnboardingTemplate & { matchScore: number; matchReasons: string[] }>>;
  addTaskToOnboardingChecklist(checklistId: string, data: Partial<InsertOnboardingTask> & { title: string }): Promise<OnboardingTask>;
  deleteOnboardingTaskRow(id: string): Promise<void>;

  getOnboardingChecklist(id: string): Promise<OnboardingChecklist | undefined>;
  getOnboardingChecklistByEmployee(employeeId: string): Promise<OnboardingChecklist | undefined>;
  listOnboardingChecklists(filters: { status?: string; employeeIds?: string[] }): Promise<OnboardingChecklist[]>;
  createOnboardingChecklistRow(data: InsertOnboardingChecklist): Promise<OnboardingChecklist>;
  createOnboardingTaskRow(data: InsertOnboardingTask & { completedBy?: string | null; completedAt?: Date | null }): Promise<OnboardingTask>;
  getOnboardingTasks(checklistId: string): Promise<OnboardingTask[]>;
  getOnboardingTask(id: string): Promise<OnboardingTask | undefined>;
  updateOnboardingTask(id: string, data: { status?: string; skippedReason?: string | null; completedBy?: string | null; completedAt?: Date | null; notes?: string | null; documentId?: string | null }): Promise<OnboardingTask | undefined>;
  cancelOnboardingChecklist(id: string, reason: string, actorUserId: string): Promise<OnboardingChecklist | undefined>;
  completeOnboardingChecklistIfFinished(checklistId: string): Promise<OnboardingChecklist | undefined>;
  computeOnboardingProgress(checklistId: string): Promise<{ progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number }>;

  // Offboarding templates / tasks / checklists
  getOffboardingTemplate(id: string): Promise<OffboardingTemplate | undefined>;
  getOffboardingTemplates(filters: { companyId?: string | null; isActive?: boolean }): Promise<OffboardingTemplate[]>;
  getDefaultOffboardingTemplate(companyId: string | null): Promise<OffboardingTemplate | undefined>;
  createOffboardingTemplate(data: InsertOffboardingTemplate): Promise<OffboardingTemplate>;
  updateOffboardingTemplate(id: string, data: Partial<InsertOffboardingTemplate>): Promise<OffboardingTemplate | undefined>;
  getOffboardingTemplateTasks(templateId: string): Promise<OffboardingTemplateTask[]>;
  getOffboardingTemplateTask(id: string): Promise<OffboardingTemplateTask | undefined>;
  createOffboardingTemplateTask(data: InsertOffboardingTemplateTask): Promise<OffboardingTemplateTask>;
  updateOffboardingTemplateTask(id: string, data: Partial<InsertOffboardingTemplateTask>): Promise<OffboardingTemplateTask | undefined>;
  deleteOffboardingTemplateTask(id: string): Promise<void>;
  deleteOffboardingTemplate(id: string): Promise<void>;
  duplicateOffboardingTemplate(id: string, actorUserId: string): Promise<OffboardingTemplate | undefined>;
  getOffboardingTemplateSections(templateId: string): Promise<OffboardingTemplateSection[]>;
  createOffboardingTemplateSection(data: InsertOffboardingTemplateSection): Promise<OffboardingTemplateSection>;
  updateOffboardingTemplateSection(id: string, data: Partial<InsertOffboardingTemplateSection>): Promise<OffboardingTemplateSection | undefined>;
  deleteOffboardingTemplateSection(id: string): Promise<void>;
  getOffboardingTemplateScopes(templateId: string): Promise<OffboardingTemplateScope[]>;
  setOffboardingTemplateScopes(templateId: string, scopes: { scopeKind: string; scopeRef: string }[]): Promise<OffboardingTemplateScope[]>;
  suggestOffboardingTemplatesForEmployee(employee: User): Promise<Array<OffboardingTemplate & { matchScore: number; matchReasons: string[] }>>;
  addTaskToOffboardingChecklist(checklistId: string, data: Partial<InsertOffboardingTask> & { title: string }): Promise<OffboardingTask>;
  deleteOffboardingTaskRow(id: string): Promise<void>;

  getOffboardingChecklist(id: string): Promise<OffboardingChecklist | undefined>;
  getOffboardingChecklistByEmployee(employeeId: string): Promise<OffboardingChecklist | undefined>;
  listOffboardingChecklists(filters: { status?: string; employeeIds?: string[] }): Promise<OffboardingChecklist[]>;
  createOffboardingChecklistRow(data: InsertOffboardingChecklist): Promise<OffboardingChecklist>;
  createOffboardingTaskRow(data: InsertOffboardingTask & { completedBy?: string | null; completedAt?: Date | null }): Promise<OffboardingTask>;
  getOffboardingTasks(checklistId: string): Promise<OffboardingTask[]>;
  getOffboardingTask(id: string): Promise<OffboardingTask | undefined>;
  updateOffboardingTask(id: string, data: { status?: string; skippedReason?: string | null; completedBy?: string | null; completedAt?: Date | null; notes?: string | null }): Promise<OffboardingTask | undefined>;
  setOffboardingChecklistDeactivation(id: string, actorUserId: string): Promise<OffboardingChecklist | undefined>;
  computeOffboardingProgress(checklistId: string): Promise<{ progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number }>;

  setUserDeactivated(userId: string, actorUserId: string): Promise<User | undefined>;
  clearUserDeactivated(userId: string): Promise<User | undefined>;

  // ===== Biometric kiosk =====
  getBiometricSettings(): Promise<BiometricSettings>;
  updateBiometricSettings(patch: Partial<InsertBiometricSettings>, actorUserId: string): Promise<BiometricSettings>;

  getBiometricLegalProfiles(): Promise<BiometricLegalProfile[]>;
  getBiometricLegalProfile(id: string): Promise<BiometricLegalProfile | undefined>;
  createBiometricLegalProfile(profile: InsertBiometricLegalProfile): Promise<BiometricLegalProfile>;
  updateBiometricLegalProfile(id: string, patch: Partial<InsertBiometricLegalProfile>): Promise<BiometricLegalProfile | undefined>;
  deleteBiometricLegalProfile(id: string): Promise<void>;
  getBiometricLegalProfileScopes(profileId?: string): Promise<BiometricLegalProfileScope[]>;
  setBiometricLegalProfileScopes(profileId: string, scopes: { companyId?: string | null; locationId?: string | null }[]): Promise<BiometricLegalProfileScope[]>;

  getBiometricConsent(userId: string): Promise<BiometricConsent | undefined>;
  getActiveBiometricConsent(userId: string): Promise<BiometricConsent | undefined>;
  createBiometricConsent(consent: InsertBiometricConsent): Promise<BiometricConsent>;
  revokeBiometricConsent(userId: string, revokedBy: string, reason: string): Promise<void>;
  setBiometricLegalHold(userId: string, hold: boolean): Promise<void>;

  getBiometricTemplate(userId: string, type: string): Promise<BiometricTemplate | undefined>;
  upsertBiometricTemplate(template: InsertBiometricTemplate): Promise<BiometricTemplate>;
  deleteBiometricTemplate(userId: string, type: string): Promise<void>;
  getBiometricTemplatesByCompanyAndType(companyId: string | null, type: string): Promise<BiometricTemplate[]>;
  touchBiometricTemplateMatched(id: string): Promise<void>;

  recordBiometricAttempt(attempt: InsertBiometricAttempt): Promise<BiometricAttempt>;
  listBiometricAttempts(filters: {
    candidateUserId?: string;
    kioskDeviceId?: string;
    outcome?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<BiometricAttempt[]>;
  countConsecutiveFailures(candidateUserId: string, kioskDeviceId: string | null, since: Date): Promise<number>;
  getBiometricMetrics(since: Date): Promise<{
    total: number;
    byOutcome: Record<string, number>;
    byKiosk: Record<string, { total: number; success: number; rejected: number }>;
    byDay: { day: string; success: number; lowConfidence: number; rejected: number; livenessFail: number; cameraError: number; total: number }[];
    enrollmentsTotal: number;
    overrideCount: number;
  }>;

  recordBiometricSupervisorOverride(row: InsertBiometricSupervisorOverride): Promise<BiometricSupervisorOverride>;
  listBiometricSupervisorOverrides(limit?: number): Promise<BiometricSupervisorOverride[]>;

  getBiometricEnrollmentSummary(): Promise<{
    userId: string;
    userName: string;
    userEmail: string | null;
    templateId: string | null;
    sampleCount: number;
    enrolledAt: Date | null;
    lastMatchedAt: Date | null;
    consentAcceptedAt: Date | null;
    consentRevokedAt: Date | null;
    hasActiveConsent: boolean;
    legalProfileName: string | null;
    legalHold: boolean;
  }[]>;
}

function incrementBucket(
  bucket: CorrectionCountBucket,
  status: "pending" | "approved" | "denied",
): void {
  bucket.total++;
  if (status === "pending") bucket.pending++;
  else if (status === "approved") bucket.approved++;
  else if (status === "denied") bucket.denied++;
}

function tallyCorrectionRow(
  summary: CorrectionCountSummary,
  status: "pending" | "approved" | "denied",
  created: Date,
  windows: {
    payPeriodStart: Date;
    weekStart: Date;
    monthStart: Date;
    yearStart: Date;
    cutoff90: Date;
  },
): void {
  incrementBucket(summary.all, status);
  if (created >= windows.yearStart) incrementBucket(summary.year, status);
  if (created >= windows.monthStart) incrementBucket(summary.month, status);
  if (created >= windows.weekStart) incrementBucket(summary.week, status);
  if (created >= windows.payPeriodStart) incrementBucket(summary.payPeriod, status);
  if (created >= windows.cutoff90) {
    summary.total++;
    if (status === "pending") summary.pending++;
    else if (status === "approved") summary.approved++;
    else if (status === "denied") summary.denied++;
  }
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
  // Attach the many-to-many department/location memberships onto user rows in a
  // single batched pair of queries (avoids N+1). Falls back gracefully: a user
  // with no join rows keeps an empty array, so `userDepartmentIds`/`userLocationIds`
  // can still fall back to the legacy single column for un-migrated rows.
  private async hydrateUsers<T extends User>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;
    const ids = rows.map((u) => u.id);
    const [deptRows, locRows] = await Promise.all([
      db
        .select({ userId: employeeDepartments.userId, departmentId: employeeDepartments.departmentId })
        .from(employeeDepartments)
        .where(inArray(employeeDepartments.userId, ids)),
      db
        .select({ userId: employeeLocations.userId, locationId: employeeLocations.locationId })
        .from(employeeLocations)
        .where(inArray(employeeLocations.userId, ids)),
    ]);
    const deptMap = new Map<string, string[]>();
    for (const r of deptRows) {
      (deptMap.get(r.userId) ?? deptMap.set(r.userId, []).get(r.userId)!).push(r.departmentId);
    }
    const locMap = new Map<string, string[]>();
    for (const r of locRows) {
      (locMap.get(r.userId) ?? locMap.set(r.userId, []).get(r.userId)!).push(r.locationId);
    }
    for (const u of rows) {
      u.departmentIds = deptMap.get(u.id) ?? (u.departmentId ? [u.departmentId] : []);
      u.locationIds = locMap.get(u.id) ?? (u.locationId ? [u.locationId] : []);
    }
    return rows;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return undefined;
    const [hydrated] = await this.hydrateUsers([user]);
    return hydrated;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalized = normalizeEmail(email);
    if (!normalized) return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`);
    if (!user) return undefined;
    const [hydrated] = await this.hydrateUsers([user]);
    return hydrated;
  }

  async getAllUsers(): Promise<User[]> {
    const rows = await db.select().from(users);
    return this.hydrateUsers(rows);
  }

  async getUsersPage(opts: UsersPageOptions): Promise<{ rows: User[]; total: number }> {
    const conditions: SQL[] = [];

    const search = opts.search?.trim();
    if (search) {
      const like = `%${search}%`;
      const nameExpr = sql`lower(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`;
      conditions.push(
        sql`(${nameExpr} like lower(${like}) or lower(coalesce(${users.email}, '')) like lower(${like}))` as SQL,
      );
    }
    // Membership semantics: match an employee assigned to the department via the
    // many-to-many join OR the legacy single column (kept in sync as a shim).
    if (opts.departmentId) {
      conditions.push(
        sql`(${users.departmentId} = ${opts.departmentId} or exists (select 1 from ${employeeDepartments} ed where ed.user_id = ${users.id} and ed.department_id = ${opts.departmentId}))` as SQL,
      );
    }
    if (opts.locationId) {
      conditions.push(
        sql`(${users.locationId} = ${opts.locationId} or exists (select 1 from ${employeeLocations} el where el.user_id = ${users.id} and el.location_id = ${opts.locationId}))` as SQL,
      );
    }
    if (opts.companyId) conditions.push(eq(users.companyId, opts.companyId));
    if (opts.taxClass) {
      // No employment profile defaults to "W-2" (matches the route/UI default),
      // so a "W-2" filter must also include users without a profile row.
      if (opts.taxClass === "W-2") {
        conditions.push(
          sql`coalesce(${userEmploymentProfiles.taxClassification}, 'W-2') = ${opts.taxClass}` as SQL,
        );
      } else {
        conditions.push(eq(userEmploymentProfiles.taxClassification, opts.taxClass));
      }
    }
    if (opts.certStatus) {
      // Certifications are 1:many, so use EXISTS subqueries rather than a join
      // to avoid multiplying user rows (which would corrupt count/pagination).
      if (opts.certStatus === "none") {
        // "No certifications" mirrors the prior client filter, which ignored
        // archived rows — a user with only archived certs still counts as none.
        conditions.push(
          sql`not exists (select 1 from ${certifications} c where c.employee_id = ${users.id} and c.status <> 'archived')` as SQL,
        );
      } else {
        conditions.push(
          sql`exists (select 1 from ${certifications} c where c.employee_id = ${users.id} and c.status = ${opts.certStatus})` as SQL,
        );
      }
    }
    if (opts.excludeUserIds && opts.excludeUserIds.length > 0) {
      conditions.push(sql`${users.id} not in (${sql.join(opts.excludeUserIds.map((id) => sql`${id}`), sql`, `)})` as SQL);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rowsQuery = db
      .select()
      .from(users)
      .leftJoin(userEmploymentProfiles, eq(userEmploymentProfiles.userId, users.id))
      .where(whereClause)
      .orderBy(users.firstName, users.lastName, users.id)
      .limit(opts.limit)
      .offset(opts.offset);

    const countQuery = db
      .select({ value: count() })
      .from(users)
      .leftJoin(userEmploymentProfiles, eq(userEmploymentProfiles.userId, users.id))
      .where(whereClause);

    const [rowsResult, countResult] = await Promise.all([rowsQuery, countQuery]);
    const rows = await this.hydrateUsers(rowsResult.map((r: any) => r.users as User));
    const total = Number(countResult[0]?.value ?? 0);
    return { rows, total };
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return user;
  }

  async updateUserDepartment(id: string, departmentId: string): Promise<User | undefined> {
    // Single-value setter kept for compatibility. Replaces the full membership
    // set with this one department so the join table stays the source of truth.
    await this.setUserDepartmentIds(id, departmentId ? [departmentId] : []);
    return this.getUser(id);
  }

  async getUserDepartmentIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ departmentId: employeeDepartments.departmentId })
      .from(employeeDepartments)
      .where(eq(employeeDepartments.userId, userId));
    return rows.map((r) => r.departmentId);
  }

  async getUserLocationIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ locationId: employeeLocations.locationId })
      .from(employeeLocations)
      .where(eq(employeeLocations.userId, userId));
    return rows.map((r) => r.locationId);
  }

  // Task #418: geofence-enabled addresses (with usable coordinates) across all
  // of the employee's assigned locations. Used to decide whether a clock-in
  // happened inside an allowed radius. Returns [] when the employee has no
  // geofenced locations — i.e. geofencing simply doesn't apply to them.
  async getEmployeeGeofencedAddresses(userId: string): Promise<LocationAddress[]> {
    const locationIds = await this.getUserLocationIds(userId);
    if (locationIds.length === 0) return [];
    return db
      .select()
      .from(locationAddresses)
      .where(
        and(
          inArray(locationAddresses.locationId, locationIds),
          eq(locationAddresses.geofenceEnabled, true),
          isNotNull(locationAddresses.latitude),
          isNotNull(locationAddresses.longitude),
        ),
      );
  }

  // Replace an employee's full department membership set. Also syncs the legacy
  // `users.department_id` shim to one representative (the first) for any code
  // still reading the single column. Returns the deduped set written.
  async setUserDepartmentIds(userId: string, departmentIds: string[]): Promise<string[]> {
    const dedup = Array.from(new Set((departmentIds || []).filter(Boolean)));
    await db.transaction(async (tx) => {
      await tx.delete(employeeDepartments).where(eq(employeeDepartments.userId, userId));
      if (dedup.length > 0) {
        await tx
          .insert(employeeDepartments)
          .values(dedup.map((departmentId) => ({ userId, departmentId })))
          .onConflictDoNothing();
      }
      await tx
        .update(users)
        .set({ departmentId: dedup[0] ?? null, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
    return dedup;
  }

  // Replace an employee's full location membership set; syncs the legacy
  // `users.location_id` shim to one representative.
  async setUserLocationIds(userId: string, locationIds: string[]): Promise<string[]> {
    const dedup = Array.from(new Set((locationIds || []).filter(Boolean)));
    await db.transaction(async (tx) => {
      await tx.delete(employeeLocations).where(eq(employeeLocations.userId, userId));
      if (dedup.length > 0) {
        await tx
          .insert(employeeLocations)
          .values(dedup.map((locationId) => ({ userId, locationId })))
          .onConflictDoNothing();
      }
      await tx
        .update(users)
        .set({ locationId: dedup[0] ?? null, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
    return dedup;
  }

  async getLocation(id: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  // Locations may belong to multiple companies via `location_companies`. The
  // primary `locations.companyId` is also honored so single-tenant rows that
  // pre-date the join (or were inserted bypassing the join) still resolve.
  async getLocationsByCompany(companyId: string): Promise<Location[]> {
    const rows = await db
      .select({
        id: locations.id,
        companyId: locations.companyId,
        name: locations.name,
        code: locations.code,
        timezone: locations.timezone,
        isActive: locations.isActive,
        createdAt: locations.createdAt,
        updatedAt: locations.updatedAt,
      })
      .from(locations)
      .leftJoin(locationCompanies, eq(locationCompanies.locationId, locations.id))
      .where(or(eq(locations.companyId, companyId), eq(locationCompanies.companyId, companyId)));
    const seen = new Set<string>();
    const out: Location[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r as Location);
    }
    return out;
  }

  async getAllLocations(): Promise<Location[]> {
    return db.select().from(locations);
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(locations).values(location).returning();
    if (created.companyId) {
      await db
        .insert(locationCompanies)
        .values({ locationId: created.id, companyId: created.companyId })
        .onConflictDoNothing();
    }
    return created;
  }

  async updateLocation(id: string, location: Partial<InsertLocation>): Promise<Location | undefined> {
    const [updated] = await db.update(locations).set(location).where(eq(locations.id, id)).returning();
    if (updated && location.companyId) {
      await db
        .insert(locationCompanies)
        .values({ locationId: updated.id, companyId: updated.companyId })
        .onConflictDoNothing();
    }
    return updated;
  }

  async deleteLocation(id: string): Promise<void> {
    await db.delete(locationCompanies).where(eq(locationCompanies.locationId, id));
    await db.delete(locations).where(eq(locations.id, id));
  }

  async getLocationCompanyIds(locationId: string): Promise<string[]> {
    const rows = await db
      .select({ companyId: locationCompanies.companyId })
      .from(locationCompanies)
      .where(eq(locationCompanies.locationId, locationId));
    return rows.map((r) => r.companyId);
  }

  async getLocationCompanyIdsMap(locationIds: string[]): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    if (locationIds.length === 0) return out;
    const rows = await db
      .select({ locationId: locationCompanies.locationId, companyId: locationCompanies.companyId })
      .from(locationCompanies)
      .where(inArray(locationCompanies.locationId, locationIds));
    for (const r of rows) {
      (out[r.locationId] ||= []).push(r.companyId);
    }
    return out;
  }

  // Replace the company set for a location. Always keeps `locations.companyId`
  // (the primary/legacy column) as one of the entries so existing
  // single-tenant code paths keep working.
  async setLocationCompanyIds(locationId: string, companyIds: string[]): Promise<string[]> {
    const loc = await this.getLocation(locationId);
    if (!loc) return [];
    const dedup = Array.from(new Set(companyIds.filter(Boolean)));
    // Ensure the primary companyId stays included unless explicitly being
    // replaced — if the caller didn't list it but provided at least one other,
    // promote the first listed companyId to primary for backward compatibility.
    let primary = loc.companyId;
    if (dedup.length > 0 && primary && !dedup.includes(primary)) {
      primary = dedup[0];
      await db.update(locations).set({ companyId: primary }).where(eq(locations.id, locationId));
    } else if (dedup.length === 0 && primary) {
      dedup.push(primary);
    }
    await db.delete(locationCompanies).where(eq(locationCompanies.locationId, locationId));
    if (dedup.length > 0) {
      await db
        .insert(locationCompanies)
        .values(dedup.map((companyId) => ({ locationId, companyId })))
        .onConflictDoNothing();
    }
    return dedup;
  }

  async getLocationAddresses(locationId: string): Promise<LocationAddress[]> {
    return db.select().from(locationAddresses).where(eq(locationAddresses.locationId, locationId));
  }

  async getLocationAddress(id: string): Promise<LocationAddress | undefined> {
    const [addr] = await db.select().from(locationAddresses).where(eq(locationAddresses.id, id));
    return addr;
  }

  async createLocationAddress(address: InsertLocationAddress): Promise<LocationAddress> {
    const [created] = await db.insert(locationAddresses).values(address).returning();
    return created;
  }

  async updateLocationAddress(id: string, address: Partial<InsertLocationAddress>): Promise<LocationAddress | undefined> {
    const [updated] = await db.update(locationAddresses).set(address).where(eq(locationAddresses.id, id)).returning();
    return updated;
  }

  async deleteLocationAddress(id: string): Promise<void> {
    await db.delete(locationAddresses).where(eq(locationAddresses.id, id));
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

  // Delete a punch and clear every nullable FK reference to it first so the
  // delete doesn't hit a constraint violation. Mirrors the FK-clearing the
  // punch_removal request resolution does (attendance exceptions, draft
  // payroll batch records / adjustments, biometric supervisor overrides).
  // Returns the deleted row, or undefined if it was already gone.
  // NOTE: callers that need to protect finalized payroll must check for that
  // BEFORE calling this — it nulls payroll references unconditionally.
  async deletePunchLog(id: string): Promise<PunchLog | undefined> {
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(punchLogs).where(eq(punchLogs.id, id));
      if (!existing) return undefined;

      await tx.update(attendanceExceptions)
        .set({ punchLogId: null })
        .where(eq(attendanceExceptions.punchLogId, id));
      await tx.update(payrollBatchRecords)
        .set({ punchLogId: null })
        .where(eq(payrollBatchRecords.punchLogId, id));
      await tx.update(payrollAdjustments)
        .set({ punchLogId: null })
        .where(eq(payrollAdjustments.punchLogId, id));
      await tx.update(biometricSupervisorOverrides)
        .set({ punchLogId: null })
        .where(eq(biometricSupervisorOverrides.punchLogId, id));

      await tx.delete(punchLogs).where(eq(punchLogs.id, id));
      return punchLogToLegacy(existing);
    });
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

  async clockIn(
    userId: string,
    source: string = "web",
    roundedTime?: Date,
    opts?: ClockInOptions,
  ): Promise<PunchLog> {
    const actualNow = new Date();
    const rounded = roundedTime || actualNow;
    const dateStr = actualNow.toISOString().split("T")[0];
    // The "are you already clocked in?" check and the insert must be atomic, or
    // two near-simultaneous requests (kiosk double-tap, two devices, retried
    // request) both pass the check and create two open punches. We serialize
    // per-employee with a transaction-scoped advisory lock, re-check inside the
    // lock, then insert. The partial unique index (migration 0048) is the
    // ultimate backstop and is mapped to a friendly error if it ever fires.
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

        const [existing] = await tx
          .select({ id: punchLogs.id })
          .from(punchLogs)
          .where(and(
            eq(punchLogs.employeeId, userId),
            isNotNull(punchLogs.clockIn),
            isNull(punchLogs.clockOut),
          ))
          .limit(1);
        if (existing) {
          throw new DuplicateOpenPunchError();
        }

        const [record] = await tx.insert(punchLogs).values({
          employeeId: userId,
          workDate: dateStr,
          clockIn: actualNow,
          roundedClockIn: rounded,
          status: opts?.status ?? "in-progress",
          source,
          ...(opts?.kioskDeviceId ? { kioskDeviceId: opts.kioskDeviceId } : {}),
          ...(opts?.punchLatitude != null ? { punchLatitude: opts.punchLatitude } : {}),
          ...(opts?.punchLongitude != null ? { punchLongitude: opts.punchLongitude } : {}),
          approved: true,
        }).returning();
        return punchLogToLegacy(record);
      });
    } catch (err) {
      if (err instanceof DuplicateOpenPunchError) throw err;
      if (isOpenPunchUniqueViolation(err)) throw new DuplicateOpenPunchError();
      throw err;
    }
  }

  // Close a punch only if it is still open. The WHERE guard on clock_out makes
  // a double clock-out a no-op: the second call matches nothing and returns
  // undefined instead of re-closing an already-closed punch.
  async closeOpenPunch(id: string, record: Partial<InsertPunchLog>): Promise<PunchLog | undefined> {
    const [updated] = await db
      .update(punchLogs)
      .set(record)
      .where(and(eq(punchLogs.id, id), isNull(punchLogs.clockOut)))
      .returning();
    return updated ? punchLogToLegacy(updated) : undefined;
  }

  async clockOut(userId: string): Promise<PunchLog | undefined> {
    // The day's overtime/complete status is derived through THE single pay engine
    // (resolvePayCalcPolicy + splitDailyHours) so this path never disagrees with
    // enforceClockOut, the timesheet, reports or payroll. There is NO hard-coded
    // 8-hour fallback: the OT threshold comes from the employee's effective
    // policy (and only the engine's DEFAULT_PAY_CALC_POLICY when no employee
    // record exists, e.g. in isolated tests).
    const employee = await this.getUser(userId);
    const policy = employee ? await resolvePayCalcPolicy(employee) : DEFAULT_PAY_CALC_POLICY;
    // Serialize against concurrent clock-outs for the same employee so the
    // "find open punch -> close it" pair is atomic; a second concurrent (or
    // double-tapped) clock-out finds no open punch and no-ops.
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

      const [current] = await tx
        .select()
        .from(punchLogs)
        .where(and(
          eq(punchLogs.employeeId, userId),
          isNotNull(punchLogs.clockIn),
          isNull(punchLogs.clockOut),
        ))
        .orderBy(desc(punchLogs.clockIn))
        .limit(1);
      if (!current || !current.clockIn) return undefined;

      const now = new Date();
      const roundedInMs = new Date(current.roundedClockIn ?? current.clockIn).getTime();
      const totalMs = now.getTime() - roundedInMs;
      const breakMs = (current.breakMinutes || 0) * 60 * 1000;
      const hoursWorked = Math.round(((totalMs - breakMs) / (1000 * 60 * 60)) * 100) / 100;
      const { status } = splitDailyHours(hoursWorked, policy);

      const [updated] = await tx
        .update(punchLogs)
        .set({ clockOut: now, roundedClockOut: now, hoursWorked, status })
        .where(eq(punchLogs.id, current.id))
        .returning();
      return updated ? punchLogToLegacy(updated) : undefined;
    });
  }

  // Start a break on the employee's current open shift. Atomic per-employee
  // (same advisory lock as clock-in/out) so a double-tap can't set two starts.
  // Rejects when there's no open shift or a break is already running. "On break"
  // is a pure function of break_started_at being set — status is never touched.
  async startBreak(userId: string): Promise<BreakActionResult> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

      const [current] = await tx
        .select()
        .from(punchLogs)
        .where(and(
          eq(punchLogs.employeeId, userId),
          isNotNull(punchLogs.clockIn),
          isNull(punchLogs.clockOut),
        ))
        .orderBy(desc(punchLogs.clockIn))
        .limit(1);
      if (!current || !current.clockIn) return { ok: false, reason: "not_clocked_in" as const };
      if (current.breakStartedAt) return { ok: false, reason: "already_on_break" as const };

      const [updated] = await tx
        .update(punchLogs)
        .set({ breakStartedAt: new Date() })
        .where(and(eq(punchLogs.id, current.id), isNull(punchLogs.breakStartedAt)))
        .returning();
      if (!updated) return { ok: false, reason: "already_on_break" as const };
      return { ok: true, punch: punchLogToLegacy(updated), elapsedMinutes: 0 };
    });
  }

  // End the current break, folding the elapsed whole minutes into break_minutes
  // and clearing break_started_at. Same single break-minutes accumulator every
  // pay/attendance surface already reads — no parallel calculation. Rejects when
  // there's no open shift or no break is running.
  async endBreak(userId: string): Promise<BreakActionResult> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

      const [current] = await tx
        .select()
        .from(punchLogs)
        .where(and(
          eq(punchLogs.employeeId, userId),
          isNotNull(punchLogs.clockIn),
          isNull(punchLogs.clockOut),
        ))
        .orderBy(desc(punchLogs.clockIn))
        .limit(1);
      if (!current || !current.clockIn) return { ok: false, reason: "not_clocked_in" as const };
      if (!current.breakStartedAt) return { ok: false, reason: "not_on_break" as const };

      const elapsedMinutes = computeBreakElapsedMinutes(current.breakStartedAt);
      const [updated] = await tx
        .update(punchLogs)
        .set({
          breakMinutes: (current.breakMinutes || 0) + elapsedMinutes,
          breakStartedAt: null,
        })
        .where(and(eq(punchLogs.id, current.id), isNotNull(punchLogs.breakStartedAt)))
        .returning();
      if (!updated) return { ok: false, reason: "not_on_break" as const };
      return { ok: true, punch: punchLogToLegacy(updated), elapsedMinutes };
    });
  }

  async getCurrentAttendance(userId: string): Promise<PunchLog | undefined> {
    // THE canonical "is this employee currently clocked in?" check. An open
    // punch is defined PURELY by clock-in present + clock-out absent — the SAME
    // predicate used by the DB partial unique index (migration 0048), the shared
    // punch-integrity validator, the clock-in/clock-out storage methods, and the
    // kiosk clock-out path. It deliberately does NOT filter on status: the web
    // path stamps "in-progress" while the kiosk stamps "present" for the very
    // same open state, and a dangling row (clock_out NULL with some other status
    // from an interrupted/auto clock-out) is still genuinely open. Keying on
    // status here let those rows pass the 409 "already clocked in" guard while
    // the integrity validator rejected the next clock-in with a 400 and clock-out
    // claimed "not clocked in" — a stuck state where the employee was locked out
    // of both actions (task #476).
    const [record] = await db
      .select()
      .from(punchLogs)
      .where(and(
        eq(punchLogs.employeeId, userId),
        isNotNull(punchLogs.clockIn),
        isNull(punchLogs.clockOut),
      ))
      .orderBy(desc(punchLogs.clockIn))
      .limit(1);
    return record ? punchLogToLegacy(record) : undefined;
  }

  async getOpenPunchLogs(): Promise<PunchLog[]> {
    const records = await db
      .select()
      .from(punchLogs)
      .where(isNull(punchLogs.clockOut));
    return records.map(punchLogToLegacy);
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
      } else if (r.clockIn && !r.clockOut) {
        // Open punch (clock-in, no clock-out) — accrue live elapsed hours. Use
        // the canonical open-punch predicate, not status, so a kiosk "present"
        // open punch counts the same as a web "in-progress" one (task #476).
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
      } else if (r.clockIn && !r.clockOut) {
        // Open punch (clock-in, no clock-out) — accrue live elapsed hours, using
        // the canonical open-punch predicate rather than status (task #476).
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

  async getAttendanceExceptionsPage(opts: { limit: number; offset: number }): Promise<{ rows: AttendanceException[]; total: number }> {
    const [rows, countResult] = await Promise.all([
      db.select().from(attendanceExceptions)
        .orderBy(desc(attendanceExceptions.createdAt))
        .limit(opts.limit)
        .offset(opts.offset),
      db.select({ value: count() }).from(attendanceExceptions),
    ]);
    return { rows, total: Number(countResult[0]?.value ?? 0) };
  }

  async getReopenPendingAttendanceExceptions(): Promise<AttendanceException[]> {
    return db.select().from(attendanceExceptions)
      .where(eq(attendanceExceptions.reopenStatus, "pending"))
      .orderBy(desc(attendanceExceptions.reopenRequestedAt));
  }

  async getLatestResolvedAttendanceExceptionForDate(
    employeeId: string,
    date: string,
  ): Promise<AttendanceException | undefined> {
    const [row] = await db.select().from(attendanceExceptions)
      .where(and(
        eq(attendanceExceptions.employeeId, employeeId),
        eq(attendanceExceptions.exceptionDate, date),
        inArray(attendanceExceptions.status, ["approved", "denied", "cancelled"]),
      ))
      .orderBy(desc(attendanceExceptions.createdAt))
      .limit(1);
    return row;
  }

  async createAttendanceException(exception: InsertAttendanceException): Promise<AttendanceException> {
    const [created] = await db.insert(attendanceExceptions).values(exception).returning();
    return created;
  }

  async updateAttendanceException(
    id: string,
    data: Partial<AttendanceException>,
    options?: { expectedStatus?: string },
  ): Promise<AttendanceException | undefined> {
    // When `expectedStatus` is supplied, the WHERE clause guards on the current
    // status so a concurrent writer that already transitioned the row out of
    // that state results in a 0-row update (returned as `undefined`) instead of
    // clobbering the newer state.
    const where = options?.expectedStatus
      ? and(eq(attendanceExceptions.id, id), eq(attendanceExceptions.status, options.expectedStatus))
      : eq(attendanceExceptions.id, id);
    const [updated] = await db.update(attendanceExceptions).set(data).where(where).returning();
    return updated;
  }

  async getCorrectionRequestCounts(
    employeeId: string,
    options?: { excludeId?: string; payPeriodType?: PayPeriodType }
  ): Promise<CorrectionCountSummary> {
    const conditions = [
      eq(attendanceExceptions.employeeId, employeeId),
      inArray(attendanceExceptions.type, [...CORRECTION_COUNT_TYPES]),
      inArray(attendanceExceptions.status, ["pending", "approved", "denied"]),
    ];
    if (options?.excludeId) {
      conditions.push(ne(attendanceExceptions.id, options.excludeId));
    }
    const rows = await db
      .select({
        status: attendanceExceptions.status,
        createdAt: attendanceExceptions.createdAt,
      })
      .from(attendanceExceptions)
      .where(and(...conditions));

    const summary = emptyCorrectionCountSummary();
    const now = new Date();
    const payPeriodStart = getCurrentPayPeriodStart(
      options?.payPeriodType ?? DEFAULT_PAY_PERIOD_TYPE,
      now,
    );
    const weekStart = getCurrentWeekStart(now);
    const monthStart = getCurrentMonthStart(now);
    const yearStart = getCurrentYearStart(now);
    const cutoff90 = new Date();
    cutoff90.setDate(cutoff90.getDate() - CORRECTION_COUNT_WINDOW_DAYS);

    for (const row of rows) {
      if (!row.createdAt) continue;
      const created =
        row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as any);
      const status = row.status as "pending" | "approved" | "denied";
      tallyCorrectionRow(summary, status, created, {
        payPeriodStart,
        weekStart,
        monthStart,
        yearStart,
        cutoff90,
      });
    }
    return summary;
  }

  async getCorrectionRequestCountsBulk(
    employeeIds: string[],
    options?: { payPeriodTypeByEmployee?: Map<string, PayPeriodType> }
  ): Promise<Map<string, CorrectionCountSummary>> {
    const result = new Map<string, CorrectionCountSummary>();
    if (employeeIds.length === 0) return result;
    const uniqueIds = Array.from(new Set(employeeIds));
    for (const id of uniqueIds) {
      result.set(id, emptyCorrectionCountSummary());
    }

    const now = new Date();
    const weekStart = getCurrentWeekStart(now);
    const monthStart = getCurrentMonthStart(now);
    const yearStart = getCurrentYearStart(now);
    const cutoff90 = new Date();
    cutoff90.setDate(cutoff90.getDate() - CORRECTION_COUNT_WINDOW_DAYS);

    const payPeriodStartByEmployee = new Map<string, Date>();
    for (const id of uniqueIds) {
      const type =
        options?.payPeriodTypeByEmployee?.get(id) ?? DEFAULT_PAY_PERIOD_TYPE;
      payPeriodStartByEmployee.set(id, getCurrentPayPeriodStart(type, now));
    }

    const rows = await db
      .select({
        employeeId: attendanceExceptions.employeeId,
        status: attendanceExceptions.status,
        createdAt: attendanceExceptions.createdAt,
      })
      .from(attendanceExceptions)
      .where(
        and(
          inArray(attendanceExceptions.employeeId, uniqueIds),
          inArray(attendanceExceptions.type, [...CORRECTION_COUNT_TYPES]),
          inArray(attendanceExceptions.status, ["pending", "approved", "denied"]),
        ),
      );

    for (const row of rows) {
      const summary = result.get(row.employeeId);
      if (!summary || !row.createdAt) continue;
      const created =
        row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as any);
      const status = row.status as "pending" | "approved" | "denied";
      const payPeriodStart =
        payPeriodStartByEmployee.get(row.employeeId) ??
        getCurrentPayPeriodStart(DEFAULT_PAY_PERIOD_TYPE, now);
      tallyCorrectionRow(summary, status, created, {
        payPeriodStart,
        weekStart,
        monthStart,
        yearStart,
        cutoff90,
      });
    }
    return result;
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

  async createTimeOffRequest(
    request: InsertTimeOffRequest & { reviewedBy?: string | null; reviewedAt?: Date | null },
  ): Promise<TimeOffRequest> {
    const [created] = await db.insert(timeOffRequests).values(request).returning();
    return created;
  }

  async updateTimeOffRequest(id: string, request: Partial<InsertTimeOffRequest & { reviewedBy: string; reviewedAt: Date; editedAt: Date; hoursApproved: number; approvedEndDate: string }>): Promise<TimeOffRequest | undefined> {
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

  // Atomic increment/decrement of balance columns. Uses a single SQL
  // `set total = total + :delta` so concurrent writers (e.g. the anniversary
  // accrual job and a manual edit) can't clobber each other via the classic
  // read-modify-write race — every delta is applied on top of the live value.
  async incrementTimeOffBalance(
    id: string,
    deltas: { totalHoursDelta?: number; usedHoursDelta?: number },
  ): Promise<TimeOffBalance | undefined> {
    const sets: Record<string, SQL> = {};
    if (deltas.totalHoursDelta !== undefined) {
      sets.totalHours = sql`${timeOffBalances.totalHours} + ${deltas.totalHoursDelta}`;
    }
    if (deltas.usedHoursDelta !== undefined) {
      sets.usedHours = sql`${timeOffBalances.usedHours} + ${deltas.usedHoursDelta}`;
    }
    if (Object.keys(sets).length === 0) {
      return this.getTimeOffBalanceById(id);
    }
    const [updated] = await db.update(timeOffBalances).set(sets).where(eq(timeOffBalances.id, id)).returning();
    return updated;
  }

  async getTimeOffBalanceById(id: string): Promise<TimeOffBalance | undefined> {
    const [row] = await db.select().from(timeOffBalances).where(eq(timeOffBalances.id, id));
    return row;
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
    const [created] = await db
      .insert(employeePins)
      .values({ ...pin, pin: hashPin(pin.pin) })
      .returning();
    return created;
  }

  async updateEmployeePin(userId: string, pin: string): Promise<EmployeePin | undefined> {
    const [updated] = await db
      .update(employeePins)
      .set({ pin: hashPin(pin) })
      .where(eq(employeePins.userId, userId))
      .returning();
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

  async updateKioskDevice(id: string, device: Partial<KioskDevice>): Promise<KioskDevice | undefined> {
    const [updated] = await db.update(kioskDevices).set(device).where(eq(kioskDevices.id, id)).returning();
    return updated;
  }

  async deleteKioskDevice(id: string): Promise<void> {
    await db.delete(kioskDevices).where(eq(kioskDevices.id, id));
  }

  async setKioskPairingCode(id: string, code: string, expiresAt: Date): Promise<KioskDevice | undefined> {
    const [updated] = await db
      .update(kioskDevices)
      .set({ pairingCode: code, pairingCodeExpiresAt: expiresAt })
      .where(eq(kioskDevices.id, id))
      .returning();
    return updated;
  }

  async getKioskByPairingCode(code: string): Promise<KioskDevice | undefined> {
    const [device] = await db
      .select()
      .from(kioskDevices)
      .where(eq(kioskDevices.pairingCode, code));
    return device;
  }

  async markKioskPaired(id: string): Promise<KioskDevice | undefined> {
    const now = new Date();
    const [updated] = await db
      .update(kioskDevices)
      .set({
        pairingCode: null,
        pairingCodeExpiresAt: null,
        pairedAt: now,
        lastHeartbeat: now,
        status: "paired",
      })
      .where(eq(kioskDevices.id, id))
      .returning();
    return updated;
  }

  async unpairKioskDevice(id: string): Promise<KioskDevice | undefined> {
    const [updated] = await db
      .update(kioskDevices)
      .set({
        pairingCode: null,
        pairingCodeExpiresAt: null,
        pairedAt: null,
        status: "unpaired",
      })
      .where(eq(kioskDevices.id, id))
      .returning();
    return updated;
  }

  async updateKioskHeartbeat(id: string): Promise<KioskDevice | undefined> {
    const [updated] = await db
      .update(kioskDevices)
      .set({ lastHeartbeat: new Date() })
      .where(eq(kioskDevices.id, id))
      .returning();
    return updated;
  }

  async getRecentPunchesByKiosk(deviceId: string, limit: number) {
    const rows = await db
      .select({
        log: punchLogs,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(punchLogs)
      .innerJoin(users, eq(users.id, punchLogs.employeeId))
      .where(eq(punchLogs.kioskDeviceId, deviceId))
      .orderBy(desc(punchLogs.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      ...punchLogToLegacy(r.log),
      employeeName: `${r.firstName || ""} ${r.lastName || ""}`.trim() || "Employee",
    }));
  }

  async getKioskPunchTotalsToday(deviceId: string): Promise<{ clockIns: number; clockOuts: number; uniqueEmployees: number }> {
    const today = new Date().toISOString().split("T")[0];
    const rows = await db
      .select({
        id: punchLogs.id,
        employeeId: punchLogs.employeeId,
        clockIn: punchLogs.clockIn,
        clockOut: punchLogs.clockOut,
      })
      .from(punchLogs)
      .where(and(eq(punchLogs.kioskDeviceId, deviceId), eq(punchLogs.workDate, today)));
    let clockIns = 0;
    let clockOuts = 0;
    for (const r of rows) {
      if (r.clockIn) clockIns += 1;
      if (r.clockOut) clockOuts += 1;
    }
    const uniq = new Set(rows.map((r) => r.employeeId));
    return { clockIns, clockOuts, uniqueEmployees: uniq.size };
  }

  async getUserByPin(pin: string): Promise<User | undefined> {
    // PINs are stored as a peppered keyed hash (never plaintext), so match on
    // the hash of the supplied PIN rather than the raw value.
    const results = await db
      .select({ user: users })
      .from(employeePins)
      .innerJoin(users, eq(employeePins.userId, users.id))
      .where(eq(employeePins.pin, hashPin(pin)));
    return results[0]?.user;
  }

  async searchUsersByName(query: string): Promise<User[]> {
    const pattern = `%${query}%`;
    const rows = await db
      .select()
      .from(users)
      .where(
        or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern)
        )
      );
    return this.hydrateUsers(rows);
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

  async getAttendanceForUserOnDate(userId: string, workDate: string): Promise<PunchLog | undefined> {
    const [record] = await db
      .select()
      .from(punchLogs)
      .where(and(eq(punchLogs.employeeId, userId), eq(punchLogs.workDate, workDate)))
      .orderBy(desc(punchLogs.createdAt))
      .limit(1);
    return record ? punchLogToLegacy(record) : undefined;
  }

  async getUsersByDepartment(departmentId: string): Promise<User[]> {
    // Membership: anyone assigned to this department via the join OR the legacy
    // single column (kept in sync). Mirrors the "is a member of" semantics.
    const rows = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.departmentId, departmentId),
          sql`exists (select 1 from ${employeeDepartments} ed where ed.user_id = ${users.id} and ed.department_id = ${departmentId})`,
        ),
      );
    return this.hydrateUsers(rows);
  }

  async getUsersByLocation(locationId: string): Promise<User[]> {
    const rows = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.locationId, locationId),
          sql`exists (select 1 from ${employeeLocations} el where el.user_id = ${users.id} and el.location_id = ${locationId})`,
        ),
      );
    return this.hydrateUsers(rows);
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

  // SQL-side aggregation of worked hours + distinct days worked, grouped by
  // employee. Mirrors computeAttendanceTotals in timesheetService exactly:
  //   - per punch with a clock_in, add max(0, (clockOut ?? now) - clockIn) / 3600
  //   - days worked = distinct work_date among punches that have a clock_in
  // Pushing this into the DB lets report generation scale to thousands of
  // employees without loading the whole punch_logs table into memory.
  async getAttendanceAggregatesByDateRange(
    startDate: string,
    endDate: string,
    userIds?: string[],
    now: Date = new Date(),
  ): Promise<Map<string, { totalHours: number; daysWorked: number }>> {
    const result = new Map<string, { totalHours: number; daysWorked: number }>();
    if (userIds && userIds.length === 0) return result;

    const conds: SQL[] = [
      gte(punchLogs.workDate, startDate),
      lte(punchLogs.workDate, endDate),
    ];
    if (userIds && userIds.length > 0) {
      conds.push(inArray(punchLogs.employeeId, userIds));
    }

    // Format `now` as a naive (no-tz) timestamp matching how clock_in/clock_out
    // are stored, so the in-progress-punch arithmetic lines up.
    const nowLiteral = now.toISOString().replace("T", " ").replace("Z", "");

    const rows = await db
      .select({
        employeeId: punchLogs.employeeId,
        totalHours: sql<string>`COALESCE(SUM(
          CASE
            WHEN ${punchLogs.hoursWorked} IS NOT NULL THEN ${punchLogs.hoursWorked}
            WHEN ${punchLogs.clockIn} IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(${punchLogs.clockOut}, ${nowLiteral}::timestamp) - COALESCE(${punchLogs.roundedClockIn}, ${punchLogs.clockIn}))) / 3600.0 - COALESCE(${punchLogs.breakMinutes}, 0) / 60.0)
            ELSE 0 END
        ), 0)`,
        daysWorked: sql<number>`COUNT(DISTINCT CASE WHEN ${punchLogs.clockIn} IS NOT NULL THEN ${punchLogs.workDate} END)`,
      })
      .from(punchLogs)
      .where(and(...conds))
      .groupBy(punchLogs.employeeId);

    for (const r of rows) {
      result.set(r.employeeId, {
        totalHours: Number(r.totalHours),
        daysWorked: Number(r.daysWorked),
      });
    }
    return result;
  }

  // SQL-side per-day worked-hours, grouped by (employee, work_date), WITHOUT
  // collapsing the days, so callers can apply the unified pay engine's per-day
  // overtime split (each day's hours over the daily threshold) instead of the
  // old aggregate "totalHours - daysWorked * 8" approximation.
  //
  // Worked-hours INPUT is the SAME canonical value payroll consumes: the
  // persisted, break-deducted `hours_worked` (set at clock-out via the engine
  // and by `computePunchHoursWorked`). Only still-open punches (no stored value
  // yet) fall back to a live, break-deducted compute, mirroring `storage.clockOut`
  // exactly. This guarantees reports/timesheet and payroll can never drift on
  // break deductions or rounding.
  async getDailyHoursByDateRange(
    startDate: string,
    endDate: string,
    userIds?: string[],
    now: Date = new Date(),
  ): Promise<Map<string, Array<{ workDate: string; hours: number }>>> {
    const result = new Map<string, Array<{ workDate: string; hours: number }>>();
    if (userIds && userIds.length === 0) return result;

    const conds: SQL[] = [
      gte(punchLogs.workDate, startDate),
      lte(punchLogs.workDate, endDate),
    ];
    if (userIds && userIds.length > 0) {
      conds.push(inArray(punchLogs.employeeId, userIds));
    }

    const nowLiteral = now.toISOString().replace("T", " ").replace("Z", "");

    const rows = await db
      .select({
        employeeId: punchLogs.employeeId,
        workDate: punchLogs.workDate,
        hours: sql<string>`COALESCE(SUM(
          CASE
            WHEN ${punchLogs.hoursWorked} IS NOT NULL THEN ${punchLogs.hoursWorked}
            WHEN ${punchLogs.clockIn} IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(${punchLogs.clockOut}, ${nowLiteral}::timestamp) - COALESCE(${punchLogs.roundedClockIn}, ${punchLogs.clockIn}))) / 3600.0 - COALESCE(${punchLogs.breakMinutes}, 0) / 60.0)
            ELSE 0 END
        ), 0)`,
      })
      .from(punchLogs)
      .where(and(...conds))
      .groupBy(punchLogs.employeeId, punchLogs.workDate);

    for (const r of rows) {
      const arr = result.get(r.employeeId) || [];
      arr.push({ workDate: String(r.workDate), hours: Number(r.hours) });
      result.set(r.employeeId, arr);
    }
    return result;
  }

  // SQL-side aggregation of approved time-off days off, grouped by user.
  // Mirrors the report's in-memory logic: only approved / partially_approved
  // requests overlapping [startDate, endDate] count, and each contributes its
  // full span ((endDate - startDate) + 1 days), NOT clamped to the range. When
  // a status filter is supplied it intersects with the approved set (so e.g.
  // status="denied" yields zero, matching the previous behaviour).
  async getTimeOffDaysOffByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
    status?: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (userIds.length === 0) return result;

    const conds: SQL[] = [
      inArray(timeOffRequests.userId, userIds),
      lte(timeOffRequests.startDate, endDate),
      gte(timeOffRequests.endDate, startDate),
      inArray(timeOffRequests.status, ["approved", "partially_approved"]),
    ];
    if (status && status !== "all") {
      conds.push(eq(timeOffRequests.status, status));
    }

    const rows = await db
      .select({
        userId: timeOffRequests.userId,
        daysOff: sql<number>`COALESCE(SUM((${timeOffRequests.endDate}::date - ${timeOffRequests.startDate}::date) + 1), 0)`,
      })
      .from(timeOffRequests)
      .where(and(...conds))
      .groupBy(timeOffRequests.userId);

    for (const r of rows) {
      result.set(r.userId, Number(r.daysOff));
    }
    return result;
  }

  // Per-request time-off rows overlapping [startDate, endDate] for the given
  // users, used by the PTO report. Excludes cashouts (not "time off taken").
  // When a status filter is supplied it narrows to that status; otherwise all
  // statuses are returned so the report can show pending/denied alongside
  // approved.
  async getTimeOffRequestsByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
    status?: string,
  ): Promise<TimeOffRequest[]> {
    if (userIds.length === 0) return [];
    const conds: SQL[] = [
      inArray(timeOffRequests.userId, userIds),
      lte(timeOffRequests.startDate, endDate),
      gte(timeOffRequests.endDate, startDate),
      ne(timeOffRequests.requestCategory, "cashout"),
    ];
    if (status && status !== "all") {
      conds.push(eq(timeOffRequests.status, status));
    }
    return db.select().from(timeOffRequests)
      .where(and(...conds))
      .orderBy(desc(timeOffRequests.startDate));
  }

  // Incomplete punch rows for the Missing Punches report: a clock-in with no
  // clock-out, within the date range, for the given users.
  async getIncompletePunchesByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
  ): Promise<PunchLog[]> {
    if (userIds.length === 0) return [];
    return db.select().from(punchLogs)
      .where(and(
        inArray(punchLogs.employeeId, userIds),
        gte(punchLogs.workDate, startDate),
        lte(punchLogs.workDate, endDate),
        isNotNull(punchLogs.clockIn),
        isNull(punchLogs.clockOut),
      ))
      .orderBy(desc(punchLogs.workDate));
  }

  // Attendance exception rows for the Exceptions report, scoped to the given
  // users and date range. Optional status filter narrows by exception status.
  async getAttendanceExceptionsByDateRange(
    startDate: string,
    endDate: string,
    userIds: string[],
    status?: string,
  ): Promise<AttendanceException[]> {
    if (userIds.length === 0) return [];
    const conds: SQL[] = [
      inArray(attendanceExceptions.employeeId, userIds),
      gte(attendanceExceptions.exceptionDate, startDate),
      lte(attendanceExceptions.exceptionDate, endDate),
    ];
    if (status && status !== "all") {
      conds.push(eq(attendanceExceptions.status, status));
    }
    return db.select().from(attendanceExceptions)
      .where(and(...conds))
      .orderBy(desc(attendanceExceptions.exceptionDate));
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
    if (!role || Object.keys(role).length === 0) {
      const [existing] = await db.select().from(roles).where(eq(roles.id, id));
      return existing;
    }
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

  async setRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(permissionIds));
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (uniqueIds.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(uniqueIds.map((permissionId) => ({ roleId, permissionId })));
      }
    });
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
    const managerLocIds = userLocationIds(user);
    const managerDeptIds = userDepartmentIds(user);

    if (user.companyId) {
      conditions.push(eq(users.companyId, user.companyId));
    }
    // Membership scope: an employee is in scope if ANY of their location/department
    // assignments (join OR legacy column) overlaps ANY of the manager's scopes.
    if (managerLocIds.length > 0) {
      conditions.push(
        or(
          inArray(users.locationId, managerLocIds),
          inArray(
            users.id,
            db
              .select({ id: employeeLocations.userId })
              .from(employeeLocations)
              .where(inArray(employeeLocations.locationId, managerLocIds)),
          ),
        ),
      );
    }
    if (managerDeptIds.length > 0) {
      conditions.push(
        or(
          inArray(users.departmentId, managerDeptIds),
          inArray(
            users.id,
            db
              .select({ id: employeeDepartments.userId })
              .from(employeeDepartments)
              .where(inArray(employeeDepartments.departmentId, managerDeptIds)),
          ),
        ),
      );
    }

    if (conditions.length === 0) {
      return new Set([user.id]);
    }

    const scopedUsers = await db.select({ id: users.id }).from(users).where(and(...conditions));
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

  /**
   * Resolve the effective PTO policy for a user through the unified policy
   * engine. The engine governs WHICH policy applies (employee → role →
   * department → location → company → global). Per-employee overrides and hire
   * date still live in `employee_pto_settings`. Falls back to the legacy default
   * `pto_policies` row only when the engine resolves nothing (e.g. a database
   * that has not yet been migrated/seeded), so numbers never silently change.
   */
  async getEmployeePtoPolicy(userId: string): Promise<PtoPolicy | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user) {
      const effective = await getEffectivePolicy(user.companyId, userId, "pto", user);
      if (effective) {
        return buildPtoPolicyFromRules(effective.policyId, effective.policyName, effective.rules);
      }
    }
    return this.getDefaultPtoPolicy();
  }

  async computeAnnualVacationEntitlement(userId: string): Promise<number> {
    const policy = await this.getEmployeePtoPolicy(userId);
    const empSettings = await this.getEmployeePtoSettings(userId);
    const currentYear = new Date().getFullYear();

    if (!policy) {
      return empSettings?.vacationHoursOverride ?? 120;
    }

    let annualVacation: number;

    if (policy.accrualType === "per_hours_worked") {
      let waitingEndIso: string | undefined;
      if (empSettings?.hireDate && policy.waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = new Date(hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000);
        waitingEndIso = `${waitingEnd.getUTCFullYear()}-${String(waitingEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(waitingEnd.getUTCDate()).padStart(2, "0")}`;
      }
      const vacationHoursWorked = await this.computeTotalHoursWorked(userId, currentYear, waitingEndIso);
      const threshold = policy.vacationAccrualPerHoursWorked > 0 ? policy.vacationAccrualPerHoursWorked : 30;
      const earnedPerThreshold = policy.vacationAccrualHoursPerThreshold ?? 1;
      const accruedVacationHours = Math.floor(vacationHoursWorked / threshold) * earnedPerThreshold;
      annualVacation = policy.yearlyCapHours != null
        ? Math.min(accruedVacationHours, policy.yearlyCapHours)
        : accruedVacationHours;
    } else {
      annualVacation = policy.accrualHoursPerYear;
    }

    if (empSettings?.vacationHoursOverride !== null && empSettings?.vacationHoursOverride !== undefined) {
      annualVacation = empSettings.vacationHoursOverride;
    }

    if (empSettings?.hireDate && policy.waitingPeriodDays > 0) {
      const hireMs = new Date(empSettings.hireDate).getTime();
      const waitingEnd = hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000;
      if (Date.now() < waitingEnd) {
        return 0;
      }
    }

    return Math.round(annualVacation * 100) / 100;
  }

  async computeTotalHoursWorked(userId: string, year: number, fromDate?: string): Promise<number> {
    const yearStart = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const startDate = fromDate && fromDate > yearStart ? fromDate : yearStart;
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
    const detailed = await this.computeTimeOffBalanceDetailed(userId);
    return {
      vacation: detailed.vacation.remaining,
      sick: detailed.sick.remaining,
      personal: detailed.personal.remaining,
    };
  }

  async computeTimeOffBalanceDetailed(userId: string): Promise<TimeOffBalanceDetailed> {
    const policy = await this.getEmployeePtoPolicy(userId);
    const empSettings = await this.getEmployeePtoSettings(userId);
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;

    let annualVacation: number;
    let annualSick: number;
    let annualPersonal: number;

    if (policy) {
      if (policy.accrualType === "per_hours_worked") {
        let waitingEndIso: string | undefined;
        if (empSettings?.hireDate && policy.waitingPeriodDays > 0) {
          const hireMs = new Date(empSettings.hireDate).getTime();
          const waitingEnd = new Date(hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000);
          waitingEndIso = `${waitingEnd.getUTCFullYear()}-${String(waitingEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(waitingEnd.getUTCDate()).padStart(2, "0")}`;
        }
        const vacationHoursWorked = await this.computeTotalHoursWorked(userId, currentYear, waitingEndIso);
        const threshold = policy.vacationAccrualPerHoursWorked > 0 ? policy.vacationAccrualPerHoursWorked : 30;
        const earnedPerThreshold = policy.vacationAccrualHoursPerThreshold ?? 1;
        const accruedVacationHours = Math.floor(vacationHoursWorked / threshold) * earnedPerThreshold;
        annualVacation = policy.yearlyCapHours != null
          ? Math.min(accruedVacationHours, policy.yearlyCapHours)
          : accruedVacationHours;
      } else {
        annualVacation = policy.accrualHoursPerYear;
      }

      if (policy.sickAccrualEnabled) {
        const hoursWorked = await this.computeTotalHoursWorked(userId, currentYear);
        const accruedSickHours = Math.floor(hoursWorked / policy.sickAccrualPerHoursWorked) * policy.sickAccrualRatePerHours;
        annualSick = Math.min(accruedSickHours, policy.sickYearlyCapHours);
      } else {
        annualSick = 0;
      }

      annualPersonal = policy.personalHoursPerYear;

      if (policy.holidayPayEnabled && policy.holidayPtoDeduction) {
        const holidayRequests = await db.select().from(timeOffRequests)
          .where(and(
            eq(timeOffRequests.userId, userId),
            eq(timeOffRequests.type, "holiday"),
            inArray(timeOffRequests.status, ["approved", "partially_approved"]),
            gte(timeOffRequests.startDate, yearStart),
            lte(timeOffRequests.startDate, yearEnd)
          ));
        let holidayHours = 0;
        for (const r of holidayRequests) {
          const rawHours = r.hoursApproved ?? r.hoursRequested ?? 8;
          if (!isSaneTimeOffHours(rawHours)) {
            console.warn(
              `[time-off balance] skipping corrupt holiday hours ${rawHours} on request ${r.id} (user ${r.userId}).`,
            );
            continue;
          }
          holidayHours += rawHours;
        }
        annualVacation = Math.max(0, annualVacation - holidayHours);
      }

      const carryoverCap = policy.carryoverCapHours ?? 0;
      const expirationDate = policy.expirationDate;
      const effectiveExpiration = expirationDate
        ? new Date(expirationDate + "T00:00:00Z")
        : new Date(Date.UTC(currentYear, 11, 31));

      const now = new Date();
      const hasExpired = now > effectiveExpiration ||
        (effectiveExpiration.getUTCFullYear() < currentYear);

      if (carryoverCap > 0 && !hasExpired) {
        const prevYear = currentYear - 1;
        const prevYearStart = `${prevYear}-01-01`;
        const prevYearEnd = `${prevYear}-12-31`;

        let prevAnnualVacation = policy.accrualHoursPerYear;
        if (empSettings?.vacationHoursOverride !== null && empSettings?.vacationHoursOverride !== undefined) {
          prevAnnualVacation = empSettings.vacationHoursOverride;
        }

        const prevRequests = await db.select().from(timeOffRequests)
          .where(and(
            eq(timeOffRequests.userId, userId),
            inArray(timeOffRequests.status, ["approved", "partially_approved"]),
            gte(timeOffRequests.startDate, prevYearStart),
            lte(timeOffRequests.startDate, prevYearEnd)
          ));

        let prevUsedVacation = 0;
        for (const r of prevRequests) {
          if (r.type === "vacation") {
            prevUsedVacation += r.hoursApproved ?? r.hoursRequested ?? 8;
          }
        }

        const prevRemainingVacation = Math.max(0, prevAnnualVacation - prevUsedVacation);
        const carryover = Math.min(prevRemainingVacation, carryoverCap);
        annualVacation += carryover;
      }
    } else {
      annualVacation = 120;
      annualSick = 80;
      annualPersonal = 40;
    }

    if (empSettings) {
      if (empSettings.vacationHoursOverride !== null && empSettings.vacationHoursOverride !== undefined) {
        const carryoverCap = policy?.carryoverCapHours ?? 0;
        if (carryoverCap > 0 && policy) {
          const baseOverride = empSettings.vacationHoursOverride;
          annualVacation = baseOverride + (annualVacation - (policy?.accrualHoursPerYear ?? baseOverride));
        } else {
          annualVacation = empSettings.vacationHoursOverride;
        }
      }
      if (empSettings.sickHoursOverride !== null && empSettings.sickHoursOverride !== undefined) {
        annualSick = empSettings.sickHoursOverride;
      }
      if (empSettings.personalHoursOverride !== null && empSettings.personalHoursOverride !== undefined) {
        annualPersonal = empSettings.personalHoursOverride;
      }

      if (empSettings.hireDate && policy && policy.waitingPeriodDays > 0) {
        const hireMs = new Date(empSettings.hireDate).getTime();
        const waitingEnd = hireMs + policy.waitingPeriodDays * 24 * 60 * 60 * 1000;
        if (Date.now() < waitingEnd) {
          return {
            vacation: { total: 0, used: 0, remaining: 0 },
            sick: { total: 0, used: 0, remaining: 0 },
            personal: { total: 0, used: 0, remaining: 0 },
          };
        }
      }
    }

    const requests = await db.select().from(timeOffRequests)
      .where(and(
        eq(timeOffRequests.userId, userId),
        gte(timeOffRequests.startDate, yearStart),
        lte(timeOffRequests.startDate, yearEnd)
      ));

    let usedVacation = 0;
    let usedSick = 0;
    let usedPersonal = 0;

    for (const r of requests) {
      if (r.status !== "approved" && r.status !== "partially_approved") continue;
      const rawHours = r.hoursApproved ?? r.hoursRequested ?? 8;
      if (!isSaneTimeOffHours(rawHours)) {
        console.warn(
          `[time-off balance] skipping corrupt hours value ${rawHours} on request ${r.id} (user ${r.userId}, type ${r.type}). Run the cleanup-invalid-hours job.`,
        );
        continue;
      }
      if (r.type === "vacation") usedVacation += rawHours;
      else if (r.type === "sick") usedSick += rawHours;
      else if (r.type === "personal") usedPersonal += rawHours;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      vacation: {
        total: round2(annualVacation),
        used: round2(usedVacation),
        remaining: round2(annualVacation - usedVacation),
      },
      sick: {
        total: round2(annualSick),
        used: round2(usedSick),
        remaining: round2(annualSick - usedSick),
      },
      personal: {
        total: round2(annualPersonal),
        used: round2(usedPersonal),
        remaining: round2(annualPersonal - usedPersonal),
      },
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

  /** Active PTO-type policies selectable as an employee's assigned PTO policy. */
  async getSelectablePtoPolicies(): Promise<Policy[]> {
    const [t] = await db.select().from(policyTypes).where(eq(policyTypes.key, "pto"));
    if (!t) return [];
    return db
      .select()
      .from(policies)
      .where(and(eq(policies.policyTypeId, t.id), eq(policies.status, "active")))
      .orderBy(desc(policies.isSystemDefault), policies.name);
  }

  /**
   * The explicit EMPLOYEE-LEVEL PTO policy assignment for a user, if any (the
   * unified-engine replacement for the legacy employee_pto_settings.pto_policy_id
   * link). Returns undefined when the employee inherits a higher-scope policy.
   */
  async getEmployeePtoAssignment(userId: string): Promise<PolicyAssignment | undefined> {
    const [t] = await db.select().from(policyTypes).where(eq(policyTypes.key, "pto"));
    if (!t) return undefined;
    const rows = await db
      .select({ a: policyAssignments })
      .from(policyAssignments)
      .innerJoin(policies, eq(policyAssignments.policyId, policies.id))
      .where(and(eq(policies.policyTypeId, t.id), eq(policyAssignments.userId, userId)));
    return rows[0]?.a;
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

  async deletePolicy(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(policyAssignments).where(eq(policyAssignments.policyId, id));
      await tx.delete(policyRules).where(eq(policyRules.policyId, id));
      await tx.delete(policies).where(eq(policies.id, id));
    });
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

  async getPolicyAcknowledgmentsByUser(userId: string): Promise<PolicyAcknowledgment[]> {
    return db.select().from(policyAcknowledgments).where(eq(policyAcknowledgments.userId, userId));
  }

  async getPolicyAcknowledgment(policyId: string, userId: string, policyVersion: number): Promise<PolicyAcknowledgment | undefined> {
    const [ack] = await db
      .select()
      .from(policyAcknowledgments)
      .where(
        and(
          eq(policyAcknowledgments.policyId, policyId),
          eq(policyAcknowledgments.userId, userId),
          eq(policyAcknowledgments.policyVersion, policyVersion),
        ),
      );
    return ack;
  }

  async createPolicyAcknowledgment(ack: InsertPolicyAcknowledgment): Promise<PolicyAcknowledgment> {
    const [created] = await db
      .insert(policyAcknowledgments)
      .values(ack)
      .onConflictDoNothing({ target: [policyAcknowledgments.policyId, policyAcknowledgments.userId, policyAcknowledgments.policyVersion] })
      .returning();
    if (created) return created;
    const existing = await this.getPolicyAcknowledgment(ack.policyId, ack.userId, ack.policyVersion);
    return existing!;
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

  async getAuditLogsByUser(
    userId: string,
    options: { limit?: number; offset?: number; startDate?: string; endDate?: string } = {},
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const conditions: any[] = [
      or(eq(auditLogs.actorUserId, userId), eq(auditLogs.targetId, userId)),
    ];
    if (options.startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(options.startDate)));
    }
    if (options.endDate) {
      const endDate = new Date(options.endDate);
      endDate.setDate(endDate.getDate() + 1);
      conditions.push(lte(auditLogs.createdAt, endDate));
    }
    const whereClause = and(...conditions);
    const lim = options.limit ?? 25;
    const off = options.offset ?? 0;

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

  async getLedgerEntriesByEmployee(
    employeeId: string,
    options: { category?: string; startDate?: string; endDate?: string; limit?: number; offset?: number } = {},
  ): Promise<{ entries: AttendanceChangeLedger[]; total: number }> {
    const conditions: any[] = [eq(attendanceChangeLedger.employeeId, employeeId)];
    if (options.category) {
      conditions.push(eq(attendanceChangeLedger.category, options.category));
    }
    if (options.startDate) {
      conditions.push(gte(attendanceChangeLedger.createdAt, new Date(options.startDate)));
    }
    if (options.endDate) {
      const endDate = new Date(options.endDate);
      endDate.setDate(endDate.getDate() + 1);
      conditions.push(lte(attendanceChangeLedger.createdAt, endDate));
    }
    const whereClause = and(...conditions);
    const lim = options.limit ?? 25;
    const off = options.offset ?? 0;

    const [totalResult] = await db
      .select({ count: count() })
      .from(attendanceChangeLedger)
      .where(whereClause);

    const entries = await db
      .select()
      .from(attendanceChangeLedger)
      .where(whereClause)
      .orderBy(desc(attendanceChangeLedger.sequence))
      .limit(lim)
      .offset(off);

    return { entries, total: totalResult?.count || 0 };
  }

  async createUser(user: UpsertUser): Promise<User> {
    const payload = { ...user };
    if (payload.email !== undefined) {
      payload.email = normalizeEmail(payload.email);
    }
    const [created] = await db.insert(users).values(payload).returning();
    return created;
  }

  async updateUser(id: string, data: Partial<UpsertUser>): Promise<User | undefined> {
    const payload: Partial<UpsertUser> = { ...data };
    if (payload.email !== undefined) {
      payload.email = normalizeEmail(payload.email);
    }
    const [updated] = await db.update(users).set({ ...payload, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    // Hard-delete a user account. Used by the admin bulk-delete flow for cleaning
    // up test/duplicate accounts. Runs inside a transaction so partial cleanup
    // is rolled back on FK violation. Pre-cleans well-known auth/profile child
    // tables that any user may have; remaining child rows (attendance, documents,
    // payroll, audit history, etc.) intentionally surface as FK errors so real
    // employees with data must go through the offboarding/deactivation flow.
    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      await tx.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, id));
      await tx.delete(userAccessScopes).where(eq(userAccessScopes.userId, id));
      await tx.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, id));
      await tx.delete(employeePins).where(eq(employeePins.userId, id));
      await tx.delete(employeePtoSettings).where(eq(employeePtoSettings.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
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
    const templateId = schedule.scheduleTemplateId !== undefined ? schedule.scheduleTemplateId : null;
    if (existing.length > 0) {
      const [updated] = await db.update(employeeSchedules)
        .set({
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          isActive: schedule.isActive ?? true,
          scheduleTemplateId: templateId,
        })
        .where(eq(employeeSchedules.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(employeeSchedules).values({ ...schedule, scheduleTemplateId: templateId }).returning();
    return created;
  }

  async deleteEmployeeSchedules(employeeId: string): Promise<void> {
    await db.delete(employeeSchedules).where(eq(employeeSchedules.employeeId, employeeId));
  }

  async getPayrollDocumentsByEmployee(employeeId: string): Promise<PayrollDocument[]> {
    return db.select().from(payrollDocuments).where(eq(payrollDocuments.employeeId, employeeId)).orderBy(desc(payrollDocuments.uploadedAt));
  }

  async getAllPayrollDocuments(): Promise<PayrollDocument[]> {
    return db.select().from(payrollDocuments).orderBy(desc(payrollDocuments.uploadedAt));
  }

  async getPayrollDocument(id: string): Promise<PayrollDocument | undefined> {
    const [doc] = await db.select().from(payrollDocuments).where(eq(payrollDocuments.id, id));
    return doc;
  }

  async createPayrollDocument(doc: InsertPayrollDocument): Promise<PayrollDocument> {
    const [created] = await db.insert(payrollDocuments).values(doc).returning();
    return created;
  }

  async deletePayrollDocument(id: string): Promise<void> {
    await db.delete(payrollDocuments).where(eq(payrollDocuments.id, id));
  }

  async getWorkflow(id: string): Promise<Workflow | undefined> {
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
    return workflow;
  }

  async getAllWorkflows(): Promise<Workflow[]> {
    return db.select().from(workflows).orderBy(desc(workflows.createdAt));
  }

  async getWorkflowsByTriggerType(triggerType: string): Promise<Workflow[]> {
    return db.select().from(workflows).where(and(eq(workflows.triggerType, triggerType), eq(workflows.status, "active")));
  }

  async createWorkflow(workflow: InsertWorkflow): Promise<Workflow> {
    const [created] = await db.insert(workflows).values(workflow).returning();
    return created;
  }

  async updateWorkflow(id: string, workflow: Partial<InsertWorkflow>): Promise<Workflow | undefined> {
    const [updated] = await db.update(workflows).set({ ...workflow, updatedAt: new Date() }).where(eq(workflows.id, id)).returning();
    return updated;
  }

  async deleteWorkflow(id: string): Promise<void> {
    await db.delete(workflows).where(eq(workflows.id, id));
  }

  async listPtoAnniversaryAdjustments(employeeId: string): Promise<PtoAnniversaryAdjustment[]> {
    return db
      .select()
      .from(ptoAnniversaryAdjustments)
      .where(eq(ptoAnniversaryAdjustments.employeeId, employeeId))
      .orderBy(desc(ptoAnniversaryAdjustments.effectiveDate));
  }

  async recordPtoAnniversaryAdjustment(
    data: InsertPtoAnniversaryAdjustment,
  ): Promise<PtoAnniversaryAdjustment | undefined> {
    const inserted = await db
      .insert(ptoAnniversaryAdjustments)
      .values(data)
      .onConflictDoNothing({
        target: [
          ptoAnniversaryAdjustments.employeeId,
          ptoAnniversaryAdjustments.effectiveDate,
        ],
      })
      .returning();
    return inserted[0];
  }

  async getReviewCycle(id: string): Promise<PerformanceReviewCycle | undefined> {
    const [cycle] = await db
      .select()
      .from(performanceReviewCycles)
      .where(eq(performanceReviewCycles.id, id));
    return cycle;
  }

  async getReviewCycles(
    filters?: { companyId?: string | null; isActive?: boolean },
  ): Promise<PerformanceReviewCycle[]> {
    const conds: any[] = [];
    if (filters?.companyId !== undefined) {
      conds.push(
        filters.companyId === null
          ? isNull(performanceReviewCycles.companyId)
          : eq(performanceReviewCycles.companyId, filters.companyId),
      );
    }
    if (filters?.isActive !== undefined) {
      conds.push(eq(performanceReviewCycles.isActive, filters.isActive));
    }
    const where = conds.length ? and(...conds) : undefined;
    return db
      .select()
      .from(performanceReviewCycles)
      .where(where)
      .orderBy(desc(performanceReviewCycles.createdAt));
  }

  async createReviewCycle(data: InsertPerformanceReviewCycle): Promise<PerformanceReviewCycle> {
    const [created] = await db.insert(performanceReviewCycles).values(data).returning();
    return created;
  }

  async updateReviewCycle(
    id: string,
    data: Partial<InsertPerformanceReviewCycle>,
  ): Promise<PerformanceReviewCycle | undefined> {
    const [updated] = await db
      .update(performanceReviewCycles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(performanceReviewCycles.id, id))
      .returning();
    return updated;
  }

  async getRoleAssignmentRule(id: string): Promise<RoleAssignmentRule | undefined> {
    const [rule] = await db.select().from(roleAssignmentRules).where(eq(roleAssignmentRules.id, id));
    return rule;
  }

  async getAllRoleAssignmentRules(): Promise<RoleAssignmentRule[]> {
    return db.select().from(roleAssignmentRules)
      .orderBy(roleAssignmentRules.priority, roleAssignmentRules.createdAt);
  }

  async getActiveRoleAssignmentRules(): Promise<RoleAssignmentRule[]> {
    return db.select().from(roleAssignmentRules)
      .where(eq(roleAssignmentRules.isActive, true))
      .orderBy(roleAssignmentRules.priority, roleAssignmentRules.createdAt);
  }

  async createRoleAssignmentRule(rule: InsertRoleAssignmentRule): Promise<RoleAssignmentRule> {
    const [created] = await db.insert(roleAssignmentRules).values(rule).returning();
    return created;
  }

  async updateRoleAssignmentRule(id: string, rule: Partial<InsertRoleAssignmentRule>): Promise<RoleAssignmentRule | undefined> {
    const [updated] = await db.update(roleAssignmentRules)
      .set({ ...rule, updatedAt: new Date() })
      .where(eq(roleAssignmentRules.id, id))
      .returning();
    return updated;
  }

  async getCertification(id: string): Promise<Certification | undefined> {
    const [cert] = await db.select().from(certifications).where(eq(certifications.id, id));
    return cert;
  }

  async getCertificationsByEmployee(employeeId: string): Promise<Certification[]> {
    return db
      .select()
      .from(certifications)
      .where(eq(certifications.employeeId, employeeId))
      .orderBy(desc(certifications.createdAt));
  }

  async getAllCertifications(filters?: { status?: string }): Promise<Certification[]> {
    const conditions: SQL[] = [];
    if (filters?.status) conditions.push(eq(certifications.status, filters.status));
    if (conditions.length > 0) {
      return db
        .select()
        .from(certifications)
        .where(and(...conditions))
        .orderBy(desc(certifications.createdAt));
    }
    return db.select().from(certifications).orderBy(desc(certifications.createdAt));
  }

  async createCertification(data: InsertCertification): Promise<Certification> {
    const [created] = await db.insert(certifications).values(data).returning();
    return created;
  }

  async updateCertification(id: string, data: Partial<InsertCertification>): Promise<Certification | undefined> {
    const [updated] = await db
      .update(certifications)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(certifications.id, id))
      .returning();
    return updated;
  }

  async getReviewReminder(id: string): Promise<PerformanceReviewReminder | undefined> {
    const [r] = await db
      .select()
      .from(performanceReviewReminders)
      .where(eq(performanceReviewReminders.id, id));
    return r;
  }

  async listReviewReminders(
    filters?: { employeeId?: string; status?: string; cycleId?: string },
  ): Promise<PerformanceReviewReminder[]> {
    const conds: any[] = [];
    if (filters?.employeeId) conds.push(eq(performanceReviewReminders.employeeId, filters.employeeId));
    if (filters?.status) conds.push(eq(performanceReviewReminders.status, filters.status));
    if (filters?.cycleId) conds.push(eq(performanceReviewReminders.cycleId, filters.cycleId));
    const where = conds.length ? and(...conds) : undefined;
    return db
      .select()
      .from(performanceReviewReminders)
      .where(where)
      .orderBy(performanceReviewReminders.dueDate);
  }

  async upsertReviewReminder(
    data: InsertPerformanceReviewReminder,
  ): Promise<PerformanceReviewReminder> {
    const inserted = await db
      .insert(performanceReviewReminders)
      .values(data)
      .onConflictDoNothing({
        target: [
          performanceReviewReminders.employeeId,
          performanceReviewReminders.cycleId,
          performanceReviewReminders.dueDate,
        ],
      })
      .returning();
    if (inserted[0]) return inserted[0];
    const [existing] = await db
      .select()
      .from(performanceReviewReminders)
      .where(
        and(
          eq(performanceReviewReminders.employeeId, data.employeeId),
          eq(performanceReviewReminders.cycleId, data.cycleId),
          eq(performanceReviewReminders.dueDate, data.dueDate),
        ),
      );
    return existing;
  }

  async updateReviewReminder(
    id: string,
    data: { status: string; completedBy?: string; notes?: string },
  ): Promise<PerformanceReviewReminder | undefined> {
    const setData: Record<string, unknown> = { status: data.status };
    if (data.notes !== undefined) setData.notes = data.notes;
    if (data.status === "completed" || data.status === "skipped") {
      setData.completedAt = new Date();
      if (data.completedBy) setData.completedBy = data.completedBy;
    }
    const [updated] = await db
      .update(performanceReviewReminders)
      .set(setData)
      .where(eq(performanceReviewReminders.id, id))
      .returning();
    return updated;
  }

  async deleteRoleAssignmentRule(id: string): Promise<void> {
    // Soft delete: mark inactive so it stops evaluating but historical
    // references (e.g. audit logs that cite this rule by id/name) still
    // resolve. Use updateRoleAssignmentRule semantics for consistency.
    await db.update(roleAssignmentRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(roleAssignmentRules.id, id));
  }

  async getScheduleTemplate(id: string): Promise<ScheduleTemplate | undefined> {
    const [template] = await db.select().from(scheduleTemplates).where(eq(scheduleTemplates.id, id));
    return template;
  }

  async getAllScheduleTemplates(): Promise<ScheduleTemplate[]> {
    // Returns all templates (active + inactive) so admin UI can manage and
    // potentially reactivate soft-deleted templates. The /apply endpoint
    // independently rejects inactive templates.
    return db.select().from(scheduleTemplates).orderBy(desc(scheduleTemplates.createdAt));
  }

  async getScheduleTemplatesByCompany(companyId: string | null): Promise<ScheduleTemplate[]> {
    if (companyId === null) {
      return db.select().from(scheduleTemplates)
        .where(isNull(scheduleTemplates.companyId))
        .orderBy(desc(scheduleTemplates.createdAt));
    }
    return db.select().from(scheduleTemplates)
      .where(or(eq(scheduleTemplates.companyId, companyId), isNull(scheduleTemplates.companyId)))
      .orderBy(desc(scheduleTemplates.createdAt));
  }

  async createScheduleTemplate(template: InsertScheduleTemplate): Promise<ScheduleTemplate> {
    const [created] = await db.insert(scheduleTemplates).values(template).returning();
    return created;
  }

  async updateScheduleTemplate(id: string, template: Partial<InsertScheduleTemplate>): Promise<ScheduleTemplate | undefined> {
    const [updated] = await db.update(scheduleTemplates)
      .set({ ...template, updatedAt: new Date() })
      .where(eq(scheduleTemplates.id, id))
      .returning();
    return updated;
  }

  async deleteCertification(id: string): Promise<void> {
    await db
      .update(certifications)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(certifications.id, id));
  }

  async getRequiredDocumentRule(id: string): Promise<RequiredDocumentRule | undefined> {
    const [rule] = await db.select().from(requiredDocumentRules).where(eq(requiredDocumentRules.id, id));
    return rule;
  }

  async getAllRequiredDocumentRules(filters?: { documentType?: string; isActive?: boolean; scopeType?: string }): Promise<RequiredDocumentRule[]> {
    const conditions: SQL[] = [];
    if (filters?.documentType) conditions.push(eq(requiredDocumentRules.documentType, filters.documentType));
    if (filters?.isActive !== undefined) conditions.push(eq(requiredDocumentRules.isActive, filters.isActive));
    if (filters?.scopeType) conditions.push(eq(requiredDocumentRules.scopeType, filters.scopeType));
    if (conditions.length > 0) {
      return db
        .select()
        .from(requiredDocumentRules)
        .where(and(...conditions))
        .orderBy(desc(requiredDocumentRules.createdAt));
    }
    return db.select().from(requiredDocumentRules).orderBy(desc(requiredDocumentRules.createdAt));
  }

  async createRequiredDocumentRule(data: InsertRequiredDocumentRule): Promise<RequiredDocumentRule> {
    const [created] = await db.insert(requiredDocumentRules).values(data).returning();
    return created;
  }

  async updateRequiredDocumentRule(id: string, data: Partial<InsertRequiredDocumentRule>): Promise<RequiredDocumentRule | undefined> {
    const [updated] = await db
      .update(requiredDocumentRules)
      .set(data)
      .where(eq(requiredDocumentRules.id, id))
      .returning();
    return updated;
  }

  async resolveReviewDueAlertsFor(
    reminderId: string,
    resolverUserId: string,
  ): Promise<number> {
    const open = await db
      .select()
      .from(systemAlerts)
      .where(
        and(
          eq(systemAlerts.type, "review_due"),
          inArray(systemAlerts.status, ["open", "acknowledged"]),
        ),
      );
    let count = 0;
    for (const alert of open) {
      const details = (alert.details as Record<string, unknown> | null) || {};
      if (details.reminderId === reminderId) {
        await db
          .update(systemAlerts)
          .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: resolverUserId })
          .where(eq(systemAlerts.id, alert.id));
        count += 1;
      }
    }
    return count;
  }

  async deleteScheduleTemplate(id: string): Promise<void> {
    // Soft delete: mark inactive so that linked employee_schedules rows
    // keep their scheduleTemplateId reference (linkage history is
    // preserved). Inactive templates are filtered out in the UI list and
    // rejected by /apply.
    await db.update(scheduleTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(scheduleTemplates.id, id));
  }

  async getScheduleTemplateDays(templateId: string): Promise<ScheduleTemplateDay[]> {
    return db.select().from(scheduleTemplateDays)
      .where(eq(scheduleTemplateDays.templateId, templateId))
      .orderBy(scheduleTemplateDays.dayOfWeek);
  }

  async replaceScheduleTemplateDays(templateId: string, days: Omit<InsertScheduleTemplateDay, "templateId">[]): Promise<ScheduleTemplateDay[]> {
    await db.delete(scheduleTemplateDays).where(eq(scheduleTemplateDays.templateId, templateId));
    if (days.length === 0) return [];
    const rows = days.map(d => ({ ...d, templateId }));
    return db.insert(scheduleTemplateDays).values(rows).returning();
  }

  async getAllEmploymentProfiles(): Promise<EmploymentProfile[]> {
    return db.select().from(userEmploymentProfiles);
  }

  // Batched replacement for the per-user getEmploymentProfile loop (N+1) in
  // report generation: fetch every needed profile in a single query keyed by
  // user id.
  async getEmploymentProfilesByUserIds(userIds: string[]): Promise<Map<string, EmploymentProfile>> {
    const result = new Map<string, EmploymentProfile>();
    if (userIds.length === 0) return result;
    const rows = await db
      .select()
      .from(userEmploymentProfiles)
      .where(inArray(userEmploymentProfiles.userId, userIds));
    for (const r of rows) result.set(r.userId, r);
    return result;
  }

  async deleteRequiredDocumentRule(id: string): Promise<void> {
    await db
      .update(requiredDocumentRules)
      .set({ isActive: false })
      .where(eq(requiredDocumentRules.id, id));
  }

  // ===== Onboarding templates =====
  async getOnboardingTemplate(id: string): Promise<OnboardingTemplate | undefined> {
    const [t] = await db.select().from(onboardingTemplates).where(eq(onboardingTemplates.id, id));
    return t;
  }

  async getOnboardingTemplates(filters: { companyId?: string | null; isActive?: boolean }): Promise<OnboardingTemplate[]> {
    const conds: any[] = [];
    if (filters.companyId === null) conds.push(isNull(onboardingTemplates.companyId));
    else if (filters.companyId) conds.push(or(eq(onboardingTemplates.companyId, filters.companyId), isNull(onboardingTemplates.companyId)));
    if (filters.isActive !== undefined) conds.push(eq(onboardingTemplates.isActive, filters.isActive));
    return await db.select().from(onboardingTemplates).where(conds.length ? and(...conds) : sql`true`).orderBy(desc(onboardingTemplates.isDefault), onboardingTemplates.name);
  }

  async getDefaultOnboardingTemplate(companyId: string | null): Promise<OnboardingTemplate | undefined> {
    if (companyId) {
      const [scoped] = await db.select().from(onboardingTemplates).where(and(eq(onboardingTemplates.companyId, companyId), eq(onboardingTemplates.isDefault, true), eq(onboardingTemplates.isActive, true)));
      if (scoped) return scoped;
    }
    const [global] = await db.select().from(onboardingTemplates).where(and(isNull(onboardingTemplates.companyId), eq(onboardingTemplates.isDefault, true), eq(onboardingTemplates.isActive, true)));
    return global;
  }

  async createOnboardingTemplate(data: InsertOnboardingTemplate): Promise<OnboardingTemplate> {
    if (data.isDefault) {
      await db.update(onboardingTemplates).set({ isDefault: false, updatedAt: new Date() }).where(data.companyId ? eq(onboardingTemplates.companyId, data.companyId) : isNull(onboardingTemplates.companyId));
    }
    const [created] = await db.insert(onboardingTemplates).values(data).returning();
    return created;
  }

  async updateOnboardingTemplate(id: string, data: Partial<InsertOnboardingTemplate>): Promise<OnboardingTemplate | undefined> {
    if (data.isDefault) {
      const [existing] = await db.select().from(onboardingTemplates).where(eq(onboardingTemplates.id, id));
      if (existing) {
        await db.update(onboardingTemplates).set({ isDefault: false, updatedAt: new Date() }).where(and(existing.companyId ? eq(onboardingTemplates.companyId, existing.companyId) : isNull(onboardingTemplates.companyId), ne(onboardingTemplates.id, id)));
      }
    }
    const [updated] = await db.update(onboardingTemplates).set({ ...data, updatedAt: new Date() }).where(eq(onboardingTemplates.id, id)).returning();
    return updated;
  }

  async getOnboardingTemplateTasks(templateId: string): Promise<OnboardingTemplateTask[]> {
    return await db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.templateId, templateId)).orderBy(onboardingTemplateTasks.sortOrder, onboardingTemplateTasks.createdAt);
  }

  async getOnboardingTemplateTask(id: string): Promise<OnboardingTemplateTask | undefined> {
    const [t] = await db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.id, id));
    return t;
  }

  async createOnboardingTemplateTask(data: InsertOnboardingTemplateTask): Promise<OnboardingTemplateTask> {
    const [created] = await db.insert(onboardingTemplateTasks).values(data as any).returning();
    return created;
  }

  async updateOnboardingTemplateTask(id: string, data: Partial<InsertOnboardingTemplateTask>): Promise<OnboardingTemplateTask | undefined> {
    const [updated] = await db.update(onboardingTemplateTasks).set(data as any).where(eq(onboardingTemplateTasks.id, id)).returning();
    return updated;
  }

  async deleteOnboardingTemplateTask(id: string): Promise<void> {
    await db.delete(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.id, id));
  }

  // ===== Onboarding checklists / tasks =====
  async getOnboardingChecklist(id: string): Promise<OnboardingChecklist | undefined> {
    const [c] = await db.select().from(onboardingChecklists).where(eq(onboardingChecklists.id, id));
    return c;
  }

  async getOnboardingChecklistByEmployee(employeeId: string): Promise<OnboardingChecklist | undefined> {
    const [c] = await db.select().from(onboardingChecklists).where(eq(onboardingChecklists.employeeId, employeeId)).orderBy(desc(onboardingChecklists.startedAt)).limit(1);
    return c;
  }

  async listOnboardingChecklists(filters: { status?: string; employeeIds?: string[] }): Promise<OnboardingChecklist[]> {
    const conds: any[] = [];
    if (filters.status) conds.push(eq(onboardingChecklists.status, filters.status));
    if (filters.employeeIds) {
      if (filters.employeeIds.length === 0) return [];
      conds.push(inArray(onboardingChecklists.employeeId, filters.employeeIds));
    }
    return await db.select().from(onboardingChecklists).where(conds.length ? and(...conds) : sql`true`).orderBy(desc(onboardingChecklists.startedAt));
  }

  async createOnboardingChecklistRow(data: InsertOnboardingChecklist): Promise<OnboardingChecklist> {
    const [created] = await db.insert(onboardingChecklists).values(data).returning();
    return created;
  }

  async createOnboardingTaskRow(data: InsertOnboardingTask & { completedBy?: string | null; completedAt?: Date | null }): Promise<OnboardingTask> {
    const { completedBy, completedAt, ...rest } = data;
    const [created] = await db.insert(onboardingTasks).values({ ...rest, completedBy: completedBy ?? null, completedAt: completedAt ?? null } as any).returning();
    return created;
  }

  async getOnboardingTasks(checklistId: string): Promise<OnboardingTask[]> {
    return await db.select().from(onboardingTasks).where(eq(onboardingTasks.checklistId, checklistId)).orderBy(onboardingTasks.sortOrder, onboardingTasks.createdAt);
  }

  async getOnboardingTask(id: string): Promise<OnboardingTask | undefined> {
    const [t] = await db.select().from(onboardingTasks).where(eq(onboardingTasks.id, id));
    return t;
  }

  async updateOnboardingTask(id: string, data: { status?: string; skippedReason?: string | null; completedBy?: string | null; completedAt?: Date | null; notes?: string | null; documentId?: string | null }): Promise<OnboardingTask | undefined> {
    const [updated] = await db.update(onboardingTasks).set({ ...data, updatedAt: new Date() }).where(eq(onboardingTasks.id, id)).returning();
    return updated;
  }

  async cancelOnboardingChecklist(id: string, reason: string, actorUserId: string): Promise<OnboardingChecklist | undefined> {
    const [updated] = await db.update(onboardingChecklists).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actorUserId, cancelReason: reason }).where(eq(onboardingChecklists.id, id)).returning();
    return updated;
  }

  async completeOnboardingChecklistIfFinished(checklistId: string): Promise<OnboardingChecklist | undefined> {
    const tasks = await this.getOnboardingTasks(checklistId);
    const requiredOpen = tasks.filter(t => t.isRequired && t.status !== "completed" && t.status !== "skipped");
    if (requiredOpen.length === 0 && tasks.length > 0) {
      const [updated] = await db.update(onboardingChecklists).set({ status: "completed", completedAt: new Date() }).where(and(eq(onboardingChecklists.id, checklistId), ne(onboardingChecklists.status, "completed"))).returning();
      return updated;
    }
    return undefined;
  }

  async computeOnboardingProgress(checklistId: string): Promise<{ progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number }> {
    const tasks = await this.getOnboardingTasks(checklistId);
    const required = tasks.filter(t => t.isRequired);
    const optional = tasks.filter(t => !t.isRequired);
    const completedRequired = required.filter(t => t.status === "completed" || t.status === "skipped").length;
    const optionalCompleted = optional.filter(t => t.status === "completed" || t.status === "skipped").length;
    const totalRequired = required.length;
    const progressPct = totalRequired === 0 ? 100 : Math.round((completedRequired / totalRequired) * 100);
    return { progressPct, completedRequired, totalRequired, optionalCompleted, optionalTotal: optional.length };
  }

  // ===== Offboarding templates =====
  async getOffboardingTemplate(id: string): Promise<OffboardingTemplate | undefined> {
    const [t] = await db.select().from(offboardingTemplates).where(eq(offboardingTemplates.id, id));
    return t;
  }

  async getOffboardingTemplates(filters: { companyId?: string | null; isActive?: boolean }): Promise<OffboardingTemplate[]> {
    const conds: any[] = [];
    if (filters.companyId === null) conds.push(isNull(offboardingTemplates.companyId));
    else if (filters.companyId) conds.push(or(eq(offboardingTemplates.companyId, filters.companyId), isNull(offboardingTemplates.companyId)));
    if (filters.isActive !== undefined) conds.push(eq(offboardingTemplates.isActive, filters.isActive));
    return await db.select().from(offboardingTemplates).where(conds.length ? and(...conds) : sql`true`).orderBy(desc(offboardingTemplates.isDefault), offboardingTemplates.name);
  }

  async getDefaultOffboardingTemplate(companyId: string | null): Promise<OffboardingTemplate | undefined> {
    if (companyId) {
      const [scoped] = await db.select().from(offboardingTemplates).where(and(eq(offboardingTemplates.companyId, companyId), eq(offboardingTemplates.isDefault, true), eq(offboardingTemplates.isActive, true)));
      if (scoped) return scoped;
    }
    const [global] = await db.select().from(offboardingTemplates).where(and(isNull(offboardingTemplates.companyId), eq(offboardingTemplates.isDefault, true), eq(offboardingTemplates.isActive, true)));
    return global;
  }

  async createOffboardingTemplate(data: InsertOffboardingTemplate): Promise<OffboardingTemplate> {
    if (data.isDefault) {
      await db.update(offboardingTemplates).set({ isDefault: false, updatedAt: new Date() }).where(data.companyId ? eq(offboardingTemplates.companyId, data.companyId) : isNull(offboardingTemplates.companyId));
    }
    const [created] = await db.insert(offboardingTemplates).values(data).returning();
    return created;
  }

  async updateOffboardingTemplate(id: string, data: Partial<InsertOffboardingTemplate>): Promise<OffboardingTemplate | undefined> {
    if (data.isDefault) {
      const [existing] = await db.select().from(offboardingTemplates).where(eq(offboardingTemplates.id, id));
      if (existing) {
        await db.update(offboardingTemplates).set({ isDefault: false, updatedAt: new Date() }).where(and(existing.companyId ? eq(offboardingTemplates.companyId, existing.companyId) : isNull(offboardingTemplates.companyId), ne(offboardingTemplates.id, id)));
      }
    }
    const [updated] = await db.update(offboardingTemplates).set({ ...data, updatedAt: new Date() }).where(eq(offboardingTemplates.id, id)).returning();
    return updated;
  }

  async getOffboardingTemplateTasks(templateId: string): Promise<OffboardingTemplateTask[]> {
    return await db.select().from(offboardingTemplateTasks).where(eq(offboardingTemplateTasks.templateId, templateId)).orderBy(offboardingTemplateTasks.sortOrder, offboardingTemplateTasks.createdAt);
  }

  async getOffboardingTemplateTask(id: string): Promise<OffboardingTemplateTask | undefined> {
    const [t] = await db.select().from(offboardingTemplateTasks).where(eq(offboardingTemplateTasks.id, id));
    return t;
  }

  async createOffboardingTemplateTask(data: InsertOffboardingTemplateTask): Promise<OffboardingTemplateTask> {
    const [created] = await db.insert(offboardingTemplateTasks).values(data as any).returning();
    return created;
  }

  async updateOffboardingTemplateTask(id: string, data: Partial<InsertOffboardingTemplateTask>): Promise<OffboardingTemplateTask | undefined> {
    const [updated] = await db.update(offboardingTemplateTasks).set(data as any).where(eq(offboardingTemplateTasks.id, id)).returning();
    return updated;
  }

  async deleteOffboardingTemplateTask(id: string): Promise<void> {
    await db.delete(offboardingTemplateTasks).where(eq(offboardingTemplateTasks.id, id));
  }

  // ===== Offboarding checklists / tasks =====
  async getOffboardingChecklist(id: string): Promise<OffboardingChecklist | undefined> {
    const [c] = await db.select().from(offboardingChecklists).where(eq(offboardingChecklists.id, id));
    return c;
  }

  async getOffboardingChecklistByEmployee(employeeId: string): Promise<OffboardingChecklist | undefined> {
    const [c] = await db.select().from(offboardingChecklists).where(eq(offboardingChecklists.employeeId, employeeId)).orderBy(desc(offboardingChecklists.startedAt)).limit(1);
    return c;
  }

  async listOffboardingChecklists(filters: { status?: string; employeeIds?: string[] }): Promise<OffboardingChecklist[]> {
    const conds: any[] = [];
    if (filters.status) conds.push(eq(offboardingChecklists.status, filters.status));
    if (filters.employeeIds) {
      if (filters.employeeIds.length === 0) return [];
      conds.push(inArray(offboardingChecklists.employeeId, filters.employeeIds));
    }
    return await db.select().from(offboardingChecklists).where(conds.length ? and(...conds) : sql`true`).orderBy(desc(offboardingChecklists.startedAt));
  }

  async createOffboardingChecklistRow(data: InsertOffboardingChecklist): Promise<OffboardingChecklist> {
    const [created] = await db.insert(offboardingChecklists).values(data).returning();
    return created;
  }

  async createOffboardingTaskRow(data: InsertOffboardingTask & { completedBy?: string | null; completedAt?: Date | null }): Promise<OffboardingTask> {
    const { completedBy, completedAt, ...rest } = data;
    const [created] = await db.insert(offboardingTasks).values({ ...rest, completedBy: completedBy ?? null, completedAt: completedAt ?? null } as any).returning();
    return created;
  }

  async getOffboardingTasks(checklistId: string): Promise<OffboardingTask[]> {
    return await db.select().from(offboardingTasks).where(eq(offboardingTasks.checklistId, checklistId)).orderBy(offboardingTasks.sortOrder, offboardingTasks.createdAt);
  }

  async getOffboardingTask(id: string): Promise<OffboardingTask | undefined> {
    const [t] = await db.select().from(offboardingTasks).where(eq(offboardingTasks.id, id));
    return t;
  }

  async updateOffboardingTask(id: string, data: { status?: string; skippedReason?: string | null; completedBy?: string | null; completedAt?: Date | null; notes?: string | null }): Promise<OffboardingTask | undefined> {
    const [updated] = await db.update(offboardingTasks).set({ ...data, updatedAt: new Date() }).where(eq(offboardingTasks.id, id)).returning();
    return updated;
  }

  async setOffboardingChecklistDeactivation(id: string, actorUserId: string): Promise<OffboardingChecklist | undefined> {
    const now = new Date();
    const [updated] = await db.update(offboardingChecklists).set({ status: "completed", completedAt: now, accountDeactivatedAt: now, accountDeactivatedBy: actorUserId }).where(eq(offboardingChecklists.id, id)).returning();
    return updated;
  }

  async setUserDeactivated(userId: string, _actorUserId: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ deactivatedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return updated;
  }

  async clearUserDeactivated(userId: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ deactivatedAt: null, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return updated;
  }

  async computeOffboardingProgress(checklistId: string): Promise<{ progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number }> {
    const tasks = await this.getOffboardingTasks(checklistId);
    const required = tasks.filter(t => t.isRequired);
    const optional = tasks.filter(t => !t.isRequired);
    const completedRequired = required.filter(t => t.status === "completed" || t.status === "skipped").length;
    const optionalCompleted = optional.filter(t => t.status === "completed" || t.status === "skipped").length;
    const totalRequired = required.length;
    const progressPct = totalRequired === 0 ? 100 : Math.round((completedRequired / totalRequired) * 100);
    return { progressPct, completedRequired, totalRequired, optionalCompleted, optionalTotal: optional.length };
  }

  // ===== Flexible lifecycle (sections / scopes / suggest / propagate) =====

  async deleteOnboardingTemplate(id: string): Promise<void> {
    await db.update(onboardingChecklists).set({ templateId: null }).where(eq(onboardingChecklists.templateId, id));
    await db.delete(onboardingTemplates).where(eq(onboardingTemplates.id, id));
  }

  async duplicateOnboardingTemplate(id: string, actorUserId: string): Promise<OnboardingTemplate | undefined> {
    const src = await this.getOnboardingTemplate(id);
    if (!src) return undefined;
    const [created] = await db.insert(onboardingTemplates).values({
      companyId: src.companyId,
      name: `${src.name} (copy)`,
      description: src.description,
      isDefault: false,
      isActive: src.isActive,
      createdBy: actorUserId,
    }).returning();
    const sections = await this.getOnboardingTemplateSections(id);
    const sectionIdMap = new Map<string, string>();
    for (const s of sections) {
      const [ns] = await db.insert(onboardingTemplateSections).values({
        templateId: created.id, title: s.title, description: s.description, sortOrder: s.sortOrder,
      }).returning();
      sectionIdMap.set(s.id, ns.id);
    }
    const tasks = await this.getOnboardingTemplateTasks(id);
    for (const t of tasks) {
      const { id: _id, createdAt: _ca, templateId: _tid, ...rest } = t as any;
      await db.insert(onboardingTemplateTasks).values({
        ...rest,
        templateId: created.id,
        sectionId: t.sectionId ? sectionIdMap.get(t.sectionId) ?? null : null,
      });
    }
    const scopes = await this.getOnboardingTemplateScopes(id);
    if (scopes.length > 0) {
      await db.insert(onboardingTemplateScopes).values(
        scopes.map(s => ({ templateId: created.id, scopeKind: s.scopeKind, scopeRef: s.scopeRef })),
      );
    }
    return created;
  }

  async getOnboardingTemplateSections(templateId: string): Promise<OnboardingTemplateSection[]> {
    return await db.select().from(onboardingTemplateSections).where(eq(onboardingTemplateSections.templateId, templateId)).orderBy(onboardingTemplateSections.sortOrder, onboardingTemplateSections.createdAt);
  }
  async createOnboardingTemplateSection(data: InsertOnboardingTemplateSection): Promise<OnboardingTemplateSection> {
    const [created] = await db.insert(onboardingTemplateSections).values(data).returning();
    return created;
  }
  async updateOnboardingTemplateSection(id: string, data: Partial<InsertOnboardingTemplateSection>): Promise<OnboardingTemplateSection | undefined> {
    const [updated] = await db.update(onboardingTemplateSections).set(data).where(eq(onboardingTemplateSections.id, id)).returning();
    return updated;
  }
  async deleteOnboardingTemplateSection(id: string): Promise<void> {
    await db.delete(onboardingTemplateSections).where(eq(onboardingTemplateSections.id, id));
  }

  async getOnboardingTemplateScopes(templateId: string): Promise<OnboardingTemplateScope[]> {
    return await db.select().from(onboardingTemplateScopes).where(eq(onboardingTemplateScopes.templateId, templateId));
  }
  async setOnboardingTemplateScopes(templateId: string, scopes: { scopeKind: string; scopeRef: string }[]): Promise<OnboardingTemplateScope[]> {
    await db.delete(onboardingTemplateScopes).where(eq(onboardingTemplateScopes.templateId, templateId));
    if (scopes.length === 0) return [];
    return await db.insert(onboardingTemplateScopes).values(scopes.map(s => ({ templateId, scopeKind: s.scopeKind, scopeRef: s.scopeRef }))).returning();
  }

  async suggestOnboardingTemplatesForEmployee(employee: User): Promise<Array<OnboardingTemplate & { matchScore: number; matchReasons: string[] }>> {
    const candidates = await this.getOnboardingTemplates({ companyId: employee.companyId ?? null, isActive: true });
    const profile = await this.getEmploymentProfile?.(employee.id).catch(() => undefined);
    const employmentType = (profile as any)?.employmentType ?? null;
    const out: Array<OnboardingTemplate & { matchScore: number; matchReasons: string[] }> = [];
    for (const t of candidates) {
      const scopes = await this.getOnboardingTemplateScopes(t.id);
      const reasons: string[] = [];
      let score = 0;
      if (scopes.length === 0) {
        if (t.isDefault) { score += 1; reasons.push("Default template"); }
      } else {
        for (const s of scopes) {
          if (s.scopeKind === "company" && employee.companyId && s.scopeRef === employee.companyId) { score += 4; reasons.push("Company match"); }
          if (s.scopeKind === "location" && employee.locationId && s.scopeRef === employee.locationId) { score += 3; reasons.push("Location match"); }
          if (s.scopeKind === "department" && employee.departmentId && s.scopeRef === employee.departmentId) { score += 3; reasons.push("Department match"); }
          if (s.scopeKind === "role" && employee.role && s.scopeRef === employee.role) { score += 2; reasons.push("Role match"); }
          if (s.scopeKind === "employment_type" && employmentType && s.scopeRef === employmentType) { score += 2; reasons.push("Employment type match"); }
        }
      }
      if (score > 0 || t.isDefault) {
        if (t.isDefault && score === 0) { score = 1; reasons.push("Default template"); }
        out.push({ ...t, matchScore: score, matchReasons: Array.from(new Set(reasons)) });
      }
    }
    out.sort((a, b) => b.matchScore - a.matchScore);
    return out;
  }

  async addTaskToOnboardingChecklist(checklistId: string, data: Partial<InsertOnboardingTask> & { title: string }): Promise<OnboardingTask> {
    const [created] = await db.insert(onboardingTasks).values({
      checklistId,
      templateTaskId: null,
      title: data.title,
      description: data.description ?? null,
      instructions: data.instructions ?? null,
      category: data.category ?? "paperwork",
      sectionTitle: data.sectionTitle ?? null,
      sectionSortOrder: data.sectionSortOrder ?? 0,
      taskType: data.taskType ?? "checkbox",
      ownerKind: data.ownerKind ?? "role",
      ownerRole: data.ownerRole ?? "hr",
      ownerUserId: data.ownerUserId ?? null,
      ownerDepartmentId: data.ownerDepartmentId ?? null,
      isRequired: data.isRequired ?? false,
      documentType: data.documentType ?? null,
      linkUrl: data.linkUrl ?? null,
      customFields: data.customFields ?? null,
      dueDate: data.dueDate ?? null,
      sortOrder: data.sortOrder ?? 0,
      status: "pending",
    } as any).returning();
    return created;
  }

  async deleteOnboardingTaskRow(id: string): Promise<void> {
    await db.delete(onboardingTasks).where(eq(onboardingTasks.id, id));
  }

  // Offboarding parallels
  async deleteOffboardingTemplate(id: string): Promise<void> {
    await db.update(offboardingChecklists).set({ templateId: null }).where(eq(offboardingChecklists.templateId, id));
    await db.delete(offboardingTemplates).where(eq(offboardingTemplates.id, id));
  }

  async duplicateOffboardingTemplate(id: string, actorUserId: string): Promise<OffboardingTemplate | undefined> {
    const src = await this.getOffboardingTemplate(id);
    if (!src) return undefined;
    const [created] = await db.insert(offboardingTemplates).values({
      companyId: src.companyId,
      name: `${src.name} (copy)`,
      description: src.description,
      isDefault: false,
      isActive: src.isActive,
      createdBy: actorUserId,
    }).returning();
    const sections = await this.getOffboardingTemplateSections(id);
    const sectionIdMap = new Map<string, string>();
    for (const s of sections) {
      const [ns] = await db.insert(offboardingTemplateSections).values({
        templateId: created.id, title: s.title, description: s.description, sortOrder: s.sortOrder,
      }).returning();
      sectionIdMap.set(s.id, ns.id);
    }
    const tasks = await this.getOffboardingTemplateTasks(id);
    for (const t of tasks) {
      const { id: _id, createdAt: _ca, templateId: _tid, ...rest } = t as any;
      await db.insert(offboardingTemplateTasks).values({
        ...rest,
        templateId: created.id,
        sectionId: t.sectionId ? sectionIdMap.get(t.sectionId) ?? null : null,
      });
    }
    const scopes = await this.getOffboardingTemplateScopes(id);
    if (scopes.length > 0) {
      await db.insert(offboardingTemplateScopes).values(
        scopes.map(s => ({ templateId: created.id, scopeKind: s.scopeKind, scopeRef: s.scopeRef })),
      );
    }
    return created;
  }

  async getOffboardingTemplateSections(templateId: string): Promise<OffboardingTemplateSection[]> {
    return await db.select().from(offboardingTemplateSections).where(eq(offboardingTemplateSections.templateId, templateId)).orderBy(offboardingTemplateSections.sortOrder, offboardingTemplateSections.createdAt);
  }
  async createOffboardingTemplateSection(data: InsertOffboardingTemplateSection): Promise<OffboardingTemplateSection> {
    const [created] = await db.insert(offboardingTemplateSections).values(data).returning();
    return created;
  }
  async updateOffboardingTemplateSection(id: string, data: Partial<InsertOffboardingTemplateSection>): Promise<OffboardingTemplateSection | undefined> {
    const [updated] = await db.update(offboardingTemplateSections).set(data).where(eq(offboardingTemplateSections.id, id)).returning();
    return updated;
  }
  async deleteOffboardingTemplateSection(id: string): Promise<void> {
    await db.delete(offboardingTemplateSections).where(eq(offboardingTemplateSections.id, id));
  }

  async getOffboardingTemplateScopes(templateId: string): Promise<OffboardingTemplateScope[]> {
    return await db.select().from(offboardingTemplateScopes).where(eq(offboardingTemplateScopes.templateId, templateId));
  }
  async setOffboardingTemplateScopes(templateId: string, scopes: { scopeKind: string; scopeRef: string }[]): Promise<OffboardingTemplateScope[]> {
    await db.delete(offboardingTemplateScopes).where(eq(offboardingTemplateScopes.templateId, templateId));
    if (scopes.length === 0) return [];
    return await db.insert(offboardingTemplateScopes).values(scopes.map(s => ({ templateId, scopeKind: s.scopeKind, scopeRef: s.scopeRef }))).returning();
  }

  async suggestOffboardingTemplatesForEmployee(employee: User): Promise<Array<OffboardingTemplate & { matchScore: number; matchReasons: string[] }>> {
    const candidates = await this.getOffboardingTemplates({ companyId: employee.companyId ?? null, isActive: true });
    const profile = await this.getEmploymentProfile?.(employee.id).catch(() => undefined);
    const employmentType = (profile as any)?.employmentType ?? null;
    const out: Array<OffboardingTemplate & { matchScore: number; matchReasons: string[] }> = [];
    for (const t of candidates) {
      const scopes = await this.getOffboardingTemplateScopes(t.id);
      const reasons: string[] = [];
      let score = 0;
      if (scopes.length === 0) {
        if (t.isDefault) { score += 1; reasons.push("Default template"); }
      } else {
        for (const s of scopes) {
          if (s.scopeKind === "company" && employee.companyId && s.scopeRef === employee.companyId) { score += 4; reasons.push("Company match"); }
          if (s.scopeKind === "location" && employee.locationId && s.scopeRef === employee.locationId) { score += 3; reasons.push("Location match"); }
          if (s.scopeKind === "department" && employee.departmentId && s.scopeRef === employee.departmentId) { score += 3; reasons.push("Department match"); }
          if (s.scopeKind === "role" && employee.role && s.scopeRef === employee.role) { score += 2; reasons.push("Role match"); }
          if (s.scopeKind === "employment_type" && employmentType && s.scopeRef === employmentType) { score += 2; reasons.push("Employment type match"); }
        }
      }
      if (score > 0 || t.isDefault) {
        if (t.isDefault && score === 0) { score = 1; reasons.push("Default template"); }
        out.push({ ...t, matchScore: score, matchReasons: Array.from(new Set(reasons)) });
      }
    }
    out.sort((a, b) => b.matchScore - a.matchScore);
    return out;
  }

  async addTaskToOffboardingChecklist(checklistId: string, data: Partial<InsertOffboardingTask> & { title: string }): Promise<OffboardingTask> {
    const [created] = await db.insert(offboardingTasks).values({
      checklistId,
      templateTaskId: null,
      title: data.title,
      description: data.description ?? null,
      instructions: data.instructions ?? null,
      category: data.category ?? "access",
      sectionTitle: data.sectionTitle ?? null,
      sectionSortOrder: data.sectionSortOrder ?? 0,
      taskType: data.taskType ?? "checkbox",
      ownerKind: data.ownerKind ?? "role",
      ownerRole: data.ownerRole ?? "hr",
      ownerUserId: data.ownerUserId ?? null,
      ownerDepartmentId: data.ownerDepartmentId ?? null,
      isRequired: data.isRequired ?? false,
      blocksDeactivation: data.blocksDeactivation ?? false,
      linkUrl: data.linkUrl ?? null,
      customFields: data.customFields ?? null,
      dueDate: data.dueDate ?? null,
      sortOrder: data.sortOrder ?? 0,
      status: "pending",
    } as any).returning();
    return created;
  }

  async deleteOffboardingTaskRow(id: string): Promise<void> {
    await db.delete(offboardingTasks).where(eq(offboardingTasks.id, id));
  }

  // ===== Biometric kiosk =====

  async getBiometricSettings(): Promise<BiometricSettings> {
    const [row] = await db
      .select()
      .from(biometricSettings)
      .where(eq(biometricSettings.key, "global"));
    if (row) return row;
    const [created] = await db.insert(biometricSettings).values({ key: "global" }).returning();
    return created;
  }

  async updateBiometricSettings(
    patch: Partial<InsertBiometricSettings>,
    actorUserId: string,
  ): Promise<BiometricSettings> {
    const current = await this.getBiometricSettings();
    const [updated] = await db
      .update(biometricSettings)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actorUserId })
      .where(eq(biometricSettings.id, current.id))
      .returning();
    return updated;
  }

  async getBiometricLegalProfiles(): Promise<BiometricLegalProfile[]> {
    return db.select().from(biometricLegalProfiles).orderBy(desc(biometricLegalProfiles.isDefault), biometricLegalProfiles.name);
  }

  async getBiometricLegalProfile(id: string): Promise<BiometricLegalProfile | undefined> {
    const [row] = await db.select().from(biometricLegalProfiles).where(eq(biometricLegalProfiles.id, id));
    return row;
  }

  async createBiometricLegalProfile(profile: InsertBiometricLegalProfile): Promise<BiometricLegalProfile> {
    const [created] = await db
      .insert(biometricLegalProfiles)
      .values({ ...profile, isEnabled: profile.isEnabled ?? false })
      .returning();
    return created;
  }

  async updateBiometricLegalProfile(
    id: string,
    patch: Partial<InsertBiometricLegalProfile>,
  ): Promise<BiometricLegalProfile | undefined> {
    const [updated] = await db
      .update(biometricLegalProfiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(biometricLegalProfiles.id, id))
      .returning();
    return updated;
  }

  async deleteBiometricLegalProfile(id: string): Promise<void> {
    await db.delete(biometricLegalProfiles).where(eq(biometricLegalProfiles.id, id));
  }

  async getBiometricLegalProfileScopes(profileId?: string): Promise<BiometricLegalProfileScope[]> {
    if (profileId) {
      return db.select().from(biometricLegalProfileScopes).where(eq(biometricLegalProfileScopes.profileId, profileId));
    }
    return db.select().from(biometricLegalProfileScopes);
  }

  async setBiometricLegalProfileScopes(
    profileId: string,
    scopes: { companyId?: string | null; locationId?: string | null }[],
  ): Promise<BiometricLegalProfileScope[]> {
    await db.delete(biometricLegalProfileScopes).where(eq(biometricLegalProfileScopes.profileId, profileId));
    if (scopes.length === 0) return [];
    const rows = scopes.map((s) => ({
      profileId,
      companyId: s.companyId ?? null,
      locationId: s.locationId ?? null,
    }));
    return db.insert(biometricLegalProfileScopes).values(rows).returning();
  }

  async getBiometricConsent(userId: string): Promise<BiometricConsent | undefined> {
    const [row] = await db
      .select()
      .from(biometricConsents)
      .where(eq(biometricConsents.userId, userId))
      .orderBy(desc(biometricConsents.acceptedAt))
      .limit(1);
    return row;
  }

  async getActiveBiometricConsent(userId: string): Promise<BiometricConsent | undefined> {
    const [row] = await db
      .select()
      .from(biometricConsents)
      .where(and(eq(biometricConsents.userId, userId), isNull(biometricConsents.revokedAt)))
      .orderBy(desc(biometricConsents.acceptedAt))
      .limit(1);
    return row;
  }

  async createBiometricConsent(consent: InsertBiometricConsent): Promise<BiometricConsent> {
    const [created] = await db.insert(biometricConsents).values(consent).returning();
    return created;
  }

  async revokeBiometricConsent(userId: string, revokedBy: string, reason: string): Promise<void> {
    await db
      .update(biometricConsents)
      .set({ revokedAt: new Date(), revokedBy, revokedReason: reason })
      .where(and(eq(biometricConsents.userId, userId), isNull(biometricConsents.revokedAt)));
  }

  async setBiometricLegalHold(userId: string, hold: boolean): Promise<void> {
    // Apply to all consents for the user (active + historical) so the flag survives revoke/re-enroll cycles.
    const existing = await db
      .select()
      .from(biometricConsents)
      .where(eq(biometricConsents.userId, userId));
    if (existing.length === 0) {
      // Releasing a hold on a user with no consent rows is a no-op — there is
      // nothing to flag and no reason to create a placeholder.
      if (!hold) return;
      // No consent yet — record an empty placeholder (with no profile) so legal hold can be honoured prior to enrollment.
      const [defaultProfile] = await db
        .select()
        .from(biometricLegalProfiles)
        .where(eq(biometricLegalProfiles.isDefault, true))
        .limit(1);
      if (defaultProfile) {
        await db.insert(biometricConsents).values({
          userId,
          legalProfileId: defaultProfile.id,
          consentVersion: defaultProfile.consentVersion,
          consentTextSnapshot: "[legal-hold placeholder; no consent yet]",
          revokedAt: new Date(),
          // revokedBy references users.id — "system" is not a real user and
          // triggers a FK violation. Leave it null on the placeholder.
          revokedBy: null,
          revokedReason: "legal_hold_placeholder",
          legalHold: hold,
        });
        return;
      }
    }
    await db.update(biometricConsents).set({ legalHold: hold }).where(eq(biometricConsents.userId, userId));
  }

  async getBiometricTemplate(userId: string, type: string): Promise<BiometricTemplate | undefined> {
    const [row] = await db
      .select()
      .from(biometricTemplates)
      .where(and(eq(biometricTemplates.userId, userId), eq(biometricTemplates.type, type)));
    return row;
  }

  async upsertBiometricTemplate(template: InsertBiometricTemplate): Promise<BiometricTemplate> {
    const existing = await this.getBiometricTemplate(template.userId, template.type);
    if (existing) {
      const [updated] = await db
        .update(biometricTemplates)
        .set({
          encryptedTemplate: template.encryptedTemplate,
          encryptionKeyVersion: template.encryptionKeyVersion ?? existing.encryptionKeyVersion,
          sampleCount: template.sampleCount ?? existing.sampleCount,
          companyId: template.companyId ?? existing.companyId,
          enrolledKioskId: template.enrolledKioskId ?? existing.enrolledKioskId,
          enrolledByUserId: template.enrolledByUserId ?? existing.enrolledByUserId,
          updatedAt: new Date(),
        })
        .where(eq(biometricTemplates.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(biometricTemplates).values(template).returning();
    return created;
  }

  async deleteBiometricTemplate(userId: string, type: string): Promise<void> {
    await db
      .delete(biometricTemplates)
      .where(and(eq(biometricTemplates.userId, userId), eq(biometricTemplates.type, type)));
  }

  async getBiometricTemplatesByCompanyAndType(
    companyId: string | null,
    type: string,
  ): Promise<BiometricTemplate[]> {
    if (companyId === null) {
      return db
        .select()
        .from(biometricTemplates)
        .where(and(isNull(biometricTemplates.companyId), eq(biometricTemplates.type, type)));
    }
    return db
      .select()
      .from(biometricTemplates)
      .where(and(eq(biometricTemplates.companyId, companyId), eq(biometricTemplates.type, type)));
  }

  async touchBiometricTemplateMatched(id: string): Promise<void> {
    await db
      .update(biometricTemplates)
      .set({ lastMatchedAt: new Date() })
      .where(eq(biometricTemplates.id, id));
  }

  async recordBiometricAttempt(attempt: InsertBiometricAttempt): Promise<BiometricAttempt> {
    const [created] = await db.insert(biometricAttempts).values(attempt).returning();
    return created;
  }

  async listBiometricAttempts(filters: {
    candidateUserId?: string;
    kioskDeviceId?: string;
    outcome?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<BiometricAttempt[]> {
    const conds: any[] = [];
    if (filters.candidateUserId) conds.push(eq(biometricAttempts.candidateUserId, filters.candidateUserId));
    if (filters.kioskDeviceId) conds.push(eq(biometricAttempts.kioskDeviceId, filters.kioskDeviceId));
    if (filters.outcome) conds.push(eq(biometricAttempts.outcome, filters.outcome));
    if (filters.since) conds.push(gte(biometricAttempts.createdAt, filters.since));
    if (filters.until) conds.push(lte(biometricAttempts.createdAt, filters.until));
    let q = db.select().from(biometricAttempts).$dynamic();
    if (conds.length > 0) q = q.where(and(...conds));
    return q.orderBy(desc(biometricAttempts.createdAt)).limit(filters.limit ?? 200);
  }

  async countConsecutiveFailures(
    candidateUserId: string,
    kioskDeviceId: string | null,
    since: Date,
  ): Promise<number> {
    // Walk most-recent-first for this candidate at this kiosk; stop when we hit a success.
    const conds: any[] = [
      eq(biometricAttempts.candidateUserId, candidateUserId),
      gte(biometricAttempts.createdAt, since),
    ];
    if (kioskDeviceId) conds.push(eq(biometricAttempts.kioskDeviceId, kioskDeviceId));
    const rows = await db
      .select({ outcome: biometricAttempts.outcome })
      .from(biometricAttempts)
      .where(and(...conds))
      .orderBy(desc(biometricAttempts.createdAt))
      .limit(50);
    let n = 0;
    for (const r of rows) {
      if (r.outcome === "auto_approved" || r.outcome === "low_confidence") break;
      n += 1;
    }
    return n;
  }

  async getBiometricMetrics(since: Date) {
    const attempts = await db
      .select()
      .from(biometricAttempts)
      .where(gte(biometricAttempts.createdAt, since));
    const byOutcome: Record<string, number> = {};
    const byKiosk: Record<string, { total: number; success: number; rejected: number }> = {};
    const byDayMap = new Map<string, { success: number; lowConfidence: number; rejected: number; livenessFail: number; cameraError: number; total: number }>();
    for (const a of attempts) {
      byOutcome[a.outcome] = (byOutcome[a.outcome] || 0) + 1;
      const k = a.kioskDeviceId || "unknown";
      const ks = byKiosk[k] || { total: 0, success: 0, rejected: 0 };
      ks.total += 1;
      if (a.outcome === "auto_approved" || a.outcome === "low_confidence") ks.success += 1;
      else ks.rejected += 1;
      byKiosk[k] = ks;

      const day = (a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any))
        .toISOString()
        .split("T")[0];
      const dayBucket = byDayMap.get(day) || {
        success: 0, lowConfidence: 0, rejected: 0, livenessFail: 0, cameraError: 0, total: 0,
      };
      dayBucket.total += 1;
      if (a.outcome === "auto_approved") dayBucket.success += 1;
      else if (a.outcome === "low_confidence") dayBucket.lowConfidence += 1;
      else if (a.outcome === "rejected" || a.outcome === "not_enrolled") dayBucket.rejected += 1;
      else if (a.outcome === "liveness_failed") dayBucket.livenessFail += 1;
      else if (a.outcome === "camera_error") dayBucket.cameraError += 1;
      byDayMap.set(day, dayBucket);
    }
    const byDay = Array.from(byDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, bucket]) => ({ day, ...bucket }));

    const [{ count: enrollmentsTotal }] = await db
      .select({ count: count() })
      .from(biometricTemplates);
    const [{ count: overrideCount }] = await db
      .select({ count: count() })
      .from(biometricSupervisorOverrides)
      .where(gte(biometricSupervisorOverrides.createdAt, since));

    return {
      total: attempts.length,
      byOutcome,
      byKiosk,
      byDay,
      enrollmentsTotal: Number(enrollmentsTotal) || 0,
      overrideCount: Number(overrideCount) || 0,
    };
  }

  async recordBiometricSupervisorOverride(
    row: InsertBiometricSupervisorOverride,
  ): Promise<BiometricSupervisorOverride> {
    const [created] = await db.insert(biometricSupervisorOverrides).values(row).returning();
    return created;
  }

  async listBiometricSupervisorOverrides(limit = 100): Promise<BiometricSupervisorOverride[]> {
    return db
      .select()
      .from(biometricSupervisorOverrides)
      .orderBy(desc(biometricSupervisorOverrides.createdAt))
      .limit(limit);
  }

  async getBiometricEnrollmentSummary() {
    // Pull users that are not terminated. Users without an employment profile row are
    // considered active for the purposes of the enrollment dashboard so that admins/
    // dev users still appear in the list.
    const usersListRaw = await db
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        terminationDate: userEmploymentProfiles.terminationDate,
      })
      .from(users)
      .leftJoin(userEmploymentProfiles, eq(userEmploymentProfiles.userId, users.id));
    const usersList = usersListRaw.filter((u) => !u.terminationDate);
    const allConsents = await db.select().from(biometricConsents);
    const allTemplates = await db.select().from(biometricTemplates);
    const allProfiles = await db.select().from(biometricLegalProfiles);
    const profileNameById = new Map(allProfiles.map((p) => [p.id, p.name]));
    const tplByUser = new Map<string, BiometricTemplate>();
    for (const t of allTemplates) {
      if (t.type === "face") tplByUser.set(t.userId, t);
    }
    const consentByUser = new Map<string, BiometricConsent[]>();
    for (const c of allConsents) {
      const arr = consentByUser.get(c.userId) || [];
      arr.push(c);
      consentByUser.set(c.userId, arr);
    }
    return usersList.map((u) => {
      const allForUser = consentByUser.get(u.userId) || [];
      // Placeholder rows (created purely to carry a legal hold before any real
      // consent) must not be treated as real consent for status display.
      const consents = allForUser
        .filter((c) => c.revokedReason !== "legal_hold_placeholder")
        .sort((a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0));
      const activeConsent = consents.find((c) => !c.revokedAt);
      const latest = consents[0];
      const tpl = tplByUser.get(u.userId);
      // Legal hold can live on any row for the user, including the placeholder.
      const legalHold = allForUser.some((c) => c.legalHold);
      const userName =
        [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Unknown";
      return {
        userId: u.userId,
        userName,
        userEmail: u.email ?? null,
        templateId: tpl?.id ?? null,
        sampleCount: tpl?.sampleCount ?? 0,
        enrolledAt: tpl?.createdAt ?? null,
        lastMatchedAt: tpl?.lastMatchedAt ?? null,
        consentAcceptedAt: activeConsent?.acceptedAt ?? latest?.acceptedAt ?? null,
        consentRevokedAt: activeConsent ? null : latest?.revokedAt ?? null,
        hasActiveConsent: !!activeConsent,
        legalProfileName: latest ? profileNameById.get(latest.legalProfileId) ?? null : null,
        legalHold,
      };
    });
  }
}

export const storage = new DatabaseStorage();
