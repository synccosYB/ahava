---
name: Attendance change ledger (immutable audit)
description: Append-only audit ledger of every attendance/PTO/payroll change. DISTINCT from the attendance-ledger SSOT (which materializes computed hours).
---

# Attendance change ledger (immutable audit)

NOTE — name collision: this is NOT the "attendance ledger SSOT"
(`server/attendanceLedger.ts`, table `attendance_ledger`, a computed
per-employee-day hours/OT materialization). THIS feature is the append-only
*audit* ledger of changes. To avoid a hard table/identifier clash after both
shipped, this one uses table `attendance_change_ledger` and export
`attendanceChangeLedger` (originally `attendance_ledger` / `attendanceLedger`,
renamed during the rebase onto the SSOT work).

`attendance_change_ledger` is an append-only, never-updated/never-deleted ledger
(separate from `audit_logs` / `punch_logs`) recording every attendance/PTO/
payroll-impacting change with before/after JSON snapshots + hours delta.

- Writer: `server/services/ledger.ts` `writeLedgerEntry(entry, tx?)` — INSERT
  only, tx-aware (pass the tx so the ledger row commits atomically with the
  mutation), mirrors `writeAuditLog`. Categories: attendance | hours | pto |
  payroll. Read via `storage.getLedgerEntriesByEmployee`; endpoint
  `GET /api/ledger/employee/:userId` gated on `audit.view`.

**Decision — payroll rows are written PER EMPLOYEE, not once per batch.**
`employee_id` is NOT NULL, but payroll export/lock/reopen are org/batch-level
with no single employee. To make payroll events show up in the per-employee
history view, those handlers fan out one ledger row per employee in the batch
(iterate `employeeRecords.keys()` for export-csv; distinct `employeeId` from
`getPayrollBatchRecords` for lock/reopen).
**Why:** the whole feature is per-employee history; a single batch-level row
with a null/placeholder employee would never surface in any employee's view.
**How to apply:** any new batch-level payroll event that should appear in
employee history must fan out per-employee the same way.
