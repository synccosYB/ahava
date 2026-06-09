---
name: Client 409 conflation
description: handleMutationError treats every bare 409 as a concurrency conflict; deliberate 409 blocks must carry a machine code.
---

# Client conflates all 409s as concurrency conflicts

`handleMutationError` in `client/src/lib/mutationError.ts` renders ANY 409 as the
generic "Already handled by someone else — refreshing" toast (it keys off
`isConflictError`, which is just `status === 409`). It ignores the server's
message entirely for 409s.

**Rule:** any *deliberate* 409 block (not a status-guarded concurrency loss) must
return a stable machine `code` in the JSON body, and `handleMutationError` must
special-case that code BEFORE the `isConflictError` branch — otherwise the
explanatory message is silently replaced by the generic refresh toast.

**Why:** the RBAC/approval routes use 409 as a convention for optimistic
status-guarded writes (two managers approving the same row). A new feature that
also returns 409 for a different reason (e.g. punch is baked into finalized
payroll → `code: "PAYROLL_FINALIZED"`) would otherwise show the wrong toast.

**How to apply:** server side, add `code?: string` to the error body. The shared
`handleRouteError`/`mapRouteError` in `server/routeErrors.ts` already propagate a
`code` field; throw a dedicated error class (e.g. `PayrollFinalizedError`) that
maps to `{ status: 409, code }`. Client side, branch on
`isApiError(err) && err.code === "<CODE>"` and surface `err.payload.message`.
`ApiError` (in `client/src/lib/queryClient.ts`) carries `.code` and `.payload`.
