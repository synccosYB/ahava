---
name: Unified pay calculation engine
description: The single authoritative attendance/pay engine and the snapshot rule that keeps historical payroll stable.
---

# Unified pay calc engine (`server/payrollEngine.ts`)

There is ONE source of truth for turning hours-worked into regular/overtime/double-time
hours and into pay dollars. Every consumer (clock-out enforcement, timesheet, reports,
payroll batch create, CSV export, payroll summary, reconciliation verification) routes
through it. Before it existed the same math was implemented ~5 different ways (some
hard-coded `hours - daysWorked*8`, some per-day threshold, some with double-time, some
without) — that drift is the thing this engine eliminates.

Core pure functions: `splitDailyHours`, `computeGrossPay`, `summarizeDailyHours`,
`buildPayCalcPolicy` / `resolvePayCalcPolicy`.

**Rule: split per DAY, never against a range total.** Overtime is computed by splitting
each day's hours individually then summing — NOT `rangeTotal - daysWorked*8`. The old
formula let a long day and a short day net against each other and under-reported OT.
Reports/timesheet aggregate OT by summing per-day `overtimeHours + doubleTimeHours`.

**Rule: multipliers/thresholds are policy-driven, never hard-coded.** OT pays at the
payroll policy's `overtimeMultiplier` (default 1.5x), DT at `doubleTimeMultiplier`
(default 2.0x), OT threshold from the attendance policy `otThresholdDaily` (default 8),
DT threshold from payroll `doubleTimeThresholdDaily` (default 12). `holidayOtExclusion`
(pto policy) keeps a holiday's hours all-regular. On/off toggles are treated as `true`
unless explicitly `false` (so policies saved before the toggles existed keep behaving).

## The snapshot freeze (why historical periods stay stable)

**Why:** if payroll recomputed from the *live* policy, editing a policy would silently
change dollars on already-exported historical batches.

**How to apply:** when a payroll batch is created, the resolved `PayCalcPolicy` is FROZEN
onto each `payroll_batch_records` row — the numeric knobs + hourly rate, AND the on/off
toggles + the holiday determination. CSV export, the summary endpoint, and reconciliation
verification all PREFER these snapshot columns and only fall back to the current
profile/effective policy for legacy rows that predate the snapshot.

**Snapshot completeness matters:** the first cut snapshotted only the numeric knobs, so
reconciliation still re-read the live toggles (`autoCalculateOT`/`overtimeEnabled`/
`doubleTimeEnabled`/`holidayOtExclusion`) and the employee's CURRENT schedule to decide
holidays — both can change after export and produce FALSE drift on closed periods. Fix:
freeze the toggles + an `is_holiday` flag too, so a snapshotted row's recompute depends
ONLY on persisted inputs. If you add any new pay-affecting input to `splitDailyHours`,
snapshot it onto the row as well or historical verification will drift.

## Batch records are per employee-DAY, not per punch

Payroll batch creation groups punches by `(employeeId, workDate)`, sums the day's hours,
and writes ONE attendance record per day with the earliest punch as the linked
`punchLogId`. Consequence: reconciliation must recompute a day by SUMMING all punches
for that employee-date (the single linked punch is not the whole day) before splitting.

## One worked-hours INPUT, not just one pay formula

Unifying the pay split is not enough — every surface must also feed the engine the SAME
hours number. The canonical worked-hours input is the persisted, break-deducted
`punch_logs.hours_worked` (set at clock-out and by `computePunchHoursWorked`). A still-open
punch (no stored value) falls back to a live, break-deducted compute from the rounded
clock-in. `storage.getDailyHoursByDateRange`, `getAttendanceAggregatesByDateRange`, and the
timesheet helper `punchWorkedHours` (timesheetService) all use this exact rule.

**Why:** an earlier cut summed raw `clockOut - clockIn` (NO break deduction) in the report/
timesheet SQL while payroll summed stored `hours_worked` (break-deducted) — so the same
employee's reported hours and OT silently disagreed with payroll whenever a punch had
break minutes. **How to apply:** never re-derive worked hours from raw clock times for a
pay/report surface; prefer persisted `hours_worked`, fall back to the break-deducted live
formula only for open punches.

## Live vs. frozen scoping (deliberate)

Live operational read paths (reports, per-employee timesheet, dashboards) intentionally
resolve the CURRENT effective policy — a manager pulling a report today should see today's
thresholds/multipliers. Only payroll BATCHES freeze a policy snapshot (closed-period
stability). Do NOT "fix" live reads to read snapshots; that would be wrong by design.
