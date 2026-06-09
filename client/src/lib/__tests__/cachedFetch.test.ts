import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cachedFetch, invalidateCachedFetch } from "../cachedFetch";

const realFetch = globalThis.fetch;

let calls = 0;
function installFetch() {
  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, call: calls }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  invalidateCachedFetch();
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("cachedFetch serves a cached GET without a second network call", async () => {
  await cachedFetch("/api/example");
  await cachedFetch("/api/example");
  assert.equal(calls, 1);
});

test("invalidateCachedFetch() with no args clears every cached entry", async () => {
  // Simulate the previous user's queries warming the request cache.
  await cachedFetch("/api/dashboard");
  await cachedFetch("/api/requests");
  assert.equal(calls, 2);

  // Login/logout wipes the entire cache so the next user starts clean.
  invalidateCachedFetch();

  await cachedFetch("/api/dashboard");
  await cachedFetch("/api/requests");
  // Both refetch from the network — none of the prior entries survived.
  assert.equal(calls, 4);
});

test("invalidateCachedFetch(prefix) clears only matching entries", async () => {
  await cachedFetch("/api/dashboard");
  await cachedFetch("/api/requests");
  assert.equal(calls, 2);

  invalidateCachedFetch("/api/dashboard");

  await cachedFetch("/api/dashboard"); // refetched
  await cachedFetch("/api/requests"); // still cached
  assert.equal(calls, 3);
});
