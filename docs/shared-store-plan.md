# Shared Store (Redis) Plan — Cache, Rate Limiting & WebSockets

**Status:** Design / decision deliverable. No code behavior changes here.
**Goal:** Make the app correct under horizontal scaling (more than one instance) by moving three in-process, single-instance components onto a shared store before onboarding many customers.

---

## 1. Current state & the multi-instance failure mode

Everything below lives in process memory today. With one instance it works; with N instances behind a load balancer it breaks.

### 1.1 Response/request cache
- **Where:** `server/lib/cache.ts` (`TtlCache`, exported as `appCache`), wrapped by `server/lib/requestCache.ts` and used on read-heavy GETs (`/api/users`, `/api/manager/team-stats`, `/api/admin/company-stats`, `/api/alerts`, `/api/audit-logs/filtered`).
- **Behavior:** In-memory `Map` of `key -> { value, expiresAt }`. Keys are `rc:<userId|g>:<originalUrl>`. TTL default 15s (`CACHE_TTL_MS`). Soft cap of 5000 entries triggers an expired-entry sweep (no true LRU). `singleFlight` (`server/lib/inFlight.ts`) collapses concurrent identical requests. Invalidation is `appCache.invalidatePrefix("rc:")` via `invalidateUserCache()` in `server/routes.ts:56`.
- **Multi-instance failure:** Each instance has its own map. A write served by instance A calls `invalidateUserCache()` only on A; instances B…N keep serving stale data until their own TTL expires. `singleFlight` only dedupes within one instance. Net effect: **caches diverge, invalidation is partial, stale reads up to one TTL window per instance.**

### 1.2 Rate limiting
- **Where:** `server/lib/rateLimit.ts`, applied globally to `/api` and `/internal` in `server/index.ts:72-77`, plus stricter per-route limiters on forgot/reset-password (`server/replit_integrations/auth/replitAuth.ts`).
- **Behavior:** In-memory `Map` of `"<ip>:<path>" -> { count, resetAt }`, fixed window (default 240 req / 60s; auth flows 30 / 15min). A `setInterval` sweeps expired buckets.
- **Multi-instance failure:** Counters are per instance. With N instances and round-robin balancing the effective limit becomes **~N × max** — an attacker gets N times the intended budget, and the strict auth limiters (the ones that actually matter for abuse) are the most weakened. **Rate limiting is not enforceable across the fleet.**

### 1.3 Expensive-POST cooldown (related, same class of bug)
- **Where:** `server/lib/cooldown.ts` (`shouldRun`/`resetCooldown`), in-memory `Map` of `key -> lastRun`.
- **Multi-instance failure:** Same as rate limiting — cooldown only applies on the instance that last ran the job, so an expensive POST can run up to N times concurrently. Folded into this plan because it shares the store and the fix.

### 1.4 WebSocket broadcast
- **Where:** `server/routes.ts:7496-7522`. `WebSocketServer` on `/ws`, a local `Set<WebSocket>` (`wsClients`), `broadcastAttendanceUpdate()` iterates that set. Triggered from clock-in/out paths via `globalThis.__broadcastAttendanceUpdate` (`server/routes.ts:2491,2534`).
- **Multi-instance failure:** A client connects to exactly one instance and is only in that instance's `wsClients`. An attendance event handled on instance A is broadcast only to A's sockets; clients connected to B…N **never receive the event.** Live attendance silently misses ~(N-1)/N of updates as you scale.

---

## 2. Chosen shared store: Redis

**Decision: Redis (managed), single library `ioredis`.** Rationale:
- One dependency covers all four needs: key/value with TTL (cache, cooldown), atomic counters with expiry (rate limit), and pub/sub (WebSocket fan-out).
- Mature, battle-tested, cheap, and available as a managed service (e.g. Upstash, Redis Cloud, or the host's managed Redis). No need to run our own.
- Alternatives considered and rejected for now: Postgres (already our DB — usable for cache/rate-limit via `LISTEN/NOTIFY` for pub/sub, but adds load to the primary OLTP DB and `NOTIFY` is weaker than Redis pub/sub); in-memory + sticky sessions (doesn't fix cache invalidation or rate-limit sharing, only partially helps WS). Redis is the standard answer and keeps all three concerns in one place.

### 2.1 Connection & config
- New env var `REDIS_URL` (e.g. `rediss://…`). Add to `server/config.ts` alongside existing knobs:
  - `redisUrl: str("REDIS_URL", "")`
  - `redisKeyPrefix: str("REDIS_KEY_PREFIX", "ahava:")` — namespacing so multiple environments can share one Redis if needed.
- Two `ioredis` connections: one general client (cache/rate-limit/cooldown), one dedicated **subscriber** connection (ioredis requires a connection in subscribe mode to be separate from one issuing normal commands). A third publisher can reuse the general client.
- Centralize in a new `server/lib/redis.ts` that exports `getRedis()`, `getRedisSub()`, and an `isRedisEnabled()` flag derived from `REDIS_URL` being set.

### 2.2 Fallback when Redis is absent/unavailable
- **Dev / no `REDIS_URL`:** fall back to the existing in-memory implementations (current behavior). Single instance, so correctness is unaffected. Log once at startup: `[redis] disabled — using in-process cache/rate-limit/ws (single-instance only)`.
- **Prod with `REDIS_URL` set but Redis down at runtime:** degrade safely per component (details in §3). Never crash a request because Redis blipped; prefer "fail open" for cache (skip cache → hit DB) and "fail open with logging" for rate limit (allow request rather than 500). Use short command timeouts (e.g. 200ms) and a circuit-breaker style flag so a dead Redis doesn't add latency to every request.

---

## 3. Per-component design

### 3.1 Cache → Redis
- **Keys:** keep current shape, namespaced: `ahava:rc:<userId|g>:<originalUrl>`.
- **Storage:** `SET key <json> PX <ttlMs>` — Redis handles TTL natively, so no manual `expiresAt` bookkeeping. Eviction: rely on Redis `maxmemory` + `allkeys-lru` policy on the managed instance instead of our home-grown 5000-entry sweep (this is the "with LRU" requirement). Values are JSON-serialized `{ status, body }`.
- **Invalidation (the key win):** replace `invalidatePrefix` with a Redis-side scan-and-delete. Prefer **tag/version keys over `KEYS`** (which is O(N) and blocks): maintain a cache "generation" integer per scope (e.g. `ahava:rc:gen`) included in the cache key; `invalidateUserCache()` becomes `INCR ahava:rc:gen`, which instantly orphans all old keys (they expire naturally via TTL). This invalidates across **all** instances atomically and avoids `KEYS`/`SCAN` cost. Document the tradeoff: orphaned keys linger until TTL but are never read (cheap, bounded by `maxmemory` LRU).
- **Single-flight:** keep `singleFlight` as a per-instance optimization (harmless duplicate-collapsing); cross-instance dedupe is not required for correctness and a Redis lock would add latency. Leave as-is.
- **TTLs:** unchanged default 15s (`CACHE_TTL_MS`); per-route `ttlMs` override still honored.
- **Fail open:** on Redis error, `requestCache` skips the cache and calls `next()` (serve fresh). No user-visible failure.

### 3.2 Rate limiting → Redis
- **Algorithm:** atomic fixed-window counter to start (matches current semantics, lowest risk). Per request: `INCR ahava:rl:<ip>:<path>`; if the returned count is 1, `PEXPIRE key <windowMs>`. If count > max → 429 with `Retry-After` from `PTTL`. Do the INCR+conditional-EXPIRE in a tiny Lua script (or `MULTI`) to keep it atomic and avoid a race where the key never gets a TTL.
- **Why fixed window first:** it's a drop-in for today's behavior. A sliding-window or token-bucket Lua script is a reasonable later refinement if burst smoothing is needed — call it out as optional, not required for correctness.
- **Auth limiters:** the strict forgot/reset-password limiters move to the same mechanism with their own windows — these benefit most from being shared.
- **Fail open:** if Redis errors, allow the request (log a warning, increment a metric). Rationale: a Redis outage should not lock everyone out of the app; the brief loss of rate limiting is the lesser evil. (If the threat model later demands fail-closed for auth endpoints specifically, that can be a per-limiter option.)

### 3.3 Cooldown → Redis
- Replace `lastRun` map with `SET ahava:cd:<key> 1 PX <cooldownMs> NX`. If `NX` set succeeds → `{ ok: true }`; if it fails → still cooling down, compute `retryAfterMs` from `PTTL`. `resetCooldown` → `DEL`. Atomic and shared across instances with no extra round-trips.

### 3.4 WebSocket fan-out → Redis pub/sub
- Keep the per-instance `wsClients` set (each instance still tracks its own sockets).
- Replace the direct broadcast with **publish + subscribe**:
  - `broadcastAttendanceUpdate(data)` → `redis.publish("ahava:ws:attendance", JSON.stringify({ event, data }))` instead of looping the local set directly.
  - At startup, each instance subscribes (on the dedicated subscriber connection) to `ahava:ws:attendance`; the message handler loops **its own** `wsClients` and sends to open sockets.
  - This decouples "who triggered the event" from "who is connected where": every instance receives the pub/sub message and delivers to its local clients, so all connected clients get the event regardless of which instance handled the write.
- Auth/connection logic at `/ws` is unchanged. The `globalThis.__broadcastAttendanceUpdate` indirection stays (now publishes instead of looping).
- **Fail behavior:** if publish fails, log and (optionally) still deliver to local clients so a Redis blip degrades to today's single-instance behavior rather than dropping everything.
- **Scale note:** Redis pub/sub is fire-and-forget (no delivery guarantee, no backlog). That's acceptable for live-attendance UI hints. If we later need guaranteed/replayable delivery, that's a separate move to Redis Streams — out of scope here.

---

## 4. Rollout sequence (no downtime)

Order chosen so each step is independently shippable and reversible, lowest-risk first. Every step ships behind the `REDIS_URL` flag: absent → old in-memory path (identical to today), present → Redis path.

1. **Provision managed Redis**, set `REDIS_URL` in prod secrets (not yet used). Add `server/lib/redis.ts` (connections, health flag, timeouts) — no behavior change.
2. **Cooldown → Redis** first. Smallest surface, lowest blast radius, easy to verify (expensive POSTs honor cooldown across instances).
3. **Cache → Redis.** Highest correctness payoff (kills stale-read divergence). Ship the generation-key invalidation. Verify `X-Cache` HIT/MISS behavior and that a write on one instance is visible everywhere within request time.
4. **Rate limiting → Redis.** Verify the global limit holds across instances (not N×) and auth limiters enforce correctly. Keep fail-open.
5. **WebSocket pub/sub.** Subscribe on boot, publish on events. Verify a clock-in on instance A reaches a client connected to instance B.
6. **Only after 2–5 are verified in prod on a single instance** (proving parity), **scale to N>1 instances.** This is the step that actually requires the shared store; do it last so each migration is validated in isolation before horizontal scale exposes the failure modes.

Rollback at any step = unset `REDIS_URL` (or per-component flag) → instant revert to in-memory. Keep the in-memory implementations in the codebase as the fallback path; do not delete them.

---

## 5. Config / env summary

| Var | Default | Purpose |
|---|---|---|
| `REDIS_URL` | _(empty)_ | Enables Redis; empty = in-memory fallback |
| `REDIS_KEY_PREFIX` | `ahava:` | Namespacing across envs |
| `CACHE_TTL_MS` | 15000 | Unchanged; now applied as Redis PX |
| `EXPENSIVE_COOLDOWN_MS` | 60000 | Unchanged; now Redis SET NX PX |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 60000 / 240 | Unchanged; now Redis counter |

Managed Redis instance config: enable `maxmemory` with `allkeys-lru` eviction; size for working set (cache + rate-limit keys are small and short-TTL).

---

## 6. Cost implications

- **Managed Redis:** a small instance is sufficient. Workload is tiny values + short TTLs + low pub/sub volume (attendance events). Estimated low single-digit USD/month on a pay-per-request tier (e.g. Upstash) at current scale; a fixed small Redis Cloud/host plan is similarly modest. Negligible relative to enabling horizontal scaling.
- **Latency:** +1 Redis round-trip on cached GETs and rate-limited requests (sub-ms to low-ms on same-region managed Redis). Mitigated by short command timeouts and fail-open. Pick a Redis region co-located with the app region.
- **Operational:** one more managed dependency to monitor (connection health, memory, evictions). Add a startup log + a lightweight health check.

---

## 7. Acceptance criteria for the follow-up implementation tasks

Each becomes its own approved task. Criteria are written so they can be verified with N≥2 instances.

### Task A — Redis connection layer
- `server/lib/redis.ts` exposes general + subscriber clients, `isRedisEnabled()`, command timeouts, and reconnect handling.
- `REDIS_URL` absent → app runs exactly as today (all in-memory), with one startup log line noting Redis is disabled.
- No request path throws when Redis is unreachable.

### Task B — Cooldown on Redis
- `shouldRun`/`resetCooldown` use `SET NX PX` / `DEL` when Redis enabled; in-memory otherwise.
- With 2 instances, an expensive POST run on instance A is rejected (cooldown) when retried on instance B within the window.
- Redis down → fails open (request allowed), logged.

### Task C — Cache on Redis
- Cached GETs store/read from Redis with native TTL; `X-Cache` header still HIT/MISS correct.
- A mutating write on instance A invalidates the cache for all instances (generation-key bump); a subsequent GET on instance B returns fresh data within request time, not after TTL.
- No use of `KEYS` in any request path. Redis down → cache skipped, DB served, no error.

### Task D — Rate limiting on Redis
- Global and auth limiters use atomic Redis counters; INCR+EXPIRE is atomic (no TTL-less keys).
- With 2 instances and round-robin traffic, the effective limit equals the configured max (±1), not ~2×.
- 429 still returns correct `Retry-After`. Redis down → fail open, logged.

### Task E — WebSocket pub/sub fan-out
- Each instance subscribes on boot; `broadcastAttendanceUpdate` publishes.
- With 2 instances, a clock-in handled on instance A is received by a WS client connected to instance B.
- `/ws` auth unchanged; a Redis publish failure still delivers to local clients (degrades, doesn't drop).

### Task F — Enable horizontal scaling
- Only after A–E verified: scale to N>1. Smoke test cache consistency, rate-limit enforcement, and live attendance across instances.
