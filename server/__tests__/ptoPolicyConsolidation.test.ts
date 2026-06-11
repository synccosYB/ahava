/**
 * Regression tests for the PTO consolidation (task #397).
 *
 * The unified policy engine now owns PTO accrual: a `pto`-type policy's rules
 * JSON is turned into a synthetic PtoPolicy via `buildPtoPolicyFromRules`, and
 * every downstream accrual/balance computation reads that synthetic policy. This
 * suite proves the synthetic policy is byte-identical to the legacy `pto_policies`
 * row it was migrated from, so existing employees keep IDENTICAL numbers.
 *
 * It mirrors:
 *   1. the migration's column → rules-JSON mapping
 *      (`migrations/0051_consolidate_pto_into_policy_engine.sql`), and
 *   2. the accrual math in `storage.computeTimeOffBalanceDetailed`,
 * then asserts legacy-vs-migrated parity for representative policies.
 *
 * Run with: `tsx server/__tests__/ptoPolicyConsolidation.test.ts`
 */
import assert from "node:assert/strict";
import { buildPtoPolicyFromRules } from "../policyEngine";
import type { PtoPolicy } from "@shared/schema";

// --- Helpers --------------------------------------------------------------

/**
 * Replicates exactly how migration 0051 maps a legacy `pto_policies` row into
 * the rules JSON stored on a unified policy. Kept in lockstep with the SQL.
 */
function legacyToRulesJson(p: PtoPolicy): Record<string, any> {
  return {
    accrualType: p.accrualType,
    accrualHoursPerYear: p.accrualHoursPerYear,
    yearlyCapHours: p.yearlyCapHours,
    carryoverCapHours: p.carryoverCapHours,
    waitingPeriodDays: p.waitingPeriodDays,
    sickAccrualEnabled: p.sickAccrualEnabled,
    sickAccrualRatePerHours: p.sickAccrualRatePerHours,
    sickAccrualPerHoursWorked: p.sickAccrualPerHoursWorked,
    sickYearlyCapHours: p.sickYearlyCapHours,
    vacationAccrualPerHoursWorked: p.vacationAccrualPerHoursWorked,
    vacationAccrualHoursPerThreshold: p.vacationAccrualHoursPerThreshold,
    personalHoursPerYear: p.personalHoursPerYear,
    holidayPayEnabled: p.holidayPayEnabled,
    holidayPtoDeduction: p.holidayPtoDeduction,
    holidayOtExclusion: p.holidayOtExclusion,
    expirationDate: p.expirationDate,
    requireApproval: true,
    maxConsecutiveHours: 80,
    blackoutDates: [],
  };
}

/** The accrual fields that drive every PTO number. Parity here == same numbers. */
const ACCRUAL_FIELDS: (keyof PtoPolicy)[] = [
  "accrualType",
  "accrualHoursPerYear",
  "yearlyCapHours",
  "carryoverCapHours",
  "waitingPeriodDays",
  "sickAccrualEnabled",
  "sickAccrualRatePerHours",
  "sickAccrualPerHoursWorked",
  "sickYearlyCapHours",
  "vacationAccrualPerHoursWorked",
  "vacationAccrualHoursPerThreshold",
  "personalHoursPerYear",
  "holidayPayEnabled",
  "holidayPtoDeduction",
  "holidayOtExclusion",
  "expirationDate",
];

/** Mirrors the per_hours_worked vacation math in computeTimeOffBalanceDetailed. */
function computeAnnualVacation(p: PtoPolicy, hoursWorked: number): number {
  if (p.accrualType === "per_hours_worked") {
    const threshold = p.vacationAccrualPerHoursWorked > 0 ? p.vacationAccrualPerHoursWorked : 30;
    const earnedPerThreshold = p.vacationAccrualHoursPerThreshold ?? 1;
    const accrued = Math.floor(hoursWorked / threshold) * earnedPerThreshold;
    return p.yearlyCapHours != null ? Math.min(accrued, p.yearlyCapHours) : accrued;
  }
  return p.accrualHoursPerYear;
}

/** Mirrors the sick accrual math in computeTimeOffBalanceDetailed. */
function computeAnnualSick(p: PtoPolicy, hoursWorked: number): number {
  if (!p.sickAccrualEnabled) return 0;
  const accrued = Math.floor(hoursWorked / p.sickAccrualPerHoursWorked) * p.sickAccrualRatePerHours;
  return Math.min(accrued, p.sickYearlyCapHours);
}

// --- Representative legacy policies ---------------------------------------

const base = {
  id: "legacy-id",
  name: "Legacy",
  description: "desc",
  companyId: null,
  isDefault: false,
  isActive: true,
  createdAt: null,
  updatedAt: null,
} as unknown as PtoPolicy;

const legacyCompanyDefault: PtoPolicy = {
  ...base,
  name: "Standard PTO (1 per 30, 40 cap)",
  accrualType: "per_hours_worked",
  accrualHoursPerYear: 40,
  yearlyCapHours: 40,
  carryoverCapHours: 0,
  waitingPeriodDays: 0,
  sickAccrualEnabled: true,
  sickAccrualRatePerHours: 1,
  sickAccrualPerHoursWorked: 30,
  sickYearlyCapHours: 40,
  vacationAccrualPerHoursWorked: 30,
  vacationAccrualHoursPerThreshold: 1,
  personalHoursPerYear: 40,
  holidayPayEnabled: true,
  holidayPtoDeduction: false,
  holidayOtExclusion: true,
  expirationDate: null,
} as PtoPolicy;

const legacyAnnualGenerous: PtoPolicy = {
  ...base,
  name: "Annual 160 w/ carryover",
  accrualType: "annual",
  accrualHoursPerYear: 160,
  yearlyCapHours: null,
  carryoverCapHours: 40,
  waitingPeriodDays: 90,
  sickAccrualEnabled: false,
  sickAccrualRatePerHours: 1,
  sickAccrualPerHoursWorked: 40,
  sickYearlyCapHours: 24,
  vacationAccrualPerHoursWorked: 30,
  vacationAccrualHoursPerThreshold: 1,
  personalHoursPerYear: 16,
  holidayPayEnabled: true,
  holidayPtoDeduction: true,
  holidayOtExclusion: false,
  expirationDate: "2026-12-31",
} as PtoPolicy;

const legacyPerHoursCapped: PtoPolicy = {
  ...base,
  name: "2 per 40, 80 cap",
  accrualType: "per_hours_worked",
  accrualHoursPerYear: 80,
  yearlyCapHours: 80,
  carryoverCapHours: 0,
  waitingPeriodDays: 30,
  sickAccrualEnabled: true,
  sickAccrualRatePerHours: 2,
  sickAccrualPerHoursWorked: 40,
  sickYearlyCapHours: 48,
  vacationAccrualPerHoursWorked: 40,
  vacationAccrualHoursPerThreshold: 2,
  personalHoursPerYear: 24,
  holidayPayEnabled: false,
  holidayPtoDeduction: false,
  holidayOtExclusion: true,
  expirationDate: null,
} as PtoPolicy;

const fixtures = [legacyCompanyDefault, legacyAnnualGenerous, legacyPerHoursCapped];

// --- 1. Field-level parity ------------------------------------------------

for (const legacy of fixtures) {
  const rules = legacyToRulesJson(legacy);
  const migrated = buildPtoPolicyFromRules("unified-id", legacy.name, rules);
  for (const field of ACCRUAL_FIELDS) {
    assert.deepEqual(
      migrated[field],
      legacy[field],
      `[${legacy.name}] field "${String(field)}" must match legacy: got ${JSON.stringify(migrated[field])}, expected ${JSON.stringify(legacy[field])}`,
    );
  }
}
console.log(`✓ field-level parity across ${fixtures.length} representative policies`);

// --- 2. Computed-balance parity over a range of worked hours --------------

const workedHoursSamples = [0, 29, 30, 31, 60, 119, 120, 599, 600, 1200, 2080, 3000];

for (const legacy of fixtures) {
  const migrated = buildPtoPolicyFromRules("unified-id", legacy.name, legacyToRulesJson(legacy));
  for (const hw of workedHoursSamples) {
    assert.equal(
      computeAnnualVacation(migrated, hw),
      computeAnnualVacation(legacy, hw),
      `[${legacy.name}] annual vacation must match legacy at ${hw}h worked`,
    );
    assert.equal(
      computeAnnualSick(migrated, hw),
      computeAnnualSick(legacy, hw),
      `[${legacy.name}] annual sick must match legacy at ${hw}h worked`,
    );
    assert.equal(
      migrated.personalHoursPerYear,
      legacy.personalHoursPerYear,
      `[${legacy.name}] personal hours must match legacy`,
    );
  }
}
console.log(`✓ computed-balance parity across ${workedHoursSamples.length} worked-hour samples`);

// --- 3. The company default's cap behaves exactly as before ---------------

// 1 hour per 30 worked, capped at 40: at 1200h => floor(1200/30)*1 = 40 (cap),
// at 600h => 20, at 29h => 0. These are the historical numbers.
assert.equal(computeAnnualVacation(legacyCompanyDefault, 1200), 40, "default caps at 40");
assert.equal(computeAnnualVacation(legacyCompanyDefault, 600), 20, "default = 20 at 600h");
assert.equal(computeAnnualVacation(legacyCompanyDefault, 29), 0, "default = 0 below threshold");
const defMigrated = buildPtoPolicyFromRules("sd", "Default PTO Policy", legacyToRulesJson(legacyCompanyDefault));
assert.equal(computeAnnualVacation(defMigrated, 1200), 40, "migrated default caps at 40");
assert.equal(computeAnnualVacation(defMigrated, 600), 20, "migrated default = 20 at 600h");
console.log("✓ company-default cap parity");

// --- 4. Missing keys fall back to DEFAULT_PTO_RULES, never undefined ------

const sparse = buildPtoPolicyFromRules("p", "sparse", { accrualType: "annual", accrualHoursPerYear: 100 });
for (const field of ACCRUAL_FIELDS) {
  assert.notEqual(sparse[field], undefined, `sparse rules must default field "${String(field)}", not leave it undefined`);
}
assert.equal(sparse.accrualHoursPerYear, 100, "explicit rule value wins over default");
console.log("✓ sparse rules fall back to defaults");

console.log("\nAll PTO consolidation parity tests passed.");
