import { db } from "../db";
import {
  biometricTemplates,
  biometricConsents,
  biometricLegalProfiles,
  userEmploymentProfiles,
} from "@shared/schema";
import { and, eq, isNull, lt, or, sql, isNotNull } from "drizzle-orm";
import { writeAuditLog } from "./audit";
import { resolveLegalProfileForUser } from "./biometricLegalProfile";

/**
 * Retention enforcement for biometric templates.
 *
 * Drops a template (and marks consent as revoked) when ANY of these are true and the
 * user is NOT under legal hold:
 *  - The user is terminated (employment profile `terminationDate` set).
 *  - The user has explicitly revoked consent (`biometric_consents.revoked_at` set and
 *    no later active consent exists).
 *  - The template has not been matched within the configured retention window (taken
 *    from the user's assigned legal profile, fallback to default).
 */

export interface RetentionRunResult {
  scanned: number;
  deleted: number;
  reasons: Record<string, number>;
}

async function isUserOnLegalHold(userId: string): Promise<boolean> {
  const rows = await db
    .select({ legalHold: biometricConsents.legalHold })
    .from(biometricConsents)
    .where(eq(biometricConsents.userId, userId));
  return rows.some((r) => r.legalHold);
}

async function deleteUserBiometrics(
  userId: string,
  reason: "consent_revoked" | "termination" | "inactivity" | "manual_revoke",
  actor: string,
): Promise<boolean> {
  const tpls = await db
    .select()
    .from(biometricTemplates)
    .where(eq(biometricTemplates.userId, userId));
  if (tpls.length === 0) return false;
  await db.delete(biometricTemplates).where(eq(biometricTemplates.userId, userId));
  for (const tpl of tpls) {
    await writeAuditLog({
      actorUserId: actor,
      targetType: "biometric_template",
      targetId: tpl.id,
      action: "biometric_template.deleted",
      newValue: { reason, type: tpl.type, userId: tpl.userId },
    });
  }
  return true;
}

export async function runBiometricRetention(): Promise<RetentionRunResult> {
  const result: RetentionRunResult = { scanned: 0, deleted: 0, reasons: {} };
  const tick = (k: string) => {
    result.reasons[k] = (result.reasons[k] || 0) + 1;
  };

  // 1) Templates whose owner is terminated.
  const inactiveTpls = await db
    .select({
      userId: biometricTemplates.userId,
    })
    .from(biometricTemplates)
    .innerJoin(userEmploymentProfiles, eq(userEmploymentProfiles.userId, biometricTemplates.userId))
    .where(isNotNull(userEmploymentProfiles.terminationDate));

  for (const row of inactiveTpls) {
    result.scanned += 1;
    if (await isUserOnLegalHold(row.userId)) continue;
    if (await deleteUserBiometrics(row.userId, "termination", "system")) {
      result.deleted += 1;
      tick("termination");
    }
  }

  // 2) Templates whose latest consent is revoked.
  const allTpls = await db
    .select({
      userId: biometricTemplates.userId,
      lastMatchedAt: biometricTemplates.lastMatchedAt,
      createdAt: biometricTemplates.createdAt,
    })
    .from(biometricTemplates);

  for (const row of allTpls) {
    result.scanned += 1;
    if (await isUserOnLegalHold(row.userId)) continue;

    const consents = await db
      .select()
      .from(biometricConsents)
      .where(eq(biometricConsents.userId, row.userId));
    const sortedByAccepted = [...consents].sort(
      (a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0),
    );
    const latest = sortedByAccepted[0];
    if (!latest || latest.revokedAt) {
      if (await deleteUserBiometrics(row.userId, "consent_revoked", "system")) {
        result.deleted += 1;
        tick("consent_revoked");
      }
      continue;
    }

    // 3) Inactivity beyond legal-profile retention window.
    const profile = await resolveLegalProfileForUser(row.userId);
    const retentionDays = profile?.retentionDays ?? 180;
    const referenceTime =
      row.lastMatchedAt?.getTime() ?? row.createdAt?.getTime() ?? Date.now();
    const ageMs = Date.now() - referenceTime;
    const limitMs = retentionDays * 24 * 60 * 60 * 1000;
    if (ageMs > limitMs) {
      if (await deleteUserBiometrics(row.userId, "inactivity", "system")) {
        result.deleted += 1;
        tick("inactivity");
      }
    }
  }

  return result;
}

export async function manualRevoke(
  userId: string,
  actorUserId: string,
  reason: string,
): Promise<{ deleted: boolean }> {
  // Mark all active consents as revoked first (so re-enrollment is required).
  await db
    .update(biometricConsents)
    .set({ revokedAt: new Date(), revokedBy: actorUserId, revokedReason: reason })
    .where(and(eq(biometricConsents.userId, userId), isNull(biometricConsents.revokedAt)));
  const deleted = await deleteUserBiometrics(userId, "manual_revoke", actorUserId);
  return { deleted };
}
