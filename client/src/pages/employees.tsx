import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { cachedFetch } from "@/lib/cachedFetch";
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
import { MultiSelect } from "@/components/ui/multi-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Search, UserPlus, ArrowLeft, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, AlertCircle, KeyRound, Copy, Upload, Download, FileText, CheckCircle2, Circle, Clock, Trash2, Eye, ExternalLink, Building2, MapPin, Link2, Unlink, Plus, X, Lock, LockOpen, RefreshCw, Save } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { formatCurrency, formatHoursMinutes, formatDate } from "@/lib/utils";
import type { User, Department, Location, EmploymentProfile, EmployeeSchedule, Division, PerformanceReviewReminder, PerformanceReviewCycle } from "@shared/schema";
import { userDepartmentIds, userLocationIds, TERMINATION_REASONS } from "@shared/schema";
import { CertificationsCard } from "@/components/certifications-card";
import { ReviewTimeSheetTab } from "@/components/review-timesheet-tab";
import { FingerprintEnrollmentCard } from "@/components/fingerprint-enrollment-card";
import { EmployeeTimesheetCard } from "@/components/employee-timesheet";
import {
  INLINE_ADD_NEW_VALUE,
  PermissionedAddNewItem,
  CreateCompanyDialog,
  CreateDepartmentDialog,
  CreateLocationDialog,
  CreateRoleDialog,
} from "@/components/inline-entity-create";
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

// Compact list of tags (departments / locations) that keeps the table row at a
// normal height no matter how many are assigned: shows the first few, then a
// "+N more" chip (hover it to see the full list). Prevents a person assigned to
// 40 departments from stretching their row down the whole screen.
function CompactTags({ names, max = 3, testIdPrefix }: { names: string[]; max?: number; testIdPrefix?: string }) {
  if (names.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
      {shown.map((name) => (
        <Badge key={name} variant="outline" className="text-xs whitespace-nowrap">{name}</Badge>
      ))}
      {extra > 0 && (
        <Badge variant="secondary" className="text-xs whitespace-nowrap" title={names.join(", ")} data-testid={testIdPrefix ? `${testIdPrefix}-more` : undefined}>
          +{extra} more
        </Badge>
      )}
    </div>
  );
}

// Per-user saved filter defaults for the Employees list. Stored in the browser,
// keyed by user, so each admin keeps their own default view. View convenience
// only (no security) — mirrors the Time Sheet Review / Reports save-as-default.
type EmployeeSortOrder = "name_asc" | "name_desc" | "last_name_asc" | "last_name_desc";
const EMPLOYEE_SORT_ORDERS: EmployeeSortOrder[] = ["name_asc", "name_desc", "last_name_asc", "last_name_desc"];
type EmployeeFilterDefaults = {
  deptIds: string[];
  locIds: string[];
  companyIds: string[];
  taxClasses: string[];
  certStatuses: string[];
  sort: EmployeeSortOrder;
};
function employeesPrefKey(userId: string | undefined) {
  return `ahava.employees.filters.${userId ?? "anon"}`;
}
function loadEmployeeDefaults(userId: string | undefined): EmployeeFilterDefaults | null {
  try {
    const raw = localStorage.getItem(employeesPrefKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<EmployeeFilterDefaults>;
    const arr = (x: unknown) => (Array.isArray(x) ? (x as string[]).filter((s) => typeof s === "string") : []);
    return {
      deptIds: arr(v.deptIds),
      locIds: arr(v.locIds),
      companyIds: arr(v.companyIds),
      taxClasses: arr(v.taxClasses),
      certStatuses: arr(v.certStatuses),
      sort: EMPLOYEE_SORT_ORDERS.includes(v.sort as EmployeeSortOrder) ? (v.sort as EmployeeSortOrder) : "name_asc",
    };
  } catch {
    return null;
  }
}

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
  const initialDepartment = (() => {
    if (typeof window === "undefined") return "all";
    return new URLSearchParams(window.location.search).get("department") || "all";
  })();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");
  // Department & location are multi-select with a staged "draft" (what the user
  // is picking) and an "applied" set (what the query actually uses) — committed
  // by the Apply button, so selecting several doesn't refetch on every click.
  const initialDeptIds = initialDepartment !== "all" ? [initialDepartment] : [];
  const [draftDeptIds, setDraftDeptIds] = useState<string[]>(initialDeptIds);
  const [appliedDeptIds, setAppliedDeptIds] = useState<string[]>(initialDeptIds);
  const [draftLocIds, setDraftLocIds] = useState<string[]>([]);
  const [appliedLocIds, setAppliedLocIds] = useState<string[]>([]);
  // Company / Tax Classification / Cert Status are also staged multi-selects,
  // committed by the same Apply button (OR within each, AND across filters).
  const [draftCompanyIds, setDraftCompanyIds] = useState<string[]>([]);
  const [appliedCompanyIds, setAppliedCompanyIds] = useState<string[]>([]);
  const [draftTaxClasses, setDraftTaxClasses] = useState<string[]>([]);
  const [appliedTaxClasses, setAppliedTaxClasses] = useState<string[]>([]);
  const [draftCertStatuses, setDraftCertStatuses] = useState<string[]>([]);
  const [appliedCertStatuses, setAppliedCertStatuses] = useState<string[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // Selection persists across pages, so we track the full user objects (not
  // just ids) — the bulk-delete dialog needs them and selected rows may live
  // on pages that are no longer loaded.
  const [selected, setSelected] = useState<Map<string, User>>(new Map());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkLocationDialogOpen, setBulkLocationDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPunchesOpen, setImportPunchesOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  // A→Z (default) or Z→A by name. Server-side so it holds across all pages.
  const [sortOrder, setSortOrder] = useState<"name_asc" | "name_desc" | "last_name_asc" | "last_name_desc">("name_asc");
  const sortField = sortOrder.startsWith("last_name_") ? "last_name" : "name";
  const sortDescending = sortOrder.endsWith("_desc");
  const { user: currentUser } = useAuth();
  const { has: hasPermission } = usePermissions();
  const { toast } = useToast();
  const canDelete = hasPermission("users.delete");
  const canImport = currentUser?.role === "admin";

  // Load this user's saved filter defaults once, and auto-apply them on open —
  // unless a deep-link filter came in on the URL (that wins). Convenience only.
  const defaultsLoadedRef = useRef(false);
  useEffect(() => {
    if (defaultsLoadedRef.current || !currentUser?.id) return;
    defaultsLoadedRef.current = true;
    if (initialDepartment !== "all") return; // URL deep-link takes precedence
    const d = loadEmployeeDefaults(currentUser.id);
    if (!d) return;
    setDraftDeptIds(d.deptIds); setAppliedDeptIds(d.deptIds);
    setDraftLocIds(d.locIds); setAppliedLocIds(d.locIds);
    setDraftCompanyIds(d.companyIds); setAppliedCompanyIds(d.companyIds);
    setDraftTaxClasses(d.taxClasses); setAppliedTaxClasses(d.taxClasses);
    setDraftCertStatuses(d.certStatuses); setAppliedCertStatuses(d.certStatuses);
    setSortOrder(d.sort);
  }, [currentUser?.id, initialDepartment]);

  const saveEmployeeDefaults = () => {
    try {
      localStorage.setItem(
        employeesPrefKey(currentUser?.id),
        JSON.stringify({
          deptIds: appliedDeptIds,
          locIds: appliedLocIds,
          companyIds: appliedCompanyIds,
          taxClasses: appliedTaxClasses,
          certStatuses: appliedCertStatuses,
          sort: sortOrder,
        } satisfies EmployeeFilterDefaults),
      );
      toast({ title: "Saved as default", description: "These filters and sort will load automatically next time." });
    } catch {
      toast({ title: "Couldn't save default", variant: "destructive" });
    }
  };

  // Reset to the first page whenever the search or any filter changes so the
  // user isn't stranded on an out-of-range page.
  const appliedDeptKey = appliedDeptIds.join(",");
  const appliedLocKey = appliedLocIds.join(",");
  const appliedCompanyKey = appliedCompanyIds.join(",");
  const appliedTaxKey = appliedTaxClasses.join(",");
  const appliedCertKey = appliedCertStatuses.join(",");
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, appliedDeptKey, appliedLocKey, appliedCompanyKey, appliedTaxKey, appliedCertKey, statusFilter]);

  const usersParams = new URLSearchParams();
  if (debouncedSearch) usersParams.set("search", debouncedSearch);
  if (appliedDeptIds.length) usersParams.set("departmentIds", appliedDeptKey);
  if (appliedLocIds.length) usersParams.set("locationIds", appliedLocKey);
  if (appliedCompanyIds.length) usersParams.set("companyIds", appliedCompanyKey);
  if (appliedTaxClasses.length) usersParams.set("taxClasses", appliedTaxKey);
  if (appliedCertStatuses.length) usersParams.set("certStatuses", appliedCertKey);
  if (statusFilter !== "all") usersParams.set("status", statusFilter);
  usersParams.set("sort", sortOrder);
  usersParams.set("limit", String(pageSize));
  usersParams.set("offset", String(page * pageSize));

  const { data: usersPage, isLoading, isError } = useQuery<{ data: User[]; total: number; limit: number; offset: number }>({
    queryKey: ["/api/users", debouncedSearch, appliedDeptKey, appliedLocKey, appliedCompanyKey, appliedTaxKey, appliedCertKey, statusFilter, sortOrder, page, pageSize],
    queryFn: async () => {
      const res = await cachedFetch(`/api/users?${usersParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch employees");
      return res.json();
    },
  });

  const users = usersPage?.data ?? [];
  const total = usersPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: divisions } = useQuery<Division[]>({
    queryKey: ["/api/companies"],
  });

  // Bulk-fetch all employment profiles so we can show tax classification in
  // the Employees list. Falls back to W-2 for users without a profile
  // (rollout default).
  const { data: allProfiles } = useQuery<EmploymentProfile[]>({
    queryKey: ["/api/employment-profiles"],
  });
  const taxClassByUser = new Map<string, string>(
    (allProfiles || []).map((p) => [p.userId, p.taxClassification || "W-2"]),
  );
  const clockNumberByUser = new Map<string, string>(
    (allProfiles || []).filter((p) => p.employeeNumber).map((p) => [p.userId, p.employeeNumber as string]),
  );

  // When a profile is open, fetch the FULL filtered list (same filters + order
  // as the table, just un-paginated up to the 1000 cap) so Prev/Next can step
  // through every match, not only the current page.
  const navParams = new URLSearchParams();
  if (debouncedSearch) navParams.set("search", debouncedSearch);
  if (appliedDeptIds.length) navParams.set("departmentIds", appliedDeptKey);
  if (appliedLocIds.length) navParams.set("locationIds", appliedLocKey);
  if (appliedCompanyIds.length) navParams.set("companyIds", appliedCompanyKey);
  if (appliedTaxClasses.length) navParams.set("taxClasses", appliedTaxKey);
  if (appliedCertStatuses.length) navParams.set("certStatuses", appliedCertKey);
  if (statusFilter !== "all") navParams.set("status", statusFilter);
  // Match the table's sort so Prev/Next step through the list in the SAME order
  // the user is seeing (e.g. last-name A–Z), not the server's default order.
  navParams.set("sort", sortOrder);
  navParams.set("limit", "1000");
  navParams.set("offset", "0");
  const { data: navPage } = useQuery<{ data: User[] }>({
    queryKey: ["/api/users", "nav", debouncedSearch, appliedDeptKey, appliedLocKey, appliedCompanyKey, appliedTaxKey, appliedCertKey, statusFilter, sortOrder],
    queryFn: async () => {
      const res = await cachedFetch(`/api/users?${navParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch employee navigation list");
      return res.json();
    },
    enabled: !!selectedEmployee,
  });
  const navIds = (navPage?.data ?? []).map((u) => u.id);

  if (selectedEmployee) {
    return (
      <EmployeeProfile
        userId={selectedEmployee}
        onBack={() => setSelectedEmployee(null)}
        navIds={navIds}
        onNavigate={setSelectedEmployee}
      />
    );
  }

  const toggleSelect = (user: User) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user);
      return next;
    });
  };

  const allPageSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allPageSelected) {
        users.forEach((u) => next.delete(u.id));
      } else {
        users.forEach((u) => next.set(u.id, u));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Map());

  return (
    <div className="space-y-6" data-testid="employees-page">
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
        <div className="flex items-center gap-1 w-[180px]" data-testid="sort-employees">
          <Select value={sortField} onValueChange={(v) => { setSortOrder(`${v}_${sortDescending ? "desc" : "asc"}` as typeof sortOrder); setPage(0); }}>
            <SelectTrigger data-testid="select-sort-order" aria-label="Sort employees">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">First name</SelectItem>
              <SelectItem value="last_name">Last name</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            data-testid="button-sort-direction"
            aria-label={`Sort ${sortDescending ? "Z to A; switch to A to Z" : "A to Z; switch to Z to A"}`}
            title={sortDescending ? "Z–A — click for A–Z" : "A–Z — click for Z–A"}
            onClick={() => { setSortOrder(`${sortField}_${sortDescending ? "asc" : "desc"}`); setPage(0); }}
          >
            {sortDescending ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
        <div className="w-[180px]" data-testid="filter-company-multi">
          <MultiSelect
            options={(divisions ?? []).map((d) => ({ label: d.name, value: d.id }))}
            selected={draftCompanyIds}
            onChange={setDraftCompanyIds}
            placeholder="All Companies"
            allLabel="All Companies"
            searchPlaceholder="Search companies..."
          />
        </div>
        <div className="w-[160px]" data-testid="filter-status">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-employee-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[180px]" data-testid="filter-tax-class-multi">
          <MultiSelect
            options={[
              { label: "W-2", value: "W-2" },
              { label: "1099", value: "1099" },
            ]}
            selected={draftTaxClasses}
            onChange={setDraftTaxClasses}
            placeholder="All Tax Classifications"
            allLabel="All Tax Classifications"
          />
        </div>
        <div className="w-[200px]" data-testid="filter-department-multi">
          <MultiSelect
            options={(departments ?? []).map((d) => ({ label: d.name, value: d.id }))}
            selected={draftDeptIds}
            onChange={setDraftDeptIds}
            placeholder="All Departments"
          />
        </div>
        <div className="w-[200px]" data-testid="filter-location-multi">
          <MultiSelect
            options={(locations ?? []).map((l) => ({ label: l.name, value: l.id }))}
            selected={draftLocIds}
            onChange={setDraftLocIds}
            placeholder="All Locations"
          />
        </div>
        <div className="w-[180px]" data-testid="filter-cert-status-multi">
          <MultiSelect
            options={[
              { label: "No Certifications", value: "none" },
              { label: "Valid", value: "valid" },
              { label: "Expiring Soon", value: "expiring_soon" },
              { label: "Expired", value: "expired" },
            ]}
            selected={draftCertStatuses}
            onChange={setDraftCertStatuses}
            placeholder="All Cert Statuses"
            allLabel="All Cert Statuses"
          />
        </div>
        {(() => {
          const draftCount =
            draftDeptIds.length + draftLocIds.length + draftCompanyIds.length +
            draftTaxClasses.length + draftCertStatuses.length;
          const dirty =
            draftDeptIds.join(",") !== appliedDeptKey ||
            draftLocIds.join(",") !== appliedLocKey ||
            draftCompanyIds.join(",") !== appliedCompanyKey ||
            draftTaxClasses.join(",") !== appliedTaxKey ||
            draftCertStatuses.join(",") !== appliedCertKey;
          return (
            <Button
              variant={dirty ? "default" : "outline"}
              onClick={() => {
                setAppliedDeptIds(draftDeptIds);
                setAppliedLocIds(draftLocIds);
                setAppliedCompanyIds(draftCompanyIds);
                setAppliedTaxClasses(draftTaxClasses);
                setAppliedCertStatuses(draftCertStatuses);
              }}
              disabled={!dirty}
              data-testid="button-apply-filters"
            >
              Apply{draftCount > 0 ? ` (${draftCount})` : ""}
            </Button>
          );
        })()}
        <Button
          variant="outline"
          onClick={saveEmployeeDefaults}
          title="Save the current filters and sort as your default view"
          data-testid="button-save-employee-defaults"
        >
          <Save className="h-4 w-4 mr-2" />
          Save as default
        </Button>
        {canImport && (
          <Button
            variant="outline"
            onClick={() => setImportDialogOpen(true)}
            data-testid="button-import-employees"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Employees
          </Button>
        )}
        {canImport && (
          <Button
            variant="outline"
            onClick={() => setImportPunchesOpen(true)}
            data-testid="button-import-punches"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Punches
          </Button>
        )}
        <AddEmployeeDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          departments={departments || []}
          locations={locations || []}
          divisions={divisions || []}
        />
      </div>

      {canImport && (
        <ImportEmployeesDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
        />
      )}

      {canImport && (
        <ImportPunchesDialog
          open={importPunchesOpen}
          onOpenChange={setImportPunchesOpen}
        />
      )}

      {selected.size > 0 && (
        <div
          className="flex items-center justify-between gap-4 rounded-md border bg-muted/40 p-3"
          data-testid="bar-bulk-actions"
        >
          <div className="text-sm" data-testid="text-selected-count">
            <span className="font-medium">{selected.size}</span> selected
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkLocationDialogOpen(true)}
              data-testid="button-bulk-assign-location"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Move Location
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
        users={Array.from(selected.values())}
        currentUserId={currentUser?.id}
        onSuccess={clearSelection}
      />

      <BulkAssignDivisionDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        userIds={Array.from(selected.keys())}
        divisions={divisions || []}
        onSuccess={clearSelection}
      />

      <BulkAssignLocationDialog
        open={bulkLocationDialogOpen}
        onOpenChange={setBulkLocationDialogOpen}
        userIds={Array.from(selected.keys())}
        locations={locations || []}
        defaultFromLocationId={appliedLocIds.length === 1 ? appliedLocIds[0] : ""}
        onSuccess={clearSelection}
      />

      <Card data-testid="card-employees-list">
        <CardContent className="p-0 overflow-x-auto">
          {isError ? (
            <div className="p-6 flex items-center gap-2 text-destructive" data-testid="error-employees">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">Failed to load employees.</p>
            </div>
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-employees">
              No employees found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Clock #</TableHead>
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
                {users.map((emp) => {
                  const empDeptNames = userDepartmentIds(emp)
                    .map((id) => departments?.find((d) => d.id === id)?.name)
                    .filter((n): n is string => Boolean(n));
                  const empLocNames = userLocationIds(emp)
                    .map((id) => locations?.find((l) => l.id === id)?.name)
                    .filter((n): n is string => Boolean(n));
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
                          checked={selected.has(emp.id)}
                          onCheckedChange={() => toggleSelect(emp)}
                          aria-label={`Select ${emp.firstName} ${emp.lastName}`}
                          data-testid={`checkbox-select-${emp.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-employee-name-${emp.id}`}>
                        {emp.firstName} {emp.lastName}
                      </TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`text-employee-clock-number-${emp.id}`}>
                        {clockNumberByUser.get(emp.id) || "—"}
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
                      <TableCell data-testid={`text-employee-dept-${emp.id}`}>
                        <CompactTags names={empDeptNames} testIdPrefix={`dept-${emp.id}`} />
                      </TableCell>
                      <TableCell data-testid={`text-employee-loc-${emp.id}`}>
                        <CompactTags names={empLocNames} testIdPrefix={`loc-${emp.id}`} />
                      </TableCell>
                      <TableCell data-testid={`text-employee-tax-class-${emp.id}`}>
                        <Badge variant="outline">{taxClassByUser.get(emp.id) || "W-2"}</Badge>
                      </TableCell>
                      <TableCell>
                        {emp.deactivatedAt ? (
                          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40" data-testid={`badge-employee-status-${emp.id}`}>
                            Inactive
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-green-600" data-testid={`badge-employee-status-${emp.id}`}>
                            Active
                          </Badge>
                        )}
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

      {!isLoading && !isError && total > 0 && (
        <div className="flex items-center justify-between" data-testid="pagination-employees">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-employees-range">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
            </p>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-[140px]" data-testid="select-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
                <SelectItem value="200">200 per page</SelectItem>
                <SelectItem value="1000">Show all</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground" data-testid="text-page-indicator">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        </div>
      )}
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
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);

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
            <Select
              value={companyId}
              onValueChange={(v) => {
                if (v === INLINE_ADD_NEW_VALUE) {
                  setCreateCompanyOpen(true);
                  return;
                }
                setCompanyId(v);
              }}
            >
              <SelectTrigger data-testid="select-bulk-division">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {divisions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
                <PermissionedAddNewItem
                  permission="company.create"
                  label="Add new company"
                  testId="option-bulk-add-new-company"
                />
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

function BulkAssignLocationDialog({
  open,
  onOpenChange,
  userIds,
  locations,
  defaultFromLocationId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  locations: Location[];
  defaultFromLocationId: string;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [toLocationId, setToLocationId] = useState("");
  // "" = replace the employee's whole location set with the target. A specific
  // id = swap only that location out, keep their other locations.
  const [fromLocationId, setFromLocationId] = useState("");

  useEffect(() => {
    if (open) {
      setToLocationId("");
      setFromLocationId(defaultFromLocationId || "");
    }
  }, [open, defaultFromLocationId]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users/bulk-assign-location", {
        userIds,
        toLocationId,
        fromLocationId: fromLocationId || undefined,
      });
      return res.json();
    },
    onSuccess: (data: { updatedCount: number; skipped: { id: string; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Location updated",
        description: `${data.updatedCount} employee${data.updatedCount === 1 ? "" : "s"} moved${
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
      <DialogContent data-testid="dialog-bulk-assign-location">
        <DialogHeader>
          <DialogTitle>Move to Location</DialogTitle>
          <DialogDescription>
            Move {userIds.length} selected employee{userIds.length === 1 ? "" : "s"} to a location.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Move to</Label>
            <Select value={toLocationId} onValueChange={setToLocationId}>
              <SelectTrigger data-testid="select-bulk-to-location">
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Replace which location?</Label>
            <Select value={fromLocationId || "__all__"} onValueChange={(v) => setFromLocationId(v === "__all__" ? "" : v)}>
              <SelectTrigger data-testid="select-bulk-from-location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All of their locations (replace)</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>Only {l.name} (keep others)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pick the old location (e.g. Nostrand) to swap just that one for the target and keep any other
              locations. Leave as “All of their locations” to replace each employee’s locations with the target.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-bulk-location">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!toLocationId || mutation.isPending || userIds.length === 0}
            data-testid="button-confirm-bulk-location"
          >
            {mutation.isPending ? "Moving..." : `Move ${userIds.length}`}
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

const ADD_EMPLOYEE_FIELD_LABELS: Record<string, string> = {
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  role: "Role",
  companyId: "Company",
  locationId: "Location",
  departmentId: "Department",
  employmentType: "Employment type",
  taxClassification: "Tax classification",
  hireDate: "Hire date",
  payType: "Pay type",
  hourlyRate: "Hourly rate",
  weeklySalary: "Weekly salary",
  dailySalary: "Daily rate",
  onboardingTemplateId: "Onboarding template",
};

function prettyFieldLabel(field: string): string {
  return ADD_EMPLOYEE_FIELD_LABELS[field] ?? field;
}

function formatValidationError(
  payload: unknown,
): { field?: string; message: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    errors?: {
      fieldErrors?: Record<string, string[] | undefined>;
      formErrors?: string[];
    };
    message?: string;
  };
  const fieldErrors = p.errors?.fieldErrors;
  if (fieldErrors) {
    for (const [field, msgs] of Object.entries(fieldErrors)) {
      const msg = msgs?.[0];
      if (msg) {
        const friendly =
          msg.toLowerCase() === "required" || msg.toLowerCase().includes("required")
            ? "Required"
            : msg.charAt(0).toUpperCase() + msg.slice(1);
        return { field, message: friendly };
      }
    }
  }
  const formMsg = p.errors?.formErrors?.[0];
  if (formMsg) return { message: formMsg };
  if (typeof p.message === "string" && p.message && p.message !== "Invalid user data") {
    return { message: p.message };
  }
  return null;
}

interface ImportSummary {
  company: string;
  rowsParsed: number;
  locationsTotal: number;
  created: number;
  updated: number;
  departmentsAssigned?: number;
  rolesAssigned?: number;
  deactivated?: { row: number; employeeNumber: string; name: string }[];
  skipped: { row: number; reason: string }[];
  warnings: { row: number; reason: string }[];
  profilesWithNumber: number;
}

function ImportEmployeesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const importMutation = useMutation({
    mutationFn: async (selectedFile: File): Promise<ImportSummary> => {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch("/api/users/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        let message = "Failed to import employees";
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: (result) => {
      setSummary(result);
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      toast({
        title: "Import complete",
        description: `${result.created} added, ${result.updated} updated.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Import failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = (next: boolean) => {
    if (!next) {
      setFile(null);
      setSummary(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="dialog-import-employees">
        <DialogHeader>
          <DialogTitle>Import Employees</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) spreadsheet. Recognized columns:{" "}
            <span className="font-medium">First Name</span> and{" "}
            <span className="font-medium">Last Name</span> (preferred), or{" "}
            <span className="font-medium">Employee Name</span> in Last First order;{" "}
            <span className="font-medium">Clock #</span>,{" "}
            <span className="font-medium">Actual Location</span>,{" "}
            <span className="font-medium">Paying Company</span>, and{" "}
            <span className="font-medium">Wage Type</span> (W-2 / 1099 /
            Volunteer). Existing staff (matched by Clock #) are updated, new ones
            are added. Blank Paying Company / Wage Type cells are left for you to
            set by hand. (Legacy files using Employee / ID / Location still work.)
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-2 text-sm" data-testid="text-import-summary">
            <p>
              <span className="font-medium">{summary.created}</span> employees
              added, <span className="font-medium">{summary.updated}</span>{" "}
              updated.
            </p>
            <p className="text-muted-foreground">
              Company: {summary.company} · Locations: {summary.locationsTotal} ·
              Rows read: {summary.rowsParsed}
            </p>
            {(summary.departmentsAssigned || summary.rolesAssigned) ? (
              <p className="text-muted-foreground">
                Departments assigned: {summary.departmentsAssigned ?? 0}
                {summary.rolesAssigned ? ` · Roles assigned: ${summary.rolesAssigned}` : ""}
              </p>
            ) : null}
            {summary.deactivated && summary.deactivated.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                <p className="font-medium text-red-800 dark:text-red-300">
                  {summary.deactivated.length} employee
                  {summary.deactivated.length === 1 ? "" : "s"} deactivated (marked "Inactive")
                </p>
                <ul className="mt-1 max-h-40 overflow-auto text-xs text-red-700 dark:text-red-400">
                  {summary.deactivated.slice(0, 25).map((d, i) => (
                    <li key={i}>
                      {d.name} (Clock #{d.employeeNumber})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.skipped.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  {summary.skipped.length} row
                  {summary.skipped.length === 1 ? "" : "s"} skipped
                </p>
                <ul className="mt-1 max-h-40 overflow-auto text-xs text-amber-700 dark:text-amber-400">
                  {summary.skipped.slice(0, 25).map((s, i) => (
                    <li key={i}>
                      Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.warnings?.length > 0 && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                <p className="font-medium text-blue-800 dark:text-blue-300">
                  {summary.warnings.length} note
                  {summary.warnings.length === 1 ? "" : "s"} (employee still imported)
                </p>
                <ul className="mt-1 max-h-40 overflow-auto text-xs text-blue-700 dark:text-blue-400">
                  {summary.warnings.slice(0, 25).map((w, i) => (
                    <li key={i}>
                      Row {w.row}: {w.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-import-file"
            />
            {file && (
              <p className="text-sm text-muted-foreground" data-testid="text-selected-file">
                Selected: {file.name}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {summary ? (
            <Button onClick={() => handleClose(false)} data-testid="button-import-done">
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={importMutation.isPending}
                data-testid="button-import-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={() => file && importMutation.mutate(file)}
                disabled={!file || importMutation.isPending}
                data-testid="button-import-submit"
              >
                {importMutation.isPending ? "Importing…" : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PunchImportSummary {
  rowsParsed: number;
  imported: number;
  openImported?: number;
  duplicates: number;
  employeesTouched: number;
  skipped: { row: number; reason: string }[];
  unmatchedClockNumbers: string[];
}

function ImportPunchesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<PunchImportSummary | null>(null);

  const importMutation = useMutation({
    mutationFn: async (selectedFile: File): Promise<PunchImportSummary> => {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch("/api/attendance/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        let message = "Failed to import punches";
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: (result) => {
      setSummary(result);
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
      toast({
        title: "Punch import complete",
        description: `${result.imported} imported${result.openImported ? `, ${result.openImported} open clock-ins` : ""}, ${result.duplicates} already present.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = (next: boolean) => {
    if (!next) {
      setFile(null);
      setSummary(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-testid="dialog-import-punches">
        <DialogHeader>
          <DialogTitle>Import Punches</DialogTitle>
          <DialogDescription>
            Upload a punch report (.xlsx or .csv) with one row per shift:{" "}
            <span className="font-medium">Clock #</span>,{" "}
            <span className="font-medium">Clock In</span>,{" "}
            <span className="font-medium">Clock Out</span> (local time). Employees are
            matched by Clock #. Safe to re-run — a shift that already exists is skipped,
            so you can re-upload as each machine is switched over.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-2 text-sm" data-testid="text-punch-import-summary">
            <p>
              <span className="font-medium">{summary.imported}</span> punches imported
              for <span className="font-medium">{summary.employeesTouched}</span>{" "}
              employees. <span className="font-medium">{summary.duplicates}</span> already
              present (skipped).
            </p>
            {summary.openImported ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{summary.openImported}</span>{" "}
                open clock-in{summary.openImported === 1 ? "" : "s"} pre-loaded — these pair
                automatically when the person clocks out on the new clock.
              </p>
            ) : null}
            <p className="text-muted-foreground">Rows read: {summary.rowsParsed}</p>
            {summary.unmatchedClockNumbers.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  {summary.unmatchedClockNumbers.length} Clock # not found (add these
                  employees first, then re-import)
                </p>
                <p className="mt-1 max-h-40 overflow-auto text-xs text-amber-700 dark:text-amber-400">
                  {summary.unmatchedClockNumbers.join(", ")}
                </p>
              </div>
            )}
            {summary.skipped.length > 0 && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                <p className="font-medium text-blue-800 dark:text-blue-300">
                  {summary.skipped.length} row{summary.skipped.length === 1 ? "" : "s"} skipped
                </p>
                <ul className="mt-1 max-h-40 overflow-auto text-xs text-blue-700 dark:text-blue-400">
                  {summary.skipped.slice(0, 25).map((s, i) => (
                    <li key={i}>Row {s.row}: {s.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-punch-import-file"
            />
            {file && (
              <p className="text-sm text-muted-foreground" data-testid="text-punch-selected-file">
                Selected: {file.name}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {summary ? (
            <Button onClick={() => handleClose(false)} data-testid="button-punch-import-done">
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={importMutation.isPending}
                data-testid="button-punch-import-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={() => file && importMutation.mutate(file)}
                disabled={!file || importMutation.isPending}
                data-testid="button-punch-import-submit"
              >
                {importMutation.isPending ? "Importing…" : "Import"}
              </Button>
            </>
          )}
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
  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Preview the next free clock number while the dialog is open. The server
  // re-derives the real number at create time; this just shows what they'll get.
  const { data: nextNumberData } = useQuery<{ nextNumber: string }>({
    queryKey: ["/api/users/next-employee-number"],
    enabled: open,
  });

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "employee",
    companyId: "",
    departmentIds: [] as string[],
    locationIds: [] as string[],
    employmentType: "full_time",
    taxClassification: "W-2",
    payrollCompanyId: "",
    payeeName: "",
    payeeAddress: "",
    payeeCity: "",
    payeeState: "",
    payeeZip: "",
    payeeTaxId: "",
    payeeMemo: "",
    clockInRequired: true,
    clockConfirmationOnly: false,
    overnightShiftsAllowed: false,
    useDevicePunchDirection: false,
    requireLunchBreak: false,
    hireDate: new Date().toISOString().split("T")[0],
    payType: "hourly",
    hourlyRate: "",
    weeklySalary: "",
    dailySalary: "",
    onboardingTemplateId: "",
  });

  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createDepartmentOpen, setCreateDepartmentOpen] = useState(false);
  const [createLocationOpen, setCreateLocationOpen] = useState(false);
  const selectedCompanyName = divisions.find((d) => d.id === formData.companyId)?.name;

  // Note #1: operationally there is a single company (Ahava Medical). We no
  // longer ask for it — resolve it automatically and assign every hire to it.
  // Matched by name; falls back to the first company so a rename can't break
  // Add Employee. BCM and any other company are payroll-only payees (see the
  // paying-company picker on the Pay step), never the operational company.
  const operationalCompany = useMemo(
    () =>
      divisions.find((d) => /ahava\s*medical/i.test(d.name)) ?? divisions[0],
    [divisions],
  );
  useEffect(() => {
    if (open && operationalCompany && formData.companyId !== operationalCompany.id) {
      setFormData((f) => ({ ...f, companyId: operationalCompany.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, operationalCompany]);

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

  // Departments are a single shared list across all companies (Task #433):
  // the selected company no longer narrows the list.
  const { data: scopedDepartments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  // Note #1: locations are no longer gated by company (one operational company),
  // so fetch the full list.
  const { data: scopedLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const isVolunteer = formData.taxClassification === "Volunteer";
      // Volunteers have no pay: force the no-rate pay type and never attach a
      // paying company. Everyone else carries the manually-picked paying company.
      const effectivePayType = isVolunteer ? "contractual" : formData.payType;
      const body: Record<string, string | number | boolean | null | string[]> = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email.trim().toLowerCase() || null,
        phone: formData.phone.trim() || null,
        role: formData.role,
        companyId: formData.companyId || null,
        departmentIds: formData.departmentIds,
        locationIds: formData.locationIds,
        departmentId: formData.departmentIds[0] || null,
        locationId: formData.locationIds[0] || null,
        employmentType: formData.employmentType,
        taxClassification: formData.taxClassification,
        payrollCompanyId: isVolunteer ? null : formData.payrollCompanyId || null,
        clockInRequired: formData.clockInRequired,
        clockConfirmationOnly: formData.clockConfirmationOnly,
        overnightShiftsAllowed: formData.overnightShiftsAllowed,
        useDevicePunchDirection: formData.useDevicePunchDirection,
        requireLunchBreak: formData.requireLunchBreak,
        hireDate: formData.hireDate,
        payType: effectivePayType,
      };
      if (formData.taxClassification === "1099") {
        body.payeeName = formData.payeeName.trim();
        body.payeeAddress = formData.payeeAddress.trim() || null;
        body.payeeCity = formData.payeeCity.trim() || null;
        body.payeeState = formData.payeeState.trim() || null;
        body.payeeZip = formData.payeeZip.trim() || null;
        body.payeeTaxId = formData.payeeTaxId.trim() || null;
        body.payeeMemo = formData.payeeMemo.trim() || null;
      }
      if (effectivePayType === "hourly" && formData.hourlyRate) {
        body.hourlyRate = parseFloat(formData.hourlyRate);
      }
      if (effectivePayType === "salary" && formData.weeklySalary) {
        body.weeklySalary = parseFloat(formData.weeklySalary);
      }
      if (effectivePayType === "daily" && formData.dailySalary) {
        body.dailySalary = parseFloat(formData.dailySalary);
      }
      if (formData.onboardingTemplateId) {
        body.onboardingTemplateId = formData.onboardingTemplateId;
      }
      const res = await apiRequest("POST", "/api/users", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users/next-employee-number"] });
      setTempPassword(data.temporaryPassword);
      setAssignedNumber(data.employeeNumber ?? null);
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
      if (isApiError(err) && err.status === 400) {
        const detail = formatValidationError(err.payload);
        if (detail) {
          if (detail.field === "email") {
            setEmailError(detail.message);
            setStep(1);
          }
          toast({
            title: "Please fix the highlighted field",
            description: detail.field
              ? `${prettyFieldLabel(detail.field)}: ${detail.message}`
              : detail.message,
            variant: "destructive",
          });
          return;
        }
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setStep(1);
    setTempPassword(null);
    setAssignedNumber(null);
    setEmailError(null);
    setFormData({
      firstName: "", lastName: "", email: "", phone: "", role: "employee",
      companyId: "", departmentIds: [], locationIds: [], employmentType: "full_time",
      taxClassification: "W-2", payrollCompanyId: "", clockInRequired: true, clockConfirmationOnly: false, overnightShiftsAllowed: false, useDevicePunchDirection: false, requireLunchBreak: false,
      payeeName: "", payeeAddress: "", payeeCity: "", payeeState: "", payeeZip: "", payeeTaxId: "", payeeMemo: "",
      hireDate: new Date().toISOString().split("T")[0], payType: "hourly",
      hourlyRate: "", weeklySalary: "", dailySalary: "", onboardingTemplateId: "",
    });
    onOpenChange(false);
  };

  const copyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      toast({ title: "Copied to clipboard" });
    }
  };

  // Note #1/#4: company is no longer asked for here (auto-assigned). Page 1 is
  // identity + assignment; the money questions live on the Pay step.
  // Email is optional now — only a first and last name are required to proceed.
  const canProceedStep1 = !!(formData.firstName && formData.lastName);
  const canProceedStep2 = !!(formData.hireDate && formData.employmentType);
  const ratePositive = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  };
  const isVolunteer = formData.taxClassification === "Volunteer";
  const payRateValid =
    isVolunteer ||
    formData.payType === "contractual" ||
    (formData.payType === "hourly" && ratePositive(formData.hourlyRate)) ||
    (formData.payType === "daily" && ratePositive(formData.dailySalary)) ||
    (formData.payType === "salary" && ratePositive(formData.weeklySalary));
  // Everyone except volunteers must be assigned a paying company (Ahava / BCM).
  const payrollCompanyValid = isVolunteer || !!formData.payrollCompanyId;
  // A 1099 worker must have a "Pay to the order of" name (the rest is optional).
  const payeeValid = formData.taxClassification !== "1099" || !!formData.payeeName.trim();
  const canProceedStep3 =
    canProceedStep1 && canProceedStep2 && formData.taxClassification && payRateValid && payrollCompanyValid && payeeValid;

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
            {nextNumberData?.nextNumber && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 flex items-center justify-between" data-testid="info-next-clock-number">
                <span className="text-sm text-muted-foreground">Clock # (auto-assigned)</span>
                <span className="font-mono text-base font-semibold" data-testid="text-next-clock-number">{nextNumberData.nextNumber}</span>
              </div>
            )}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
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
                <Label>Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  data-testid="input-add-phone"
                />
              </div>
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
              <div className="flex items-center justify-between">
                <Label>Departments</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-testid="button-add-new-department"
                  onClick={() => setCreateDepartmentOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add new
                </Button>
              </div>
              <MultiSelect
                options={scopedDepartments.map((d) => ({ label: d.name, value: d.id }))}
                selected={formData.departmentIds}
                onChange={(values) => setFormData({ ...formData, departmentIds: values })}
                placeholder="Select departments"
                allLabel="No Department"
                emptyMessage="No departments available."
                data-testid="select-add-department"
              />
              {formData.departmentIds.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {formData.departmentIds.map((id) => {
                    const d = scopedDepartments.find((x) => x.id === id);
                    return (
                      <Badge key={id} variant="secondary" data-testid={`badge-add-department-${id}`}>
                        {d?.name || id}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Locations</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-testid="button-add-new-location"
                  onClick={() => setCreateLocationOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add new
                </Button>
              </div>
              <MultiSelect
                options={scopedLocations.map((l) => ({ label: l.name, value: l.id }))}
                selected={formData.locationIds}
                onChange={(values) => setFormData({ ...formData, locationIds: values })}
                placeholder="Select locations"
                allLabel="No Location"
                emptyMessage="No locations available."
                data-testid="select-add-location"
              />
              {formData.locationIds.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {formData.locationIds.map((id) => {
                    const l = scopedLocations.find((x) => x.id === id);
                    return (
                      <Badge key={id} variant="secondary" data-testid={`badge-add-location-${id}`}>
                        {l?.name || id}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
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
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label>Required to clock in</Label>
                <p className="text-xs text-muted-foreground">
                  Turn off for people paid regardless of hours (e.g. a salaried manager) or volunteers. When off, missing-clock-out and no-show alerts are suppressed for this person.
                </p>
              </div>
              <Switch
                checked={formData.clockInRequired}
                onCheckedChange={(v) => setFormData({ ...formData, clockInRequired: v })}
                data-testid="switch-add-clock-in-required"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label>Clock is attendance confirmation only</Label>
                <p className="text-xs text-muted-foreground">
                  For fixed-salary staff (daily/weekly) whose clock just confirms they worked the day. One clock per day marks the day present; hours are not counted and a single punch is never flagged as a missing punch.
                </p>
              </div>
              <Switch
                checked={formData.clockConfirmationOnly}
                onCheckedChange={(v) => setFormData({ ...formData, clockConfirmationOnly: v })}
                data-testid="switch-add-clock-confirmation-only"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label>Works overnight shifts</Label>
                <p className="text-xs text-muted-foreground">
                  Only for genuine overnight workers (clock in one evening, out the next morning). When off (the default), a shift that crosses midnight is treated as a forgotten punch-out and flagged as a missing punch.
                </p>
              </div>
              <Switch
                checked={formData.overnightShiftsAllowed}
                onCheckedChange={(v) => setFormData({ ...formData, overnightShiftsAllowed: v })}
                data-testid="switch-add-overnight-allowed"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label>Use clock's In/Out button</Label>
                <p className="text-xs text-muted-foreground">
                  Record this employee's fingerprint punches by the In/Out key they press on the clock, instead of auto-guessing from the shift state. Turn on only for people who reliably press In/Out — it prevents a single forgotten punch from flipping all their later punches.
                </p>
              </div>
              <Switch
                checked={formData.useDevicePunchDirection}
                onCheckedChange={(v) => setFormData({ ...formData, useDevicePunchDirection: v })}
                data-testid="switch-add-device-direction"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label>Require lunch clock-out</Label>
                <p className="text-xs text-muted-foreground">
                  This employee must clock out and back in for lunch. A lunch taken within the hour is paid (up to 45 min); working straight through or forgetting to clock back in docks a flat 45-minute lunch.
                </p>
              </div>
              <Switch
                checked={formData.requireLunchBreak}
                onCheckedChange={(v) => setFormData({ ...formData, requireLunchBreak: v })}
                data-testid="switch-add-require-lunch"
              />
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
              <Label>Tax Form</Label>
              <Select
                value={formData.taxClassification}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    taxClassification: v,
                    payrollCompanyId: v === "Volunteer" ? "" : formData.payrollCompanyId,
                  })
                }
              >
                <SelectTrigger data-testid="select-add-tax-classification">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="W-2">W-2</SelectItem>
                  <SelectItem value="1099">1099</SelectItem>
                  <SelectItem value="Volunteer">Volunteer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isVolunteer && (
              <div className="space-y-2">
                <Label>Paying Company *</Label>
                <Select
                  value={formData.payrollCompanyId}
                  onValueChange={(v) => setFormData({ ...formData, payrollCompanyId: v })}
                >
                  <SelectTrigger data-testid="select-add-payroll-company">
                    <SelectValue placeholder="Who pays this person" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which entity issues this person's payment.
                </p>
              </div>
            )}
            {formData.taxClassification === "1099" && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="space-y-1">
                  <Label>Pay to the order of *</Label>
                  <Input
                    value={formData.payeeName}
                    onChange={(e) => setFormData({ ...formData, payeeName: e.target.value })}
                    placeholder="Company / LLC name"
                    data-testid="input-add-payee-name"
                  />
                </div>
                <Input
                  value={formData.payeeAddress}
                  onChange={(e) => setFormData({ ...formData, payeeAddress: e.target.value })}
                  placeholder="Address (optional)"
                  data-testid="input-add-payee-address"
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    value={formData.payeeCity}
                    onChange={(e) => setFormData({ ...formData, payeeCity: e.target.value })}
                    placeholder="City"
                    data-testid="input-add-payee-city"
                  />
                  <Input
                    value={formData.payeeState}
                    onChange={(e) => setFormData({ ...formData, payeeState: e.target.value })}
                    placeholder="State"
                    data-testid="input-add-payee-state"
                  />
                  <Input
                    value={formData.payeeZip}
                    onChange={(e) => setFormData({ ...formData, payeeZip: e.target.value })}
                    placeholder="ZIP"
                    data-testid="input-add-payee-zip"
                  />
                </div>
                <Input
                  value={formData.payeeTaxId}
                  onChange={(e) => setFormData({ ...formData, payeeTaxId: e.target.value })}
                  placeholder="Tax ID (optional)"
                  data-testid="input-add-payee-tax-id"
                />
                <Input
                  value={formData.payeeMemo}
                  onChange={(e) => setFormData({ ...formData, payeeMemo: e.target.value })}
                  placeholder="Memo (optional) — shown on the payroll report"
                  data-testid="input-add-payee-memo"
                />
                <p className="text-xs text-muted-foreground">
                  Only the name is required — address, Tax ID and memo can be added later.
                </p>
              </div>
            )}
            {isVolunteer ? (
              <p className="text-sm text-muted-foreground" data-testid="text-add-volunteer-note">
                Volunteers are not paid — only their attendance is tracked. No pay rate or paying company is needed.
              </p>
            ) : (
            <>
            <div className="space-y-2">
              <Label>Pay Type</Label>
              <Select
                value={formData.payType}
                onValueChange={(v) =>
                  setFormData({
                    ...formData,
                    payType: v,
                    hourlyRate: v === "hourly" ? formData.hourlyRate : "",
                    weeklySalary: v === "salary" ? formData.weeklySalary : "",
                    dailySalary: v === "daily" ? formData.dailySalary : "",
                  })
                }
              >
                <SelectTrigger data-testid="select-add-pay-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="salary">Salary</SelectItem>
                  <SelectItem value="contractual">Contractual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.payType === "contractual" && (
              <p className="text-sm text-muted-foreground" data-testid="text-add-contractual-note">
                Contractual workers have no pay rate. Their hours are still tracked and counted.
              </p>
            )}
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
            {formData.payType === "daily" && (
              <div className="space-y-2">
                <Label>Daily Rate ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.dailySalary}
                  onChange={(e) => setFormData({ ...formData, dailySalary: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-add-daily-rate"
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
            {formData.payType === "salary" && (
              <p className="text-xs text-muted-foreground" data-testid="text-add-salary-note">
                Fixed salary — pay is not affected by hours worked. Hours are still shown on reports for reference.
              </p>
            )}
            </>
            )}
          </div>
        )}

        {step === 4 && tempPassword && (
          <div className="space-y-4">
            {assignedNumber && (
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4" data-testid="box-assigned-clock-number">
                <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
                  <strong>Clock #{assignedNumber}</strong> — enroll this employee's fingerprint on the time clock
                  under <strong>User ID {assignedNumber}</strong>, then Push fingerprints so their punches link automatically.
                </p>
                <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded border p-3">
                  <code className="flex-1 text-lg font-mono" data-testid="text-assigned-clock-number">{assignedNumber}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { navigator.clipboard.writeText(assignedNumber); toast({ title: "Clock # copied" }); }}
                    data-testid="button-copy-clock-number"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
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
              disabled={createMutation.isPending || !canProceedStep3}
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
      <CreateCompanyDialog
        open={createCompanyOpen}
        onOpenChange={setCreateCompanyOpen}
        onCreated={(company) => {
          setFormData((prev) => ({
            ...prev,
            companyId: company.id,
            departmentIds: [],
            locationIds: [],
          }));
        }}
      />
      <CreateDepartmentDialog
        open={createDepartmentOpen}
        onOpenChange={setCreateDepartmentOpen}
        companyId={formData.companyId}
        companyName={selectedCompanyName}
        onCreated={(dept) => {
          setFormData((prev) => ({
            ...prev,
            departmentIds: prev.departmentIds.includes(dept.id)
              ? prev.departmentIds
              : [...prev.departmentIds, dept.id],
          }));
        }}
      />
      <CreateLocationDialog
        open={createLocationOpen}
        onOpenChange={setCreateLocationOpen}
        companyId={formData.companyId}
        companyName={selectedCompanyName}
        onCreated={(location) => {
          setFormData((prev) => ({
            ...prev,
            locationIds: prev.locationIds.includes(location.id)
              ? prev.locationIds
              : [...prev.locationIds, location.id],
          }));
        }}
      />
    </Dialog>
  );
}

function EmployeeProfile({
  userId,
  onBack,
  navIds = [],
  onNavigate,
}: {
  userId: string;
  onBack: () => void;
  navIds?: string[];
  onNavigate?: (id: string) => void;
}) {
  // Position of this employee in the (filtered, same-order) list the admin was
  // viewing, so they can step through one-by-one without going back to the list.
  const navIndex = navIds.indexOf(userId);
  const prevId = navIndex > 0 ? navIds[navIndex - 1] : null;
  const nextId = navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null;
  const canNavigate = !!onNavigate && navIndex >= 0 && navIds.length > 1;
  const { toast } = useToast();
  const { has: hasPermission } = usePermissions();
  const initialUrlParams = (() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  })();
  const initialTab = (() => {
    const t = initialUrlParams.get("tab");
    const section = initialUrlParams.get("section");
    if (section === "certifications") return "basic";
    if (t === "certifications") return "basic";
    if (t && ["basic", "timesheet", "employment", "pay", "timeclock", "pto", "schedule", "documents", "policies", "history"].includes(t)) return t;
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

  // Departments are a single shared list across all companies (Task #433).
  const { data: scopedDepartments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
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

  const clearOverrideMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/users/${userId}/clear-role-override`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
      toast({ title: "Override cleared", description: "Role re-evaluated by automation rules" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Account access level (admin / manager / employee). This is the flat
  // users.role that gates the admin sidebar (Employees, Payroll, Reports — where
  // pay lives), separate from the assigned RBAC roles below. Lets you downgrade
  // an employee who was created as Admin without touching their roles.
  const setAccessLevelMutation = useMutation({
    mutationFn: async (role: string) => {
      await apiRequest("PATCH", `/api/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
      toast({ title: "Access level updated", description: "Have them log out and back in to apply it." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Per-user pay visibility: let this one person see pay rates (or not),
  // independent of their role. Only shown to permission managers.
  const canManagePermissions = hasPermission("roles.manage");
  const { data: payVisibility } = useQuery<{ allowed: boolean }>({
    queryKey: ["/api/users", userId, "pay-visibility"],
    queryFn: () => apiRequest("GET", `/api/users/${userId}/pay-visibility`).then((r) => r.json()),
    enabled: canManagePermissions,
  });
  const setPayVisibilityMutation = useMutation({
    mutationFn: async (allowed: boolean) => {
      await apiRequest("PUT", `/api/users/${userId}/pay-visibility`, { allowed });
    },
    onSuccess: (_d, allowed) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "pay-visibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
      toast({ title: allowed ? "Pay visibility granted" : "Pay visibility removed", description: "They may need to refresh to see the change." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: assignableRoles = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/users", userId, "assignable-roles"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/assignable-roles`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch assignable roles");
      return res.json();
    },
  });

  const { data: assignedRoles = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/users", userId, "roles"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/roles`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user roles");
      return res.json();
    },
  });

  const setRolesMutation = useMutation({
    mutationFn: async (roleIds: string[]) => {
      await apiRequest("PUT", `/api/users/${userId}/roles`, { roleIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
      toast({ title: "Roles updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // F3: staged edits for the assignment block (Departments / Locations / Roles).
  // Selecting just updates this local draft — nothing hits the server until the
  // "Save assignments" button. (Company change stays immediate: it's rare and
  // rescopes dept/loc.)
  const [assignDraft, setAssignDraft] = useState<{
    departmentIds: string[];
    locationIds: string[];
    roleIds: string[];
  }>({ departmentIds: [], locationIds: [], roleIds: [] });
  const [assignEditing, setAssignEditing] = useState(false);
  useEffect(() => {
    if (user && !assignEditing) {
      setAssignDraft({
        departmentIds: userDepartmentIds(user),
        locationIds: userLocationIds(user),
        roleIds: assignedRoles.map((r) => r.id),
      });
    }
  }, [user, assignedRoles, assignEditing]);
  const sortedJson = (a: string[]) => JSON.stringify([...a].sort());
  const assignDirty = useMemo(() => {
    if (!user) return false;
    return (
      sortedJson(userDepartmentIds(user)) !== sortedJson(assignDraft.departmentIds) ||
      sortedJson(userLocationIds(user)) !== sortedJson(assignDraft.locationIds) ||
      sortedJson(assignedRoles.map((r) => r.id)) !== sortedJson(assignDraft.roleIds)
    );
  }, [user, assignedRoles, assignDraft]);
  const patchAssignDraft = (p: Partial<typeof assignDraft>) => {
    setAssignEditing(true);
    setAssignDraft((d) => ({ ...d, ...p }));
  };
  const resetAssignDraft = () => {
    if (!user) return;
    setAssignDraft({
      departmentIds: userDepartmentIds(user),
      locationIds: userLocationIds(user),
      roleIds: assignedRoles.map((r) => r.id),
    });
    setAssignEditing(false);
  };
  const saveAssignmentsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/users/${userId}`, {
        departmentIds: assignDraft.departmentIds,
        locationIds: assignDraft.locationIds,
      });
      if (sortedJson(assignedRoles.map((r) => r.id)) !== sortedJson(assignDraft.roleIds)) {
        await apiRequest("PUT", `/api/users/${userId}/roles`, { roleIds: assignDraft.roleIds });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/permissions"] });
      setAssignEditing(false);
      toast({ title: "Assignments saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: {
      companyId?: string | null;
      departmentId?: string | null;
      locationId?: string | null;
      departmentIds?: string[];
      locationIds?: string[];
      firstName?: string;
      lastName?: string;
      email?: string;
    }) => {
      await apiRequest("PATCH", `/api/users/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [editBasic, setEditBasic] = useState(false);
  const [basicForm, setBasicForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [basicEmailError, setBasicEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !editBasic) {
      setBasicForm({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: (user as { phone?: string | null }).phone || "",
      });
    }
  }, [user, editBasic]);

  const basicInfoMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; phone: string }) => {
      await apiRequest("PATCH", `/api/users/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setEditBasic(false);
      setBasicEmailError(null);
      toast({ title: "Basic info updated" });
    },
    onError: (err: Error) => {
      if (isApiError(err) && err.status === 409 && err.code === "EMAIL_ALREADY_EXISTS") {
        setBasicEmailError("An employee with this email already exists.");
        toast({ title: "Duplicate email", description: "Another user already has this email.", variant: "destructive" });
        return;
      }
      if (isApiError(err) && err.status === 400) {
        const detail = formatValidationError(err.payload);
        if (detail?.field === "email") {
          setBasicEmailError(detail.message);
        }
        toast({
          title: "Please fix the highlighted field",
          description: detail?.field
            ? `${prettyFieldLabel(detail.field)}: ${detail.message}`
            : detail?.message || err.message,
          variant: "destructive",
        });
        return;
      }
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

  const clockInRequiredMutation = useMutation({
    mutationFn: async (clockInRequired: boolean) => {
      await apiRequest("PATCH", `/api/employment-profiles/${userId}`, { clockInRequired });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      toast({ title: "Clock-in requirement updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [editEmployment, setEditEmployment] = useState(false);
  const [employmentForm, setEmploymentForm] = useState({
    employmentType: "full_time",
    hireDate: "",
    terminationDate: "",
    overtimeEligible: false,
    taxClassification: "W-2",
    clockInRequired: true,
    clockConfirmationOnly: false,
    overnightShiftsAllowed: false,
    useDevicePunchDirection: false,
    requireLunchBreak: false,
  });

  useEffect(() => {
    if (profile && !editEmployment) {
      setEmploymentForm({
        employmentType: profile.employmentType || "full_time",
        hireDate: profile.hireDate ? String(profile.hireDate).slice(0, 10) : "",
        terminationDate: profile.terminationDate ? String(profile.terminationDate).slice(0, 10) : "",
        overtimeEligible: !!profile.overtimeEligible,
        taxClassification: profile.taxClassification || "W-2",
        clockInRequired: profile.clockInRequired ?? true,
        clockConfirmationOnly: profile.clockConfirmationOnly ?? false,
        overnightShiftsAllowed: profile.overnightShiftsAllowed ?? false,
        useDevicePunchDirection: profile.useDevicePunchDirection ?? false,
        requireLunchBreak: profile.requireLunchBreak ?? false,
      });
    }
  }, [profile, editEmployment]);

  const employmentMutation = useMutation({
    mutationFn: async (data: {
      employmentType: string;
      hireDate: string | null;
      terminationDate: string | null;
      overtimeEligible: boolean;
      taxClassification: string;
      clockInRequired: boolean;
      clockConfirmationOnly: boolean;
      overnightShiftsAllowed: boolean;
      useDevicePunchDirection: boolean;
      requireLunchBreak: boolean;
    }) => {
      await apiRequest("PATCH", `/api/employment-profiles/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditEmployment(false);
      toast({ title: "Employment details updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { user: currentAuthUser } = useAuth();
  const canEditPay = hasPermission("users.edit");
  // Pay rates + rate type are hidden unless the viewer has the "View Pay Rates"
  // permission (super admins always do). The whole Pay Setup tab is hidden
  // without it, and the server also strips the amounts from the profile data.
  const canViewPay = hasPermission("compensation.view");
  const canViewPolicies = hasPermission("policies.view");
  const [editPayOpen, setEditPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    payType: "hourly",
    hourlyRate: "",
    dailySalary: "",
    weeklySalary: "",
    holidayPayEnabled: false,
    overtimeEligible: false,
    payrollCompanyId: "none",
    payeeName: "",
    payeeAddress: "",
    payeeCity: "",
    payeeState: "",
    payeeZip: "",
    payeeTaxId: "",
    payeeMemo: "",
  });

  const openPayDialog = () => {
    setPayForm({
      payType: profile?.payType || "hourly",
      hourlyRate: profile?.hourlyRate != null ? String(profile.hourlyRate) : "",
      dailySalary: profile?.dailySalary != null ? String(profile.dailySalary) : "",
      weeklySalary: profile?.weeklySalary != null ? String(profile.weeklySalary) : "",
      holidayPayEnabled: !!profile?.holidayPayEnabled,
      overtimeEligible: !!profile?.overtimeEligible,
      payrollCompanyId: profile?.payrollCompanyId || "none",
      payeeName: profile?.payeeName || "",
      payeeAddress: profile?.payeeAddress || "",
      payeeCity: profile?.payeeCity || "",
      payeeState: profile?.payeeState || "",
      payeeZip: profile?.payeeZip || "",
      payeeTaxId: profile?.payeeTaxId || "",
      payeeMemo: profile?.payeeMemo || "",
    });
    setEditPayOpen(true);
  };

  const payRatePositive = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  };
  const payRateValid =
    payForm.payType === "contractual" ||
    (payForm.payType === "hourly" && payRatePositive(payForm.hourlyRate)) ||
    (payForm.payType === "daily" && payRatePositive(payForm.dailySalary)) ||
    (payForm.payType === "salary" && payRatePositive(payForm.weeklySalary));

  const payMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        payType: payForm.payType,
        holidayPayEnabled: payForm.holidayPayEnabled,
        overtimeEligible: payForm.overtimeEligible,
        hourlyRate: payForm.payType === "hourly" ? parseFloat(payForm.hourlyRate) : null,
        dailySalary: payForm.payType === "daily" ? parseFloat(payForm.dailySalary) : null,
        weeklySalary: payForm.payType === "salary" ? parseFloat(payForm.weeklySalary) : null,
        payrollCompanyId: payForm.payrollCompanyId === "none" ? null : payForm.payrollCompanyId,
      };
      // 1099 payee ("pay to the order of") + memo — only for 1099 workers.
      if (profile?.taxClassification === "1099") {
        body.payeeName = payForm.payeeName.trim() || null;
        body.payeeAddress = payForm.payeeAddress.trim() || null;
        body.payeeCity = payForm.payeeCity.trim() || null;
        body.payeeState = payForm.payeeState.trim() || null;
        body.payeeZip = payForm.payeeZip.trim() || null;
        body.payeeTaxId = payForm.payeeTaxId.trim() || null;
        body.payeeMemo = payForm.payeeMemo.trim() || null;
      }
      await apiRequest("PATCH", `/api/employment-profiles/${userId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditPayOpen(false);
      toast({ title: "Pay setup updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const dept = departments?.find((d) => d.id === user?.departmentId);
  const loc = locations?.find((l) => l.id === user?.locationId);
  const div = divisions?.find((d) => d.id === user?.companyId);

  const [profileCreateCompanyOpen, setProfileCreateCompanyOpen] = useState(false);
  const [profileCreateDepartmentOpen, setProfileCreateDepartmentOpen] = useState(false);
  const [profileCreateLocationOpen, setProfileCreateLocationOpen] = useState(false);
  const [profileCreateRoleOpen, setProfileCreateRoleOpen] = useState(false);

  return (
    <div className="max-w-6xl space-y-6" data-testid="employee-profile-page">
      <PageHeader
        title={`${user?.firstName || ""} ${user?.lastName || ""}`}
        subtitle={user?.email || ""}
        actions={
          <div className="flex items-center gap-2">
            {canNavigate && (
              <div className="flex items-center gap-1 mr-1" data-testid="employee-nav">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => prevId && onNavigate!(prevId)}
                  disabled={!prevId}
                  data-testid="button-prev-employee"
                  aria-label="Previous employee"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums px-1" data-testid="text-employee-position">
                  {navIndex + 1} / {navIds.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => nextId && onNavigate!(nextId)}
                  disabled={!nextId}
                  data-testid="button-next-employee"
                  aria-label="Next employee"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => queryClient.invalidateQueries()}
              data-testid="button-refresh-profile"
              aria-label="Refresh"
              title="Refresh — reload this employee's data to see saved changes"
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Badge variant="outline" data-testid="badge-employee-profile-role">
              {user?.role}
            </Badge>
            {user?.editLocked && (
              <Badge variant="destructive" data-testid="badge-employee-locked">Locked</Badge>
            )}
            <LockAccountButton userId={userId} locked={!!user?.editLocked} />
            <ResetPasswordButton userId={userId} />
          </div>
        }
      />

      <OnboardingChecklist userId={userId} user={user} profile={profile} />

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-employee-profile">
        <TabsList className="flex-wrap" data-testid="tabs-list-employee">
          <TabsTrigger value="basic" data-testid="tab-basic-info">Basic Info</TabsTrigger>
          <TabsTrigger value="timesheet" data-testid="tab-review-timesheet">Review Time Sheet</TabsTrigger>
          <TabsTrigger value="employment" data-testid="tab-employment">Employment</TabsTrigger>
          {canViewPay && <TabsTrigger value="pay" data-testid="tab-pay-setup">Pay Setup</TabsTrigger>}
          <TabsTrigger value="timeclock" data-testid="tab-time-clock">Time Clock Settings</TabsTrigger>
          <TabsTrigger value="pto" data-testid="tab-pto-leave">PTO/Leave</TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-schedule">Schedule</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
          {canViewPolicies && (
            <TabsTrigger value="policies" data-testid="tab-policies">Policies</TabsTrigger>
          )}
          <TabsTrigger value="onboarding" data-testid="tab-onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="offboarding" data-testid="tab-offboarding">Offboarding</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History/Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="timesheet">
          <ReviewTimeSheetTab employeeId={userId} />
        </TabsContent>

        <TabsContent value="basic">
          <Card data-testid="card-basic-info">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Basic Information</CardTitle>
              {editBasic ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditBasic(false);
                      setBasicEmailError(null);
                      setBasicForm({
                        firstName: user?.firstName || "",
                        lastName: user?.lastName || "",
                        email: user?.email || "",
                        phone: (user as { phone?: string | null })?.phone || "",
                      });
                    }}
                    data-testid="button-cancel-basic-info"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setBasicEmailError(null);
                      basicInfoMutation.mutate({
                        firstName: basicForm.firstName.trim(),
                        lastName: basicForm.lastName.trim(),
                        email: basicForm.email.trim().toLowerCase(),
                        phone: basicForm.phone.trim(),
                      });
                    }}
                    disabled={basicInfoMutation.isPending}
                    data-testid="button-save-basic-info"
                  >
                    {basicInfoMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditBasic(true)}
                  data-testid="button-edit-basic-info"
                >
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">First Name</Label>
                {editBasic ? (
                  <Input
                    value={basicForm.firstName}
                    onChange={(e) => setBasicForm((f) => ({ ...f, firstName: e.target.value }))}
                    data-testid="input-profile-first-name"
                  />
                ) : (
                  <p className="font-medium" data-testid="text-profile-first-name">{user?.firstName || "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Last Name</Label>
                {editBasic ? (
                  <Input
                    value={basicForm.lastName}
                    onChange={(e) => setBasicForm((f) => ({ ...f, lastName: e.target.value }))}
                    data-testid="input-profile-last-name"
                  />
                ) : (
                  <p className="font-medium" data-testid="text-profile-last-name">{user?.lastName || "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Email</Label>
                {editBasic ? (
                  <>
                    <Input
                      type="email"
                      value={basicForm.email}
                      onChange={(e) => {
                        setBasicForm((f) => ({ ...f, email: e.target.value }));
                        if (basicEmailError) setBasicEmailError(null);
                      }}
                      aria-invalid={!!basicEmailError}
                      data-testid="input-profile-email"
                    />
                    {basicEmailError && (
                      <p className="text-xs text-destructive mt-1" data-testid="text-profile-email-error">
                        {basicEmailError}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="font-medium" data-testid="text-profile-email">{user?.email || "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Phone</Label>
                {editBasic ? (
                  <Input
                    type="tel"
                    value={basicForm.phone}
                    onChange={(e) => setBasicForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="(555) 123-4567"
                    data-testid="input-profile-phone"
                  />
                ) : (
                  <p className="font-medium" data-testid="text-profile-phone">{(user as { phone?: string | null })?.phone || "—"}</p>
                )}
              </div>
              {hasPermission("users.edit") && (
                <div>
                  <Label className="text-muted-foreground text-xs">Access level</Label>
                  <Select
                    value={user?.role ?? "employee"}
                    onValueChange={(v) => setAccessLevelMutation.mutate(v)}
                    disabled={setAccessLevelMutation.isPending}
                  >
                    <SelectTrigger className="mt-1" data-testid="select-profile-access-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Controls what they can see. Only Admin sees the Employees, Payroll and Reports
                    pages (and pay rates). A timesheet reviewer should be Employee or Manager.
                  </p>
                </div>
              )}
              {canManagePermissions && (
                <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div>
                    <Label className="text-xs font-medium">Can view pay rates</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Let this person see employees' pay rates and rate type. Set per person — on just
                      for the admins/managers you choose, independent of their role.
                    </p>
                  </div>
                  <Switch
                    checked={!!payVisibility?.allowed}
                    onCheckedChange={(v) => setPayVisibilityMutation.mutate(v)}
                    disabled={setPayVisibilityMutation.isPending}
                    data-testid="switch-pay-visibility"
                  />
                </div>
              )}
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
                  <div className="flex-1">
                    <MultiSelect
                      options={(() => {
                        const byId = new Map<string, string>();
                        for (const r of assignableRoles) byId.set(r.id, r.name);
                        for (const r of assignedRoles) if (!byId.has(r.id)) byId.set(r.id, r.name);
                        return Array.from(byId.entries())
                          .map(([value, label]) => ({ value, label }))
                          .sort((a, b) => a.label.localeCompare(b.label));
                      })()}
                      selected={assignDraft.roleIds}
                      onChange={(ids) => patchAssignDraft({ roleIds: ids })}
                      placeholder="No roles assigned"
                      allLabel="No roles"
                      searchPlaceholder="Search roles..."
                      emptyMessage="No roles available."
                      disabled={saveAssignmentsMutation.isPending}
                      onAddNew={
                        hasPermission("roles.manage")
                          ? () => setProfileCreateRoleOpen(true)
                          : undefined
                      }
                      addNewLabel="Add new role"
                      data-testid="multiselect-profile-roles"
                    />
                  </div>
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
                {assignedRoles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2" data-testid="list-profile-assigned-roles">
                    {assignedRoles.map((r) => (
                      <Badge key={r.id} variant="outline" className="text-xs" data-testid={`badge-assigned-role-${r.id}`}>
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Access tier: <span className="font-medium capitalize">{user?.role || "employee"}</span>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Company</Label>
                <Select
                  value={user?.companyId || ""}
                  onValueChange={(v) => {
                    if (v === INLINE_ADD_NEW_VALUE) {
                      setProfileCreateCompanyOpen(true);
                      return;
                    }
                    updateMutation.mutate({ companyId: v, departmentId: null, locationId: null });
                  }}
                >
                  <SelectTrigger data-testid="select-profile-division">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {(divisions || []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                    <PermissionedAddNewItem
                      permission="company.create"
                      label="Add new company"
                      testId="option-profile-add-new-company"
                    />
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground text-xs">Departments</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!user?.companyId}
                    data-testid="button-profile-add-new-department"
                    onClick={() => {
                      if (!user?.companyId) {
                        toast({
                          title: "Select a company first",
                          description: "Set a company before adding a department.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setProfileCreateDepartmentOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add new
                  </Button>
                </div>
                <MultiSelect
                  options={scopedDepartments.map((d) => ({ label: d.name, value: d.id }))}
                  selected={assignDraft.departmentIds}
                  onChange={(values) => patchAssignDraft({ departmentIds: values })}
                  placeholder="Select departments"
                  allLabel="No Department"
                  emptyMessage="No departments available."
                  disabled={!user?.companyId}
                  data-testid="select-profile-department"
                />
                {assignDraft.departmentIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {assignDraft.departmentIds.map((id) => {
                      const d = scopedDepartments.find((x) => x.id === id) || departments?.find((x) => x.id === id);
                      return (
                        <Badge key={id} variant="secondary" data-testid={`badge-profile-department-${id}`}>
                          {d?.name || id}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground text-xs">Locations</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!user?.companyId}
                    data-testid="button-profile-add-new-location"
                    onClick={() => {
                      if (!user?.companyId) {
                        toast({
                          title: "Select a company first",
                          description: "Set a company before adding a location.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setProfileCreateLocationOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add new
                  </Button>
                </div>
                <MultiSelect
                  options={scopedLocations.map((l) => ({ label: l.name, value: l.id }))}
                  selected={assignDraft.locationIds}
                  onChange={(values) => patchAssignDraft({ locationIds: values })}
                  placeholder="Select locations"
                  allLabel="No Location"
                  emptyMessage="No locations available."
                  disabled={!user?.companyId}
                  data-testid="select-profile-location"
                />
                {assignDraft.locationIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {assignDraft.locationIds.map((id) => {
                      const l = scopedLocations.find((x) => x.id === id) || locations?.find((x) => x.id === id);
                      return (
                        <Badge key={id} variant="secondary" data-testid={`badge-profile-location-${id}`}>
                          {l?.name || id}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
              {assignDirty && (
                <div className="flex items-center justify-end gap-2 pt-3 mt-2 border-t">
                  <span className="text-xs text-muted-foreground mr-auto">Unsaved assignment changes</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetAssignDraft}
                    disabled={saveAssignmentsMutation.isPending}
                    data-testid="button-reset-assignments"
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveAssignmentsMutation.mutate()}
                    disabled={saveAssignmentsMutation.isPending}
                    data-testid="button-save-assignments"
                  >
                    {saveAssignmentsMutation.isPending ? "Saving…" : "Save assignments"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <CreateCompanyDialog
            open={profileCreateCompanyOpen}
            onOpenChange={setProfileCreateCompanyOpen}
            onCreated={(company) => {
              updateMutation.mutate({ companyId: company.id, departmentId: null, locationId: null });
            }}
          />
          <CreateDepartmentDialog
            open={profileCreateDepartmentOpen}
            onOpenChange={setProfileCreateDepartmentOpen}
            companyId={user?.companyId || ""}
            companyName={div?.name}
            onCreated={(dept) => {
              const next = assignDraft.departmentIds.includes(dept.id) ? assignDraft.departmentIds : [...assignDraft.departmentIds, dept.id];
              patchAssignDraft({ departmentIds: next });
            }}
          />
          <CreateLocationDialog
            open={profileCreateLocationOpen}
            onOpenChange={setProfileCreateLocationOpen}
            companyId={user?.companyId || ""}
            companyName={div?.name}
            onCreated={(location) => {
              const next = assignDraft.locationIds.includes(location.id) ? assignDraft.locationIds : [...assignDraft.locationIds, location.id];
              patchAssignDraft({ locationIds: next });
            }}
          />
          <CreateRoleDialog
            open={profileCreateRoleOpen}
            onOpenChange={setProfileCreateRoleOpen}
            onCreated={(role) => {
              queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "assignable-roles"] });
              const next = assignedRoles.map((r) => r.id);
              if (!next.includes(role.id)) next.push(role.id);
              setRolesMutation.mutate(next);
            }}
          />
          <div className="mt-4">
            <CertificationsCard employeeId={userId} canEdit={true} highlightCertId={certIdFromUrl} />
          </div>
        </TabsContent>

        <TabsContent value="employment" className="space-y-6">
          {user?.role === "manager" && (
            <ManagerScopeEditor userId={userId} />
          )}
          <Card data-testid="card-employment">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Employment Details</CardTitle>
              {editEmployment ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditEmployment(false);
                      if (profile) {
                        setEmploymentForm({
                          employmentType: profile.employmentType || "full_time",
                          hireDate: profile.hireDate ? String(profile.hireDate).slice(0, 10) : "",
                          terminationDate: profile.terminationDate ? String(profile.terminationDate).slice(0, 10) : "",
                          overtimeEligible: !!profile.overtimeEligible,
                          taxClassification: profile.taxClassification || "W-2",
                          clockInRequired: profile.clockInRequired ?? true,
                          clockConfirmationOnly: profile.clockConfirmationOnly ?? false,
                          overnightShiftsAllowed: profile.overnightShiftsAllowed ?? false,
                          useDevicePunchDirection: profile.useDevicePunchDirection ?? false,
                          requireLunchBreak: profile.requireLunchBreak ?? false,
                        });
                      }
                    }}
                    data-testid="button-cancel-employment"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      employmentMutation.mutate({
                        employmentType: employmentForm.employmentType,
                        hireDate: employmentForm.hireDate ? employmentForm.hireDate : null,
                        terminationDate: employmentForm.terminationDate ? employmentForm.terminationDate : null,
                        overtimeEligible: employmentForm.overtimeEligible,
                        taxClassification: employmentForm.taxClassification,
                        clockInRequired: employmentForm.clockInRequired,
                        clockConfirmationOnly: employmentForm.clockConfirmationOnly,
                        overnightShiftsAllowed: employmentForm.overnightShiftsAllowed,
                        useDevicePunchDirection: employmentForm.useDevicePunchDirection,
                        requireLunchBreak: employmentForm.requireLunchBreak,
                      })
                    }
                    disabled={employmentMutation.isPending || !profile}
                    data-testid="button-save-employment"
                  >
                    {employmentMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditEmployment(true)}
                  disabled={!profile}
                  data-testid="button-edit-employment"
                >
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Employee Number</Label>
                <p className="font-medium" data-testid="text-profile-employee-number">{profile?.employeeNumber || "—"}</p>
              </div>
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
                {editEmployment ? (
                  <Select
                    value={employmentForm.employmentType}
                    onValueChange={(v) => setEmploymentForm((f) => ({ ...f, employmentType: v }))}
                  >
                    <SelectTrigger data-testid="select-profile-employment-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full Time</SelectItem>
                      <SelectItem value="part_time">Part Time</SelectItem>
                      <SelectItem value="contractor">Contractor</SelectItem>
                      <SelectItem value="per_diem">Per Diem</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="font-medium" data-testid="text-profile-employment-type">{profile?.employmentType || "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Tax Classification</Label>
                {editEmployment ? (
                  <Select
                    value={employmentForm.taxClassification}
                    onValueChange={(v) => setEmploymentForm((f) => ({ ...f, taxClassification: v }))}
                  >
                    <SelectTrigger data-testid="select-profile-tax-classification">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="W-2">W-2</SelectItem>
                      <SelectItem value="1099">1099</SelectItem>
                      <SelectItem value="Volunteer">Volunteer</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="font-medium" data-testid="text-profile-tax-classification">{profile?.taxClassification || "W-2"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Required to clock in</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={editEmployment ? employmentForm.clockInRequired : (profile?.clockInRequired ?? true)}
                    onCheckedChange={(v) => setEmploymentForm((f) => ({ ...f, clockInRequired: v }))}
                    disabled={!editEmployment || profileLoading || !profile}
                    data-testid="switch-profile-clock-in-required"
                  />
                  <span className="text-sm text-muted-foreground">
                    {(editEmployment ? employmentForm.clockInRequired : (profile?.clockInRequired ?? true))
                      ? "Missing-punch & no-show alerts on"
                      : "Alerts suppressed (not required)"}
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Clock is attendance confirmation only</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={editEmployment ? employmentForm.clockConfirmationOnly : (profile?.clockConfirmationOnly ?? false)}
                    onCheckedChange={(v) => setEmploymentForm((f) => ({ ...f, clockConfirmationOnly: v }))}
                    disabled={!editEmployment || profileLoading || !profile}
                    data-testid="switch-profile-clock-confirmation-only"
                  />
                  <span className="text-sm text-muted-foreground">
                    {(editEmployment ? employmentForm.clockConfirmationOnly : (profile?.clockConfirmationOnly ?? false))
                      ? "One clock/day = present; hours not counted"
                      : "Normal (clock in and out, hours counted)"}
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Works overnight shifts</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={editEmployment ? employmentForm.overnightShiftsAllowed : (profile?.overnightShiftsAllowed ?? false)}
                    onCheckedChange={(v) => setEmploymentForm((f) => ({ ...f, overnightShiftsAllowed: v }))}
                    disabled={!editEmployment || profileLoading || !profile}
                    data-testid="switch-profile-overnight-allowed"
                  />
                  <span className="text-sm text-muted-foreground">
                    {(editEmployment ? employmentForm.overnightShiftsAllowed : (profile?.overnightShiftsAllowed ?? false))
                      ? "Overnight OK (cross-midnight shifts allowed)"
                      : "Cross-midnight shift = forgotten punch-out (flagged)"}
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Use clock's In/Out button</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={editEmployment ? employmentForm.useDevicePunchDirection : (profile?.useDevicePunchDirection ?? false)}
                    onCheckedChange={(v) => setEmploymentForm((f) => ({ ...f, useDevicePunchDirection: v }))}
                    disabled={!editEmployment || profileLoading || !profile}
                    data-testid="switch-profile-device-direction"
                  />
                  <span className="text-sm text-muted-foreground">
                    {(editEmployment ? employmentForm.useDevicePunchDirection : (profile?.useDevicePunchDirection ?? false))
                      ? "Direction from the clock's In/Out key"
                      : "Direction auto-guessed from shift state"}
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Require lunch clock-out</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={editEmployment ? employmentForm.requireLunchBreak : (profile?.requireLunchBreak ?? false)}
                    onCheckedChange={(v) => setEmploymentForm((f) => ({ ...f, requireLunchBreak: v }))}
                    disabled={!editEmployment || profileLoading || !profile}
                    data-testid="switch-profile-require-lunch"
                  />
                  <span className="text-sm text-muted-foreground">
                    {(editEmployment ? employmentForm.requireLunchBreak : (profile?.requireLunchBreak ?? false))
                      ? "Lunch paid within the hour; 45-min fine if no proper lunch"
                      : "No lunch rule applied"}
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Hire Date</Label>
                {editEmployment ? (
                  <Input
                    type="date"
                    value={employmentForm.hireDate}
                    onChange={(e) => setEmploymentForm((f) => ({ ...f, hireDate: e.target.value }))}
                    data-testid="input-profile-hire-date"
                  />
                ) : (
                  <p className="font-medium" data-testid="text-profile-hire-date">{formatDate(profile?.hireDate) || "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Termination Date</Label>
                {editEmployment ? (
                  <Input
                    type="date"
                    value={employmentForm.terminationDate}
                    onChange={(e) => setEmploymentForm((f) => ({ ...f, terminationDate: e.target.value }))}
                    data-testid="input-profile-termination-date"
                  />
                ) : (
                  <p className="font-medium" data-testid="text-profile-termination-date">{formatDate(profile?.terminationDate) || "—"}</p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Overtime Eligible</Label>
                {editEmployment ? (
                  <div className="flex items-center gap-2 h-10">
                    <Switch
                      checked={employmentForm.overtimeEligible}
                      onCheckedChange={(v) => setEmploymentForm((f) => ({ ...f, overtimeEligible: v }))}
                      data-testid="switch-profile-overtime"
                    />
                    <span className="text-sm text-muted-foreground">
                      {employmentForm.overtimeEligible ? "Yes" : "No"}
                    </span>
                  </div>
                ) : (
                  <p className="font-medium" data-testid="text-profile-overtime">
                    {profile?.overtimeEligible ? "Yes" : "No"}
                  </p>
                )}
              </div>
              <NextReviewIndicator userId={userId} />
              <CorrectionRequestStat userId={userId} />
            </CardContent>
          </Card>
        </TabsContent>

        {canViewPay && <TabsContent value="pay">
          <Card data-testid="card-pay-setup">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Pay Setup</CardTitle>
              {canEditPay && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openPayDialog}
                  disabled={!profile}
                  data-testid="button-edit-pay-setup"
                >
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Pay Type</Label>
                <p className="font-medium" data-testid="text-profile-pay-type">{profile?.payType || "—"}</p>
              </div>
              {profile?.payType === "hourly" && (
                <div>
                  <Label className="text-muted-foreground text-xs">Hourly Rate</Label>
                  <p className="font-medium" data-testid="text-profile-hourly-rate">
                    {profile?.hourlyRate != null ? formatCurrency(profile.hourlyRate) : "—"}
                  </p>
                </div>
              )}
              {profile?.payType === "daily" && (
                <div>
                  <Label className="text-muted-foreground text-xs">Daily Rate</Label>
                  <p className="font-medium" data-testid="text-profile-daily-rate">
                    {profile?.dailySalary != null ? formatCurrency(profile.dailySalary) : "—"}
                  </p>
                </div>
              )}
              {profile?.payType === "salary" && (
                <div>
                  <Label className="text-muted-foreground text-xs">Weekly Salary</Label>
                  <p className="font-medium" data-testid="text-profile-weekly-salary">
                    {profile?.weeklySalary != null ? formatCurrency(profile.weeklySalary) : "—"}
                  </p>
                </div>
              )}
              <div>
                <Label className="text-muted-foreground text-xs">Holiday Pay</Label>
                <p className="font-medium" data-testid="text-profile-holiday-pay">
                  {profile?.holidayPayEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Payroll Company</Label>
                <p className="font-medium" data-testid="text-profile-payroll-company">
                  {profile?.payrollCompanyId
                    ? (divisions?.find((d) => d.id === profile.payrollCompanyId)?.name || "—")
                    : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
          <Dialog open={editPayOpen} onOpenChange={setEditPayOpen}>
            <DialogContent data-testid="dialog-edit-pay-setup">
              <DialogHeader>
                <DialogTitle>Edit Pay Setup</DialogTitle>
                <DialogDescription>Update this employee's pay type, rate, and pay options.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Pay Type</Label>
                  <Select
                    value={payForm.payType}
                    onValueChange={(v) =>
                      setPayForm((f) => ({
                        ...f,
                        payType: v,
                        hourlyRate: v === "hourly" ? f.hourlyRate : "",
                        dailySalary: v === "daily" ? f.dailySalary : "",
                        weeklySalary: v === "salary" ? f.weeklySalary : "",
                        overtimeEligible: v === "hourly",
                      }))
                    }
                  >
                    <SelectTrigger data-testid="select-pay-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="salary">Salary</SelectItem>
                      <SelectItem value="contractual">Contractual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {payForm.payType === "contractual" && (
                  <p className="text-sm text-muted-foreground" data-testid="text-pay-contractual-note">
                    Contractual workers have no pay rate. Their hours are still tracked and counted.
                  </p>
                )}
                {payForm.payType === "hourly" && (
                  <div className="space-y-2">
                    <Label>Hourly Rate ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={payForm.hourlyRate}
                      onChange={(e) => setPayForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                      placeholder="0.00"
                      data-testid="input-pay-hourly-rate"
                    />
                  </div>
                )}
                {payForm.payType === "daily" && (
                  <div className="space-y-2">
                    <Label>Daily Rate ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={payForm.dailySalary}
                      onChange={(e) => setPayForm((f) => ({ ...f, dailySalary: e.target.value }))}
                      placeholder="0.00"
                      data-testid="input-pay-daily-rate"
                    />
                  </div>
                )}
                {payForm.payType === "salary" && (
                  <div className="space-y-2">
                    <Label>Weekly Salary ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={payForm.weeklySalary}
                      onChange={(e) => setPayForm((f) => ({ ...f, weeklySalary: e.target.value }))}
                      placeholder="0.00"
                      data-testid="input-pay-weekly-salary"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="switch-pay-holiday">Holiday Pay</Label>
                  <Switch
                    id="switch-pay-holiday"
                    checked={payForm.holidayPayEnabled}
                    onCheckedChange={(v) => setPayForm((f) => ({ ...f, holidayPayEnabled: v }))}
                    data-testid="switch-pay-holiday"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="checkbox-pay-overtime"
                    checked={payForm.overtimeEligible}
                    onCheckedChange={(v) => setPayForm((f) => ({ ...f, overtimeEligible: v === true }))}
                    data-testid="checkbox-pay-overtime"
                  />
                  <Label htmlFor="checkbox-pay-overtime">Overtime Eligible</Label>
                </div>
                <div className="space-y-2">
                  <Label>Payroll Company</Label>
                  <Select
                    value={payForm.payrollCompanyId}
                    onValueChange={(v) => setPayForm((f) => ({ ...f, payrollCompanyId: v }))}
                  >
                    <SelectTrigger data-testid="select-payroll-company">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {divisions?.map((d) => (
                        <SelectItem key={d.id} value={d.id} data-testid={`option-payroll-company-${d.id}`}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used for payroll reporting only — independent of department/location assignment.
                  </p>
                </div>
                {profile?.taxClassification === "1099" && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label>Pay to the order of</Label>
                    <Input
                      value={payForm.payeeName}
                      onChange={(e) => setPayForm((f) => ({ ...f, payeeName: e.target.value }))}
                      placeholder="Company / LLC name"
                      data-testid="input-pay-payee-name"
                    />
                    <Input
                      value={payForm.payeeAddress}
                      onChange={(e) => setPayForm((f) => ({ ...f, payeeAddress: e.target.value }))}
                      placeholder="Address (optional)"
                      data-testid="input-pay-payee-address"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Input value={payForm.payeeCity} onChange={(e) => setPayForm((f) => ({ ...f, payeeCity: e.target.value }))} placeholder="City" data-testid="input-pay-payee-city" />
                      <Input value={payForm.payeeState} onChange={(e) => setPayForm((f) => ({ ...f, payeeState: e.target.value }))} placeholder="State" data-testid="input-pay-payee-state" />
                      <Input value={payForm.payeeZip} onChange={(e) => setPayForm((f) => ({ ...f, payeeZip: e.target.value }))} placeholder="ZIP" data-testid="input-pay-payee-zip" />
                    </div>
                    <Input value={payForm.payeeTaxId} onChange={(e) => setPayForm((f) => ({ ...f, payeeTaxId: e.target.value }))} placeholder="Tax ID (optional)" data-testid="input-pay-payee-tax-id" />
                    <Input value={payForm.payeeMemo} onChange={(e) => setPayForm((f) => ({ ...f, payeeMemo: e.target.value }))} placeholder="Memo (optional) — shown on the payroll report" data-testid="input-pay-payee-memo" />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setEditPayOpen(false)}
                  data-testid="button-cancel-pay-setup"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => payMutation.mutate()}
                  disabled={!payRateValid || payMutation.isPending}
                  data-testid="button-save-pay-setup"
                >
                  {payMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="mt-6">
            <EmployeeBonusesCard
              userId={userId}
              bonuses={(profile?.dayOfWeekBonuses as EmployeeDowBonus[]) ?? []}
              canEdit={canEditPay}
            />
          </div>
        </TabsContent>}

        <TabsContent value="timeclock" className="space-y-6">
          <Card data-testid="card-time-clock-settings">
            <CardHeader><CardTitle>Time Clock Settings</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-timeclock-info">
                Time clock settings are managed through the Rules & Controls center. This employee follows the company default time clock rules.
              </p>
            </CardContent>
          </Card>
          <FingerprintEnrollmentCard employeeId={userId} />
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

        {canViewPolicies && (
          <TabsContent value="policies">
            <EmployeePoliciesTab userId={userId} isSelf={currentAuthUser?.id === userId} />
          </TabsContent>
        )}

        <TabsContent value="history">
          <EmployeeAuditHistory userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ApplicablePolicyRow {
  policyId: string;
  policyName: string;
  policyTypeKey: string | null;
  status: string;
  version: number;
  requiresAcknowledgment: boolean;
  effectiveDate: string | null;
  sources: { level: string; label: string; effectiveDate: string | null }[];
  acknowledgment: {
    required: boolean;
    acknowledged: boolean;
    acknowledgedAt: string | null;
    acknowledgedVersion: number | null;
  };
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  attendance: "Attendance",
  pto: "PTO / Leave",
  payroll: "Payroll",
  approvals: "Approvals",
};

function EmployeePoliciesTab({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { has } = usePermissions();
  const canManagePolicies = has("policies.manage");
  const canSeePay = has("compensation.view") || has("system.super_admin");
  const { data: rows, isLoading, isError, refetch } = useQuery<ApplicablePolicyRow[]>({
    queryKey: ["/api/users", userId, "applicable-policies"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/applicable-policies`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load policies");
      return res.json();
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (policyId: string) => {
      await apiRequest("POST", `/api/policies/${policyId}/acknowledge`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "applicable-policies"] });
      toast({ title: "Policy acknowledged" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not acknowledge", description: err.message, variant: "destructive" });
    },
  });

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

  const viewPolicy = (row: ApplicablePolicyRow) => {
    const params = new URLSearchParams();
    if (row.policyTypeKey) params.set("type", row.policyTypeKey);
    params.set("policyId", row.policyId);
    navigate(`/rules-controls?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
    {canManagePolicies && <PolicyAssignmentManager userId={userId} />}
    {canSeePay && <EmployeePayrollRulesCard userId={userId} canEdit={canManagePolicies} />}
    <Card data-testid="card-employee-policies">
      <CardHeader>
        <CardTitle>Applicable Policies</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" data-testid="loading-employee-policies">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="error-employee-policies">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">Could not load policies for this employee.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-policies">
              Try again
            </Button>
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center" data-testid="empty-employee-policies">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No policies currently apply to this employee.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="table-employee-policies">
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Why it applies</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acknowledgment</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.policyId} data-testid={`row-policy-${row.policyId}`}>
                    <TableCell className="font-medium" data-testid={`text-policy-name-${row.policyId}`}>
                      {row.policyName}
                    </TableCell>
                    <TableCell data-testid={`text-policy-category-${row.policyId}`}>
                      {row.policyTypeKey ? (POLICY_TYPE_LABELS[row.policyTypeKey] || row.policyTypeKey) : "—"}
                    </TableCell>
                    <TableCell data-testid={`text-policy-sources-${row.policyId}`}>
                      <div className="flex flex-wrap gap-1">
                        {row.sources.map((s, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs font-normal">
                            {s.label}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-policy-effective-${row.policyId}`}>
                      {formatDate(row.effectiveDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === "active" ? "default" : "outline"} data-testid={`status-policy-${row.policyId}`}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-policy-ack-${row.policyId}`}>
                      {!row.acknowledgment.required ? (
                        <span className="text-xs text-muted-foreground">Not required</span>
                      ) : row.acknowledgment.acknowledged ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {formatDate(row.acknowledgment.acknowledgedAt)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <Clock className="h-3.5 w-3.5" /> Pending
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isSelf && row.acknowledgment.required && !row.acknowledgment.acknowledged && (
                          <Button
                            size="sm"
                            onClick={() => acknowledgeMutation.mutate(row.policyId)}
                            disabled={acknowledgeMutation.isPending}
                            data-testid={`button-acknowledge-${row.policyId}`}
                          >
                            Acknowledge
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewPolicy(row)}
                          data-testid={`button-view-policy-${row.policyId}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" /> View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

// ───────────────────────── Composable Payroll Rules ─────────────────────────
// Per-employee payroll RULE overrides, edited on the profile Policies tab. Each
// rule can be left to follow the employee's assigned policy (the "preset") or
// overridden just for this person. Overrides layer on top of the policy — set
// only the rules you want to change; everything else follows the policy. Saved
// to the employment profile's payrollOverrides and composed by the payroll
// engine (server/policyEngine.ts getEffectivePolicy).
type PayrollOverrides = {
  payPeriodType?: "weekly" | "biweekly" | "semimonthly" | "monthly";
  overtimeEnabled?: boolean;
  overtimeMultiplier?: number;
  doubleTimeEnabled?: boolean;
  doubleTimeMultiplier?: number;
  doubleTimeThresholdDaily?: number;
  includeHolidayPay?: boolean;
  autoCalculateOT?: boolean;
  punctualityBonus?: { enabled: boolean; bonusPerHour: number; label?: string };
};
type EffectivePayroll = {
  baseline: Record<string, any>;
  overrides: PayrollOverrides;
  presetPolicyName: string | null;
  presetLevel: string | null;
};
const PAY_PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
};
const fmtBool = (v: any) => (v ? "On" : "Off");
const fmtRate = (v: any) => (v == null ? "—" : `${v}×`);

// One rule row in edit mode: a labelled switch that turns the override on/off,
// with the rule's control shown when on, or the policy's current value when off.
function PayrollRuleRow({
  label, hint, testId, active, onToggle, baselineText, canEdit, children,
}: {
  label: string; hint?: string; testId: string; active: boolean;
  onToggle: (on: boolean) => void; baselineText: string; canEdit: boolean; children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`rule-row-${testId}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {active && <Badge variant="secondary" className="text-[10px]">Per-employee</Badge>}
        </div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {active ? (
          <div className="flex items-center gap-2">{children}</div>
        ) : (
          <span className="text-xs text-muted-foreground">Policy: {baselineText}</span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Override</span>
          <Switch checked={active} onCheckedChange={onToggle} disabled={!canEdit} data-testid={`switch-override-${testId}`} />
        </div>
      </div>
    </div>
  );
}

function EmployeePayrollRulesCard({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayrollOverrides>({});

  const { data, isLoading, isError, refetch } = useQuery<EffectivePayroll>({
    queryKey: ["/api/employment-profiles", userId, "effective-payroll"],
    queryFn: async () => {
      const res = await fetch(`/api/employment-profiles/${userId}/effective-payroll`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payroll rules");
      return res.json();
    },
  });

  useEffect(() => {
    if (!editing && data) setDraft({ ...(data.overrides ?? {}) });
  }, [data, editing]);

  const baseline = data?.baseline ?? {};
  const saved = data?.overrides ?? {};

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/employment-profiles/${userId}`, { payrollOverrides: draft });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId, "effective-payroll"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      setEditing(false);
      toast({ title: "Payroll rules saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isSet = (key: keyof PayrollOverrides) => Object.prototype.hasOwnProperty.call(draft, key) && draft[key] !== undefined;
  const setKey = <K extends keyof PayrollOverrides>(key: K, val: PayrollOverrides[K]) =>
    setDraft((p) => ({ ...p, [key]: val }));
  const clearKey = (key: keyof PayrollOverrides) =>
    setDraft((p) => { const n = { ...p }; delete n[key]; return n; });
  // Turning an override ON seeds it with the current policy value so the admin
  // starts from the preset and only changes what they mean to.
  const toggleBool = (key: "overtimeEnabled" | "doubleTimeEnabled" | "includeHolidayPay" | "autoCalculateOT", on: boolean) =>
    on ? setKey(key, baseline[key] ?? true) : clearKey(key);
  const toggleNum = (key: "overtimeMultiplier" | "doubleTimeMultiplier" | "doubleTimeThresholdDaily", on: boolean, fallback: number) =>
    on ? setKey(key, (baseline[key] ?? fallback) as number) : clearKey(key);

  const numInput = (key: "overtimeMultiplier" | "doubleTimeMultiplier" | "doubleTimeThresholdDaily", step: string, max: number, suffix: string) => (
    <div className="flex items-center gap-1">
      <Input
        type="number" min={0} step={step} max={max}
        className="h-8 w-20"
        value={(draft[key] as number) ?? ""}
        onChange={(e) => { const v = e.target.value === "" ? 0 : parseFloat(e.target.value); setKey(key, Number.isNaN(v) ? 0 : Math.max(0, Math.min(max, v))); }}
        data-testid={`input-override-${key}`}
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </div>
  );

  // Read-only summary: effective value per rule, flagged when it's a per-employee override.
  const effVal = (key: keyof PayrollOverrides) => (Object.prototype.hasOwnProperty.call(saved, key) ? (saved as any)[key] : baseline[key]);
  const isOverridden = (key: keyof PayrollOverrides) => Object.prototype.hasOwnProperty.call(saved, key) && (saved as any)[key] !== undefined;
  const pb = effVal("punctualityBonus") as PayrollOverrides["punctualityBonus"] | undefined;
  const summaryRows: { label: string; value: string; key: keyof PayrollOverrides }[] = [
    { key: "payPeriodType", label: "Pay period", value: PAY_PERIOD_LABELS[effVal("payPeriodType")] ?? String(effVal("payPeriodType") ?? "—") },
    { key: "overtimeEnabled", label: "Overtime pay", value: fmtBool(effVal("overtimeEnabled")) },
    { key: "overtimeMultiplier", label: "Overtime rate", value: fmtRate(effVal("overtimeMultiplier")) },
    { key: "doubleTimeEnabled", label: "Double-time pay", value: fmtBool(effVal("doubleTimeEnabled")) },
    { key: "doubleTimeMultiplier", label: "Double-time rate", value: fmtRate(effVal("doubleTimeMultiplier")) },
    { key: "doubleTimeThresholdDaily", label: "Double-time after", value: `${effVal("doubleTimeThresholdDaily") ?? "—"}h/day` },
    { key: "includeHolidayPay", label: "Holiday pay", value: fmtBool(effVal("includeHolidayPay")) },
    { key: "autoCalculateOT", label: "Auto-calculate OT", value: fmtBool(effVal("autoCalculateOT")) },
    { key: "punctualityBonus", label: "Conditional raise (on-time)", value: pb?.enabled ? `+$${pb.bonusPerHour}/hr` : "Off" },
  ];

  return (
    <Card data-testid="card-employee-payroll-rules">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Payroll Rules</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Pick which payroll rules this employee gets. Each rule follows the assigned
            {data?.presetPolicyName ? <> policy <span className="font-medium">“{data.presetPolicyName}”</span></> : " policy"} unless you
            override it here — overrides apply to this person only.
          </p>
        </div>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-edit-payroll-rules">Edit</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Could not load payroll rules.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : !editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5" data-testid="summary-payroll-rules">
            {summaryRows.map((r) => (
              <div key={String(r.key)} className="flex items-center justify-between gap-2 py-1 border-b border-dashed last:border-0">
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {r.value}
                  {isOverridden(r.key) && <Badge variant="secondary" className="text-[10px]">Per-employee</Badge>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <PayrollRuleRow
              label="Pay period" testId="payPeriodType" canEdit={canEdit}
              active={isSet("payPeriodType")}
              onToggle={(on) => (on ? setKey("payPeriodType", (baseline.payPeriodType ?? "biweekly")) : clearKey("payPeriodType"))}
              baselineText={PAY_PERIOD_LABELS[baseline.payPeriodType] ?? "Bi-weekly"}
            >
              <Select value={draft.payPeriodType ?? "biweekly"} onValueChange={(v) => setKey("payPeriodType", v as PayrollOverrides["payPeriodType"])}>
                <SelectTrigger className="h-8 w-36" data-testid="select-override-payPeriodType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAY_PERIOD_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Overtime pay" hint="Whether this employee is paid an overtime rate at all." testId="overtimeEnabled" canEdit={canEdit}
              active={isSet("overtimeEnabled")} onToggle={(on) => toggleBool("overtimeEnabled", on)}
              baselineText={fmtBool(baseline.overtimeEnabled)}
            >
              <Switch checked={!!draft.overtimeEnabled} onCheckedChange={(v) => setKey("overtimeEnabled", v)} data-testid="value-override-overtimeEnabled" />
              <span className="text-xs text-muted-foreground w-7">{fmtBool(draft.overtimeEnabled)}</span>
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Overtime rate" hint="Multiplier on the hourly rate for overtime hours." testId="overtimeMultiplier" canEdit={canEdit}
              active={isSet("overtimeMultiplier")} onToggle={(on) => toggleNum("overtimeMultiplier", on, 1.5)}
              baselineText={fmtRate(baseline.overtimeMultiplier)}
            >
              {numInput("overtimeMultiplier", "0.05", 10, "×")}
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Double-time pay" testId="doubleTimeEnabled" canEdit={canEdit}
              active={isSet("doubleTimeEnabled")} onToggle={(on) => toggleBool("doubleTimeEnabled", on)}
              baselineText={fmtBool(baseline.doubleTimeEnabled)}
            >
              <Switch checked={!!draft.doubleTimeEnabled} onCheckedChange={(v) => setKey("doubleTimeEnabled", v)} data-testid="value-override-doubleTimeEnabled" />
              <span className="text-xs text-muted-foreground w-7">{fmtBool(draft.doubleTimeEnabled)}</span>
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Double-time rate" testId="doubleTimeMultiplier" canEdit={canEdit}
              active={isSet("doubleTimeMultiplier")} onToggle={(on) => toggleNum("doubleTimeMultiplier", on, 2)}
              baselineText={fmtRate(baseline.doubleTimeMultiplier)}
            >
              {numInput("doubleTimeMultiplier", "0.05", 10, "×")}
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Double-time after" hint="Hours worked in one day before double-time starts." testId="doubleTimeThresholdDaily" canEdit={canEdit}
              active={isSet("doubleTimeThresholdDaily")} onToggle={(on) => toggleNum("doubleTimeThresholdDaily", on, 12)}
              baselineText={`${baseline.doubleTimeThresholdDaily ?? "—"}h/day`}
            >
              {numInput("doubleTimeThresholdDaily", "0.5", 24, "h/day")}
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Holiday pay" hint="Whether holiday pay applies to this employee." testId="includeHolidayPay" canEdit={canEdit}
              active={isSet("includeHolidayPay")} onToggle={(on) => toggleBool("includeHolidayPay", on)}
              baselineText={fmtBool(baseline.includeHolidayPay)}
            >
              <Switch checked={!!draft.includeHolidayPay} onCheckedChange={(v) => setKey("includeHolidayPay", v)} data-testid="value-override-includeHolidayPay" />
              <span className="text-xs text-muted-foreground w-7">{fmtBool(draft.includeHolidayPay)}</span>
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Auto-calculate OT" hint="Let the system split overtime automatically." testId="autoCalculateOT" canEdit={canEdit}
              active={isSet("autoCalculateOT")} onToggle={(on) => toggleBool("autoCalculateOT", on)}
              baselineText={fmtBool(baseline.autoCalculateOT)}
            >
              <Switch checked={!!draft.autoCalculateOT} onCheckedChange={(v) => setKey("autoCalculateOT", v)} data-testid="value-override-autoCalculateOT" />
              <span className="text-xs text-muted-foreground w-7">{fmtBool(draft.autoCalculateOT)}</span>
            </PayrollRuleRow>

            <PayrollRuleRow
              label="Conditional raise (on-time all week)"
              hint="Extra $/hour for a week where the employee clocks in on time every scheduled day."
              testId="punctualityBonus" canEdit={canEdit}
              active={isSet("punctualityBonus")}
              onToggle={(on) => (on
                ? setKey("punctualityBonus", { enabled: true, bonusPerHour: baseline.punctualityBonus?.bonusPerHour ?? 2, label: baseline.punctualityBonus?.label ?? "Weekly Punctuality Bonus" })
                : clearKey("punctualityBonus"))}
              baselineText={baseline.punctualityBonus?.enabled ? `+$${baseline.punctualityBonus.bonusPerHour}/hr` : "Off"}
            >
              <Switch
                checked={!!draft.punctualityBonus?.enabled}
                onCheckedChange={(v) => setKey("punctualityBonus", { enabled: v, bonusPerHour: draft.punctualityBonus?.bonusPerHour ?? 2, label: draft.punctualityBonus?.label ?? "Weekly Punctuality Bonus" })}
                data-testid="value-override-punctualityBonus-enabled"
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">+$</span>
                <Input
                  type="number" min={0} step="0.25" max={1000} className="h-8 w-20"
                  value={draft.punctualityBonus?.bonusPerHour ?? ""}
                  onChange={(e) => { const v = e.target.value === "" ? 0 : parseFloat(e.target.value); setKey("punctualityBonus", { enabled: draft.punctualityBonus?.enabled ?? true, bonusPerHour: Number.isNaN(v) ? 0 : Math.max(0, v), label: draft.punctualityBonus?.label ?? "Weekly Punctuality Bonus" }); }}
                  data-testid="input-override-punctualityBonus"
                />
                <span className="text-xs text-muted-foreground">/hr</span>
              </div>
            </PayrollRuleRow>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft({ ...(data?.overrides ?? {}) }); }} data-testid="button-cancel-payroll-rules">Cancel</Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-payroll-rules">
                <Save className="h-3.5 w-3.5 mr-1" /> {save.isPending ? "Saving…" : "Save rules"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type PolicyLite = { id: string; name: string; policyTypeId: string; status: string };
type PolicyTypeLite = { id: string; key: string; name: string };
type PolicyAssignmentLite = { id: string; policyId: string; userId: string | null };

// Assign/remove a policy for THIS employee at the employee level, from the
// profile (instead of the policy's own Assign button). Covers all policy types.
function PolicyAssignmentManager({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [selectedPolicyId, setSelectedPolicyId] = useState("");

  const { data: policies = [] } = useQuery<PolicyLite[]>({ queryKey: ["/api/policies"] });
  const { data: policyTypes = [] } = useQuery<PolicyTypeLite[]>({ queryKey: ["/api/policy-types"] });
  const { data: directAssignments = [] } = useQuery<PolicyAssignmentLite[]>({
    queryKey: ["/api/policy-assignments", { userId }],
    queryFn: async () => {
      const res = await fetch(`/api/policy-assignments?userId=${userId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load this employee's policy assignments");
      return res.json();
    },
  });

  const typeKeyById = new Map(policyTypes.map((t) => [t.id, t.key]));
  const policyById = new Map(policies.map((p) => [p.id, p]));
  const typeLabel = (policyTypeId: string) => {
    const key = typeKeyById.get(policyTypeId);
    return key ? (POLICY_TYPE_LABELS[key] || key) : "Policy";
  };

  const assignedPolicyIds = new Set(directAssignments.map((a) => a.policyId));
  // Active policies not already assigned to this person, sorted by type then name.
  const assignable = policies
    .filter((p) => p.status === "active" && !assignedPolicyIds.has(p.id))
    .sort((a, b) => typeLabel(a.policyTypeId).localeCompare(typeLabel(b.policyTypeId)) || a.name.localeCompare(b.name));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/policy-assignments", { userId }] });
    queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "applicable-policies"] });
  };

  const assignMutation = useMutation({
    mutationFn: async (policyId: string) => {
      await apiRequest("POST", "/api/policy-assignments", { policyId, userId });
    },
    onSuccess: () => { setSelectedPolicyId(""); invalidate(); toast({ title: "Policy assigned to this employee" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      await apiRequest("DELETE", `/api/policy-assignments/${assignmentId}`);
    },
    onSuccess: () => { invalidate(); toast({ title: "Removed" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const selectedIsPayroll = selectedPolicyId
    ? typeKeyById.get(policyById.get(selectedPolicyId)?.policyTypeId ?? "") === "payroll"
    : false;

  return (
    <Card data-testid="card-assign-policy">
      <CardHeader>
        <CardTitle>Assigned to this employee</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Attach a policy directly to this person (payroll, attendance, or PTO). An employee-level
          assignment is the most specific, so for its type it <strong>replaces</strong> any company/
          location/department/role policy for them.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {directAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-direct-assignments">
            No policies assigned directly to this employee.
          </p>
        ) : (
          <div className="space-y-2" data-testid="list-direct-assignments">
            {directAssignments.map((a) => {
              const p = policyById.get(a.policyId);
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-2" data-testid={`row-direct-assignment-${a.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0">{p ? typeLabel(p.policyTypeId) : "Policy"}</Badge>
                    <span className="font-medium truncate">{p?.name ?? "(unknown policy)"}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMutation.mutate(a.id)}
                    disabled={removeMutation.isPending}
                    data-testid={`button-remove-assignment-${a.id}`}
                  >
                    <X className="h-4 w-4 mr-1" /> Remove
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="flex-1 min-w-[240px] space-y-1">
            <Label className="text-xs text-muted-foreground">Assign a policy</Label>
            <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId}>
              <SelectTrigger data-testid="select-assign-policy">
                <SelectValue placeholder="Pick a policy…" />
              </SelectTrigger>
              <SelectContent>
                {assignable.length === 0 ? (
                  <SelectItem value="__none__" disabled>No more policies to assign</SelectItem>
                ) : (
                  assignable.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{typeLabel(p.policyTypeId)} · {p.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => assignMutation.mutate(selectedPolicyId)}
            disabled={!selectedPolicyId || assignMutation.isPending}
            data-testid="button-assign-policy"
          >
            {assignMutation.isPending ? "Assigning…" : "Assign"}
          </Button>
        </div>
        {selectedIsPayroll && (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-payroll-replace-warning">
            Heads up: this is a <strong>payroll</strong> policy — assigning it makes it this employee's entire
            payroll policy (overtime, pay period, bonuses, etc.), replacing whatever applied before.
          </p>
        )}
      </CardContent>
    </Card>
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

// Note #3: edit a manager's "hats" — each row is a (location?, department?)
// scope. The manager sees the UNION of their hats. "All" on a dimension means
// unconstrained (all locations / all departments).
type ManagerHat = { locationId: string; departmentId: string };

type EmployeeDowBonus = {
  id: string;
  dayOfWeek: number;
  minHoursThreshold: number;
  bonusType: "money" | "hours";
  bonusAmount: number;
};

const DOW_BONUS_DAYS: { value: number; label: string }[] = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

// Per-employee day-of-week bonuses, edited on the profile Pay Setup tab. Added
// ON TOP of any policy bonus (additive). Saved to the employment profile.
function EmployeeBonusesCard({ userId, bonuses, canEdit }: { userId: string; bonuses: EmployeeDowBonus[]; canEdit: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EmployeeDowBonus[]>(bonuses);

  useEffect(() => {
    if (!editing) setRows(bonuses);
  }, [bonuses, editing]);

  const usedDays = new Set(rows.map((r) => r.dayOfWeek));
  const dayLabel = (d: number) => DOW_BONUS_DAYS.find((o) => o.value === d)?.label ?? String(d);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/employment-profiles/${userId}`, { dayOfWeekBonuses: rows });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-profiles"] });
      setEditing(false);
      toast({ title: "Bonuses saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/review-rules", userId] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addRow = () => {
    const firstFree = DOW_BONUS_DAYS.find((o) => !usedDays.has(o.value));
    if (!firstFree) return;
    setRows((prev) => [
      ...prev,
      { id: `dow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dayOfWeek: firstFree.value, minHoursThreshold: 0, bonusType: "money", bonusAmount: 0 },
    ]);
  };
  const patchRow = (id: string, patch: Partial<EmployeeDowBonus>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const hasDuplicateDay = new Set(rows.map((r) => r.dayOfWeek)).size !== rows.length;
  const hasInvalid = rows.some((r) => !(r.bonusAmount > 0) || r.minHoursThreshold < 0);

  return (
    <Card data-testid="card-employee-bonuses">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Day-of-Week Bonuses</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Extra pay for this employee on a specific day (e.g. a Sunday bonus). Added on top of any
            company policy bonus. Set “Min Hours” to 0 to cover any time worked that day.
          </p>
        </div>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-edit-employee-bonuses">
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing ? (
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-employee-bonuses">No bonuses set for this employee.</p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="list-employee-bonuses">
              {rows.map((b) => (
                <Badge key={b.id} variant="outline" className="text-sm">
                  {dayLabel(b.dayOfWeek)} ≥ {b.minHoursThreshold}h →{" "}
                  {b.bonusType === "money" ? `$${(b.bonusAmount || 0).toFixed(2)}` : `+${b.bonusAmount}h`}
                </Badge>
              ))}
            </div>
          )
        ) : (
          <>
            {rows.map((b) => (
              <div key={b.id} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-2 rounded-md border bg-muted/30" data-testid={`row-employee-bonus-${b.id}`}>
                <div>
                  <Label className="text-xs">Day</Label>
                  <Select value={String(b.dayOfWeek)} onValueChange={(v) => patchRow(b.id, { dayOfWeek: parseInt(v, 10) })}>
                    <SelectTrigger data-testid={`select-employee-bonus-day-${b.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOW_BONUS_DAYS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)} disabled={o.value !== b.dayOfWeek && usedDays.has(o.value)}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Min Hours</Label>
                  <Input type="number" min={0} step="0.25" value={b.minHoursThreshold}
                    onChange={(e) => { const v = e.target.value === "" ? 0 : parseFloat(e.target.value); patchRow(b.id, { minHoursThreshold: Number.isNaN(v) ? 0 : Math.max(0, v) }); }}
                    data-testid={`input-employee-bonus-threshold-${b.id}`} />
                </div>
                <div>
                  <Label className="text-xs">Bonus Type</Label>
                  <Select value={b.bonusType} onValueChange={(v) => patchRow(b.id, { bonusType: v as "money" | "hours" })}>
                    <SelectTrigger data-testid={`select-employee-bonus-type-${b.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="money">Extra Money ($)</SelectItem>
                      <SelectItem value="hours">Extra Paid Hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" min={0} step="0.01" value={b.bonusAmount}
                    onChange={(e) => { const v = e.target.value === "" ? 0 : parseFloat(e.target.value); patchRow(b.id, { bonusAmount: Number.isNaN(v) ? 0 : Math.max(0, v) }); }}
                    data-testid={`input-employee-bonus-amount-${b.id}`} />
                </div>
                <div className="flex items-center justify-end">
                  <Button variant="ghost" size="icon" onClick={() => removeRow(b.id)} data-testid={`button-remove-employee-bonus-${b.id}`}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {hasDuplicateDay && <p className="text-xs text-destructive">Only one bonus per day is allowed.</p>}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={addRow} disabled={rows.length >= 7} data-testid="button-add-employee-bonus">
                <Plus className="h-4 w-4 mr-1" /> Add bonus
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || hasDuplicateDay || hasInvalid} data-testid="button-save-employee-bonuses">
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setRows(bonuses); setEditing(false); }} data-testid="button-cancel-employee-bonuses">
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ManagerScopeEditor({ userId }: { userId: string }) {
  const { toast } = useToast();
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: departments = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: scopeData } = useQuery<{ scopes: Array<{ id: string; locationId: string | null; departmentId: string | null }> }>({
    queryKey: ["/api/users", userId, "manager-scopes"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/manager-scopes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load management scope");
      return res.json();
    },
  });

  const [hats, setHats] = useState<ManagerHat[]>([]);
  useEffect(() => {
    if (scopeData?.scopes) {
      setHats(scopeData.scopes.map((s) => ({ locationId: s.locationId || "", departmentId: s.departmentId || "" })));
    }
  }, [scopeData]);

  const locName = (id: string) => locations.find((l) => l.id === id)?.name || "that location";
  const deptName = (id: string) => departments.find((d) => d.id === id)?.name || "that department";
  const describeHat = (h: ManagerHat) => {
    if (h.locationId && h.departmentId) return `${deptName(h.departmentId)} at ${locName(h.locationId)}`;
    if (h.locationId) return `Everyone at ${locName(h.locationId)} (all departments)`;
    if (h.departmentId) return `${deptName(h.departmentId)} across all locations`;
    return "Pick a location and/or department";
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scopes = hats
        .map((h) => ({ locationId: h.locationId || null, departmentId: h.departmentId || null }))
        .filter((h) => h.locationId || h.departmentId);
      await apiRequest("PUT", `/api/users/${userId}/manager-scopes`, { scopes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "manager-scopes"] });
      toast({ title: "Management scope updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const setHat = (i: number, patch: Partial<ManagerHat>) =>
    setHats((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));

  return (
    <Card data-testid="card-manager-scope">
      <CardHeader>
        <CardTitle>Management Scope</CardTitle>
        <p className="text-sm text-muted-foreground">
          What this manager can see. Each row is one "hat" — the manager sees the
          sum of all rows. Leave a location or department as "All" to cover every
          one. Example: <em>All of Sumner</em> plus <em>Vision at Kingston</em>.
          With no rows, the manager falls back to their own department memberships.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {hats.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-no-manager-scopes">
            No scopes set.
          </p>
        )}
        {hats.map((h, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2" data-testid={`manager-scope-row-${i}`}>
            <Select value={h.locationId || "all"} onValueChange={(v) => setHat(i, { locationId: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[200px]" data-testid={`select-scope-location-${i}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={h.departmentId || "all"} onValueChange={(v) => setHat(i, { departmentId: v === "all" ? "" : v })}>
              <SelectTrigger className="w-[200px]" data-testid={`select-scope-department-${i}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground flex-1 min-w-[160px]">{describeHat(h)}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHats((prev) => prev.filter((_, idx) => idx !== i))}
              data-testid={`button-remove-scope-${i}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHats((prev) => [...prev, { locationId: "", departmentId: "" }])}
            data-testid="button-add-scope"
          >
            <Plus className="h-4 w-4 mr-1" /> Add scope
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-manager-scope"
          >
            Save scope
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Lock / unlock an account's ability to make edits (chain of command). Shown to
// owners and managers; the server enforces who may actually lock/unlock.
function LockAccountButton({ userId, locked }: { userId: string; locked: boolean }) {
  const { toast } = useToast();
  const { user: viewer } = useAuth();
  const canSee = viewer?.role === "admin" || viewer?.role === "manager";
  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/users/${userId}/${locked ? "unlock" : "lock"}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: locked ? "Account unlocked" : "Account locked" });
    },
    onError: (err: Error) => toast({ title: "Couldn't change lock", description: err.message, variant: "destructive" }),
  });
  if (!canSee) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      data-testid="button-lock-account"
      title={locked ? "Unlock this account's editing" : "Lock this account from editing"}
    >
      {locked ? <LockOpen className="h-4 w-4 mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
      {locked ? "Unlock" : "Lock"}
    </Button>
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

function formatTime12(time: string): string {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  const hour = parseInt(hStr, 10);
  const minute = parseInt(mStr, 10);
  if (isNaN(hour) || isNaN(minute)) return time;
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mStr.padStart(2, "0")} ${period}`;
}

function ScheduleTab({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(
    DAY_NAMES.map((_, i) => ({ dayOfWeek: i, startTime: "09:00", endTime: "17:00", isActive: false }))
  );
  const [isEditing, setIsEditing] = useState(false);
  const snapshotRef = useRef<ScheduleEntry[] | null>(null);

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
      snapshotRef.current = null;
      setIsEditing(false);
      toast({ title: "Schedule Saved", description: "Employee work schedule has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save schedule.", variant: "destructive" });
    },
  });

  const startEditing = () => {
    snapshotRef.current = schedule.map((d) => ({ ...d }));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    if (snapshotRef.current) {
      setSchedule(snapshotRef.current.map((d) => ({ ...d })));
      snapshotRef.current = null;
    }
    setIsEditing(false);
  };

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
      snapshotRef.current = null;
      setIsEditing(false);
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
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={cancelEditing} disabled={saveMutation.isPending} data-testid="button-cancel-schedule">
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-schedule">
              {saveMutation.isPending ? "Saving..." : "Save Schedule"}
            </Button>
          </div>
        ) : (
          <Button onClick={startEditing} data-testid="button-edit-schedule">
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {schedule.map((day) => {
            const dayTemplateId = templateIdsByDay.get(day.dayOfWeek) ?? null;
            const isCustomized = sharedTemplateId !== null && dayTemplateId === null && day.isActive;
            return (
              <div key={day.dayOfWeek} className="flex items-center gap-4 p-3 rounded-lg border" data-testid={`schedule-day-${day.dayOfWeek}`}>
                {isEditing ? (
                  <button
                    type="button"
                    onClick={() => toggleDay(day.dayOfWeek)}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${day.isActive ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"}`}
                    data-testid={`toggle-day-${day.dayOfWeek}`}
                  >
                    {day.isActive && <CheckCircle2 className="h-4 w-4" />}
                  </button>
                ) : (
                  <div
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center ${day.isActive ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"}`}
                    data-testid={`indicator-day-${day.dayOfWeek}`}
                  >
                    {day.isActive && <CheckCircle2 className="h-4 w-4" />}
                  </div>
                )}
                <span className="w-28 font-medium" data-testid={`text-day-name-${day.dayOfWeek}`}>{DAY_NAMES[day.dayOfWeek]}</span>
                {isEditing ? (
                  day.isActive ? (
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
                  )
                ) : day.isActive ? (
                  <span className="text-sm" data-testid={`text-day-hours-${day.dayOfWeek}`}>
                    {formatTime12(day.startTime)} – {formatTime12(day.endTime)}
                  </span>
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
  const { data: suggestions } = useQuery<Array<{ templateId: string; templateName: string; score: number; reasons: string[] }>>({
    queryKey: ["/api/lifecycle/suggest-templates", userId, "onboarding"],
    queryFn: async () => {
      const r = await fetch(`/api/lifecycle/suggest-templates/${userId}?kind=onboarding`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const [templateId, setTemplateId] = useState<string>("");
  const [hireDate, setHireDate] = useState<string>("");
  useEffect(() => {
    if (!templateId && suggestions && suggestions.length > 0) setTemplateId(suggestions[0].templateId);
  }, [suggestions, templateId]);
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
  const { has } = usePermissions();
  // Mirror deactivation (which requires users.edit) so whoever can offboard an
  // employee can also reinstate them.
  const canReinstate = has("users.edit");
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
  const [deactivateReason, setDeactivateReason] = useState<string>("");

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
    mutationFn: async () => checklist ? apiRequest("POST", `/api/offboarding-checklists/${checklist.id}/deactivate`, deactivateReason ? { terminationReason: deactivateReason } : {}) : Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offboarding-checklists/by-employee", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setConfirmOpen(false);
      setDeactivateReason("");
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

  const reactivateMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/users/${userId}/reactivate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/offboarding-checklists/by-employee", userId] });
      toast({ title: "Employee reinstated", description: "The account is active again." });
    },
    onError: (e: unknown) => toast({ title: "Failed to reinstate", description: getErrorMessage(e), variant: "destructive" }),
  });

  // When an employee is deactivated, offer a one-click reinstate (clears the
  // termination so they're active again). Available to anyone who can edit
  // users, matching who can deactivate.
  const reinstateButton = canReinstate && user?.deactivatedAt ? (
    <Button
      variant="default"
      size="sm"
      onClick={() => reactivateMut.mutate()}
      disabled={reactivateMut.isPending}
      data-testid="button-reinstate-employee"
    >
      {reactivateMut.isPending ? "Reinstating..." : "Reinstate employee"}
    </Button>
  ) : null;

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (!checklist) {
    const isDeactivated = !!user?.deactivatedAt;
    return (
      <Card data-testid="card-offboarding-tab">
        <CardHeader><CardTitle>Offboarding</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isDeactivated && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-destructive">This account is deactivated.</p>
              {reinstateButton}
            </div>
          )}
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
            {reinstateButton}
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
                  <div className="space-y-1.5">
                    <Label htmlFor="deactivate-reason">Reason</Label>
                    <Select value={deactivateReason} onValueChange={setDeactivateReason}>
                      <SelectTrigger id="deactivate-reason" data-testid="select-termination-reason"><SelectValue placeholder="Select a reason (optional)" /></SelectTrigger>
                      <SelectContent>
                        {TERMINATION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
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
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

function EmployeeAuditHistory({ userId }: { userId: string }) {
  return (
    <div className="space-y-6" data-testid="employee-history-tab">
      <EmployeeTimesheetCard userId={userId} />
      <IdentityHistoryCard userId={userId} />
      <EmployeeLedgerTable userId={userId} />
      <EmployeeAuditLogTable userId={userId} />
    </div>
  );
}

const LEDGER_PAGE_SIZE = 25;

type LedgerEntry = {
  id: number;
  sequence: number;
  category: string;
  eventType: string;
  entityType: string;
  workDate: string | null;
  hoursDelta: number | null;
  source: string | null;
  createdAt: string | null;
};

type EmployeeLedgerResponse = { entries: LedgerEntry[]; total: number };

const LEDGER_CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "attendance", label: "Attendance" },
  { value: "hours", label: "Hours" },
  { value: "pto", label: "PTO" },
  { value: "payroll", label: "Payroll" },
];

const LEDGER_CATEGORY_LABELS: Record<string, string> = {
  attendance: "Attendance",
  hours: "Hours",
  pto: "PTO",
  payroll: "Payroll",
};

function formatLedgerEvent(eventType: string): string {
  return eventType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function EmployeeLedgerTable({ userId }: { userId: string }) {
  const [category, setCategory] = useState("all");
  const [pageSize, setPageSize] = useState(LEDGER_PAGE_SIZE);

  const { data, isLoading } = useQuery<EmployeeLedgerResponse>({
    queryKey: ["/api/ledger/employee", userId, category, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: "0" });
      if (category !== "all") params.set("category", category);
      const res = await fetch(
        `/api/ledger/employee/${userId}?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load ledger");
      return res.json();
    },
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const hasMore = entries.length < total;

  return (
    <Card data-testid="card-ledger-history">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>Attendance &amp; Payroll Ledger</CardTitle>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setPageSize(LEDGER_PAGE_SIZE);
          }}
        >
          <SelectTrigger className="w-[180px]" data-testid="select-ledger-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEDGER_CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`option-ledger-category-${opt.value}`}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground text-center py-4" data-testid="text-no-ledger">No ledger entries found.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Category</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Event</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Work date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Hours Δ</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-ledger-${entry.id}`}>
                    <TableCell className="align-top">
                      {LEDGER_CATEGORY_LABELS[entry.category] || entry.category}
                    </TableCell>
                    <TableCell className="font-medium align-top" data-testid={`text-ledger-event-${entry.id}`}>
                      {formatLedgerEvent(entry.eventType)}
                    </TableCell>
                    <TableCell className="align-top">{entry.workDate || "—"}</TableCell>
                    <TableCell className="align-top text-right" data-testid={`text-ledger-delta-${entry.id}`}>
                      {entry.hoursDelta === null || entry.hoursDelta === undefined
                        ? "—"
                        : `${entry.hoursDelta > 0 ? "+" : ""}${entry.hoursDelta.toFixed(2)}`}
                    </TableCell>
                    <TableCell className="align-top">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-3">
              <span data-testid="text-ledger-count">
                Showing {entries.length} of {total}
              </span>
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageSize((c) => c + LEDGER_PAGE_SIZE)}
                  data-testid="button-ledger-load-more"
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

const IDENTITY_FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
};

function formatIdentityValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function describeIdentityChange(log: AuditLogEntry): {
  fields: string[];
  rows: { field: string; from: string; to: string }[];
} {
  const oldV = (log.oldValue || {}) as Record<string, unknown>;
  const newV = (log.newValue || {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(oldV), ...Object.keys(newV)]));
  const rows = keys.map((k) => ({
    field: IDENTITY_FIELD_LABELS[k] || k,
    from: formatIdentityValue(oldV[k]),
    to: formatIdentityValue(newV[k]),
  }));
  return { fields: rows.map((r) => r.field), rows };
}

function IdentityHistoryCard({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery<EmployeeAuditResponse>({
    queryKey: ["/api/audit-logs/employee", userId, "identity"],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit-logs/employee/${userId}?limit=200&offset=0`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load identity history");
      return res.json();
    },
  });

  const identityLogs = (data?.logs || [])
    .filter((l) => l.action === "user.identity_change")
    .slice(0, 5);

  if (isLoading) {
    return (
      <Card data-testid="card-identity-history">
        <CardHeader><CardTitle>Identity history</CardTitle></CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (identityLogs.length === 0) {
    return (
      <Card data-testid="card-identity-history">
        <CardHeader><CardTitle>Identity history</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm" data-testid="text-no-identity-changes">
            No name or email changes recorded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-identity-history">
      <CardHeader><CardTitle>Identity history</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {identityLogs.map((log) => {
            const { rows } = describeIdentityChange(log);
            return (
              <li
                key={log.id}
                className="border-l-2 border-primary/40 pl-3"
                data-testid={`identity-change-${log.id}`}
              >
                <div className="text-xs text-muted-foreground mb-1">
                  {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                </div>
                <div className="space-y-1 text-sm">
                  {rows.map((r) => (
                    <div key={r.field} data-testid={`identity-change-row-${log.id}-${r.field}`}>
                      <span className="font-medium">{r.field}:</span>{" "}
                      <span className="text-muted-foreground line-through">{r.from}</span>
                      <span className="mx-2">→</span>
                      <span>{r.to}</span>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
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
                {logs.map((log) => {
                  const isIdentity = log.action === "user.identity_change";
                  const identity = isIdentity ? describeIdentityChange(log) : null;
                  const onlyEmail =
                    identity &&
                    identity.fields.length === 1 &&
                    identity.fields[0] === "Email";
                  const onlyName =
                    identity &&
                    identity.fields.every((f) => f === "First name" || f === "Last name");
                  const label = isIdentity
                    ? onlyEmail
                      ? "Email changed"
                      : onlyName
                        ? "Name changed"
                        : "Name & email changed"
                    : log.action;
                  return (
                    <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                      <TableCell className="font-medium align-top">
                        <div>{label}</div>
                        {identity && (
                          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                            {identity.rows.map((r) => (
                              <div key={r.field}>
                                {r.field}:{" "}
                                <span className="line-through">{r.from}</span>
                                <span className="mx-1">→</span>
                                <span className="text-foreground">{r.to}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">{log.targetType}</TableCell>
                      <TableCell className="align-top">{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  );
                })}
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

