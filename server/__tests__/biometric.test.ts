/**
 * Minimal self-contained sanity tests for biometric encryption + matching.
 *
 * Run with: `tsx server/__tests__/biometric.test.ts`
 *
 * No external test runner dependency — the script asserts inline and exits non-zero on
 * the first failure so it can be wired into CI (or run manually by an engineer) without
 * adding a new dev-dep to package.json.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Use a deterministic key for the duration of this script so encryption tests don't
// depend on the developer's environment.
process.env.BIOMETRIC_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const {
  encryptTemplate,
  decryptTemplate,
  getCurrentKeyVersion,
  generateKeyBase64,
  isUsingEphemeralKey,
} = await import("../services/biometricEncryption.js");

const {
  euclideanDistance,
  distanceToConfidence,
  identify,
} = await import("../services/biometricMatcher.js");

const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// --- Encryption ---
test("encrypt/decrypt round-trip preserves payload", () => {
  const payload = [Array.from({ length: 128 }, (_, i) => Math.sin(i))];
  const encoded = encryptTemplate(payload);
  assert.equal(typeof encoded, "string");
  assert.notEqual(encoded.length, 0);
  const decoded = decryptTemplate<number[][]>(encoded);
  assert.equal(decoded.length, payload.length);
  assert.deepEqual(decoded[0], payload[0]);
});

test("encrypted output is randomised (IV is fresh per call)", () => {
  const payload = { a: 1, b: 2 };
  const a = encryptTemplate(payload);
  const b = encryptTemplate(payload);
  assert.notEqual(a, b);
});

test("decrypt fails on tampered ciphertext", () => {
  const encoded = encryptTemplate({ secret: "vector" });
  const buf = Buffer.from(encoded, "base64");
  // Flip a bit in the ciphertext segment (after iv+tag = 12+16 = 28 bytes).
  buf[28] = buf[28] ^ 0x01;
  const tampered = buf.toString("base64");
  assert.throws(() => decryptTemplate(tampered));
});

test("getCurrentKeyVersion returns positive integer", () => {
  const v = getCurrentKeyVersion();
  assert.ok(Number.isFinite(v) && v >= 1);
});

test("generateKeyBase64 returns a 32-byte base64 string", () => {
  const k = generateKeyBase64();
  const buf = Buffer.from(k, "base64");
  assert.equal(buf.length, 32);
});

test("isUsingEphemeralKey is false when env var is set", () => {
  assert.equal(isUsingEphemeralKey(), false);
});

// --- Matcher ---
test("euclideanDistance is zero for identical vectors", () => {
  const v = [1, 2, 3];
  assert.equal(euclideanDistance(v, v), 0);
});

test("euclideanDistance computes correctly", () => {
  assert.equal(euclideanDistance([0, 0], [3, 4]), 5);
});

test("distanceToConfidence is bounded in [0, 1]", () => {
  assert.equal(distanceToConfidence(0), 1);
  assert.equal(distanceToConfidence(1.0), 0);
  assert.equal(distanceToConfidence(2.0), 0);
  assert.equal(distanceToConfidence(-0.5), 1);
});

const settings = {
  thresholdAutoApprove: 0.6,
  thresholdReview: 0.4,
  thresholdReject: 0.2,
} as any;

test("identify returns not_enrolled when no candidates", () => {
  const r = identify([1, 0, 0], [], settings);
  assert.equal(r.outcome, "not_enrolled");
  assert.equal(r.userId, null);
});

test("identify auto-approves an exact match", () => {
  const v = Array.from({ length: 128 }, (_, i) => Math.cos(i / 7));
  const r = identify(v, [{ userId: "u1", descriptors: [v] }], settings);
  assert.equal(r.outcome, "auto_approved");
  assert.equal(r.userId, "u1");
  assert.ok(r.confidence > 0.95);
});

test("identify picks closest of multiple candidates", () => {
  const target = Array.from({ length: 128 }, () => 0.1);
  const decoy = Array.from({ length: 128 }, () => 0.5);
  const probe = target.slice();
  const r = identify(
    probe,
    [
      { userId: "decoy", descriptors: [decoy] },
      { userId: "target", descriptors: [target] },
    ],
    settings,
  );
  assert.equal(r.userId, "target");
  assert.equal(r.outcome, "auto_approved");
});

test("identify rejects clearly different vectors", () => {
  const a = Array.from({ length: 128 }, () => 0);
  const b = Array.from({ length: 128 }, () => 1);
  const r = identify(b, [{ userId: "x", descriptors: [a] }], settings);
  assert.notEqual(r.outcome, "auto_approved");
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok  ${t.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  FAIL  ${t.name}\n        ${err.stack || err.message}`);
      failed++;
    }
  }
  console.log(`\n${passed}/${tests.length} passed${failed ? `, ${failed} FAILED` : ""}`);
  if (failed > 0) process.exit(1);
})();
