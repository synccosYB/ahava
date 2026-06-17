---
name: Attendance ledger single source of truth
description: The persisted per-employee-per-day ledger is the one materialization of the pay engine; how reads, freshness, and scoping must work.
---

# Attendance ledger (single source of truth)

The attendance ledger is the ONE persisted, per-(employee, workDate)
materialization of the pay engine (`splitDailyHours`): regular/OT/DT/total
hours, a display-only PTO figure, holiday determination, status, open-punch
flag, policy versions. Every row is the engine's output — no attendance/OT math
lives outside the engine.

**Rule:** every hours/OT consumer reads the ledger — timesheet, reports, team &
department dashboards, payroll batch create. Never reintroduce ad-hoc
`clockOut-clockIn` or `daysWorked*8` attendance math on any surface. The
timesheet keeps ONLY display fields (clock-in/out, break, kiosk sources) from
raw punches; its hours/OT and totals come from the ledger.

**Why:** before this, each surface recomputed splits its own way and drifted —
most painfully range-total OT vs per-day OT. Materializing one engine output
kills cross-surface drift and gives payroll a durable record to read.

**How to apply:**
- Read path is recompute-through: read helpers recompute each requested day in
  memory (deterministic → all consumers agree) AND write-through persist via a
  diff-upsert (no-op writes skipped). Persisted rows are what payroll reads.
- The ledger module must NOT be imported by `storage.ts` (circular import).
  Freshness hooks live at the route/service layer and call the recompute helper
  with the affected dates after a fact-changing DB write.
- Hook EVERY fact change that can move hours or approved PTO coverage: clock-out,
  manual punch edit/delete, exception resolution, auto-clock-out, and PTO
  approve. PTO deny/edit are pending-only today (no approved-coverage change) but
  are still hooked defensively so all PTO transitions stay consistent.
- Live-vs-frozen scoping (same as the pay engine): live operational reads resolve
  the CURRENT policy; only payroll BATCHES freeze a policy+rate snapshot for
  closed-period stability. Do NOT make live reads read snapshots, and keep
  freezing the snapshot in payroll even though it now reads the split from the
  ledger.
- Worked-hours INPUT stays the canonical break-deducted persisted
  `punch_logs.hours_worked` (live fallback only for still-open punches) — the
  same input the timesheet/report aggregators feed the engine.
- A day is a "holiday" when its UTC day-of-week is not in the employee's active
  scheduled days; `holidayOtExclusion` then keeps that day all-regular.

Golden test (DB-backed, seeds a regular/OT/DT/holiday/multi-punch matrix and
asserts ledger == engine split == ledger-backed timesheet, plus edit/delete
recompute hooks persist correctly): `server/__tests__/attendanceLedger.test.ts`.
