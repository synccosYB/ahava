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

export function requestCache(opts: CacheOpts = {}): RequestHandler {
  const scope = opts.scope ?? "user";
  const prefix = opts.keyPrefix ?? "rc:";
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
