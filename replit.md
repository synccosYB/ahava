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
- **Role-Based Access Control (RBAC):** Granular permissions are managed through roles, user-specific overrides, and access scopes (company, location, department). Middleware (`requirePermission`, `requireScopedAccess`) enforces these rules.
- **Policy Engine:** A dynamic policy engine allows for hierarchical rule resolution (employee → department → location → company → global default) for attendance, PTO, payroll, approvals, alerts, and kiosk behaviors. Policies are defined with rules stored as JSON objects.
- **Time & Attendance:** Manages `punch_logs` (clock in/out records), `attendance_exceptions` (missing punches, time corrections with approval workflows), and computes `hoursWorked`.
- **PTO Management:** Tracks `time_off_requests` with approval workflows and `time_off_balances`. Configurable `pto_policies` define accrual rates, caps, and holiday pay rules.
- **Audit Logging:** A robust `audit_logs` system captures sensitive operations with actor, target, action, and detailed context.
- **Alerts:** System alerts for missing clock-outs, overtime breaches, and no-shows, with acknowledgement and resolution workflows.
- **Real-time Updates:** WebSocket integration (`/ws`) for real-time attendance updates, with session/JWT auth at handshake.

**Feature Specifications:**
- **Kiosk System:** Public `/kiosk` route for employee clock-in/out using PIN or name search, designed for shared devices.
- **Dashboard:** Employee dashboard shows current clock status, hours, and PTO balance. Manager/Admin dashboards provide team/company-wide stats and approval queues.
- **Admin Pages:** Dedicated sections for managing Employees, Locations & Departments, Time Clock Rules (policies), PTO & Leave, Alerts & Exceptions, Payroll Prep, Reports, Permissions, Roles, Kiosks, and Audit Log.
- **API Endpoints:** A comprehensive set of RESTful APIs for all functionalities, including user authentication, attendance, time-off, company/location/department management, employment profiles, and reporting. All sensitive API calls are protected by RBAC and scoping.

**Core Entities (Data Model):**
- `companies`, `locations`, `users`, `departments`
- `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permission_overrides`, `user_access_scopes`
- `user_employment_profiles`
- `punch_logs`, `attendance_exceptions`
- `time_off_requests`, `time_off_balances`, `pto_policies`, `employee_pto_settings`
- `audit_logs`
- `payroll_exports`, `payroll_batch_records`, `payroll_adjustments`
- `employee_pins`, `kiosk_devices`
- `policy_types`, `policies`, `policy_rules`, `policy_assignments`
- `system_alerts`

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
