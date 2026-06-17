# Attendance & Payroll Test Coverage Matrix

The single command that runs the whole attendance/payroll calculation +
permission surface (with coverage) is:

```bash
./scripts/test-attendance-payroll.sh          # requires DATABASE_URL
```

It runs all of the files below under Node's built-in test runner
(`node --import tsx --test --test-concurrency=1 --experimental-test-coverage`).
`--test-concurrency=1` is required: every DB-backed suite shares ONE Postgres
database, so running files in parallel races on overlapping fixture rows.

Total: **144 tests across 22 files, all passing.**

## Calculation paths → tests

| Calc path | Where it lives | Covered by |
|---|---|---|
| Per-punch hours (`hoursWorked`), incl. **overnight** + **DST real-elapsed-time** | `server/punchHours.ts` | `punchHoursCalc.test.ts` |
| Attendance totals (regular/OT/days) | `server/timesheetService.ts` | `punchHoursCalc.test.ts`, `reportAggregation.test.ts` |
| Time rounding (nearest N min, grace) | `server/services/policyEnforcement.ts` | `policyCalc.test.ts`, `punchLogTimes.test.ts` |
| **Daily** overtime + double-time at clock-out | `enforceClockOut` (`policyEnforcement.ts`) | `policyCalc.test.ts` |
| Auto clock-out | `policyEnforcement.ts` | `policyCalc.test.ts` |
| Break-deduction toggles | `policyEnforcement.ts` | `policyCalc.test.ts` |
| Payroll bonus — early-arrival & day-of-week | `policyEnforcement.ts` | `policyEnforcement.test.ts` |
| Payroll verification / reconciliation (reg↔OT split recompute + drift) | `server/services/reconciliation.ts` (`computePayrollVerification`) | `payrollVerificationCalc.test.ts` |
| Locked-period edit blocking (finalized payroll → 409 `PAYROLL_FINALIZED`) | `DELETE /api/attendance/punches/:id` (`routes.ts`) | `payrollLockedPeriod.test.ts` |
| Payroll tax-classification filter (W-2 / 1099) | `/api/reports/generate` + storage | `taxClassificationFilter.test.ts` |
| PTO accrual — annual & per-hours-worked | `computeTimeOffBalanceDetailed` (`storage.ts`) via `buildPtoPolicyFromRules` | `ptoBalanceCalc.test.ts` |
| PTO sick accrual + yearly cap | same | `ptoBalanceCalc.test.ts` |
| PTO per-employee overrides | `employee_pto_settings` | `ptoBalanceCalc.test.ts` |
| PTO waiting period | same | `ptoBalanceCalc.test.ts` |
| PTO used-hours deduction | same | `ptoBalanceCalc.test.ts` |
| PTO **carryover cap** (capped + under-cap rollover) | `storage.ts` carryover branch | `ptoBalanceCalc.test.ts` |
| PTO **holiday deduction** (holiday hrs reduce annual vacation) | `storage.ts` holiday branch | `ptoBalanceCalc.test.ts` |
| PTO **anniversary tier transition** | `server/services/ptoAnniversary.ts` | `ptoBalanceCalc.test.ts` (characterizes a CONFIRMED BUG — see below) |
| Effective PTO policy resolution (employee-level assignment wins) | `getEffectivePolicy` (`policyEngine.ts`) | `ptoEmployeeAssignment.test.ts`, `ptoPolicyConsolidation.test.ts` |
| PTO balance reducer hardening (corrupt-row guard) | `storage.ts` | `timeOffHours.test.ts` |
| PTO enforcement — advance notice & blackout dates | `policyEnforcement.ts` | `policyCalc.test.ts` |
| PTO enforcement — max consecutive hours (flag, not reject) | `routes.ts` / storage | `timeOffMaxConsecutive.test.ts` |
| Report aggregation (SQL totals == in-memory totals) | `storage.ts` aggregates | `reportAggregation.test.ts` |
| Per-category report scoping (PTO / missing / exceptions) | `storage.ts` | `reportCategories.test.ts` |
| Punch lifecycle — clock-in actual vs rounded persistence | `storage.clockIn` | `clockInIntegration.test.ts` |
| Punch lifecycle — single open punch under concurrency | `storage.clockIn` | `duplicateOpenPunch.test.ts` |
| Punch method classification | `punchSources` | `punchSources.test.ts` |
| Exception resolve honors configured OT threshold | `routes.ts` exception resolve | `exceptionResolveRoute.test.ts` |
| Atomic PTO-balance / approval races | `storage.ts` increments | `concurrentUpdates.test.ts` |

## Permission boundaries → tests

| Boundary | Covered by |
|---|---|
| Employee / Dept Manager / Payroll Admin / Division Admin / Super Admin matrix through the real `requirePermission` + `resolveUserPermissions` | `attendancePayrollPermissions.test.ts` |
| Company CRUD permission boundaries (Division Admin allowed, Employee denied) | `companyPermissions.test.ts` |
| Every `requirePermission("...")` key in routes exists in the seeded catalog | `permissionDrift.test.ts` |

## Paths intentionally NOT covered (with rationale)

- **Weekly overtime (`otThresholdWeekly`)** — NOT a pay calculation. It only feeds
  an *alert* (`server/services/alerts.ts`); `enforceClockOut` computes daily OT and
  double-time only. There is no weekly-OT pay path to test. (Candidate follow-up if
  weekly OT becomes a real pay rule.)
- **`holidayOtExclusion`** — the rule key is surfaced in the policy builder but is
  NOT consumed by `enforceClockOut` or the reconciliation calc. Nothing to assert
  until it is wired into a calculation.
- **"Source punch deleted after export" reconciliation branch** — effectively
  unreachable: `payroll_batch_records.punch_log_id` FKs `punch_logs` with no
  `ON DELETE`, and the route guard returns 409 before any delete. The locked-period
  route guard (`payrollLockedPeriod.test.ts`) is the meaningful coverage instead.
- **Out of task scope:** biometric, kiosk, geofence, and workflow calculations, and
  UI/component tests.

## Confirmed bug surfaced (NOT fixed — needs a follow-up)

**Anniversary PTO tier raises never persist for engine-resolved policies.**
`applyPtoAnniversaryAdjustments` (`server/services/ptoAnniversary.ts`) computes the
tier transition correctly, then writes the adjustment with
`ptoPolicyId: effective.policyId` — a **unified policy-engine `policies.id`** —
while `pto_anniversary_adjustments.pto_policy_id` has a foreign key to the **legacy
`pto_policies.id`**. Since PTO resolves through the unified engine today, that id
never exists in `pto_policies`, so the INSERT raises a FK violation that is swallowed
into the sweep's `errors[]`. Net effect: the anniversary raise (and its balance
grant) is silently dropped for every engine-resolved PTO policy.

`ptoBalanceCalc.test.ts` pins this broken behavior as a characterization test so a
future fix (make the row persist and the balance increment) will trip the test and
force the assertions to be updated alongside the fix. **Per task scope this was not
fixed — it should be addressed in a follow-up task.**
