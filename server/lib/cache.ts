interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(private defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
    if (this.store.size > 5000) this.evictExpired();
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    this.store.forEach((_v, k) => {
      if (k.startsWith(prefix)) this.store.delete(k);
    });
  }

  clear(): void {
    this.store.clear();
  }

  private evictExpired() {
    const now = Date.now();
    this.store.forEach((v, k) => {
      if (v.expiresAt < now) this.store.delete(k);
    });
  }
}

import { config } from "../config";
export const appCache = new TtlCache<unknown>(config.cacheTtlMs);
