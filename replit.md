# Ahava Medical Center - Time & Attendance System

## Overview
Employee time tracking and attendance management system for Ahava Medical Center. Built with Express + Vite + React stack with email/password authentication. Includes a tablet kiosk clock-in system for shared devices.

## Architecture
- **Backend**: Express.js with TypeScript
- **Frontend**: React with Vite, TanStack Query, Wouter routing, Shadcn/ui components
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Replit Auth (OpenID Connect) with session-based sessions

## Data Model
All tables use FK constraints where applicable (userId, managerId, reviewedBy, departmentId reference their parent tables).
- **users** (shared/models/auth.ts): Auth users with role (employee/manager/admin) and departmentId
- **departments**: Company departments with manager FK to users
- **attendance_records**: Clock in/out records per user per date (userId FK to users), with breakMinutes, totalHours, source field (web/kiosk)
- **time_off_requests**: PTO/sick/personal requests with daysRequested and approval workflow (userId, reviewedBy FK to users)
- **time_off_balances**: Per-user time off allocation and usage tracking per year (userId FK to users)
- **employee_pins**: Hashed PIN codes for kiosk clock-in (userId FK to users)
- **kiosk_devices**: Registered kiosk terminals (departmentId FK to departments)
- **sessions**: Auth session storage

## Key Files
- `shared/schema.ts` - All Drizzle table definitions with FK relations
- `shared/models/auth.ts` - Users (with password) and sessions tables
- `server/storage.ts` - IStorage interface and DatabaseStorage implementation (includes kiosk methods)
- `server/routes.ts` - API routes with role-based middleware, Zod validation, and kiosk endpoints
- `server/replit_integrations/auth/replitAuth.ts` - Session-based auth (login/logout/isAuthenticated)
- `server/index.ts` - Express app setup with auth wiring
- `server/seed.ts` - Database seed script (creates admin user with password and default department)
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
- `GET /api/departments` - All departments
- `POST /api/departments` - Create department (admin only)

## Theming
Brand colors (Ahava Medical):
- Dark Navy: #123047 (HSL 205 60% 17%) - sidebar background, foreground text
- Teal: #56b9ca (HSL 189 50% 56%) - primary color, accent
- Green: #009972 (HSL 163 100% 30%) - chart color
- Blue: #1f97d4 (HSL 203 74% 48%) - chart color

## User Roles
- **employee**: Dashboard, My Attendance, Time Off, Profile
- **manager**: + Team View, Approvals (with pending count badge)
- **admin**: + Company, Users, Settings, Reports

## Commands
- `npm run dev` - Start development server
- `npx drizzle-kit push` - Push schema changes to database
- `npx tsx server/seed.ts` - Seed database
