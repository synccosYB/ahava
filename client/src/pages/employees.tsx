import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Search, UserPlus, ArrowLeft, ChevronRight, AlertCircle, KeyRound, Copy, Upload, Download, FileText, CheckCircle2, Circle, Clock, Trash2, Eye, ExternalLink, Building2, Link2, Unlink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { formatCurrency, formatHoursMinutes, formatDate } from "@/lib/utils";
import type { User, Department, Location, EmploymentProfile, EmployeeSchedule, Division, PerformanceReviewReminder, PerformanceReviewCycle } from "@shared/schema";
import { CertificationsCard } from "@/components/certifications-card";
import { EmployeeTimesheetCard } from "@/components/employee-timesheet";
import {
  type CorrectionCountSummary,
  isHighCorrectionCount,
  HIGH_CORRECTION_THRESHOLD,
} from "@shared/correctionCounts";

type EmployeeListItem = User & {
  departmentName?: string;
  locationName?: string;
  lastPunch?: string;
  payType?: string;
  ptoEligible?: boolean;
};

const REQUIRED_DOCUMENT_TYPES = [
  { key: "w9", label: "W-9" },
  { key: "i9", label: "I-9" },
  { key: "direct_deposit", label: "Direct Deposit Authorization" },
  { key: "emergency_contact", label: "Emergency Contact Form" },
  { key: "handbook_ack", label: "Employee Handbook Acknowledgment" },
];

export default function EmployeesPage() {
  const [, navigate] = useLocation();
  const initialEmployeeId = (() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("employeeId");
  })();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(initialEmployeeId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("employeeId");
    if (id && id !== selectedEmployee) setSelectedEmployee(id);
  }, []);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [taxClassFilter, setTaxClassFilter] = useState("all");
  const [certStatusFilter, setCertStatusFilter] = useState("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const { user: currentUser } = useAuth();
  const { has: hasPermission } = usePermissions();
  const canDelete = hasPermission("users.delete");

  const { data: users, isLoading, isError } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: divisions } = useQuery<Division[]>({
    queryKey: ["/api/companies"],
  });

  const { data: allCertifications } = useQuery<{ id: string; employeeId: string; status: string }[]>({
    queryKey: ["/api/certifications"],
    enabled: certStatusFilter !== "all",
  });

  // Bulk-fetch all employment profiles so we can show + filter on tax
  // classification in the Employees list. Falls back to W-2 for users without
  // a profile (rollout default).
  const { data: allProfiles } = useQuery<EmploymentProfile[]>({
    queryKey: ["/api/employment-profiles"],
  });
  const taxClassByUser = new Map<string, string>(
    (allProfiles || []).map((p) => [p.userId, p.taxClassification || "W-2"]),
  );

  const certStatusByEmployee = (() => {
    const m = new Map<string, Set<string>>();
    (allCertifications || []).forEach((c) => {
      if (c.status === "archived") return;
      if (!m.has(c.employeeId)) m.set(c.employeeId, new Set());
      m.get(c.employeeId)!.add(c.status);
    });
    return m;
  })();

  const filtered = (users || []).filter((u) => {
    const name = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
    if (debouncedSearch && !name.includes(debouncedSearch.toLowerCase()) && !u.email?.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (departmentFilter !== "all" && u.departmentId !== departmentFilter) return false;
    if (divisionFilter !== "all" && u.companyId !== divisionFilter) return false;
    if (taxClassFilter !== "all" && (taxClassByUser.get(u.id) || "W-2") !== taxClassFilter) return false;
    if (certStatusFilter !== "all") {
      const statuses = certStatusByEmployee.get(u.id) || new Set();
      if (certStatusFilter === "none" && statuses.size > 0) return false;
      if (certStatusFilter !== "none" && !statuses.has(certStatusFilter)) return false;
    }
    return true;
  });

  if (selectedEmployee) {
    return <EmployeeProfile userId={selectedEmployee} onBack={() => setSelectedEmployee(null)} />;
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((u) => selectedIds.has(u.id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filtered.forEach((u) => next.delete(u.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  return (
    <div className="max-w-6xl space-y-6" data-testid="employees-page">
      <PageHeader title="Employees" subtitle="Manage employee records and profiles" />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-employees"
          />
        </div>
        <Select value={divisionFilter} onValueChange={setDivisionFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-company-filter">
            <SelectValue placeholder="Company" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {divisions?.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={taxClassFilter} onValueChange={setTaxClassFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-tax-class-filter">
            <SelectValue placeholder="Tax Classification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tax Classifications</SelectItem>
            <SelectItem value="W-2">W-2</SelectItem>
            <SelectItem value="1099">1099</SelectItem>
          </SelectContent>
        </Select>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-department-filter">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments?.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={certStatusFilter} onValueChange={setCertStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-cert-status-filter">
            <SelectValue placeholder="Cert Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cert Statuses</SelectItem>
            <SelectItem value="none">No Certifications</SelectItem>
            <SelectItem value="valid">Valid</SelectItem>
            <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <AddEmployeeDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          departments={departments || []}
          locations={locations || []}
          divisions={divisions || []}
        />
      </div>

      {selectedIds.size > 0 && (
        <div
          className="flex items-center justify-between gap-4 rounded-md border bg-muted/40 p-3"
          data-testid="bar-bulk-actions"
        >
          <div className="text-sm" data-testid="text-selected-count">
            <span className="font-medium">{selectedIds.size}</span> selected
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={clearSelection}
              data-testid="button-clear-selection"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => setBulkDialogOpen(true)}
              data-testid="button-bulk-assign-division"
            >
              <Building2 className="h-4 w-4 mr-2" />
              Assign Company
            </Button>
            {canDelete && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setBulkDeleteDialogOpen(true)}
                data-testid="button-bulk-delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}

      <BulkDeleteEmployeesDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        users={(users || []).filter((u) => selectedIds.has(u.id))}
        currentUserId={currentUser?.id}
        onSuccess={clearSelection}
      />

      <BulkAssignDivisionDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        userIds={Array.from(selectedIds)}
        divisions={divisions || []}
        onSuccess={clearSelection}
      />

      <Card data-testid="card-employees-list">
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 flex items-center gap-2 text-destructive" data-testid="error-employees">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">Failed to load employees.</p>
            </div>
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-employees">
              No employees found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Email</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Role</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Company</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Tax Class</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => {
                  const dept = departments?.find((d) => d.id === emp.departmentId);
                  const loc = locations?.find((l) => l.id === emp.locationId);
                  const div = divisions?.find((d) => d.id === emp.companyId);
                  return (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedEmployee(emp.id)}
                      data-testid={`row-employee-${emp.id}`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(emp.id)}
                          onCheckedChange={() => toggleSelect(emp.id)}
                          aria-label={`Select ${emp.firstName} ${emp.lastName}`}
                          data-testid={`checkbox-select-${emp.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-employee-name-${emp.id}`}>
                        {emp.firstName} {emp.lastName}
                      </TableCell>
                      <TableCell data-testid={`text-employee-email-${emp.id}`}>{emp.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" data-testid={`badge-employee-role-${emp.id}`}>
                            {emp.role}
                          </Badge>
                          {emp.roleManuallyOverriddenAt ? (
                            <Badge variant="secondary" className="text-xs" title="Role was set manually" data-testid={`badge-role-manual-${emp.id}`}>Manual</Badge>
                          ) : (emp as any).assignedByRule ? (
                            <Badge
                              variant="secondary"
                              className="text-xs"
                              title={`Set by rule: ${(emp as any).assignedByRule.name}`}
                              data-testid={`badge-role-auto-${emp.id}`}
                            >
                              Set by rule
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-employee-company-${emp.id}`}>{div?.name || "—"}</TableCell>
                      <TableCell data-testid={`text-employee-dept-${emp.id}`}>{dept?.name || "—"}</TableCell>
                      <TableCell data-testid={`text-employee-loc-${emp.id}`}>{loc?.name || "—"}</TableCell>
                      <TableCell data-testid={`text-employee-tax-class-${emp.id}`}>
                        <Badge variant="outline">{taxClassByUser.get(emp.id) || "W-2"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default" className="bg-green-600" data-testid={`badge-employee-status-${emp.id}`}>
                          Active
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BulkAssignDivisionDialog({
  open,
  onOpenChange,
  userIds,
  divisions,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  divisions: Division[];
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("");
  const [keepCompatible, setKeepCompatible] = useState(false);

  useEffect(() => {
    if (!open) {
      setCompanyId("");
      setKeepCompatible(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users/bulk-assign-division", {
        userIds,
        companyId,
        keepCompatible,
      });
      return res.json();
    },
    onSuccess: (data: { updatedCount: number; skipped: { id: string; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Company assigned",
        description: `${data.updatedCount} employee${data.updatedCount === 1 ? "" : "s"} updated${
          data.skipped.length ? `, ${data.skipped.length} skipped` : ""
        }.`,
      });
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-bulk-assign-division">
        <DialogHeader>
          <DialogTitle>Assign Company</DialogTitle>
          <DialogDescription>
            Assign {userIds.length} selected employee{userIds.length === 1 ? "" : "s"} to a company.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger data-testid="select-bulk-division">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {divisions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="keep-compatible"
              checked={keepCompatible}
              onCheckedChange={(v) => setKeepCompatible(v === true)}
              data-testid="checkbox-keep-compatible"
            />
            <div className="space-y-1">
              <Label htmlFor="keep-compatible" className="cursor-pointer">
                Keep existing department & location if compatible
              </Label>
              <p className="text-xs text-muted-foreground">
                When unchecked, department and location are cleared. When checked, they're kept only if they belong to the new company.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-bulk">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!companyId || mutation.isPending || userIds.length === 0}
            data-testid="button-confirm-bulk-assign"
          >
            {mutation.isPending ? "Assigning..." : `Assign ${userIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkDeleteEmployeesDialog({
  open,
  onOpenChange,
  users,
  currentUserId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  currentUserId?: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!open) setConfirmText("");
  }, [open]);

  const selfFiltered = users.filter((u) => u.id !== currentUserId);
  const filteredSelfOut = users.length - selfFiltered.length;
  const targetIds = selfFiltered.map((u) => u.id);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users/bulk-delete", { userIds: targetIds });
      return res.json();
    },
    onSuccess: (data: { deleted: string[]; skipped: { userId: string; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      const deletedCount = data.deleted.length;
      const skipped = data.skipped || [];
      const skippedDesc = skipped.length
        ? ` ${skipped.length} skipped (${Array.from(new Set(skipped.map((s) => s.reason))).join(", ")}).`
        : "";
      toast({
        title: "Employees deleted",
        description: `${deletedCount} employee${deletedCount === 1 ? "" : "s"} deleted.${skippedDesc}`,
      });
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const confirmReady = confirmText.trim().toUpperCase() === "DELETE" && targetIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-bulk-delete">
        <DialogHeader>
          <DialogTitle>Delete employees</DialogTitle>
          <DialogDescription>
            This permanently removes {targetIds.length} employee
            {targetIds.length === 1 ? "" : "s"} and their account access. This
            action cannot be undone. Use offboarding instead if you only need to
            deactivate them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {filteredSelfOut > 0 && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              data-testid="text-self-filtered-note"
            >
              You cannot delete your own account, so it was removed from the
              selection.
            </div>
          )}
          <div className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm" data-testid="list-delete-targets">
            {selfFiltered.length === 0 ? (
              <p className="text-muted-foreground">No employees to delete.</p>
            ) : (
              <ul className="space-y-1">
                {selfFiltered.map((u) => (
                  <li key={u.id} data-testid={`text-delete-target-${u.id}`}>
                    {u.firstName} {u.lastName}{" "}
                    <span className="text-muted-foreground">({u.email})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-delete-input">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm-delete-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              data-testid="input-confirm-delete"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-bulk-delete">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={!confirmReady || mutation.isPending}
            data-testid="button-confirm-bulk-delete"
          >
            {mutation.isPending ? "Deleting..." : `Delete ${targetIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEmployeeDialog({
  open,
  onOpenChange,
  departments: _allDepartments,
  locations: _allLocations,
  divisions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: Department[];
  locations: Location[];
  divisions: Division[];
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    role: "employee",
    companyId: "",
    departmentId: "",
    locationId: "",
    employmentType: "full_time",
    taxClassification: "W-2",
    hireDate: new Date().toISOString().split("T")[0],
    payType: "hourly",
    hourlyRate: "",
    weeklySalary: "",
    onboardingTemplateId: "",
  });

  const { data: onboardingTemplates = [] } = useQuery<Array<{ id: string; name: string; isDefault: boolean; companyId: string | null; isActive: boolean }>>({
    queryKey: ["/api/onboarding-templates", { companyId: formData.companyId }],
    queryFn: async () => {
      const url = formData.companyId
        ? `/api/onboarding-templates?companyId=${formData.companyId}`
        : `/api/onboarding-templates`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch onboarding templates");
      return res.json();
    },
    enabled: open && !!formData.companyId,
  });

  const { data: scopedDepartments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments", { companyId: formData.companyId }],
    queryFn: async () => {
      const res = await fetch(`/api/departments?companyId=${formData.companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch departments");
      return res.json();
    },
    enabled: !!formData.companyId,
  });

  const { data: scopedLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", { companyId: formData.companyId }],
    queryFn: async () => {
      const res = await fetch(`/api/locations?companyId=${formData.companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch locations");
      return res.json();
    },
    enabled: !!formData.companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string | number | null> = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email.trim().toLowerCase(),
        role: formData.role,
        companyId: formData.companyId || null,
        departmentId: formData.departmentId || null,
        locationId: formData.locationId || null,
        employmentType: formData.employmentType,
        taxClassification: formData.taxClassification,
        hireDate: formData.hireDate,
        payType: formData.payType,
      };
      if (formData.payType === "hourly" && formData.hourlyRate) {
        body.hourlyRate = parseFloat(formData.hourlyRate);
      }
      if (formData.payType === "salary" && formData.weeklySalary) {
        body.weeklySalary = parseFloat(formData.weeklySalary);
      }
      if (formData.onboardingTemplateId) {
        body.onboardingTemplateId = formData.onboardingTemplateId;
      }
      const res = await apiRequest("POST", "/api/users", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setTempPassword(data.temporaryPassword);
      setStep(4);
      setEmailError(null);
      toast({ title: "Employee created successfully" });
    },
    onError: (err: Error) => {
      if (isApiError(err) && err.status === 409 && err.code === "EMAIL_ALREADY_EXISTS") {
        const msg = "An employee with this email already exists.";
        setEmailError(msg);
        setStep(1);
        toast({ title: "Duplicate email", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setStep(1);
    setTempPassword(null);
    setEmailError(null);
    setFormData({
      firstName: "", lastName: "", email: "", role: "employee",
      companyId: "", departmentId: "", locationId: "", employmentType: "full_time",
      taxClassification: "W-2",
      hireDate: new Date().toISOString().split("T")[0], payType: "hourly",
      hourlyRate: "", weeklySalary: "", onboardingTemplateId: "",
    });
    onOpenChange(false);
  };

  const copyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      toast({ title: "Copied to clipboard" });
    }
  };

  const canProceedStep1 = !!(formData.firstName && formData.lastName && formData.email && formData.companyId);
  const canProceedStep2 = true;
  const canProceedStep3 = true;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-employee" onClick={() => onOpenChange(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" data-testid="dialog-add-employee">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {step === 4 ? "Employee Created" : `Add Employee — Step ${step} of 3`}
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Enter basic information for the new employee."}
            {step === 2 && "Set employment details."}
            {step === 3 && "Configure pay setup."}
            {step === 4 && "Share the temporary password with the employee."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="First name"
                  data-testid="input-add-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Last name"
                  data-testid="input-add-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => {
                  setFormData({ ...formData, email: e.target.value.toLowerCase() });
                  if (emailError) setEmailError(null);
                }}
                placeholder="employee@company.com"
                data-testid="input-add-email"
                aria-invalid={emailError ? true : undefined}
                className={emailError ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {emailError && (
                <p
                  className="text-sm text-destructive"
                  data-testid="text-add-email-error"
                >
                  {emailError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                <SelectTrigger data-testid="select-add-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Company *</Label>
              <Select
                value={formData.companyId}
                onValueChange={(v) => setFormData({ ...formData, companyId: v, departmentId: "", locationId: "" })}
              >
                <SelectTrigger data-testid="select-add-division">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {divisions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={formData.departmentId || "none"} onValueChange={(v) => setFormData({ ...formData, departmentId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-add-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Department</SelectItem>
                  {scopedDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={formData.locationId || "none"} onValueChange={(v) => setFormData({ ...formData, locationId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-add-location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Location</SelectItem>
                  {scopedLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Employment Type</Label>
              <Select value={formData.employmentType} onValueChange={(v) => setFormData({ ...formData, employmentType: v })}>
                <SelectTrigger data-testid="select-add-employment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="per_diem">Per Diem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tax Classification</Label>
              <Select value={formData.taxClassification} onValueChange={(v) => setFormData({ ...formData, taxClassification: v })}>
                <SelectTrigger data-testid="select-add-tax-classification">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="W-2">W-2</SelectItem>
                  <SelectItem value="1099">1099</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Tax form classification — independent from employment type.</p>
            </div>
            <div className="space-y-2">
              <Label>Hire Date</Label>
              <Input
                type="date"
                value={formData.hireDate}
                onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                data-testid="input-add-hire-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Onboarding Template</Label>
              <Select
                value={formData.onboardingTemplateId || "default"}
                onValueChange={(v) => setFormData({ ...formData, onboardingTemplateId: v === "default" ? "" : v })}
              >
                <SelectTrigger data-testid="select-add-onboarding-template">
                  <SelectValue placeholder="Use company default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Use company default</SelectItem>
                  {onboardingTemplates
                    .filter(t => t.isActive && (t.companyId === null || t.companyId === formData.companyId))
                    .map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}{t.isDefault ? " (default)" : ""}{t.companyId === null ? " — Global" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Optional — overrides the company default for this hire only.</p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pay Type</Label>
              <Select value={formData.payType} onValueChange={(v) => setFormData({ ...formData, payType: v })}>
                <SelectTrigger data-testid="select-add-pay-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="salary">Salary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.payType === "hourly" && (
              <div className="space-y-2">
                <Label>Hourly Rate ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.hourlyRate}
                  onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-add-hourly-rate"
                />
              </div>
            )}
            {formData.payType === "salary" && (
              <div className="space-y-2">
                <Label>Weekly Salary ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.weeklySalary}
                  onChange={(e) => setFormData({ ...formData, weeklySalary: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-add-weekly-salary"
                />
              </div>
            )}
          </div>
        )}

        {step === 4 && tempPassword && (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                The employee has been created with a temporary password. Share this password securely — they will be required to change it on first login.
              </p>
              <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded border p-3">
                <code className="flex-1 text-lg font-mono" data-testid="text-temp-password">{tempPassword}</code>
                <Button size="sm" variant="outline" onClick={copyPassword} data-testid="button-copy-password">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step < 4 && step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} data-testid="button-step-back">
              Back
            </Button>
          )}
          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!canProceedStep1} data-testid="button-step-next">
              Next
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!canProceedStep2} data-testid="button-step-next">
              Next
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              data-testid="button-create-employee"
            >
              {createMutation.isPending ? "Creating..." : "Create Employee"}
            </Button>
          )}
          {step === 4 && (
            <Button onClick={handleClose} data-testid="button-done">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeProfile({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { toast } = useToast();
  const initialUrlParams = (() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  })();
  const initialTab = (() => {
    const t = initialUrlParams.get("tab");
    const section = initialUrlParams.get("section");
    if (section === "certifications") return "basic";
    if (t === "certifications") return "basic";
    if (t && ["basic", "employment", "pay", "timeclock", "pto", "schedule", "documents", "history"].includes(t)) return t;
    return "basic";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const certIdFromUrl = initialUrlParams.get("certId");
  const focusDocType = initialUrlParams.get("focus");

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const user = users?.find((u) => u.id === userId);

  const { data: profile, isLoading: profileLoading } = useQuery<EmploymentProfile>({
    queryKey: ["/api/employment-profiles", userId],
  });

  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });

  const companyId = user?.companyId || "";

  const { data: scopedDepartments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments", { companyId }],
    queryFn: async () => {
      const res = await fetch(`/api/departments?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch departments");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: scopedLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", { companyId }],
    queryFn: async () => {
      const res = await fetch(`/api/locations?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch locations");
      return res.json();
    },
    enabled: !!companyId,
  });

  const roleMutation = useMutation({
    mutationFn: async (newRole: string) => {
      await apiRequest("PATCH", `/api/users/${userId}/role`, { role: newRole });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/users/${userId}/clear-role-override`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Override cleared", description: "Role re-evaluated by automation rules" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { companyId?: string | null; departmentId?: string | null; locationId?: string | null }) => {
      await apiRequest("PATCH", `/api/users/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const taxClassMutation = useMutation({
    mutationFn: async (taxClassification: string) => {
      await apiRequest("PATCH", `/api/employment-profiles/${userId}`, { taxClassification });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      toast({ title: "Tax classification updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const dept = departments?.find((d) => d.id === user?.departmentId);
  const loc = locations?.find((l) => l.id === user?.locationId);
  const div = divisions?.find((d) => d.id === user?.companyId);

  return (
    <div className="max-w-6xl space-y-6" data-testid="employee-profile-page">
      <PageHeader
        title={`${user?.firstName || ""} ${user?.lastName || ""}`}
        subtitle={user?.email || ""}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Badge variant="outline" data-testid="badge-employee-profile-role">
              {user?.role}
            </Badge>
            <ResetPasswordButton userId={userId} />
          </div>
        }
      />

      <OnboardingChecklist userId={userId} user={user} profile={profile} />

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-employee-profile">
        <TabsList className="flex-wrap" data-testid="tabs-list-employee">
          <TabsTrigger value="basic" data-testid="tab-basic-info">Basic Info</TabsTrigger>
          <TabsTrigger value="employment" data-testid="tab-employment">Employment</TabsTrigger>
          <TabsTrigger value="pay" data-testid="tab-pay-setup">Pay Setup</TabsTrigger>
          <TabsTrigger value="timeclock" data-testid="tab-time-clock">Time Clock Settings</TabsTrigger>
          <TabsTrigger value="pto" data-testid="tab-pto-leave">PTO/Leave</TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-schedule">Schedule</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
          <TabsTrigger value="onboarding" data-testid="tab-onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="offboarding" data-testid="tab-offboarding">Offboarding</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History/Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card data-testid="card-basic-info">
            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">First Name</Label>
                <p className="font-medium" data-testid="text-profile-first-name">{user?.firstName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Last Name</Label>
                <p className="font-medium" data-testid="text-profile-last-name">{user?.lastName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Email</Label>
                <p className="font-medium" data-testid="text-profile-email">{user?.email || "—"}</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-muted-foreground text-xs">Role</Label>
                  {user?.roleManuallyOverriddenAt ? (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-profile-role-manual">Manual override</Badge>
                  ) : (user as any)?.assignedByRule ? (
                    <Badge
                      variant="secondary"
                      className="text-xs"
                      title={`Set by rule: ${(user as any).assignedByRule.name}`}
                      data-testid="badge-profile-role-auto"
                    >
                      Set by rule
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Select value={user?.role || "employee"} onValueChange={(v) => roleMutation.mutate(v)}>
                    <SelectTrigger data-testid="select-profile-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {user?.roleManuallyOverriddenAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearOverrideMutation.mutate()}
                      disabled={clearOverrideMutation.isPending}
                      data-testid="button-clear-role-override"
                      title="Clear manual override and re-evaluate using rules"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Company</Label>
                <Select
                  value={user?.companyId || ""}
                  onValueChange={(v) => updateMutation.mutate({ companyId: v, departmentId: null, locationId: null })}
                >
                  <SelectTrigger data-testid="select-profile-division">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {(divisions || []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Department</Label>
                <Select
                  value={user?.departmentId || "none"}
                  onValueChange={(v) => updateMutation.mutate({ departmentId: v === "none" ? null : v })}
                  disabled={!user?.companyId}
                >
                  <SelectTrigger data-testid="select-profile-department">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Department</SelectItem>
                    {scopedDepartments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Location</Label>
                <Select
                  value={user?.locationId || "none"}
                  onValueChange={(v) => updateMutation.mutate({ locationId: v === "none" ? null : v })}
                  disabled={!user?.companyId}
                >
                  <SelectTrigger data-testid="select-profile-location">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Location</SelectItem>
                    {scopedLocations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          <div className="mt-4">
            <CertificationsCard employeeId={userId} canEdit={true} highlightCertId={certIdFromUrl} />
          </div>
        </TabsContent>

        <TabsContent value="employment">
          <Card data-testid="card-employment">
            <CardHeader><CardTitle>Employment Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Department</Label>
                <p className="font-medium" data-testid="text-profile-department">{dept?.name || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Location</Label>
                <p className="font-medium" data-testid="text-profile-location">{loc?.name || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Employment Type</Label>
                <p className="font-medium" data-testid="text-profile-employment-type">{profile?.employmentType || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Tax Classification</Label>
                <Select
                  value={profile?.taxClassification || "W-2"}
                  onValueChange={(v) => taxClassMutation.mutate(v)}
                  disabled={profileLoading || !profile}
                >
                  <SelectTrigger data-testid="select-profile-tax-classification">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="W-2">W-2</SelectItem>
                    <SelectItem value="1099">1099</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Hire Date</Label>
                <p className="font-medium" data-testid="text-profile-hire-date">{formatDate(profile?.hireDate) || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Overtime Eligible</Label>
                <p className="font-medium" data-testid="text-profile-overtime">
                  {profile?.overtimeEligible ? "Yes" : "No"}
                </p>
              </div>
              <NextReviewIndicator userId={userId} />
              <CorrectionRequestStat userId={userId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pay">
          <Card data-testid="card-pay-setup">
            <CardHeader><CardTitle>Pay Setup</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Pay Type</Label>
                <p className="font-medium" data-testid="text-profile-pay-type">{profile?.payType || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Hourly Rate</Label>
                <p className="font-medium" data-testid="text-profile-hourly-rate">
                  {profile?.hourlyRate != null ? formatCurrency(profile.hourlyRate) : "—"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Weekly Salary</Label>
                <p className="font-medium" data-testid="text-profile-weekly-salary">
                  {profile?.weeklySalary != null ? formatCurrency(profile.weeklySalary) : "—"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Holiday Pay</Label>
                <p className="font-medium" data-testid="text-profile-holiday-pay">
                  {profile?.holidayPayEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeclock">
          <Card data-testid="card-time-clock-settings">
            <CardHeader><CardTitle>Time Clock Settings</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-timeclock-info">
                Time clock settings are managed through the Rules & Controls center. This employee follows the company default time clock rules.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pto">
          <Card data-testid="card-pto-leave">
            <CardHeader><CardTitle>PTO / Leave</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-pto-info">
                PTO settings for this employee can be managed in the PTO & Leave section.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <ScheduleTab employeeId={userId} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab userId={userId} focusDocType={focusDocType} />
        </TabsContent>

        <TabsContent value="onboarding">
          <OnboardingTab userId={userId} />
        </TabsContent>

        <TabsContent value="offboarding">
          <OffboardingTab userId={userId} />
        </TabsContent>

        <TabsContent value="history">
          <EmployeeAuditHistory userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NextReviewIndicator({ userId }: { userId: string }) {
  const { data: reminders, isLoading } = useQuery<PerformanceReviewReminder[]>({
    queryKey: ["/api/review-reminders", { employeeId: userId, status: "pending" }],
    queryFn: async () => {
      const params = new URLSearchParams({ employeeId: userId, status: "pending" });
      const res = await fetch(`/api/review-reminders?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch review reminders");
      return res.json();
    },
  });

  const { data: cycles } = useQuery<PerformanceReviewCycle[]>({
    queryKey: ["/api/review-cycles"],
    queryFn: async () => {
      const res = await fetch("/api/review-cycles", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const next = (reminders ?? [])
    .slice()
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];

  let text = "—";
  let testidSuffix = "none";
  if (next) {
    const cycleName = cycles?.find((c) => c.id === next.cycleId)?.name;
    const due = new Date(`${next.dueDate}T00:00:00Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    const dayLabel =
      days === 0
        ? "today"
        : days > 0
          ? `in ${days} day${days === 1 ? "" : "s"}`
          : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
    text = `${formatDate(next.dueDate)} (${dayLabel})${cycleName ? ` — ${cycleName}` : ""}`;
    testidSuffix = next.id;
  }

  return (
    <div data-testid="field-next-review">
      <Label className="text-muted-foreground text-xs">Next Review</Label>
      <p
        className="font-medium"
        data-testid={`text-profile-next-review-${testidSuffix}`}
      >
        {isLoading ? "Loading…" : text}
      </p>
    </div>
  );
}

function CorrectionRequestStat({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<CorrectionCountSummary>({
    queryKey: ["/api/attendance/exceptions/correction-counts", userId],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/exceptions/correction-counts/${encodeURIComponent(userId)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch correction counts");
      return res.json();
    },
  });

  const allTotal = data?.all.total ?? 0;
  const high = isHighCorrectionCount(allTotal);

  return (
    <div data-testid="field-correction-counts" className="md:col-span-2">
      <Label className="text-muted-foreground text-xs">Correction Requests</Label>
      {isLoading ? (
        <p className="font-medium" data-testid="text-profile-correction-loading">
          Loading…
        </p>
      ) : (
        <div className="space-y-1">
          <div
            className="text-sm text-muted-foreground inline-flex flex-wrap items-center gap-1"
            data-testid="text-profile-correction-breakdown"
          >
            <span data-testid={`text-correction-count-pay-period-${userId}`}>
              Pay Period: {data?.payPeriod.total ?? 0}
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid={`text-correction-count-week-${userId}`}>
              Week: {data?.week.total ?? 0}
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid={`text-correction-count-month-${userId}`}>
              Month: {data?.month.total ?? 0}
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid={`text-correction-count-year-${userId}`}>
              Year: {data?.year.total ?? 0}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={high ? "font-semibold text-amber-700 dark:text-amber-400" : undefined}
              data-testid={`text-correction-count-all-${userId}`}
            >
              All: {allTotal}
            </span>
          </div>
          {high && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400"
              data-testid="text-profile-correction-frequent"
            >
              Frequent corrections — may need attention (≥{HIGH_CORRECTION_THRESHOLD} all-time).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ResetPasswordButton({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState<"tempPassword" | "emailLink">("tempPassword");

  const { data: emailStatus } = useQuery<{ configured: boolean; provider: string | null; reason?: string }>({
    queryKey: ["/api/auth/email-status"],
    enabled: open,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/users/${userId}/reset-password`, { mode });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.mode === "emailLink") {
        setEmailSentTo(data.sentTo || null);
        toast({ title: "Reset link sent", description: data.sentTo ? `Sent to ${data.sentTo}` : undefined });
      } else {
        setTempPassword(data.temporaryPassword);
        toast({ title: "Password reset successfully" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      toast({ title: "Copied to clipboard" });
    }
  };

  const reset = () => {
    setTempPassword(null);
    setEmailSentTo(null);
    setMode("tempPassword");
  };

  const emailDisabled = emailStatus && !emailStatus.configured;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-reset-password">
          <KeyRound className="h-4 w-4 mr-2" />
          Reset Password
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-reset-password">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            {tempPassword
              ? "A new temporary password has been generated. Share it securely with the employee."
              : emailSentTo
              ? "A password reset link has been emailed to the employee. The link expires in 1 hour."
              : "Choose how you'd like to reset this employee's password."}
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-muted rounded border p-3">
              <code className="flex-1 text-lg font-mono" data-testid="text-reset-temp-password">{tempPassword}</code>
              <Button size="sm" variant="outline" onClick={copyPassword} data-testid="button-copy-reset-password">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : emailSentTo ? (
          <div className="bg-green-50 border border-green-100 rounded p-3 text-sm text-green-800" data-testid="text-reset-email-sent">
            Reset link sent to <span className="font-medium">{emailSentTo}</span>.
          </div>
        ) : (
          <>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "tempPassword" | "emailLink")}
              className="gap-3 py-2"
            >
              <label
                htmlFor="reset-mode-temp"
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
                data-testid="label-mode-temp"
              >
                <RadioGroupItem value="tempPassword" id="reset-mode-temp" data-testid="radio-mode-temp" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Show temporary password</div>
                  <div className="text-xs text-muted-foreground">
                    Generate a one-time password to share with the employee. They'll change it on next login.
                  </div>
                </div>
              </label>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <label
                      htmlFor="reset-mode-email"
                      className={`flex items-start gap-3 rounded-md border p-3 ${
                        emailDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/40"
                      }`}
                      data-testid="label-mode-email"
                    >
                      <RadioGroupItem
                        value="emailLink"
                        id="reset-mode-email"
                        disabled={!!emailDisabled}
                        data-testid="radio-mode-email"
                      />
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Email reset link</div>
                        <div className="text-xs text-muted-foreground">
                          Send a one-time link to the employee's email so they can set their own password.
                        </div>
                      </div>
                    </label>
                  </TooltipTrigger>
                  {emailDisabled && (
                    <TooltipContent>
                      Email service is not configured.{" "}
                      {emailStatus?.reason || "Ask an administrator to set up RESEND_API_KEY, the from-address, and APP_URL."}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </RadioGroup>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                data-testid="button-confirm-reset"
              >
                {resetMutation.isPending
                  ? mode === "emailLink"
                    ? "Sending..."
                    : "Resetting..."
                  : mode === "emailLink"
                  ? "Send reset link"
                  : "Reset Password"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type DocumentRecord = {
  id: string;
  employeeId: string;
  documentType: string;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  uploadedBy: string | null;
  uploadedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ScheduleEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

function ScheduleTab({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(
    DAY_NAMES.map((_, i) => ({ dayOfWeek: i, startTime: "09:00", endTime: "17:00", isActive: false }))
  );

  const { data: existingSchedules, isLoading } = useQuery<EmployeeSchedule[]>({
    queryKey: ["/api/employees", employeeId, "schedules"],
    queryFn: async () => {
      const res = await fetch(`/api/employees/${employeeId}/schedules`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch schedules");
      return res.json();
    },
  });

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (existingSchedules && !hasInitialized.current) {
      hasInitialized.current = true;
      if (existingSchedules.length > 0) {
        setSchedule(prev => prev.map(day => {
          const existing = existingSchedules.find((s) => s.dayOfWeek === day.dayOfWeek);
          return existing ? { ...day, startTime: existing.startTime, endTime: existing.endTime, isActive: existing.isActive } : day;
        }));
      }
    }
  }, [existingSchedules]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/employees/${employeeId}/schedules`, schedule);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", employeeId, "schedules"] });
      toast({ title: "Schedule Saved", description: "Employee work schedule has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save schedule.", variant: "destructive" });
    },
  });

  const toggleDay = (dayOfWeek: number) => {
    setSchedule(prev => prev.map(d => d.dayOfWeek === dayOfWeek ? { ...d, isActive: !d.isActive } : d));
  };

  const updateTime = (dayOfWeek: number, field: "startTime" | "endTime", value: string) => {
    setSchedule(prev => prev.map(d => d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d));
  };

  const templateIdsByDay = useMemo(() => {
    const map = new Map<number, string | null>();
    for (let d = 0; d < 7; d++) map.set(d, null);
    (existingSchedules ?? []).forEach((s) => {
      map.set(s.dayOfWeek, s.scheduleTemplateId ?? null);
    });
    return map;
  }, [existingSchedules]);

  const presentRows = existingSchedules ?? [];
  const rowsWithTemplate = presentRows.filter((s) => !!s.scheduleTemplateId);
  const rowsWithoutTemplate = presentRows.filter((s) => !s.scheduleTemplateId);
  const templateIdSet = new Set(rowsWithTemplate.map((s) => s.scheduleTemplateId as string));
  const sharedTemplateId = templateIdSet.size === 1 ? Array.from(templateIdSet)[0] : null;
  const linkedDayCount = rowsWithTemplate.length;
  const totalDayCount = presentRows.length;
  const isFullyLinked =
    sharedTemplateId !== null &&
    rowsWithoutTemplate.length === 0 &&
    templateIdSet.size === 1 &&
    totalDayCount > 0;
  const isPartiallyLinked = !isFullyLinked && linkedDayCount > 0;

  const { data: linkedTemplate } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/schedule-templates", sharedTemplateId],
    enabled: !!sharedTemplateId,
  });

  const relinkMutation = useMutation({
    mutationFn: async () => {
      if (!sharedTemplateId) throw new Error("No template to relink");
      const res = await apiRequest("POST", `/api/schedule-templates/${sharedTemplateId}/apply`, {
        employeeIds: [employeeId],
        mode: "merge",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", employeeId, "schedules"] });
      hasInitialized.current = false;
      toast({ title: "Schedule re-linked", description: "Template re-applied to this employee." });
    },
    onError: (err: Error) => {
      toast({ title: "Re-link failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const templateName = linkedTemplate?.name;

  return (
    <Card data-testid="card-schedule">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle>Work Schedule</CardTitle>
          {isFullyLinked && (
            <Badge variant="secondary" data-testid="badge-schedule-linked" title={templateName ?? undefined}>
              <Link2 className="h-3 w-3 mr-1" />
              Linked{templateName ? `: ${templateName}` : ""}
            </Badge>
          )}
          {isPartiallyLinked && (
            <Badge variant="outline" data-testid="badge-schedule-mixed" title={templateName ?? undefined}>
              <Link2 className="h-3 w-3 mr-1" />
              Mixed: {linkedDayCount} of 7{templateName ? ` from ${templateName}` : ""}
            </Badge>
          )}
          {isPartiallyLinked && sharedTemplateId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => relinkMutation.mutate()}
              disabled={relinkMutation.isPending}
              data-testid="button-relink-template"
            >
              {relinkMutation.isPending ? "Re-linking..." : "Re-link to template"}
            </Button>
          )}
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-schedule">
          {saveMutation.isPending ? "Saving..." : "Save Schedule"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {schedule.map((day) => {
            const dayTemplateId = templateIdsByDay.get(day.dayOfWeek) ?? null;
            const isCustomized = sharedTemplateId !== null && dayTemplateId === null && day.isActive;
            return (
              <div key={day.dayOfWeek} className="flex items-center gap-4 p-3 rounded-lg border" data-testid={`schedule-day-${day.dayOfWeek}`}>
                <button
                  type="button"
                  onClick={() => toggleDay(day.dayOfWeek)}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${day.isActive ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"}`}
                  data-testid={`toggle-day-${day.dayOfWeek}`}
                >
                  {day.isActive && <CheckCircle2 className="h-4 w-4" />}
                </button>
                <span className="w-28 font-medium" data-testid={`text-day-name-${day.dayOfWeek}`}>{DAY_NAMES[day.dayOfWeek]}</span>
                {day.isActive ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={day.startTime}
                      onChange={(e) => updateTime(day.dayOfWeek, "startTime", e.target.value)}
                      className="w-32"
                      data-testid={`input-start-time-${day.dayOfWeek}`}
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={day.endTime}
                      onChange={(e) => updateTime(day.dayOfWeek, "endTime", e.target.value)}
                      className="w-32"
                      data-testid={`input-end-time-${day.dayOfWeek}`}
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm" data-testid={`text-day-off-${day.dayOfWeek}`}>Day off</span>
                )}
                {isCustomized && (
                  <Badge variant="outline" className="ml-auto text-xs" data-testid={`badge-customized-${day.dayOfWeek}`} title="This day was customized after the template was applied.">
                    <Unlink className="h-3 w-3 mr-1" />
                    Customized
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentsTab({ userId, focusDocType }: { userId: string; focusDocType?: string | null }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [focusedType, setFocusedType] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery<DocumentRecord[]>({
    queryKey: ["/api/users", userId, "documents"],
  });

  useEffect(() => {
    if (!focusDocType) return;
    if (focusedType === focusDocType) return;
    if (!REQUIRED_DOCUMENT_TYPES.some((d) => d.key === focusDocType)) return;
    if (isLoading) return;
    setFocusedType(focusDocType);
    setUploadingType(focusDocType);
    setTimeout(() => fileInputRef.current?.click(), 50);
  }, [focusDocType, focusedType, isLoading]);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", documentType);
      const res = await fetch(`/api/users/${userId}/documents`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Document uploaded" });
      setUploadingType(null);
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setUploadingType(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ docId, status }: { docId: string; status: string }) => {
      await apiRequest("PATCH", `/api/documents/${docId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiRequest("DELETE", `/api/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (docType: string) => {
    setUploadingType(docType);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadingType) {
      uploadMutation.mutate({ file, documentType: uploadingType });
    }
    e.target.value = "";
  };

  const getDocForType = (type: string) => {
    return (docs || []).filter((d) => d.documentType === type);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "reviewed":
        return <Badge className="bg-green-600">Reviewed</Badge>;
      case "uploaded":
        return <Badge variant="outline" className="text-amber-600 border-amber-300">Uploaded</Badge>;
      default:
        return <Badge variant="secondary">Missing</Badge>;
    }
  };

  return (
    <Card data-testid="card-documents">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={handleFileChange}
          data-testid="input-file-upload"
        />

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {REQUIRED_DOCUMENT_TYPES.map((docType) => {
              const typeDocs = getDocForType(docType.key);
              const latestDoc = typeDocs[0];

              return (
                <div
                  key={docType.key}
                  className="border rounded-lg p-4"
                  data-testid={`doc-section-${docType.key}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium" data-testid={`text-doc-type-${docType.key}`}>{docType.label}</p>
                        {latestDoc ? (
                          <p className="text-xs text-muted-foreground" data-testid={`text-doc-file-${docType.key}`}>
                            {latestDoc.fileName}
                            {latestDoc.uploadedAt && ` — ${formatDate(latestDoc.uploadedAt)}`}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not yet uploaded</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {latestDoc ? (
                        <>
                          {getStatusBadge(latestDoc.status)}
                          {latestDoc.status === "uploaded" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => statusMutation.mutate({ docId: latestDoc.id, status: "reviewed" })}
                              data-testid={`button-review-${docType.key}`}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Mark Reviewed
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            data-testid={`button-view-${docType.key}`}
                          >
                            <a href={`/api/documents/${latestDoc.id}/download?view=inline`} target="_blank" rel="noopener noreferrer" title="View">
                              <Eye className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            data-testid={`button-download-${docType.key}`}
                          >
                            <a href={`/api/documents/${latestDoc.id}/download`} target="_blank" rel="noopener noreferrer" title="Download">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(latestDoc.id)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-${docType.key}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Badge variant="secondary">Missing</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleFileSelect(docType.key)}
                        disabled={uploadMutation.isPending && uploadingType === docType.key}
                        data-testid={`button-upload-${docType.key}`}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        {latestDoc ? "Replace" : "Upload"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface OnboardingChecklistDetail {
  id: string;
  status: string;
  hireDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  templateId: string | null;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    category: string;
    ownerRole: string;
    isRequired: boolean;
    documentType: string | null;
    dueDate: string | null;
    status: string;
    notes: string | null;
    skippedReason: string | null;
  }>;
  progress: { progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number };
}

function OnboardingChecklist({
  userId,
  user,
  profile: _profile,
}: {
  userId: string;
  user: User | undefined;
  profile: EmploymentProfile | undefined;
}) {
  const { data: checklist } = useQuery<OnboardingChecklistDetail | null>({
    queryKey: ["/api/onboarding-checklists/by-employee", userId],
  });

  if (!checklist) return null;
  if (checklist.status === "completed") return null;
  const pct = checklist.progress?.progressPct ?? 0;

  return (
    <Card data-testid="card-onboarding-checklist">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Onboarding in progress {user?.firstName ? `for ${user.firstName}` : ""}</CardTitle>
          <Badge variant="secondary" data-testid="badge-onboarding-status">{pct}% complete</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground">{checklist.progress.completedRequired}/{checklist.progress.totalRequired} required tasks complete. See the Onboarding tab for details.</div>
      </CardContent>
    </Card>
  );
}

type OnboardingTaskPatch = Partial<{
  status: "pending" | "in_progress" | "completed" | "skipped";
  notes: string | null;
  skippedReason: string | null;
}>;

type OffboardingTaskPatch = Partial<{
  status: "pending" | "in_progress" | "completed" | "skipped";
  notes: string | null;
  skippedReason: string | null;
}>;

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

function OnboardingTab({ userId }: { userId: string }) {
  const { toast } = useToast();
  const { data: checklist, isLoading } = useQuery<OnboardingChecklistDetail | null>({
    queryKey: ["/api/onboarding-checklists/by-employee", userId],
  });
  const { data: templates } = useQuery<Array<{ id: string; name: string; isDefault: boolean }>>({
    queryKey: ["/api/onboarding-templates"],
  });
  const [templateId, setTemplateId] = useState<string>("");
  const [hireDate, setHireDate] = useState<string>("");
  const [skipReasonByTask, setSkipReasonByTask] = useState<Record<string, string>>({});
  const [notesByTask, setNotesByTask] = useState<Record<string, string>>({});

  const startMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/employees/${userId}/start-onboarding`, {
      templateId: templateId || null,
      hireDate: hireDate || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-checklists/by-employee", userId] });
      toast({ title: "Onboarding started" });
    },
    onError: (e: unknown) => toast({ title: "Failed to start onboarding", description: getErrorMessage(e), variant: "destructive" }),
  });

  const updateTaskMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: OnboardingTaskPatch }) => apiRequest("PATCH", `/api/onboarding-tasks/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/onboarding-checklists/by-employee", userId] }),
    onError: (e: unknown) => toast({ title: "Failed to update task", description: getErrorMessage(e), variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: async () => checklist ? apiRequest("POST", `/api/onboarding-checklists/${checklist.id}/cancel`, { reason: "Cancelled by HR" }) : Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding-checklists/by-employee", userId] });
      toast({ title: "Onboarding cancelled" });
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (!checklist) {
    return (
      <Card data-testid="card-onboarding-tab">
        <CardHeader><CardTitle>Onboarding</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">No onboarding checklist for this employee yet.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            <div>
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger data-testid="select-onboarding-template"><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Hire date</Label>
              <Input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} data-testid="input-onboarding-hire-date" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => startMut.mutate()} disabled={startMut.isPending} data-testid="button-start-onboarding">Start onboarding</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-onboarding-tab">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Onboarding {checklist.status === "completed" ? "(Completed)" : checklist.status === "cancelled" ? "(Cancelled)" : ""}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-testid="text-onboarding-progress">{checklist.progress.progressPct}% — {checklist.progress.completedRequired}/{checklist.progress.totalRequired} required</Badge>
            {checklist.status === "in_progress" && (
              <Button variant="outline" size="sm" onClick={() => cancelMut.mutate()} data-testid="button-cancel-onboarding">Cancel</Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {checklist.tasks.map(task => {
            const done = task.status === "completed" || task.status === "skipped";
            return (
              <div key={task.id} className="border rounded-md p-3 flex items-start gap-3" data-testid={`row-onboarding-task-${task.id}`}>
                <button
                  className="mt-0.5"
                  onClick={() => {
                    if (done) {
                      updateTaskMut.mutate({ id: task.id, patch: { status: "pending" } });
                    } else {
                      updateTaskMut.mutate({ id: task.id, patch: { status: "completed" } });
                    }
                  }}
                  data-testid={`button-toggle-task-${task.id}`}
                >
                  {done ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${done ? "line-through text-muted-foreground" : ""}`}>{task.title}</span>
                    {task.isRequired && <Badge variant="outline" className="text-xs">Required</Badge>}
                    <Badge variant="outline" className="text-xs capitalize">{task.ownerRole}</Badge>
                    {task.status === "skipped" && <Badge variant="secondary" className="text-xs">Skipped</Badge>}
                  </div>
                  {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                  {task.dueDate && <p className="text-xs text-muted-foreground">Due {formatDate(task.dueDate)}</p>}
                  {task.skippedReason && <p className="text-xs italic text-muted-foreground mt-1">Reason: {task.skippedReason}</p>}
                  <div className="mt-2">
                    <Textarea
                      placeholder="Notes (optional)"
                      value={notesByTask[task.id] ?? task.notes ?? ""}
                      onChange={e => setNotesByTask({ ...notesByTask, [task.id]: e.target.value })}
                      onBlur={e => {
                        const next = e.target.value;
                        if ((task.notes ?? "") !== next) {
                          updateTaskMut.mutate({ id: task.id, patch: { notes: next || null } });
                        }
                      }}
                      rows={2}
                      className="text-xs"
                      data-testid={`textarea-notes-${task.id}`}
                    />
                  </div>
                  {!done && task.status !== "skipped" && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        placeholder="Reason to skip"
                        value={skipReasonByTask[task.id] || ""}
                        onChange={e => setSkipReasonByTask({ ...skipReasonByTask, [task.id]: e.target.value })}
                        className="h-8 text-xs"
                        data-testid={`input-skip-reason-${task.id}`}
                      />
                      <Button size="sm" variant="outline" onClick={() => {
                        const reason = skipReasonByTask[task.id]?.trim();
                        if (!reason) { toast({ title: "Provide a reason to skip", variant: "destructive" }); return; }
                        updateTaskMut.mutate({ id: task.id, patch: { status: "skipped", skippedReason: reason } });
                      }} data-testid={`button-skip-task-${task.id}`}>Skip</Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface OffboardingProgress { progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number }
interface OffboardingChecklistDetail {
  id: string;
  status: string;
  terminationDate: string | null;
  accountDeactivatedAt: string | null;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    category: string;
    ownerRole: string;
    isRequired: boolean;
    blocksDeactivation: boolean;
    dueDate: string | null;
    status: string;
    notes: string | null;
    skippedReason: string | null;
  }>;
  gate: { ok: boolean; blocking: { id: string; title: string }[] };
  progress: OffboardingProgress;
}

function OffboardingTab({ userId }: { userId: string }) {
  const { toast } = useToast();
  const { data: user } = useQuery<User>({ queryKey: ["/api/users", userId] });
  const { data: checklist, isLoading } = useQuery<OffboardingChecklistDetail | null>({
    queryKey: ["/api/offboarding-checklists/by-employee", userId],
  });
  const { data: templates } = useQuery<Array<{ id: string; name: string; isDefault: boolean }>>({
    queryKey: ["/api/offboarding-templates"],
  });
  const [templateId, setTemplateId] = useState<string>("");
  const [terminationDate, setTerminationDate] = useState<string>("");
  const [skipReasonByTask, setSkipReasonByTask] = useState<Record<string, string>>({});
  const [notesByTask, setNotesByTask] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const startMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/offboarding/start`, {
      employeeId: userId,
      templateId: templateId || null,
      terminationDate: terminationDate || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offboarding-checklists/by-employee", userId] });
      toast({ title: "Offboarding started" });
    },
    onError: (e: unknown) => toast({ title: "Failed to start offboarding", description: getErrorMessage(e), variant: "destructive" }),
  });

  const updateTaskMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: OffboardingTaskPatch }) => apiRequest("PATCH", `/api/offboarding-tasks/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/offboarding-checklists/by-employee", userId] }),
  });

  const deactivateMut = useMutation({
    mutationFn: async () => checklist ? apiRequest("POST", `/api/offboarding-checklists/${checklist.id}/deactivate`) : Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offboarding-checklists/by-employee", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setConfirmOpen(false);
      toast({ title: "Account deactivated" });
    },
    onError: (e: unknown) => {
      const raw = getErrorMessage(e);
      try {
        const body = JSON.parse(raw.split(":").slice(1).join(":") || "{}");
        const msg = typeof body?.message === "string" ? body.message : raw;
        toast({ title: "Cannot deactivate", description: msg, variant: "destructive" });
      } catch {
        toast({ title: "Cannot deactivate", description: raw, variant: "destructive" });
      }
    },
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (!checklist) {
    const isDeactivated = !!user?.deactivatedAt;
    return (
      <Card data-testid="card-offboarding-tab">
        <CardHeader><CardTitle>Offboarding</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isDeactivated && <p className="text-sm text-destructive">This account is deactivated.</p>}
          <p className="text-sm text-muted-foreground">No offboarding in progress.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            <div>
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger data-testid="select-offboarding-template"><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Termination date</Label>
              <Input type="date" value={terminationDate} onChange={e => setTerminationDate(e.target.value)} data-testid="input-offboarding-termination-date" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => startMut.mutate()} disabled={startMut.isPending} data-testid="button-start-offboarding">Start offboarding</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const gateOk = checklist.gate?.ok ?? false;
  const isCompleted = checklist.status === "completed";

  return (
    <Card data-testid="card-offboarding-tab">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Offboarding {isCompleted ? "(Completed)" : ""}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-testid="text-offboarding-progress">{checklist.progress.progressPct}% — {checklist.progress.completedRequired}/{checklist.progress.totalRequired} required</Badge>
            {checklist.terminationDate && <Badge variant="outline">Termination: {formatDate(checklist.terminationDate)}</Badge>}
            {!isCompleted && (
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={!gateOk} data-testid="button-deactivate-account">
                    Deactivate Account
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Deactivate account</DialogTitle></DialogHeader>
                  <p className="text-sm">This will set the termination date and prevent the user from logging in.</p>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={() => deactivateMut.mutate()} disabled={deactivateMut.isPending} data-testid="button-confirm-deactivate">Deactivate</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!gateOk && !isCompleted && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">Deactivation blocked. Complete or skip these tasks first:</p>
            <ul className="list-disc ml-5 text-destructive mt-1">
              {checklist.gate.blocking.map(b => <li key={b.id}>{b.title}</li>)}
            </ul>
          </div>
        )}
        <div className="space-y-2">
          {checklist.tasks.map(task => {
            const done = task.status === "completed" || task.status === "skipped";
            return (
              <div key={task.id} className="border rounded-md p-3 flex items-start gap-3" data-testid={`row-offboarding-task-${task.id}`}>
                <button
                  className="mt-0.5"
                  onClick={() => updateTaskMut.mutate({ id: task.id, patch: { status: done ? "pending" : "completed" } })}
                  data-testid={`button-toggle-off-task-${task.id}`}
                >
                  {done ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${done ? "line-through text-muted-foreground" : ""}`}>{task.title}</span>
                    {task.isRequired && <Badge variant="outline" className="text-xs">Required</Badge>}
                    {task.blocksDeactivation && <Badge variant="destructive" className="text-xs">Blocks Deact.</Badge>}
                    <Badge variant="outline" className="text-xs capitalize">{task.ownerRole}</Badge>
                    {task.status === "skipped" && <Badge variant="secondary" className="text-xs">Skipped</Badge>}
                  </div>
                  {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                  {task.dueDate && <p className="text-xs text-muted-foreground">Due {formatDate(task.dueDate)}</p>}
                  {task.skippedReason && <p className="text-xs italic text-muted-foreground mt-1">Reason: {task.skippedReason}</p>}
                  <div className="mt-2">
                    <Textarea
                      placeholder="Notes (optional)"
                      value={notesByTask[task.id] ?? task.notes ?? ""}
                      onChange={e => setNotesByTask({ ...notesByTask, [task.id]: e.target.value })}
                      onBlur={e => {
                        const next = e.target.value;
                        if ((task.notes ?? "") !== next) {
                          updateTaskMut.mutate({ id: task.id, patch: { notes: next || null } });
                        }
                      }}
                      rows={2}
                      className="text-xs"
                      data-testid={`textarea-off-notes-${task.id}`}
                    />
                  </div>
                  {!done && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        placeholder="Reason to skip"
                        value={skipReasonByTask[task.id] || ""}
                        onChange={e => setSkipReasonByTask({ ...skipReasonByTask, [task.id]: e.target.value })}
                        className="h-8 text-xs"
                        data-testid={`input-skip-off-${task.id}`}
                      />
                      <Button size="sm" variant="outline" onClick={() => {
                        const reason = skipReasonByTask[task.id]?.trim();
                        if (!reason) { toast({ title: "Provide a reason to skip", variant: "destructive" }); return; }
                        updateTaskMut.mutate({ id: task.id, patch: { status: "skipped", skippedReason: reason } });
                      }} data-testid={`button-skip-off-${task.id}`}>Skip</Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface AuditLogEntry {
  id: string;
  action: string;
  actorUserId: string;
  targetId: string;
  targetType: string;
  createdAt: string;
}

function EmployeeAuditHistory({ userId }: { userId: string }) {
  return (
    <div className="space-y-6" data-testid="employee-history-tab">
      <EmployeeTimesheetCard userId={userId} />
      <EmployeeAuditLogTable userId={userId} />
    </div>
  );
}

const AUDIT_LOG_PAGE_SIZE = 25;

type EmployeeAuditResponse = { logs: AuditLogEntry[]; total: number };

function EmployeeAuditLogTable({ userId }: { userId: string }) {
  const [pageSize, setPageSize] = useState(AUDIT_LOG_PAGE_SIZE);
  const { data, isLoading } = useQuery<EmployeeAuditResponse>({
    queryKey: ["/api/audit-logs/employee", userId, pageSize],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit-logs/employee/${userId}?limit=${pageSize}&offset=0`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load audit logs");
      return res.json();
    },
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const hasMore = logs.length < total;

  return (
    <Card data-testid="card-audit-history">
      <CardHeader><CardTitle>History / Audit</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-muted-foreground text-center py-4" data-testid="text-no-audit">No audit history found.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Action</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Target</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell>{log.targetType}</TableCell>
                    <TableCell>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-3">
              <span data-testid="text-audit-count">
                Showing {logs.length} of {total}
              </span>
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageSize((c) => c + AUDIT_LOG_PAGE_SIZE)}
                  data-testid="button-audit-load-more"
                >
                  Show more
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

