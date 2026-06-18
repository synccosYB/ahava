---
name: Punch-overlap exception linkage
description: How a punch_overlap attendance exception references its two conflicting punches.
---
A `punch_overlap` attendance exception (raised on clock-out when the closing punch
overlaps another shift) links its two punches asymmetrically:
- The **closing punch** is in the `punchLogId` column (set via a follow-up update
  because punchLogId is omitted from the insert schema).
- The **conflicting punch** id is embedded ONLY in the `reason` text as
  `(conflicting punch: <id>)` — there is no second column.

**Why:** the exception schema has a single punchLogId; the overlap detector
(`server/punchValidation.ts`, PunchOverlapInfo.conflictingPunchId) surfaces the
neighbour, and `server/services/punchOverlap.ts` writes it into the reason string.

**How to apply:** to load both punches (e.g. the manager review queue side-by-side
view), use `parseConflictingPunchId(reason)` from `server/services/punchOverlap.ts`
to recover the conflicting id, then `storage.getPunchLog(id)` for each. If you ever
add a real column for the conflicting punch, keep the parser as a fallback for
historical rows.
