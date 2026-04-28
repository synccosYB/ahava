import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Settings2, Shield, MapPin, Clock, CalendarDays, DollarSign,
  GitBranch, Users, Bell, Tablet, FileSearch, Plus, Pencil, Link2, X, Workflow, Eye, Trash2, ClipboardCheck,
  UserCog, CalendarRange, RefreshCw, Send, FileCheck, UserPlus, UserMinus,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/page-header";
import { PolicyWizard } from "@/components/policy-wizard";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { RuleSummary } from "@/components/rule-summary";
import {
  summarizePolicy,
  summarizeWorkflow,
  summarizeRoleRule,
  summarizeScheduleTemplate,
  summarizeRequiredDoc,
  summarizeLifecycleTemplate,
} from "@/lib/rule-summaries";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { ReviewCyclesSection } from "@/components/review-cycles/review-cycles-section";
import type {
  Policy, PolicyType, AuditLog, Location, Department, Division, PolicyAssignment, User,
  Workflow as WorkflowType, RoleAssignmentRule, ScheduleTemplate, ScheduleTemplateDay,
} from "@shared/schema";

const sections = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "locations", label: "Locations", icon: MapPin },
  { key: "attendance", label: "Attendance Rules", icon: Clock },
  { key: "pto", label: "PTO Policies", icon: CalendarDays },
  { key: "payroll", label: "Payroll Rules", icon: DollarSign },
  { key: "approval", label: "Approval Workflows", icon: GitBranch },
  { key: "roles", label: "Roles & Permissions", icon: Shield },
  { key: "role-rules", label: "Auto Role Assignment", icon: UserCog },
  { key: "schedule-templates", label: "Schedule Templates", icon: CalendarRange },
  { key: "alerts", label: "Alerts & Notifications", icon: Bell },
  { key: "review-cycles", label: "Review Cycles", icon: ClipboardCheck },
  { key: "required_docs", label: "Required Documents", icon: FileCheck },
  { key: "onboarding", label: "Onboarding Templates", icon: UserPlus },
  { key: "offboarding", label: "Offboarding Templates", icon: UserMinus },
  { key: "kiosk", label: "Kiosk & Devices", icon: Tablet },
  { key: "audit", label: "Audit Logs", icon: FileSearch },
];

export default function RulesControlsPage() {
  const [activeSection, setActiveSection] = useState("general");

  return (
    <div className="max-w-6xl space-y-6" data-testid="rules-controls-page">
      <PageHeader title="Rules & Controls" subtitle="Configure division policies and system settings" />

      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-1" data-testid="rules-nav">
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeSection === s.key
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-section-${s.key}`}
            >
              <s.icon className="h-4 w-4" />
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          {activeSection === "general" && <GeneralSection />}
          {activeSection === "locations" && <LocationsSection />}
          {activeSection === "attendance" && <PolicySection policyTypeKey="attendance" title="Attendance Rules" />}
          {activeSection === "pto" && <PolicySection policyTypeKey="pto" title="PTO Policies" />}
          {activeSection === "payroll" && <PolicySection policyTypeKey="payroll" title="Payroll Rules" />}
          {activeSection === "approval" && <ApprovalWorkflowsSection />}
          {activeSection === "roles" && <RolesSection />}
          {activeSection === "role-rules" && <RoleAssignmentRulesSection />}
          {activeSection === "schedule-templates" && <ScheduleTemplatesSection />}
          {activeSection === "alerts" && <AlertsSection />}
          {activeSection === "review-cycles" && <ReviewCyclesSection />}
          {activeSection === "required_docs" && <RequiredDocumentsSection />}
          {activeSection === "onboarding" && <LifecycleTemplatesSection kind="onboarding" />}
          {activeSection === "offboarding" && <LifecycleTemplatesSection kind="offboarding" />}
          {activeSection === "kiosk" && <KioskSection />}
          {activeSection === "audit" && <AuditSection />}
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  const { toast } = useToast();
  const { data: divisions, isLoading } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const division = divisions?.[0];
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    legalName: "",
    timezone: "",
    email: "",
    phone: "",
    address: "",
  });

  const startEditing = () => {
    if (division) {
      setEditForm({
        name: division.name || "",
        legalName: division.legalName || "",
        timezone: division.timezone || "",
        email: division.email || "",
        phone: division.phone || "",
        address: division.address || "",
      });
    }
    setEditing(true);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (division) {
        await apiRequest("PATCH", `/api/companies/${division.id}`, editForm);
      } else {
        await apiRequest("POST", "/api/companies", editForm);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setEditing(false);
      toast({ title: division ? "Division settings updated" : "Division created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-general-settings">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>General Settings</CardTitle>
        {!editing && !isLoading && (
          <Button variant="outline" size="sm" onClick={startEditing} data-testid="button-edit-general">
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40" /> : editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Division Name *</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} data-testid="input-edit-division-name" />
              </div>
              <div>
                <Label>Legal Name</Label>
                <Input value={editForm.legalName} onChange={(e) => setEditForm({ ...editForm, legalName: e.target.value })} data-testid="input-edit-legal-name" />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input value={editForm.timezone} onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })} data-testid="input-edit-timezone" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} data-testid="input-edit-email" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} data-testid="input-edit-phone" />
              </div>
              <div>
                <Label>Address</Label>
                <Input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} data-testid="input-edit-address" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-edit-general">Cancel</Button>
              <Button onClick={() => updateMutation.mutate()} disabled={!editForm.name || updateMutation.isPending} data-testid="button-save-general">
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground text-xs">Division Name</Label>
              <p className="font-medium" data-testid="text-division-name">{division?.name || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Legal Name</Label>
              <p className="font-medium" data-testid="text-legal-name">{division?.legalName || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Timezone</Label>
              <p className="font-medium" data-testid="text-timezone">{division?.timezone || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Email</Label>
              <p className="font-medium" data-testid="text-division-email">{division?.email || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Phone</Label>
              <p className="font-medium" data-testid="text-division-phone">{division?.phone || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Address</Label>
              <p className="font-medium" data-testid="text-division-address">{division?.address || "—"}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LocationsSection() {
  const { data: locations, isLoading } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  return (
    <Card data-testid="card-locations-settings">
      <CardHeader><CardTitle>Location Settings</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Code</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Timezone</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(locations || []).map((loc) => (
                <TableRow key={loc.id} data-testid={`row-loc-setting-${loc.id}`}>
                  <TableCell className="font-medium">{loc.name}</TableCell>
                  <TableCell>{loc.code || "—"}</TableCell>
                  <TableCell>{loc.timezone || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={loc.isActive ? "default" : "secondary"}>
                      {loc.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AssignPolicyDialog({ policy, divisions }: { policy: Policy; divisions: Division[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");

  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"], enabled: level === "location" });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"], enabled: level === "department" });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"], enabled: level === "employee" });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string | null> = {
        policyId: policy.id,
        companyId: null,
        locationId: null,
        departmentId: null,
        userId: null,
      };
      if (level === "division") payload.companyId = selectedId;
      if (level === "location") payload.locationId = selectedId;
      if (level === "department") payload.departmentId = selectedId;
      if (level === "employee") payload.userId = selectedId;
      await apiRequest("POST", "/api/policy-assignments", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-assignments", policy.id] });
      setOpen(false);
      setLevel("");
      setSelectedId("");
      toast({ title: "Policy assigned successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getOptions = () => {
    switch (level) {
      case "division":
        return (divisions || []).map((d) => ({ id: d.id, label: d.name }));
      case "location":
        return (locations || []).map((l) => ({ id: l.id, label: l.name }));
      case "department":
        return (departments || []).map((d) => ({ id: d.id, label: d.name }));
      case "employee":
        return (users || []).map((u) => ({ id: u.id, label: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || u.id }));
      default:
        return [];
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setLevel(""); setSelectedId(""); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Assign policy" data-testid={`button-assign-policy-${policy.id}`}>
          <Link2 className="h-4 w-4 mr-1" /> Assign
        </Button>
      </DialogTrigger>
      <DialogContent data-testid={`dialog-assign-policy-${policy.id}`}>
        <DialogHeader>
          <DialogTitle>Assign: {policy.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Assignment Level</Label>
            <Select value={level} onValueChange={(v) => { setLevel(v); setSelectedId(""); }}>
              <SelectTrigger data-testid={`select-assignment-level-${policy.id}`}>
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
          {level && (
            <div>
              <Label>Select {level === "division" ? "Division" : level === "location" ? "Location" : level === "department" ? "Department" : "Employee"}</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger data-testid={`select-assignment-target-${policy.id}`}>
                  <SelectValue placeholder={`Select ${level}...`} />
                </SelectTrigger>
                <SelectContent>
                  {getOptions().map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => assignMutation.mutate()} disabled={!level || !selectedId || assignMutation.isPending} data-testid={`button-save-assignment-${policy.id}`}>
            {assignMutation.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PolicyAssignmentBadges({ policyId }: { policyId: string }) {
  const { toast } = useToast();
  const { data: assignments, isLoading, isError } = useQuery<PolicyAssignment[]>({
    queryKey: ["/api/policy-assignments", policyId],
    queryFn: async () => {
      const res = await fetch(`/api/policy-assignments?policyId=${policyId}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to fetch assignments: ${res.status}`);
      }
      return res.json();
    },
  });

  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/policy-assignments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy-assignments", policyId] });
      toast({ title: "Assignment removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return null;
  if (isError) {
    return <span className="text-xs text-destructive" data-testid={`text-assignments-error-${policyId}`}>Failed to load</span>;
  }
  if (!assignments || assignments.length === 0) {
    return <span className="text-xs text-muted-foreground" data-testid={`text-no-assignments-${policyId}`}>None</span>;
  }

  const getLabel = (a: PolicyAssignment) => {
    if (a.userId) {
      const user = users?.find((u) => u.id === a.userId);
      return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Employee" : "Employee";
    }
    if (a.departmentId) {
      const dept = departments?.find((d) => d.id === a.departmentId);
      return dept?.name || "Department";
    }
    if (a.locationId) {
      const loc = locations?.find((l) => l.id === a.locationId);
      return loc?.name || "Location";
    }
    if (a.companyId) {
      const div = divisions?.find((d) => d.id === a.companyId);
      return div?.name || "Division";
    }
    return "Global";
  };

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {assignments.map((a) => (
        <Badge key={a.id} variant="outline" className="text-xs gap-1 pr-1" data-testid={`badge-assignment-${a.id}`}>
          {getLabel(a)}
          <button
            onClick={() => deleteMutation.mutate(a.id)}
            disabled={deleteMutation.isPending}
            className="ml-0.5 hover:text-destructive disabled:opacity-50"
            data-testid={`button-remove-assignment-${a.id}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}

function PolicyRuleSummary({
  policyId,
  typeKey,
  userDescription,
}: {
  policyId: string;
  typeKey: string;
  userDescription?: string | null;
}) {
  const { data, isLoading } = useQuery<{ rules?: Record<string, any> } | Record<string, any>>({
    queryKey: ["/api/policies", policyId, "rules"],
  });
  const rules = (data && typeof data === "object" && "rules" in data && data.rules)
    ? (data.rules as Record<string, any>)
    : (data as Record<string, any>) || {};
  const sentences = summarizePolicy(typeKey, rules);
  return (
    <RuleSummary
      sentences={sentences}
      userDescription={userDescription}
      isLoading={isLoading}
      testIdPrefix={`summary-policy-${policyId}`}
      emptyText="No rules configured."
    />
  );
}

function PolicySection({ policyTypeKey, title }: { policyTypeKey: string; title: string }) {
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [editRules, setEditRules] = useState<Record<string, any>>({});
  const [editAssignments, setEditAssignments] = useState<PolicyAssignment[]>([]);

  const { data: policies, isLoading } = useQuery<Policy[]>({ queryKey: ["/api/policies"] });
  const { data: policyTypes } = useQuery<PolicyType[]>({ queryKey: ["/api/policy-types"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });

  const matchingType = policyTypes?.find((pt) => pt.key === policyTypeKey);
  const filteredPolicies = (policies || []).filter((p) => p.policyTypeId === matchingType?.id);

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/policies/${id}/activate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      toast({ title: "Policy activated" });
    },
  });

  const startEdit = async (p: Policy) => {
    try {
      const rulesRes = await fetch(`/api/policies/${p.id}/rules`, { credentials: "include" });
      let rules: Record<string, any> = {};
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        rules = rulesData?.rules || rulesData || {};
      }

      const assignRes = await fetch(`/api/policy-assignments?policyId=${p.id}`, { credentials: "include" });
      let assigns: PolicyAssignment[] = [];
      if (assignRes.ok) {
        assigns = await assignRes.json();
      }

      setEditRules(rules);
      setEditAssignments(assigns);
      setEditingPolicy(p);
      setWizardOpen(true);
    } catch {
      toast({ title: "Warning", description: "Could not load existing policy details. Some fields may be empty.", variant: "destructive" });
      setEditingPolicy(p);
      setEditRules({});
      setEditAssignments([]);
      setWizardOpen(true);
    }
  };

  const handleWizardClose = (open: boolean) => {
    setWizardOpen(open);
    if (!open) {
      setEditingPolicy(null);
      setEditRules({});
      setEditAssignments([]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button
          onClick={() => { setEditingPolicy(null); setEditRules({}); setEditAssignments([]); setWizardOpen(true); }}
          data-testid={`button-add-${policyTypeKey}`}
        >
          <Plus className="h-4 w-4 mr-1" /> Add Policy
        </Button>
      </div>

      <PolicyWizard
        open={wizardOpen}
        onOpenChange={handleWizardClose}
        policyTypeKey={policyTypeKey}
        editingPolicy={editingPolicy}
        existingRules={editRules}
        existingAssignments={editAssignments}
      />

      <Card data-testid={`card-${policyTypeKey}-list`}>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredPolicies.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-policies">
              No {title.toLowerCase()} configured. Create one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Summary</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Assignments</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Version</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPolicies.map((p) => (
                  <TableRow key={p.id} data-testid={`row-policy-${p.id}`} className="align-top">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <PolicyRuleSummary policyId={p.id} typeKey={policyTypeKey} userDescription={p.description} />
                    </TableCell>
                    <TableCell>
                      <PolicyAssignmentBadges policyId={p.id} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : p.status === "draft" ? "secondary" : "outline"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>v{p.version}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => startEdit(p)} data-testid={`button-edit-policy-${p.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AssignPolicyDialog policy={p} divisions={divisions || []} />
                        {p.status !== "active" && (
                          <Button variant="ghost" size="sm" onClick={() => activateMutation.mutate(p.id)} data-testid={`button-activate-policy-${p.id}`}>
                            Activate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApprovalWorkflowsSection() {
  const { toast } = useToast();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowType | null>(null);
  const [previewWorkflow, setPreviewWorkflow] = useState<WorkflowType | null>(null);
  const [tab, setTab] = useState<"policies" | "workflows">("workflows");

  const { data: wfList, isLoading: wfLoading } = useQuery<WorkflowType[]>({ queryKey: ["/api/workflows"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/workflows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (builderOpen || previewWorkflow) {
    return (
      <WorkflowBuilder
        workflow={editingWorkflow || previewWorkflow}
        onClose={() => {
          setBuilderOpen(false);
          setEditingWorkflow(null);
          setPreviewWorkflow(null);
        }}
        readOnly={!!previewWorkflow}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Approval Workflows</h2>
        <div className="flex gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setTab("workflows")}
              className={`px-3 py-1.5 text-sm ${tab === "workflows" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              data-testid="button-tab-workflows"
            >
              <Workflow className="h-4 w-4 inline mr-1" /> Visual Workflows
            </button>
            <button
              onClick={() => setTab("policies")}
              className={`px-3 py-1.5 text-sm ${tab === "policies" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              data-testid="button-tab-policies"
            >
              <GitBranch className="h-4 w-4 inline mr-1" /> Rule Policies
            </button>
          </div>
          {tab === "workflows" && (
            <Button
              onClick={() => { setEditingWorkflow(null); setBuilderOpen(true); }}
              data-testid="button-new-workflow"
            >
              <Plus className="h-4 w-4 mr-1" /> New Workflow
            </Button>
          )}
        </div>
      </div>

      {tab === "policies" ? (
        <PolicySection policyTypeKey="approvals" title="Approval Rule Policies" />
      ) : (
        <Card data-testid="card-workflows-list">
          <CardContent className="p-0">
            {wfLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !wfList || wfList.length === 0 ? (
              <div className="p-8 text-center" data-testid="text-no-workflows">
                <Workflow className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-1">No visual workflows yet</p>
                <p className="text-xs text-muted-foreground mb-4">Create a workflow to define multi-step approval and automation flows</p>
                <Button onClick={() => { setEditingWorkflow(null); setBuilderOpen(true); }} data-testid="button-create-first-workflow">
                  <Plus className="h-4 w-4 mr-1" /> Create Workflow
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Trigger</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Summary</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Updated</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wfList.map((wf) => (
                    <TableRow key={wf.id} data-testid={`row-workflow-${wf.id}`} className="align-top">
                      <TableCell className="font-medium">{wf.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{wf.triggerType.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <RuleSummary
                          sentences={summarizeWorkflow(wf.nodeGraph, wf.triggerType)}
                          testIdPrefix={`summary-workflow-${wf.id}`}
                          emptyText="No steps configured yet."
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={wf.status === "active" ? "default" : "secondary"}>{wf.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {wf.updatedAt ? new Date(wf.updatedAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setPreviewWorkflow(wf)} data-testid={`button-preview-workflow-${wf.id}`}>
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setEditingWorkflow(wf); setBuilderOpen(true); }} data-testid={`button-edit-workflow-${wf.id}`}>
                            <Pencil className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(wf.id)} disabled={deleteMutation.isPending} data-testid={`button-delete-workflow-${wf.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RolesSection() {
  return (
    <Card data-testid="card-roles-permissions">
      <CardHeader><CardTitle>Roles & Permissions</CardTitle></CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid="text-roles-info">
          Role management and permission matrix will be available in the next milestone.
          Currently, users have one of three roles: Employee, Manager, or Admin.
        </p>
      </CardContent>
    </Card>
  );
}

function AlertsSection() {
  return (
    <Card data-testid="card-alerts-settings">
      <CardHeader><CardTitle>Alerts & Notifications</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
          <div>
            <p className="font-medium text-sm">Missing Clock-Out Alert</p>
            <p className="text-xs text-muted-foreground">Notify managers when employees miss clock-out</p>
          </div>
          <Switch defaultChecked data-testid="switch-alert-missing-clockout" />
        </div>
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
          <div>
            <p className="font-medium text-sm">Overtime Alert</p>
            <p className="text-xs text-muted-foreground">Alert when employees approach overtime threshold</p>
          </div>
          <Switch defaultChecked data-testid="switch-alert-overtime" />
        </div>
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
          <div>
            <p className="font-medium text-sm">PTO Request Notification</p>
            <p className="text-xs text-muted-foreground">Notify managers of new PTO requests</p>
          </div>
          <Switch defaultChecked data-testid="switch-alert-pto-request" />
        </div>
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
          <div>
            <p className="font-medium text-sm">Late Arrival Alert</p>
            <p className="text-xs text-muted-foreground">Alert on late arrivals past grace period</p>
          </div>
          <Switch defaultChecked data-testid="switch-alert-late-arrival" />
        </div>
      </CardContent>
    </Card>
  );
}

function KioskSection() {
  const { data: devices, isLoading } = useQuery<any[]>({ queryKey: ["/api/kiosk/devices"] });

  return (
    <Card data-testid="card-kiosk-settings">
      <CardHeader><CardTitle>Kiosk & Devices</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-20" /> : (
          <p className="text-muted-foreground" data-testid="text-kiosk-info">
            Kiosk devices are managed through the kiosk endpoint. The kiosk interface is available at /kiosk.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AuditSection() {
  const { data: logs, isLoading } = useQuery<AuditLog[]>({ queryKey: ["/api/audit-logs"] });

  return (
    <Card data-testid="card-audit-logs">
      <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !logs || logs.length === 0 ? (
          <p className="text-muted-foreground text-center py-4" data-testid="text-no-audit-logs">No audit logs found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Action</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Target Type</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Target ID</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">IP Address</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.slice(0, 50).map((log) => (
                <TableRow key={log.id} data-testid={`row-audit-log-${log.id}`}>
                  <TableCell className="font-medium">{log.action}</TableCell>
                  <TableCell>{log.targetType}</TableCell>
                  <TableCell className="text-xs font-mono">{log.targetId.substring(0, 8)}...</TableCell>
                  <TableCell>{log.ipAddress || "—"}</TableCell>
                  <TableCell>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}


// ========= Auto Role Assignment Rules =========

const RULE_FIELDS = [
  { value: "companyId", label: "Division" },
  { value: "locationId", label: "Location" },
  { value: "departmentId", label: "Department" },
  { value: "employmentType", label: "Employment Type" },
  { value: "payType", label: "Pay Type" },
  { value: "overtimeEligible", label: "Overtime Eligible" },
  { value: "holidayPayEnabled", label: "Holiday Pay Enabled" },
];
const RULE_OPS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "in", label: "is one of" },
  { value: "nin", label: "is not one of" },
  { value: "exists", label: "is set" },
  { value: "not_exists", label: "is not set" },
];

type SimpleCondition = { field: string; op: string; value: string };

function parseConditions(conditions: any): SimpleCondition[] {
  if (!conditions) return [];
  const list = conditions.all || conditions.any;
  if (!Array.isArray(list)) {
    if (conditions.field) return [{ field: conditions.field, op: conditions.op, value: Array.isArray(conditions.value) ? conditions.value.join(",") : (conditions.value ?? "") }];
    return [];
  }
  return list.filter((c: any) => c && c.field).map((c: any) => ({
    field: c.field,
    op: c.op,
    value: Array.isArray(c.value) ? c.value.join(",") : (c.value ?? ""),
  }));
}

function buildConditions(conds: SimpleCondition[], combinator: "all" | "any") {
  const leaves = conds.filter(c => c.field && c.op).map(c => {
    const leaf: any = { field: c.field, op: c.op };
    if (c.op === "in" || c.op === "nin") {
      leaf.value = c.value.split(",").map(v => v.trim()).filter(Boolean);
    } else if (c.op === "eq" || c.op === "neq") {
      const v = c.value.trim();
      if (v === "true") leaf.value = true;
      else if (v === "false") leaf.value = false;
      else leaf.value = v;
    }
    return leaf;
  });
  if (leaves.length === 1) return leaves[0];
  return { [combinator]: leaves };
}

function RoleAssignmentRulesSection() {
  const { toast } = useToast();
  const { data: rules, isLoading } = useQuery<RoleAssignmentRule[]>({ queryKey: ["/api/role-rules"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const [editingRule, setEditingRule] = useState<RoleAssignmentRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const ruleIdLookup = (field: string, id: string): string => {
    if (!id) return "—";
    if (field === "companyId") return divisions?.find(d => d.id === id)?.name || id;
    if (field === "locationId") return locations?.find(l => l.id === id)?.name || id;
    if (field === "departmentId") return departments?.find(d => d.id === id)?.name || id;
    return id;
  };

  const reevalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/role-rules/reevaluate-all");
      return res.json() as Promise<{ jobId: string; employeeCount: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Re-evaluation queued",
        description: `Background job started for ${data.employeeCount} employee(s)`,
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/role-rules/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/role-rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-role-rules">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Auto Role Assignment</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Rules that automatically assign roles based on employment attributes. Lower priority numbers run first.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => reevalMutation.mutate()} disabled={reevalMutation.isPending} data-testid="button-reevaluate-rules">
            <RefreshCw className="h-4 w-4 mr-1" /> {reevalMutation.isPending ? "Running..." : "Re-evaluate All"}
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-role-rule">
            <Plus className="h-4 w-4 mr-1" /> New Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40" /> : !rules || rules.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground" data-testid="text-no-role-rules">No automation rules defined yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Priority</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Target Role</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map(r => (
                <TableRow key={r.id} data-testid={`row-role-rule-${r.id}`} className="align-top">
                  <TableCell data-testid={`text-rule-priority-${r.id}`}>{r.priority}</TableCell>
                  <TableCell className="font-medium" data-testid={`text-rule-name-${r.id}`}>{r.name}</TableCell>
                  <TableCell><Badge variant="outline" data-testid={`badge-rule-role-${r.id}`}>{r.targetRole}</Badge></TableCell>
                  <TableCell>
                    <RuleSummary
                      sentences={summarizeRoleRule(r, ruleIdLookup)}
                      userDescription={r.description}
                      testIdPrefix={`summary-role-rule-${r.id}`}
                      emptyText="No conditions configured."
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? "default" : "secondary"} data-testid={`badge-rule-status-${r.id}`}>
                      {r.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setEditingRule(r)} data-testid={`button-edit-rule-${r.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-delete-rule-${r.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete rule?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove the rule "{r.name}". Existing role assignments will not be reverted.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid={`button-cancel-delete-rule-${r.id}`}>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(r.id)} data-testid={`button-confirm-delete-rule-${r.id}`}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {(showCreate || editingRule) && (
        <RoleRuleDialog rule={editingRule} onClose={() => { setShowCreate(false); setEditingRule(null); }} />
      )}
      <RoleRuleTestPanel />
    </Card>
  );
}

function RoleRuleTestPanel() {
  const { toast } = useToast();
  const [combinator, setCombinator] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<SimpleCondition[]>([{ field: "departmentId", op: "eq", value: "" }]);
  const [targetRole, setTargetRole] = useState("employee");
  const [scope, setScope] = useState<"all" | "single">("all");
  const [pickedEmployeeId, setPickedEmployeeId] = useState<string>("");
  const [result, setResult] = useState<{ evaluated: number; matched: number; sample: Array<{ userId: string; name: string; email: string; currentRole: string; wouldBecomeRole?: string }> } | null>(null);
  const [singleResult, setSingleResult] = useState<{ userId: string; name: string; email: string; currentRole: string; matched: boolean; wouldBecomeRole?: string } | null>(null);

  const { data: usersList } = useQuery<User[]>({ queryKey: ["/api/users"], enabled: scope === "single" });

  const validConds = conditions.filter(c => c.field && c.op);

  const testMutation = useMutation({
    mutationFn: async () => {
      const body: { conditions: unknown; targetRole: string; limit?: number; userIds?: string[] } = {
        conditions: buildConditions(conditions, combinator),
        targetRole,
      };
      if (scope === "single") {
        if (!pickedEmployeeId) throw new Error("Pick an employee to test against");
        body.userIds = [pickedEmployeeId];
      } else {
        body.limit = 50;
      }
      const res = await apiRequest("POST", "/api/role-rules/test", body);
      return res.json() as Promise<{ evaluated: number; matched: number; sample: Array<{ userId: string; name: string; email: string; currentRole: string; wouldBecomeRole?: string }> }>;
    },
    onSuccess: (data) => {
      if (scope === "single" && pickedEmployeeId) {
        const picked = usersList?.find(u => u.id === pickedEmployeeId);
        const matched = data.sample.find(s => s.userId === pickedEmployeeId);
        setSingleResult({
          userId: pickedEmployeeId,
          name: `${picked?.firstName ?? ""} ${picked?.lastName ?? ""}`.trim() || picked?.email || pickedEmployeeId,
          email: picked?.email ?? "",
          currentRole: picked?.role ?? "—",
          matched: !!matched,
          wouldBecomeRole: matched?.wouldBecomeRole,
        });
        setResult(null);
        toast({
          title: matched ? "Employee matches" : "Employee does not match",
          description: matched
            ? `Would become ${matched.wouldBecomeRole ?? targetRole}.`
            : "Conditions did not match this employee.",
        });
      } else {
        setResult(data);
        setSingleResult(null);
        toast({ title: "Test complete", description: `Matched ${data.matched} of ${data.evaluated} employees.` });
      }
    },
    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  return (
    <CardContent className="border-t pt-6 mt-2" data-testid="card-role-rule-test">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold">Test Conditions</h4>
          <p className="text-sm text-muted-foreground">Preview which employees would match — broadly across the cohort or against a single picked employee.</p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Target Role</Label>
            <Select value={targetRole} onValueChange={setTargetRole}>
              <SelectTrigger data-testid="select-test-target-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Combinator</Label>
            <Select value={combinator} onValueChange={(v) => setCombinator(v === "any" ? "any" : "all")}>
              <SelectTrigger data-testid="select-test-combinator"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Match all</SelectItem>
                <SelectItem value="any">Match any</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => { setScope(v === "single" ? "single" : "all"); setResult(null); setSingleResult(null); }}>
              <SelectTrigger data-testid="select-test-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                <SelectItem value="single">Specific employee</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {scope === "single" && (
          <div>
            <Label>Employee</Label>
            <Select value={pickedEmployeeId} onValueChange={setPickedEmployeeId}>
              <SelectTrigger data-testid="select-test-employee"><SelectValue placeholder="Pick an employee to test" /></SelectTrigger>
              <SelectContent>
                {(usersList ?? []).map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {(`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email) + ` · ${u.role}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Conditions</Label>
            <Button variant="outline" size="sm" onClick={() => setConditions([...conditions, { field: "companyId", op: "eq", value: "" }])} data-testid="button-add-test-condition">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {conditions.map((c, idx) => (
            <div key={idx} className="flex gap-2 mb-2" data-testid={`test-condition-row-${idx}`}>
              <Select value={c.field} onValueChange={(v) => setConditions(conditions.map((cc, i) => i === idx ? { ...cc, field: v } : cc))}>
                <SelectTrigger className="w-44" data-testid={`select-test-cond-field-${idx}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={c.op} onValueChange={(v) => setConditions(conditions.map((cc, i) => i === idx ? { ...cc, op: v } : cc))}>
                <SelectTrigger className="w-32" data-testid={`select-test-cond-op-${idx}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {c.op !== "exists" && c.op !== "not_exists" && (
                <Input
                  className="flex-1"
                  value={Array.isArray(c.value) ? c.value.join(",") : c.value == null ? "" : String(c.value)}
                  onChange={(e) => setConditions(conditions.map((cc, i) => i === idx ? { ...cc, value: e.target.value } : cc))}
                  placeholder={c.op === "in" || c.op === "nin" ? "comma-separated" : "value"}
                  data-testid={`input-test-cond-value-${idx}`}
                />
              )}
              <Button variant="ghost" size="icon" onClick={() => setConditions(conditions.filter((_, i) => i !== idx))} data-testid={`button-remove-test-cond-${idx}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => testMutation.mutate()}
            disabled={validConds.length === 0 || testMutation.isPending || (scope === "single" && !pickedEmployeeId)}
            data-testid="button-run-test"
          >
            {testMutation.isPending ? "Testing..." : "Run Test"}
          </Button>
        </div>
        {singleResult && (
          <div className="border rounded-lg p-3 bg-muted/30" data-testid="text-test-single-result">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-medium" data-testid="text-test-single-name">{singleResult.name}</p>
                <p className="text-xs text-muted-foreground">{singleResult.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" data-testid="badge-test-single-current">{singleResult.currentRole}</Badge>
                {singleResult.matched ? (
                  <Badge variant="default" data-testid="badge-test-single-result">
                    Matches → {singleResult.wouldBecomeRole ?? targetRole}
                  </Badge>
                ) : (
                  <Badge variant="secondary" data-testid="badge-test-single-result">No match</Badge>
                )}
              </div>
            </div>
          </div>
        )}
        {result && (
          <div className="border rounded-lg p-3 bg-muted/30" data-testid="text-test-result">
            <p className="text-sm font-medium mb-2">
              Matched <span data-testid="text-test-matched">{result.matched}</span> of <span data-testid="text-test-evaluated">{result.evaluated}</span> employees
            </p>
            {result.sample.length > 0 && (
              <div className="max-h-60 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Current Role</TableHead>
                      <TableHead>Would Become</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.sample.map(u => (
                      <TableRow key={u.userId} data-testid={`row-test-match-${u.userId}`}>
                        <TableCell>{u.name || "—"}</TableCell>
                        <TableCell className="text-xs">{u.email}</TableCell>
                        <TableCell><Badge variant="outline">{u.currentRole}</Badge></TableCell>
                        <TableCell>
                          {u.wouldBecomeRole && u.wouldBecomeRole !== u.currentRole ? (
                            <Badge variant="default">{u.wouldBecomeRole}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">no change</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    </CardContent>
  );
}

function RoleRuleDialog({ rule, onClose }: { rule: RoleAssignmentRule | null; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!rule;
  const initialConds = rule ? parseConditions(rule.conditions) : [];
  const initialCombinator: "all" | "any" =
    rule && typeof rule.conditions === "object" && rule.conditions !== null && "any" in rule.conditions
      ? "any"
      : "all";
  const [name, setName] = useState(rule?.name || "");
  const [description, setDescription] = useState(rule?.description || "");
  const [targetRole, setTargetRole] = useState(rule?.targetRole || "employee");
  const [priority, setPriority] = useState(rule?.priority || 100);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [combinator, setCombinator] = useState<"all" | "any">(initialCombinator);
  const [conditions, setConditions] = useState<SimpleCondition[]>(initialConds.length ? initialConds : [{ field: "departmentId", op: "eq", value: "" }]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name, description: description || null, targetRole, priority, isActive,
        conditions: buildConditions(conditions, combinator),
      };
      if (isEdit) {
        await apiRequest("PATCH", `/api/role-rules/${rule!.id}`, body);
      } else {
        await apiRequest("POST", "/api/role-rules", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/role-rules"] });
      toast({ title: isEdit ? "Rule updated" : "Rule created" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const validConds = conditions.filter(c => c.field && c.op);

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="dialog-role-rule">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Rule" : "New Auto Role Assignment Rule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-rule-name" />
            </div>
            <div>
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value, 10) || 100)} data-testid="input-rule-priority" />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description || ""} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-rule-description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Target Role *</Label>
              <Select value={targetRole} onValueChange={setTargetRole}>
                <SelectTrigger data-testid="select-rule-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-rule-active" />
                <Label>Active</Label>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Conditions (match {validConds.length > 1 ? <Select value={combinator} onValueChange={(v) => setCombinator(v === "any" ? "any" : "all")}><SelectTrigger className="inline-flex w-24 h-7 mx-1" data-testid="select-rule-combinator"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">all</SelectItem><SelectItem value="any">any</SelectItem></SelectContent></Select> : "all"})</Label>
              <Button variant="outline" size="sm" onClick={() => setConditions([...conditions, { field: "companyId", op: "eq", value: "" }])} data-testid="button-add-condition">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {conditions.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2" data-testid={`row-condition-${idx}`}>
                <Select value={c.field} onValueChange={(v) => setConditions(conditions.map((cc, i) => i === idx ? { ...cc, field: v } : cc))}>
                  <SelectTrigger className="flex-1" data-testid={`select-condition-field-${idx}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RULE_FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={c.op} onValueChange={(v) => setConditions(conditions.map((cc, i) => i === idx ? { ...cc, op: v } : cc))}>
                  <SelectTrigger className="w-32" data-testid={`select-condition-op-${idx}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RULE_OPS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(c.op !== "exists" && c.op !== "not_exists") && (
                  <Input
                    placeholder={c.op === "in" || c.op === "nin" ? "comma,separated,values" : "value or ID"}
                    value={c.value}
                    onChange={(e) => setConditions(conditions.map((cc, i) => i === idx ? { ...cc, value: e.target.value } : cc))}
                    className="flex-1"
                    data-testid={`input-condition-value-${idx}`}
                  />
                )}
                <Button variant="ghost" size="icon" onClick={() => setConditions(conditions.filter((_, i) => i !== idx))} data-testid={`button-remove-condition-${idx}`}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-rule">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!name || validConds.length === 0 || saveMutation.isPending} data-testid="button-save-rule">
            {saveMutation.isPending ? "Saving..." : (isEdit ? "Save" : "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========= Schedule Templates =========

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ScheduleTemplateSummary({
  templateId,
  userDescription,
}: {
  templateId: string;
  userDescription?: string | null;
}) {
  const { data, isLoading } = useQuery<ScheduleTemplate & { days?: ScheduleTemplateDay[] }>({
    queryKey: ["/api/schedule-templates", templateId],
  });
  const sentences = summarizeScheduleTemplate(data?.days);
  return (
    <RuleSummary
      sentences={sentences}
      userDescription={userDescription}
      isLoading={isLoading}
      testIdPrefix={`summary-schedule-template-${templateId}`}
      emptyText="No work days configured yet."
    />
  );
}

function ScheduleTemplatesSection() {
  const { toast } = useToast();
  const { data: templates, isLoading } = useQuery<ScheduleTemplate[]>({ queryKey: ["/api/schedule-templates"] });
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<ScheduleTemplate | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/schedule-templates/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-schedule-templates">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Schedule Templates</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Reusable weekly schedule patterns that can be applied to employees in bulk.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-template">
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-40" /> : !templates || templates.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground" data-testid="text-no-templates">No schedule templates defined yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map(t => (
                <TableRow key={t.id} data-testid={`row-template-${t.id}`} className="align-top">
                  <TableCell className="font-medium" data-testid={`text-template-name-${t.id}`}>
                    {t.name}
                  </TableCell>
                  <TableCell>
                    <ScheduleTemplateSummary templateId={t.id} userDescription={t.description} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.isActive ? "default" : "secondary"} data-testid={`badge-template-status-${t.id}`}>
                      {t.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setApplyingTemplate(t)} data-testid={`button-apply-template-${t.id}`}>
                      <Send className="h-4 w-4 mr-1" /> Apply
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditingTemplate(t)} data-testid={`button-edit-template-${t.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-delete-template-${t.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete template?</AlertDialogTitle>
                          <AlertDialogDescription>This will delete "{t.name}". Employee schedules linked to it will be unlinked but kept.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid={`button-cancel-delete-template-${t.id}`}>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-confirm-delete-template-${t.id}`}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {(showCreate || editingTemplate) && (
        <ScheduleTemplateDialog template={editingTemplate} onClose={() => { setShowCreate(false); setEditingTemplate(null); }} />
      )}
      {applyingTemplate && (
        <ApplyTemplateDialog template={applyingTemplate} onClose={() => setApplyingTemplate(null)} />
      )}
    </Card>
  );
}

interface LifecycleTemplate {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
}
interface LifecycleTask {
  id: string;
  templateId: string;
  title: string;
  description: string | null;
  category: string;
  ownerRole: string;
  isRequired: boolean;
  documentType?: string | null;
  blocksDeactivation?: boolean;
  dueOffsetDays: number;
  sortOrder: number;
}

interface LifecycleTaskForm {
  title: string;
  description: string;
  category: string;
  ownerRole: string;
  isRequired: boolean;
  documentType: string;
  blocksDeactivation: boolean;
  dueOffsetDays: number;
  sortOrder: number;
}

type LifecycleTaskPatch = Partial<{
  title: string;
  description: string | null;
  category: string;
  ownerRole: string;
  isRequired: boolean;
  documentType: string | null;
  blocksDeactivation: boolean;
  dueOffsetDays: number;
  sortOrder: number;
}>;

interface LifecycleTaskCreatePayload {
  title: string;
  description: string;
  category: string;
  ownerRole: string;
  isRequired: boolean;
  dueOffsetDays: number;
  sortOrder: number;
  documentType?: string | null;
  blocksDeactivation?: boolean;
}

function getMutationErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

const ONBOARDING_DOCUMENT_TYPES = [
  { value: "", label: "None" },
  { value: "w9", label: "W-9" },
  { value: "i9", label: "I-9" },
  { value: "direct_deposit", label: "Direct Deposit" },
  { value: "emergency_contact", label: "Emergency Contact" },
  { value: "handbook_ack", label: "Handbook Acknowledgement" },
];

function LifecycleTemplateSummary({
  templateId,
  kind,
  userDescription,
}: {
  templateId: string;
  kind: "onboarding" | "offboarding";
  userDescription?: string | null;
}) {
  const { data, isLoading } = useQuery<LifecycleTemplate & { tasks?: LifecycleTask[] }>({
    queryKey: [`/api/${kind}-templates/${templateId}`],
  });
  const sentences = summarizeLifecycleTemplate(data?.tasks, kind);
  return (
    <RuleSummary
      sentences={sentences}
      userDescription={userDescription}
      isLoading={isLoading}
      testIdPrefix={`summary-${kind}-template-${templateId}`}
      emptyText="No tasks added yet."
    />
  );
}

function LifecycleTemplatesSection({ kind }: { kind: "onboarding" | "offboarding" }) {
  const { toast } = useToast();
  const baseUrl = `/api/${kind}-templates`;
  const { data: templates, isLoading } = useQuery<LifecycleTemplate[]>({ queryKey: [baseUrl] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", isDefault: false });

  const createMut = useMutation({
    mutationFn: async () => apiRequest("POST", baseUrl, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [baseUrl] });
      setOpenCreate(false);
      setForm({ name: "", description: "", isDefault: false });
      toast({ title: "Template created" });
    },
    onError: (e: unknown) => toast({ title: "Failed to create template", description: getMutationErrorMessage(e), variant: "destructive" }),
  });

  const setDefaultMut = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `${baseUrl}/${id}`, { isDefault: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [baseUrl] }); toast({ title: "Default template updated" }); },
  });

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `${baseUrl}/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [baseUrl] }),
  });

  const selected = templates?.find(t => t.id === selectedId);

  return (
    <Card data-testid={`card-${kind}-templates`}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="capitalize">{kind} Templates</CardTitle>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid={`button-new-${kind}-template`}><Plus className="h-4 w-4 mr-1" /> New Template</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New {kind} template</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid={`input-${kind}-template-name`} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} /></div>
              <div className="flex items-center gap-2"><Checkbox checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: !!v })} /><Label className="m-0">Set as default</Label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancel</Button>
              <Button onClick={() => createMut.mutate()} disabled={!form.name || createMut.isPending} data-testid={`button-save-${kind}-template`}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : !templates || templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No templates yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-1">
              {templates.map(t => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(t.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(t.id); } }}
                  className={`w-full text-left p-3 rounded-md border cursor-pointer ${selectedId === t.id ? "border-primary bg-primary/5" : "hover-elevate"}`}
                  data-testid={`row-${kind}-template-${t.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.name}</span>
                    {t.isDefault && <Badge variant="secondary">Default</Badge>}
                  </div>
                  <div className="mt-2">
                    <LifecycleTemplateSummary templateId={t.id} kind={kind} userDescription={t.description} />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Badge variant={t.isActive ? "default" : "outline"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="md:col-span-2">
              {selected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {!selected.isDefault && (
                      <Button size="sm" variant="outline" onClick={() => setDefaultMut.mutate(selected.id)} data-testid={`button-set-default-${selected.id}`}>Set as default</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => toggleActiveMut.mutate({ id: selected.id, isActive: !selected.isActive })}>
                      {selected.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                  <LifecycleTemplateTaskEditor kind={kind} templateId={selected.id} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Select a template to edit its tasks.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function ScheduleTemplateDialog({ template, onClose }: { template: ScheduleTemplate | null; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!template;
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const { data: existing } = useQuery<ScheduleTemplate & { days: ScheduleTemplateDay[] }>({
    queryKey: ["/api/schedule-templates", template?.id],
    enabled: !!template?.id,
  });
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [companyId, setCompanyId] = useState<string>(template?.companyId || "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [days, setDays] = useState<{ dayOfWeek: number; isWorkDay: boolean; startTime: string; endTime: string }[]>(
    Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, isWorkDay: i >= 1 && i <= 5, startTime: "09:00", endTime: "17:00" }))
  );

  useEffect(() => {
    if (existing && existing.days) {
      setDays(Array.from({ length: 7 }, (_, i) => {
        const found = existing.days.find(d => d.dayOfWeek === i);
        if (found) return { dayOfWeek: i, isWorkDay: found.isWorkDay, startTime: found.startTime || "09:00", endTime: found.endTime || "17:00" };
        return { dayOfWeek: i, isWorkDay: false, startTime: "09:00", endTime: "17:00" };
      }));
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name, description: description || null, companyId: companyId || null, isActive,
        days: days.map(d => ({
          dayOfWeek: d.dayOfWeek,
          isWorkDay: d.isWorkDay,
          startTime: d.startTime,
          endTime: d.endTime,
        })),
      };
      if (isEdit) {
        await apiRequest("PATCH", `/api/schedule-templates/${template!.id}`, body);
      } else {
        await apiRequest("POST", "/api/schedule-templates", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({ title: isEdit ? "Template updated" : "Template created" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="dialog-schedule-template">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Template" : "New Schedule Template"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-template-name" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description || ""} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-template-description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Division (optional)</Label>
              <Select value={companyId || "all"} onValueChange={(v) => setCompanyId(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="select-template-division"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All divisions</SelectItem>
                  {divisions?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-template-active" />
                <Label>Active</Label>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Weekly Schedule</Label>
            {days.map((d, idx) => (
              <div key={d.dayOfWeek} className="flex items-center gap-3 border rounded-md px-3 py-2" data-testid={`row-template-day-${d.dayOfWeek}`}>
                <span className="w-12 text-sm font-medium">{DAY_NAMES[d.dayOfWeek]}</span>
                <Switch
                  checked={d.isWorkDay}
                  onCheckedChange={(v) => setDays(days.map((dd, i) => i === idx ? { ...dd, isWorkDay: v } : dd))}
                  data-testid={`switch-template-day-${d.dayOfWeek}`}
                />
                {d.isWorkDay ? (
                  <>
                    <Input type="time" value={d.startTime} onChange={(e) => setDays(days.map((dd, i) => i === idx ? { ...dd, startTime: e.target.value } : dd))} className="w-32" data-testid={`input-template-start-${d.dayOfWeek}`} />
                    <span>→</span>
                    <Input type="time" value={d.endTime} onChange={(e) => setDays(days.map((dd, i) => i === idx ? { ...dd, endTime: e.target.value } : dd))} className="w-32" data-testid={`input-template-end-${d.dayOfWeek}`} />
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Off</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-template">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!name || saveMutation.isPending} data-testid="button-save-template">
            {saveMutation.isPending ? "Saving..." : (isEdit ? "Save" : "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyTemplateDialog({ template, onClose }: { template: ScheduleTemplate; onClose: () => void }) {
  const { toast } = useToast();
  const { data: usersList } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [filterDiv, setFilterDiv] = useState<string>("all");
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });

  const filteredUsers = (usersList || []).filter(u => filterDiv === "all" || u.companyId === filterDiv);

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/schedule-templates/${template.id}/apply`, {
        employeeIds: Array.from(selectedIds),
        mode,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({
        title: data.async ? "Application queued" : "Template applied",
        description: data.async
          ? `Background job started for ${data.employeeCount} employees`
          : `Applied to ${data.applied} employees${data.skipped?.length ? `, skipped ${data.skipped.length}` : ""}`,
      });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" data-testid="dialog-apply-template">
        <DialogHeader>
          <DialogTitle>Apply Template: {template.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v === "merge" ? "merge" : "replace")}>
                <SelectTrigger data-testid="select-apply-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Replace (clear existing schedules)</SelectItem>
                  <SelectItem value="merge">Merge (overwrite by day)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Filter Division</Label>
              <Select value={filterDiv} onValueChange={setFilterDiv}>
                <SelectTrigger data-testid="select-apply-filter-division"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {divisions?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex-1 overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(u => (
                  <TableRow key={u.id} data-testid={`row-apply-employee-${u.id}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(u.id); else next.delete(u.id);
                          setSelectedIds(next);
                        }}
                        data-testid={`checkbox-apply-${u.id}`}
                      />
                    </TableCell>
                    <TableCell>{u.firstName} {u.lastName}</TableCell>
                    <TableCell>{u.email}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="text-apply-count">{selectedIds.size} selected</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-apply">Cancel</Button>
          <Button onClick={() => applyMutation.mutate()} disabled={selectedIds.size === 0 || applyMutation.isPending} data-testid="button-confirm-apply">
            {applyMutation.isPending ? "Applying..." : `Apply to ${selectedIds.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
const REQUIRED_DOC_LABELS: Record<string, string> = {
  w9: "W-9",
  i9: "I-9",
  direct_deposit: "Direct Deposit Authorization",
  emergency_contact: "Emergency Contact Form",
  handbook_ack: "Employee Handbook Acknowledgment",
};

type RequiredDocumentRule = {
  id: string;
  documentType: string;
  scopeType: "global" | "company" | "location" | "department" | "employee";
  companyId: string | null;
  locationId: string | null;
  departmentId: string | null;
  employeeId: string | null;
  dueOffsetDays: number;
  isActive: boolean;
  createdAt: string | null;
};

function RequiredDocumentsSection() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<RequiredDocumentRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: rules, isLoading } = useQuery<RequiredDocumentRule[]>({
    queryKey: ["/api/required-documents"],
  });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/required-documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/required-documents"] });
      toast({ title: "Rule deleted" });
    },
    onError: () => toast({ title: "Failed to delete rule", variant: "destructive" }),
  });

  function scopeLabel(rule: RequiredDocumentRule): string {
    switch (rule.scopeType) {
      case "global":
        return "Global (all employees)";
      case "company":
        return `Division: ${divisions?.find((d) => d.id === rule.companyId)?.name || rule.companyId}`;
      case "location":
        return `Location: ${locations?.find((l) => l.id === rule.locationId)?.name || rule.locationId}`;
      case "department":
        return `Department: ${departments?.find((d) => d.id === rule.departmentId)?.name || rule.departmentId}`;
      case "employee": {
        const u = users?.find((u) => u.id === rule.employeeId);
        return `Employee: ${u ? `${u.firstName} ${u.lastName}` : rule.employeeId}`;
      }
    }
  }

  return (
    <Card data-testid="card-required-docs-settings">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Required Documents</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Define which documents employees must submit and when. Rules can be scoped globally, by location, department, or specific employee.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="button-new-required-doc">
          <Plus className="h-4 w-4 mr-1" /> New Rule
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : !rules || rules.length === 0 ? (
          <p className="text-muted-foreground text-center py-6" data-testid="text-no-required-docs">
            No required document rules defined yet.
          </p>
        ) : (() => {
          const visibleRules = showInactive ? rules : rules.filter((r) => r.isActive);
          const inactiveCount = rules.length - rules.filter((r) => r.isActive).length;
          return (
        <div className="space-y-3">
          {inactiveCount > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowInactive((s) => !s)}
                data-testid="button-toggle-inactive-rules"
              >
                {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
              </Button>
            </div>
          )}
          {visibleRules.length === 0 ? (
            <p className="text-muted-foreground text-center py-6" data-testid="text-no-active-required-docs">
              No active required document rules.
            </p>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider">Document</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Scope</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Due (days from hire)</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Summary</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRules.map((r) => (
                <TableRow key={r.id} data-testid={`row-required-doc-${r.id}`} className="align-top">
                  <TableCell className="font-medium" data-testid={`text-doctype-${r.id}`}>
                    {REQUIRED_DOC_LABELS[r.documentType] || r.documentType}
                  </TableCell>
                  <TableCell data-testid={`text-scope-${r.id}`}>{scopeLabel(r)}</TableCell>
                  <TableCell data-testid={`text-due-${r.id}`}>{r.dueOffsetDays}d</TableCell>
                  <TableCell>
                    <RuleSummary
                      sentences={summarizeRequiredDoc(r, scopeLabel(r))}
                      testIdPrefix={`summary-required-doc-${r.id}`}
                      emptyText="No rule details."
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? "default" : "outline"} data-testid={`badge-active-${r.id}`}>
                      {r.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)} data-testid={`button-edit-required-doc-${r.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("Delete this rule?")) deleteMutation.mutate(r.id);
                        }}
                        data-testid={`button-delete-required-doc-${r.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </div>
          );
        })()}
      </CardContent>

      {(creating || editing) && (
        <RequiredDocDialog
          rule={editing}
          open={creating || !!editing}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              setEditing(null);
            }
          }}
          locations={locations || []}
          departments={departments || []}
          divisions={divisions || []}
          users={users || []}
        />
      )}
    </Card>
  );
}

function RequiredDocDialog({
  rule,
  open,
  onOpenChange,
  locations,
  departments,
  divisions,
  users,
}: {
  rule: RequiredDocumentRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  departments: Department[];
  divisions: Division[];
  users: User[];
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    documentType: rule?.documentType || "w9",
    scopeType: rule?.scopeType || "global",
    companyId: rule?.companyId || "",
    locationId: rule?.locationId || "",
    departmentId: rule?.departmentId || "",
    employeeId: rule?.employeeId || "",
    dueOffsetDays: rule?.dueOffsetDays ?? 0,
    isActive: rule?.isActive ?? true,
  });

  type RequiredDocPayload = {
    documentType: string;
    scopeType: RequiredDocumentRule["scopeType"];
    dueOffsetDays: number;
    isActive: boolean;
    companyId: string | null;
    locationId: string | null;
    departmentId: string | null;
    employeeId: string | null;
  };

  const saveMutation = useMutation<RequiredDocumentRule, Error>({
    mutationFn: async () => {
      const payload: RequiredDocPayload = {
        documentType: form.documentType,
        scopeType: form.scopeType,
        dueOffsetDays: Number(form.dueOffsetDays),
        isActive: form.isActive,
        companyId: form.scopeType === "company" ? form.companyId || null : null,
        locationId: form.scopeType === "location" ? form.locationId || null : null,
        departmentId: form.scopeType === "department" ? form.departmentId || null : null,
        employeeId: form.scopeType === "employee" ? form.employeeId || null : null,
      };
      if (rule) {
        return apiRequest("PATCH", `/api/required-documents/${rule.id}`, payload).then((r) => r.json());
      }
      return apiRequest("POST", "/api/required-documents", payload).then((r) => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/required-documents"] });
      toast({ title: rule ? "Rule updated" : "Rule created" });
      onOpenChange(false);
    },
    onError: (err) => toast({ title: err?.message || "Failed to save rule", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-required-doc">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit Required Document Rule" : "New Required Document Rule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Document Type</Label>
            <Select value={form.documentType} onValueChange={(v) => setForm((f) => ({ ...f, documentType: v }))}>
              <SelectTrigger data-testid="select-trigger-required-doc-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REQUIRED_DOC_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Scope</Label>
            <Select
              value={form.scopeType}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, scopeType: v as RequiredDocumentRule["scopeType"] }))
              }
            >
              <SelectTrigger data-testid="select-trigger-required-doc-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (all employees)</SelectItem>
                <SelectItem value="company">By Division</SelectItem>
                <SelectItem value="location">By Location</SelectItem>
                <SelectItem value="department">By Department</SelectItem>
                <SelectItem value="employee">Specific Employee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.scopeType === "company" && (
            <div className="space-y-1">
              <Label>Division</Label>
              <Select value={form.companyId} onValueChange={(v) => setForm((f) => ({ ...f, companyId: v }))}>
                <SelectTrigger data-testid="select-trigger-required-doc-company"><SelectValue placeholder="Select division" /></SelectTrigger>
                <SelectContent>{divisions.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          )}
          {form.scopeType === "location" && (
            <div className="space-y-1">
              <Label>Location</Label>
              <Select value={form.locationId} onValueChange={(v) => setForm((f) => ({ ...f, locationId: v }))}>
                <SelectTrigger data-testid="select-trigger-required-doc-location"><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>{locations.map((l) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          )}
          {form.scopeType === "department" && (
            <div className="space-y-1">
              <Label>Department</Label>
              <Select value={form.departmentId} onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}>
                <SelectTrigger data-testid="select-trigger-required-doc-department"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>{departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          )}
          {form.scopeType === "employee" && (
            <div className="space-y-1">
              <Label>Employee</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger data-testid="select-trigger-required-doc-user"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{users.map((u) => (<SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Due Offset (days from hire date)</Label>
            <Input
              type="number"
              min={0}
              max={365}
              value={form.dueOffsetDays}
              onChange={(e) => setForm((f) => ({ ...f, dueOffsetDays: Number(e.target.value) }))}
              data-testid="input-required-doc-due-offset"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Active</Label>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              data-testid="switch-required-doc-active"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-required-doc-cancel">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-required-doc-save">
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LifecycleTemplateTaskEditor({ kind, templateId }: { kind: "onboarding" | "offboarding"; templateId: string }) {
  const { toast } = useToast();
  const detailUrl = `/api/${kind}-templates/${templateId}`;
  const tasksCreateUrl = `/api/${kind}-templates/${templateId}/tasks`;
  const { data: detail, isLoading } = useQuery<LifecycleTemplate & { tasks: LifecycleTask[] }>({ queryKey: [detailUrl] });
  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState<LifecycleTaskForm>({
    title: "",
    description: "",
    category: kind === "onboarding" ? "paperwork" : "access",
    ownerRole: kind === "onboarding" ? "new_hire" : "manager",
    isRequired: true,
    documentType: "",
    blocksDeactivation: false,
    dueOffsetDays: 0,
    sortOrder: 0,
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const payload: LifecycleTaskCreatePayload = {
        title: form.title,
        description: form.description,
        category: form.category,
        ownerRole: form.ownerRole,
        isRequired: form.isRequired,
        dueOffsetDays: form.dueOffsetDays,
        sortOrder: form.sortOrder,
      };
      if (kind === "onboarding") {
        payload.documentType = !form.documentType || form.documentType === "_none" ? null : form.documentType;
      } else {
        payload.blocksDeactivation = form.blocksDeactivation;
      }
      return apiRequest("POST", tasksCreateUrl, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [detailUrl] });
      setOpenAdd(false);
      setForm({ ...form, title: "", description: "" });
      toast({ title: "Task added" });
    },
    onError: (e: unknown) => toast({ title: "Failed to add task", description: getMutationErrorMessage(e), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/${kind}-template-tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [detailUrl] }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: LifecycleTaskPatch }) => apiRequest("PATCH", `/api/${kind}-template-tasks/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [detailUrl] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Tasks</h4>
        <Dialog open={openAdd} onOpenChange={setOpenAdd}>
          <DialogTrigger asChild><Button size="sm" variant="outline" data-testid={`button-add-${kind}-task`}><Plus className="h-4 w-4 mr-1" /> Add task</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add {kind} task</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} data-testid={`input-${kind}-task-title`} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Owner role</Label>
                  <Select value={form.ownerRole} onValueChange={(v) => setForm({ ...form, ownerRole: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      {kind === "onboarding" && <SelectItem value="new_hire">New Hire</SelectItem>}
                      <SelectItem value="it">IT</SelectItem>
                      {kind === "offboarding" && <SelectItem value="finance">Finance</SelectItem>}
                      <SelectItem value="system">System (auto)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Category</Label>
                  <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Due offset (days)</Label><Input type="number" value={form.dueOffsetDays} onChange={e => setForm({ ...form, dueOffsetDays: Number(e.target.value) })} /></div>
                <div><Label>Sort order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
              </div>
              {kind === "onboarding" ? (
                <div>
                  <Label>Document type (auto-completes when uploaded)</Label>
                  <Select value={form.documentType || ""} onValueChange={(v) => setForm({ ...form, documentType: v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      {ONBOARDING_DOCUMENT_TYPES.map(d => <SelectItem key={d.value || "none"} value={d.value || "_none"}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex items-center gap-2"><Checkbox checked={form.blocksDeactivation} onCheckedChange={(v) => setForm({ ...form, blocksDeactivation: !!v })} /><Label className="m-0">Blocks account deactivation until complete</Label></div>
              )}
              <div className="flex items-center gap-2"><Checkbox checked={form.isRequired} onCheckedChange={(v) => setForm({ ...form, isRequired: !!v })} /><Label className="m-0">Required</Label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenAdd(false)}>Cancel</Button>
              <Button onClick={() => addMut.mutate()} disabled={!form.title || addMut.isPending} data-testid={`button-save-${kind}-task`}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Required</TableHead>
              {kind === "onboarding" ? <TableHead>Document</TableHead> : <TableHead>Blocks Deact.</TableHead>}
              <TableHead>Due</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(detail?.tasks ?? []).map(t => (
              <TableRow key={t.id} data-testid={`row-task-${t.id}`}>
                <TableCell>
                  <div className="font-medium">{t.title}</div>
                  {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                </TableCell>
                <TableCell><Badge variant="outline">{t.ownerRole}</Badge></TableCell>
                <TableCell>
                  <Switch checked={t.isRequired} onCheckedChange={(v) => updateMut.mutate({ id: t.id, patch: { isRequired: v } })} />
                </TableCell>
                {kind === "onboarding" ? (
                  <TableCell className="text-xs">{t.documentType || "—"}</TableCell>
                ) : (
                  <TableCell>
                    <Switch checked={!!t.blocksDeactivation} onCheckedChange={(v) => updateMut.mutate({ id: t.id, patch: { blocksDeactivation: v } })} />
                  </TableCell>
                )}
                <TableCell className="text-xs">+{t.dueOffsetDays}d</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(t.id)} data-testid={`button-delete-task-${t.id}`}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {(detail?.tasks ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No tasks yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
