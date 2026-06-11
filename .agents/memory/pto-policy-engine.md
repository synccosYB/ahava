---
name: PTO accrual is unified-policy-engine driven
description: How PTO accrual resolves through the policy engine and the invariants that keep numbers identical
---

# PTO accrual runs through the unified policy engine

`storage.getEmployeePtoPolicy(userId)` resolves the effective `pto`-type policy via
`getEffectivePolicy(companyId, userId, "pto", user)`, then builds a synthetic `PtoPolicy`
with `buildPtoPolicyFromRules(...)` (exported from `server/policyEngine.ts`). All downstream
accrual/balance compute methods consume that synthetic policy, so they stay byte-identical to
the old legacy-table path. Legacy `pto_policies` is dormant (not dropped); `getDefaultPtoPolicy()`
is only a defensive fallback when the engine resolves nothing.

**Invariant 1 — rules JSON keys mirror legacy PtoPolicy column names.**
The canonical `pto` rules JSON is a superset of the legacy `pto_policies` columns using the SAME
field names (accrualType, vacationAccrualPerHoursWorked, sickAccrualPerHoursWorked, yearlyCapHours,
expirationDate, etc.). `buildPtoPolicyFromRules` does `{...DEFAULT_PTO_RULES, ...rules}` then maps
1:1 onto a PtoPolicy. If you rename a rule key you MUST update the builder, the migration's
column→JSON mapping, and the wizard field list together, or numbers silently change.

**Invariant 2 — a GLOBAL policy_assignment on the system-default PTO policy must always exist.**
Unassigned employees rely on the engine resolving the global assignment whose rules == legacy
company default (per_hours_worked, 1 per 30, cap 40). Both the migration
(`0051_consolidate_pto_into_policy_engine.sql`) AND `seed.ts` create/refresh it. Remove that and
unassigned employees fall through to the legacy default fallback — same numbers today, but a
divergence risk. `DEFAULT_PTO_RULES` itself is annual/120, NOT the company default, so the seed
must override the system-default policy's rules to the company default.

**Why:** the PTO consolidation folded two PTO surfaces (legacy `pto_policies`/`employee_pto_settings`
accrual math + the unified engine's assignment-only role) into one engine. Per-employee overrides +
hire date still live in `employee_pto_settings` (edited from the PTO page's Employee Settings tab).

**How to apply:** changing PTO accrual fields => edit DEFAULT_PTO_RULES + buildPtoPolicyFromRules
+ migration mapping + wizard `getRuleFieldsForType("pto")` in lockstep. Parity is guarded by
`server/__tests__/ptoPolicyConsolidation.test.ts` (run via tsx).
