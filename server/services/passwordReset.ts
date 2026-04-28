import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { passwordResetTokens, type PasswordResetToken, type User } from "@shared/schema";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function generateResetToken(): { token: string; tokenHash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(raw);
  return { token: raw, tokenHash };
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createResetTokenForUser(
  userId: string,
  requestedIp: string | null,
): Promise<{ token: string; record: PasswordResetToken }> {
  const { token, tokenHash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const [record] = await db
    .insert(passwordResetTokens)
    .values({
      userId,
      tokenHash,
      expiresAt,
      requestedIp: requestedIp ?? null,
    })
    .returning();
  return { token, record };
}

export interface FindResetTokenResult {
  token: PasswordResetToken;
  status: "valid" | "expired" | "used";
}

export async function findResetTokenByRaw(raw: string): Promise<FindResetTokenResult | null> {
  if (!raw) return null;
  const tokenHash = hashResetToken(raw);
  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash));
  if (!record) return null;
  if (record.usedAt) return { token: record, status: "used" };
  if (record.expiresAt.getTime() < Date.now()) return { token: record, status: "expired" };
  return { token: record, status: "valid" };
}

/**
 * Atomically marks a token as used. Returns true if this call was the one
 * that consumed it; false if it was already consumed (or doesn't exist),
 * which closes the race window between two concurrent reset submissions
 * for the same token.
 */
export async function consumeResetToken(tokenId: string): Promise<boolean> {
  const result = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, tokenId), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  return result.length > 0;
}

export async function invalidateOtherTokensForUser(userId: string, exceptTokenId: string): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.usedAt),
        ne(passwordResetTokens.id, exceptTokenId),
      ),
    );
}

export async function userHasUsablePassword(user: User): Promise<boolean> {
  return Boolean(user.passwordHash || user.password);
}

export async function setUserPassword(userId: string, plainPassword: string): Promise<void> {
  const hash = await bcrypt.hash(plainPassword, 10);
  const { users } = await import("@shared/schema");
  await db
    .update(users)
    .set({
      password: hash,
      passwordHash: hash,
      forcePasswordChange: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function deleteExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const res = await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, cutoff));
  // drizzle returns no rowCount for delete by default in some versions
  return (res as any)?.rowCount ?? 0;
}

export function isUserEligibleForReset(user: User): boolean {
  if (!user) return false;
  if (user.deactivatedAt) return false;
  if (!user.email) return false;
  return true;
}

export const PASSWORD_MIN_LENGTH = 8;

export function validateNewPassword(pw: string): string | null {
  if (typeof pw !== "string") return "Password is required";
  if (pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (!/[A-Za-z]/.test(pw)) return "Password must contain a letter";
  if (!/\d/.test(pw)) return "Password must contain a number";
  return null;
}
