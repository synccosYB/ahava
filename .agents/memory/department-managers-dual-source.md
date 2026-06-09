---
name: Department managers have two sources
description: Resolving a department's managers must union the link table AND role-based assignment, not just the link table.
---

A department's managers come from TWO independent sources:
1. The explicit `department_managers` link table (set via the multi-select on Locations & Departments).
2. Users who hold the `manager` role and are assigned to that department via `users.department_id` (no link-table row required).

**Why:** The Requests & Approvals cards once showed "No manager" for departments that clearly had a manager, because the enrichment only read the link table. A role-based manager who was never added to the link table produced an empty `managerNames`, and the frontend fell back to "No manager".

**How to apply:** Any code that *displays* a department's managers should union both sources (dedupe by user id, skip deactivated users). Use the shared `buildDeptManagerNameMap(userMap)` helper in `server/routes.ts` rather than calling `storage.getDepartmentManagers(dept.id)` inline. Note: this is about the *displayed* name only — approval routing/scoping (`getTeamUserIds`) is a separate concern and was intentionally left unchanged.
