import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Settings2, Shield, MapPin, Clock, CalendarDays, DollarSign,
  GitBranch, Users, Bell, Tablet, FileSearch, Plus, Pencil, Link2, X
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { Policy, PolicyType, AuditLog, Location, Department, Division, PolicyAssignment, User } from "@shared/schema";

const sections = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "locations", label: "Locations", icon: MapPin },
  { key: "attendance", label: "Attendance Rules", icon: Clock },
  { key: "pto", label: "PTO Policies", icon: CalendarDays },
  { key: "payroll", label: "Payroll Rules", icon: DollarSign },
  { key: "approval", label: "Approval Workflows", icon: GitBranch },
  { key: "roles", label: "Roles & Permissions", icon: Shield },
  { key: "alerts", label: "Alerts & Notifications", icon: Bell },
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
          {activeSection === "attendance" && <PolicySection policyTypeKey="attendance_policy" title="Attendance Rules" />}
          {activeSection === "pto" && <PolicySection policyTypeKey="pto_policy" title="PTO Policies" />}
          {activeSection === "payroll" && <PolicySection policyTypeKey="payroll_policy" title="Payroll Rules" />}
          {activeSection === "approval" && <PolicySection policyTypeKey="approval_workflow" title="Approval Workflows" />}
          {activeSection === "roles" && <RolesSection />}
          {activeSection === "alerts" && <AlertsSection />}
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

function PolicySection({ policyTypeKey, title }: { policyTypeKey: string; title: string }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState({ name: "", description: "", status: "draft" });
  const [rulesForm, setRulesForm] = useState<Record<string, any>>({});

  const { data: policies, isLoading } = useQuery<Policy[]>({ queryKey: ["/api/policies"] });
  const { data: policyTypes } = useQuery<PolicyType[]>({ queryKey: ["/api/policy-types"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });

  const matchingType = policyTypes?.find((pt) => pt.key === policyTypeKey);
  const filteredPolicies = (policies || []).filter((p) => p.policyTypeId === matchingType?.id);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        policyTypeId: matchingType?.id,
        companyId: divisions?.[0]?.id || null,
        status: form.status,
      };
      if (editingPolicy) {
        await apiRequest("PATCH", `/api/policies/${editingPolicy.id}`, payload);
        if (Object.keys(rulesForm).length > 0) {
          await apiRequest("PUT", `/api/policies/${editingPolicy.id}/rules`, { rules: rulesForm });
        }
      } else {
        const res = await apiRequest("POST", "/api/policies", payload);
        const created = await res.json();
        if (Object.keys(rulesForm).length > 0) {
          await apiRequest("PUT", `/api/policies/${created.id}/rules`, { rules: rulesForm });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editingPolicy ? "Policy updated" : "Policy created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/policies/${id}/activate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      toast({ title: "Policy activated" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", description: "", status: "draft" });
    setRulesForm({});
    setEditingPolicy(null);
  };

  const startEdit = (p: Policy) => {
    setForm({ name: p.name, description: p.description || "", status: p.status });
    setEditingPolicy(p);
    setDialogOpen(true);
  };

  const getRuleFields = () => {
    switch (policyTypeKey) {
      case "attendance_policy":
        return [
          { key: "gracePeriodMinutes", label: "Grace Period (minutes)", type: "number" },
          { key: "autoClockOutHours", label: "Auto Clock-Out (hours)", type: "number" },
          { key: "requirePhotoVerification", label: "Require Photo Verification", type: "boolean" },
          { key: "allowEarlyClockIn", label: "Allow Early Clock-In", type: "boolean" },
          { key: "earlyClockInMinutes", label: "Early Clock-In Window (min)", type: "number" },
          { key: "roundingIntervalMinutes", label: "Rounding Interval (min)", type: "number" },
        ];
      case "pto_policy":
        return [
          { key: "requireAdvanceNotice", label: "Require Advance Notice", type: "boolean" },
          { key: "advanceNoticeDays", label: "Advance Notice (days)", type: "number" },
          { key: "maxConsecutiveDays", label: "Max Consecutive Days", type: "number" },
          { key: "blackoutDatesEnabled", label: "Blackout Dates Enabled", type: "boolean" },
        ];
      case "payroll_policy":
        return [
          { key: "overtimeThresholdHours", label: "OT Threshold (hours/week)", type: "number" },
          { key: "overtimeMultiplier", label: "OT Multiplier", type: "number" },
          { key: "doubleOtThreshold", label: "Double OT Threshold", type: "number" },
          { key: "payPeriodType", label: "Pay Period Type", type: "text" },
        ];
      case "approval_workflow":
        return [
          { key: "autoApproveThreshold", label: "Auto-Approve Threshold (days)", type: "number" },
          { key: "escalationHours", label: "Escalation After (hours)", type: "number" },
          { key: "requireManagerApproval", label: "Require Manager Approval", type: "boolean" },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid={`button-add-${policyTypeKey}`}>
              <Plus className="h-4 w-4 mr-1" /> Add Policy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid={`dialog-${policyTypeKey}-form`}>
            <DialogHeader>
              <DialogTitle>{editingPolicy ? `Edit ${title}` : `Create ${title}`}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-policy-name" /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-policy-description" /></div>

              {getRuleFields().length > 0 && (
                <div className="border-t pt-3 mt-3">
                  <p className="font-medium text-sm mb-3">Policy Rules</p>
                  {getRuleFields().map((field) => (
                    <div key={field.key} className="mb-3">
                      {field.type === "boolean" ? (
                        <div className="flex items-center justify-between">
                          <Label>{field.label}</Label>
                          <Switch
                            checked={!!rulesForm[field.key]}
                            onCheckedChange={(v) => setRulesForm({ ...rulesForm, [field.key]: v })}
                            data-testid={`switch-rule-${field.key}`}
                          />
                        </div>
                      ) : (
                        <div>
                          <Label>{field.label}</Label>
                          <Input
                            type={field.type}
                            value={rulesForm[field.key] || ""}
                            onChange={(e) => setRulesForm({ ...rulesForm, [field.key]: field.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value })}
                            data-testid={`input-rule-${field.key}`}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending} data-testid="button-save-policy">
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Description</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Assignments</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Version</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPolicies.map((p) => (
                  <TableRow key={p.id} data-testid={`row-policy-${p.id}`}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.description || "—"}</TableCell>
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
