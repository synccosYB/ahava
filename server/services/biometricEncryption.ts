import crypto from "crypto";

/**
 * Biometric template encryption (AES-256-GCM).
 *
 * - Key is read from BIOMETRIC_ENCRYPTION_KEY (base64-encoded 32 bytes) in production.
 * - In development, if the secret is missing, a random ephemeral key is generated and a
 *   prominent warning is logged. Templates encrypted with an ephemeral key are unreadable
 *   after process restart, which is the safe failure mode.
 * - The on-disk record stores the encrypted payload as base64(iv || authTag || ciphertext)
 *   and an integer encryptionKeyVersion. Rotation is performed by introducing a new
 *   version, re-encrypting templates in a background pass, and bumping the version marker.
 *
 * NEVER log or return the cleartext template, the descriptor vector, or the encryption key.
 * Decrypt events are emitted as audit logs without payload at the call site.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;
let usingEphemeralKey = false;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.BIOMETRIC_ENCRYPTION_KEY;
  if (fromEnv) {
    let buf: Buffer;
    try {
      buf = Buffer.from(fromEnv, "base64");
    } catch {
      throw new Error("BIOMETRIC_ENCRYPTION_KEY is not valid base64");
    }
    if (buf.length !== KEY_LEN) {
      throw new Error(
        `BIOMETRIC_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${buf.length})`,
      );
    }
    cachedKey = buf;
    return cachedKey;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BIOMETRIC_ENCRYPTION_KEY is required in production for biometric template encryption.",
    );
  }
  cachedKey = crypto.randomBytes(KEY_LEN);
  usingEphemeralKey = true;
  console.warn(
    "[biometric] WARNING: BIOMETRIC_ENCRYPTION_KEY not set — using an ephemeral key for development. " +
      "All enrollments will be unrecoverable after process restart. Set the secret to persist templates.",
  );
  return cachedKey;
}

export function getCurrentKeyVersion(): number {
  // Phase 1 ships with a single version; rotation introduces version 2 + re-encrypt pass.
  const fromEnv = process.env.BIOMETRIC_ENCRYPTION_KEY_VERSION;
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

export function isUsingEphemeralKey(): boolean {
  return usingEphemeralKey;
}

/**
 * Encrypt a JSON-serialisable template payload (typically a Float32Array converted to a
 * regular number[] or an array of arrays for multi-sample). Returns base64(iv||tag||ct).
 */
export function encryptTemplate(payload: unknown): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const cleartext = Buffer.from(JSON.stringify(payload), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(cleartext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt and JSON-parse a previously encrypted template. Throws on tamper / wrong key.
 * Caller is responsible for emitting an audit log entry — the helper does not log payloads.
 */
export function decryptTemplate<T = unknown>(encoded: string): T {
  const key = loadKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Encrypted template is malformed");
  }
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const cleartext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(cleartext.toString("utf-8")) as T;
}

/**
 * Generate a new key in the format expected by BIOMETRIC_ENCRYPTION_KEY. Used by ops
 * runbook (`scripts/generate-biometric-key.ts`) when rotating keys.
 */
export function generateKeyBase64(): string {
  return crypto.randomBytes(KEY_LEN).toString("base64");
}
