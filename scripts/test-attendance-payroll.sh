#!/usr/bin/env bash
#
# Attendance & Payroll calculation + permission test suite.
# ---------------------------------------------------------------------------
# Runs every automated test that covers the attendance/payroll calculation
# paths and the role-based permission boundaries, under Node's built-in test
# runner with coverage enabled. This is the ONE documented command for the
# whole attendance/payroll calc + permission surface.
#
# USAGE:
#   ./scripts/test-attendance-payroll.sh
#
# REQUIREMENTS:
#   - DATABASE_URL must be set: most tests connect to Postgres (PTO accrual /
#     balance, payroll reconciliation, locked-period guard, permission matrix,
#     report aggregation, concurrency). The pure calculation tests (policyCalc,
#     punchHoursCalc, policyEnforcement, punchLogTimes, punchSources) run without
#     a DB but are included so one command exercises the whole surface.
#
# COVERED PATHS (see docs/attendance-payroll-test-coverage.md for the full
# path -> test matrix and the rationale for anything left uncovered):
#   Pure logic (no DB):
#     - services/policyCalc.test.ts        roundTime, enforceClockOut (daily OT /
#                                          double-time / break / toggles), auto
#                                          clock-out, PTO advance-notice + blackout.
#     - services/policyEnforcement.test.ts early-arrival + day-of-week payroll
#                                          bonus evaluation.
#     - services/punchLogTimes.test.ts     punch rounding / time normalization.
#     - punchHoursCalc.test.ts             computePunchHoursWorked (incl. overnight
#                                          + DST real-elapsed-time), attendance
#                                          totals, buildPtoPolicyFromRules.
#     - punchSources.test.ts               canonical punch-method classification.
#     - punchTimeDisplayTz.test.ts         punch times render in clinic wall-clock
#                                          tz (formatTime12InTz / overnight-shift
#                                          detection / resolveEmployeeTimezone).
#     - punchValidation.test.ts            shared punch-integrity validator (per
#                                          rejection case: impossible/future/
#                                          overlap/duplicate-open).
#   DB-backed:
#     - punchIntegrityRoute.test.ts        punch-edit route rejects bad edits
#                                          (400) + recomputes hours on a valid edit.
#     - services/clockInIntegration.test.ts  clock-in punch lifecycle.
#     - services/duplicateOpenPunch.test.ts  concurrent clock-in -> one open punch.
#     - services/exceptionResolveRoute.test.ts exception resolve honors OT threshold.
#     - ptoBalanceCalc.test.ts             accrual (annual + per-hours), sick cap,
#                                          overrides, carryover cap, holiday
#                                          deduction, anniversary tier (bug char.).
#     - ptoEmployeeAssignment.test.ts      employee-level PTO policy resolution.
#     - ptoPolicyConsolidation.test.ts     unified-engine PTO rule -> synthetic policy.
#     - timeOffHours.test.ts               PTO balance reducer hardening.
#     - timeOffMaxConsecutive.test.ts      max-consecutive PTO enforcement.
#     - payrollVerificationCalc.test.ts    payroll OT split recompute + drift.
#     - payrollLockedPeriod.test.ts        finalized-payroll edit-blocking (409).
#     - taxClassificationFilter.test.ts    payroll tax-classification filter.
#     - reportAggregation.test.ts          SQL report totals == in-memory totals.
#     - reportCategories.test.ts           per-category report scoping.
#     - concurrentUpdates.test.ts          atomic PTO-balance / approval races.
#     - attendancePayrollPermissions.test.ts role permission matrix (real RBAC).
#     - companyPermissions.test.ts         company CRUD permission boundaries.
#     - permissionDrift.test.ts            route permission keys exist in seed catalog.
#
# OUT OF SCOPE (intentionally excluded): biometric, kiosk, geofence, and
# workflow coverage, plus pure-infra tests (schema drift, request-cache
# invalidation) that are not attendance/payroll calculations.
#
# COVERAGE:
#   Node 20's --experimental-test-coverage has no include/exclude filtering, so
#   the run prints a per-file table for the WHOLE process. Read the rows for the
#   calculation modules under test to gauge coverage, in particular:
#     - server/services/policyEnforcement.ts   (clock-in/out + PTO + bonus enforce)
#     - server/punchHours.ts                    (per-punch hours engine)
#     - server/timesheetService.ts             (attendance totals)
#     - server/policyEngine.ts                  (rule defaults + PTO rule build)
#     - server/services/reconciliation.ts       (payroll verification)
#     - server/services/ptoAnniversary.ts       (anniversary tier transitions)
#     - server/middleware/rbac.ts               (permission resolution)
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILES=(
  # Pure logic (no DB required)
  "server/services/__tests__/policyCalc.test.ts"
  "server/services/__tests__/policyEnforcement.test.ts"
  "server/services/__tests__/punchLogTimes.test.ts"
  "server/__tests__/punchHoursCalc.test.ts"
  "server/__tests__/punchSources.test.ts"
  "server/__tests__/punchValidation.test.ts"
  "server/__tests__/punchTimeDisplayTz.test.ts"
  # DB-backed: attendance / punch lifecycle
  "server/services/__tests__/clockInIntegration.test.ts"
  "server/services/__tests__/duplicateOpenPunch.test.ts"
  "server/services/__tests__/exceptionResolveRoute.test.ts"
  "server/__tests__/punchIntegrityRoute.test.ts"
  # DB-backed: PTO
  "server/__tests__/ptoBalanceCalc.test.ts"
  "server/__tests__/ptoEmployeeAssignment.test.ts"
  "server/__tests__/ptoPolicyConsolidation.test.ts"
  "server/__tests__/timeOffHours.test.ts"
  "server/__tests__/timeOffMaxConsecutive.test.ts"
  # DB-backed: payroll
  "server/__tests__/payrollVerificationCalc.test.ts"
  "server/__tests__/payrollLockedPeriod.test.ts"
  "server/__tests__/taxClassificationFilter.test.ts"
  # DB-backed: reports / concurrency
  "server/__tests__/reportAggregation.test.ts"
  "server/__tests__/reportCategories.test.ts"
  "server/__tests__/concurrentUpdates.test.ts"
  # DB-backed: permission boundaries
  "server/__tests__/attendancePayrollPermissions.test.ts"
  "server/__tests__/companyPermissions.test.ts"
  "server/__tests__/permissionDrift.test.ts"
)

echo "Running attendance & payroll calc + permission tests with coverage..."
# --test-concurrency=1 runs the files one at a time. The DB-backed suites share
# ONE Postgres database, so running them in parallel races on overlapping
# fixture rows (e.g. open-punch counts); serializing keeps them deterministic.
exec node --import tsx --test --test-concurrency=1 --experimental-test-coverage "${TEST_FILES[@]}"
