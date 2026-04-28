import { db } from "../db";
import {
  biometricLegalProfiles,
  biometricLegalProfileScopes,
  users,
  type BiometricLegalProfile,
} from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Resolve which biometric_legal_profile applies to a user. Resolution order:
 *   1. A profile with a scope matching the user's locationId.
 *   2. A profile with a scope matching the user's companyId.
 *   3. The profile flagged isDefault.
 *   4. Any profile (first found) if none of the above match.
 *
 * The caller must additionally check `profile.isEnabled` AND the global feature flag
 * before allowing enrollment / face login.
 */
export async function resolveLegalProfileForUser(
  userId: string,
): Promise<BiometricLegalProfile | null> {
  const [user] = await db
    .select({
      companyId: users.companyId,
      locationId: users.locationId,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  if (user.locationId) {
    const [byLocation] = await db
      .select({ profile: biometricLegalProfiles })
      .from(biometricLegalProfileScopes)
      .innerJoin(
        biometricLegalProfiles,
        eq(biometricLegalProfiles.id, biometricLegalProfileScopes.profileId),
      )
      .where(eq(biometricLegalProfileScopes.locationId, user.locationId))
      .limit(1);
    if (byLocation?.profile) return byLocation.profile;
  }

  if (user.companyId) {
    const [byCompany] = await db
      .select({ profile: biometricLegalProfiles })
      .from(biometricLegalProfileScopes)
      .innerJoin(
        biometricLegalProfiles,
        eq(biometricLegalProfiles.id, biometricLegalProfileScopes.profileId),
      )
      .where(
        and(
          eq(biometricLegalProfileScopes.companyId, user.companyId),
          isNull(biometricLegalProfileScopes.locationId),
        ),
      )
      .limit(1);
    if (byCompany?.profile) return byCompany.profile;
  }

  const [defaultProfile] = await db
    .select()
    .from(biometricLegalProfiles)
    .where(eq(biometricLegalProfiles.isDefault, true))
    .limit(1);
  if (defaultProfile) return defaultProfile;

  const [fallback] = await db.select().from(biometricLegalProfiles).limit(1);
  return fallback ?? null;
}
