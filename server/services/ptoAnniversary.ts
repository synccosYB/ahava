import { db } from "../db";
import { storage } from "../storage";
import { users, type User } from "@shared/schema";
import { getEffectivePolicy } from "../policyEngine";
import { writeAuditLog } from "./audit";

interface AnniversaryTier {
  yearsOfService: number;
  accrualRate: number;
  tierLabel?: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  iso: string;
}

function todayParts(): DateParts {
  const now = new Date();
  return makeParts(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

function makeParts(year: number, month: number, day: number): DateParts {
  const iso = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return { year, month, day, iso };
}

function parseDate(value: string | null | undefined): DateParts | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if ([y, m, d].some(Number.isNaN)) return null;
  return makeParts(y, m, d);
}

function effectiveTierFor(
  tiers: AnniversaryTier[],
  yearsOfService: number,
): AnniversaryTier | null {
  if (yearsOfService < 0) return null;
  const sorted = [...tiers].sort((a, b) => a.yearsOfService - b.yearsOfService);
  let chosen: AnniversaryTier | null = null;
  for (const tier of sorted) {
    if (tier.yearsOfService <= yearsOfService) {
      chosen = tier;
    } else {
      break;
    }
  }
  return chosen;
}

export async function applyPtoAnniversaryAdjustments(): Promise<{
  processed: number;
  adjusted: number;
  errors: string[];
}> {
  const today = todayParts();
  const errors: string[] = [];
  let processed = 0;
  let adjusted = 0;

  const allEmployees: User[] = await db.select().from(users);

  for (const employee of allEmployees) {
    processed += 1;
    try {
      const effective = await getEffectivePolicy(
        employee.companyId,
        employee.id,
        "pto",
        employee,
      );
      const rawTiers = effective?.rules?.anniversaryTiers;
      const tiers = Array.isArray(rawTiers) ? (rawTiers as AnniversaryTier[]) : null;
      if (!tiers || tiers.length === 0) continue;

      const ptoSettings = await storage.getEmployeePtoSettings(employee.id);
      const employmentProfile = await storage.getEmploymentProfile(employee.id);
      const hireDateRaw: string | null =
        ptoSettings?.hireDate ?? employmentProfile?.hireDate ?? null;
      const hire = parseDate(hireDateRaw);
      if (!hire) continue;

      if (hire.month !== today.month || hire.day !== today.day) continue;
      const yearsOfService = today.year - hire.year;
      if (yearsOfService <= 0) continue;

      const currentTier = effectiveTierFor(tiers, yearsOfService);
      const previousTier = effectiveTierFor(tiers, yearsOfService - 1);
      if (!currentTier) continue;

      // Skip when the effective tier didn't actually change at this anniversary.
      if (previousTier && previousTier.accrualRate === currentTier.accrualRate) {
        continue;
      }

      const oldRate = previousTier?.accrualRate ?? null;
      const hoursAdded = currentTier.accrualRate - (oldRate ?? 0);
      if (hoursAdded === 0) continue;

      const inserted = await storage.recordPtoAnniversaryAdjustment({
        employeeId: employee.id,
        effectiveDate: today.iso,
        oldAccrualRate: oldRate,
        newAccrualRate: currentTier.accrualRate,
        oldTierLabel: previousTier?.tierLabel ?? null,
        newTierLabel: currentTier.tierLabel ?? null,
        yearsOfService,
        hoursAdded,
        ptoPolicyId: effective?.policyId ?? null,
      });
      if (!inserted) continue;

      const balance = await storage.getTimeOffBalance(
        employee.id,
        "vacation",
        today.year,
      );
      let oldTotal: number | null = null;
      let newTotal: number | null = null;
      if (balance) {
        oldTotal = balance.totalDays ?? 0;
        newTotal = oldTotal + hoursAdded;
        await storage.updateTimeOffBalance(balance.id, {
          totalDays: newTotal,
        });
      } else if (hoursAdded !== 0) {
        oldTotal = 0;
        newTotal = hoursAdded;
        await storage.createTimeOffBalance({
          userId: employee.id,
          type: "vacation",
          year: today.year,
          totalDays: hoursAdded,
          usedDays: 0,
        });
      }

      await writeAuditLog({
        actorUserId: "system",
        targetType: "pto_balance",
        targetId: inserted.id,
        action: "pto.anniversary_adjustment",
        oldValue: {
          accrualHoursPerYear: oldRate,
          tierLabel: previousTier?.tierLabel ?? null,
          totalHours: oldTotal,
        },
        newValue: {
          accrualHoursPerYear: currentTier.accrualRate,
          tierLabel: currentTier.tierLabel ?? null,
          totalHours: newTotal,
          hoursAdded,
          yearsOfService,
        },
        context: { employeeId: employee.id, effectiveDate: today.iso },
      });
      adjusted += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${employee.id}: ${message}`);
    }
  }

  if (errors.length > 0) {
    console.error(
      `apply-pto-anniversary-adjustments: ${errors.length} errors`,
      errors,
    );
  }
  return { processed, adjusted, errors };
}
