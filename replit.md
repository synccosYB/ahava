# Ahava Medical Center - Time & Attendance System

## Overview
This project is an employee time tracking and attendance management system designed for Ahava Medical Center. Its primary purpose is to streamline employee clock-in/out processes, manage attendance records, handle time-off requests, and provide robust administrative tools for HR and management. Key capabilities include a tablet-based kiosk system for shared device clock-ins, comprehensive PTO management, and a flexible policy engine. The system aims to improve operational efficiency, ensure accurate payroll data, and provide clear oversight of employee attendance and leave.

## User Preferences
I prefer clear and concise information. For explanations, focus on the "what" and "why" rather than exhaustive "how-to" details. When making changes, prioritize modularity and maintainability. Always confirm major architectural decisions before implementation. I appreciate an iterative development approach with regular updates on progress and potential roadblocks. Do not make changes to existing UI/UX design decisions unless explicitly instructed.

## System Architecture
The system is built on an Express.js backend with TypeScript, a React frontend using Vite, TanStack Query, Wouter for routing, and Shadcn/ui components. Data persistence is handled by PostgreSQL with Drizzle ORM. Authentication uses Replit Auth (OpenID Connect) with session-based sessions and JWTs for API access.

**UI/UX Decisions:**
- **Color Scheme:** Utilizes a brand palette of Dark Navy (`#123047`) for backgrounds and text, Teal (`#56b9ca`) as the primary accent, and specific Green (`#009972`) and Blue (`#1f97d4`) for charts.
- **Kiosk Interface:** Designed for touch-optimized interaction on 10"+ tablets with large buttons and a simplified public flow (Home -> Employee Identification -> Clock Confirmation -> Success).
- **Admin UI:** Features a comprehensive dashboard with KPI cards, live attendance, exceptions panel, and approval queues. Employee profiles are structured with multiple tabs for detailed management.

**Technical Implementations:**
- **Role-Based Access Control (RBAC):** Granular permissions are managed through roles, user-specific overrides, and access scopes (division/company, location, department). Middleware (`requirePermission`, `requireScopedAccess`) enforces these rules. Note: All user-facing references use "Division" terminology while the underlying DB tables and API endpoints retain "company" naming (e.g., `companies` table, `/api/companies` endpoint). TypeScript type aliases (`Division = Company`, `InsertDivision = InsertCompany`) are exported from `shared/schema.ts` for frontend use.
- **Policy Engine:** A dynamic policy engine allows for hierarchical rule resolution (employee → department → location → company → global default) for attendance, PTO, payroll, approvals, alerts, and kiosk behaviors. Policies are defined with rules stored as JSON objects.
- **Time & Attendance:** Manages `punch_logs` (clock in/out records), `attendance_exceptions` (missing punches, time corrections with approval workflows), and computes `hoursWorked`.
- **PTO Management:** Tracks `time_off_requests` (with `requestCategory` field distinguishing "time_off" vs "cashout") with approval workflows and `time_off_balances`. Configurable `pto_policies` define accrual rates, caps, holiday pay rules, and optional `expirationDate`. Balance computation is year-scoped with carryover from prior year capped by `carryoverCapHours`, and carryover is zeroed after the policy's expiration date. PTO cash-out requests flow through the same approval queue with distinct UI treatment and are included in payroll exports as `pto_cashout` records.
- **Audit Logging:** A robust `audit_logs` system captures sensitive operations with actor, target, action, and detailed context.
- **Alerts:** System alerts for missing clock-outs, overtime breaches, no-shows, late arrivals, break violations, and auto clock-outs, with acknowledgement and resolution workflows.
- **Policy Enforcement:** Real-time enforcement at clock-in/out (grace periods, early clock-in restrictions, time rounding, break requirements, auto clock-out after configurable threshold). PTO enforcement validates advance notice, blackout dates, and max consecutive days at submission. A background job runs every 15 minutes to auto clock-out stale punches. All violations generate system alerts with policy context.
- **Real-time Updates:** WebSocket integration (`/ws`) for real-time attendance updates, with session/JWT auth at handshake.
- **Automated Tests:** Unit tests for bonus evaluators live under `server/services/__tests__/` and run via Node's built-in test runner: `npx tsx --test server/services/__tests__/*.test.ts`.

**Feature Specifications:**
- **Employee Work Schedules:** Per-employee weekly schedule configuration (which days and hours they work). Schedule warnings are displayed on clock-in/out (kiosk and web) when an employee is early, late, leaving early, or staying past their shift. Managed via the Schedule tab on employee profiles.
- **Kiosk System:** Public `/kiosk` route for employee clock-in/out using PIN or name search, designed for shared devices.
- **Dashboard:** Employee dashboard shows current clock status, hours, and PTO balance. Manager/Admin dashboards provide team/division-wide stats and approval queues.
- **Admin Pages:** Dedicated sections for managing Employees, Locations & Departments, Time Clock Rules (policies), PTO & Leave (with PTO Balances overview tab), Alerts & Exceptions, Payroll Prep, Payroll Documents, Reports, Permissions, Roles, Kiosks, and Audit Log.
- **Payroll Documents:** Employee-facing "My Pay Docs" page and admin "Payroll Documents" page for managing pay stubs and tax forms. Admin can create/delete document records; employees can view their own.
- **Punch Correction:** Employee attendance page includes a punch correction form with gray-tinted original punch section and blue-tinted corrected times section. Manager exception queue shows side-by-side red (recorded) vs green (requested) time comparison boxes.
- **API Endpoints:** A comprehensive set of RESTful APIs for all functionalities, including user authentication, attendance, time-off, company/location/department management, employment profiles, and reporting. All sensitive API calls are protected by RBAC and scoping.

**Core Entities (Data Model):**
- `companies`, `locations`, `location_addresses`, `users`, `departments`
- `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permission_overrides`, `user_access_scopes`
- `user_employment_profiles`
- `punch_logs`, `attendance_exceptions`
- `time_off_requests`, `time_off_balances`, `pto_policies`, `employee_pto_settings`
- `audit_logs`
- `payroll_exports`, `payroll_batch_records`, `payroll_adjustments`
- `employee_pins`, `kiosk_devices`
- `policy_types`, `policies`, `policy_rules`, `policy_assignments`
- `system_alerts`
- `documents`
- `employee_schedules`
- `payroll_documents`
- `workflows`

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
- **`ws`:** WebSocket library for real-time updates.
- **`multer`:** For handling file uploads (document management).

## Corporate Design System
- **PageHeader component** (`client/src/components/page-header.tsx`): Shared header with title, subtitle, and optional actions slot. Used across all pages for consistent layout.
- **App layout** (`client/src/components/app-layout.tsx`): Top header bar with sidebar trigger, separator, and "Ahava Medical Center" label. Main content area with `p-6` padding.
- **Page styling conventions**: `max-w-5xl` for employee pages, `max-w-6xl` for admin pages, `space-y-6` vertical rhythm, uppercase `tracking-wider` table headers, `tabular-nums` for numeric data.
- **DB column sync**: Schema columns added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (not drizzle-kit push which hangs). Affected tables: `employee_pto_settings`, `pto_policies`, `user_employment_profiles`, `companies` (added `address`, `phone`).

## Bulk Division Assignment
- **Endpoint**: `POST /api/users/bulk-assign-division` — body `{ userIds: string[], companyId: string, keepCompatible?: boolean }`. Admin + `users.edit`. Writes one audit log per affected user with action `user.bulk_assign_division`. By default clears `locationId`/`departmentId`; when `keepCompatible=true`, keeps them only if they belong to the new division.
- **Frontend**: `client/src/pages/employees.tsx` — multi-select checkbox column on the Employees list, a bulk action bar appears when rows are selected, and a dialog to pick a division and toggle the "keep compatible" option.

## Milestone 8: Alerts, Audit, Permissions UI & Hardening
- **system_alerts** (shared/schema.ts): Alert table (type, severity, status, employeeId, message, details JSONB, acknowledge/resolve with actor+timestamp)
- **Alert Engine** (`server/services/alerts.ts`): Detects missing clock-outs, overtime threshold breaches, no-shows. Triggered via `POST /api/alerts/detect`
- **Alert API**: `GET /api/alerts` (filtered), `POST /api/alerts/detect`, `POST /api/alerts/:id/acknowledge`, `POST /api/alerts/:id/resolve`
- **Audit Log Viewer**: `GET /api/audit-logs/filtered` with search, actor, action, targetType, date range, pagination
- **Role Management API**: Full CRUD + duplicate: `GET/POST /api/roles`, `PATCH/DELETE /api/roles/:id`, `POST /api/roles/:id/duplicate`
- **Permissions API**: `GET /api/permissions` (all permission keys)
- **Kiosk Device Management API**: `GET/POST /api/kiosk-devices`, `PATCH/DELETE /api/kiosk-devices/:id`
- **WebSocket**: `ws://host/ws` path for real-time attendance updates, broadcasts `attendance_update` events
- **Security Hardening**: All legacy `storage.createAuditLog` calls with wrong field names replaced with `writeAuditLog` using correct schema
- **Frontend Pages**: alerts.tsx, audit-log.tsx, permissions.tsx, role-management.tsx, kiosk-management.tsx

## Policy Builder Wizard
- **Component**: `client/src/components/policy-wizard.tsx` - Reusable 4-step wizard for creating/editing policies
- **Steps**: (1) Basics - type selection, name, description; (2) Rules - type-specific configuration with defaults; (3) Assignments - assign to divisions/locations/departments/employees; (4) Review - summary with save as draft or activate
- **Integration**: Replaces the old simple dialog in `PolicySection` on the Rules & Controls page
- **Policy Type Keys**: Database uses `attendance`, `pto`, `payroll`, `approvals`, `alerts`, `kiosk` (not suffixed versions)
- **Edit Mode**: Fetches existing rules and assignments to pre-populate all wizard steps

## Visual Workflow Builder
- **Component**: `client/src/components/workflow-builder.tsx` - Drag-and-drop visual workflow builder using @xyflow/react
- **Node Types**: Trigger (start events), Condition (branching logic with Yes/No paths), Approval (require sign-off), Action (execute steps), Notification (send notices)
- **Features**: Node palette for adding nodes, click-to-configure side panel, directional edges, preview mode, save as draft or activate
- **Backend Engine**: `server/workflowEngine.ts` - Executes active workflows when trigger events fire (PTO requests, attendance exceptions)
- **Database**: `workflows` table stores id, name, triggerType, status, nodeGraph (JSON), timestamps
- **API**: `GET/POST /api/workflows`, `GET/PATCH/DELETE /api/workflows/:id`
- **Integration**: Accessible from Rules & Controls > Approval Workflows section, with tabs for "Visual Workflows" and "Rule Policies"
- **Trigger Integration**: Workflow engine fires on PTO request submission and attendance exception creation

## HR Onboarding & Employee Management
- **Add Employee**: Multi-step dialog on Employees page (basic info -> employment details -> pay setup). Creates user with temporary password + `forcePasswordChange` flag.
- **Password Reset**: Admin can reset any employee password from their profile. Generates temp password, sets `forcePasswordChange` flag.
- **Force Password Change**: Users with `forcePasswordChange=true` see a password change screen instead of the main app until they set a new password.
- **Document Management**: Documents tab on employee profiles with 5 required document types (W-9, I-9, Direct Deposit, Emergency Contact, Handbook Ack). Upload, download, review status, delete capabilities. Files stored in `uploads/documents/`.
- **Onboarding Checklist**: Card on employee profile showing completion of: basic info, employment setup, pay config, all documents collected.
- **API Endpoints**: `POST /api/users` (create employee), `POST /api/users/:id/reset-password`, `POST /api/users/change-password`, `GET/POST /api/users/:id/documents`, `GET /api/documents/:id/download`, `PATCH/DELETE /api/documents/:id`
- **Schema**: `force_password_change` boolean on users table, `documents` table for file metadata

## Replit Deployment Topology (Low-Cost)
- **Primary deploy target**: **Autoscale** (single deployment serves both API + frontend; scales to zero when idle).
  - The Express app in `server/index.ts` serves the built React app and the API on the same port. No Reserved VM is needed for normal operation.
  - **Caveat**: WebSocket route `/ws` (used for live shift updates) requires a connected client; Autoscale supports WS but instances may recycle on low traffic. Reconnect logic on the client handles this.
- **Background work**: A separate **Scheduled Deployment** invokes the cron drain endpoint on a fixed cadence (recommend every 5 minutes).
  - Command (in the scheduled deployment): `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_URL/internal/jobs/run"`
  - This drains the `jobs` table: it runs the `auto-clock-out` recurring job (replaces the old in-process `setInterval`) plus any ad-hoc jobs enqueued via `POST /internal/jobs/enqueue`.
- **Frontend follow-up (not done in this pass)**: For further savings the static `dist/public/` build can be served from Static Hosting and the API kept on Autoscale; uploads under `uploads/` should move to Object Storage so Autoscale instances stay stateless.

## Performance & Cost Hardening (server)
- **Headers + compression**: `helmet()` and `compression()` are wired in `server/index.ts`.
- **Rate limiter** (`server/lib/rateLimit.ts`): in-memory token bucket applied globally to `/api` and `/internal`. Tunable via `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`.
- **Response cache + single-flight** (`server/lib/requestCache.ts`, `cache.ts`, `inFlight.ts`): TTL cache keyed by URL+user with `X-Cache: HIT` header. Applied to read-heavy GETs: `/api/users`, `/api/manager/team-stats`, `/api/admin/company-stats`, `/api/alerts`, `/api/audit-logs/filtered`. Tunable via `CACHE_TTL_MS`.
- **Cooldown** (`server/lib/cooldown.ts`): per-user gate on expensive POSTs (`/api/reports/generate`, `/api/payroll/exports`); returns `202 { retryAfterMs }` if called too soon. Tunable via `EXPENSIVE_COOLDOWN_MS`.
- **Slow-request log**: Requests slower than `SLOW_REQUEST_MS` are tagged in the log line.
- **DB pool**: `server/db.ts` uses `max:5`, idle 30s, conn 10s — sized for Autoscale instances. Tunable via `DB_POOL_MAX`.
- **Jobs table**: `jobs` table (migration `0017_jobs_table.sql`) drives `server/services/jobs.ts`. The drain endpoint is `POST /internal/jobs/run` (gated by header `x-cron-secret` matching env `CRON_SECRET`); ad-hoc enqueue at `POST /internal/jobs/enqueue`. Batch size via `JOBS_BATCH_SIZE`.
- **Required env / secrets**: `CRON_SECRET` (secret). Optional tuning env vars: `CACHE_TTL_MS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `EXPENSIVE_COOLDOWN_MS`, `DB_POOL_MAX`, `SLOW_REQUEST_MS`, `JOBS_BATCH_SIZE`.

## Performance Hardening (client)
- **`client/src/lib/cachedFetch.ts`**: thin fetch wrapper with an in-memory TTL cache keyed by `METHOD URL` (default 15s, override via `ttlMs`). GET requests within the TTL window return a cloned cached `Response`, and concurrent in-flight identical GETs share the same promise (single-flight). Non-GET requests pass straight through. Note: it does not parse server `Cache-Control` headers — server-side caching is signalled separately via `X-Cache: HIT` from `server/lib/requestCache.ts`. Use `invalidateCachedFetch(prefix?)` after a write to clear matching keys.
- **`client/src/hooks/use-debounce.ts`**: used for search inputs in `employees.tsx` (300ms) and `audit-log.tsx` (400ms) so filter/query keys don't change per keystroke.
- **Refetch intervals relaxed**: `dashboard.tsx` attendance status 30s → 60s; `profile.tsx` already 60s. Kiosk-page intervals are local UI timers (clock display, inactivity, success countdown), not network polling.
- **Reports**: AI/report generation in `reports.tsx` is **strictly user-triggered** (button click only). Do not auto-fire it from `useEffect` or on mount — the server enforces a per-user cooldown.
