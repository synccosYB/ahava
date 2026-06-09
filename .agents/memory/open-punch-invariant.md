---
name: Open punch invariant
description: How "one open punch per employee" is defined and enforced in attendance code
---
# Open punch invariant

An "open punch" = a `punch_logs` row with `clock_in IS NOT NULL AND clock_out IS NULL`.
A partial unique index `idx_punch_logs_one_open_per_employee` (migration 0046) enforces at most one per employee at the DB level.

**Why status is NOT part of the predicate:** the web clock-in path stamps `status='in-progress'` while the kiosk path stamps `status='present'` for the same open state. `getCurrentAttendance` only matches `'in-progress'`, so it does NOT see kiosk-opened punches — rely on `clock_out IS NULL` (not status) when you need "is this employee clocked in anywhere".

**How to apply:**
- New clock-in must go through `storage.clockIn` (transaction + `pg_advisory_xact_lock(hashtext(userId))` + re-check + insert). It throws `DuplicateOpenPunchError` (→ mapped to 409 in `routeErrors.mapRouteError`).
- New clock-out must go through `storage.closeOpenPunch(id, updates)` which guards on `clock_out IS NULL`, so a double clock-out is a clean no-op (returns undefined).
- Any code that inserts an open punch (e.g. forgotten_clock_in / missing_punch correction approval) can now hit the unique index; `mapRouteError` maps that 23505 to a friendly 409. Don't create a second open punch for an employee who already has one.
