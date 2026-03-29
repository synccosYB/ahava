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
- **attendance_records**: Clock in/out records per user per date (userId FK to users), with breakMinutes, totalHours, source field (web/kiosk)
- **time_off_requests**: PTO/sick/personal requests with daysRequested and approval workflow (userId, reviewedBy FK to users)
- **time_off_balances**: Per-user time off allocation and usage tracking per year (userId FK to users)
- **employee_pins**: Hashed PIN codes for kiosk clock-in (userId FK to users)
- **kiosk_devices**: Registered kiosk terminals (departmentId FK to departments)
- **sessions**: Auth session storage

## Key Files
- `shared/schema.ts` - All Drizzle table definitions with FK relations
- `shared/models/auth.ts` - Users, sessions, companies, locations, roles, permissions, RBAC tables
- `server/storage.ts` - IStorage interface and DatabaseStorage implementation (includes kiosk + RBAC + employment profile methods)
- `server/routes.ts` - API routes with role-based middleware, Zod validation, and kiosk endpoints
- `server/middleware/auth.ts` - JWT token generation and combined JWT+session auth middleware (requireAuth)
- `server/middleware/rbac.ts` - requirePermission and requireScopedAccess middleware, permission resolution
- `server/replit_integrations/auth/replitAuth.ts` - Session-based auth (login/logout/isAuthenticated) + JWT token on login
- `server/index.ts` - Express app setup with auth wiring
- `server/seed.ts` - Database seed script (admin user, department, 32 permissions, 9 system roles, role_permissions)
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
- Kiosk uses the same `attendance_records` table with source="kiosk"
- Touch-optimized UI with large buttons for 10"+ tablets

## API Endpoints
- `GET /api/auth/user` - Current authenticated user
- `GET /api/attendance/status` - Dashboard status (clock state, hours, PTO balance)
- `POST /api/attendance/clock-in` - Clock in
- `POST /api/attendance/clock-out` - Clock out
- `GET /api/attendance/records` - Attendance records (supports ?startDate, ?endDate)
- `POST /api/time-off` - Create time-off request (status forced to pending, daysRequested computed server-side)
- `GET /api/time-off` - User's time-off requests
- `GET /api/time-off/balance` - Computed PTO balance
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
