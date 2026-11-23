/**
 * "Approaching weekly overtime" warning.
 *
 * Emails the owner (every admin-role account's email — whatever address is set
 * on the admin account) and the employee's department manager(s) when an
 * employee's RUNNING weekly worked hours — including the shift they're currently
 * clocked into — reach a lead margin below the weekly overtime threshold
 * (default 15 minutes, i.e. 39:45 for a 40h threshold). The point is a heads-up
 * BEFORE overtime is incurred, so the employee can be sent home in time.
 *
 * Fires at most once per employee per workweek (a `overtime_warning` system
 * alert, keyed on the workweek start, is the dedup record and also surfaces the
 * warning in-app). Runs as the recurring `overtime-warning` job, so the
 * in-process scheduler evaluates it automatically.
 */
import { storage } from "../storage";
import { resolvePayCalcPolicy, workweekStartFor, round2 } from "../payrollEngine";
import { getEffectivePolicy } from "../policyEngine";
import { sendEmail } from "./email";
import { logger } from "../lib/logger";
import type { User } from "@shared/schema";

const WARNING_TYPE = "overtime_warning";

const DEFAULT_LEAD_MINUTES = 15;
// Assumed weekly OT threshold (hours) for an employee force-enrolled in the
// warning (overtimeWarningEnabled = true) whose policy sets no weekly threshold.
const DEFAULT_WEEKLY_OT_THRESHOLD = 40;

/**
 * The warning lead margin, in minutes. Configured on the operational company
 * (Rules & Controls → General); falls back to the OVERTIME_WARNING_LEAD_MINUTES
 * env var and finally 15 when no company value is set.
 */
async function resolveLeadMinutes(): Promise<number> {
  const op = await storage.getOperationalCompany();
  const stored = op?.overtimeWarningLeadMinutes;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) return stored;
  const env = Number(process.env.OVERTIME_WARNING_LEAD_MINUTES);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_LEAD_MINUTES;
}

function fmtHoursMinutes(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function employeeName(u: Pick<User, "firstName" | "lastName" | "email">): string {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "the employee";
}

/** Owner recipients: the email on every admin-role account. */
async function ownerEmails(allUsers: User[]): Promise<string[]> {
  return allUsers
    .filter((u) => u.role === "admin" && !u.deactivatedAt && u.email)
    .map((u) => u.email as string);
}

/** The employee's department manager(s)' emails (explicit department-manager links). */
async function managerEmails(employee: User): Promise<string[]> {
  const deptIds = await storage.getUserDepartmentIds(employee.id);
  const out = new Set<string>();
  for (const deptId of deptIds) {
    const links = await storage.getDepartmentManagers(deptId);
    for (const link of links) {
      if (link.userId === employee.id) continue;
      const mgr = await storage.getUser(link.userId);
      if (mgr && !mgr.deactivatedAt && mgr.email) out.add(mgr.email);
    }
  }
  return [...out];
}

function renderEmail(name: string, weekly: number, threshold: number, weekStart: string) {
  const subject = `Overtime warning: ${name} is nearing weekly overtime`;
  const lines = [
    `${name} has reached ${fmtHoursMinutes(weekly)} this workweek (starting ${weekStart}).`,
    `The weekly overtime threshold is ${fmtHoursMinutes(threshold)}.`,
    "",
    "They are about to go into overtime — consider ending their shift or adjusting the schedule if overtime isn't intended.",
    "",
    "— Ahava Medical Center",
  ];
  const text = lines.join("\n");
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#123047;line-height:1.5;">
      <p><strong>${escapeHtml(name)}</strong> has reached <strong>${fmtHoursMinutes(weekly)}</strong> this workweek (starting ${escapeHtml(weekStart)}).</p>
      <p>The weekly overtime threshold is <strong>${fmtHoursMinutes(threshold)}</strong>.</p>
      <p>They are about to go into overtime — consider ending their shift or adjusting the schedule if overtime isn't intended.</p>
      <p style="color:#6b7280;font-size:13px;">— Ahava Medical Center</p>
    </div>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

export interface OvertimeWarningResult {
  evaluated: number;
  warned: number;
  emailsSent: number;
  emailsFailed: number;
}

export async function runApproachingOvertimeWarnings(now: Date = new Date()): Promise<OvertimeWarningResult> {
  const today = now.toISOString().split("T")[0];
  const leadMin = await resolveLeadMinutes();
  const lead = leadMin / 60;
  const allUsers = await storage.getAllUsers();
  const owners = await ownerEmails(allUsers);

  // Per-employee overtime-warning override, keyed by user id:
  //   true  = always warn, false = never warn, null/undefined = follow policy.
  const overrideByUser = new Map<string, boolean | null>();
  for (const p of await storage.getAllEmploymentProfiles()) {
    overrideByUser.set(p.userId, p.overtimeWarningEnabled ?? null);
  }

  // Existing warnings this run, for weekly dedup (keyed on employee + weekStart).
  const existing = await storage.getAllSystemAlerts({ type: WARNING_TYPE });
  const alreadyWarned = new Set(
    existing.map((a) => `${a.employeeId}::${(a.details as any)?.weekStart ?? ""}`),
  );

  const result: OvertimeWarningResult = { evaluated: 0, warned: 0, emailsSent: 0, emailsFailed: 0 };

  for (const user of allUsers) {
    if (user.deactivatedAt) continue;

    // Per-employee override wins over the policy: FALSE never warns; TRUE always
    // warns (even when the policy doesn't auto-calc weekly OT — a 40h threshold is
    // assumed when the policy sets none); NULL follows the policy as before.
    const override = overrideByUser.get(user.id) ?? null;
    if (override === false) continue;

    const policy = await resolvePayCalcPolicy(user);
    let threshold = policy.otThresholdWeekly;
    if (override === true) {
      if (!threshold || threshold <= 0) threshold = DEFAULT_WEEKLY_OT_THRESHOLD;
    } else {
      // Default behaviour: only employees whose policy auto-calculates weekly OT.
      if (!policy.autoCalculateOT || !policy.weeklyOvertimeEnabled) continue;
      if (!threshold || threshold <= 0) continue;
    }
    const warnAt = threshold - lead;
    if (warnAt <= 0) continue;

    result.evaluated++;

    const weekStart = workweekStartFor(today, policy.workweekStartDay);
    const dedupKey = `${user.id}::${weekStart}`;
    if (alreadyWarned.has(dedupKey)) continue;

    // Running weekly worked hours INCLUDING the in-progress shift. The SQL
    // helper already extends an open punch to `now` and respects the
    // missing-punch / over-max rules, so a forgotten punch-out doesn't inflate
    // this toward a false overtime warning.
    const byDate = await storage.getDailyHoursByDateRange(weekStart, today, [user.id], now);
    const days = byDate.get(user.id) ?? [];
    const weekly = round2(days.reduce((sum, d) => sum + d.hours, 0));

    if (weekly < warnAt) continue;

    const attendancePolicy = await getEffectivePolicy(user.companyId, user.id, "attendance", user);
    const name = employeeName(user);

    // Record the warning first (dedup + in-app surfacing), then email.
    await storage.createSystemAlert({
      type: WARNING_TYPE,
      severity: "high",
      status: "open",
      employeeId: user.id,
      message: `${name} is nearing weekly overtime (${fmtHoursMinutes(weekly)} of ${fmtHoursMinutes(threshold)})`,
      details: {
        weekStart,
        weeklyHours: weekly,
        threshold,
        leadMinutes: leadMin,
        policyName: attendancePolicy?.policyName || "Default",
      },
    });
    alreadyWarned.add(dedupKey);
    result.warned++;

    const managers = await managerEmails(user);
    const recipients = [...new Set([...owners, ...managers])];
    if (recipients.length === 0) continue;

    const { subject, text, html } = renderEmail(name, weekly, threshold, weekStart);
    for (const to of recipients) {
      const sent = await sendEmail({ to, subject, text, html });
      if (sent.ok) result.emailsSent++;
      else {
        result.emailsFailed++;
        logger.warn("Overtime-warning email failed", { source: "overtime-warning", to, error: sent.error });
      }
    }
  }

  return result;
}
