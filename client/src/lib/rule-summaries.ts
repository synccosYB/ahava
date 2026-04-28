import type {
  Workflow,
  RoleAssignmentRule,
  ScheduleTemplateDay,
} from "@shared/schema";

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function plural(n: number, one: string, many?: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many ?? one + "s"}`;
}

function formatTime(t?: string): string {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return t;
  }
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatMoney(n: number): string {
  if (Number.isInteger(n)) return `$${n}`;
  return `$${n.toFixed(2)}`;
}

// ============== Policy summarizers ==============

export function summarizeAttendancePolicy(rules: Record<string, any>): string[] {
  const out: string[] = [];
  if (!rules || Object.keys(rules).length === 0) return out;

  const grace = Number(rules.gracePeriodMinutes);
  if (Number.isFinite(grace)) {
    out.push(grace === 0 ? "Late immediately when past start time." : `Late after ${grace} minute${grace === 1 ? "" : "s"} past start.`);
  }
  const auto = Number(rules.autoClockOutHours);
  if (Number.isFinite(auto)) {
    out.push(`Auto clocks out after ${auto} hour${auto === 1 ? "" : "s"}.`);
  }
  if (rules.allowEarlyClockIn === false) {
    out.push("Early clock-in not allowed.");
  } else if (rules.allowEarlyClockIn !== undefined) {
    const win = Number(rules.earlyClockInMinutes);
    if (Number.isFinite(win)) {
      out.push(`Allows clock-in up to ${win} minute${win === 1 ? "" : "s"} early.`);
    }
  }
  const round = Number(rules.roundingIntervalMinutes);
  if (Number.isFinite(round) && round > 0) {
    out.push(`Times rounded to the nearest ${round} minutes.`);
  }
  const breakAfter = Number(rules.requireBreakAfterHours);
  const breakDur = Number(rules.breakDurationMinutes);
  if (Number.isFinite(breakAfter) && Number.isFinite(breakDur)) {
    out.push(`Requires a ${breakDur}-minute break after ${breakAfter} hour${breakAfter === 1 ? "" : "s"} worked.`);
  }
  if (rules.requirePhotoVerification === true) {
    out.push("Requires photo verification at clock-in/out.");
  } else if (rules.requirePhotoVerification === false) {
    out.push("No photo required.");
  }
  return out;
}

export function summarizePtoPolicy(rules: Record<string, any>): string[] {
  const out: string[] = [];
  if (!rules || Object.keys(rules).length === 0) return out;

  const accrualType = String(rules.accrualType || "");
  const accrualHours = Number(rules.accrualHoursPerYear);
  if (Number.isFinite(accrualHours)) {
    const period =
      accrualType === "monthly" ? "per month"
      : accrualType === "per_pay_period" ? "per pay period"
      : "per year";
    out.push(`Accrues ${accrualHours} hour${accrualHours === 1 ? "" : "s"} ${period}.`);
  }
  const reqApproval = rules.requireApproval;
  const reqNotice = rules.requireAdvanceNotice;
  const noticeDays = Number(rules.advanceNoticeDays);
  if (reqApproval === true && reqNotice === true && Number.isFinite(noticeDays)) {
    out.push(`Requires manager approval and ${noticeDays} day${noticeDays === 1 ? "" : "s"} advance notice.`);
  } else if (reqApproval === true) {
    out.push("Requires manager approval.");
  } else if (reqApproval === false) {
    out.push("Auto-approved (no manager sign-off).");
  } else if (reqNotice === true && Number.isFinite(noticeDays)) {
    out.push(`Requires ${noticeDays} day${noticeDays === 1 ? "" : "s"} advance notice.`);
  }
  const maxConsec = Number(rules.maxConsecutiveHours);
  if (Number.isFinite(maxConsec)) {
    out.push(`Up to ${maxConsec} consecutive hour${maxConsec === 1 ? "" : "s"} at a time.`);
  }
  const carry = Number(rules.carryoverCapHours);
  if (Number.isFinite(carry)) {
    out.push(carry === 0 ? "No carryover." : `Up to ${carry} hour${carry === 1 ? "" : "s"} carry over to next year.`);
  }
  if (rules.blackoutDatesEnabled === true) {
    out.push("Blackout dates enforced.");
  }
  return out;
}

export function summarizePayrollPolicy(rules: Record<string, any>): string[] {
  const out: string[] = [];
  if (!rules || Object.keys(rules).length === 0) return out;

  const period = String(rules.payPeriodType || "");
  const periodLabel: Record<string, string> = {
    weekly: "Weekly pay",
    biweekly: "Biweekly pay",
    semimonthly: "Semi-monthly pay",
    monthly: "Monthly pay",
  };
  if (periodLabel[period]) {
    let line = periodLabel[period];
    const payday = String(rules.payDayOfWeek || "").toLowerCase();
    const dayIndex = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(payday);
    if ((period === "weekly" || period === "biweekly") && dayIndex >= 0) {
      line += `, paid on ${DAY_FULL[dayIndex]}`;
    }
    out.push(line + ".");
  }

  // Treat missing on/off flags as `true` so legacy policies keep summarizing
  // exactly as they did before per-rule toggles existed.
  const overtimeEnabled = rules.overtimeEnabled !== false;
  const doubleTimeEnabled = rules.doubleTimeEnabled !== false;
  const otThresh = Number(rules.overtimeThresholdHours);
  const otMult = Number(rules.overtimeMultiplier);
  if (!overtimeEnabled) {
    out.push("Overtime: off.");
  } else if (Number.isFinite(otThresh) && Number.isFinite(otMult)) {
    out.push(`Overtime over ${otThresh} hrs/week at ${otMult}×.`);
  }
  const dotThresh = Number(rules.doubleOtThreshold);
  const dotMult = Number(rules.doubleTimeMultiplier);
  if (!doubleTimeEnabled) {
    out.push("Double-time: off.");
  } else if (Number.isFinite(dotThresh) && Number.isFinite(dotMult)) {
    out.push(`Double-time over ${dotThresh} hrs/day at ${dotMult}×.`);
  }
  if (rules.includeHolidayPay === false) {
    out.push("Holiday pay: off.");
  } else if (rules.includeHolidayPay === true) {
    out.push("Holiday pay included.");
  }
  if (rules.autoCalculateOT === false) {
    out.push("Auto-calculate overtime: off.");
  }

  if (Array.isArray(rules.dayOfWeekBonuses)) {
    for (const b of rules.dayOfWeekBonuses) {
      const day = DAY_FULL[Number(b?.dayOfWeek)] ?? `day ${b?.dayOfWeek}`;
      const thr = Number(b?.minHoursThreshold);
      const amt = Number(b?.bonusAmount);
      if (!Number.isFinite(thr) || !Number.isFinite(amt)) continue;
      const reward = b?.bonusType === "hours"
        ? `+${amt} hour${amt === 1 ? "" : "s"} paid`
        : `${formatMoney(amt)} bonus`;
      out.push(`${day} ≥ ${thr}h adds ${reward}.`);
    }
  }

  if (Array.isArray(rules.earlyArrivalBonuses)) {
    for (const b of rules.earlyArrivalBonuses) {
      const cutoff = formatTime(b?.cutoffTime);
      const perHour = Number(b?.bonusAmountPerHour);
      const thr = Number(b?.minHoursThreshold);
      if (!cutoff || !Number.isFinite(perHour)) continue;
      const days = Array.isArray(b?.daysOfWeek) && b.daysOfWeek.length > 0
        ? b.daysOfWeek.map((d: number) => DAY_SHORT[d] ?? String(d)).join(", ")
        : "any day";
      const scope = b?.applyScope === "before_cutoff" ? " (before cutoff only)" : "";
      const minPart = Number.isFinite(thr) && thr > 0 ? `, min ${thr}h shift` : "";
      out.push(`Clock-in before ${cutoff} on ${days} adds ${formatMoney(perHour)}/hr${minPart}${scope}.`);
    }
  }
  return out;
}

export function summarizeApprovalsPolicy(rules: Record<string, any>): string[] {
  const out: string[] = [];
  if (!rules || Object.keys(rules).length === 0) return out;

  if (rules.requireManagerApproval === true) {
    out.push("Requires manager approval on every request.");
  } else if (rules.requireManagerApproval === false) {
    out.push("Manager approval not required.");
  }
  const autoT = Number(rules.autoApproveThreshold);
  if (Number.isFinite(autoT) && autoT > 0) {
    out.push(`Auto-approves PTO requests of ${autoT} day${autoT === 1 ? "" : "s"} or shorter.`);
  }
  const esc = Number(rules.escalationHours);
  if (Number.isFinite(esc)) {
    out.push(`Escalates after ${esc} hour${esc === 1 ? "" : "s"} without a response.`);
  }
  if (rules.requireCommentOnDenial === true) {
    out.push("Reason required when denying.");
  }
  const notes: string[] = [];
  if (rules.notifyOnSubmission === true) notes.push("on submission");
  if (rules.notifyOnDecision === true) notes.push("on decision");
  if (notes.length > 0) {
    out.push(`Sends notifications ${notes.join(" and ")}.`);
  }
  return out;
}

export function summarizePolicy(typeKey: string | undefined, rules: Record<string, any> | null | undefined): string[] {
  const r = rules || {};
  switch (typeKey) {
    case "attendance": return summarizeAttendancePolicy(r);
    case "pto": return summarizePtoPolicy(r);
    case "payroll": return summarizePayrollPolicy(r);
    case "approvals": return summarizeApprovalsPolicy(r);
    default: return [];
  }
}

// ============== Workflow summarizer ==============

const TRIGGER_LABELS: Record<string, string> = {
  pto_request_submitted: "When a PTO request is submitted",
  late_arrival_detected: "When a late arrival is detected",
  attendance_exception: "When an attendance exception is filed",
  clock_out_missed: "When a clock-out is missed",
  overtime_threshold: "When the overtime threshold is reached",
};
const CONDITION_FIELD_LABELS: Record<string, string> = {
  hours_requested: "hours requested",
  employee_department: "employee department",
  employee_location: "employee location",
  late_count_month: "late arrivals this month",
  pto_balance: "PTO balance",
  overtime_hours: "overtime hours",
};
const CONDITION_OP_LABELS: Record<string, string> = {
  gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠",
};
const APPROVER_LABELS: Record<string, string> = {
  direct_manager: "the direct manager",
  hr: "HR",
  department_head: "the department head",
  admin: "an admin",
};
const ACTION_LABELS: Record<string, string> = {
  approve_request: "approves the request",
  deny_request: "denies the request",
  generate_alert: "generates an alert",
  generate_warning: "issues a written warning",
  update_balance: "updates the PTO balance",
};
const NOTIFICATION_LABELS: Record<string, string> = {
  email_manager: "the manager",
  email_hr: "HR",
  email_employee: "the employee",
  system_alert: "a system alert",
  email_payroll: "payroll",
};

type GraphNode = { id: string; data: { nodeType: string; [k: string]: any } };
type GraphEdge = { source: string; target: string; sourceHandle?: string | null };

function describeWorkflowNode(node: GraphNode): string {
  const data = node.data || {};
  const type = data.nodeType;
  if (type === "trigger") {
    return TRIGGER_LABELS[data.triggerEvent] || "an event occurs";
  }
  if (type === "condition") {
    const field = CONDITION_FIELD_LABELS[data.field] || data.field || "value";
    const op = CONDITION_OP_LABELS[data.operator] || data.operator || "?";
    const val = data.value ?? "?";
    return `if ${field} ${op} ${val}`;
  }
  if (type === "approval") {
    return `it goes to ${APPROVER_LABELS[data.approverRole] || "an approver"} for approval`;
  }
  if (type === "action") {
    return ACTION_LABELS[data.actionType] || "runs an action";
  }
  if (type === "notification") {
    return `notifies ${NOTIFICATION_LABELS[data.notificationType] || "stakeholders"}`;
  }
  return "";
}

export function summarizeWorkflow(
  nodeGraph: any,
  triggerType?: string | null,
): string[] {
  const nodes: GraphNode[] = Array.isArray(nodeGraph?.nodes) ? nodeGraph.nodes : [];
  const edges: GraphEdge[] = Array.isArray(nodeGraph?.edges) ? nodeGraph.edges : [];

  if (nodes.length === 0) {
    if (triggerType && TRIGGER_LABELS[triggerType]) {
      return [`${TRIGGER_LABELS[triggerType]}, but no steps are configured yet.`];
    }
    return ["No steps configured yet."];
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, number>();
  for (const n of nodes) incoming.set(n.id, 0);
  for (const e of edges) {
    incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
  }

  const triggerNodes = nodes.filter((n) => n.data?.nodeType === "trigger");
  const startNodes: GraphNode[] = triggerNodes.length > 0
    ? triggerNodes
    : nodes.filter((n) => (incoming.get(n.id) || 0) === 0);

  const sentences: string[] = [];
  const seenInPath = new Set<string>();

  function walk(nodeId: string, parts: string[], depth: number) {
    if (depth > 12) return;
    if (seenInPath.has(nodeId)) return;
    seenInPath.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) {
      seenInPath.delete(nodeId);
      return;
    }
    const desc = describeWorkflowNode(node);
    if (desc) parts.push(desc);

    const outgoing = edges.filter((e) => e.source === nodeId);
    if (outgoing.length === 0) {
      sentences.push(joinParts(parts) + ".");
    } else if (node.data?.nodeType === "condition" && outgoing.length > 1) {
      const yesEdge = outgoing.find((e) => e.sourceHandle === "yes");
      const noEdge = outgoing.find((e) => e.sourceHandle === "no");
      const others = outgoing.filter((e) => e !== yesEdge && e !== noEdge);
      if (yesEdge) {
        const branch = [...parts];
        branch[branch.length - 1] = (branch[branch.length - 1] || "") + " (yes)";
        walk(yesEdge.target, branch, depth + 1);
      }
      if (noEdge) {
        const branch = [...parts];
        branch[branch.length - 1] = (branch[branch.length - 1] || "") + " (no)";
        walk(noEdge.target, branch, depth + 1);
      }
      for (const o of others) walk(o.target, [...parts], depth + 1);
    } else {
      for (const o of outgoing) walk(o.target, [...parts], depth + 1);
    }
    seenInPath.delete(nodeId);
  }

  function joinParts(parts: string[]): string {
    if (parts.length === 0) return "";
    if (parts.length === 1) return capitalize(parts[0]);
    const head = capitalize(parts[0]);
    const tail = parts.slice(1).join(", then ");
    return `${head}, ${tail}`;
  }

  for (const start of startNodes) {
    walk(start.id, [], 0);
  }

  if (sentences.length === 0) {
    return nodes.map((n) => capitalize(describeWorkflowNode(n)) + ".").filter((s) => s.length > 1);
  }

  const unique = Array.from(new Set(sentences));
  return unique.slice(0, 4);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============== Auto Role Assignment summarizer ==============

const ROLE_FIELD_LABELS: Record<string, string> = {
  companyId: "Division",
  locationId: "Location",
  departmentId: "Department",
  employmentType: "Employment Type",
  payType: "Pay Type",
  overtimeEligible: "Overtime Eligible",
  holidayPayEnabled: "Holiday Pay Enabled",
};
const ROLE_OP_LABELS: Record<string, string> = {
  eq: "is", neq: "is not",
  in: "is one of", nin: "is not one of",
  exists: "is set", not_exists: "is not set",
};

function describeRoleCondition(c: any, idLookup?: (field: string, id: string) => string): string {
  const fieldLabel = ROLE_FIELD_LABELS[c.field] || c.field;
  const opLabel = ROLE_OP_LABELS[c.op] || c.op;
  if (c.op === "exists" || c.op === "not_exists") {
    return `${fieldLabel} ${opLabel}`;
  }
  let valueStr: string;
  if (Array.isArray(c.value)) {
    valueStr = c.value.map((v: any) => idLookup ? idLookup(c.field, String(v)) : String(v)).join(", ");
  } else if (typeof c.value === "boolean") {
    valueStr = c.value ? "yes" : "no";
  } else {
    const raw = String(c.value ?? "");
    valueStr = idLookup ? idLookup(c.field, raw) : raw;
  }
  return `${fieldLabel} ${opLabel} ${valueStr || "—"}`;
}

export function summarizeRoleRule(
  rule: RoleAssignmentRule,
  idLookup?: (field: string, id: string) => string,
): string[] {
  const cond = rule.conditions as any;
  const conditions: any[] = [];
  let combinator: "all" | "any" = "all";
  if (cond && Array.isArray(cond.all)) {
    conditions.push(...cond.all);
    combinator = "all";
  } else if (cond && Array.isArray(cond.any)) {
    conditions.push(...cond.any);
    combinator = "any";
  } else if (cond && cond.field) {
    conditions.push(cond);
  }
  if (conditions.length === 0) {
    return [`No conditions configured. Would always assign role ${rule.targetRole}.`];
  }
  const parts = conditions.filter((c) => c && c.field).map((c) => describeRoleCondition(c, idLookup));
  if (parts.length === 0) return [`Assigns role ${rule.targetRole}.`];
  const joiner = combinator === "any" ? " OR " : " AND ";
  const conditionText = parts.join(joiner);
  return [`If ${conditionText}, assign role ${rule.targetRole}.`];
}

// ============== Schedule template summarizer ==============

export function summarizeScheduleTemplate(
  days: ScheduleTemplateDay[] | undefined | null,
  linkedEmployeeCount?: number | null,
): string[] {
  const sorted = (days || []).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const work = sorted.filter((d) => d.isWorkDay);
  if (work.length === 0) {
    return ["No work days configured yet."];
  }

  const groups: { days: number[]; start: string; end: string }[] = [];
  for (const d of work) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.start === d.startTime &&
      last.end === d.endTime &&
      last.days[last.days.length - 1] === d.dayOfWeek - 1
    ) {
      last.days.push(d.dayOfWeek);
    } else {
      groups.push({ days: [d.dayOfWeek], start: d.startTime, end: d.endTime });
    }
  }

  const parts = groups.map((g) => {
    const range = g.days.length === 1
      ? DAY_SHORT[g.days[0]]
      : `${DAY_SHORT[g.days[0]]}–${DAY_SHORT[g.days[g.days.length - 1]]}`;
    return `${range} ${formatTime(g.start)}–${formatTime(g.end)}`;
  });

  const offDays = sorted.filter((d) => !d.isWorkDay).map((d) => DAY_SHORT[d.dayOfWeek]);
  const out: string[] = [parts.join(", ") + "."];
  if (offDays.length > 0 && offDays.length < 7) {
    out.push(`${offDays.join(", ")} off.`);
  }
  if (typeof linkedEmployeeCount === "number") {
    out.push(linkedEmployeeCount === 0
      ? "Not yet applied to any employees."
      : `Applies to ${plural(linkedEmployeeCount, "employee")}.`);
  }
  return out;
}

// ============== Required Documents summarizer ==============

const REQUIRED_DOC_LABELS: Record<string, string> = {
  w9: "W-9",
  i9: "I-9",
  direct_deposit: "Direct Deposit Authorization",
  emergency_contact: "Emergency Contact Form",
  handbook_ack: "Employee Handbook Acknowledgment",
};

export function summarizeRequiredDoc(rule: {
  documentType: string;
  scopeType: "global" | "company" | "location" | "department" | "employee";
  dueOffsetDays: number;
  isActive: boolean;
}, scopeLabel: string): string[] {
  const docLabel = REQUIRED_DOC_LABELS[rule.documentType] || rule.documentType;
  const audience = rule.scopeType === "global"
    ? "All employees"
    : scopeLabel.replace(/^[^:]+:\s*/, "") || "Selected employees";
  const due = Number(rule.dueOffsetDays);
  const duePart = !Number.isFinite(due) || due === 0
    ? "by their hire date"
    : due > 0
      ? `within ${due} day${due === 1 ? "" : "s"} of hire`
      : `${Math.abs(due)} day${Math.abs(due) === 1 ? "" : "s"} before hire`;
  const out = [`${audience} must submit a ${docLabel} ${duePart}.`];
  if (!rule.isActive) out.push("Currently inactive.");
  return out;
}

// ============== Lifecycle Templates summarizer ==============

interface LifecycleTaskLite {
  title: string;
  isRequired?: boolean;
  blocksDeactivation?: boolean | null;
}

export function summarizeLifecycleTemplate(
  tasks: LifecycleTaskLite[] | undefined | null,
  kind: "onboarding" | "offboarding",
): string[] {
  const list = tasks || [];
  if (list.length === 0) return ["No tasks added yet."];

  const verb = kind === "onboarding" ? "onboarding" : "offboarding";
  const titles = list.slice(0, 5).map((t) => t.title).filter(Boolean);
  const rest = list.length - titles.length;
  const titleList = titles.join(", ") + (rest > 0 ? `, +${rest} more` : "");
  const out = [`${plural(list.length, "task")} for ${verb}: ${titleList}.`];

  const required = list.filter((t) => t.isRequired).length;
  if (required > 0 && required < list.length) {
    out.push(`${required} required, ${list.length - required} optional.`);
  } else if (required === list.length && list.length > 1) {
    out.push("All tasks required.");
  }

  if (kind === "offboarding") {
    const blockers = list.filter((t) => t.blocksDeactivation).length;
    if (blockers > 0) {
      out.push(`${plural(blockers, "task")} block account deactivation until done.`);
    }
  }
  return out;
}

// ============== Workflow re-export helpers ==============

export type WorkflowSummaryInput = Pick<Workflow, "nodeGraph" | "triggerType">;
