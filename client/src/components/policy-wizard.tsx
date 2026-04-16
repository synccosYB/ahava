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
}

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
        { key: "overtimeThresholdHours", label: "OT Threshold (hours/week)", type: "number", description: "Weekly hours threshold before overtime kicks in", defaultValue: 40, min: 20, max: 60 },
        { key: "overtimeMultiplier", label: "OT Multiplier", type: "number", description: "Pay multiplier for overtime hours (e.g. 1.5 = time and a half)", defaultValue: 1.5, min: 1, max: 3 },
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
      ruleFields.forEach((field) => {
        if (field.type === "number") {
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
              ruleFields={ruleFields}
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
              ruleFields={ruleFields}
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
        {ruleFields.map((field) => (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ruleFields.map((field) => (
              <div key={field.key} className="text-sm" data-testid={`review-rule-${field.key}`}>
                <span className="text-muted-foreground">{field.label}:</span>{" "}
                <span className="font-medium">
                  {field.type === "boolean"
                    ? (rulesForm[field.key] ? "Yes" : "No")
                    : (rulesForm[field.key] ?? "—")}
                </span>
              </div>
            ))}
          </div>
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