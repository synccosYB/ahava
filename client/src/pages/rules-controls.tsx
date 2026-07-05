import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
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
  UserCog, CalendarRange, RefreshCw, Send, FileCheck, UserPlus, UserMinus, AlertCircle,
  ArrowRight, Check, ChevronsUpDown,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/page-header";
import { buildGoogleMapsUrl, GoogleMapsIconLink, AddressAutocompleteInput } from "@/lib/googleMaps";
import { Link } from "wouter";
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
import { CompaniesManager } from "@/components/companies-manager";
import {
  INLINE_ADD_NEW_VALUE,
  PermissionedAddNewItem,
  CreateCompanyDialog,
  CreateLocationDialog,
  CreateDepartmentDialog,
} from "@/components/inline-entity-create";
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

const POLICY_TYPE_TO_SECTION: Record<string, string> = {
  attendance: "attendance",
  pto: "pto",
  payroll: "payroll",
  approvals: "approval",
};

export default function RulesControlsPage() {
  const initialParams = (() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  })();
  const sectionKeys = sections.map((s) => s.key);
  const rawSection = initialParams.get("section");
  const rawType = initialParams.get("type");
  const initialSection = (() => {
    if (rawType && POLICY_TYPE_TO_SECTION[rawType]) return POLICY_TYPE_TO_SECTION[rawType];
    if (rawSection && sectionKeys.includes(rawSection)) return rawSection;
    if (rawSection && POLICY_TYPE_TO_SECTION[rawSection]) return POLICY_TYPE_TO_SECTION[rawSection];
    return "general";
  })();
  const [activeSection, setActiveSection] = useState(initialSection);
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(initialParams.get("policyId"));

  return (
    <div className="max-w-6xl space-y-6" data-testid="rules-controls-page">
      <PageHeader title="Rules & Controls" subtitle="Configure company policies and system settings" />

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
          {activeSection === "attendance" && <PolicySection policyTypeKey="attendance" title="Attendance Rules" openPolicyId={openPolicyId} onOpenPolicyHandled={() => setOpenPolicyId(null)} />}
          {activeSection === "pto" && <PolicySection policyTypeKey="pto" title="PTO Policies" openPolicyId={openPolicyId} onOpenPolicyHandled={() => setOpenPolicyId(null)} />}
          {activeSection === "payroll" && <PolicySection policyTypeKey="payroll" title="Payroll Rules" openPolicyId={openPolicyId} onOpenPolicyHandled={() => setOpenPolicyId(null)} />}
          {activeSection === "approval" && <ApprovalWorkflowsSection openPolicyId={openPolicyId} onOpenPolicyHandled={() => setOpenPolicyId(null)} />}
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
  return <CompaniesManager />;
}

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function getAllTimezones(): string[] {
  try {
    const supported = (Intl as any).supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length > 0) return supported;
  } catch { /* ignore */ }
  return COMMON_TIMEZONES;
}

function getTimezoneAbbreviation(tz: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || null;
  } catch {
    return null;
  }
}

function formatTimezoneLabel(tz: string | null | undefined): string | null {
  if (!tz) return null;
  const abbr = getTimezoneAbbreviation(tz);
  return abbr ? `${tz} (${abbr})` : tz;
}

function TimezoneCombobox({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const zones = getAllTimezones();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? formatTimezoneLabel(value) : "Select timezone…"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No matching timezone.</CommandEmpty>
            <CommandGroup>
              {zones.map((tz) => (
                <CommandItem
                  key={tz}
                  value={tz}
                  onSelect={(v) => { onChange(v); setOpen(false); }}
                  data-testid={`option-timezone-${tz}`}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === tz ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{formatTimezoneLabel(tz)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LocationRow({ loc, canEdit }: { loc: Location; canEdit: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: loc.name || "",
    code: loc.code || "",
    timezone: loc.timezone || "",
    isActive: loc.isActive,
  });

  useEffect(() => {
    if (!editing) {
      setForm({
        name: loc.name || "",
        code: loc.code || "",
        timezone: loc.timezone || "",
        isActive: loc.isActive,
      });
    }
  }, [loc, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/locations/${loc.id}`, {
        name: form.name.trim(),
        code: form.code.trim() || null,
        timezone: form.timezone || null,
        isActive: form.isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location updated" });
      setEditing(false);
    },
    onError: (err: Error) => {
      const msg = err?.message?.replace(/^\d+:\s*/, "") || "Couldn't save location";
      let description = msg;
      try {
        const body = JSON.parse(msg);
        description = body?.message || msg;
      } catch { /* ignore */ }
      toast({ title: "Could not update location", description, variant: "destructive" });
    },
  });

  const tzLabel = formatTimezoneLabel(loc.timezone);

  if (editing) {
    return (
      <TableRow data-testid={`row-loc-setting-${loc.id}`} className="bg-muted/30">
        <TableCell>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-9"
            data-testid={`input-edit-location-name-${loc.id}`}
          />
        </TableCell>
        <TableCell>
          <Input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="h-9"
            data-testid={`input-edit-location-code-${loc.id}`}
          />
        </TableCell>
        <TableCell>
          <TimezoneCombobox
            value={form.timezone}
            onChange={(v) => setForm({ ...form, timezone: v })}
            testId={`combobox-edit-location-timezone-${loc.id}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              data-testid={`switch-edit-location-active-${loc.id}`}
            />
            <span className="text-xs text-muted-foreground">
              {form.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={saveMutation.isPending}
              data-testid={`button-cancel-location-${loc.id}`}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!form.name.trim() || saveMutation.isPending}
              data-testid={`button-save-location-${loc.id}`}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow
      data-testid={`row-loc-setting-${loc.id}`}
      className={canEdit ? "hover-elevate cursor-pointer" : ""}
      onClick={canEdit ? () => setEditing(true) : undefined}
    >
      <TableCell className="font-medium">{loc.name}</TableCell>
      <TableCell className="text-muted-foreground">{loc.code || "—"}</TableCell>
      <TableCell>
        {tzLabel ? (
          <span data-testid={`text-location-timezone-${loc.id}`}>{tzLabel}</span>
        ) : (
          <Badge variant="outline" className="text-muted-foreground font-normal" data-testid={`badge-tz-not-set-${loc.id}`}>
            Not set
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={loc.isActive ? "default" : "secondary"}>
          {loc.isActive ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            data-testid={`button-edit-location-${loc.id}`}
          >
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

interface TimezoneAuditEntry {
  kind: "location" | "company";
  id: string;
  name: string;
  storedTimezone: string;
}

function TimezoneAuditCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data, isLoading } = useQuery<{ unrecoverable: TimezoneAuditEntry[] }>({
    queryKey: ["/api/timezone-audit"],
    enabled: isAdmin,
  });

  const entries = data?.unrecoverable ?? [];
  if (!isAdmin || isLoading || entries.length === 0) return null;

  return (
    <Card className="border-destructive/50" data-testid="card-timezone-audit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          Timezones needing review
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="text-timezone-audit-intro">
          These records have an invalid timezone that couldn't be auto-corrected. Until fixed,
          they fall back to the company or default timezone, which may be wrong. Edit each one
          below and pick a valid timezone.
        </p>
        <div className="space-y-2">
          {entries.map((e) => (
            <div
              key={`${e.kind}-${e.id}`}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
              data-testid={`row-timezone-audit-${e.id}`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate" data-testid={`text-timezone-audit-name-${e.id}`}>
                  {e.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-2 capitalize">{e.kind}</Badge>
                  Stored:{" "}
                  <code className="text-destructive" data-testid={`text-timezone-audit-value-${e.id}`}>
                    {e.storedTimezone}
                  </code>
                </p>
              </div>
              <Link href={e.kind === "location" ? "/locations" : "/companies"}>
                <Button variant="outline" size="sm" data-testid={`button-fix-timezone-${e.id}`}>
                  Fix <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LocationsSection() {
  const { data: locations, isLoading } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { has } = usePermissions();
  const canEdit = has("locations.manage");

  return (
    <div className="space-y-6">
    <TimezoneAuditCard />
    <Card data-testid="card-locations-settings">
      <CardHeader>
        <CardTitle>Location Settings</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !locations || locations.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10 gap-3" data-testid="empty-locations-settings">
            <MapPin className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No locations yet</p>
              <p className="text-sm text-muted-foreground">
                Add your first location to start tracking attendance by site.
              </p>
            </div>
            <Link href="/locations">
              <Button variant="outline" size="sm" data-testid="button-go-to-locations">
                Manage Locations <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider w-[28%]">Name</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider w-[14%]">Code</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider w-[28%]">Timezone</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider w-[14%]">Status</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider w-[16%] text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((loc) => (
                <LocationRow key={loc.id} loc={loc} canEdit={canEdit} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

function AssignPolicyDialog({ policy, divisions }: { policy: Policy; divisions: Division[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createLocationOpen, setCreateLocationOpen] = useState(false);
  const [createDepartmentOpen, setCreateDepartmentOpen] = useState(false);

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
                <SelectItem value="division">Company (Org-wide)</SelectItem>
                <SelectItem value="location">Location</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="employee">Individual Employee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {level && (
            <div>
              <Label>Select {level === "division" ? "Company" : level === "location" ? "Location" : level === "department" ? "Department" : "Employee"}</Label>
              <Select
                value={selectedId}
                onValueChange={(v) => {
                  if (v === INLINE_ADD_NEW_VALUE) {
                    if (level === "division") setCreateCompanyOpen(true);
                    else if (level === "location") setCreateLocationOpen(true);
                    else if (level === "department") setCreateDepartmentOpen(true);
                    return;
                  }
                  setSelectedId(v);
                }}
              >
                <SelectTrigger data-testid={`select-assignment-target-${policy.id}`}>
                  <SelectValue placeholder={`Select ${level}...`} />
                </SelectTrigger>
                <SelectContent>
                  {getOptions().map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                  ))}
                  {level === "division" && (
                    <PermissionedAddNewItem
                      permission="company.create"
                      label="Add new company"
                      testId={`option-assignment-add-new-company-${policy.id}`}
                    />
                  )}
                  {level === "location" && (
                    <PermissionedAddNewItem
                      permission="locations.manage"
                      label="Add new location"
                      testId={`option-assignment-add-new-location-${policy.id}`}
                    />
                  )}
                  {level === "department" && (
                    <PermissionedAddNewItem
                      permission="departments.create"
                      label="Add new department"
                      testId={`option-assignment-add-new-department-${policy.id}`}
                    />
                  )}
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
      <CreateCompanyDialog
        open={createCompanyOpen}
        onOpenChange={setCreateCompanyOpen}
        onCreated={(company) => {
          setSelectedId(company.id);
        }}
      />
      <CreateLocationDialog
        open={createLocationOpen}
        onOpenChange={setCreateLocationOpen}
        onCreated={(location) => {
          setSelectedId(location.id);
        }}
      />
      <CreateDepartmentDialog
        open={createDepartmentOpen}
        onOpenChange={setCreateDepartmentOpen}
        onCreated={(dept) => {
          setSelectedId(dept.id);
        }}
      />
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
  const { data: roles } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/roles-summary"] });

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

  const formatEmploymentType = (v: string) => {
    const map: Record<string, string> = { full_time: "Full Time", part_time: "Part Time", contractor: "Contractor", per_diem: "Per Diem" };
    return map[v] || v;
  };
  const formatPayType = (v: string) => {
    const map: Record<string, string> = { hourly: "Hourly", salary: "Salary" };
    return map[v] || v;
  };

  const getLabel = (a: PolicyAssignment) => {
    if (a.userId) {
      const user = users?.find((u) => u.id === a.userId);
      const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Employee" : "Employee";
      return `Employee · ${name}`;
    }
    if (a.roleId) {
      const role = roles?.find((r) => r.id === a.roleId);
      return `Role · ${role?.name || "Role"}`;
    }
    if (a.employmentType) {
      return `Employment Type · ${formatEmploymentType(a.employmentType)}`;
    }
    if (a.payType) {
      return `Pay Type · ${formatPayType(a.payType)}`;
    }
    if (a.departmentId) {
      const dept = departments?.find((d) => d.id === a.departmentId);
      return `Department · ${dept?.name || "Department"}`;
    }
    if (a.locationId) {
      const loc = locations?.find((l) => l.id === a.locationId);
      return `Location · ${loc?.name || "Location"}`;
    }
    if (a.companyId) {
      const div = divisions?.find((d) => d.id === a.companyId);
      return `Company · ${div?.name || "Company"}`;
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

function PolicySection({ policyTypeKey, title, openPolicyId, onOpenPolicyHandled }: { policyTypeKey: string; title: string; openPolicyId?: string | null; onOpenPolicyHandled?: () => void }) {
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [editRules, setEditRules] = useState<Record<string, any>>({});
  const [editAssignments, setEditAssignments] = useState<PolicyAssignment[]>([]);
  const [policyToDelete, setPolicyToDelete] = useState<Policy | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-assignments"] });
      toast({ title: "Policy deleted" });
      setPolicyToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Could not delete policy",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
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

  const [autoOpenedId, setAutoOpenedId] = useState<string | null>(null);
  useEffect(() => {
    if (!openPolicyId || autoOpenedId === openPolicyId) return;
    const target = filteredPolicies.find((p) => p.id === openPolicyId);
    if (!target) return;
    setAutoOpenedId(openPolicyId);
    onOpenPolicyHandled?.();
    startEdit(target);
  }, [openPolicyId, filteredPolicies, autoOpenedId]);

  const hasDivisions = (divisions || []).length > 0;

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

      {!hasDivisions && (
        <div
          className="flex items-start gap-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm"
          data-testid={`banner-no-companies-${policyTypeKey}`}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 text-amber-700 dark:text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              You haven't created any companies yet.
            </p>
            <p className="text-amber-800 dark:text-amber-300/90">
              Some policy assignments (Company, Location, Department) need a company first.{" "}
              <Link
                href="/locations"
                className="underline font-medium"
                data-testid={`link-create-division-${policyTypeKey}`}
              >
                Go to Locations & Departments
              </Link>
              .
            </p>
          </div>
        </div>
      )}

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
                    <TableCell className="w-[1%] whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => startEdit(p)} data-testid={`button-edit-policy-${p.id}`} title="Edit policy" aria-label="Edit policy">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AssignPolicyDialog policy={p} divisions={divisions || []} />
                        {p.status !== "active" && (
                          <Button variant="ghost" size="sm" onClick={() => activateMutation.mutate(p.id)} data-testid={`button-activate-policy-${p.id}`}>
                            Activate
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setPolicyToDelete(p)}
                          data-testid={`button-delete-policy-${p.id}`}
                          title="Delete policy"
                          aria-label="Delete policy"
                        >
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

      <AlertDialog open={!!policyToDelete} onOpenChange={(open) => { if (!open) setPolicyToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{policyToDelete?.name}</strong>, including its rules
              and all of its assignments. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (policyToDelete) deleteMutation.mutate(policyToDelete.id);
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-policy"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete policy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ApprovalWorkflowsSection({ openPolicyId, onOpenPolicyHandled }: { openPolicyId?: string | null; onOpenPolicyHandled?: () => void } = {}) {
  const { toast } = useToast();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowType | null>(null);
  const [previewWorkflow, setPreviewWorkflow] = useState<WorkflowType | null>(null);
  const [tab, setTab] = useState<"policies" | "workflows">(openPolicyId ? "policies" : "workflows");

  const { data: wfList, isLoading: wfLoading } = useQuery<WorkflowType[]>({ queryKey: ["/api/workflows"] });

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      setPendingDeleteId(id);
      await apiRequest("DELETE", `/api/workflows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => setPendingDeleteId(null),
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
        <PolicySection policyTypeKey="approvals" title="Approval Rule Policies" openPolicyId={openPolicyId} onOpenPolicyHandled={onOpenPolicyHandled} />
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
                        {formatDate(wf.updatedAt) || "—"}
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

type RoleWithPermissions = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissions: { id: string; key: string }[];
  userCount: number;
};

function RolesSection() {
  const { toast } = useToast();
  const perms = usePermissions();
  const canManage = perms.has("roles.manage");

  const { data: roles, isLoading, isError } = useQuery<RoleWithPermissions[]>({
    queryKey: ["/api/roles"],
    enabled: canManage,
  });

  // Read-only fallback for admins without roles.manage: /api/roles-summary is
  // available to any admin and returns name/description/system flag, so the
  // list still renders (without user counts) and the "Ask a Super Admin" hint
  // is shown above it.
  type RoleSummaryRow = { id: string; name: string; description: string | null; isSystem: boolean; isActive: boolean };
  const { data: readOnlyRoles, isLoading: readOnlyLoading, isError: readOnlyError } = useQuery<RoleSummaryRow[]>({
    queryKey: ["/api/roles-summary"],
    enabled: !perms.isLoading && !canManage,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithPermissions | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string | null }) =>
      apiRequest("POST", "/api/roles", { ...data, permissionIds: [] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles-summary"] });
      setDialogOpen(false);
      toast({ title: "Role created" });
    },
    onError: (e: Error) => toast({ title: "Failed to create role", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; description: string | null } }) =>
      apiRequest("PATCH", `/api/roles/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles-summary"] });
      setDialogOpen(false);
      toast({ title: "Role updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update role", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles-summary"] });
      toast({ title: "Role deleted" });
    },
    onError: (e: Error) => {
      const raw = e.message || "";
      const stripped = raw.replace(/^\d+:\s*/, "").trim();
      let description = stripped || "Failed to delete role";
      try {
        const parsed = JSON.parse(stripped);
        if (parsed && typeof parsed.message === "string") description = parsed.message;
      } catch {
        // keep stripped
      }
      toast({ title: "Failed to delete role", description, variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingRole(null);
    setFormName("");
    setFormDesc("");
    setDialogOpen(true);
  }

  function openEdit(role: RoleWithPermissions) {
    setEditingRole(role);
    setFormName(role.name);
    setFormDesc(role.description || "");
    setDialogOpen(true);
  }

  function handleSubmit() {
    const payload = { name: formName.trim(), description: formDesc.trim() || null };
    if (!payload.name) return;
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  if (!perms.isLoading && !canManage) {
    const list = readOnlyRoles || [];
    return (
      <Card data-testid="card-roles-permissions">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Roles & Permissions
          </CardTitle>
          <Link href="/permissions">
            <Button variant="outline" size="sm" data-testid="button-open-permission-matrix">
              Permission matrix <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-roles-readonly-hint">
            You don&apos;t have permission to manage roles. Ask a Super Admin to grant you the
            &quot;roles.manage&quot; permission on Roles &amp; Permissions.
          </div>
          {readOnlyLoading ? (
            <div className="space-y-2" data-testid="loading-roles">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : readOnlyError ? (
            <p className="text-sm text-destructive" data-testid="text-roles-error">
              Failed to load roles.
            </p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-roles">
              No roles found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Description</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((role) => (
                  <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                    <TableCell className="font-medium" data-testid={`text-role-name-${role.id}`}>
                      {role.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-role-desc-${role.id}`}>
                      {role.description || "—"}
                    </TableCell>
                    <TableCell>
                      {role.isSystem ? (
                        <Badge variant="outline" data-testid={`badge-role-type-${role.id}`}>System</Badge>
                      ) : (
                        <Badge variant="secondary" data-testid={`badge-role-type-${role.id}`}>Custom</Badge>
                      )}
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

  const isMutating = createMutation.isPending || updateMutation.isPending;
  const rolesList = roles || [];

  return (
    <Card data-testid="card-roles-permissions">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" /> Roles & Permissions
        </CardTitle>
        <div className="flex items-center gap-2">
          <Link href="/permissions">
            <Button variant="outline" size="sm" data-testid="button-open-permission-matrix">
              Permission matrix <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
          <Button size="sm" onClick={openCreate} data-testid="button-create-role">
            <Plus className="h-4 w-4 mr-1" /> New role
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || perms.isLoading ? (
          <div className="space-y-2" data-testid="loading-roles">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive" data-testid="text-roles-error">
            Failed to load roles. Try refreshing the page.
          </p>
        ) : rolesList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-roles">
            No roles found.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Description</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Users</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolesList.map((role) => {
                const userCount = role.userCount ?? 0;
                const canEdit = !role.isSystem;
                const canDelete = !role.isSystem && userCount === 0;
                return (
                  <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                    <TableCell className="font-medium" data-testid={`text-role-name-${role.id}`}>
                      {role.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-role-desc-${role.id}`}>
                      {role.description || "—"}
                    </TableCell>
                    <TableCell>
                      {role.isSystem ? (
                        <Badge variant="outline" data-testid={`badge-role-type-${role.id}`}>System</Badge>
                      ) : (
                        <Badge variant="secondary" data-testid={`badge-role-type-${role.id}`}>Custom</Badge>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-role-users-${role.id}`}>
                      <Badge variant="secondary" className="font-normal">
                        {userCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/permissions?role=${role.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-manage-permissions-${role.id}`}
                            title="Manage permissions for this role"
                          >
                            <Shield className="h-3 w-3 mr-1" /> Permissions
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(role)}
                          disabled={!canEdit}
                          data-testid={`button-edit-role-${role.id}`}
                          title={canEdit ? "Edit role" : "System roles cannot be edited"}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={!canDelete || deleteMutation.isPending}
                              data-testid={`button-delete-role-${role.id}`}
                              title={
                                role.isSystem
                                  ? "System roles cannot be deleted"
                                  : userCount > 0
                                  ? "Reassign users before deleting"
                                  : "Delete role"
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent data-testid={`dialog-confirm-delete-role-${role.id}`}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete role &quot;{role.name}&quot;?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes the role. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-cancel-delete-role-${role.id}`}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(role.id)}
                                data-testid={`button-confirm-delete-role-${role.id}`}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground mt-4" data-testid="text-roles-info">
          Need to compare permissions side-by-side across roles? Open the{" "}
          <Link href="/permissions" className="underline" data-testid="link-permission-matrix-inline">
            full permission matrix
          </Link>
          .
        </p>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-role-form">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit role" : "New role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name-input">Name</Label>
              <Input
                id="role-name-input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Shift Lead"
                data-testid="input-role-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc-input">Description</Label>
              <Textarea
                id="role-desc-input"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="What does this role do?"
                rows={3}
                data-testid="input-role-description"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              After saving, use the &quot;Permissions&quot; action on the role row to grant access.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-role-form">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formName.trim() || isMutating} data-testid="button-submit-role">
              {editingRole ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const ALERT_PREVIEWS: { key: string; title: string; description: string }[] = [
  { key: "missing-clockout", title: "Missing Clock-Out Alert", description: "Notify managers when employees miss clock-out" },
  { key: "overtime", title: "Overtime Alert", description: "Alert when employees approach overtime threshold" },
  { key: "pto-request", title: "PTO Request Notification", description: "Notify managers of new PTO requests" },
  { key: "late-arrival", title: "Late Arrival Alert", description: "Alert on late arrivals past grace period" },
];

function AlertsSection() {
  return (
    <Card data-testid="card-alerts-settings">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Alerts & Notifications</CardTitle>
        <Badge variant="outline" className="font-normal" data-testid="badge-alerts-preview">Preview</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground" data-testid="text-alerts-preview-info">
          These toggles are a preview — they don't persist yet. Alerts are currently emitted by the
          system automatically based on attendance and PTO policies.
        </p>
        {ALERT_PREVIEWS.map((a) => (
          <div
            key={a.key}
            className="flex items-center justify-between p-3 bg-muted/30 rounded-md opacity-75"
          >
            <div>
              <p className="font-medium text-sm">{a.title}</p>
              <p className="text-xs text-muted-foreground">{a.description}</p>
            </div>
            <Switch disabled defaultChecked data-testid={`switch-alert-${a.key}`} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type KioskDeviceSummary = {
  id: string;
  name: string;
  isActive: boolean;
  derivedStatus?: string;
  pairingCode?: string | null;
  lastHeartbeat?: string | null;
};

function KioskSection() {
  const { data: devices, isLoading } = useQuery<KioskDeviceSummary[]>({ queryKey: ["/api/kiosk-devices"] });
  const list = devices || [];
  // A device is "paired" once it has actually been claimed by a tablet — i.e.
  // its derivedStatus is anything other than "unpaired" (online / idle /
  // offline / inactive). Newly created rows default to "unpaired", so we
  // must NOT count them.
  const paired = list.filter((d) => d.derivedStatus && d.derivedStatus !== "unpaired").length;
  const active = list.filter((d) => d.isActive).length;
  const online = list.filter((d) => d.derivedStatus === "online").length;

  return (
    <Card data-testid="card-kiosk-settings">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Kiosk & Devices</CardTitle>
        <Link href="/kiosk-management">
          <Button variant="outline" size="sm" data-testid="button-go-to-kiosks">
            Manage kiosks <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded-md p-3" data-testid="stat-kiosk-total">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Devices</p>
                <p className="text-2xl font-semibold">{list.length}</p>
              </div>
              <div className="border rounded-md p-3" data-testid="stat-kiosk-paired">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Paired</p>
                <p className="text-2xl font-semibold">{paired}</p>
                <p className="text-xs text-muted-foreground">{active} active</p>
              </div>
              <div className="border rounded-md p-3" data-testid="stat-kiosk-online">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Online now</p>
                <p className="text-2xl font-semibold">{online}</p>
              </div>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="text-kiosk-info">
                No kiosk devices have been paired yet. Go to Kiosk Management to add one. The public
                kiosk interface lives at <code className="text-xs">/kiosk</code>.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="text-kiosk-info">
                Manage pairing codes, location assignments, and recent punches from the Kiosk Management page.
              </p>
            )}
          </div>
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
  { value: "companyId", label: "Company" },
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
type DueRuleUI =
  | { kind: "none" }
  | { kind: "relative"; days: number; anchor?: "hire_date" | "start_date" | "termination_date" }
  | { kind: "absolute"; date: string }
  | { kind: "end_of_section"; days?: number };
type CustomFieldUI = { key: string; label: string; type: "text" | "textarea" | "number" | "date" | "select" | "checkbox"; required?: boolean; options?: string[]; placeholder?: string };
interface LifecycleSection { id: string; templateId: string; title: string; description: string | null; sortOrder: number }
interface LifecycleScope { id: string; templateId: string; scopeKind: "company" | "location" | "department" | "role" | "employment_type"; scopeRef: string }
interface LifecycleTask {
  id: string;
  templateId: string;
  sectionId?: string | null;
  title: string;
  description: string | null;
  instructions?: string | null;
  category: string;
  taskType?: string;
  ownerKind?: string;
  ownerRole: string;
  ownerUserId?: string | null;
  ownerDepartmentId?: string | null;
  isRequired: boolean;
  documentType?: string | null;
  linkUrl?: string | null;
  blocksDeactivation?: boolean;
  dueOffsetDays: number;
  dueRule?: DueRuleUI | null;
  customFields?: CustomFieldUI[] | null;
  sortOrder: number;
}
interface LifecycleTemplateFull extends LifecycleTemplate {
  sections: LifecycleSection[];
  tasks: LifecycleTask[];
  scopes: LifecycleScope[];
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

  const duplicateMut = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `${baseUrl}/${id}/duplicate`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [baseUrl] }); toast({ title: "Template duplicated" }); },
    onError: (e: unknown) => toast({ title: "Failed to duplicate", description: getMutationErrorMessage(e), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${baseUrl}/${id}`),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: [baseUrl] });
      if (selectedId === id) setSelectedId(null);
      toast({ title: "Template deleted" });
    },
    onError: (e: unknown) => toast({ title: "Failed to delete", description: getMutationErrorMessage(e), variant: "destructive" }),
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
                    <div className="flex gap-1 items-center">
                      {t.isDefault && <Badge variant="secondary">Default</Badge>}
                      <Badge variant={t.isActive ? "default" : "outline"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                    </div>
                  </div>
                  <div className="mt-2">
                    <LifecycleTemplateSummary templateId={t.id} kind={kind} userDescription={t.description} />
                  </div>
                  <div className="flex gap-1 mt-2">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); duplicateMut.mutate(t.id); }} data-testid={`button-duplicate-${kind}-template-${t.id}`}>Duplicate</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete template "${t.name}"? In-progress checklists will be detached.`)) deleteMut.mutate(t.id); }} data-testid={`button-delete-${kind}-template-${t.id}`}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="md:col-span-2">
              {selected ? (
                <LifecycleTemplateBuilder kind={kind} template={selected} />
              ) : (
                <p className="text-sm text-muted-foreground">Select a template to edit it.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LifecycleTemplateBuilder({ kind, template }: { kind: "onboarding" | "offboarding"; template: LifecycleTemplate }) {
  const { toast } = useToast();
  const baseUrl = `/api/${kind}-templates`;
  const fullKey = [`${baseUrl}/${template.id}/full`];
  const { data: full, isLoading } = useQuery<LifecycleTemplateFull>({ queryKey: fullKey });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: companies } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const { data: roles } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/roles"] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: fullKey });
    queryClient.invalidateQueries({ queryKey: [baseUrl] });
    queryClient.invalidateQueries({ queryKey: [`${baseUrl}/${template.id}`] });
  };

  const patchTemplate = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => apiRequest("PATCH", `${baseUrl}/${template.id}`, patch),
    onSuccess: () => invalidate(),
  });

  const addSection = useMutation({
    mutationFn: async (title: string) => apiRequest("POST", `${baseUrl}/${template.id}/sections`, { title, sortOrder: (full?.sections.length ?? 0) }),
    onSuccess: () => invalidate(),
  });
  const patchSection = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiRequest("PATCH", `/api/${kind}-template-sections/${id}`, patch),
    onSuccess: () => invalidate(),
  });
  const deleteSection = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/${kind}-template-sections/${id}`),
    onSuccess: () => invalidate(),
  });

  const addTask = useMutation({
    mutationFn: async (data: Record<string, unknown>) => apiRequest("POST", `${baseUrl}/${template.id}/tasks`, data),
    onSuccess: () => { invalidate(); toast({ title: "Task added" }); },
    onError: (e: unknown) => toast({ title: "Failed to add task", description: getMutationErrorMessage(e), variant: "destructive" }),
  });
  const patchTask = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiRequest("PATCH", `/api/${kind}-template-tasks/${id}`, patch),
    onSuccess: () => invalidate(),
  });
  const deleteTask = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/${kind}-template-tasks/${id}`),
    onSuccess: () => invalidate(),
  });

  const setScopes = useMutation({
    mutationFn: async (scopes: { scopeKind: string; scopeRef: string }[]) => apiRequest("PUT", `${baseUrl}/${template.id}/scopes`, { scopes }),
    onSuccess: () => { invalidate(); toast({ title: "Scopes updated" }); },
  });

  const propagateMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/lifecycle-templates/${template.id}/propagate`, { kind }),
    onSuccess: async (res: Response) => {
      const body = await res.json().catch(() => ({ propagated: 0 }));
      toast({ title: `Propagated to in-progress checklists`, description: `${body.propagated ?? 0} tasks added.` });
    },
    onError: (e: unknown) => toast({ title: "Propagate failed", description: getMutationErrorMessage(e), variant: "destructive" }),
  });

  const [sectionTitle, setSectionTitle] = useState("");
  const grouped = (() => {
    const sections = full?.sections ?? [];
    const tasks = full?.tasks ?? [];
    const bySection = new Map<string | null, LifecycleTask[]>();
    bySection.set(null, []);
    sections.forEach(s => bySection.set(s.id, []));
    for (const t of tasks) {
      const key = t.sectionId ?? null;
      if (!bySection.has(key)) bySection.set(null, [...(bySection.get(null) ?? []), t]);
      else bySection.get(key)!.push(t);
    }
    return { sections, bySection };
  })();

  if (isLoading || !full) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {!template.isDefault && (
          <Button size="sm" variant="outline" onClick={() => patchTemplate.mutate({ isDefault: true })} data-testid={`button-set-default-${template.id}`}>Set as default</Button>
        )}
        <Button size="sm" variant="outline" onClick={() => patchTemplate.mutate({ isActive: !template.isActive })}>
          {template.isActive ? "Deactivate" : "Activate"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => {
          if (confirm("Push this template's tasks to all in-progress checklists using it? New tasks will be added; existing ones won't be modified.")) {
            propagateMut.mutate();
          }
        }} data-testid={`button-propagate-${template.id}`}>Propagate to in-progress</Button>
      </div>

      {/* Scopes */}
      <div className="rounded-md border p-3 space-y-2">
        <div className="text-sm font-medium">Scopes (who gets this template)</div>
        <ScopeChipsEditor
          scopes={full.scopes}
          companies={companies ?? []}
          locations={locations ?? []}
          departments={departments ?? []}
          roles={roles ?? []}
          onSave={(scopes) => setScopes.mutate(scopes)}
        />
        {full.scopes.length === 0 && (
          <p className="text-xs text-muted-foreground">No scopes set — this template will only be suggested if marked default.</p>
        )}
      </div>

      {/* Sections + tasks */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input value={sectionTitle} onChange={e => setSectionTitle(e.target.value)} placeholder="New section title (e.g. Week 1)" className="max-w-xs" data-testid={`input-new-section-${kind}`} />
          <Button size="sm" variant="outline" onClick={() => { if (sectionTitle.trim()) { addSection.mutate(sectionTitle.trim()); setSectionTitle(""); } }} data-testid={`button-add-section-${kind}`}>
            <Plus className="h-4 w-4 mr-1" /> Add section
          </Button>
        </div>

        {[...grouped.sections, null as unknown as LifecycleSection].map((s, idx) => {
          const sectionId = s ? s.id : null;
          const sectionTasks = grouped.bySection.get(sectionId) ?? [];
          if (sectionId === null && sectionTasks.length === 0 && grouped.sections.length > 0) return null;
          return (
            <div key={s ? s.id : "__unsec__"} className="rounded-md border" data-testid={`section-block-${sectionId ?? "unsectioned"}`}>
              <div className="flex items-center justify-between p-3 border-b bg-muted/40">
                {s ? (
                  <Input
                    defaultValue={s.title}
                    onBlur={e => { if (e.target.value !== s.title) patchSection.mutate({ id: s.id, patch: { title: e.target.value } }); }}
                    className="font-medium max-w-md"
                    data-testid={`input-section-title-${s.id}`}
                  />
                ) : (
                  <div className="font-medium text-sm text-muted-foreground">Unsectioned</div>
                )}
                {s && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("Delete this section? Tasks in it will be moved to Unsectioned.")) deleteSection.mutate(s.id); }} data-testid={`button-delete-section-${s.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="p-3 space-y-2">
                {sectionTasks.map(t => (
                  <TaskRow
                    key={t.id}
                    kind={kind}
                    task={t}
                    sections={full.sections}
                    users={users ?? []}
                    departments={departments ?? []}
                    onPatch={(patch) => patchTask.mutate({ id: t.id, patch })}
                    onDelete={() => deleteTask.mutate(t.id)}
                  />
                ))}
                <TaskAddRow
                  kind={kind}
                  sectionId={sectionId}
                  onAdd={(data) => addTask.mutate({ ...data, sectionId })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScopeChipsEditor({
  scopes, companies, locations, departments, roles, onSave,
}: {
  scopes: LifecycleScope[];
  companies: Division[];
  locations: Location[];
  departments: Department[];
  roles: { id: string; name: string }[];
  onSave: (scopes: { scopeKind: string; scopeRef: string }[]) => void;
}) {
  const [draft, setDraft] = useState<{ scopeKind: string; scopeRef: string }[]>(
    scopes.map(s => ({ scopeKind: s.scopeKind, scopeRef: s.scopeRef })),
  );
  useEffect(() => {
    setDraft(scopes.map(s => ({ scopeKind: s.scopeKind, scopeRef: s.scopeRef })));
  }, [scopes]);
  const [newKind, setNewKind] = useState<string>("department");
  const [newRef, setNewRef] = useState<string>("");

  const labelFor = (kind: string, ref: string): string => {
    if (kind === "company") return companies.find(c => c.id === ref)?.name ?? ref;
    if (kind === "location") return locations.find(l => l.id === ref)?.name ?? ref;
    if (kind === "department") return departments.find(d => d.id === ref)?.name ?? ref;
    if (kind === "role") return roles.find(r => r.id === ref)?.name ?? ref;
    if (kind === "employment_type") return ref;
    return ref;
  };

  const options = (() => {
    if (newKind === "company") return companies.map(c => ({ value: c.id, label: c.name }));
    if (newKind === "location") return locations.map(l => ({ value: l.id, label: l.name }));
    if (newKind === "department") return departments.map(d => ({ value: d.id, label: d.name }));
    if (newKind === "role") return roles.map(r => ({ value: r.id, label: r.name }));
    if (newKind === "employment_type") return [
      { value: "full_time", label: "Full Time" },
      { value: "part_time", label: "Part Time" },
      { value: "contractor", label: "Contractor" },
      { value: "intern", label: "Intern" },
      { value: "per_diem", label: "Per Diem" },
    ];
    return [];
  })();

  const add = () => {
    if (!newRef) return;
    if (draft.some(d => d.scopeKind === newKind && d.scopeRef === newRef)) return;
    const next = [...draft, { scopeKind: newKind, scopeRef: newRef }];
    setDraft(next);
    setNewRef("");
    onSave(next);
  };
  const remove = (i: number) => {
    const next = draft.filter((_, idx) => idx !== i);
    setDraft(next);
    onSave(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {draft.map((s, i) => (
          <Badge key={`${s.scopeKind}:${s.scopeRef}`} variant="secondary" className="gap-1" data-testid={`badge-scope-${s.scopeKind}-${s.scopeRef}`}>
            <span className="text-xs uppercase opacity-70">{s.scopeKind}</span>
            <span>{labelFor(s.scopeKind, s.scopeRef)}</span>
            <button type="button" onClick={() => remove(i)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <Label className="text-xs">Scope</Label>
          <Select value={newKind} onValueChange={(v) => { setNewKind(v); setNewRef(""); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="company">Company</SelectItem>
              <SelectItem value="location">Location</SelectItem>
              <SelectItem value="department">Department</SelectItem>
              <SelectItem value="role">Role</SelectItem>
              <SelectItem value="employment_type">Employment Type</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[200px]">
          <Label className="text-xs">Value</Label>
          <Select value={newRef} onValueChange={setNewRef}>
            <SelectTrigger><SelectValue placeholder="Pick…" /></SelectTrigger>
            <SelectContent>
              {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={add} disabled={!newRef}>Add scope</Button>
      </div>
    </div>
  );
}

function TaskAddRow({ kind, sectionId, onAdd }: {
  kind: "onboarding" | "offboarding";
  sectionId: string | null;
  onAdd: (data: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <div className="flex gap-2 items-center pt-1">
      <Input
        placeholder="Add a task…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            onAdd({
              title: title.trim(),
              category: kind === "onboarding" ? "paperwork" : "access",
              ownerKind: "role",
              ownerRole: kind === "onboarding" ? "new_hire" : "manager",
              taskType: "checkbox",
              dueRule: { kind: "none" },
              isRequired: false,
              sortOrder: 0,
            });
            setTitle("");
          }
        }}
        className="max-w-md"
        data-testid={`input-add-task-${sectionId ?? "unsec"}`}
      />
      <Button size="sm" variant="outline" onClick={() => {
        if (!title.trim()) return;
        onAdd({
          title: title.trim(),
          category: kind === "onboarding" ? "paperwork" : "access",
          ownerKind: "role",
          ownerRole: kind === "onboarding" ? "new_hire" : "manager",
          taskType: "checkbox",
          dueRule: { kind: "none" },
          isRequired: false,
          sortOrder: 0,
        });
        setTitle("");
      }} data-testid={`button-add-task-${sectionId ?? "unsec"}`}><Plus className="h-4 w-4" /></Button>
    </div>
  );
}

function TaskRow({ kind, task, sections, users, departments, onPatch, onDelete }: {
  kind: "onboarding" | "offboarding";
  task: LifecycleTask;
  sections: LifecycleSection[];
  users: User[];
  departments: Department[];
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const due: DueRuleUI = task.dueRule ?? { kind: "relative", days: task.dueOffsetDays };

  return (
    <div className="rounded border bg-card" data-testid={`row-task-${task.id}`}>
      <div className="flex items-center gap-2 p-2">
        <Input
          defaultValue={task.title}
          onBlur={(e) => { if (e.target.value !== task.title) onPatch({ title: e.target.value }); }}
          className="font-medium"
          data-testid={`input-task-title-${task.id}`}
        />
        <Select value={task.taskType ?? "checkbox"} onValueChange={(v) => onPatch({ taskType: v })}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="checkbox">Checkbox</SelectItem>
            <SelectItem value="document">Document upload</SelectItem>
            <SelectItem value="signature">Signature</SelectItem>
            <SelectItem value="link">External link</SelectItem>
            <SelectItem value="free_text">Free text</SelectItem>
            <SelectItem value="file">File upload</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Checkbox checked={task.isRequired} onCheckedChange={(v) => onPatch({ isRequired: !!v })} id={`req-${task.id}`} />
          <Label htmlFor={`req-${task.id}`} className="text-xs m-0">Required</Label>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(v => !v)} data-testid={`button-expand-task-${task.id}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete} data-testid={`button-delete-task-${task.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {expanded && (
        <div className="border-t p-3 space-y-3 bg-muted/20">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Input defaultValue={task.category} onBlur={e => { if (e.target.value !== task.category) onPatch({ category: e.target.value }); }} />
            </div>
            <div>
              <Label className="text-xs">Section</Label>
              <Select value={task.sectionId ?? "__none__"} onValueChange={(v) => onPatch({ sectionId: v === "__none__" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unsectioned</SelectItem>
                  {sections.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Owner</Label>
              <OwnerEditor
                kind={kind}
                ownerKind={task.ownerKind ?? "role"}
                ownerRole={task.ownerRole}
                ownerUserId={task.ownerUserId ?? null}
                ownerDepartmentId={task.ownerDepartmentId ?? null}
                users={users}
                departments={departments}
                onChange={(patch) => onPatch(patch)}
              />
            </div>
            <div>
              <Label className="text-xs">Due rule</Label>
              <DueRuleEditor kind={kind} value={due} onChange={(v) => onPatch({ dueRule: v })} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Instructions (optional)</Label>
            <Textarea defaultValue={task.instructions ?? ""} onBlur={(e) => { if ((e.target.value || null) !== task.instructions) onPatch({ instructions: e.target.value || null }); }} rows={2} />
          </div>

          {task.taskType === "link" && (
            <div>
              <Label className="text-xs">Link URL</Label>
              <Input defaultValue={task.linkUrl ?? ""} onBlur={(e) => { if ((e.target.value || null) !== task.linkUrl) onPatch({ linkUrl: e.target.value || null }); }} placeholder="https://…" />
            </div>
          )}

          {kind === "onboarding" && task.taskType === "document" && (
            <div>
              <Label className="text-xs">Document type (auto-completes when uploaded)</Label>
              <Select value={task.documentType || "_none"} onValueChange={(v) => onPatch({ documentType: v === "_none" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ONBOARDING_DOCUMENT_TYPES.map(d => <SelectItem key={d.value || "none"} value={d.value || "_none"}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === "offboarding" && (
            <div className="flex items-center gap-2">
              <Checkbox checked={!!task.blocksDeactivation} onCheckedChange={(v) => onPatch({ blocksDeactivation: !!v })} id={`blk-${task.id}`} />
              <Label htmlFor={`blk-${task.id}`} className="text-xs m-0">Blocks account deactivation until complete</Label>
            </div>
          )}

          <CustomFieldsEditor value={task.customFields ?? []} onChange={(v) => onPatch({ customFields: v })} />
        </div>
      )}
    </div>
  );
}

function OwnerEditor({ kind, ownerKind, ownerRole, ownerUserId, ownerDepartmentId, users, departments, onChange }: {
  kind: "onboarding" | "offboarding";
  ownerKind: string;
  ownerRole: string;
  ownerUserId: string | null;
  ownerDepartmentId: string | null;
  users: User[];
  departments: Department[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex gap-2">
      <Select value={ownerKind} onValueChange={(v) => onChange({ ownerKind: v, ownerUserId: null, ownerDepartmentId: null })}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="role">Role</SelectItem>
          <SelectItem value="user">Specific user</SelectItem>
          <SelectItem value="department">Department</SelectItem>
          {kind === "onboarding" && <SelectItem value="new_hire">New hire</SelectItem>}
          {kind === "offboarding" && <SelectItem value="departing_employee">Departing employee</SelectItem>}
        </SelectContent>
      </Select>
      {ownerKind === "role" && (
        <Select value={ownerRole} onValueChange={(v) => onChange({ ownerRole: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hr">HR</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="it">IT</SelectItem>
            <SelectItem value="finance">Finance</SelectItem>
            {kind === "onboarding" && <SelectItem value="new_hire">New Hire</SelectItem>}
            <SelectItem value="system">System (auto)</SelectItem>
          </SelectContent>
        </Select>
      )}
      {ownerKind === "user" && (
        <Select value={ownerUserId ?? ""} onValueChange={(v) => onChange({ ownerUserId: v, ownerRole: "hr" })}>
          <SelectTrigger><SelectValue placeholder="Pick user…" /></SelectTrigger>
          <SelectContent>
            {users.map(u => <SelectItem key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {ownerKind === "department" && (
        <Select value={ownerDepartmentId ?? ""} onValueChange={(v) => onChange({ ownerDepartmentId: v, ownerRole: "hr" })}>
          <SelectTrigger><SelectValue placeholder="Pick dept…" /></SelectTrigger>
          <SelectContent>
            {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function DueRuleEditor({ kind, value, onChange }: {
  kind: "onboarding" | "offboarding";
  value: DueRuleUI;
  onChange: (v: DueRuleUI) => void;
}) {
  const defaultAnchor = kind === "onboarding" ? "hire_date" : "termination_date";
  return (
    <div className="flex gap-2 flex-wrap">
      <Select value={value.kind} onValueChange={(k) => {
        if (k === "none") onChange({ kind: "none" });
        else if (k === "relative") onChange({ kind: "relative", days: 0, anchor: defaultAnchor as any });
        else if (k === "absolute") onChange({ kind: "absolute", date: new Date().toISOString().slice(0, 10) });
        else if (k === "end_of_section") onChange({ kind: "end_of_section", days: 0 });
      }}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No due date</SelectItem>
          <SelectItem value="relative">Relative to date</SelectItem>
          <SelectItem value="absolute">Specific date</SelectItem>
          <SelectItem value="end_of_section">End of section</SelectItem>
        </SelectContent>
      </Select>
      {value.kind === "relative" && (
        <>
          <Input type="number" value={value.days} onChange={(e) => onChange({ ...value, days: Number(e.target.value) })} className="w-20" />
          <span className="self-center text-xs text-muted-foreground">days from</span>
          <Select value={value.anchor ?? defaultAnchor} onValueChange={(v) => onChange({ ...value, anchor: v as any })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hire_date">Hire date</SelectItem>
              <SelectItem value="start_date">Start date</SelectItem>
              <SelectItem value="termination_date">Termination date</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
      {value.kind === "absolute" && (
        <Input type="date" value={value.date} onChange={(e) => onChange({ kind: "absolute", date: e.target.value })} className="w-40" />
      )}
      {value.kind === "end_of_section" && (
        <>
          <Input type="number" value={value.days ?? 0} onChange={(e) => onChange({ kind: "end_of_section", days: Number(e.target.value) })} className="w-20" />
          <span className="self-center text-xs text-muted-foreground">days after last in section</span>
        </>
      )}
    </div>
  );
}

function CustomFieldsEditor({ value, onChange }: { value: CustomFieldUI[]; onChange: (v: CustomFieldUI[]) => void }) {
  const [draft, setDraft] = useState<CustomFieldUI[]>(value);
  useEffect(() => { setDraft(value); }, [value]);
  const save = (next: CustomFieldUI[]) => { setDraft(next); onChange(next); };
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">Custom fields (collected when completing this task)</div>
      {draft.map((f, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input placeholder="key" value={f.key} onChange={(e) => save(draft.map((d, idx) => idx === i ? { ...d, key: e.target.value } : d))} className="w-32" />
          <Input placeholder="Label" value={f.label} onChange={(e) => save(draft.map((d, idx) => idx === i ? { ...d, label: e.target.value } : d))} />
          <Select value={f.type} onValueChange={(v) => save(draft.map((d, idx) => idx === i ? { ...d, type: v as any } : d))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="textarea">Long text</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="select">Select</SelectItem>
              <SelectItem value="checkbox">Checkbox</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Checkbox checked={!!f.required} onCheckedChange={(v) => save(draft.map((d, idx) => idx === i ? { ...d, required: !!v } : d))} id={`cf-req-${i}`} />
            <Label htmlFor={`cf-req-${i}`} className="text-xs m-0">Req</Label>
          </div>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => save(draft.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => save([...draft, { key: `field_${draft.length + 1}`, label: "", type: "text" }])}>
        <Plus className="h-4 w-4 mr-1" /> Add custom field
      </Button>
    </div>
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
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
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
              <Label>Company (optional)</Label>
              <Select
                value={companyId || "all"}
                onValueChange={(v) => {
                  if (v === INLINE_ADD_NEW_VALUE) {
                    setCreateCompanyOpen(true);
                    return;
                  }
                  setCompanyId(v === "all" ? "" : v);
                }}
              >
                <SelectTrigger data-testid="select-template-division"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All companies</SelectItem>
                  {divisions?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  <PermissionedAddNewItem
                    permission="company.create"
                    label="Add new company"
                    testId="option-template-add-new-company"
                  />
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
      <CreateCompanyDialog
        open={createCompanyOpen}
        onOpenChange={setCreateCompanyOpen}
        onCreated={(company) => {
          setCompanyId(company.id);
        }}
      />
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
              <Label>Filter Company</Label>
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
        return `Company: ${divisions?.find((d) => d.id === rule.companyId)?.name || rule.companyId}`;
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
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createLocationOpen, setCreateLocationOpen] = useState(false);
  const [createDepartmentOpen, setCreateDepartmentOpen] = useState(false);

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
                <SelectItem value="company">By Company</SelectItem>
                <SelectItem value="location">By Location</SelectItem>
                <SelectItem value="department">By Department</SelectItem>
                <SelectItem value="employee">Specific Employee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.scopeType === "company" && (
            <div className="space-y-1">
              <Label>Company</Label>
              <Select
                value={form.companyId}
                onValueChange={(v) => {
                  if (v === INLINE_ADD_NEW_VALUE) {
                    setCreateCompanyOpen(true);
                    return;
                  }
                  setForm((f) => ({ ...f, companyId: v }));
                }}
              >
                <SelectTrigger data-testid="select-trigger-required-doc-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {divisions.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                  <PermissionedAddNewItem
                    permission="company.create"
                    label="Add new company"
                    testId="option-required-doc-add-new-company"
                  />
                </SelectContent>
              </Select>
            </div>
          )}
          {form.scopeType === "location" && (
            <div className="space-y-1">
              <Label>Location</Label>
              <Select
                value={form.locationId}
                onValueChange={(v) => {
                  if (v === INLINE_ADD_NEW_VALUE) {
                    setCreateLocationOpen(true);
                    return;
                  }
                  setForm((f) => ({ ...f, locationId: v }));
                }}
              >
                <SelectTrigger data-testid="select-trigger-required-doc-location"><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
                  <PermissionedAddNewItem
                    permission="locations.manage"
                    label="Add new location"
                    testId="option-required-doc-add-new-location"
                  />
                </SelectContent>
              </Select>
            </div>
          )}
          {form.scopeType === "department" && (
            <div className="space-y-1">
              <Label>Department</Label>
              <Select
                value={form.departmentId}
                onValueChange={(v) => {
                  if (v === INLINE_ADD_NEW_VALUE) {
                    setCreateDepartmentOpen(true);
                    return;
                  }
                  setForm((f) => ({ ...f, departmentId: v }));
                }}
              >
                <SelectTrigger data-testid="select-trigger-required-doc-department"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
                  <PermissionedAddNewItem
                    permission="departments.create"
                    label="Add new department"
                    testId="option-required-doc-add-new-department"
                  />
                </SelectContent>
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
      <CreateCompanyDialog
        open={createCompanyOpen}
        onOpenChange={setCreateCompanyOpen}
        onCreated={(company) => {
          setForm((f) => ({ ...f, companyId: company.id }));
        }}
      />
      <CreateLocationDialog
        open={createLocationOpen}
        onOpenChange={setCreateLocationOpen}
        onCreated={(location) => {
          setForm((f) => ({ ...f, locationId: location.id }));
        }}
      />
      <CreateDepartmentDialog
        open={createDepartmentOpen}
        onOpenChange={setCreateDepartmentOpen}
        onCreated={(dept) => {
          setForm((f) => ({ ...f, departmentId: dept.id }));
        }}
      />
    </Dialog>
  );
}

