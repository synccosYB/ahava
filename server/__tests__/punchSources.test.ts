/**
 * Self-contained tests for punch-method enforcement helpers.
 *
 * Run with: `tsx server/__tests__/punchSources.test.ts`
 *
 * No external test runner dependency — asserts inline and exits non-zero on the
 * first failure so it can be wired into CI without adding a dev-dep to package.json.
 */
import assert from "node:assert/strict";

const {
  PUNCH_SOURCES,
  DEFAULT_ALLOWED_PUNCH_SOURCES,
  getAllowedPunchSources,
  isPunchSourceAllowed,
  isKnownPunchSource,
  punchSourceLabel,
} = await import("../../shared/punchSources.js");

const { DEFAULT_ATTENDANCE_RULES } = await import("../policyEngine.js");

const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// --- Canonical set ---
test("recognizes the five canonical punch methods", () => {
  assert.deepEqual([...PUNCH_SOURCES], ["web", "mobile", "kiosk", "qr", "manager"]);
  for (const s of ["web", "mobile", "kiosk", "qr", "manager"]) {
    assert.ok(isKnownPunchSource(s), `${s} should be known`);
  }
  assert.equal(isKnownPunchSource("badge"), false);
  assert.equal(isKnownPunchSource(123), false);
});

// --- Defaults preserve existing behavior ---
test("default allowed methods keep web/mobile/kiosk/manager on, qr off", () => {
  assert.deepEqual(DEFAULT_ALLOWED_PUNCH_SOURCES, ["web", "mobile", "kiosk", "manager"]);
  assert.ok(!DEFAULT_ALLOWED_PUNCH_SOURCES.includes("qr"));
});

test("policy engine default attendance rules use the shared default", () => {
  assert.deepEqual(
    DEFAULT_ATTENDANCE_RULES.allowedPunchSources,
    DEFAULT_ALLOWED_PUNCH_SOURCES,
  );
});

// --- Resolution / fallback ---
test("unspecified rules fall back to the default set", () => {
  assert.deepEqual(getAllowedPunchSources(undefined), DEFAULT_ALLOWED_PUNCH_SOURCES);
  assert.deepEqual(getAllowedPunchSources(null), DEFAULT_ALLOWED_PUNCH_SOURCES);
  assert.deepEqual(getAllowedPunchSources({}), DEFAULT_ALLOWED_PUNCH_SOURCES);
  // Not-an-array also falls back.
  assert.deepEqual(
    getAllowedPunchSources({ allowedPunchSources: "web" as unknown }),
    DEFAULT_ALLOWED_PUNCH_SOURCES,
  );
  // An array of ONLY unknown values is treated as corrupt → fail open to default.
  assert.deepEqual(
    getAllowedPunchSources({ allowedPunchSources: ["nope", 5, null] }),
    DEFAULT_ALLOWED_PUNCH_SOURCES,
  );
});

test("an explicit empty list means deny-all, NOT fall back to default", () => {
  assert.deepEqual(getAllowedPunchSources({ allowedPunchSources: [] }), []);
  // Nothing is allowed when the admin unchecks every method.
  for (const s of PUNCH_SOURCES) {
    assert.equal(
      isPunchSourceAllowed({ allowedPunchSources: [] }, s),
      false,
      `${s} must be blocked under deny-all`,
    );
  }
});

test("explicit lists are honored and sanitized", () => {
  assert.deepEqual(
    getAllowedPunchSources({ allowedPunchSources: ["kiosk"] }),
    ["kiosk"],
  );
  // Mixed valid/invalid keeps only the valid ones.
  assert.deepEqual(
    getAllowedPunchSources({ allowedPunchSources: ["web", "bogus", "qr"] }),
    ["web", "qr"],
  );
});

// --- Enforcement predicate ---
test("isPunchSourceAllowed enforces per-policy allow lists", () => {
  const kioskOnly = { allowedPunchSources: ["kiosk"] };
  assert.equal(isPunchSourceAllowed(kioskOnly, "kiosk"), true);
  assert.equal(isPunchSourceAllowed(kioskOnly, "web"), false);
  assert.equal(isPunchSourceAllowed(kioskOnly, "manager"), false);

  // With no policy, web/mobile/kiosk/manager are allowed; qr is blocked.
  assert.equal(isPunchSourceAllowed(undefined, "web"), true);
  assert.equal(isPunchSourceAllowed(undefined, "mobile"), true);
  assert.equal(isPunchSourceAllowed(undefined, "kiosk"), true);
  assert.equal(isPunchSourceAllowed(undefined, "manager"), true);
  assert.equal(isPunchSourceAllowed(undefined, "qr"), false);
});

test("labels resolve for known sources and pass through unknown", () => {
  assert.equal(punchSourceLabel("qr"), "QR Code");
  assert.equal(punchSourceLabel("manager"), "Manager Entry");
  assert.equal(punchSourceLabel("weird"), "weird");
});

let failures = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ✓ ${t.name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${t.name}`);
    console.error(err);
  }
}
if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${tests.length} punch-source tests passed`);
