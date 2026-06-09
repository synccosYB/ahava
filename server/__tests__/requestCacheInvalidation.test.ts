/**
 * Regression tests for the "I saved it but nothing changed" stale-data bug.
 *
 * The server request cache (`requestCache`) must be busted automatically after
 * any successful mutation by the global `requestCacheInvalidator()` middleware,
 * so a read right after a write never serves a stale cached response.
 *
 * Run with: `tsx server/__tests__/requestCacheInvalidation.test.ts`
 */
import assert from "node:assert/strict";
import type { Request, Response } from "express";

const { appCache } = await import("../lib/cache.js");
const { requestCacheInvalidator, invalidateRequestCache, REQUEST_CACHE_PREFIX } =
  await import("../lib/requestCache.js");

function fakeRes(statusCode: number): Response {
  const res = {
    statusCode,
    end(this: Response, ..._args: unknown[]) {
      return this;
    },
  } as unknown as Response;
  return res;
}

function runMiddleware(method: string, statusCode: number) {
  const mw = requestCacheInvalidator();
  const req = { method } as Request;
  const res = fakeRes(statusCode);
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, `${method} should call next()`);
  // Simulate the handler flushing the response.
  res.end();
  return res;
}

function seedCache() {
  appCache.set(`${REQUEST_CACHE_PREFIX}u1:/api/users`, { status: 200, body: [] });
  appCache.set(`${REQUEST_CACHE_PREFIX}u2:/api/alerts`, { status: 200, body: [] });
}

function cacheCount(): number {
  let n = 0;
  if (appCache.get(`${REQUEST_CACHE_PREFIX}u1:/api/users`)) n++;
  if (appCache.get(`${REQUEST_CACHE_PREFIX}u2:/api/alerts`)) n++;
  return n;
}

// --- invalidateRequestCache clears the whole request cache ---
seedCache();
assert.equal(cacheCount(), 2, "two entries seeded");
invalidateRequestCache();
assert.equal(cacheCount(), 0, "invalidateRequestCache() clears all rc: entries");

// --- successful mutations bust the cache ---
for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  seedCache();
  runMiddleware(method, 200);
  assert.equal(cacheCount(), 0, `${method} 200 busts the cache`);

  seedCache();
  runMiddleware(method, 204);
  assert.equal(cacheCount(), 0, `${method} 204 busts the cache`);
}

// --- reads never bust the cache ---
for (const method of ["GET", "HEAD", "OPTIONS"]) {
  seedCache();
  runMiddleware(method, 200);
  assert.equal(cacheCount(), 2, `${method} leaves the cache intact`);
  invalidateRequestCache();
}

// --- failed mutations leave the cache intact (nothing changed) ---
for (const status of [400, 403, 404, 409, 500]) {
  seedCache();
  runMiddleware("POST", status);
  assert.equal(cacheCount(), 2, `POST ${status} keeps the cache (no state change)`);
  invalidateRequestCache();
}

console.log("OK — request cache invalidation regression tests passed");
