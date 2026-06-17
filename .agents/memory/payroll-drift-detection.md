---
name: Payroll drift detection
description: Design decisions/constraints for comparing exported payroll batch snapshots vs current source data.
---

# Payroll export drift detection

Drift detection answers "does this exported/locked payroll batch still match the source data?"
by comparing each batch record's FROZEN snapshot against a fresh recompute. It is the comprehensive
counterpart to the older attendance-only verification path; both coexist.

**Read-only contract (critical):** the drift checker NEVER mutates batch records. The snapshot is the
historical record of what was paid; only the attendance reconciliation path may rewrite source
punches. Drift never re-syncs a snapshot.
**Why:** closed-period payroll dollars must stay stable; drift is purely informational + a lock gate.

**Hours recompute with the FROZEN policy snapshot (legacy rows fall back to live policy).**
**Why:** this isolates SOURCE-DATA changes (punch edits, exception approvals, PTO cancellations) from
later POLICY edits — editing a policy must NOT register as drift.

**Bonuses are NOT snapshotted, so drift recomputes them with the employee's CURRENT payroll rules.**
**Consequence/caveat:** a bonus-RULE edit (not just an hours change) can surface as drift. If bonus
rules ever get snapshotted onto batch records, switch the drift recompute to prefer the frozen rules.

**Lock is the enforcement point:** locking recomputes drift and refuses unless the caller explicitly
acknowledges; acknowledged locks are audited distinctly from clean locks. Non-draft batches
auto-check drift on page load so status is always visible without a manual click.
