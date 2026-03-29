# Ahava Medical Center - Time & Attendance System

## Overview
This project is an employee time tracking and attendance management system designed for Ahava Medical Center. Its primary purpose is to streamline employee clock-in/out processes, manage attendance records, handle time-off requests, and provide robust administrative tools for HR and management. Key capabilities include a tablet-based kiosk system for shared device clock-ins, comprehensive PTO management, and a flexible policy engine. The system aims to improve operational efficiency, ensure accurate payroll data, and provide clear oversight of employee attendance and leave.

## User Preferences
I prefer clear and concise information. For explanations, focus on the "what" and "why" rather than exhaustive "how-to" details. When making changes, prioritize modularity and maintainability. Always confirm major architectural decisions before implementation. I appreciate an iterative development approach with regular updates on progress and potential roadblocks. Do not make changes to existing UI/UX design decisions unless explicitly instructed.

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

## System Architecture
The system is built on an Express.js backend with TypeScript, a React frontend using Vite, TanStack Query, Wouter for routing, and Shadcn/ui components. Data persistence is handled by PostgreSQL with Drizzle ORM. Authentication uses Replit Auth (OpenID Connect) with session-based sessions and JWTs for API access.

**UI/UX Decisions:**
- **Color Scheme:** Utilizes a brand palette of Dark Navy (`#123047`) for backgrounds and text, Teal (`#56b9ca`) as the primary accent, and specific Green (`#009972`) and Blue (`#1f97d4`) for charts.
- **Kiosk Interface:** Designed for touch-optimized interaction on 10"+ tablets with large buttons and a simplified public flow (Home -> Employee Identification -> Clock Confirmation -> Success).
- **Admin UI:** Features a comprehensive dashboard with KPI cards, live attendance, exceptions panel, and approval queues. Employee profiles are structured with multiple tabs for detailed management.

**Technical Implementations:**
- **Role-Based Access Control (RBAC):** Granular permissions are managed through roles, user-specific overrides, and access scopes (company, location, department). Middleware (`requirePermission`, `requireScopedAccess`) enforces these rules.
- **Policy Engine:** A dynamic policy engine allows for hierarchical rule resolution (employee → department → location → company → global default) for attendance, PTO, payroll, approvals, alerts, and kiosk behaviors. Policies are defined with rules stored as JSON objects.
- **Time & Attendance:** Manages `punch_logs` (clock in/out records), `attendance_exceptions` (missing punches, time corrections with approval workflows), and computes `hoursWorked`.
- **PTO Management:** Tracks `time_off_requests` with approval workflows and `time_off_balances`. Configurable `pto_policies` define accrual rates, caps, and holiday pay rules.
- **Audit Logging:** A robust `audit_logs` system captures sensitive operations with actor, target, action, and detailed context.

**Feature Specifications:**
- **Kiosk System:** Public `/kiosk` route for employee clock-in/out using PIN or name search, designed for shared devices.
- **Dashboard:** Employee dashboard shows current clock status, hours, and PTO balance. Manager/Admin dashboards provide team/company-wide stats and approval queues.
- **Admin Pages:** Dedicated sections for managing Employees, Locations & Departments, Time Clock Rules (policies), PTO & Leave, Alerts & Exceptions, Payroll Prep, and Reports.
- **API Endpoints:** A comprehensive set of RESTful APIs for all functionalities, including user authentication, attendance, time-off, company/location/department management, employment profiles, and reporting. All sensitive API calls are protected by RBAC and scoping.

## External Dependencies
- **PostgreSQL:** Primary database for all application data.
- **Drizzle ORM:** Used for database interactions.
- **Express.js:** Web application framework for the backend.
- **React:** Frontend library for building user interfaces.
- **Vite:** Build tool for the frontend.
- **TanStack Query:** Data fetching and caching library for React.
- **Wouter:** Lightweight React router.
- **Shadcn/ui:** UI component library.
- **Replit Auth (OpenID Connect):** For user authentication.
- **`connect-pg-simple`:** PostgreSQL session store.
- **`jsonwebtoken`:** For generating and verifying JWTs.
- **`bcryptjs`:** For password hashing.
- **Zod:** Schema validation library.