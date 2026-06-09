---
name: RBAC permission gating
description: How requirePermission gating works in this app and the exact-match pitfall when converting routes off requireRole.
---

# RBAC permission gating (Ahava time/attendance)

`requirePermission(key)` in `server/middleware/rbac.ts` matches an **exact** key,
with `system.super_admin` as the only wildcard. There is NO implication hierarchy:
holding `attendance.view_all` does NOT satisfy a gate on `attendance.view_team`.

**Why this matters:** when converting a route from `requireRole("admin","manager")`
to a granular permission, admin roles (Division Admin, HR Admin) often only hold
the `*_view_all` variant, while the route gates on `*_view_team`. A non-super-admin
admin then gets a silent 403. Fix: grant the team-scoped keys to the admin roles
too (view_all logically implies view_team). This also surfaces pre-existing latent
403s on routes that were dual-gated before (the role gate masked the missing perm).

**How to apply:**
- Every key passed to `requirePermission(...)` in `server/routes.ts` MUST exist in
  `PERMISSION_KEYS` and be granted to ≥1 role in `SYSTEM_ROLES` (both in
  `server/seed.ts`). The drift guard `server/__tests__/permissionDrift.test.ts`
  enforces this — run `npx tsx server/__tests__/permissionDrift.test.ts`.
- Seeding is additive/top-up: new keys are inserted and roles are "topped up" on
  boot, so adding keys + grants in seed.ts and restarting applies them.
- `LEGACY_ROLE_MAP`: admin→Division Admin, manager→Department Manager,
  employee→Employee. So a legacy "manager" maps to Department Manager — preserve
  its access when converting manager routes (e.g. it needs schedules.manage).
- Documented role exception left intact: `GET /api/policy-assignment-targets`
  keeps `requireRole("admin")` (consolidated policy-wizard target picker).
