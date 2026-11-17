import { test } from "node:test";
import assert from "node:assert/strict";
import { punchDebounceRemaining, PUNCH_DEBOUNCE_MS } from "../punchDebounce";

const base = new Date("2026-11-10T09:00:00Z");
const plus = (ms: number) => new Date(base.getTime() + ms);

test("no prior punch → always allowed", () => {
  assert.equal(punchDebounceRemaining(null, base), 0);
});
test("within the window → remaining > 0 (ignored)", () => {
  assert.equal(punchDebounceRemaining(base, plus(90_000)) > 0, true);
  assert.equal(punchDebounceRemaining(base, plus(90_000)), PUNCH_DEBOUNCE_MS - 90_000);
});
test("exactly at the window edge → allowed", () => {
  assert.equal(punchDebounceRemaining(base, plus(PUNCH_DEBOUNCE_MS)), 0);
});
test("after the window → allowed", () => {
  assert.equal(punchDebounceRemaining(base, plus(PUNCH_DEBOUNCE_MS + 1)), 0);
});
test("a clock slightly behind (negative elapsed) → not debounced", () => {
  assert.equal(punchDebounceRemaining(base, plus(-5000)), 0);
});
