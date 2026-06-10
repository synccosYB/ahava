---
name: Employee department/location membership (M2M)
description: How employee↔department and employee↔location membership works and the rule every consumer must follow.
---

Employees are many-to-many with departments and locations via the `employee_departments` / `employee_locations` join tables. The legacy `users.departmentId` / `users.locationId` columns are kept ONLY as a compat shim (do NOT drop) and are synced to the FIRST element of the membership set on write.

**Rule:** any code that decides "is this employee in department/location X" or groups/filters employees by dept/loc MUST use the shared helpers `userDepartmentIds(u)` / `userLocationIds(u)` (in `shared/models/auth.ts`, re-exported from `shared/schema.ts`) and match if ANY membership matches — never read raw `u.departmentId` / `u.locationId` for matching. The helpers prefer the hydrated arrays and fall back to the legacy column when a row isn't hydrated.

**Why:** raw single-column reads silently ignore secondary memberships, so an employee assigned to multiple departments would be invisible to every consumer except their primary one (the original BUG-0240). Consumers include: policy engine, RBAC/manager visibility, reports filters, kiosk grouping, employee list, workflows, role assignment, lifecycle alerts.

**How to apply:** when adding/editing any feature that touches dept/loc membership, hydrate users (storage `hydrateUsers` attaches `departmentIds`/`locationIds`) and route all matching through the helpers. Tie-break when a single value is still required (e.g. legacy column, kiosk display label): use the first element in stable query order.
