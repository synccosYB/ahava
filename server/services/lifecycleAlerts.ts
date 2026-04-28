import { storage } from "../storage";
import type { GeneratedAlert } from "./alerts";
import type { PerformanceReviewCycle, PerformanceReviewReminder } from "@shared/schema";

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseDateString(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if ([y, m, d].some(Number.isNaN)) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function diffDays(target: Date, base: Date): number {
  const ms = target.getTime() - base.getTime();
  return Math.round(ms / 86_400_000);
}

export async function detectPerformanceReviewsDue(): Promise<GeneratedAlert[]> {
  const alerts: GeneratedAlert[] = [];
  const cycles: PerformanceReviewCycle[] = await storage.getReviewCycles({ isActive: true });
  if (cycles.length === 0) return alerts;

  const today = todayUtcMidnight();
  const cycleById = new Map(cycles.map((c) => [c.id, c]));
  const reminders: PerformanceReviewReminder[] = await storage.listReviewReminders({
    status: "pending",
  });

  for (const reminder of reminders) {
    const cycle = cycleById.get(reminder.cycleId);
    if (!cycle) continue;
    const due = parseDateString(reminder.dueDate);
    if (!due) continue;
    const daysUntil = diffDays(due, today);
    const leadTimes = Array.isArray(cycle.leadTimes) ? cycle.leadTimes : [14, 7, 0];
    if (!leadTimes.includes(daysUntil)) continue;

    const severity = daysUntil === 0 ? "high" : "medium";
    const dueLabel =
      daysUntil === 0
        ? `due today`
        : daysUntil > 0
          ? `due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
          : `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue`;
    alerts.push({
      type: "review_due",
      severity,
      employeeId: reminder.employeeId,
      message: `Performance review (${cycle.name}) ${dueLabel}`,
      details: {
        reminderId: reminder.id,
        cycleId: cycle.id,
        cycleName: cycle.name,
        dueDate: reminder.dueDate,
        leadTime: daysUntil,
      },
    });
  }

  return alerts;
}
