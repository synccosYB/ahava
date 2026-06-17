---
name: DB-backed attendance/payroll calc test setup
description: How to write deterministic DB-backed tests for PTO accrual, payroll, locked-period, and permission boundaries.
---

# Deterministic DB-backed calc tests

All attendance/payroll calc + permission tests run via
`./scripts/test-attendance-payroll.sh` (full path→test matrix lives in
`docs/attendance-payroll-test-coverage.md`). The DB-backed suites share ONE
Postgres DB, so the runner MUST serialize files (`--test-concurrency=1`) or they
race on overlapping fixture rows (e.g. open-punch counts).

- **Pin the PTO policy per test user.** PTO accrual resolves the effective `pto`
  policy through `getEffectivePolicy` (employee → role → dept → location → company
  → global). Give the user an **employee-level** assignment (a `policy_assignments`
  row with just `userId`) so it always wins deterministically. The rules JSON keys
  mirror the legacy `pto_policies` columns; per-employee overrides + `hireDate` live
  in `employee_pto_settings`. Seed punch `workDate`s in the CURRENT calendar year or
  `computeTotalHoursWorked` won't count them.
- **Locked-period guard is route-level, not a DB cascade.** Test it end-to-end:
  boot `registerRoutes` on an ephemeral express server, JWT the seeded
  `admin-dev-001`, link a punch to a `payroll_exports` row via
  `payroll_batch_records`. Finalized statuses (`exported`/`locked`) → `DELETE
  /api/attendance/punches/:id` returns 409 `PAYROLL_FINALIZED`; `draft` → deletes.
- **Permission tests** drive the REAL `requirePermission` behind a stubbed auth that
  injects `authUser`; it grants on `system.super_admin` OR the exact key.
- **Node 20 `--experimental-test-coverage` has no include/exclude** — it prints a
  whole-process per-file table; scope by reading the calc-module rows.

## Known production bug (characterized, NOT fixed)

PTO anniversary tier raises never persist for engine-resolved policies:
`applyPtoAnniversaryAdjustments` writes `ptoPolicyId = effective.policyId` (a
unified-engine `policies.id`) but `pto_anniversary_adjustments.pto_policy_id` FKs the
legacy `pto_policies.id`, so the INSERT fails the FK and is swallowed into the
sweep's `errors[]`. `ptoBalanceCalc.test.ts` pins the broken behavior; a real fix
must update that test's assertions.
