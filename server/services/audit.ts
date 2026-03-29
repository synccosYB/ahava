import { db } from "../db";
import { auditLogs } from "@shared/schema";
import type { InsertAuditLog } from "@shared/schema";

export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(entry: {
  actorUserId: string;
  targetType: string;
  targetId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  context?: unknown;
  ipAddress?: string;
  userAgent?: string;
}) {
  const [created] = await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    targetType: entry.targetType,
    targetId: entry.targetId,
    action: entry.action,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    context: entry.context ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  }).returning();
  return created;
}

export function getAuditContext(req: any): AuditContext {
  return {
    ipAddress: req.ip || req.headers?.["x-forwarded-for"] || undefined,
    userAgent: req.headers?.["user-agent"] || undefined,
  };
}
