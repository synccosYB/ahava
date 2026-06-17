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

## Weekly overtime lives in the engine too (`computeWeeklyHours`)

Weekly OT (hours over a weekly threshold, default 40) is computed ONLY by the engine's
`computeWeeklyHours(days, policy)` — never inline in a consumer. It splits each day with
`splitDailyHours` FIRST (daily OT/DT preserved), then groups days into workweeks
(`workweekStartFor(date, workweekStartDay)`, default Sunday) and reclassifies REGULAR
hours over `otThresholdWeekly` into OT. No hour is double-counted: weekly OT only ever
comes from hours still regular after the daily split. Distribution is latest-day-first so
it's deterministic (batch create and reconciliation reproduce identical per-day rows).
Holiday-excluded days stay all-regular AND out of the weekly threshold. Gated by
`autoCalculateOT && weeklyOvertimeEnabled && otThresholdWeekly > 0`. Policy knobs:
`otThresholdWeekly`, `weeklyOvertimeEnabled`, `workweekStartDay` (attendance rules).

**Why:** `summarizeDailyHours` only does the daily split; reports/timesheet/payroll each
needed weekly OT and would have drifted if any computed it themselves. All range consumers
now call `computeWeeklyHours`; `summary.overtimeHours` already INCLUDES weekly OT (plus
daily OT), and `summary.weeklyOvertimeHours` is the weekly-only subset.

**Deliberate behavioral change:** `weeklyOvertimeEnabled` defaults TRUE (FLSA), so it
changes LIVE reports/timesheets/alerts immediately. Existing payroll BATCHES are
unaffected because the 3 weekly cols are snapshotted onto each row; rows that predate
weekly OT have NULL weekly cols and reconciliation recomputes them weekly-DISABLED, so
historical dollars never shift. The overtime alert (`alerts.ts detectOvertimeThreshold`)
must run the SAME `computeWeeklyHours` engine as pay — not its own raw weekly sum — or
the warning diverges from the paycheck (e.g. raw summing counts holiday-excluded days and
ignores daily-OT-first reclassification). It builds per employee-day break-deducted hours
(`computePunchHoursWorked`) + holiday flag, calls `computeWeeklyHours`, and fires off
`summary.weeklyOvertimeHours > 0` using the resolved policy threshold + `workweekStartDay`.

## Live vs. frozen scoping (deliberate)

Live operational read paths (reports, per-employee timesheet, dashboards) intentionally
resolve the CURRENT effective policy — a manager pulling a report today should see today's
thresholds/multipliers. Only payroll BATCHES freeze a policy snapshot (closed-period
stability). Do NOT "fix" live reads to read snapshots; that would be wrong by design.
