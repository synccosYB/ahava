// Task #482: let employees clock out even when shifts overlap.
//
// A clock-out NEVER hard-blocks just because the closing punch overlaps another
// of the same employee's shifts (or because a second open punch somehow exists).
// Instead we record the close and raise a manager-facing "punch_overlap"
// attendance exception + a system alert so the duplicate/overlap can be
// reconciled from the admin punch tools / exception queue. The clock-out always
// succeeds — flagging must never be able to break it.

import { storage } from "../storage";
import type { PunchOverlapInfo } from "../punchValidation";

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Resolve the employee's local/business IANA timezone for rendering punch times
 * in rejection / flag messages. Prefers the employee's location timezone, then
 * the company timezone, then a sane default. Never throws — falls back to the
 * default on any lookup failure.
 */
export async function resolveEmployeeTimezone(userId: string): Promise<string> {
  try {
    const locationIds = await storage.getUserLocationIds(userId);
    for (const locId of locationIds) {
      const loc = await storage.getLocation(locId);
      if (loc?.timezone) return loc.timezone;
      if (loc?.companyId) {
        const company = await storage.getCompany(loc.companyId);
        if (company?.timezone) return company.timezone;
      }
    }
  } catch (err) {
    console.error("Timezone resolution failed; using default:", err);
  }
  return DEFAULT_TIMEZONE;
}

/**
 * Record a manager-facing exception + system alert for an overlap / duplicate
 * conflict detected while CLOSING a punch. Returns the created exception id (or
 * null on failure). Never throws — the clock-out has already succeeded by the
 * time this runs.
 */
export async function flagPunchOverlapForReconciliation(args: {
  userId: string;
  punchLogId: string;
  workDate: string;
  punchTime: Date;
  overlap: PunchOverlapInfo;
}): Promise<string | null> {
  try {
    const conflictNote = args.overlap.conflictingPunchId
      ? ` (conflicting punch: ${args.overlap.conflictingPunchId})`
      : "";
    const reason =
      `${args.overlap.reason} The clock-out was recorded so the employee isn't ` +
      `stuck clocked in — please review and void the duplicate or correct the ` +
      `overlapping shift.${conflictNote}`;

    const created = await storage.createAttendanceException({
      employeeId: args.userId,
      exceptionDate: args.workDate,
      exceptionTime: args.punchTime,
      type: "punch_overlap",
      reason,
      status: "pending",
    });

    // punchLogId is omitted from the insert schema (employees can't set it), so
    // link the just-closed punch in a follow-up update.
    if (created?.id) {
      await storage.updateAttendanceException(created.id, {
        punchLogId: args.punchLogId,
      });
    }

    await storage.createSystemAlert({
      type: "punch_overlap",
      severity: "medium",
      status: "open",
      employeeId: args.userId,
      message: reason,
      details: {
        punchLogId: args.punchLogId,
        conflictingPunchId: args.overlap.conflictingPunchId,
        kind: args.overlap.kind,
        workDate: args.workDate,
      },
    });

    return created?.id ?? null;
  } catch (err) {
    console.error("Punch-overlap flagging failed (clock-out still succeeded):", err);
    return null;
  }
}
