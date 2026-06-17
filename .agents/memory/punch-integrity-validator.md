---
name: Punch integrity validator
description: The single shared server-side punch-integrity check and where every punch write path must route through it.
---

# Shared punch-integrity validator

`server/punchValidation.ts` exports the PURE, synchronous `validatePunchIntegrity(input)` — the ONE place that rejects impossible/inconsistent punches (missing/unparseable clock-in, unparseable clock-out, zero/negative duration, future-dating, duplicate open shift, half-open-interval overlap). It returns `{ ok, reason? }` with a human-readable reason.

The route layer adds the async parts via `validateProposedPunch(...)` in `server/routes.ts` (loads neighbouring punches ±1 day through `storage.getAttendanceRecords`, resolves `allowFuturePunchFromRules`). The locked-payroll guard is SEPARATE (`findFinalizedPayrollExportsForPunch` / `...ForEmployeeDate`) and returns 409 `PAYROLL_FINALIZED`, distinct from the 400 integrity reasons.

**Rule:** every punch WRITE path must route the proposed punch through `validateProposedPunch` before persisting — employee clock-in/out, kiosk clock-in/out (returns kioskError 400 `invalid_punch`), manager PATCH edit, and correction-resolve (forgotten_clock_in/missing_punch = new punch + date-coverage lock; forgotten_clock_out/time_correction = existing punch + punch-id lock; punch_removal has its own lock block). If you add a NEW write path, wire it too or the surfaces drift.

**Why:** before this, each surface had ad-hoc/missing checks (the PATCH edit had no finalized-payroll guard at all), so impossible punches and edits inside locked payroll could slip in on some paths but not others.

**Future-dating toggle:** policy-rules JSON key `allowFuturePunches` on the attendance policy (default `false`, lives in `DEFAULT_ATTENDANCE_RULES`). Only an explicit `true` permits future punches. No migration — it's a JSON rule key.

Tests: `server/__tests__/punchValidation.test.ts` (pure, per rejection case) + `server/__tests__/punchIntegrityRoute.test.ts` (DB-backed PATCH edit: rejections + recalc-on-edit). Both wired into `scripts/test-attendance-payroll.sh`. DB tests must clean up `attendance_ledger` rows (FK to users) before deleting the test user, since `recomputeLedger` writes them on every edit.
