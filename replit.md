# Ahava Medical Center - Time & Attendance System

## Overview
Employee time tracking and attendance management system for Ahava Medical Center. Built with Express + Vite + React stack with email/password authentication.

## Architecture
- **Backend**: Express.js with TypeScript
- **Frontend**: React with Vite, TanStack Query, Wouter routing, Shadcn/ui components
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Session-based email/password auth with bcryptjs

## Data Model
All tables use FK constraints where applicable (userId, managerId, reviewedBy, departmentId reference their parent tables).
- **users** (shared/models/auth.ts): Auth users with password hash, role (employee/manager/admin) and departmentId
- **departments**: Company departments with manager FK to users
- **attendance_records**: Clock in/out records per user per date (userId FK to users)
- **time_off_requests**: PTO/sick/etc. requests with approval workflow (userId, reviewedBy FK to users)
- **time_off_balances**: Per-user time off allocation and usage tracking per year (userId FK to users)
- **employee_pins**: Hashed PIN codes for kiosk clock-in (userId FK to users)
- **kiosk_devices**: Registered kiosk terminals (departmentId FK to departments)
- **sessions**: Auth session storage

## Key Files
- `shared/schema.ts` - All Drizzle table definitions with FK relations
- `shared/models/auth.ts` - Users (with password) and sessions tables
- `server/storage.ts` - IStorage interface and DatabaseStorage implementation
- `server/routes.ts` - API routes with role-based middleware and Zod validation
- `server/replit_integrations/auth/replitAuth.ts` - Session-based auth (login/logout/isAuthenticated)
- `server/index.ts` - Express app setup with auth wiring
- `server/seed.ts` - Database seed script (creates admin user with password and default department)
- `client/src/App.tsx` - Main app with auth-gated routing
- `client/src/components/app-sidebar.tsx` - Role-based sidebar navigation
- `client/src/components/app-layout.tsx` - Layout shell with sidebar
- `client/src/pages/login.tsx` - Login page with email/password form
- `client/src/hooks/use-auth.ts` - Auth hook for frontend

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

## Auth Notes
- Custom email/password auth with bcryptjs password hashing (no external OAuth)
- Session stored in PostgreSQL via connect-pg-simple
- `isAuthenticated` middleware sets `req.authUser` with the full user object
- Password field is excluded from all API responses
- Default admin: admin@ahavamedical.com / admin123

## Commands
- `npm run dev` - Start development server
- `npx drizzle-kit push` - Push schema changes to database
- `npx tsx server/seed.ts` - Seed database with admin user
