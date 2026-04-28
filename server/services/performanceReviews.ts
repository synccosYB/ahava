import { db } from "../db";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import {
  users,
  userEmploymentProfiles,
  type User,
  type PerformanceReviewCycle,
} from "@shared/schema";
import { detectPerformanceReviewsDue } from "./lifecycleAlerts";
import type { PolicyAlert } from "./policyEnforcement";

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if ([y, m, d].some(Number.isNaN)) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dueDateFor(cycle: PerformanceReviewCycle, hireDate: Date | null, today: Date): Date | null {
  switch (cycle.cadence) {
    case "annual": {
      if (cycle.anchor === "hire_date") {
        if (!hireDate) return null;
        let candidate = new Date(Date.UTC(today.getUTCFullYear(), hireDate.getUTCMonth(), hireDate.getUTCDate()));
        if (candidate < today) candidate = new Date(Date.UTC(today.getUTCFullYear() + 1, hireDate.getUTCMonth(), hireDate.getUTCDate()));
        return candidate;
      }
      let dec31 = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
      if (dec31 < today) dec31 = new Date(Date.UTC(today.getUTCFullYear() + 1, 11, 31));
      return dec31;
    }
    case "semi_annual": {
      if (cycle.anchor === "hire_date") {
        if (!hireDate) return null;
        const candidates: Date[] = [];
        for (let yearOffset = 0; yearOffset <= 1; yearOffset += 1) {
          candidates.push(new Date(Date.UTC(today.getUTCFullYear() + yearOffset, hireDate.getUTCMonth(), hireDate.getUTCDate())));
          candidates.push(addMonths(new Date(Date.UTC(today.getUTCFullYear() + yearOffset, hireDate.getUTCMonth(), hireDate.getUTCDate())), 6));
        }
        const future = candidates.filter((d) => d >= today).sort((a, b) => a.getTime() - b.getTime());
        return future[0] ?? null;
      }
      const candidates: Date[] = [
        new Date(Date.UTC(today.getUTCFullYear(), 5, 30)),
        new Date(Date.UTC(today.getUTCFullYear(), 11, 31)),
        new Date(Date.UTC(today.getUTCFullYear() + 1, 5, 30)),
      ];
      const future = candidates.filter((d) => d >= today);
      return future[0] ?? null;
    }
    case "quarterly": {
      if (cycle.anchor === "hire_date") {
        if (!hireDate) return null;
        const candidates: Date[] = [];
        for (let yearOffset = 0; yearOffset <= 1; yearOffset += 1) {
          for (const months of [3, 6, 9, 12]) {
            const base = new Date(Date.UTC(today.getUTCFullYear() + yearOffset, hireDate.getUTCMonth(), hireDate.getUTCDate()));
            candidates.push(addMonths(base, months));
          }
        }
        const future = candidates.filter((d) => d >= today).sort((a, b) => a.getTime() - b.getTime());
        return future[0] ?? null;
      }
      const candidates: Date[] = [
        new Date(Date.UTC(today.getUTCFullYear(), 2, 31)),
        new Date(Date.UTC(today.getUTCFullYear(), 5, 30)),
        new Date(Date.UTC(today.getUTCFullYear(), 8, 30)),
        new Date(Date.UTC(today.getUTCFullYear(), 11, 31)),
        new Date(Date.UTC(today.getUTCFullYear() + 1, 2, 31)),
      ];
      const future = candidates.filter((d) => d >= today);
      return future[0] ?? null;
    }
    case "new_hire_90": {
      if (!hireDate) return null;
      return addDays(hireDate, 90);
    }
    default:
      return null;
  }
}

export async function evaluatePerformanceReviews(): Promise<PolicyAlert[]> {
  const today = todayUtc();
  const cycles = await storage.getReviewCycles({ isActive: true });
  if (cycles.length === 0) return [];

  const todayIso = toIso(today);
  const employeeRows = await db
    .select({
      user: users,
      terminationDate: userEmploymentProfiles.terminationDate,
    })
    .from(users)
    .leftJoin(
      userEmploymentProfiles,
      eq(userEmploymentProfiles.userId, users.id),
    );
  const employees: User[] = employeeRows
    .filter((row) => {
      if (!row.terminationDate) return true;
      return row.terminationDate > todayIso;
    })
    .map((row) => row.user);

  for (const cycle of cycles) {
    const scoped = cycle.companyId
      ? employees.filter((e) => e.companyId === cycle.companyId)
      : employees;
    for (const employee of scoped) {
      try {
        const ptoSettings = await storage.getEmployeePtoSettings(employee.id);
        const profile = await storage.getEmploymentProfile(employee.id);
        const hireRaw: string | null =
          ptoSettings?.hireDate ?? profile?.hireDate ?? null;
        const hireDate = parseDate(hireRaw);
        const dueDate = dueDateFor(cycle, hireDate, today);
        if (!dueDate) continue;
        if (cycle.cadence === "new_hire_90") {
          if (!hireDate) continue;
          const ageDays = Math.round((today.getTime() - hireDate.getTime()) / 86_400_000);
          if (ageDays > 365 + 90) continue;
          const existing = await storage.listReviewReminders({ employeeId: employee.id, cycleId: cycle.id });
          if (existing.length > 0) continue;
        }
        await storage.upsertReviewReminder({
          employeeId: employee.id,
          cycleId: cycle.id,
          dueDate: toIso(dueDate),
          status: "pending",
          notes: null,
        });
      } catch (err: unknown) {
        console.error(
          `evaluate-performance-reviews: employee=${employee.id} cycle=${cycle.id}`,
          err,
        );
      }
    }
  }

  const generated = await detectPerformanceReviewsDue();
  return generated.map((g): PolicyAlert => ({
    type: g.type,
    severity: g.severity,
    employeeId: g.employeeId,
    message: g.message,
    details: g.details,
  }));
}
