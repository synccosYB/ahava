---
name: Role tier vs RBAC roles
description: Two distinct "role" concepts in the app and which dropdowns are createable records vs fixed enums
---

There are TWO unrelated concepts both called "role" in the UI:

1. **Access tier** — a fixed varchar enum on `users.role` with exactly three values: `employee` / `manager` / `admin`. NOT a user-created record. Surfaces: Add Employee dialog `formData.role`, the role-assignment-rules `targetRole` dropdowns (test panel + rule form). `POST /api/users` takes this tier string and runs `applyRoleForUser` (rule-based); it does NOT accept roleIds.

2. **RBAC roles** — rows in the `roles` table (Super Admin, HR Admin, …), user-created. Assigned to users many-to-many via `PUT /api/users/:id/roles`; the flat tier is then auto-derived. Surfaces: Employee Profile role MultiSelect, Policy Wizard role-assignment target.

**Rule:** inline "+ Add new role" (create-on-the-fly, reusing `POST /api/roles`, gated by `roles.manage`) belongs ONLY on RBAC-role surfaces. The tier dropdowns are fixed lists — adding "create a role" there is incoherent (a new RBAC role isn't a tier) and would require backend changes.

**Why:** task #406 text listed "the Add Employee dialog … and the role-rule dialog" as targets, but those select the tier enum, not createable records. Honoring it literally would break the tier system. The user's actual clarification (with screenshot) pointed at the Employee Profile RBAC multiselect.

**How to apply:** when asked to make a "role" dropdown data-driven or add inline create, first determine tier vs RBAC by checking whether the value feeds `users.role` (tier) or `roleIds`/`roles` table (RBAC).
