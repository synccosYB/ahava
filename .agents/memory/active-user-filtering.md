---
name: Active-user filtering convention
description: How to determine an "active" employee when iterating all users
---
# Active-user filtering

When iterating employees (reports, reconciliation, batch jobs), filter with
`!u.deactivatedAt && u.role !== "kiosk"`.

**Why:** The `users` table (defined in `shared/models/auth.ts`, not `shared/schema.ts`)
has NO `isActive` column — active status is the `deactivatedAt` timestamp being null.
Assuming `u.isActive` compiles in many spots but fails type-check against the real
User type. Kiosk service accounts must also be excluded from per-employee derived data.

**How to apply:** Any new code that loops `storage.getAllUsers()` to compute or
reconcile per-employee values should use this same predicate for consistency.
