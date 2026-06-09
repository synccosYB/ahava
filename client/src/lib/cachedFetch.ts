interface CacheEntry {
  expiresAt: number;
  promise: Promise<Response>;
  body?: unknown;
  bodyParsed?: boolean;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 15_000;

function makeKey(input: RequestInfo | URL, init?: RequestInit): string {
  const url = typeof input === "string" ? input : input.toString();
  const method = (init?.method || "GET").toUpperCase();
  return `${method} ${url}`;
}

export async function cachedFetch(
  input: RequestInfo | URL,
  init?: RequestInit & { ttlMs?: number },
): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET") return fetch(input, init);

  const key = makeKey(input, init);
  const ttl = init?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    const res = await hit.promise;
    return res.clone();
  }

  const promise = fetch(input, { credentials: "include", ...init }).then((r) => r.clone());
  cache.set(key, { expiresAt: now + ttl, promise });
  try {
    const res = await promise;
    return res.clone();
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

/**
 * Drop entries from the in-memory request cache. With no argument it clears
 * everything; pass a URL substring to clear only matching entries.
 *
 * You normally do NOT need to call this directly — `apiRequest` in
 * `queryClient.ts` invokes it automatically after every successful mutation, so
 * `cachedFetch` stays in lockstep with `queryClient.invalidateQueries`. Call it
 * by hand only for a mutation that bypasses `apiRequest`.
 */
export function invalidateCachedFetch(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const k of Array.from(cache.keys())) {
    if (k.includes(prefix)) cache.delete(k);
  }
}
