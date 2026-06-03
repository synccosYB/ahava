import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Check, Clock, CalendarDays,
  DollarSign, GitBranch, AlertCircle, ChevronsUpDown, Sparkles, FileText
} from "lucide-react";
import type { Policy, PolicyType, Division, Location, Department, User, PolicyAssignment, Role } from "@shared/schema";
import {
  findDayOfWeekBonusOverlaps,
  findEarlyArrivalBonusOverlaps,
  expandDaysOfWeek,
  describeDays,
  DAY_NAMES,
  pickNextDayOfWeekDraftDay,
  dayOfWeekDraftConflict,
  pickNextEarlyArrivalDraftDays,
  earlyArrivalDraftConflict,
  type OverlapInfo,
} from "@shared/policyOverlap";
import {
  getTemplatesForType,
  hasTemplatesForType,
  SCRATCH_TEMPLATE_ID,
  type PolicyTemplate,
} from "@/lib/policy-templates";

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "contractor", label: "Contractor" },
  { value: "per_diem", label: "Per Diem" },
];

const PAY_TYPE_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "salary", label: "Salary" },
];

const ASSIGNMENT_LEVEL_LABELS: Record<string, string> = {
  division: "Company",
  location: "Location",
  department: "Department",
  employee: "Employee",
  role: "Role",
  employment_type: "Employment Type",
  pay_type: "Pay Type",
  legacy_global: "Applies to all (legacy)",
};

const LEGACY_GLOBAL_LEVEL = "legacy_global";

function getAssignmentLevelLabel(level: string): string {
  return ASSIGNMENT_LEVEL_LABELS[level] || level;
}

interface WizardStep {
  key: "basics" | "template" | "rules" | "assignments" | "review";
  label: string;
  description: string;
}

const BASE_STEPS: WizardStep[] = [
  { key: "basics", label: "Basics", description: "Name and type" },
  { key: "rules", label: "Rules", description: "Configure settings" },
  { key: "assignments", label: "Assignments", description: "Apply to groups" },
  { key: "review", label: "Review", description: "Confirm and save" },
];

const TEMPLATE_STEP: WizardStep = {
  key: "template",
  label: "Template",
  description: "Pick a starting point",
};

interface RuleFieldDef {
  key: string;
  label: string;
  type: "number" | "boolean" | "text" | "select";
  description: string;
  defaultValue: any;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  showWhen?: (rules: Record<string, any>) => boolean;
  nullable?: boolean;
}

const PAYDAY_OPTIONS = [
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
];

const PAYDAY_UNSET_VALUE = "__unset__";

function getRuleFieldsForType(policyTypeKey: string): RuleFieldDef[] {
  switch (policyTypeKey) {
    case "attendance":
      return [
        { key: "gracePeriodMinutes", label: "Grace Period", type: "number", description: "Minutes after scheduled start before marking as late", defaultValue: 5, min: 0, max: 60 },
        { key: "autoClockOutHours", label: "Auto Clock-Out", type: "number", description: "Automatically clock out employees after this many hours", defaultValue: 16, min: 1, max: 24 },
        { key: "requirePhotoVerification", label: "Require Photo Verification", type: "boolean", description: "Require employees to take a photo when clocking in/out", defaultValue: false },
        { key: "allowEarlyClockIn", label: "Allow Early Clock-In", type: "boolean", description: "Allow employees to clock in before their scheduled shift", defaultValue: true },
        { key: "earlyClockInMinutes", label: "Early Clock-In Window", type: "number", description: "How many minutes before shift start employees can clock in", defaultValue: 15, min: 0, max: 120 },
        { key: "roundingIntervalMinutes", label: "Rounding Interval", type: "number", description: "Round clock times to the nearest interval (in minutes)", defaultValue: 15, min: 1, max: 30 },
        { key: "requireBreakAfterHours", label: "Break Required After", type: "number", description: "Require a break after this many hours worked", defaultValue: 6, min: 1, max: 12 },
        { key: "breakDurationMinutes", label: "Break Duration", type: "number", description: "Minimum break duration in minutes", defaultValue: 30, min: 5, max: 60 },
      ];
    case "pto":
      return [
        { key: "accrualType", label: "Accrual Type", type: "select", description: "How PTO is accrued over time", defaultValue: "annual", options: [{ value: "annual", label: "Annual" }, { value: "monthly", label: "Monthly" }, { value: "per_pay_period", label: "Per Pay Period" }] },
        { key: "accrualHoursPerYear", label: "Accrual Rate (hours/year)", type: "number", description: "Number of PTO hours accrued per year", defaultValue: 120, min: 0, max: 2920 },
        { key: "maxConsecutiveHours", label: "Max Consecutive Hours", type: "number", description: "Maximum number of consecutive PTO hours allowed", defaultValue: 80, min: 1, max: 720 },
        { key: "requireApproval", label: "Require Approval", type: "boolean", description: "Require manager approval for PTO requests. Requests that exceed an employee's available balance always require approval regardless of this setting.", defaultValue: true },
        { key: "requireAdvanceNotice", label: "Require Advance Notice", type: "boolean", description: "Require employees to submit PTO requests in advance", defaultValue: true },
        { key: "advanceNoticeDays", label: "Advance Notice Days", type: "number", description: "Minimum days in advance for PTO requests", defaultValue: 3, min: 0, max: 90 },
        { key: "blackoutDatesEnabled", label: "Blackout Dates", type: "boolean", description: "Enable blackout dates when PTO cannot be taken", defaultValue: false },
        { key: "carryoverCapHours", label: "Carryover Cap (hours)", type: "number", description: "Maximum unused PTO hours that carry over to next year (0 = no carryover)", defaultValue: 0, min: 0, max: 500 },
      ];
    case "payroll":
      return [
        { key: "payPeriodType", label: "Pay Period", type: "select", description: "How often employees are paid", defaultValue: "biweekly", options: [{ value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Biweekly" }, { value: "semimonthly", label: "Semi-Monthly" }, { value: "monthly", label: "Monthly" }] },
        {
          key: "payDayOfWeek",
          label: "Payday",
          type: "select",
          description: "Day of the week payday lands on (e.g. Friday for a Biweekly policy paid every other Friday).",
          defaultValue: null,
          nullable: true,
          options: PAYDAY_OPTIONS,
          showWhen: (r) => r?.payPeriodType === "weekly" || r?.payPeriodType === "biweekly",
        },
        { key: "overtimeEnabled", label: "Overtime Enabled", type: "boolean", description: "Whether overtime hours are tracked and paid at the OT multiplier", defaultValue: true },
        { key: "overtimeThresholdHours", label: "OT Threshold (hours/week)", type: "number", description: "Weekly hours threshold before overtime kicks in", defaultValue: 40, min: 20, max: 60 },
        { key: "overtimeMultiplier", label: "OT Multiplier", type: "number", description: "Pay multiplier for overtime hours (e.g. 1.5 = time and a half)", defaultValue: 1.5, min: 1, max: 3 },
        { key: "doubleTimeEnabled", label: "Double-Time Enabled", type: "boolean", description: "Whether double-time pay applies past the daily threshold", defaultValue: true },
        { key: "doubleOtThreshold", label: "Double OT Threshold (hours/day)", type: "number", description: "Daily hours threshold for double-time pay", defaultValue: 12, min: 8, max: 24 },
        { key: "doubleTimeMultiplier", label: "Double OT Multiplier", type: "number", description: "Pay multiplier for double overtime hours", defaultValue: 2.0, min: 1.5, max: 4 },
        { key: "includeHolidayPay", label: "Include Holiday Pay", type: "boolean", description: "Automatically calculate holiday pay for eligible employees", defaultValue: true },
        { key: "autoCalculateOT", label: "Auto-Calculate Overtime", type: "boolean", description: "Automatically calculate overtime based on time records", defaultValue: true },
      ];
    case "approvals":
      return [
        { key: "requireManagerApproval", label: "Require Manager Approval", type: "boolean", description: "All requests must be approved by the employee's direct manager", defaultValue: true },
        { key: "autoApproveThreshold", label: "Auto-Approve Threshold (hours)", type: "number", description: "Automatically approve PTO requests of this many hours or shorter (0 = disabled)", defaultValue: 8, min: 0, max: 240 },
        { key: "escalationHours", label: "Escalation After (hours)", type: "number", description: "Hours before an unanswered request is escalated to the next level", defaultValue: 48, min: 1, max: 168 },
        { key: "requireCommentOnDenial", label: "Require Comment on Denial", type: "boolean", description: "Managers must provide a reason when denying a request", defaultValue: true },
        { key: "notifyOnSubmission", label: "Notify on Submission", type: "boolean", description: "Send a notification when a new request is submitted", defaultValue: true },
        { key: "notifyOnDecision", label: "Notify on Decision", type: "boolean", description: "Send a notification when a request is approved or denied", defaultValue: true },
      ];
    default:
      return [];
  }
}

// Payroll rules are organized into "groups" so admins can flip individual
// rules on/off (e.g. turn off Double-time without faking the threshold).
// The pay period selector is intentionally not toggleable — a policy must
// always have a pay period.
type PayrollRuleGroup =
  | { kind: "static"; title: string; description?: string; field: RuleFieldDef }
  | {
      kind: "toggle";
      title: string;
      description?: string;
      enabledKey: string;
      offSummary: string;
      fields: RuleFieldDef[];
    };

function getPayrollRuleGroups(ruleFields: RuleFieldDef[]): PayrollRuleGroup[] {
  const byKey: Record<string, RuleFieldDef> = {};
  for (const f of ruleFields) byKey[f.key] = f;
  const groups: PayrollRuleGroup[] = [];
  if (byKey.payPeriodType) {
    groups.push({
      kind: "static",
      title: "Pay Period",
      description: "Required — every payroll policy must have a pay period.",
      field: byKey.payPeriodType,
    });
  }
  groups.push({
    kind: "toggle",
    title: "Overtime",
    description: "Pay extra for hours over the weekly OT threshold.",
    enabledKey: "overtimeEnabled",
    offSummary: "Overtime: off",
    fields: [byKey.overtimeThresholdHours, byKey.overtimeMultiplier].filter(Boolean) as RuleFieldDef[],
  });
  groups.push({
    kind: "toggle",
    title: "Double-Time",
    description: "Pay an even higher multiplier for hours past the daily double-time threshold.",
    enabledKey: "doubleTimeEnabled",
    offSummary: "Double-time: off",
    fields: [byKey.doubleOtThreshold, byKey.doubleTimeMultiplier].filter(Boolean) as RuleFieldDef[],
  });
  groups.push({
    kind: "toggle",
    title: "Holiday Pay",
    description: "Automatically calculate holiday pay for eligible employees.",
    enabledKey: "includeHolidayPay",
    offSummary: "Holiday pay: off",
    fields: [],
  });
  groups.push({
    kind: "toggle",
    title: "Auto-Calculate Overtime",
    description: "Automatically calculate overtime based on time records.",
    enabledKey: "autoCalculateOT",
    offSummary: "Auto-calculate overtime: off",
    fields: [],
  });
  return groups;
}

// Treat missing on/off flags as `true` so legacy payroll policies keep
// behaving exactly as they did before per-rule toggles existed.
function isPayrollRuleEnabled(rulesForm: Record<string, any>, enabledKey: string): boolean {
  return rulesForm[enabledKey] !== false;
}

function slugifyLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Field keys whose value is gated by a payroll on/off toggle. Used by
// validation so a disabled Double-time rule, for example, can't fail the
// wizard for a missing/zero threshold.
const PAYROLL_FIELD_TO_ENABLE_KEY: Record<string, string> = {
  overtimeThresholdHours: "overtimeEnabled",
  overtimeMultiplier: "overtimeEnabled",
  doubleOtThreshold: "doubleTimeEnabled",
  doubleTimeMultiplier: "doubleTimeEnabled",
};

function getPolicyTypeIcon(key: string) {
  switch (key) {
    case "attendance": return Clock;
    case "pto": return CalendarDays;
    case "payroll": return DollarSign;
    case "approvals": return GitBranch;
    default: return Clock;
  }
}

function getPolicyTypeLabel(key: string) {
  switch (key) {
    case "attendance": return "Attendance";
    case "pto": return "PTO / Leave";
    case "payroll": return "Payroll";
    case "approvals": return "Approval Workflow";
    default: return key;
  }
}

interface AssignmentEntry {
  level: string;
  id: string;
  label: string;
}

interface PolicyWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyTypeKey?: string;
  editingPolicy?: Policy | null;
  existingRules?: Record<string, any>;
  existingAssignments?: PolicyAssignment[];
}

export function PolicyWizard({
  open,
  onOpenChange,
  policyTypeKey,
  editingPolicy,
  existingRules,
  existingAssignments,
}: PolicyWizardProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTypeKey, setSelectedTypeKey] = useState(policyTypeKey || "");
  const [rulesForm, setRulesForm] = useState<Record<string, any>>({});
  const [assignments, setAssignments] = useState<AssignmentEntry[]>([]);
  const [saveStatus, setSaveStatus] = useState<"draft" | "active">("draft");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateBaseline, setTemplateBaseline] = useState<string | null>(null);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  const isCreating = !editingPolicy;
  const wizardSteps = useMemo<WizardStep[]>(() => {
    if (!isCreating) return BASE_STEPS;
    const showTemplateStep = !selectedTypeKey || hasTemplatesForType(selectedTypeKey);
    if (!showTemplateStep) return BASE_STEPS;
    return [BASE_STEPS[0], TEMPLATE_STEP, ...BASE_STEPS.slice(1)];
  }, [isCreating, selectedTypeKey]);
  const currentStepKey = wizardSteps[currentStep]?.key ?? "basics";

  const { data: policyTypes } = useQuery<PolicyType[]>({ queryKey: ["/api/policy-types"] });
  // Single consolidated picker call gated by the same admin check as policy
  // management, so the wizard always receives every assignment target regardless
  // of which granular view permissions the acting role happens to hold.
  const { data: assignmentTargets } = useQuery<{
    companies: Division[];
    locations: Location[];
    departments: Department[];
    users: User[];
    roles: Role[];
  }>({ queryKey: ["/api/policy-assignment-targets"] });
  const divisions = assignmentTargets?.companies;
  const locations = assignmentTargets?.locations;
  const departments = assignmentTargets?.departments;
  const users = assignmentTargets?.users;
  const roles = assignmentTargets?.roles;

  const matchingType = policyTypes?.find((pt) => pt.key === selectedTypeKey);
  const ruleFields = useMemo(() => getRuleFieldsForType(selectedTypeKey), [selectedTypeKey]);
  const visibleRuleFields = useMemo(
    () => ruleFields.filter((f) => !f.showWhen || f.showWhen(rulesForm)),
    [ruleFields, rulesForm],
  );

  const prevOpenRef = useRef(false);
  const prevEditIdRef = useRef<string | null>(null);

  function mapAssignmentsToEntries(
    assigns: PolicyAssignment[],
    divs: Division[],
    locs: Location[],
    depts: Department[],
    usrs: User[],
    rolesList: Role[],
  ): AssignmentEntry[] {
    return assigns.map((a) => {
      if (a.userId) {
        const user = usrs.find((u) => u.id === a.userId);
        return { level: "employee", id: a.userId, label: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Employee" : "Employee" };
      }
      if (a.roleId) {
        const role = rolesList.find((r) => r.id === a.roleId);
        return { level: "role", id: a.roleId, label: role?.name || "Role" };
      }
      if (a.employmentType) {
        const opt = EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === a.employmentType);
        return { level: "employment_type", id: a.employmentType, label: opt?.label || a.employmentType };
      }
      if (a.payType) {
        const opt = PAY_TYPE_OPTIONS.find((o) => o.value === a.payType);
        return { level: "pay_type", id: a.payType, label: opt?.label || a.payType };
      }
      if (a.departmentId) {
        const dept = depts.find((d) => d.id === a.departmentId);
        return { level: "department", id: a.departmentId, label: dept?.name || "Department" };
      }
      if (a.locationId) {
        const loc = locs.find((l) => l.id === a.locationId);
        return { level: "location", id: a.locationId, label: loc?.name || "Location" };
      }
      if (a.companyId) {
        const div = divs.find((d) => d.id === a.companyId);
        return { level: "division", id: a.companyId, label: div?.name || "Company" };
      }
      return { level: LEGACY_GLOBAL_LEVEL, id: "", label: "Applies to all (legacy)" };
    });
  }

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    const editTargetChanged = open && editingPolicy?.id !== prevEditIdRef.current;
    prevOpenRef.current = open;
    prevEditIdRef.current = editingPolicy?.id || null;

    if (!open || (!justOpened && !editTargetChanged)) return;

    setCurrentStep(0);
    setErrors({});

    if (editingPolicy) {
      setName(editingPolicy.name);
      setDescription(editingPolicy.description || "");
      const typeObj = policyTypes?.find((pt) => pt.id === editingPolicy.policyTypeId);
      setSelectedTypeKey(typeObj?.key || policyTypeKey || "");
      setRulesForm(existingRules || {});
      if (existingAssignments && existingAssignments.length > 0) {
        setAssignments(mapAssignmentsToEntries(
          existingAssignments,
          divisions || [], locations || [], departments || [], users || [], roles || [],
        ));
      } else {
        setAssignments([]);
      }
      setSaveStatus(editingPolicy.status === "active" ? "active" : "draft");
      setSelectedTemplateId(null);
      setTemplateBaseline(null);
      setPendingTemplateId(null);
    } else {
      setName("");
      setDescription("");
      setSelectedTypeKey(policyTypeKey || "");
      const defaults: Record<string, any> = {};
      const fields = getRuleFieldsForType(policyTypeKey || "");
      fields.forEach((f) => { defaults[f.key] = f.defaultValue; });
      setRulesForm(defaults);
      setAssignments([]);
      setSaveStatus("draft");
      setSelectedTemplateId(null);
      setTemplateBaseline(null);
      setPendingTemplateId(null);
    }
  }, [open, editingPolicy, policyTypeKey, existingRules, existingAssignments, policyTypes, users, departments, locations, divisions, roles]);

  useEffect(() => {
    if (open && !editingPolicy && selectedTypeKey) {
      const fields = getRuleFieldsForType(selectedTypeKey);
      const defaults: Record<string, any> = {};
      fields.forEach((f) => { defaults[f.key] = f.defaultValue; });
      setRulesForm((prev) => {
        const merged = { ...defaults };
        Object.keys(prev).forEach((k) => {
          if (fields.some((f) => f.key === k)) {
            merged[k] = prev[k];
          }
        });
        return merged;
      });
      // Switching policy type invalidates any previously picked template,
      // since templates are scoped to a single policy type.
      setSelectedTemplateId(null);
      setTemplateBaseline(null);
      setPendingTemplateId(null);
    }
  }, [selectedTypeKey, open, editingPolicy]);

  function getDefaultRulesForCurrentType(): Record<string, any> {
    const fields = getRuleFieldsForType(selectedTypeKey);
    const defaults: Record<string, any> = {};
    fields.forEach((f) => { defaults[f.key] = f.defaultValue; });
    return defaults;
  }

  function snapshotState(n: string, d: string, r: Record<string, any>): string {
    return JSON.stringify({ name: n, description: d, rules: r });
  }

  function applyTemplate(templateId: string) {
    if (templateId === SCRATCH_TEMPLATE_ID) {
      const defaults = getDefaultRulesForCurrentType();
      setName("");
      setDescription("");
      setRulesForm(defaults);
      setSelectedTemplateId(SCRATCH_TEMPLATE_ID);
      setTemplateBaseline(snapshotState("", "", defaults));
      return;
    }
    const template = getTemplatesForType(selectedTypeKey).find((t) => t.id === templateId);
    if (!template) return;
    // Start from the per-type defaults so any rule fields the template
    // doesn't explicitly set still have a sensible value.
    const merged = { ...getDefaultRulesForCurrentType(), ...template.rules };
    setName(template.suggestedName);
    setDescription(template.suggestedDescription);
    setRulesForm(merged);
    setSelectedTemplateId(template.id);
    setTemplateBaseline(snapshotState(template.suggestedName, template.suggestedDescription, merged));
  }

  function hasEditedSinceTemplate(): boolean {
    if (templateBaseline === null) return false;
    return snapshotState(name, description, rulesForm) !== templateBaseline;
  }

  function handleTemplatePick(templateId: string) {
    if (selectedTemplateId === templateId) return; // no-op
    if (selectedTemplateId !== null && hasEditedSinceTemplate()) {
      setPendingTemplateId(templateId);
      return;
    }
    applyTemplate(templateId);
  }

  function confirmPendingTemplate() {
    if (pendingTemplateId) {
      applyTemplate(pendingTemplateId);
    }
    setPendingTemplateId(null);
  }

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    const stepKey = wizardSteps[step]?.key;
    if (stepKey === "basics") {
      if (!name.trim()) newErrors.name = "Policy name is required";
      if (!selectedTypeKey) newErrors.type = "Please select a policy type";
    }
    if (stepKey === "template") {
      if (!selectedTemplateId) {
        newErrors.template = "Pick a template or choose Start from scratch to continue";
      }
    }
    if (stepKey === "rules") {
      visibleRuleFields.forEach((field) => {
        if (field.type === "number") {
          // Skip validation when this field belongs to a payroll rule whose
          // on/off toggle is currently off — admins shouldn't be blocked by
          // a stale value sitting inside a disabled rule.
          if (selectedTypeKey === "payroll") {
            const enableKey = PAYROLL_FIELD_TO_ENABLE_KEY[field.key];
            if (enableKey && !isPayrollRuleEnabled(rulesForm, enableKey)) {
              return;
            }
          }
          const val = rulesForm[field.key];
          if (val === undefined || val === null || val === "") {
            newErrors[field.key] = `${field.label} is required`;
          } else if (field.min !== undefined && Number(val) < field.min) {
            newErrors[field.key] = `Must be at least ${field.min}`;
          } else if (field.max !== undefined && Number(val) > field.max) {
            newErrors[field.key] = `Must be at most ${field.max}`;
          }
        }
      });
      if (selectedTypeKey === "payroll" && Array.isArray(rulesForm.earlyArrivalBonuses)) {
        rulesForm.earlyArrivalBonuses.forEach((b: any, idx: number) => {
          const cutoff = typeof b?.cutoffTime === "string" ? b.cutoffTime : "";
          const threshold = Number(b?.minHoursThreshold);
          const perHour = Number(b?.bonusAmountPerHour);
          if (!/^\d{1,2}:\d{2}$/.test(cutoff)) {
            newErrors[`earlyArrivalBonuses.${idx}.cutoffTime`] = `Early-arrival rule #${idx + 1}: cutoff time is required (HH:MM)`;
          } else {
            const [hs, ms] = cutoff.split(":");
            const h = parseInt(hs, 10);
            const m = parseInt(ms, 10);
            if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
              newErrors[`earlyArrivalBonuses.${idx}.cutoffTime`] = `Early-arrival rule #${idx + 1}: enter a valid 24h time`;
            }
          }
          if (Number.isNaN(perHour) || perHour <= 0) {
            newErrors[`earlyArrivalBonuses.${idx}.bonusAmountPerHour`] = `Early-arrival rule #${idx + 1}: bonus per hour must be greater than 0`;
          }
          if (Number.isNaN(threshold) || threshold < 0) {
            newErrors[`earlyArrivalBonuses.${idx}.minHoursThreshold`] = `Early-arrival rule #${idx + 1}: minimum hours must be 0 or greater`;
          }
          if (Array.isArray(b?.daysOfWeek)) {
            for (const d of b.daysOfWeek) {
              if (!Number.isInteger(d) || d < 0 || d > 6) {
                newErrors[`earlyArrivalBonuses.${idx}.daysOfWeek`] = `Early-arrival rule #${idx + 1}: invalid day selection`;
                break;
              }
            }
          }
        });
      }
      if (selectedTypeKey === "payroll" && Array.isArray(rulesForm.dayOfWeekBonuses)) {
        rulesForm.dayOfWeekBonuses.forEach((b: any, idx: number) => {
          const day = Number(b?.dayOfWeek);
          const threshold = Number(b?.minHoursThreshold);
          const amount = Number(b?.bonusAmount);
          if (!Number.isInteger(day) || day < 0 || day > 6) {
            newErrors[`dayOfWeekBonuses.${idx}.dayOfWeek`] = `Bonus rule #${idx + 1}: pick a valid day of the week`;
          }
          if (Number.isNaN(threshold) || threshold < 0) {
            newErrors[`dayOfWeekBonuses.${idx}.minHoursThreshold`] = `Bonus rule #${idx + 1}: minimum hours must be 0 or greater`;
          }
          if (Number.isNaN(amount) || amount <= 0) {
            newErrors[`dayOfWeekBonuses.${idx}.bonusAmount`] = `Bonus rule #${idx + 1}: bonus amount must be greater than 0`;
          }
          if (b?.bonusType !== "money" && b?.bonusType !== "hours") {
            newErrors[`dayOfWeekBonuses.${idx}.bonusType`] = `Bonus rule #${idx + 1}: choose money or hours`;
          }
        });
      }
      if (selectedTypeKey === "payroll") {
        const dowList: any[] = Array.isArray(rulesForm.dayOfWeekBonuses) ? rulesForm.dayOfWeekBonuses : [];
        const dowOverlaps = findDayOfWeekBonusOverlaps(dowList);
        dowList.forEach((b: any, idx: number) => {
          const info = dowOverlaps.get(b?.id);
          if (info) {
            const dayLabel = DAY_NAMES[Number(b?.dayOfWeek)] || "this day";
            newErrors[`dayOfWeekBonuses.${idx}.overlap`] = `Bonus rule #${idx + 1}: a rule for ${dayLabel} already exists. Edit or remove it first.`;
          }
        });
        const earlyList: any[] = Array.isArray(rulesForm.earlyArrivalBonuses) ? rulesForm.earlyArrivalBonuses : [];
        const earlyOverlaps = findEarlyArrivalBonusOverlaps(earlyList);
        earlyList.forEach((b: any, idx: number) => {
          const info = earlyOverlaps.get(b?.id);
          if (info) {
            newErrors[`earlyArrivalBonuses.${idx}.overlap`] = `Early-arrival rule #${idx + 1}: day(s) overlap with another rule (${describeDays(info.conflictingDays)}). Edit or remove the conflicting rule first.`;
          }
        });
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const dowBonuses = useMemo<any[]>(
    () => (Array.isArray(rulesForm.dayOfWeekBonuses) ? rulesForm.dayOfWeekBonuses : []),
    [rulesForm.dayOfWeekBonuses],
  );
  const earlyBonuses = useMemo<any[]>(
    () => (Array.isArray(rulesForm.earlyArrivalBonuses) ? rulesForm.earlyArrivalBonuses : []),
    [rulesForm.earlyArrivalBonuses],
  );
  const dowOverlaps = useMemo(
    () => (selectedTypeKey === "payroll" ? findDayOfWeekBonusOverlaps(dowBonuses) : new Map<string, OverlapInfo>()),
    [dowBonuses, selectedTypeKey],
  );
  const earlyOverlaps = useMemo(
    () => (selectedTypeKey === "payroll" ? findEarlyArrivalBonusOverlaps(earlyBonuses) : new Map<string, OverlapInfo>()),
    [earlyBonuses, selectedTypeKey],
  );
  const hasBonusOverlaps = dowOverlaps.size > 0 || earlyOverlaps.size > 0;

  const goNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((s) => Math.min(s + 1, wizardSteps.length - 1));
    }
  };

  const goBack = () => {
    setErrors({});
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const saveMutation = useMutation({
    mutationFn: async (targetStatus: "draft" | "active") => {
      if (!matchingType?.id) {
        throw new Error(
          `Policy type "${selectedTypeKey}" is not available yet. Please reload and try again, or pick a different type.`,
        );
      }
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        policyTypeId: matchingType.id,
        companyId: divisions?.[0]?.id || null,
        status: targetStatus,
      };

      let policyId: string;

      if (editingPolicy) {
        await apiRequest("PATCH", `/api/policies/${editingPolicy.id}`, payload);
        policyId = editingPolicy.id;
      } else {
        const res = await apiRequest("POST", "/api/policies", payload);
        const created = await res.json();
        policyId = created.id;
      }

      if (Object.keys(rulesForm).length > 0) {
        await apiRequest("PUT", `/api/policies/${policyId}/rules`, { rules: rulesForm });
      }

      if (editingPolicy && existingAssignments && existingAssignments.length > 0) {
        for (const ea of existingAssignments) {
          await apiRequest("DELETE", `/api/policy-assignments/${ea.id}`);
        }
      }

      const validAssignments = assignments.filter(
        (a) => a.level !== LEGACY_GLOBAL_LEVEL && a.id && a.id.trim() !== "",
      );
      if (validAssignments.length > 0) {
        const payloads = validAssignments.map((a) => {
          const payload: Record<string, string | null> = {
            policyId,
            companyId: null,
            locationId: null,
            departmentId: null,
            userId: null,
            roleId: null,
            employmentType: null,
            payType: null,
          };
          if (a.level === "division") payload.companyId = a.id;
          if (a.level === "location") payload.locationId = a.id;
          if (a.level === "department") payload.departmentId = a.id;
          if (a.level === "employee") payload.userId = a.id;
          if (a.level === "role") payload.roleId = a.id;
          if (a.level === "employment_type") payload.employmentType = a.id;
          if (a.level === "pay_type") payload.payType = a.id;
          return payload;
        });
        await apiRequest("POST", "/api/policy-assignments", payloads);
      }
      return { savedAssignmentCount: validAssignments.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-assignments"] });
      if (editingPolicy?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/policies", editingPolicy.id, "rules"] });
      }
      onOpenChange(false);
      const savedCount = result?.savedAssignmentCount ?? 0;
      if (savedCount === 0) {
        toast({
          title: editingPolicy ? "Policy updated" : "Policy saved",
          description: "Not assigned to anyone yet — use Assign to apply it.",
        });
      } else {
        toast({ title: editingPolicy ? "Policy updated" : "Policy created" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const progressValue = ((currentStep + 1) / wizardSteps.length) * 100;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saveMutation.isPending) onOpenChange(o); }}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto p-0"
        data-testid="dialog-policy-wizard"
      >
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle data-testid="text-wizard-title">
              {editingPolicy ? `Edit Policy: ${editingPolicy.name}` : "Create New Policy"}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 mb-2">
            <Progress value={progressValue} className="h-2" data-testid="progress-wizard" />
          </div>

          <div className="flex justify-between mb-4">
            {wizardSteps.map((step, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i < currentStep) {
                    setErrors({});
                    setCurrentStep(i);
                  }
                }}
                className={`flex flex-col items-center text-xs gap-1 transition-colors ${
                  i === currentStep
                    ? "text-primary font-medium"
                    : i < currentStep
                      ? "text-primary/70 cursor-pointer hover:text-primary"
                      : "text-muted-foreground"
                }`}
                data-testid={`button-step-${i}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-colors ${
                  i < currentStep
                    ? "bg-primary text-primary-foreground border-primary"
                    : i === currentStep
                      ? "border-primary text-primary"
                      : "border-muted-foreground/30 text-muted-foreground"
                }`}>
                  {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className="hidden sm:block">{step.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Separator />

        <div className="p-6 min-h-[320px]">
          {currentStepKey === "basics" && (
            <StepBasics
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              selectedTypeKey={selectedTypeKey}
              setSelectedTypeKey={setSelectedTypeKey}
              policyTypeKey={policyTypeKey}
              errors={errors}
            />
          )}
          {currentStepKey === "template" && (
            <StepTemplate
              policyTypeKey={selectedTypeKey}
              selectedTemplateId={selectedTemplateId}
              onPick={handleTemplatePick}
              errors={errors}
            />
          )}
          {currentStepKey === "rules" && (
            <StepRules
              ruleFields={visibleRuleFields}
              rulesForm={rulesForm}
              setRulesForm={setRulesForm}
              errors={errors}
              policyTypeKey={selectedTypeKey}
              dowOverlaps={dowOverlaps}
              earlyOverlaps={earlyOverlaps}
            />
          )}
          {currentStepKey === "assignments" && (
            <StepAssignments
              assignments={assignments}
              setAssignments={setAssignments}
              divisions={divisions || []}
              locations={locations || []}
              departments={departments || []}
              users={users || []}
              roles={roles || []}
            />
          )}
          {currentStepKey === "review" && (
            <StepReview
              name={name}
              description={description}
              selectedTypeKey={selectedTypeKey}
              rulesForm={rulesForm}
              ruleFields={visibleRuleFields}
              assignments={assignments}
            />
          )}
        </div>

        <Separator />

        <div className="p-6 pt-4 flex justify-between items-center">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={currentStep === 0}
            data-testid="button-wizard-back"
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>

          <div className="flex gap-2">
            {currentStep < wizardSteps.length - 1 ? (
              <Button
                onClick={goNext}
                disabled={currentStepKey === "rules" && hasBonusOverlaps}
                data-testid="button-wizard-next"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => { setSaveStatus("draft"); saveMutation.mutate("draft"); }}
                  disabled={saveMutation.isPending || hasBonusOverlaps}
                  data-testid="button-wizard-save-draft"
                >
                  {saveMutation.isPending && saveStatus === "draft" ? "Saving..." : "Save as Draft"}
                </Button>
                <Button
                  onClick={() => { setSaveStatus("active"); saveMutation.mutate("active"); }}
                  disabled={saveMutation.isPending || hasBonusOverlaps}
                  data-testid="button-wizard-activate"
                >
                  {saveMutation.isPending && saveStatus === "active" ? "Activating..." : "Save & Activate"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>

      <AlertDialog
        open={!!pendingTemplateId}
        onOpenChange={(o) => { if (!o) setPendingTemplateId(null); }}
      >
        <AlertDialogContent data-testid="dialog-template-overwrite-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              You've edited the policy name, description, or rules since picking the current template.
              Switching templates will replace those edits with the new template's values. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-template-overwrite-cancel">Keep my edits</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPendingTemplate}
              data-testid="button-template-overwrite-confirm"
            >
              Replace with template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function StepTemplate({
  policyTypeKey, selectedTemplateId, onPick, errors,
}: {
  policyTypeKey: string;
  selectedTemplateId: string | null;
  onPick: (templateId: string) => void;
  errors: Record<string, string>;
}) {
  const templates = getTemplatesForType(policyTypeKey);
  const typeLabel = getPolicyTypeLabel(policyTypeKey).toLowerCase();

  return (
    <div className="space-y-6" data-testid="wizard-step-template">
      <div>
        <h3 className="text-base font-semibold mb-1">Choose a template</h3>
        <p className="text-sm text-muted-foreground">
          Pick a pre-made {typeLabel} policy as your starting point. You'll be able to review
          and edit every rule on the next step.
        </p>
      </div>

      {errors.template && (
        <p className="text-sm text-destructive flex items-center gap-1" data-testid="error-template">
          <AlertCircle className="h-3 w-3" /> {errors.template}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((template) => {
          const isSelected = selectedTemplateId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onPick(template.id)}
              className={`text-left p-4 rounded-lg border-2 transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
              data-testid={`button-template-${template.id}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Sparkles className={`h-4 w-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`font-medium text-sm ${isSelected ? "text-primary" : ""}`}>
                    {template.title}
                  </span>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 text-primary flex-shrink-0" data-testid={`icon-template-selected-${template.id}`} />
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3">{template.description}</p>
              <div className="flex flex-wrap gap-1">
                {template.summary.map((item, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className="text-xs"
                    data-testid={`badge-template-${template.id}-summary-${idx}`}
                  >
                    {item.label}: {item.value}
                  </Badge>
                ))}
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onPick(SCRATCH_TEMPLATE_ID)}
          className={`text-left p-4 rounded-lg border-2 border-dashed transition-colors ${
            selectedTemplateId === SCRATCH_TEMPLATE_ID
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
          data-testid="button-template-scratch"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <FileText className={`h-4 w-4 ${selectedTemplateId === SCRATCH_TEMPLATE_ID ? "text-primary" : "text-muted-foreground"}`} />
              <span className={`font-medium text-sm ${selectedTemplateId === SCRATCH_TEMPLATE_ID ? "text-primary" : ""}`}>
                Start from scratch
              </span>
            </div>
            {selectedTemplateId === SCRATCH_TEMPLATE_ID && (
              <Check className="h-4 w-4 text-primary flex-shrink-0" data-testid="icon-template-selected-scratch" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Begin with the system defaults and a blank name and description. You'll fill in
            every rule yourself on the next step.
          </p>
        </button>
      </div>
    </div>
  );
}

function StepBasics({
  name, setName, description, setDescription,
  selectedTypeKey, setSelectedTypeKey, policyTypeKey, errors,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  selectedTypeKey: string;
  setSelectedTypeKey: (v: string) => void;
  policyTypeKey?: string;
  errors: Record<string, string>;
}) {
  const typeOptions = ["attendance", "pto", "payroll", "approvals"];
  const isTypeLocked = !!policyTypeKey;

  return (
    <div className="space-y-6" data-testid="wizard-step-basics">
      <div>
        <h3 className="text-base font-semibold mb-1">Policy Basics</h3>
        <p className="text-sm text-muted-foreground">Set the name, description, and type for your new policy.</p>
      </div>

      {!isTypeLocked && (
        <div>
          <Label className="mb-2 block">Policy Type *</Label>
          <div className="grid grid-cols-2 gap-3">
            {typeOptions.map((key) => {
              const Icon = getPolicyTypeIcon(key);
              const isSelected = selectedTypeKey === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedTypeKey(key)}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                  data-testid={`button-type-${key}`}
                >
                  <Icon className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>
                    {getPolicyTypeLabel(key)}
                  </span>
                </button>
              );
            })}
          </div>
          {errors.type && (
            <p className="text-sm text-destructive mt-1 flex items-center gap-1" data-testid="error-type">
              <AlertCircle className="h-3 w-3" /> {errors.type}
            </p>
          )}
        </div>
      )}

      {isTypeLocked && (
        <div>
          <Label className="text-muted-foreground text-xs">Policy Type</Label>
          <div className="flex items-center gap-2 mt-1">
            {(() => { const Icon = getPolicyTypeIcon(policyTypeKey!); return <Icon className="h-4 w-4 text-primary" />; })()}
            <span className="font-medium">{getPolicyTypeLabel(policyTypeKey!)}</span>
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="wizard-name">Policy Name *</Label>
        <Input
          id="wizard-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard Attendance Policy"
          className="mt-1"
          data-testid="input-wizard-name"
        />
        {errors.name && (
          <p className="text-sm text-destructive mt-1 flex items-center gap-1" data-testid="error-name">
            <AlertCircle className="h-3 w-3" /> {errors.name}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="wizard-description">Description</Label>
        <Textarea
          id="wizard-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of what this policy covers..."
          className="mt-1"
          rows={3}
          data-testid="input-wizard-description"
        />
      </div>
    </div>
  );
}

interface DayOfWeekBonus {
  id: string;
  dayOfWeek: number;
  minHoursThreshold: number;
  bonusType: "money" | "hours";
  bonusAmount: number;
}

const DAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

function DayOfWeekBonusEditor({
  bonuses, onChange, overlaps,
}: {
  bonuses: DayOfWeekBonus[];
  onChange: (next: DayOfWeekBonus[]) => void;
  overlaps: Map<string, OverlapInfo>;
}) {
  const usedDays = useMemo(() => new Set(bonuses.map((b) => b.dayOfWeek)), [bonuses]);
  const firstAvailableDay = useMemo(() => pickNextDayOfWeekDraftDay(bonuses), [bonuses]);
  const allDaysTaken = firstAvailableDay === null;

  const [draft, setDraft] = useState<{ dayOfWeek: string; minHoursThreshold: string; bonusType: "money" | "hours"; bonusAmount: string }>(() => ({
    dayOfWeek: String(firstAvailableDay ?? 0),
    minHoursThreshold: "8",
    bonusType: "money",
    bonusAmount: "",
  }));

  useEffect(() => {
    if (allDaysTaken) return;
    const currentDay = parseInt(draft.dayOfWeek, 10);
    if (!Number.isInteger(currentDay) || usedDays.has(currentDay)) {
      setDraft((prev) => ({ ...prev, dayOfWeek: String(firstAvailableDay) }));
    }
  }, [allDaysTaken, firstAvailableDay, usedDays, draft.dayOfWeek]);

  const draftDay = parseInt(draft.dayOfWeek, 10);
  const draftConflict = dayOfWeekDraftConflict(bonuses, draftDay);
  const draftConflictsWith = draftConflict.hasConflict;
  const draftConflictMessage = draftConflict.message;

  const addBonus = () => {
    if (allDaysTaken) return;
    const threshold = parseFloat(draft.minHoursThreshold);
    const amount = parseFloat(draft.bonusAmount);
    if (Number.isNaN(threshold) || threshold < 0) return;
    if (Number.isNaN(amount) || amount <= 0) return;
    if (draftConflictsWith) return;
    const next: DayOfWeekBonus = {
      id: `dow-bonus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dayOfWeek: draftDay,
      minHoursThreshold: threshold,
      bonusType: draft.bonusType,
      bonusAmount: amount,
    };
    const newBonuses = [...bonuses, next];
    onChange(newBonuses);
    const nextDay = pickNextDayOfWeekDraftDay(newBonuses);
    setDraft({
      ...draft,
      dayOfWeek: nextDay !== null ? String(nextDay) : draft.dayOfWeek,
      bonusAmount: "",
    });
  };

  const removeBonus = (id: string) => {
    onChange(bonuses.filter((b) => b.id !== id));
  };

  const updateBonus = (id: string, patch: Partial<DayOfWeekBonus>) => {
    onChange(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const canAdd =
    !allDaysTaken &&
    draft.dayOfWeek !== "" &&
    draft.minHoursThreshold !== "" &&
    parseFloat(draft.minHoursThreshold) >= 0 &&
    draft.bonusAmount !== "" &&
    parseFloat(draft.bonusAmount) > 0 &&
    !draftConflictsWith;

  const dayLabel = (d: number) => DAY_OPTIONS.find((o) => o.value === String(d))?.label || String(d);

  return (
    <div className="p-3 rounded-lg border bg-card space-y-3" data-testid="editor-day-of-week-bonuses">
      <div>
        <Label className="font-medium">Day-of-Week Bonus Rules</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Award a bonus (extra money or extra paid hours) when an employee works at least the threshold hours on a specific day. Example: $10 bonus for working 8+ hours on Sunday.
        </p>
      </div>

      {bonuses.length > 0 && (
        <div className="space-y-2">
          {bonuses.map((b) => {
            const overlapInfo = overlaps.get(b.id);
            return (
            <div
              key={b.id}
              className={`grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-2 rounded-md border ${overlapInfo ? "border-destructive bg-destructive/5" : "bg-muted/30"}`}
              data-testid={`row-dow-bonus-${b.id}`}
            >
              <div>
                <Label className="text-xs">Day</Label>
                <Select
                  value={String(b.dayOfWeek)}
                  onValueChange={(v) => updateBonus(b.id, { dayOfWeek: parseInt(v, 10) })}
                >
                  <SelectTrigger data-testid={`select-edit-dow-bonus-day-${b.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Min Hours</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  value={b.minHoursThreshold}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
                    updateBonus(b.id, { minHoursThreshold: Number.isNaN(v) ? 0 : Math.max(0, v) });
                  }}
                  data-testid={`input-edit-dow-bonus-threshold-${b.id}`}
                />
              </div>
              <div>
                <Label className="text-xs">Bonus Type</Label>
                <Select
                  value={b.bonusType}
                  onValueChange={(v) => updateBonus(b.id, { bonusType: v as "money" | "hours" })}
                >
                  <SelectTrigger data-testid={`select-edit-dow-bonus-type-${b.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="money">Extra Money ($)</SelectItem>
                    <SelectItem value="hours">Extra Paid Hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Amount</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={b.bonusAmount}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
                    updateBonus(b.id, { bonusAmount: Number.isNaN(v) ? 0 : Math.max(0, v) });
                  }}
                  data-testid={`input-edit-dow-bonus-amount-${b.id}`}
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  {dayLabel(b.dayOfWeek).slice(0, 3)} ≥ {b.minHoursThreshold}h →{" "}
                  {b.bonusType === "money" ? `$${(b.bonusAmount || 0).toFixed(2)}` : `+${b.bonusAmount}h`}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeBonus(b.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  data-testid={`button-remove-dow-bonus-${b.id}`}
                >
                  &times;
                </Button>
              </div>
              {overlapInfo && (
                <p
                  className="md:col-span-5 text-sm text-destructive flex items-center gap-1"
                  data-testid={`error-dow-bonus-overlap-${b.id}`}
                >
                  <AlertCircle className="h-3 w-3" /> A rule for {DAY_NAMES[b.dayOfWeek]} already exists. Edit or remove the duplicate so only one rule fires per day.
                </p>
              )}
            </div>
          );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <Label className="text-xs">Day</Label>
          <Select
            value={draft.dayOfWeek}
            onValueChange={(v) => setDraft({ ...draft, dayOfWeek: v })}
            disabled={allDaysTaken}
          >
            <SelectTrigger data-testid="select-dow-bonus-day"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((o) => {
                const dayNum = parseInt(o.value, 10);
                const taken = usedDays.has(dayNum);
                return (
                  <SelectItem key={o.value} value={o.value} disabled={taken}>
                    {o.label}{taken ? " (already has a rule)" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Min Hours</Label>
          <Input
            type="number"
            min={0}
            step="0.25"
            value={draft.minHoursThreshold}
            onChange={(e) => setDraft({ ...draft, minHoursThreshold: e.target.value })}
            data-testid="input-dow-bonus-threshold"
          />
        </div>
        <div>
          <Label className="text-xs">Bonus Type</Label>
          <Select value={draft.bonusType} onValueChange={(v) => setDraft({ ...draft, bonusType: v as "money" | "hours" })}>
            <SelectTrigger data-testid="select-dow-bonus-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="money">Extra Money ($)</SelectItem>
              <SelectItem value="hours">Extra Paid Hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Amount</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={draft.bonusAmount}
            onChange={(e) => setDraft({ ...draft, bonusAmount: e.target.value })}
            placeholder={draft.bonusType === "money" ? "10.00" : "1.0"}
            data-testid="input-dow-bonus-amount"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={addBonus}
          disabled={!canAdd}
          data-testid="button-add-dow-bonus"
        >
          Add Bonus
        </Button>
      </div>
      {allDaysTaken ? (
        <p className="text-sm text-muted-foreground flex items-center gap-1" data-testid="hint-dow-bonus-all-days-taken">
          <AlertCircle className="h-3 w-3" /> All days already have a rule. Edit or remove an existing rule to add a different one.
        </p>
      ) : draftConflictMessage ? (
        <p className="text-sm text-destructive flex items-center gap-1" data-testid="error-dow-bonus-draft-conflict">
          <AlertCircle className="h-3 w-3" /> {draftConflictMessage}
        </p>
      ) : null}
    </div>
  );
}

interface EarlyArrivalBonus {
  id: string;
  cutoffTime: string;
  bonusAmountPerHour: number;
  minHoursThreshold: number;
  daysOfWeek?: number[];
  applyScope?: "entire_shift" | "before_cutoff";
}

function EarlyArrivalBonusEditor({
  bonuses, onChange, errors, overlaps,
}: {
  bonuses: EarlyArrivalBonus[];
  onChange: (next: EarlyArrivalBonus[]) => void;
  errors: Record<string, string>;
  overlaps: Map<string, OverlapInfo>;
}) {
  const coveredDays = useMemo(() => {
    const set = new Set<number>();
    for (const b of bonuses) {
      for (const d of expandDaysOfWeek(b.daysOfWeek)) set.add(d);
    }
    return set;
  }, [bonuses]);
  const availableDays = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].filter((d) => !coveredDays.has(d)),
    [coveredDays],
  );
  const allDaysTaken = availableDays.length === 0;

  const [draft, setDraft] = useState<{ cutoffTime: string; bonusAmountPerHour: string; minHoursThreshold: string; daysOfWeek: number[]; applyScope: "entire_shift" | "before_cutoff" }>(() => ({
    cutoffTime: "07:00",
    bonusAmountPerHour: "",
    minHoursThreshold: "0",
    daysOfWeek: pickNextEarlyArrivalDraftDays(bonuses),
    applyScope: "entire_shift",
  }));

  useEffect(() => {
    if (allDaysTaken) return;
    const draftDaySet = new Set(draft.daysOfWeek);
    const draftIsAllDays = draft.daysOfWeek.length === 0;
    const conflicts = draftIsAllDays
      ? coveredDays.size > 0
      : draft.daysOfWeek.some((d) => coveredDays.has(d));
    if (conflicts) {
      const next = pickNextEarlyArrivalDraftDays(bonuses);
      const sameLen = next.length === draft.daysOfWeek.length;
      const sameMembers = sameLen && next.every((d) => draftDaySet.has(d));
      if (!sameMembers) {
        setDraft((prev) => ({ ...prev, daysOfWeek: next }));
      }
    }
  }, [allDaysTaken, bonuses, coveredDays, draft.daysOfWeek]);

  const draftConflictInfo = useMemo(
    () => earlyArrivalDraftConflict(bonuses, draft.daysOfWeek),
    [draft.daysOfWeek, bonuses],
  );
  const draftConflictDays = draftConflictInfo.conflictingDays;
  const draftHasConflict = draftConflictDays.length > 0;
  const draftConflictMessage = draftConflictInfo.message;

  const addBonus = () => {
    if (allDaysTaken) return;
    const perHour = parseFloat(draft.bonusAmountPerHour);
    const threshold = parseFloat(draft.minHoursThreshold);
    if (!/^\d{1,2}:\d{2}$/.test(draft.cutoffTime)) return;
    if (Number.isNaN(perHour) || perHour <= 0) return;
    if (Number.isNaN(threshold) || threshold < 0) return;
    if (draftHasConflict) return;
    const next: EarlyArrivalBonus = {
      id: `early-bonus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cutoffTime: draft.cutoffTime,
      bonusAmountPerHour: perHour,
      minHoursThreshold: threshold,
      daysOfWeek: draft.daysOfWeek.length > 0 ? [...draft.daysOfWeek].sort() : undefined,
      applyScope: draft.applyScope,
    };
    const newBonuses = [...bonuses, next];
    onChange(newBonuses);
    setDraft({
      ...draft,
      bonusAmountPerHour: "",
      daysOfWeek: pickNextEarlyArrivalDraftDays(newBonuses),
    });
  };

  const removeBonus = (id: string) => {
    onChange(bonuses.filter((b) => b.id !== id));
  };

  const updateBonus = (id: string, patch: Partial<EarlyArrivalBonus>) => {
    onChange(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const toggleDay = (list: number[] | undefined, day: number): number[] => {
    const current = Array.isArray(list) ? list : [];
    return current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
  };

  const daysLabel = (list?: number[]) => {
    if (!list || list.length === 0) return "All days";
    return list.map((d) => DAY_OPTIONS.find((o) => o.value === String(d))?.label.slice(0, 3) || String(d)).join(", ");
  };

  const canAdd =
    !allDaysTaken &&
    /^\d{1,2}:\d{2}$/.test(draft.cutoffTime) &&
    draft.bonusAmountPerHour !== "" &&
    parseFloat(draft.bonusAmountPerHour) > 0 &&
    draft.minHoursThreshold !== "" &&
    parseFloat(draft.minHoursThreshold) >= 0 &&
    !draftHasConflict;

  return (
    <div className="p-3 rounded-lg border bg-card space-y-3" data-testid="editor-early-arrival-bonuses">
      <div>
        <Label className="font-medium">Early-Arrival Bonus Rules</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Use this to grant an extra per-hour bonus when employees clock in before a specific time (e.g. an early-shift premium). For each rule, choose whether the bonus pays for the entire shift or only for the hours worked before the cutoff.
        </p>
      </div>

      {bonuses.length > 0 && (
        <div className="space-y-2">
          {bonuses.map((b, idx) => {
            const overlapInfo = overlaps.get(b.id);
            return (
            <div
              key={b.id}
              className={`p-2 rounded-md border space-y-2 ${overlapInfo ? "border-destructive bg-destructive/5" : "bg-muted/30"}`}
              data-testid={`row-early-bonus-${b.id}`}
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <div>
                  <Label className="text-xs">Clock-in before</Label>
                  <Input
                    type="time"
                    value={b.cutoffTime}
                    onChange={(e) => updateBonus(b.id, { cutoffTime: e.target.value })}
                    data-testid={`input-edit-early-cutoff-${b.id}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Bonus / hour ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={b.bonusAmountPerHour}
                    onChange={(e) => {
                      const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
                      updateBonus(b.id, { bonusAmountPerHour: Number.isNaN(v) ? 0 : Math.max(0, v) });
                    }}
                    data-testid={`input-edit-early-amount-${b.id}`}
                  />
                </div>
                <div>
                  <Label className="text-xs">Min Hours</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.25"
                    value={b.minHoursThreshold}
                    onChange={(e) => {
                      const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
                      updateBonus(b.id, { minHoursThreshold: Number.isNaN(v) ? 0 : Math.max(0, v) });
                    }}
                    data-testid={`input-edit-early-threshold-${b.id}`}
                  />
                </div>
                <div className="flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeBonus(b.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    data-testid={`button-remove-early-bonus-${b.id}`}
                  >
                    &times;
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Days of week (leave all unchecked to apply every day)</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {DAY_OPTIONS.map((o) => {
                    const dayNum = parseInt(o.value, 10);
                    const active = Array.isArray(b.daysOfWeek) && b.daysOfWeek.includes(dayNum);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          const next = toggleDay(b.daysOfWeek, dayNum);
                          updateBonus(b.id, { daysOfWeek: next.length === 0 ? undefined : next });
                        }}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/40"
                        }`}
                        data-testid={`button-edit-early-day-${b.id}-${o.value}`}
                      >
                        {o.label.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-xs">Apply to</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {[
                    { value: "entire_shift", label: "Entire shift" },
                    { value: "before_cutoff", label: "Only hours before cutoff" },
                  ].map((opt) => {
                    const current = b.applyScope === "before_cutoff" ? "before_cutoff" : "entire_shift";
                    const active = current === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateBonus(b.id, { applyScope: opt.value as "entire_shift" | "before_cutoff" })}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/40"
                        }`}
                        data-testid={`button-edit-early-scope-${b.id}-${opt.value}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-xs">
                  Before {b.cutoffTime} → +${(b.bonusAmountPerHour || 0).toFixed(2)}/hr × {b.applyScope === "before_cutoff" ? "hours before cutoff" : "hours worked"}
                </Badge>
                <Badge variant="outline" className="text-xs">Min {b.minHoursThreshold}h</Badge>
                <Badge variant="outline" className="text-xs">{daysLabel(b.daysOfWeek)}</Badge>
              </div>
              {[
                errors[`earlyArrivalBonuses.${idx}.cutoffTime`],
                errors[`earlyArrivalBonuses.${idx}.bonusAmountPerHour`],
                errors[`earlyArrivalBonuses.${idx}.minHoursThreshold`],
                errors[`earlyArrivalBonuses.${idx}.daysOfWeek`],
              ].filter(Boolean).map((msg, i) => (
                <p key={i} className="text-sm text-destructive flex items-center gap-1" data-testid={`error-early-bonus-${b.id}-${i}`}>
                  <AlertCircle className="h-3 w-3" /> {msg}
                </p>
              ))}
              {overlapInfo && (
                <p className="text-sm text-destructive flex items-center gap-1" data-testid={`error-early-bonus-overlap-${b.id}`}>
                  <AlertCircle className="h-3 w-3" /> Day(s) overlap with another rule: {describeDays(overlapInfo.conflictingDays)}. Only one early-arrival rule can apply per day — edit or remove the conflicting rule.
                </p>
              )}
            </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <div>
            <Label className="text-xs">Clock-in before</Label>
            <Input
              type="time"
              value={draft.cutoffTime}
              onChange={(e) => setDraft({ ...draft, cutoffTime: e.target.value })}
              data-testid="input-early-cutoff"
            />
          </div>
          <div>
            <Label className="text-xs">Bonus / hour ($)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={draft.bonusAmountPerHour}
              onChange={(e) => setDraft({ ...draft, bonusAmountPerHour: e.target.value })}
              placeholder="2.50"
              data-testid="input-early-amount"
            />
          </div>
          <div>
            <Label className="text-xs">Min Hours (optional)</Label>
            <Input
              type="number"
              min={0}
              step="0.25"
              value={draft.minHoursThreshold}
              onChange={(e) => setDraft({ ...draft, minHoursThreshold: e.target.value })}
              data-testid="input-early-threshold"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={addBonus}
            disabled={!canAdd}
            data-testid="button-add-early-bonus"
          >
            Add Bonus
          </Button>
        </div>
        <div>
          <Label className="text-xs">Days of week (leave all unchecked to apply every day)</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {DAY_OPTIONS.map((o) => {
              const dayNum = parseInt(o.value, 10);
              const active = draft.daysOfWeek.includes(dayNum);
              const taken = coveredDays.has(dayNum) && !active;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, daysOfWeek: toggleDay(draft.daysOfWeek, dayNum) })}
                  disabled={taken}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : taken
                        ? "bg-muted text-muted-foreground border-muted cursor-not-allowed opacity-60"
                        : "bg-background hover:border-primary/40"
                  }`}
                  title={taken ? `${o.label} already has a rule` : undefined}
                  data-testid={`button-early-day-${o.value}`}
                >
                  {o.label.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label className="text-xs">Apply to</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {[
              { value: "entire_shift", label: "Entire shift" },
              { value: "before_cutoff", label: "Only hours before cutoff" },
            ].map((opt) => {
              const active = draft.applyScope === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, applyScope: opt.value as "entire_shift" | "before_cutoff" })}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/40"
                  }`}
                  data-testid={`button-early-scope-${opt.value}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            "Entire shift" pays the bonus on every hour worked. "Only hours before cutoff" pays only for time worked before the cutoff (e.g. clock-in 05:00 with a 07:00 cutoff = 2 bonus hours).
          </p>
        </div>
        {allDaysTaken ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1" data-testid="hint-early-bonus-all-days-taken">
            <AlertCircle className="h-3 w-3" /> All days already have a rule. Edit or remove an existing rule to add a different one.
          </p>
        ) : draftConflictMessage ? (
          <p className="text-sm text-destructive flex items-center gap-1" data-testid="error-early-bonus-draft-conflict">
            <AlertCircle className="h-3 w-3" /> {draftConflictMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PayrollRuleGroupCard({
  group, rulesForm, setRulesForm, errors,
}: {
  group: PayrollRuleGroup;
  rulesForm: Record<string, any>;
  setRulesForm: (v: Record<string, any>) => void;
  errors: Record<string, string>;
}) {
  if (group.kind === "static") {
    const field = group.field;
    return (
      <div className="p-3 rounded-lg border bg-card" data-testid={`payroll-rule-group-${field.key}`}>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <Label className="font-medium">{group.title}</Label>
            {group.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
            )}
          </div>
        </div>
        {field.type === "select" ? (
          <Select
            value={rulesForm[field.key] || field.defaultValue}
            onValueChange={(v) => setRulesForm({ ...rulesForm, [field.key]: v })}
          >
            <SelectTrigger data-testid={`select-wizard-rule-${field.key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={field.type}
            value={rulesForm[field.key] ?? ""}
            onChange={(e) => setRulesForm({
              ...rulesForm,
              [field.key]: field.type === "number"
                ? (e.target.value === "" ? "" : parseFloat(e.target.value))
                : e.target.value,
            })}
            min={field.min}
            max={field.max}
            data-testid={`input-wizard-rule-${field.key}`}
          />
        )}
      </div>
    );
  }

  // toggle group
  const enabled = isPayrollRuleEnabled(rulesForm, group.enabledKey);
  return (
    <div
      className="p-3 rounded-lg border bg-card"
      data-testid={`payroll-rule-group-${group.enabledKey}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <Label className="font-medium">{group.title}</Label>
          {group.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
          )}
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => setRulesForm({ ...rulesForm, [group.enabledKey]: v })}
          data-testid={`switch-wizard-rule-${group.enabledKey}`}
        />
      </div>
      {group.fields.length > 0 && (
        <div
          className={`mt-3 space-y-3 ${enabled ? "" : "opacity-50 pointer-events-none"}`}
          aria-disabled={!enabled}
          data-testid={`payroll-rule-group-fields-${group.enabledKey}`}
        >
          {group.fields.map((field) => (
            <div key={field.key}>
              <Label className="text-sm">{field.label}</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">{field.description}</p>
              <Input
                type={field.type}
                value={rulesForm[field.key] ?? ""}
                onChange={(e) => setRulesForm({
                  ...rulesForm,
                  [field.key]: field.type === "number"
                    ? (e.target.value === "" ? "" : parseFloat(e.target.value))
                    : e.target.value,
                })}
                min={field.min}
                max={field.max}
                disabled={!enabled}
                data-testid={`input-wizard-rule-${field.key}`}
              />
              {enabled && errors[field.key] && (
                <p className="text-sm text-destructive mt-1 flex items-center gap-1" data-testid={`error-rule-${field.key}`}>
                  <AlertCircle className="h-3 w-3" /> {errors[field.key]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NonPayrollRuleFieldEditor({
  field, rulesForm, setRulesForm, errors,
}: {
  field: RuleFieldDef;
  rulesForm: Record<string, any>;
  setRulesForm: (v: Record<string, any>) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="p-3 rounded-lg border bg-card" data-testid={`rule-field-${field.key}`}>
      {field.type === "boolean" ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="font-medium">{field.label}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
          </div>
          <Switch
            checked={!!rulesForm[field.key]}
            onCheckedChange={(v) => setRulesForm({ ...rulesForm, [field.key]: v })}
            data-testid={`switch-wizard-rule-${field.key}`}
          />
        </div>
      ) : field.type === "select" ? (
        <div>
          <Label className="font-medium">{field.label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">{field.description}</p>
          <Select
            value={
              field.nullable
                ? (rulesForm[field.key] ? String(rulesForm[field.key]) : PAYDAY_UNSET_VALUE)
                : (rulesForm[field.key] || field.defaultValue)
            }
            onValueChange={(v) =>
              setRulesForm({
                ...rulesForm,
                [field.key]: field.nullable && v === PAYDAY_UNSET_VALUE ? null : v,
              })
            }
          >
            <SelectTrigger data-testid={`select-wizard-rule-${field.key}`}>
              <SelectValue placeholder={field.nullable ? "Not set" : undefined} />
            </SelectTrigger>
            <SelectContent>
              {field.nullable && (
                <SelectItem value={PAYDAY_UNSET_VALUE}>Not set</SelectItem>
              )}
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div>
          <Label className="font-medium">{field.label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">{field.description}</p>
          <Input
            type={field.type}
            value={rulesForm[field.key] ?? ""}
            onChange={(e) => setRulesForm({
              ...rulesForm,
              [field.key]: field.type === "number"
                ? (e.target.value === "" ? "" : parseFloat(e.target.value))
                : e.target.value,
            })}
            min={field.min}
            max={field.max}
            data-testid={`input-wizard-rule-${field.key}`}
          />
          {errors[field.key] && (
            <p className="text-sm text-destructive mt-1 flex items-center gap-1" data-testid={`error-rule-${field.key}`}>
              <AlertCircle className="h-3 w-3" /> {errors[field.key]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface RuleTabSpec {
  id: string;
  label: string;
  hasError: boolean;
  isOff?: boolean;
  content: React.ReactNode;
}

function StepRules({
  ruleFields, rulesForm, setRulesForm, errors, policyTypeKey, dowOverlaps, earlyOverlaps,
}: {
  ruleFields: RuleFieldDef[];
  rulesForm: Record<string, any>;
  setRulesForm: (v: Record<string, any>) => void;
  errors: Record<string, string>;
  policyTypeKey: string;
  dowOverlaps: Map<string, OverlapInfo>;
  earlyOverlaps: Map<string, OverlapInfo>;
}) {
  if (ruleFields.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="wizard-step-rules">
        <p>No configurable rules for this policy type.</p>
      </div>
    );
  }

  const hasOverlapErrors = dowOverlaps.size > 0 || earlyOverlaps.size > 0;

  const tabs: RuleTabSpec[] = [];

  if (policyTypeKey === "payroll") {
    for (const group of getPayrollRuleGroups(ruleFields)) {
      if (group.kind === "static") {
        const field = group.field;
        tabs.push({
          id: slugifyLabel(group.title),
          label: group.title,
          hasError: !!errors[field.key],
          content: (
            <PayrollRuleGroupCard
              group={group}
              rulesForm={rulesForm}
              setRulesForm={setRulesForm}
              errors={errors}
            />
          ),
        });
      } else {
        const enabled = isPayrollRuleEnabled(rulesForm, group.enabledKey);
        const hasError = enabled && group.fields.some((f) => !!errors[f.key]);
        tabs.push({
          id: slugifyLabel(group.title),
          label: group.title,
          hasError,
          isOff: !enabled,
          content: (
            <PayrollRuleGroupCard
              group={group}
              rulesForm={rulesForm}
              setRulesForm={setRulesForm}
              errors={errors}
            />
          ),
        });
      }
    }
    tabs.push({
      id: "day-of-week-bonus",
      label: "Day-of-Week Bonuses",
      hasError:
        dowOverlaps.size > 0 ||
        Object.keys(errors).some((k) => k.startsWith("dayOfWeekBonuses.")),
      content: (
        <DayOfWeekBonusEditor
          bonuses={Array.isArray(rulesForm.dayOfWeekBonuses) ? rulesForm.dayOfWeekBonuses : []}
          onChange={(next) => setRulesForm({ ...rulesForm, dayOfWeekBonuses: next })}
          overlaps={dowOverlaps}
        />
      ),
    });
    tabs.push({
      id: "early-arrival-bonus",
      label: "Early-Arrival Bonuses",
      hasError:
        earlyOverlaps.size > 0 ||
        Object.keys(errors).some((k) => k.startsWith("earlyArrivalBonuses.")),
      content: (
        <EarlyArrivalBonusEditor
          bonuses={Array.isArray(rulesForm.earlyArrivalBonuses) ? rulesForm.earlyArrivalBonuses : []}
          onChange={(next) => setRulesForm({ ...rulesForm, earlyArrivalBonuses: next })}
          errors={errors}
          overlaps={earlyOverlaps}
        />
      ),
    });
  } else {
    for (const field of ruleFields) {
      tabs.push({
        id: slugifyLabel(field.label),
        label: field.label,
        hasError: !!errors[field.key],
        content: (
          <NonPayrollRuleFieldEditor
            field={field}
            rulesForm={rulesForm}
            setRulesForm={setRulesForm}
            errors={errors}
          />
        ),
      });
    }
  }

  return (
    <div className="space-y-6" data-testid="wizard-step-rules">
      <div>
        <h3 className="text-base font-semibold mb-1">Configure Rules</h3>
        <p className="text-sm text-muted-foreground">
          Set the rules for your {getPolicyTypeLabel(policyTypeKey).toLowerCase()} policy. Defaults are pre-filled.
        </p>
      </div>

      {hasOverlapErrors && (
        <div
          className="rounded-md border border-destructive bg-destructive/10 p-3 flex items-start gap-2"
          data-testid="alert-bonus-overlaps"
        >
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <div className="text-sm text-destructive">
            <p className="font-medium">Overlapping bonus rules detected.</p>
            <p className="mt-0.5">
              Each day can only be covered by one Day-of-Week rule and one Early-Arrival rule. Resolve the conflicts highlighted below before continuing — the payroll engine would otherwise stack these bonuses for the same shift.
            </p>
          </div>
        </div>
      )}

      {tabs.length === 1 ? (
        <div className="space-y-4">{tabs[0].content}</div>
      ) : (
        <Tabs defaultValue={tabs[0]?.id} className="w-full">
          <TabsList className="flex flex-wrap h-auto justify-start gap-1 bg-muted/50 p-1">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                data-testid={`tab-rule-${t.id}`}
                className="gap-2"
              >
                <span>{t.label}</span>
                {t.isOff && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 h-4 leading-none"
                    data-testid={`badge-rule-off-${t.id}`}
                  >
                    Off
                  </Badge>
                )}
                {t.hasError && (
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-destructive"
                    data-testid={`indicator-rule-error-${t.id}`}
                    aria-label="Has validation error"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-4">
              {t.content}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function StepAssignments({
  assignments, setAssignments,
  divisions, locations, departments, users, roles,
}: {
  assignments: AssignmentEntry[];
  setAssignments: (v: AssignmentEntry[]) => void;
  divisions: Division[];
  locations: Location[];
  departments: Department[];
  users: User[];
  roles: Role[];
}) {
  const [addLevel, setAddLevel] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const lastToggleRef = useRef<Record<string, number>>({});

  const getOptions = (): { id: string; label: string }[] => {
    switch (addLevel) {
      case "division":
        return divisions.map((d) => ({ id: d.id, label: d.name }));
      case "location":
        return locations.map((l) => ({ id: l.id, label: l.name }));
      case "department":
        return departments.map((d) => ({ id: d.id, label: d.name }));
      case "employee":
        return users.map((u) => ({ id: u.id, label: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || u.id }));
      case "role":
        return roles.map((r) => ({ id: r.id, label: r.name }));
      case "employment_type":
        return EMPLOYMENT_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }));
      case "pay_type":
        return PAY_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }));
      default:
        return [];
    }
  };

  const options = getOptions();

  const levelAvailability: Record<string, { count: number; emptyHint: string }> = {
    division: { count: divisions.length, emptyHint: "No companies exist yet — create one in Locations & Departments first" },
    location: { count: locations.length, emptyHint: "No locations exist yet — create one in Locations & Departments first" },
    department: { count: departments.length, emptyHint: "No departments exist yet — create one in Locations & Departments first" },
    employee: { count: users.length, emptyHint: "No employees exist yet — add one in Employees first" },
    role: { count: roles.length, emptyHint: "No roles exist yet — create one in Roles & Permissions first" },
    employment_type: { count: EMPLOYMENT_TYPE_OPTIONS.length, emptyHint: "" },
    pay_type: { count: PAY_TYPE_OPTIONS.length, emptyHint: "" },
  };
  const currentLevelEmpty = !!addLevel && levelAvailability[addLevel]?.count === 0;
  const currentLevelEmptyHint = currentLevelEmpty ? levelAvailability[addLevel]?.emptyHint : "";

  // "No targets of any kind" = every real-world assignment target is empty.
  // Employment Type / Pay Type are static option lists, not data the admin can
  // create, so they don't count toward this check.
  const noDynamicTargetsExist =
    divisions.length === 0 &&
    locations.length === 0 &&
    departments.length === 0 &&
    users.length === 0 &&
    roles.length === 0;

  const isAlreadyAssigned = (id: string) =>
    assignments.some((a) => a.level === addLevel && a.id === id);

  const toggleSelected = (id: string) => {
    if (isAlreadyAssigned(id)) return;
    const now = Date.now();
    const last = lastToggleRef.current[id] || 0;
    if (now - last < 250) return;
    lastToggleRef.current[id] = now;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addAssignments = () => {
    if (!addLevel || selectedIds.length === 0) return;
    const newEntries: AssignmentEntry[] = [];
    selectedIds.forEach((id) => {
      if (isAlreadyAssigned(id)) return;
      const match = options.find((o) => o.id === id);
      newEntries.push({ level: addLevel, id, label: match?.label || id });
    });
    if (newEntries.length === 0) return;
    setAssignments([...assignments, ...newEntries]);
    setSelectedIds([]);
    setPopoverOpen(false);
  };

  const removeAssignment = (index: number) => {
    setAssignments(assignments.filter((_, i) => i !== index));
  };

  const targetButtonLabel = () => {
    if (!addLevel) return "Select level first";
    if (selectedIds.length === 0) return `Select ${getAssignmentLevelLabel(addLevel).toLowerCase()}...`;
    if (selectedIds.length === 1) {
      return options.find((o) => o.id === selectedIds[0])?.label || "1 selected";
    }
    return `${selectedIds.length} selected`;
  };

  return (
    <div className="space-y-6" data-testid="wizard-step-assignments">
      <div>
        <h3 className="text-base font-semibold mb-1">Assign Policy</h3>
        <p className="text-sm text-muted-foreground">
          Choose which companies, locations, departments, employees, roles, employment types, or pay types this policy applies to.
          You can skip this step and assign later.
        </p>
      </div>

      {noDynamicTargetsExist && (
        <div
          className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-3 py-2"
          data-testid="text-wizard-no-targets"
        >
          No assignment targets are currently available. Create a department, location, role, or employee group before assigning this policy.
        </div>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label>Level</Label>
          <Select
            value={addLevel}
            onValueChange={(v) => { setAddLevel(v); setSelectedIds([]); }}
          >
            <SelectTrigger data-testid="select-wizard-assign-level">
              <SelectValue placeholder="Select level..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="division">
                Company (Org-wide){divisions.length === 0 ? " — none yet" : ""}
              </SelectItem>
              <SelectItem value="location">
                Location{locations.length === 0 ? " — none yet" : ""}
              </SelectItem>
              <SelectItem value="department">
                Department{departments.length === 0 ? " — none yet" : ""}
              </SelectItem>
              <SelectItem value="employee">
                Individual Employee{users.length === 0 ? " — none yet" : ""}
              </SelectItem>
              <SelectItem value="role">
                Role{roles.length === 0 ? " — none yet" : ""}
              </SelectItem>
              <SelectItem value="employment_type">Employment Type</SelectItem>
              <SelectItem value="pay_type">Pay Type</SelectItem>
            </SelectContent>
          </Select>
          {currentLevelEmpty && currentLevelEmptyHint && (
            <p
              className="text-xs text-muted-foreground mt-1"
              data-testid="text-wizard-level-empty-hint"
            >
              {currentLevelEmptyHint}
            </p>
          )}
        </div>
        <div className="flex-1">
          <Label>Target</Label>
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                disabled={!addLevel}
                className="w-full justify-between font-normal"
                data-testid="select-wizard-assign-target"
              >
                <span className={selectedIds.length === 0 && addLevel ? "text-muted-foreground" : ""}>
                  {targetButtonLabel()}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50 ml-2" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search..." />
                <CommandList>
                  <CommandEmpty data-testid="text-wizard-target-empty">
                    {currentLevelEmpty
                      ? `No ${getAssignmentLevelLabel(addLevel).toLowerCase()} options are available.`
                      : "No options found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {options.map((opt) => {
                      const alreadyAssigned = isAlreadyAssigned(opt.id);
                      const isChecked = alreadyAssigned || selectedIds.includes(opt.id);
                      return (
                        <CommandItem
                          key={opt.id}
                          value={`${opt.label} ${opt.id}`}
                          disabled={alreadyAssigned}
                          onSelect={() => toggleSelected(opt.id)}
                          data-testid={`option-wizard-target-${opt.id}`}
                          className={alreadyAssigned ? "opacity-60" : "cursor-pointer"}
                          onMouseDown={(e) => {
                            if (alreadyAssigned) return;
                            e.preventDefault();
                            toggleSelected(opt.id);
                          }}
                          onTouchEnd={(e) => {
                            if (alreadyAssigned) return;
                            e.preventDefault();
                            toggleSelected(opt.id);
                          }}
                        >
                          <Checkbox
                            checked={isChecked}
                            disabled={alreadyAssigned}
                            className="mr-2 pointer-events-none"
                          />
                          <span className="flex-1 pointer-events-none">{opt.label}</span>
                          {alreadyAssigned && (
                            <span className="text-xs text-muted-foreground ml-2 pointer-events-none">Added</span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          onClick={addAssignments}
          disabled={!addLevel || selectedIds.length === 0}
          size="sm"
          data-testid="button-wizard-add-assignment"
        >
          Add
        </Button>
      </div>

      {assignments.length > 0 ? (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Current Assignments</Label>
          {assignments.some((a) => a.level === LEGACY_GLOBAL_LEVEL) && (
            <div
              className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2"
              data-testid="text-legacy-global-warning"
            >
              This policy has a legacy "Applies to all" row that's no longer supported. It will be removed on save — replace it with a specific company, location, role, or other target if you want this policy to keep applying.
            </div>
          )}
          {assignments.map((a, i) => (
            <div
              key={`${a.level}-${a.id}-${i}`}
              className="flex items-center justify-between p-2 rounded-md border bg-muted/30"
              data-testid={`assignment-entry-${i}`}
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant={a.level === LEGACY_GLOBAL_LEVEL ? "secondary" : "outline"}
                  className="text-xs"
                >
                  {getAssignmentLevelLabel(a.level)}
                </Badge>
                {a.level !== LEGACY_GLOBAL_LEVEL && (
                  <span className="text-sm">{a.label}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAssignment(i)}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                data-testid={`button-remove-assignment-${i}`}
              >
                &times;
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-muted-foreground border rounded-lg border-dashed" data-testid="text-no-wizard-assignments">
          <p className="text-sm">No assignments yet. This policy can be assigned after creation.</p>
        </div>
      )}
    </div>
  );
}

function StepReview({
  name, description, selectedTypeKey, rulesForm, ruleFields, assignments,
}: {
  name: string;
  description: string;
  selectedTypeKey: string;
  rulesForm: Record<string, any>;
  ruleFields: RuleFieldDef[];
  assignments: AssignmentEntry[];
}) {
  return (
    <div className="space-y-6" data-testid="wizard-step-review">
      <div>
        <h3 className="text-base font-semibold mb-1">Review Policy</h3>
        <p className="text-sm text-muted-foreground">Review your settings before saving.</p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Policy Type</Label>
          <p className="font-medium" data-testid="review-type">{getPolicyTypeLabel(selectedTypeKey)}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Name</Label>
          <p className="font-medium" data-testid="review-name">{name}</p>
        </div>
        {description && (
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Description</Label>
            <p className="text-sm" data-testid="review-description">{description}</p>
          </div>
        )}
      </div>

      {ruleFields.length > 0 && (
        <div className="rounded-lg border p-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-3 block">Rules Configuration</Label>
          {(() => {
            const formatFieldDisplay = (field: RuleFieldDef): string => {
              const raw = rulesForm[field.key];
              if (field.type === "boolean") {
                return raw ? "Yes" : "No";
              }
              if (field.type === "select") {
                if (raw === null || raw === undefined || raw === "") {
                  return field.nullable ? "Not set" : "—";
                }
                const match = field.options?.find((o) => o.value === String(raw));
                return match?.label ?? String(raw);
              }
              return raw === undefined || raw === null || raw === "" ? "—" : String(raw);
            };

            if (selectedTypeKey === "payroll") {
              return (
                <div className="space-y-1">
                  {getPayrollRuleGroups(ruleFields).map((group) => {
                    if (group.kind === "static") {
                      const field = group.field;
                      return (
                        <div
                          key={`static-${field.key}`}
                          className="text-sm"
                          data-testid={`review-rule-${field.key}`}
                        >
                          <span className="text-muted-foreground">{group.title}:</span>{" "}
                          <span className="font-medium">{formatFieldDisplay(field)}</span>
                        </div>
                      );
                    }
                    const enabled = isPayrollRuleEnabled(rulesForm, group.enabledKey);
                    return (
                      <div
                        key={`toggle-${group.enabledKey}`}
                        className="text-sm"
                        data-testid={`review-rule-${group.enabledKey}`}
                      >
                        {enabled ? (
                          group.fields.length === 0 ? (
                            <>
                              <span className="text-muted-foreground">{group.title}:</span>{" "}
                              <span className="font-medium">On</span>
                            </>
                          ) : (
                            <>
                              <span className="text-muted-foreground">{group.title}:</span>{" "}
                              <span className="font-medium">
                                {group.fields
                                  .map((f) => `${f.label} = ${formatFieldDisplay(f)}`)
                                  .join(", ")}
                              </span>
                            </>
                          )
                        ) : (
                          <span
                            className="font-medium text-muted-foreground"
                            data-testid={`review-rule-off-${group.enabledKey}`}
                          >
                            {group.offSummary}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ruleFields.map((field) => (
                  <div key={field.key} className="text-sm" data-testid={`review-rule-${field.key}`}>
                    <span className="text-muted-foreground">{field.label}:</span>{" "}
                    <span className="font-medium">{formatFieldDisplay(field)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          {selectedTypeKey === "payroll" && Array.isArray(rulesForm.dayOfWeekBonuses) && rulesForm.dayOfWeekBonuses.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Day-of-Week Bonuses</Label>
              <div className="flex flex-wrap gap-2">
                {rulesForm.dayOfWeekBonuses.map((b: DayOfWeekBonus) => (
                  <Badge key={b.id} variant="outline" className="text-xs" data-testid={`review-dow-bonus-${b.id}`}>
                    {DAY_OPTIONS.find((o) => o.value === String(b.dayOfWeek))?.label} ≥ {b.minHoursThreshold}h →{" "}
                    {b.bonusType === "money" ? `$${b.bonusAmount.toFixed(2)}` : `+${b.bonusAmount}h`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {selectedTypeKey === "payroll" && Array.isArray(rulesForm.earlyArrivalBonuses) && rulesForm.earlyArrivalBonuses.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Early-Arrival Bonuses</Label>
              <div className="flex flex-wrap gap-2">
                {rulesForm.earlyArrivalBonuses.map((b: EarlyArrivalBonus) => {
                  const days = Array.isArray(b.daysOfWeek) && b.daysOfWeek.length > 0
                    ? b.daysOfWeek.map((d) => DAY_OPTIONS.find((o) => o.value === String(d))?.label.slice(0, 3) || String(d)).join(", ")
                    : "all days";
                  return (
                    <Badge key={b.id} variant="outline" className="text-xs" data-testid={`review-early-bonus-${b.id}`}>
                      Before {b.cutoffTime} → +${(b.bonusAmountPerHour || 0).toFixed(2)}/hr · min {b.minHoursThreshold}h · {days} · {b.applyScope === "before_cutoff" ? "before cutoff only" : "entire shift"}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border p-4">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-3 block">Assignments</Label>
        {assignments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {assignments.map((a, i) => (
              <Badge key={i} variant="secondary" className="text-xs" data-testid={`review-assignment-${i}`}>
                <span className="mr-1 opacity-70">{getAssignmentLevelLabel(a.level)} ·</span> {a.label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="review-no-assignments">
            No assignments configured. You can assign this policy after creation.
          </p>
        )}
      </div>
    </div>
  );
}