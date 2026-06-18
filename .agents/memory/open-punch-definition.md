---
name: Canonical open-punch definition
description: An "open shift" is defined by clock_in present + clock_out absent everywhere — never by status; kiosk uses status 'present', web uses 'in-progress'.
---

# Canonical open-punch definition

An employee is "currently clocked in" / has an "open shift" IFF a `punch_logs`
row has `clock_in IS NOT NULL AND clock_out IS NULL`. This single predicate is
used by: the DB partial unique index `idx_punch_logs_one_open_per_employee`
(migration 0048), the shared punch-integrity validator (`server/punchValidation.ts`),
`storage.clockIn`/`clockOut` internal guards, the kiosk clock-out path, and the
`getCurrentAttendance` 409 guard.

**Never key open-shift detection on `status`.** The web clock-in path stamps
`status = 'in-progress'` while the kiosk stamps `status = 'present'` for the very
same open state. Closed punches get `'complete'`/`'overtime'` from the pay engine.

**Why:** `getCurrentAttendance` once filtered on `status = 'in-progress'`, so a
kiosk-created (or dangling, interrupted-clock-out) open row was invisible to the
409 "already clocked in" guard but still rejected by the integrity validator —
producing a stuck state: clock-in 400 ("already has an open shift") AND clock-out
400 ("Not currently clocked in"), locking the employee out of both.

**How to apply:** any new "is this open?" check must use `clock_in NOT NULL AND
clock_out NULL`, not status. Live-hours accrual (`getTodayHours`/`getWeekHours`)
follows the same rule: accrue elapsed time when `clockIn && !clockOut`. If you
ever leave a row open with an odd status, it's still open — heal status to
`'in-progress'` (open) or a finished status (closed), don't rely on it for detection.
