# Attendance Ledger & Single Source of Truth (Task #464)

This document is the data-classification audit for every hours / overtime / PTO /
payroll store in the system, and the design of the canonical **attendance
ledger** that makes every surface read identical numbers.

## 1. Data classification

Each store is labelled **authoritative** (the system of record — facts entered by
humans/devices), **snapshot** (a deliberate frozen copy for historical
stability), **cache** (a fast, rebuildable copy of something computed
elsewhere), or **derived** (computed on demand from authoritative data).

| Store | Classification | Notes |
| --- | --- | --- |
| `punch_logs` (clock_in/out, rounded times, break_minutes, work_date) | **authoritative** | The raw attendance facts. Everything about worked hours is derived from these. |
| `punch_logs.hours_worked` / `.status` | **derived** (persisted) | Per-punch break-deducted hours from `computePunchHoursWorked` / `splitDailyHours`, written at clock-out. A persisted derivation of the punch's own clock times — recomputable, never an independent input. |
| `time_off_requests` | **authoritative** | The system of record for PTO/cashout usage (dates, hours requested/approved, status). |
| `time_off_balances` | **cache** | Rebuildable from accrual policy + approved `time_off_requests` via `computeTimeOffBalanceDetailed`. |
| **`attendance_ledger`** (this task) | **derived** (persisted, canonical) | The one materialized per-employee-per-day result (regular/OT/DT/total hours, PTO impact, holiday, status) produced **exclusively** by the pay engine. The single read-source for all live attendance/hours surfaces. |
| `payroll_batch_records` | **snapshot** | Frozen at batch creation (policy knobs + rate + the resolved split) so closed periods never move. Reads the ledger to populate, then freezes. |
| Request/response cache, client `cachedFetch` | **cache** | TTL copies of GET responses; invalidated on mutation. |

### The drift this eliminates
Before this task two dashboard endpoints (`/api/manager/team-status`,
`/api/admin/department-breakdown`) computed worked hours as raw
`clockOut - clockIn` — **no break deduction, no rounding, no engine** — so they
silently disagreed with the timesheet/reports/payroll (which all already routed
through `payrollEngine`). The ledger removes every such ad-hoc path: there is now
exactly one place that turns punches into hours.

## 2. The ledger

`attendance_ledger` holds one row per `(employee_id, work_date)`:

- `regular_hours`, `overtime_hours`, `double_time_hours`, `total_hours` — the
  engine's daily split (`splitDailyHours`).
- `pto_hours` — **derived display** value: approved PTO hours attributable to the
  day (informational; payroll's PTO line items still come from the authoritative
  `time_off_requests`, see §4).
- `is_holiday`, `status` (`complete` | `overtime`), `has_open_punch`,
  `source_punch_count`, `attendance_policy_version`, `payroll_policy_version`,
  `computed_at`.

### Who writes it
Only `server/attendanceLedger.ts`. It resolves the **current effective**
PayCalcPolicy (`resolvePayCalcPolicy`), sums the day's canonical break-deducted
worked hours (persisted `hours_worked`, live fallback for open punches), detects
holidays from the active schedule, and calls `splitDailyHours`. It never invents
math — it is a thin materialization of the Task #84 engine.

### Read path = recompute-through (always fresh, deterministic)
Read helpers (`getLedgerForEmployee`, `getLedgerForEmployees`) recompute each
requested employee-day in memory from current facts + current policy, then
**write through** to the table (diff-upsert; no-op writes are skipped so steady
reads are pure reads). Because every consumer calls the same deterministic
function, they cannot disagree. The persisted rows are the durable record that
payroll reads after a recompute and that admins can inspect.

This deliberately honours the project's **live-vs-frozen** rule: live reads use
the *current* policy; only payroll **snapshots** freeze it.

## 3. Staying fresh on fact changes
`recomputeLedger(employeeId, dates)` is invoked from every write path that
changes attendance facts: clock-out, manual punch edit/delete, attendance
exception resolution (which inserts/updates/deletes punches), auto-clock-out, and
PTO approve/deny/adjust. So the persisted ledger is current even between reads.
(`ledgerService` is intentionally NOT imported by `storage.ts` to avoid a
circular import — hooks live at the route/service layer.)

## 4. Payroll consumes the ledger
`POST /api/payroll/exports` refreshes the ledger for the batch range, then writes
each attendance batch record's `regular/overtime/double_time` **from the ledger
split** (recalculating none of it) while still **freezing** the policy snapshot
(knobs + rate + `is_holiday`) onto the row for closed-period stability. PTO and
cashout batch records continue to come from the authoritative
`time_off_requests`. Locked/exported batches are never recomputed.

## 5. Consistency proof
`server/__tests__/attendanceLedger.test.ts` runs a golden matrix (regular,
overtime, double-time, holiday-exclusion, multi-punch days) and asserts the
ledger split, the per-day timesheet split, the report summary, and the payroll
batch split are byte-for-byte identical for the same facts.
