# Ahava Medical Center - Time & Attendance System

## Overview
Employee time tracking and attendance management system for Ahava Medical Center. Built with Express + Vite + React stack with email/password authentication. Includes a tablet kiosk clock-in system for shared devices.

## Architecture
- **Backend**: Express.js with TypeScript
- **Frontend**: React with Vite, TanStack Query, Wouter routing, Shadcn/ui components
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Replit Auth (OpenID Connect) with session-based sessions

## Data Model
All tables use FK constraints where applicable (userId, managerId, reviewedBy, departmentId, companyId, locationId reference their parent tables).
- **companies** (shared/models/auth.ts): Multi-company support with name, slug, legalName, address, phone, email, timezone
- **locations** (shared/models/auth.ts): Company locations with companyId FK, code, address fields, timezone
- **users** (shared/models/auth.ts): Auth users with role (employee/manager/admin), companyId FK, locationId FK, departmentId, passwordHash
- **departments**: Company departments with manager FK, companyId FK, locationId FK, unique constraint on (companyId, name)
- **roles** (shared/models/auth.ts): System and custom roles (isSystem flag, optional companyId)
- **permissions** (shared/models/auth.ts): Permission keys with module grouping (38 keys)
- **role_permissions** (shared/models/auth.ts): Maps roles to permissions (M:N)
- **user_roles** (shared/models/auth.ts): Assigns roles to users (with optional companyId scope)
- **user_permission_overrides** (shared/models/auth.ts): Per-user permission allow/deny with reason, createdBy, updatedAt
- **user_access_scopes** (shared/models/auth.ts): Restricts user access by scopeType (company/location/department) with explicit FK columns
- **policy_types** (shared/models/auth.ts): Policy type definitions with key, name, module, isActive
- **user_employment_profiles** (shared/schema.ts): Employment details per user (employmentType, payType, hourlyRate, weeklySalary, dailySalary, overtimeEligible, holidayPayEnabled, voluntaryPayEnabled, hireDate, terminationDate)
- **punch_logs**: Clock in/out records per employee per date (employeeId FK to users), with breakMinutes, hoursWorked, source field (web/kiosk/exception), approved flag. Migrated from attendance_records. Code alias: `attendanceRecords = punchLogs` for backward compat.
- **attendance_exceptions**: Missing punch/time correction requests from employees (employeeId, exceptionDate, type, reason, status). Approval creates/updates punch_logs and writes audit_logs.
- **audit_logs**: Audit trail for sensitive operations (actorUserId, targetType, targetId, action, oldValue/newValue as JSONB, context, ipAddress, userAgent)
- **time_off_requests**: PTO/sick/personal requests with daysRequested and approval workflow (userId, reviewedBy FK to users)
- **time_off_balances**: Per-user time off allocation and usage tracking per year (userId FK to users)
- **pto_policies**: Configurable PTO policy definitions with accrual type/rate, yearly/carryover caps, waiting period, sick leave accrual rules (rate per hours worked, yearly cap), holiday pay toggles (paid/unpaid, PTO deduction, OT exclusion), isDefault flag
- **employee_pto_settings**: Per-employee PTO policy assignment and balance overrides (vacation/sick/personal), hire date for waiting period calculation
- **audit_logs**: Audit trail for PTO approvals, denials, policy changes, and balance adjustments (action, module, targetId, performedBy, details JSONB)
- **payroll_exports**: Payroll batch exports with status tracking (draft/exported/locked/reopened), date range, exportedAt/By, lockedAt/By, reopenedAt/By, recordCount
- **payroll_batch_records**: Individual records in a payroll batch (attendance or PTO), linked to payrollExportId, employeeId, punchLogId, timeOffRequestId, with regularHours, overtimeHours, ptoHours, hasIssues flag
- **payroll_adjustments**: Auto-flagged when punch records are modified after export (payrollExportId, employeeId, punchLogId, adjustmentDate, reason, status pending/acknowledged)
- **employee_pins**: Hashed PIN codes for kiosk clock-in (userId FK to users)
- **kiosk_devices**: Registered kiosk terminals (departmentId FK to departments)
- **sessions**: Auth session storage

## Key Files
- `shared/schema.ts` - All Drizzle table definitions with FK relations
- `shared/models/auth.ts` - Users, sessions, companies, locations, roles, permissions, RBAC tables
- `server/storage.ts` - IStorage interface and DatabaseStorage implementation (includes kiosk + RBAC + employment profile + attendance exceptions + audit log methods)
- `server/routes.ts` - API routes with role-based middleware, Zod validation, kiosk, and attendance exception endpoints
- `server/services/audit.ts` - Audit logging service (writeAuditLog, getAuditContext)
- `server/middleware/auth.ts` - JWT token generation and combined JWT+session auth middleware (requireAuth)
- `server/middleware/rbac.ts` - requirePermission and requireScopedAccess middleware, permission resolution
- `server/replit_integrations/auth/replitAuth.ts` - Session-based auth (login/logout/isAuthenticated) + JWT token on login
- `server/index.ts` - Express app setup with auth wiring
- `server/policyEngine.ts` - Policy resolution engine (getEffectivePolicy, default rule sets for all 6 policy types)
- `server/seed.ts` - Database seed script (admin user, department, 32 permissions, 9 system roles, role_permissions, default policies)
- `client/src/App.tsx` - Main app with auth-gated routing + public /kiosk route
- `client/src/pages/kiosk.tsx` - Kiosk clock-in interface
- `client/src/components/app-sidebar.tsx` - Role-based sidebar navigation
- `client/src/components/app-layout.tsx` - Layout shell with sidebar
- `client/src/pages/dashboard.tsx` - Employee dashboard with clock in/out, hours, PTO balance
- `client/src/pages/my-attendance.tsx` - Attendance history with filtering and CSV export
- `client/src/pages/time-off.tsx` - Time off requests with team calendar
- `client/src/pages/login.tsx` - Login page
- `client/src/hooks/use-auth.ts` - Auth hook for frontend

## Kiosk System
- **Route**: `/kiosk` (public, no auth required, no sidebar/navigation)
- **Flow**: Home Screen -> Employee Identification (PIN/Name Search) -> Clock Confirmation -> Success Screen (auto-reset 5s)
- **API Endpoints**:
  - `POST /api/kiosk/lookup-pin` - Lookup employee by PIN (Zod validated)
  - `GET /api/kiosk/search?q=<query>` - Search employees by name
  - `GET /api/kiosk/employee/:id` - Get employee details + last attendance
  - `POST /api/kiosk/punch` - Record clock in/out (validates punch sequence)
- PIN values are never exposed in API responses (sanitized server-side)
- Kiosk uses the `punch_logs` table with source="kiosk"
- Touch-optimized UI with large buttons for 10"+ tablets

## API Endpoints
- `GET /api/auth/user` - Current authenticated user
- `GET /api/attendance/status` - Dashboard status (clock state, hours, PTO balance)
- `POST /api/attendance/clock-in` - Clock in
- `POST /api/attendance/clock-out` - Clock out
- `GET /api/attendance/records` - Attendance records (supports ?startDate, ?endDate)
- `POST /api/attendance/exceptions` - Submit attendance exception request (missing_punch, time_correction, forgotten_clock_in, forgotten_clock_out)
- `GET /api/attendance/exceptions` - Get exceptions (own for employees, all for managers/admins)
- `GET /api/attendance/exceptions/pending` - Pending exceptions for team (manager/admin, scope-checked)
- `POST /api/attendance/exceptions/:id/resolve` - Approve/deny exception (manager/admin, scope-checked, creates/updates punch_logs + audit_logs)
- `POST /api/time-off` - Create time-off request (status forced to pending, daysRequested computed server-side)
- `GET /api/time-off` - User's time-off requests
- `GET /api/time-off/balance` - Computed PTO balance (admin/manager only, supports ?userId query param)
- `GET /api/time-off/team` - Team time-off (minimized DTO, approved+pending only)
- `GET /api/time-off/pending` - Pending requests (manager/admin only)
- `GET /api/users` - All users (admin only)
- `PATCH /api/users/:id/role` - Update user role (admin only)
- `GET /api/companies` - Companies (scoped by user access)
- `GET /api/companies/:id` - Get company by ID (scoped)
- `POST /api/companies` - Create company (admin only)
- `PATCH /api/companies/:id` - Update company (admin only)
- `DELETE /api/companies/:id` - Delete company (admin only)
- `GET /api/locations` - Locations (scoped by user access, optional ?companyId filter)
- `GET /api/locations/:id` - Get location by ID (scoped)
- `POST /api/locations` - Create location (admin only)
- `PATCH /api/locations/:id` - Update location (admin only)
- `DELETE /api/locations/:id` - Delete location (admin only)
- `GET /api/departments` - Departments (scoped by user company/location, optional ?companyId/?locationId)
- `POST /api/departments` - Create department (admin only, validates location belongs to company)
- `PATCH /api/departments/:id` - Update department (admin only)
- `DELETE /api/departments/:id` - Delete department (admin only)
- `GET /api/employment-profiles/:userId` - Get employment profile (admin, self, or scoped manager)
- `POST /api/employment-profiles` - Create employment profile (admin only)
- `PATCH /api/employment-profiles/:userId` - Update employment profile (admin only)

## Theming
Brand colors (Ahava Medical):
- Dark Navy: #123047 (HSL 205 60% 17%) - sidebar background, foreground text
- Teal: #56b9ca (HSL 189 50% 56%) - primary color, accent
- Green: #009972 (HSL 163 100% 30%) - chart color
- Blue: #1f97d4 (HSL 203 74% 48%) - chart color

## User Roles
- **employee**: Dashboard, My Attendance, Time Off, Profile
- **manager**: + Team View, Approvals (with pending count badge), Reports
- **admin**: + Company, Users, Settings, Reports

## Manager & Admin Pages
- **Team View** (`/team`): Manager dashboard with team stats (size, clocked in, on leave), pending approvals alert, team status table
- **Approvals** (`/approvals`): Approval queue with pending time-off requests (approve/deny with comments), recently processed table
- **Company** (`/company`): Admin dashboard with company-wide stats, department breakdown table, quick actions, recent activity
- **Reports** (`/reports`): Report generator with type/date range/department filters, preview table, CSV download

## Manager/Admin API Endpoints
- `GET /api/manager/team-stats` - Team size, clocked in, on leave, pending approvals
- `GET /api/manager/team-status` - Team member status details
- `POST /api/time-off/:id/approve` - Approve time-off request with optional comment
- `POST /api/time-off/:id/deny` - Deny time-off request with optional comment
- `GET /api/time-off/processed` - Recently processed requests with enriched names
- `GET /api/admin/company-stats` - Company-wide overview stats
- `GET /api/admin/department-breakdown` - Department breakdown with employee counts
- `GET /api/admin/recent-activity` - Recent activity feed
- `POST /api/reports/generate` - Generate report data with filters

## PTO Engine API Endpoints (Milestone 4)
- `GET /api/pto-policies` - List all PTO policies (admin only)
- `GET /api/pto-policies/:id` - Get single PTO policy (admin only)
- `POST /api/pto-policies` - Create PTO policy (admin only)
- `PATCH /api/pto-policies/:id` - Update PTO policy (admin only)
- `GET /api/employee-pto-settings/:userId` - Get employee PTO settings (manager/admin)
- `POST /api/employee-pto-settings` - Create/update employee PTO settings (admin only)
- `PATCH /api/employee-pto-settings/:userId` - Update employee PTO settings/balance overrides (admin only)
- `GET /api/employee-pto-policy/:userId` - Get effective PTO policy for employee (manager/admin)
- `GET /api/audit-logs` - View audit logs (admin only, supports ?module and ?limit query params)

## Policy Engine (Milestone 5)
- **policies** (shared/schema.ts): Policy definitions with companyId FK, policyTypeId FK, name, description, status (draft/active/archived), version
- **policy_rules** (shared/schema.ts): JSON rule objects per policy (policyId FK, rules JSONB)
- **policy_assignments** (shared/schema.ts): Assignment at 4 levels: company, location, department, employee (companyId/locationId/departmentId/userId FKs)
- **Policy Engine** (`server/policyEngine.ts`): `getEffectivePolicy(companyId, userId, policyType, user)` walks hierarchy: employee → department → location → company → global default (lowest/most-specific level wins)
- Default rule sets defined for all 6 policy types: attendance, pto, payroll, approvals, alerts, kiosk
- Attendance clock-in/clock-out reads OT thresholds, allowed punch sources from resolved attendance policy
- PTO time-off request reads waiting period, max consecutive days from resolved PTO policy
- 6 default policies seeded (one per policy type) with global assignments

### Policy Engine API Endpoints
- `GET /api/policy-types` - List all policy types
- `GET /api/policies` - List all policies (admin, optional ?companyId filter)
- `GET /api/policies/:id` - Get policy with rules and assignments (admin)
- `POST /api/policies` - Create policy with optional rules (admin)
- `PATCH /api/policies/:id` - Update policy and/or rules (admin)
- `POST /api/policies/:id/activate` - Activate policy (admin)
- `POST /api/policies/:id/archive` - Archive policy (admin)
- `GET /api/policies/:id/rules` - Get policy rules JSON (admin)
- `PUT /api/policies/:id/rules` - Upsert policy rules JSON (admin)
- `GET /api/policy-assignments` - List assignments (admin, optional ?policyId filter)
- `POST /api/policy-assignments` - Create assignment at any level (admin)
- `PATCH /api/policy-assignments/:id` - Update assignment (admin)
- `DELETE /api/policy-assignments/:id` - Delete assignment (admin)
- `GET /api/effective-policy?policyType=X&userId=Y` - Preview resolved effective policy for a user
- `GET /api/policy-defaults/:policyType` - Get default rule set for a policy type (admin)

## Auth & RBAC Notes
- Custom email/password auth with bcryptjs password hashing (no external OAuth)
- Session stored in PostgreSQL via connect-pg-simple
- JWT tokens generated on login (jsonwebtoken, 7-day expiry)
- `requireAuth` middleware accepts either JWT Bearer token or session cookie
- `requireAuth` middleware is now used on all API routes (replaces legacy `isAuthenticated`)
- `requirePermission(key)` middleware resolves effective permissions (role + overrides) and checks
- `requireScopedAccess(module, scopeResolver)` restricts data by company/location/department scope
- `requireRole` middleware preserved alongside new system for backward compatibility during migration
- `resolveUserPermissions(userId)` returns Set of effective permission keys for a user
- Password field is excluded from all API responses
- Default admin: admin@ahavamedical.com / admin123
- 9 system roles: Super Admin, Company Admin, HR Admin, Payroll Admin, Location Manager, Department Manager, Supervisor, Employee, Kiosk Device
- 43 permission keys using dot notation grouped by module (system.*, company.*, users.* [create/view/edit/deactivate], roles.*, departments.*, attendance.* [view_self/view_team/view_all/clock/edit/manage_rules/approve_corrections], pto.* [request/view_self/view_team/view_all/approve/manage_policies], payroll.* [view_self/view_all/view_batches/manage/mark_sent/export], reports.*, kiosk.*, locations.*, approvals.*, alerts.*, settings.manage, audit.view)
- 6 policy types seeded with keys: attendance, pto, payroll, approvals, alerts, kiosk
- user_access_scopes uses scopeType column plus explicit companyId/locationId/departmentId FK columns
- user_permission_overrides uses `allowed` boolean with optional `reason` and `createdBy` audit fields
- Both password and passwordHash stripped from all API responses

## Commands
- `npm run dev` - Start development server
- `npx drizzle-kit push` - Push schema changes to database
- `npx tsx server/seed.ts` - Seed database
