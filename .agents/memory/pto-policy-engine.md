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
`server/__tests__/ptoPolicyConsolidation.test.ts` and `server/__tests__/ptoEngineParity.test.ts`
(both run via tsx; the latter pins all 4 read surfaces + accrual modes + a static guard that no
balance-math method reads the legacy table).

**Invariant 3 — `pto_policies` is DORMANT for numbers but kept alive by stale FKs.**
No balance/accrual number is read from `pto_policies` (all surfaces go through `computeTimeOffBalanceDetailed`
→ engine). The table survives ONLY as a defensive fallback (`getDefaultPtoPolicy`) + the legacy
`/api/pto-policies` CRUD endpoints. It is NOT dropped because two FKs point at it:
`employee_pto_settings.pto_policy_id` and `pto_anniversary_adjustments.pto_policy_id`.

**KNOWN BUG (latent, prod):** the anniversary job (`server/services/ptoAnniversary.ts`) writes the
engine's unified `policies.id` into `pto_anniversary_adjustments.pto_policy_id`, but that column FKs
to `pto_policies(id)` → every insert throws `..._pto_policy_id_fkey` violation, which the job's
per-employee try/catch swallows. So anniversary tier adjustments NEVER persist (no row, no
`time_off_balances` bump). NOTE separately: anniversary writes to `time_off_balances`, which
`computeTimeOffBalanceDetailed` does NOT read for vacation totals (it derives totals from the policy)
— so even if persistence were fixed, anniversary increments wouldn't surface in the main balance
surfaces without further work. Fixing = drop both FKs (hand-written migration, drift-safe since
schemaDrift only checks table/col presence) + remove `.references(() => ptoPolicies.id)` in
`shared/schema.ts`; this CHANGES PTO behavior so it was deferred out of the parity task (task #454).
