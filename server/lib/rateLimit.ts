import type { RequestHandler } from "express";
import { config } from "../config";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  buckets.forEach((b, k) => {
    if (b.resetAt < now) buckets.delete(k);
  });
}, 60_000).unref?.();

export function rateLimit(opts?: { windowMs?: number; max?: number }): RequestHandler {
  const windowMs = opts?.windowMs ?? config.rateLimitWindowMs;
  const max = opts?.max ?? config.rateLimitMax;
  return (req, res, next) => {
    // Use Express's req.ip, which honors the app's `trust proxy` setting and so
    // reflects the real client IP from the trusted proxy hop — NOT the raw,
    // client-spoofable X-Forwarded-For header (which would let any caller mint a
    // fresh bucket per request and bypass throttling entirely).
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message: "Too many requests" });
    }
    next();
  };
}
