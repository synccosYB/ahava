import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidAdmsToken } from "../adms/protocol";

const KEY = "ahava-adms-secure-ingress-key-is-long-and-random";

test("ADMS ingress is disabled when its server secret is missing or weak", () => {
  assert.equal(isValidAdmsToken(undefined, KEY), false);
  assert.equal(isValidAdmsToken("short", "short"), false);
  assert.equal(isValidAdmsToken("", ""), false);
});
test("ADMS ingress rejects omitted or mismatched credentials", () => {
  assert.equal(isValidAdmsToken(KEY, undefined), false);
  assert.equal(isValidAdmsToken(KEY, "wrong"), false);
  assert.equal(isValidAdmsToken(KEY, KEY + "suffix"), false);
});
test("ADMS ingress accepts exact, sufficiently long credentials", () => {
  assert.equal(isValidAdmsToken(KEY, KEY), true);
});
