export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export interface DayOfWeekBonusForOverlap {
  id: string;
  dayOfWeek: number;
}

export interface EarlyArrivalBonusForOverlap {
  id: string;
  daysOfWeek?: number[] | null;
}

export interface OverlapInfo {
  conflictingIds: string[];
  conflictingDays: number[];
}

export function expandDaysOfWeek(days?: number[] | null): number[] {
  const filtered = Array.isArray(days)
    ? days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  if (filtered.length === 0) return [...ALL_DAYS];
  return Array.from(new Set(filtered)).sort((a, b) => a - b);
}

export function describeDays(days: number[]): string {
  if (!Array.isArray(days) || days.length === 0) return "no days";
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "every day";
  return sorted.map((d) => DAY_NAMES[d] ?? String(d)).join(", ");
}

function recordOverlap(
  result: Map<string, OverlapInfo>,
  id: string,
  otherId: string,
  days: number[],
) {
  const existing = result.get(id);
  if (existing) {
    if (!existing.conflictingIds.includes(otherId)) existing.conflictingIds.push(otherId);
    for (const d of days) {
      if (!existing.conflictingDays.includes(d)) existing.conflictingDays.push(d);
    }
  } else {
    result.set(id, { conflictingIds: [otherId], conflictingDays: [...days] });
  }
}

export function findDayOfWeekBonusOverlaps<T extends DayOfWeekBonusForOverlap>(
  rules: T[],
): Map<string, OverlapInfo> {
  const result = new Map<string, OverlapInfo>();
  if (!Array.isArray(rules)) return result;
  const valid = rules.filter(
    (r) =>
      r && typeof r.id === "string" &&
      Number.isInteger(r.dayOfWeek) && r.dayOfWeek >= 0 && r.dayOfWeek <= 6,
  );
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      recordOverlap(result, a.id, b.id, [a.dayOfWeek]);
      recordOverlap(result, b.id, a.id, [a.dayOfWeek]);
    }
  }
  for (const info of result.values()) {
    info.conflictingDays.sort((x, y) => x - y);
  }
  return result;
}

export function findEarlyArrivalBonusOverlaps<T extends EarlyArrivalBonusForOverlap>(
  rules: T[],
): Map<string, OverlapInfo> {
  const result = new Map<string, OverlapInfo>();
  if (!Array.isArray(rules)) return result;
  const expanded = rules
    .filter((r) => r && typeof r.id === "string")
    .map((r) => ({ rule: r, days: new Set(expandDaysOfWeek(r.daysOfWeek)) }));
  for (let i = 0; i < expanded.length; i++) {
    for (let j = i + 1; j < expanded.length; j++) {
      const a = expanded[i];
      const b = expanded[j];
      const shared: number[] = [];
      a.days.forEach((d) => {
        if (b.days.has(d)) shared.push(d);
      });
      if (shared.length === 0) continue;
      recordOverlap(result, a.rule.id, b.rule.id, shared);
      recordOverlap(result, b.rule.id, a.rule.id, shared);
    }
  }
  for (const info of result.values()) {
    info.conflictingDays.sort((x, y) => x - y);
  }
  return result;
}

export function daySetsIntersect(a: number[] | null | undefined, b: number[] | null | undefined): number[] {
  const aDays = new Set(expandDaysOfWeek(a));
  const bDays = expandDaysOfWeek(b);
  const shared: number[] = [];
  for (const d of bDays) if (aDays.has(d)) shared.push(d);
  return shared.sort((x, y) => x - y);
}
