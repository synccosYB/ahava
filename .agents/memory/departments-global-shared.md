---
name: Departments are a global shared list
description: Departments are NOT company-scoped — single global list, unique on name.
---

# Departments are a global shared list

Departments are one shared list across all companies. Do NOT re-introduce
company scoping when reading/creating them.

- Unique constraint is on `departments.name` alone (`departments_name_unique`),
  NOT `(company_id, name)`.
- `departments.company_id` still exists but is **nullable and unused for
  scoping** — kept only to avoid a destructive drop / drift-guard churn.
- `GET /api/departments` returns the full list for anyone with
  `departments.view`; only optional `locationId` narrows it.
- Duplicate name → 409 "A department with this name already exists."

**Why:** users wanted both companies to draw from the same department list and
to stop "pick a company before you can see/add departments" friction.
