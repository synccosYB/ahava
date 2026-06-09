---
name: Reports category vs scope
description: /api/reports/generate distinguishes report category (what data) from access scope, and returns a self-describing columns/rows payload.
---

# Reports: category vs scope, and the payload contract

`POST /api/reports/generate` (server/routes.ts) takes TWO independent fields:
- `category` — WHAT report: attendance | time | pto | missing-punches | exceptions. Defaults to "attendance" (legacy clients).
- `reportType` — access SCOPE only (employee | team | company); narrows whose data a user may see. Optional, default "company".

**Why:** the five standard report tabs used to all render the same per-employee
hours summary because the frontend overloaded `reportType` (company/employee/team)
as if it were the report type. Category was added to separate the two concerns.

**Payload contract:** the endpoint returns `{ category, columns, rows }`, NOT a bare
array. `columns[].kind` (hours | date | datetime | number | text) tells the client
(`client/src/pages/reports.tsx`, StandardReport) how to format each cell for both the
table and the CSV export. To add a column, change it on the server and the client
adapts automatically — do not hard-code columns per tab on the client.

**How to apply:** hours-based categories (attendance, time) reuse
`getAttendanceAggregatesByDateRange` so totals match the timesheet; pto /
missing-punches / exceptions use `getTimeOffRequestsByDateRange` /
`getIncompletePunchesByDateRange` / `getAttendanceExceptionsByDateRange` in storage.
All categories share the same user-filtering block (scope + dept/employee/location/
company/tax/status), so filters apply uniformly. Status filter applies to pto and
exceptions (different status vocabularies — see TIME_OFF_/EXCEPTION_STATUS_OPTIONS).
