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
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Check, Clock, CalendarDays,
  DollarSign, GitBranch, AlertCircle
} from "lucide-react";
import type { Policy, PolicyType, Division, Location, Department, User, PolicyAssignment } from "@shared/schema";

const STEPS = [
  { label: "Basics", description: "Name and type" },
  { label: "Rules", description: "Configure settings" },
  { label: "Assignments", description: "Apply to groups" },
  { label: "Review", description: "Confirm and save" },
];

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
        { key: "accrualRate", label: "Accrual Rate (days/year)", type: "number", description: "Number of PTO days accrued per year", defaultValue: 15, min: 0, max: 365 },
        { key: "maxConsecutiveDays", label: "Max Consecutive Days", type: "number", description: "Maximum number of consecutive PTO days allowed", defaultValue: 10, min: 1, max: 90 },
        { key: "requireApproval", label: "Require Approval", type: "boolean", description: "Require manager approval for PTO requests", defaultValue: true },
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
        { key: "autoApproveThreshold", label: "Auto-Approve Threshold (days)", type: "number", description: "Automatically approve PTO requests of this length or shorter (0 = disabled)", defaultValue: 0, min: 0, max: 30 },
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

  const { data: policyTypes } = useQuery<PolicyType[]>({ queryKey: ["/api/policy-types"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });

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
  ): AssignmentEntry[] {
    return assigns.map((a) => {
      if (a.userId) {
        const user = usrs.find((u) => u.id === a.userId);
        return { level: "employee", id: a.userId, label: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Employee" : "Employee" };
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
        return { level: "division", id: a.companyId, label: div?.name || "Division" };
      }
      return { level: "division", id: "", label: "Global" };
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
          divisions || [], locations || [], departments || [], users || [],
        ));
      } else {
        setAssignments([]);
      }
      setSaveStatus(editingPolicy.status === "active" ? "active" : "draft");
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
    }
  }, [open, editingPolicy, policyTypeKey, existingRules, existingAssignments, policyTypes, users, departments, locations, divisions]);

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
    }
  }, [selectedTypeKey, open, editingPolicy]);

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    if (step === 0) {
      if (!name.trim()) newErrors.name = "Policy name is required";
      if (!selectedTypeKey) newErrors.type = "Please select a policy type";
    }
    if (step === 1) {
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
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const goBack = () => {
    setErrors({});
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const saveMutation = useMutation({
    mutationFn: async (targetStatus: "draft" | "active") => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        policyTypeId: matchingType?.id,
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

      if (assignments.length > 0) {
        for (const a of assignments) {
          const assignPayload: Record<string, string | null> = {
            policyId,
            companyId: null,
            locationId: null,
            departmentId: null,
            userId: null,
          };
          if (a.level === "division") assignPayload.companyId = a.id;
          if (a.level === "location") assignPayload.locationId = a.id;
          if (a.level === "department") assignPayload.departmentId = a.id;
          if (a.level === "employee") assignPayload.userId = a.id;
          await apiRequest("POST", "/api/policy-assignments", assignPayload);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-assignments"] });
      if (editingPolicy?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/policies", editingPolicy.id, "rules"] });
      }
      onOpenChange(false);
      toast({ title: editingPolicy ? "Policy updated" : "Policy created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const progressValue = ((currentStep + 1) / STEPS.length) * 100;

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
            {STEPS.map((step, i) => (
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
          {currentStep === 0 && (
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
          {currentStep === 1 && (
            <StepRules
              ruleFields={visibleRuleFields}
              rulesForm={rulesForm}
              setRulesForm={setRulesForm}
              errors={errors}
              policyTypeKey={selectedTypeKey}
            />
          )}
          {currentStep === 2 && (
            <StepAssignments
              assignments={assignments}
              setAssignments={setAssignments}
              divisions={divisions || []}
              locations={locations || []}
              departments={departments || []}
              users={users || []}
            />
          )}
          {currentStep === 3 && (
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
            {currentStep < STEPS.length - 1 ? (
              <Button onClick={goNext} data-testid="button-wizard-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => { setSaveStatus("draft"); saveMutation.mutate("draft"); }}
                  disabled={saveMutation.isPending}
                  data-testid="button-wizard-save-draft"
                >
                  {saveMutation.isPending && saveStatus === "draft" ? "Saving..." : "Save as Draft"}
                </Button>
                <Button
                  onClick={() => { setSaveStatus("active"); saveMutation.mutate("active"); }}
                  disabled={saveMutation.isPending}
                  data-testid="button-wizard-activate"
                >
                  {saveMutation.isPending && saveStatus === "active" ? "Activating..." : "Save & Activate"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  bonuses, onChange,
}: {
  bonuses: DayOfWeekBonus[];
  onChange: (next: DayOfWeekBonus[]) => void;
}) {
  const [draft, setDraft] = useState<{ dayOfWeek: string; minHoursThreshold: string; bonusType: "money" | "hours"; bonusAmount: string }>({
    dayOfWeek: "0",
    minHoursThreshold: "8",
    bonusType: "money",
    bonusAmount: "",
  });

  const addBonus = () => {
    const threshold = parseFloat(draft.minHoursThreshold);
    const amount = parseFloat(draft.bonusAmount);
    if (Number.isNaN(threshold) || threshold < 0) return;
    if (Number.isNaN(amount) || amount <= 0) return;
    const next: DayOfWeekBonus = {
      id: `dow-bonus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dayOfWeek: parseInt(draft.dayOfWeek, 10),
      minHoursThreshold: threshold,
      bonusType: draft.bonusType,
      bonusAmount: amount,
    };
    onChange([...bonuses, next]);
    setDraft({ ...draft, bonusAmount: "" });
  };

  const removeBonus = (id: string) => {
    onChange(bonuses.filter((b) => b.id !== id));
  };

  const updateBonus = (id: string, patch: Partial<DayOfWeekBonus>) => {
    onChange(bonuses.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const canAdd =
    draft.dayOfWeek !== "" &&
    draft.minHoursThreshold !== "" &&
    parseFloat(draft.minHoursThreshold) >= 0 &&
    draft.bonusAmount !== "" &&
    parseFloat(draft.bonusAmount) > 0;

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
          {bonuses.map((b) => (
            <div
              key={b.id}
              className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-2 rounded-md border bg-muted/30"
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
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <Label className="text-xs">Day</Label>
          <Select value={draft.dayOfWeek} onValueChange={(v) => setDraft({ ...draft, dayOfWeek: v })}>
            <SelectTrigger data-testid="select-dow-bonus-day"><SelectValue /></SelectTrigger>
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
  bonuses, onChange, errors,
}: {
  bonuses: EarlyArrivalBonus[];
  onChange: (next: EarlyArrivalBonus[]) => void;
  errors: Record<string, string>;
}) {
  const [draft, setDraft] = useState<{ cutoffTime: string; bonusAmountPerHour: string; minHoursThreshold: string; daysOfWeek: number[]; applyScope: "entire_shift" | "before_cutoff" }>({
    cutoffTime: "07:00",
    bonusAmountPerHour: "",
    minHoursThreshold: "0",
    daysOfWeek: [],
    applyScope: "entire_shift",
  });

  const addBonus = () => {
    const perHour = parseFloat(draft.bonusAmountPerHour);
    const threshold = parseFloat(draft.minHoursThreshold);
    if (!/^\d{1,2}:\d{2}$/.test(draft.cutoffTime)) return;
    if (Number.isNaN(perHour) || perHour <= 0) return;
    if (Number.isNaN(threshold) || threshold < 0) return;
    const next: EarlyArrivalBonus = {
      id: `early-bonus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cutoffTime: draft.cutoffTime,
      bonusAmountPerHour: perHour,
      minHoursThreshold: threshold,
      daysOfWeek: draft.daysOfWeek.length > 0 ? [...draft.daysOfWeek].sort() : undefined,
      applyScope: draft.applyScope,
    };
    onChange([...bonuses, next]);
    setDraft({ ...draft, bonusAmountPerHour: "" });
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
    /^\d{1,2}:\d{2}$/.test(draft.cutoffTime) &&
    draft.bonusAmountPerHour !== "" &&
    parseFloat(draft.bonusAmountPerHour) > 0 &&
    draft.minHoursThreshold !== "" &&
    parseFloat(draft.minHoursThreshold) >= 0;

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
          {bonuses.map((b, idx) => (
            <div
              key={b.id}
              className="p-2 rounded-md border bg-muted/30 space-y-2"
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
            </div>
          ))}
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
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, daysOfWeek: toggleDay(draft.daysOfWeek, dayNum) })}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/40"
                  }`}
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

function StepRules({
  ruleFields, rulesForm, setRulesForm, errors, policyTypeKey,
}: {
  ruleFields: RuleFieldDef[];
  rulesForm: Record<string, any>;
  setRulesForm: (v: Record<string, any>) => void;
  errors: Record<string, string>;
  policyTypeKey: string;
}) {
  if (ruleFields.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="wizard-step-rules">
        <p>No configurable rules for this policy type.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="wizard-step-rules">
      <div>
        <h3 className="text-base font-semibold mb-1">Configure Rules</h3>
        <p className="text-sm text-muted-foreground">
          Set the rules for your {getPolicyTypeLabel(policyTypeKey).toLowerCase()} policy. Defaults are pre-filled.
        </p>
      </div>

      <div className="space-y-4">
        {policyTypeKey === "payroll" && (
          <DayOfWeekBonusEditor
            bonuses={Array.isArray(rulesForm.dayOfWeekBonuses) ? rulesForm.dayOfWeekBonuses : []}
            onChange={(next) => setRulesForm({ ...rulesForm, dayOfWeekBonuses: next })}
          />
        )}
        {policyTypeKey === "payroll" && (
          <EarlyArrivalBonusEditor
            bonuses={Array.isArray(rulesForm.earlyArrivalBonuses) ? rulesForm.earlyArrivalBonuses : []}
            onChange={(next) => setRulesForm({ ...rulesForm, earlyArrivalBonuses: next })}
            errors={errors}
          />
        )}
        {policyTypeKey === "payroll"
          ? getPayrollRuleGroups(ruleFields).map((group) => (
              <PayrollRuleGroupCard
                key={group.kind === "static" ? `static-${group.field.key}` : `toggle-${group.enabledKey}`}
                group={group}
                rulesForm={rulesForm}
                setRulesForm={setRulesForm}
                errors={errors}
              />
            ))
          : ruleFields.map((field) => (
          <div key={field.key} className="p-3 rounded-lg border bg-card">
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
        ))}
      </div>
    </div>
  );
}

function StepAssignments({
  assignments, setAssignments,
  divisions, locations, departments, users,
}: {
  assignments: AssignmentEntry[];
  setAssignments: (v: AssignmentEntry[]) => void;
  divisions: Division[];
  locations: Location[];
  departments: Department[];
  users: User[];
}) {
  const [addLevel, setAddLevel] = useState("");
  const [addId, setAddId] = useState("");

  const getOptions = () => {
    switch (addLevel) {
      case "division":
        return divisions.map((d) => ({ id: d.id, label: d.name }));
      case "location":
        return locations.map((l) => ({ id: l.id, label: l.name }));
      case "department":
        return departments.map((d) => ({ id: d.id, label: d.name }));
      case "employee":
        return users.map((u) => ({ id: u.id, label: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || u.id }));
      default:
        return [];
    }
  };

  const addAssignment = () => {
    if (!addLevel || !addId) return;
    const alreadyExists = assignments.some((a) => a.level === addLevel && a.id === addId);
    if (alreadyExists) return;
    const opts = getOptions();
    const match = opts.find((o) => o.id === addId);
    setAssignments([...assignments, { level: addLevel, id: addId, label: match?.label || addId }]);
    setAddId("");
  };

  const removeAssignment = (index: number) => {
    setAssignments(assignments.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6" data-testid="wizard-step-assignments">
      <div>
        <h3 className="text-base font-semibold mb-1">Assign Policy</h3>
        <p className="text-sm text-muted-foreground">
          Choose which divisions, locations, departments, or employees this policy applies to.
          You can skip this step and assign later.
        </p>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label>Level</Label>
          <Select value={addLevel} onValueChange={(v) => { setAddLevel(v); setAddId(""); }}>
            <SelectTrigger data-testid="select-wizard-assign-level">
              <SelectValue placeholder="Select level..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="division">Division (Company-wide)</SelectItem>
              <SelectItem value="location">Location</SelectItem>
              <SelectItem value="department">Department</SelectItem>
              <SelectItem value="employee">Individual Employee</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label>Target</Label>
          <Select value={addId} onValueChange={setAddId} disabled={!addLevel}>
            <SelectTrigger data-testid="select-wizard-assign-target">
              <SelectValue placeholder={addLevel ? `Select ${addLevel}...` : "Select level first"} />
            </SelectTrigger>
            <SelectContent>
              {getOptions().map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={addAssignment}
          disabled={!addLevel || !addId}
          size="sm"
          data-testid="button-wizard-add-assignment"
        >
          Add
        </Button>
      </div>

      {assignments.length > 0 ? (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Current Assignments</Label>
          {assignments.map((a, i) => (
            <div
              key={`${a.level}-${a.id}-${i}`}
              className="flex items-center justify-between p-2 rounded-md border bg-muted/30"
              data-testid={`assignment-entry-${i}`}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">{a.level}</Badge>
                <span className="text-sm">{a.label}</span>
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
                <span className="capitalize mr-1 opacity-70">{a.level}:</span> {a.label}
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