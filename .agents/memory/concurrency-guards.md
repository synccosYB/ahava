---
name: Concurrency guards for approvals & balances
description: Conventions for race-safe approval transitions and PTO balance writes
---

# Race-safe writes (approvals & PTO balances)

**Rule:** Any write that transitions a row out of an expected state (approve /
deny / decide / cancel) MUST guard the UPDATE with the expected state in its
WHERE clause and treat a 0-row result as "already handled" — never rely solely
on a pre-read `if (status !== 'pending')` check.

**Why:** The pre-read check is TOCTOU-racy — two managers clicking approve at
once both pass it, then both write, double-applying a correction. The DB row
lock + `WHERE status = 'pending'` makes the loser's UPDATE affect 0 rows.

**How to apply:**
- Inside the route transaction, add `eq(table.status, "pending")` (or the
  relevant guard column, e.g. `reopenStatus`) to the `.where(...)`. If
  `.returning()` yields no row, `throw new RouteConflictError(...)` so the whole
  transaction (including any punch_log it created) rolls back.
- `RouteConflictError` (server/routeErrors.ts) maps to HTTP 409 via
  `mapRouteError`. Client: `isConflictError` (client/src/lib/queryClient.ts) +
  `handleMutationError` (client/src/lib/mutationError.ts) show an "already
  handled — refreshing" toast and invalidate queries.
- For storage helpers that aren't in a route transaction, pass an
  `expectedStatus` option (see `updateAttendanceException`) and 409 on undefined.

**PTO balances:** mutate via `storage.incrementTimeOffBalance` (atomic SQL
`set total = total + :delta`), never read-modify-write, so the anniversary
accrual job and manual edits can't clobber each other. Note balances are mostly
*computed* (sum of approved requests minus accruals); the stored
`time_off_balances` row is only written by the anniversary job today.
