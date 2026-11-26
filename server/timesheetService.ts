import type { PunchLog, TimeOffRequest, User } from "@shared/schema";
import { storage } from "./storage";
import { punchWorkedHours } from "./workedHours";
import { DEFAULT_ATTENDANCE_RULES, getEffectivePolicy } from "./policyEngine";
import { resolvePayCalcPolicy } from "./payrollEngine";
import { getLedgerForEmployee, summarizeLedger, type LedgerDay } from "./attendanceLedger";
import { MISSING_CLOCKOUT_STATUS, MISSING_CLOCKIN_STATUS, openPunchExceedsMaxShift } from "./punchHours";
import { evaluateDayOfWeekBonusesCombined } from "./services/policyEnforcement";

export type TimesheetStatus =
  | "complete"
  | "in_progress"
  | "missing_punch"
  | "overtime"
  | "pto"
  // Confirmation-only (fixed-salary / daily-rate) employees: the clock is a
  // daily "present" marker, hours are not counted, and a day with any punch is
  // never a missing/open punch. Rendered as "Attendance captured".
  | "confirmation"
  // A single day whose build threw — surfaced as a flagged row so one bad
  // legacy record can never blank the whole timesheet (the server logs which).
  | "error"
  | "none";

// One worked shift within a day. A day where the employee clocked out and back
// in with a gap LONGER than SHIFT_SPLIT_THRESHOLD_MIN is shown as two (or more)
// of these — a separate line per shift, same date — instead of a single row
// with a long break. A shorter gap (an ordinary lunch) stays folded into one
// shift's `breakMinutes`. Display only: the day's totalHours/overtime/pay (which
// come from the ledger) are unchanged whether or not the day is shown split.
export interface TimesheetSegment {
  clockIn: string | null;
  clockOut: string | null;
  // Short gaps (<= threshold) folded into this shift, in minutes.
  breakMinutes: number;
  // Worked hours for this shift (sum of its punch pairs). Reference value for
  // attendance-only employees; for everyone else the shifts sum to the day.
  hours: number;
  // The punch records whose clock-in / clock-out bound this shift, so the inline
  // editor can edit the right punch when the day is shown as separate shifts.
  clockInPunchId: string | null;
  clockOutPunchId: string | null;
  // In-shift breaks taken by clocking OUT and back IN (a folded gap <= threshold):
  // the clock-out time that BEGAN the break and the clock-in time that ENDED it.
  // Empty when the only break was recorded as a bare duration (the in-app break
  // button, which stores no times) or when there was no break.
  breaks: { start: string; end: string; minutes: number }[];
}

export interface TimesheetEntry {
  date: string;
  dayOfWeek: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  // Per-shift breakdown of the day (see TimesheetSegment). Present only when the
  // day has at least one completed punch pair; the UI shows separate lines when
  // there is more than one shift, and otherwise renders the single day row.
  segments?: TimesheetSegment[];
  totalHours: number | null;
  // Worked hours shown for REFERENCE only when totalHours is not the pay basis
  // (attendance/confirmation-only employees are paid per day, not per hour). The
  // reviewer can still see how long the person was clocked in. null otherwise.
  referenceHours: number | null;
  overtimeHours: number;
  status: TimesheetStatus;
  ptoType: string | null;
  // Day-of-week bonus MONEY earned on this day (e.g. a $20 Sunday bonus), from
  // the employee's effective payroll policy plus their personal per-employee
  // bonuses, combined. 0 when none apply. Same engine the payroll export pays,
  // so the timesheet's bonus total matches the payroll report. Pay-sensitive —
  // the route strips it for viewers without pay access.
  bonusAmount: number;
  // Source attribution: the kiosk the punch came from, when any of the
  // day's punches were captured at a registered kiosk. `null` means a
  // web/manager-entered punch (or no punches at all on that day).
  sources: Array<{ kioskDeviceId: string | null; kioskName: string | null; kiosk: { id: string; name: string } | null }>;
  // True when this "Missing Punch" day is a split clock-in-only + clock-out-only
  // pair that can be merged into one shift via POST /api/attendance/punches/merge-day.
  canMerge?: boolean;
}

export interface TimesheetTotals {
  totalHours: number;
  overtimeHours: number;
  daysWorked: number;
  // Sum of per-day day-of-week bonus money over the range (e.g. two $20 Sundays
  // → $40). Matches the bonuses the payroll report pays for the same range.
  totalBonus: number;
}

export interface TimesheetResult {
  otThresholdDaily: number;
  entries: TimesheetEntry[];
  totals: TimesheetTotals;
  // True when this employee is paid by the DAY (daily salary) or is
  // attendance/confirmation-only — for them the review UI emphasizes DAYS worked
  // over hours (hours aren't the pay basis).
  emphasizeDays: boolean;
  // True when a long date range skipped the weekly-overtime ledger for speed:
  // day/total hours are exact but the OT split is omitted. The UI notes this.
  coarseHours?: boolean;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A gap between clocking out and back in that exceeds this many minutes splits
// the day into separate shifts (a new line, same date); a shorter gap is an
// ordinary lunch, folded into the shift's break. 60 min per the Ahava rule.
const SHIFT_SPLIT_THRESHOLD_MIN = 60;

/**
 * Single per-punch worked-hours input, shared by the timesheet and the time
 * report. This is the SAME canonical, break-deducted value payroll consumes:
 * the persisted `hours_worked` (set at clock-out via the engine and by
 * `computePunchHoursWorked`). Only a still-open punch (no stored value yet)
 * falls back to a live, break-deducted compute mirroring `storage.clockOut` and
 * `storage.getDailyHoursByDateRange`, so no surface can drift on break
 * deductions or rounding.
 */
/**
 * Worked hours for a single day's punches (break-deducted, via punchWorkedHours).
 */
function computeDayHours(
  punches: PunchLog[],
  now: Date = new Date(),
  maxShiftHours: number = DEFAULT_ATTENDANCE_RULES.maxShiftHours,
): number {
  let hours = 0;
  for (const p of punches) {
    hours += punchWorkedHours(p, now, maxShiftHours);
  }
  return hours;
}

/**
 * Aggregate-only variant used by the time report. Returns the same totals the
 * /api/reports/generate endpoint would produce for one employee. Sharing this
 * helper (and punchWorkedHours) guarantees the per-employee timesheet totals
 * match the time report AND the payroll batch worked-hours input.
 */
export function computeAttendanceTotals(
  punches: PunchLog[],
  now: Date = new Date(),
  maxShiftHours: number = DEFAULT_ATTENDANCE_RULES.maxShiftHours,
): { totalHours: number; daysWorked: number } {
  const daysWorked = new Set<string>();
  let totalHours = 0;
  for (const p of punches) {
    if (!p.clockIn) continue;
    totalHours += punchWorkedHours(p, now, maxShiftHours);
    daysWorked.add(p.workDate);
  }
  return { totalHours, daysWorked: daysWorked.size };
}

// Re-export the canonical per-punch hours-worked computation so callers can
// treat timesheetService as the single hours-engine entry point.
export { computePunchHoursWorked } from "./punchHours";

/**
 * Build a per-day timesheet for an employee over a date range, plus aggregate
 * totals. Both the per-day overtime and the aggregate overtime are produced by
 * the single authoritative pay engine (`resolvePayCalcPolicy` + `splitDailyHours`),
 * so the timesheet honors the full effective policy — daily OT threshold, the
 * payroll OT/double-time toggles, and the holiday-OT-exclusion rule — and never
 * disagrees with the time report, payroll batch, or reconciliation.
 *
 * The timesheet shows a single "Overtime" column, so per-day overtime here is
 * OT + double-time combined (i.e. all hours over the daily OT threshold, unless
 * the day is an excluded holiday). Aggregate overtime is the per-day overtime
 * summed — NOT the old "totalHours - daysWorked * 8" approximation (which let a
 * long day net against a short day).
 */
export async function buildEmployeeTimesheet(
  employee: User,
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): Promise<TimesheetResult> {
  const punches = await storage.getAttendanceRecords(employee.id, startDate, endDate);
  const allTimeOff = await storage.getTimeOffRequestsByUser(employee.id);
  const approvedTimeOff = allTimeOff.filter((r) =>
    (r.status === "approved" || r.status === "partially_approved") &&
    r.requestCategory !== "cashout" &&
    r.startDate <= endDate &&
    ((r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate) >= startDate),
  );

  // Hours/OT come from THE attendance ledger — the single, persisted
  // materialization of the pay engine (resolvePayCalcPolicy + splitDailyHours
  // per day, including the daily OT threshold, OT/double-time toggles and the
  // holiday-OT-exclusion rule). The timesheet adds ONLY display fields
  // (clock-in/out, break, kiosk sources) from the raw punches; it derives no
  // attendance/OT math of its own, so it can never disagree with reports,
  // payroll or the dashboards (which read the same ledger).
  const payCalc = await resolvePayCalcPolicy(employee);
  const otThreshold = payCalc.otThresholdDaily ?? DEFAULT_ATTENDANCE_RULES.otThresholdDaily;
  // Confirmation-only (attendance-only) employees: any day with a punch is
  // "Attendance captured" — hours aren't counted and it is NEVER a missing or
  // in-progress punch, whatever shape the underlying punches take (a proper
  // 0-hour confirmation marker, or legacy open clock-ins recorded before the
  // toggle was set).
  const confirmationOnly = await storage.isClockConfirmationOnly(employee.id);
  const attendancePolicy = await getEffectivePolicy(employee.companyId, employee.id, "attendance", employee);
  const maxShiftHours = attendancePolicy?.rules?.maxShiftHours ?? DEFAULT_ATTENDANCE_RULES.maxShiftHours;
  // The recompute-through ledger (weekly-aware OT split + persistence) runs ONCE
  // here, outside the per-day guard below. It is a payroll-accuracy mechanism for
  // pay periods; for a LONG browsing range (e.g. "Past 3 months", "This year",
  // "Last 12 months") rebuilding + persisting every day in one request is heavy
  // and can time out for employees with dense data. So:
  //   • short ranges (pay periods / a month) → full ledger (exact OT, as before);
  //   • long ranges → SKIP it and compute each day's hours directly in the loop
  //     (computeDayHours). Hours stay correct; the OT split is omitted for the
  //     overview (payroll always uses the exact pay-period path). `coarseHours`
  //     is returned so the UI can say so.
  // On failure (a corrupt ledger/policy/schedule row for one employee) we also
  // fall back to direct per-day computation rather than 500 the whole sheet.
  const LEDGER_RANGE_MAX_DAYS = 45;
  const rangeDays =
    Math.round(
      (new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) / 86_400_000,
    ) + 1;
  let ledgerDays: LedgerDay[] = [];
  let ledgerSkipped = rangeDays > LEDGER_RANGE_MAX_DAYS;
  if (!ledgerSkipped) {
    try {
      ledgerDays = await getLedgerForEmployee(employee, startDate, endDate, now);
    } catch (err) {
      console.error(
        `[timesheet] ledger build failed for employee ${employee.id} ${startDate}..${endDate}; falling back to per-day computation:`,
        err,
      );
    }
  }
  const ledgerByDate = new Map<string, LedgerDay>(ledgerDays.map((d) => [d.workDate, d]));

  // Day-of-week bonuses (e.g. a Sunday bonus) earned over the range. Uses the
  // employee's effective payroll policy rules (which already compose any
  // per-employee rule overrides) plus their personal per-employee bonuses —
  // the SAME combined engine the payroll export pays — so the timesheet's bonus
  // total matches the payroll report.
  const payrollPolicy = await getEffectivePolicy(employee.companyId, employee.id, "payroll", employee);
  const payrollRules = (payrollPolicy?.rules as Record<string, any>) ?? {};
  const employeeProfile = await storage.getEmploymentProfile(employee.id);
  const employeeBonuses = employeeProfile?.dayOfWeekBonuses ?? [];
  let totalBonus = 0;

  const punchesByDate = new Map<string, PunchLog[]>();
  for (const p of punches) {
    const arr = punchesByDate.get(p.workDate) || [];
    arr.push(p);
    punchesByDate.set(p.workDate, arr);
  }

  // Resolve kiosk device names once per range so the per-day rows can show
  // the source (e.g., "Lobby Kiosk") without N round trips.
  const kioskIds = new Set<string>();
  for (const p of punches) {
    if (p.kioskDeviceId) kioskIds.add(p.kioskDeviceId);
  }
  const kioskNameById = new Map<string, string>();
  for (const id of Array.from(kioskIds)) {
    const d = await storage.getKioskDevice(id);
    if (d) kioskNameById.set(id, d.name);
  }

  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  const entries: TimesheetEntry[] = [];
  // Running totals summed straight from the per-day rows. Used when the ledger
  // is absent (long range skipped, or a failed build) so the totals row always
  // matches the visible day hours instead of showing 0.
  let coarseTotalHours = 0;
  let coarseOvertime = 0;
  const coarseDaysWorked = new Set<string>();

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateStr = cursor.toISOString().split("T")[0];
    const dayOfWeek = DAY_NAMES[cursor.getUTCDay()];
    try {
    const datePunches = punchesByDate.get(dateStr) || [];
    const ptoForDay = approvedTimeOff.filter((r) => {
      const effectiveEnd = r.status === "partially_approved" && r.approvedEndDate ? r.approvedEndDate : r.endDate;
      return r.startDate <= dateStr && effectiveEnd >= dateStr;
    });

    // Per-day source attribution (dedup by kiosk id; null → manual/web).
    const sourcesForDay = (() => {
      if (!datePunches.length) return [] as TimesheetEntry["sources"];
      const seen = new Set<string>();
      const out: TimesheetEntry["sources"] = [];
      for (const p of datePunches) {
        const key = p.kioskDeviceId ?? "__manual__";
        if (seen.has(key)) continue;
        seen.add(key);
        const name = p.kioskDeviceId ? (kioskNameById.get(p.kioskDeviceId) ?? null) : null;
        out.push({
          kioskDeviceId: p.kioskDeviceId ?? null,
          kioskName: name,
          kiosk: p.kioskDeviceId && name ? { id: p.kioskDeviceId, name } : null,
        });
      }
      return out;
    })();

    if (datePunches.length > 0) {
      let firstIn: Date | null = null;
      let lastOut: Date | null = null;
      let breakMin = 0;
      let inProgress = false;
      let missingPunch = false;
      // Merge detection: a day split into a clock-in-only + clock-out-only pair
      // (the back-fill-while-open glitch) can be collapsed into one shift.
      let realInCount = 0;
      let realOutCount = 0;
      let hasCompletePunch = false;
      for (const p of datePunches) {
        if (p.clockIn) {
          realInCount++;
          const t = new Date(p.clockIn);
          if (!firstIn || t < firstIn) firstIn = t;
        }
        if (p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS) realOutCount++;
        if (
          p.clockIn && p.clockOut &&
          p.status !== MISSING_CLOCKOUT_STATUS && p.status !== MISSING_CLOCKIN_STATUS &&
          (p.hoursWorked ?? 0) > 0
        ) {
          hasCompletePunch = true;
        }
        // A marked missing-clock-out punch carries only a PLACEHOLDER clock-out
        // (set to free the one-open-punch slot); it is not a real punch-out, so
        // it must never show as the day's clock-out time — the day reads blank.
        if (p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS) {
          const t = new Date(p.clockOut);
          if (!lastOut || t > lastOut) lastOut = t;
        }
        breakMin += p.breakMinutes || 0;
        if (p.status === MISSING_CLOCKOUT_STATUS || openPunchExceedsMaxShift(p, now, maxShiftHours)) {
          // Forgotten punch-out (marked, or open past the max shift): a missing
          // punch, NOT an in-progress shift — it no longer accrues hours.
          missingPunch = true;
        } else if (p.status === MISSING_CLOCKIN_STATUS || (p.clockOut && !p.clockIn)) {
          // Clock-out only (forgot to clock in): a missing punch, not in-progress.
          missingPunch = true;
        } else if (p.status === "in-progress") {
          inProgress = true;
        } else if (p.clockIn && !p.clockOut && !p.hoursWorked) {
          missingPunch = true;
        }
      }

      // At Ahava a lunch/break is taken by clocking OUT and back IN, so the real
      // break for the day is the time spent clocked out BETWEEN punches (the gap
      // from one punch-out to the next punch-in) — not the per-punch breakMinutes
      // field (which stays 0 for ordinary punch pairs). Add that gap time so a
      // normal out-for-lunch / back-in day shows its break length (e.g. 30 min),
      // on top of any explicit within-punch break already summed above.
      const completedForGaps = datePunches
        .filter((p) => p.clockIn && p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS)
        .map((p) => ({
          inMs: new Date(p.clockIn as unknown as string).getTime(),
          outMs: new Date(p.clockOut as unknown as string).getTime(),
        }))
        .sort((a, b) => a.inMs - b.inMs);
      let gapMinutes = 0;
      for (let i = 0; i < completedForGaps.length - 1; i++) {
        const gapMs = completedForGaps[i + 1].inMs - completedForGaps[i].outMs;
        if (gapMs > 0) gapMinutes += gapMs / 60000;
      }
      breakMin += Math.round(gapMinutes);

      // Per-shift segments: group the day's completed punch pairs into shifts,
      // starting a NEW shift whenever the gap from the previous punch-out to the
      // next punch-in exceeds the split threshold (an ordinary lunch stays folded
      // into the shift's break). Each segment carries the punch ids that bound it
      // so the inline editor can target the right punch. Display only — the day's
      // ledger hours/OT/pay are unchanged.
      const completedPairs = datePunches
        .filter((p) => p.clockIn && p.clockOut && p.status !== MISSING_CLOCKOUT_STATUS)
        .map((p) => ({
          id: p.id,
          inMs: new Date(p.clockIn as unknown as string).getTime(),
          inIso: new Date(p.clockIn as unknown as string).toISOString(),
          outIso: new Date(p.clockOut as unknown as string).toISOString(),
          hours: punchWorkedHours(p, now, maxShiftHours),
        }))
        .sort((a, b) => a.inMs - b.inMs);

      let segments: TimesheetSegment[] | undefined;
      if (completedPairs.length > 0) {
        segments = [];
        let cur: {
          clockInIso: string; clockOutIso: string; breakMin: number; hours: number;
          inId: string; outId: string; lastOutMs: number; lastOutIso: string;
          breaks: { start: string; end: string; minutes: number }[];
        } | null = null;
        for (const pair of completedPairs) {
          const outMs = new Date(pair.outIso).getTime();
          if (cur && pair.inMs - cur.lastOutMs <= SHIFT_SPLIT_THRESHOLD_MIN * 60000) {
            // Short gap → same shift: fold the lunch into this shift's break AND
            // record WHEN it happened (clock-out that began it → clock-in that
            // ended it) so the timesheet can show Break Start / Break End times.
            const gap = pair.inMs - cur.lastOutMs;
            if (gap > 0) {
              const minutes = Math.round(gap / 60000);
              cur.breakMin += minutes;
              cur.breaks.push({ start: cur.lastOutIso, end: pair.inIso, minutes });
            }
            cur.clockOutIso = pair.outIso;
            cur.outId = pair.id;
            cur.hours += pair.hours;
            cur.lastOutMs = outMs;
            cur.lastOutIso = pair.outIso;
          } else {
            if (cur) {
              segments.push({
                clockIn: cur.clockInIso, clockOut: cur.clockOutIso,
                breakMinutes: cur.breakMin, hours: Math.round(cur.hours * 100) / 100,
                clockInPunchId: cur.inId, clockOutPunchId: cur.outId, breaks: cur.breaks,
              });
            }
            cur = {
              clockInIso: pair.inIso, clockOutIso: pair.outIso, breakMin: 0, hours: pair.hours,
              inId: pair.id, outId: pair.id, lastOutMs: outMs, lastOutIso: pair.outIso, breaks: [],
            };
          }
        }
        if (cur) {
          segments.push({
            clockIn: cur.clockInIso, clockOut: cur.clockOutIso,
            breakMinutes: cur.breakMin, hours: Math.round(cur.hours * 100) / 100,
            clockInPunchId: cur.inId, clockOutPunchId: cur.outId, breaks: cur.breaks,
          });
        }
      }

      // Hours + combined overtime come straight from the ledger row for this
      // day (the materialized engine split). Fall back to the raw worked-hours
      // sum only for a zero/edge day the ledger doesn't persist a row for.
      const ledgerDay = ledgerByDate.get(dateStr);
      const roundedHours = ledgerDay
        ? ledgerDay.totalHours
        : Math.round(computeDayHours(datePunches, now, maxShiftHours) * 100) / 100;
      // The timesheet's one "Overtime" column shows OT + double-time combined;
      // holidayOtExclusion (when set) already zeroed these in the ledger.
      const dayOvertime = ledgerDay
        ? Math.round((ledgerDay.overtimeHours + ledgerDay.doubleTimeHours) * 100) / 100
        : 0;

      let status: TimesheetStatus;
      if (confirmationOnly) status = "confirmation";
      else if (inProgress) status = "in_progress";
      else if (missingPunch) status = "missing_punch";
      else if (ledgerDay?.status === "overtime") status = "overtime";
      else status = "complete";

      // Day-of-week bonus money for this worked day (policy + personal bonuses),
      // keyed off the day's worked hours for the min-hours threshold.
      const dayBonus = evaluateDayOfWeekBonusesCombined(dateStr, roundedHours, payrollRules, employeeBonuses).bonusAmount;
      totalBonus += dayBonus;

      // Accumulate the display totals from each worked day (for the ledger-absent
      // path). Attendance-only days don't count toward pay totals.
      if (!confirmationOnly) {
        coarseTotalHours += roundedHours;
        if (!inProgress) coarseOvertime += dayOvertime;
        if (roundedHours > 0) coarseDaysWorked.add(dateStr);
      }

      const entry: TimesheetEntry = {
        date: dateStr,
        dayOfWeek,
        clockIn: firstIn ? firstIn.toISOString() : null,
        // Show the real clock-out time even for attendance-only employees, so the
        // reviewer can see when they left (reference, not pay).
        clockOut: lastOut ? lastOut.toISOString() : null,
        breakMinutes: breakMin,
        // Hours are not the pay basis for attendance-only employees — keep
        // totalHours null (so pay/totals are unaffected) but expose the worked
        // hours as referenceHours so they still show on the timesheet.
        totalHours: confirmationOnly ? null : roundedHours,
        referenceHours: confirmationOnly ? roundedHours : null,
        overtimeHours: confirmationOnly || inProgress ? 0 : dayOvertime,
        status,
        ptoType: null,
        bonusAmount: Math.round(dayBonus * 100) / 100,
        sources: sourcesForDay,
        // Offer "merge into one shift" when the day is a split clock-in-only +
        // clock-out-only pair (no complete shift) that can be collapsed into one.
        ...(missingPunch && !hasCompletePunch && datePunches.length >= 2 && realInCount >= 1 && realOutCount >= 1
          ? { canMerge: true }
          : {}),
        ...(segments && segments.length > 0 ? { segments } : {}),
      };
      entries.push(entry);
    } else if (ptoForDay.length > 0) {
      const primary = ptoForDay[0];
      entries.push({
        date: dateStr,
        dayOfWeek,
        clockIn: null,
        clockOut: null,
        breakMinutes: 0,
        totalHours: null,
        referenceHours: null,
        overtimeHours: 0,
        status: "pto",
        ptoType: primary.type,
        bonusAmount: 0,
        sources: [],
      });
    } else {
      entries.push({
        date: dateStr,
        dayOfWeek,
        clockIn: null,
        clockOut: null,
        breakMinutes: 0,
        totalHours: null,
        referenceHours: null,
        overtimeHours: 0,
        status: "none",
        ptoType: null,
        bonusAmount: 0,
        sources: [],
      });
    }
    } catch (dayErr) {
      // One malformed day must NEVER blank the whole timesheet. Log it with the
      // employee + date + punch ids (so the bad record can be found and cleaned
      // up), then surface that single day as a flagged "error" row and carry on.
      const dayPunchIds = (punchesByDate.get(dateStr) || []).map((p) => p.id);
      console.error(
        `[timesheet] failed to build day ${dateStr} for employee ${employee.id} ` +
        `(punch ids: ${dayPunchIds.join(", ") || "none"}):`,
        dayErr,
      );
      entries.push({
        date: dateStr,
        dayOfWeek,
        clockIn: null,
        clockOut: null,
        breakMinutes: 0,
        totalHours: null,
        referenceHours: null,
        overtimeHours: 0,
        status: "error",
        ptoType: null,
        bonusAmount: 0,
        sources: [],
      });
    }
  }

  // Range totals come straight from the ledger summary (the single source), so
  // the totals row matches the time report and payroll exactly. The ledger is
  // now WEEKLY-AWARE (built via payrollEngine.computeWeeklyHours), so each day's
  // OT+double-time already includes weekly overtime — no separate weekly pass is
  // needed here, and per-day rows + totals stay in lockstep with reports/payroll.
  const ledgerTotals = summarizeLedger(ledgerDays);
  // Use the per-day sums whenever the ledger isn't available (long range skipped,
  // or an empty/failed build) so the totals never read 0 against non-zero rows.
  const useCoarse = ledgerSkipped || ledgerDays.length === 0;

  // For an attendance-only employee hours aren't counted, so the ledger's
  // hours-based "days worked" is 0. Count days PRESENT instead (every
  // "Attendance captured" day) so the summary reflects attendance, not hours.
  const daysWorked = confirmationOnly
    ? entries.filter((e) => e.status === "confirmation").length
    : useCoarse ? coarseDaysWorked.size : ledgerTotals.daysWorked;

  return {
    otThresholdDaily: otThreshold,
    entries,
    totals: {
      // Round to hundredths — the SAME precision as the per-day rows (which show
      // ledger day hours to the minute) and as payroll (round2). Rounding the
      // total to tenths (1/10 h) made it read up to ~3 min higher than the sum of
      // the visible days and than actual pay (e.g. an 8h02m day nets 7h17m but the
      // total showed 7h18m), so the totals row never added up.
      totalHours: Math.round((useCoarse ? coarseTotalHours : ledgerTotals.totalHours) * 100) / 100,
      overtimeHours: Math.round((useCoarse ? coarseOvertime : ledgerTotals.overtimeCombined) * 100) / 100,
      daysWorked,
      totalBonus: Math.round(totalBonus * 100) / 100,
    },
    emphasizeDays: confirmationOnly || employeeProfile?.payType === "daily",
    // True only when the heavy ledger was intentionally skipped for a long range
    // (hours exact, OT split omitted) — the UI shows a note. Not set for a failed
    // build, which is an error path, not a user-chosen overview.
    coarseHours: ledgerSkipped,
  };
}
