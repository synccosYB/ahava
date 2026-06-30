---
name: Punch-time display timezone
description: How clock-in/out times are rendered in the business/location timezone across all surfaces.
---

# Punch-time display timezone

Punch times are stored in UTC. Every surface that renders a clock-in/out time
shows it in the BUSINESS/LOCATION timezone (location.timezone → company.timezone
→ "America/New_York"), NOT the viewer's browser timezone. There are no per-viewer
timezone preferences.

**How it works:**
- Server resolves the timezone with `resolveEmployeeTimezone(userId)` (in
  `server/services/punchOverlap.ts`) and stamps it onto the API response (a
  top-level `timezone` field, or per-row for multi-employee lists like
  `/api/attendance/punches`).
- Client formats with `formatTime12InTz(value, timezone)` (in
  `client/src/lib/utils.ts`), which falls back to local time when tz is
  missing/invalid. `getOvernightShiftInfo(workDate, clockOut, timezone)` also
  takes the tz so overnight detection + end-date labels are tz-consistent.
- Kiosk has its own `formatShortTime`/`formatDate` (in `client/src/pages/kiosk.tsx`)
  that take an optional timezone; the live wall-clock header stays device-local on
  purpose.

**Why:** a kiosk/admin viewing from a different timezone than the clinic must see
the clinic's wall-clock time for the same punch, or attendance looks wrong.

**How to apply:** any NEW surface that displays a punch time must thread the
server-resolved timezone through and format with the tz-aware helpers — never
render a raw UTC timestamp with the viewer's local formatter.
