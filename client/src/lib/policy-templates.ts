export interface PolicyTemplateSummaryItem {
  label: string;
  value: string;
}

export interface PolicyTemplate {
  id: string;
  title: string;
  description: string;
  suggestedName: string;
  suggestedDescription: string;
  rules: Record<string, any>;
  summary: PolicyTemplateSummaryItem[];
}

export const SCRATCH_TEMPLATE_ID = "__scratch__";

const ATTENDANCE_TEMPLATES: PolicyTemplate[] = [
  {
    id: "attendance-standard-hourly",
    title: "Standard Hourly Attendance",
    description: "Sensible defaults for most hourly teams: a small grace period and a long auto clock-out safety net.",
    suggestedName: "Standard Hourly Attendance",
    suggestedDescription: "Standard attendance rules for hourly employees with a 5-minute grace period.",
    rules: {
      gracePeriodMinutes: 5,
      autoClockOutHours: 16,
      requirePhotoVerification: false,
      allowEarlyClockIn: true,
      earlyClockInMinutes: 15,
      roundingIntervalMinutes: 15,
      requireBreakAfterHours: 6,
      breakDurationMinutes: 30,
    },
    summary: [
      { label: "Grace period", value: "5 min" },
      { label: "Auto clock-out", value: "16 hr" },
      { label: "Early clock-in", value: "15 min" },
    ],
  },
  {
    id: "attendance-strict",
    title: "Strict Attendance (no grace)",
    description: "Zero grace period, photo verification required, and no early clock-ins. Best for tightly run sites.",
    suggestedName: "Strict Attendance",
    suggestedDescription: "No grace period, photo verification on every punch, and no early clock-ins.",
    rules: {
      gracePeriodMinutes: 0,
      autoClockOutHours: 12,
      requirePhotoVerification: true,
      allowEarlyClockIn: false,
      earlyClockInMinutes: 0,
      roundingIntervalMinutes: 1,
      requireBreakAfterHours: 5,
      breakDurationMinutes: 30,
    },
    summary: [
      { label: "Grace period", value: "0 min" },
      { label: "Photo verification", value: "Required" },
      { label: "Auto clock-out", value: "12 hr" },
    ],
  },
  {
    id: "attendance-flexible",
    title: "Flexible / Lenient Attendance",
    description: "Generous grace period and a wide early clock-in window — well suited to office or salaried-leaning teams.",
    suggestedName: "Flexible Attendance",
    suggestedDescription: "Generous grace period and early clock-in window for flexible schedules.",
    rules: {
      gracePeriodMinutes: 15,
      autoClockOutHours: 18,
      requirePhotoVerification: false,
      allowEarlyClockIn: true,
      earlyClockInMinutes: 30,
      roundingIntervalMinutes: 15,
      requireBreakAfterHours: 8,
      breakDurationMinutes: 30,
    },
    summary: [
      { label: "Grace period", value: "15 min" },
      { label: "Early clock-in", value: "30 min" },
      { label: "Break after", value: "8 hr" },
    ],
  },
  {
    id: "attendance-field-remote",
    title: "Field / Remote Worker",
    description: "Photo verification required, longer auto clock-out window, and earlier break trigger for variable shifts.",
    suggestedName: "Field & Remote Worker Attendance",
    suggestedDescription: "Tracks remote and field workers with photo verification and a longer auto clock-out window.",
    rules: {
      gracePeriodMinutes: 10,
      autoClockOutHours: 20,
      requirePhotoVerification: true,
      allowEarlyClockIn: true,
      earlyClockInMinutes: 30,
      roundingIntervalMinutes: 15,
      requireBreakAfterHours: 5,
      breakDurationMinutes: 30,
    },
    summary: [
      { label: "Photo verification", value: "Required" },
      { label: "Auto clock-out", value: "20 hr" },
      { label: "Grace period", value: "10 min" },
    ],
  },
];

const PTO_TEMPLATES: PolicyTemplate[] = [
  {
    id: "pto-standard",
    title: "Standard PTO",
    description: "120 hours/year accrued annually with a small carryover cap and a 3-day advance-notice requirement.",
    suggestedName: "Standard PTO",
    suggestedDescription: "Standard PTO policy with 120 hours per year and a 3-day advance notice requirement.",
    rules: {
      accrualType: "annual",
      accrualHoursPerYear: 120,
      maxConsecutiveHours: 80,
      requireApproval: true,
      requireAdvanceNotice: true,
      advanceNoticeDays: 3,
      blackoutDatesEnabled: false,
      carryoverCapHours: 40,
    },
    summary: [
      { label: "Accrual", value: "120 hr/yr" },
      { label: "Advance notice", value: "3 days" },
      { label: "Carryover", value: "40 hr" },
    ],
  },
  {
    id: "pto-generous",
    title: "Generous PTO",
    description: "200 hours/year, longer consecutive-leave allowance, and a generous carryover cap to retain top talent.",
    suggestedName: "Generous PTO",
    suggestedDescription: "Generous PTO policy with 200 hours per year and a high carryover cap.",
    rules: {
      accrualType: "annual",
      accrualHoursPerYear: 200,
      maxConsecutiveHours: 160,
      requireApproval: true,
      requireAdvanceNotice: true,
      advanceNoticeDays: 7,
      blackoutDatesEnabled: false,
      carryoverCapHours: 80,
    },
    summary: [
      { label: "Accrual", value: "200 hr/yr" },
      { label: "Max consecutive", value: "160 hr" },
      { label: "Carryover", value: "80 hr" },
    ],
  },
  {
    id: "pto-accrue-per-pay-period",
    title: "Accrue Per Pay Period",
    description: "PTO accrues each pay period instead of annually — a good fit for teams paid biweekly or weekly.",
    suggestedName: "Per-Pay-Period PTO",
    suggestedDescription: "PTO accrues incrementally each pay period rather than as an annual lump sum.",
    rules: {
      accrualType: "per_pay_period",
      accrualHoursPerYear: 120,
      maxConsecutiveHours: 80,
      requireApproval: true,
      requireAdvanceNotice: true,
      advanceNoticeDays: 5,
      blackoutDatesEnabled: false,
      carryoverCapHours: 0,
    },
    summary: [
      { label: "Accrual", value: "Per pay period" },
      { label: "Hours/year", value: "120 hr" },
      { label: "Advance notice", value: "5 days" },
    ],
  },
  {
    id: "pto-strict",
    title: "Strict PTO",
    description: "Lower yearly bank, shorter consecutive-leave limit, longer advance notice, and blackout dates enabled.",
    suggestedName: "Strict PTO",
    suggestedDescription: "Tightly controlled PTO with a low cap, blackout dates, and a 14-day advance notice requirement.",
    rules: {
      accrualType: "annual",
      accrualHoursPerYear: 80,
      maxConsecutiveHours: 40,
      requireApproval: true,
      requireAdvanceNotice: true,
      advanceNoticeDays: 14,
      blackoutDatesEnabled: true,
      carryoverCapHours: 0,
    },
    summary: [
      { label: "Accrual", value: "80 hr/yr" },
      { label: "Advance notice", value: "14 days" },
      { label: "Blackout dates", value: "On" },
    ],
  },
];

const PAYROLL_TEMPLATES: PolicyTemplate[] = [
  {
    id: "payroll-biweekly-standard",
    title: "Bi-Weekly Standard",
    description: "Standard biweekly payroll paid every other Friday with overtime, double-time, and holiday pay enabled.",
    suggestedName: "Bi-Weekly Payroll",
    suggestedDescription: "Standard biweekly payroll paid Fridays with overtime, double-time, and holiday pay.",
    rules: {
      payPeriodType: "biweekly",
      payDayOfWeek: "friday",
      overtimeEnabled: true,
      overtimeThresholdHours: 40,
      overtimeMultiplier: 1.5,
      doubleTimeEnabled: true,
      doubleOtThreshold: 12,
      doubleTimeMultiplier: 2.0,
      includeHolidayPay: true,
      autoCalculateOT: true,
      dayOfWeekBonuses: [],
      earlyArrivalBonuses: [],
    },
    summary: [
      { label: "Pay period", value: "Biweekly · Fri" },
      { label: "Overtime", value: "40 hr · 1.5×" },
      { label: "Double-time", value: "12 hr · 2×" },
    ],
  },
  {
    id: "payroll-weekly",
    title: "Weekly Payroll",
    description: "Weekly payroll paid on Friday with overtime enabled. Double-time disabled by default.",
    suggestedName: "Weekly Payroll",
    suggestedDescription: "Weekly payroll paid Fridays with overtime enabled and double-time disabled.",
    rules: {
      payPeriodType: "weekly",
      payDayOfWeek: "friday",
      overtimeEnabled: true,
      overtimeThresholdHours: 40,
      overtimeMultiplier: 1.5,
      doubleTimeEnabled: false,
      doubleOtThreshold: 12,
      doubleTimeMultiplier: 2.0,
      includeHolidayPay: true,
      autoCalculateOT: true,
      dayOfWeekBonuses: [],
      earlyArrivalBonuses: [],
    },
    summary: [
      { label: "Pay period", value: "Weekly · Fri" },
      { label: "Overtime", value: "40 hr · 1.5×" },
      { label: "Double-time", value: "Off" },
    ],
  },
  {
    id: "payroll-semimonthly-no-ot",
    title: "Semi-Monthly (No OT)",
    description: "Semi-monthly pay schedule with overtime and double-time turned off — ideal for salaried teams.",
    suggestedName: "Semi-Monthly Payroll",
    suggestedDescription: "Semi-monthly payroll for salaried staff with overtime and double-time disabled.",
    rules: {
      payPeriodType: "semimonthly",
      payDayOfWeek: null,
      overtimeEnabled: false,
      overtimeThresholdHours: 40,
      overtimeMultiplier: 1.5,
      doubleTimeEnabled: false,
      doubleOtThreshold: 12,
      doubleTimeMultiplier: 2.0,
      includeHolidayPay: true,
      autoCalculateOT: false,
      dayOfWeekBonuses: [],
      earlyArrivalBonuses: [],
    },
    summary: [
      { label: "Pay period", value: "Semi-monthly" },
      { label: "Overtime", value: "Off" },
      { label: "Double-time", value: "Off" },
    ],
  },
  {
    id: "payroll-monthly-salaried",
    title: "Monthly Salaried",
    description: "Monthly pay cycle for salaried employees with overtime calculations turned off.",
    suggestedName: "Monthly Salaried Payroll",
    suggestedDescription: "Monthly payroll for fully salaried employees with no overtime calculations.",
    rules: {
      payPeriodType: "monthly",
      payDayOfWeek: null,
      overtimeEnabled: false,
      overtimeThresholdHours: 40,
      overtimeMultiplier: 1.5,
      doubleTimeEnabled: false,
      doubleOtThreshold: 12,
      doubleTimeMultiplier: 2.0,
      includeHolidayPay: true,
      autoCalculateOT: false,
      dayOfWeekBonuses: [],
      earlyArrivalBonuses: [],
    },
    summary: [
      { label: "Pay period", value: "Monthly" },
      { label: "Overtime", value: "Off" },
      { label: "Holiday pay", value: "On" },
    ],
  },
];

const APPROVALS_TEMPLATES: PolicyTemplate[] = [
  {
    id: "approvals-standard",
    title: "Standard Manager Approval",
    description: "Manager approval required, 48-hour escalation, and a comment required when denying a request.",
    suggestedName: "Standard Approvals",
    suggestedDescription: "Manager approval required with 48-hour escalation and required denial comments.",
    rules: {
      requireManagerApproval: true,
      autoApproveThreshold: 0,
      escalationHours: 48,
      requireCommentOnDenial: true,
      notifyOnSubmission: true,
      notifyOnDecision: true,
    },
    summary: [
      { label: "Manager approval", value: "Required" },
      { label: "Escalation", value: "48 hr" },
      { label: "Auto-approve", value: "Off" },
    ],
  },
  {
    id: "approvals-auto-short-requests",
    title: "Auto-Approve Short Requests",
    description: "Short requests (≤ 2 days) auto-approve. Longer requests still need manager sign-off with quick escalation.",
    suggestedName: "Auto-Approve Short Requests",
    suggestedDescription: "Auto-approves PTO requests of 2 days or shorter; longer requests follow the standard chain.",
    rules: {
      requireManagerApproval: true,
      autoApproveThreshold: 2,
      escalationHours: 24,
      requireCommentOnDenial: true,
      notifyOnSubmission: true,
      notifyOnDecision: true,
    },
    summary: [
      { label: "Auto-approve", value: "≤ 2 days" },
      { label: "Escalation", value: "24 hr" },
      { label: "Manager approval", value: "Required" },
    ],
  },
  {
    id: "approvals-strict",
    title: "Strict Approvals",
    description: "Tight 12-hour escalation, no auto-approval, and notifications on every submission and decision.",
    suggestedName: "Strict Approvals",
    suggestedDescription: "Strict approval workflow with 12-hour escalation and full notification coverage.",
    rules: {
      requireManagerApproval: true,
      autoApproveThreshold: 0,
      escalationHours: 12,
      requireCommentOnDenial: true,
      notifyOnSubmission: true,
      notifyOnDecision: true,
    },
    summary: [
      { label: "Escalation", value: "12 hr" },
      { label: "Auto-approve", value: "Off" },
      { label: "Notifications", value: "All" },
    ],
  },
  {
    id: "approvals-hands-off",
    title: "Hands-Off Approvals",
    description: "Auto-approves up to a week, longer escalation window, and lighter notification footprint.",
    suggestedName: "Hands-Off Approvals",
    suggestedDescription: "Lightweight approval workflow that auto-approves up to a week of PTO.",
    rules: {
      requireManagerApproval: false,
      autoApproveThreshold: 7,
      escalationHours: 72,
      requireCommentOnDenial: false,
      notifyOnSubmission: false,
      notifyOnDecision: true,
    },
    summary: [
      { label: "Auto-approve", value: "≤ 7 days" },
      { label: "Escalation", value: "72 hr" },
      { label: "Manager approval", value: "Optional" },
    ],
  },
];

export const POLICY_TEMPLATES: Record<string, PolicyTemplate[]> = {
  attendance: ATTENDANCE_TEMPLATES,
  pto: PTO_TEMPLATES,
  payroll: PAYROLL_TEMPLATES,
  approvals: APPROVALS_TEMPLATES,
};

export function getTemplatesForType(typeKey: string): PolicyTemplate[] {
  return POLICY_TEMPLATES[typeKey] || [];
}

export function hasTemplatesForType(typeKey: string): boolean {
  return getTemplatesForType(typeKey).length > 0;
}
