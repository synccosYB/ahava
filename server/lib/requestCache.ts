import type { RequestHandler } from "express";
import { appCache } from "./cache";
import { singleFlight } from "./inFlight";

interface CacheOpts {
  ttlMs?: number;
  scope?: "global" | "user";
  keyPrefix?: string;
}

interface Cached {
  status: number;
  body: unknown;
}

/**
 * Shared prefix for every entry written by `requestCache`. All cached GET
 * responses live under this prefix so a single `invalidateRequestCache()`
 * clears the whole read cache in lockstep.
 */
export const REQUEST_CACHE_PREFIX = "rc:";

/**
 * Drop cached GET responses. With no argument it clears the entire request
 * cache (every `requestCache`-backed route). Pass a more specific prefix only
 * if you ever scope caches under sub-prefixes.
 *
 * This is the single, canonical server-side invalidation entry point. Prefer
 * the automatic `requestCacheInvalidator()` middleware (registered globally)
 * over calling this by hand — that way no mutation route can drift out of sync
 * with the cache.
 */
export function invalidateRequestCache(prefix: string = REQUEST_CACHE_PREFIX): void {
  appCache.invalidatePrefix(prefix);
}

/**
 * Global middleware that keeps the server read cache fresh automatically.
 *
 * Any successful (2xx/3xx) mutating request (POST/PUT/PATCH/DELETE) clears the
 * entire request cache *before* the response body is flushed to the client, so
 * the next read — even a concurrent one — never sees stale data. Because it is
 * registered once for the whole API surface, individual mutation routes do NOT
 * need to remember to invalidate anything: the pattern is "mutate → respond →
 * cache is already gone."
 *
 * Register this before the route handlers in `registerRoutes`.
 */
export function requestCacheInvalidator(
  prefix: string = REQUEST_CACHE_PREFIX,
): RequestHandler {
  return (req, res, next) => {
    const method = req.method.toUpperCase();
    // Reads never invalidate. OPTIONS/HEAD carry no state change.
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }

    let invalidated = false;
    const maybeInvalidate = () => {
      if (invalidated) return;
      invalidated = true;
      // Only successful mutations should bust the cache; a failed 4xx/5xx
      // changed nothing, so keep serving the existing cache.
      if (res.statusCode >= 200 && res.statusCode < 400) {
        invalidateRequestCache(prefix);
      }
    };

    // `res.end` is the lowest common denominator for every response shape
    // (res.json → res.send → res.end, plus bare res.end()/res.sendStatus()).
    // Wrapping it busts the cache synchronously, just before the body flushes.
    const originalEnd = res.end.bind(res);
    res.end = ((...args: unknown[]) => {
      maybeInvalidate();
      // @ts-expect-error - forward the original variadic res.end signature
      return originalEnd(...args);
    }) as typeof res.end;

    next();
  };
}

export function requestCache(opts: CacheOpts = {}): RequestHandler {
  const scope = opts.scope ?? "user";
  const prefix = opts.keyPrefix ?? REQUEST_CACHE_PREFIX;
  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    const userId = scope === "user" ? ((req as any).authUser?.id ?? "anon") : "g";
    const key = `${prefix}${userId}:${req.originalUrl}`;
    const hit = appCache.get(key) as Cached | undefined;
    if (hit) {
      res.setHeader("X-Cache", "HIT");
      return res.status(hit.status).json(hit.body);
    }

    try {
      const result = await singleFlight<Cached>(key, () => {
        return new Promise<Cached>((resolve, reject) => {
          const originalJson = res.json.bind(res);
          let captured = false;
          res.json = (body: unknown) => {
            captured = true;
            const status = res.statusCode || 200;
            const out = { status, body };
            if (status >= 200 && status < 300) {
              appCache.set(key, out, opts.ttlMs);
            }
            resolve(out);
            return originalJson(body);
          };
          res.on("finish", () => {
            if (!captured) {
              reject(new Error("response finished without json"));
            }
          });
          res.on("close", () => {
            if (!captured) reject(new Error("response closed"));
          });
          next();
        });
      });
      if (res.headersSent) return;
      res.setHeader("X-Cache", "HIT");
      res.status(result.status).json(result.body);
    } catch {
      if (!res.headersSent) next();
    }
  };
}
