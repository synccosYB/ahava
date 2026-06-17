import { db } from "../db";
import { attendanceChangeLedger } from "@shared/schema";

/**
 * Immutable attendance & payroll ledger writer.
 *
 * Mirrors `writeAuditLog`: accepts an optional transaction handle so a ledger
 * entry can be written atomically with the mutation it describes (so we never
 * end up with a punch/PTO/payroll change that has no ledger record, or a ledger
 * record for a change that rolled back).
 *
 * The ledger is append-only by design — this module intentionally exposes ONLY
 * an insert. There is no update or delete path.
 */

export type LedgerCategory = "attendance" | "hours" | "pto" | "payroll";

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export interface LedgerContext {
  ipAddress?: string;
  userAgent?: string;
}

export async function writeLedgerEntry(entry: {
  category: LedgerCategory;
  eventType: string;
  employeeId: string;
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  workDate?: string | null;
  hoursDelta?: number | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  context?: unknown;
  source?: string | null;
  ipAddress?: string;
  userAgent?: string;
}, txDb?: DbOrTx) {
  const targetDb = txDb || db;
  const [created] = await targetDb.insert(attendanceChangeLedger).values({
    category: entry.category,
    eventType: entry.eventType,
    employeeId: entry.employeeId,
    actorUserId: entry.actorUserId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    workDate: entry.workDate ?? null,
    hoursDelta: entry.hoursDelta ?? null,
    beforeValue: entry.beforeValue ?? null,
    afterValue: entry.afterValue ?? null,
    context: entry.context ?? null,
    source: entry.source ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  }).returning();
  return created;
}

export function getLedgerContext(req: any): LedgerContext {
  return {
    ipAddress: req.ip || req.headers?.["x-forwarded-for"] || undefined,
    userAgent: req.headers?.["user-agent"] || undefined,
  };
}

/**
 * Convenience helper for the common "a punch's hours changed" case: returns the
 * signed delta between the new and old hours-worked values, rounded to 2dp, or
 * null when neither side carries a numeric value.
 */
export function hoursDelta(
  before: number | null | undefined,
  after: number | null | undefined,
): number | null {
  const b = typeof before === "number" ? before : null;
  const a = typeof after === "number" ? after : null;
  if (b === null && a === null) return null;
  return Math.round(((a ?? 0) - (b ?? 0)) * 100) / 100;
}
