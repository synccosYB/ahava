import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { CalendarDays, Plus, Pencil, Settings, Search, AlertTriangle, Check, X, Filter, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import type { PtoPolicy, User, Division, Department, Location, AttendanceException, PtoAnniversaryAdjustment } from "@shared/schema";
import { parseExceptionTimeInfo, buildTimeCorrectionPayload } from "@/lib/exceptionTimeInfo";
import { useAuth } from "@/hooks/use-auth";
import { formatTime12 } from "@/lib/utils";

type PtoBalanceEntry = {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  departmentId: string | null;
  departmentName: string;
  profileImageUrl: string | null;
  managerNames: string[];
  vacation: { total: number; used: number; pending: number };
  sick: { total: number; used: number; pending: number };
  personal: { total: number; used: number; pending: number };
};

type EnrichedException = AttendanceException & {
  employeeName?: string;
  reviewerName?: string;
  departmentName?: string | null;
  locationName?: string | null;
};

type AlertsExceptionsFilters = {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  departmentFilter: string;
  setDepartmentFilter: (v: string) => void;
  locationFilter: string;
  setLocationFilter: (v: string) => void;
  employeeSearch: string;
  setEmployeeSearch: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  reset: () => void;
};

const ALERTS_EXCEPTIONS_FILTERS_STORAGE_KEY = "pto-leave:alerts-exceptions-filters:v1";

type PersistedAlertsExceptionsFilters = {
  statusFilter: string;
  typeFilter: string;
  departmentFilter: string;
  locationFilter: string;
  employeeSearch: string;
  dateFrom: string;
  dateTo: string;
};

const ALERTS_EXCEPTIONS_FILTER_DEFAULTS: PersistedAlertsExceptionsFilters = {
  statusFilter: "pending",
  typeFilter: "all",
  departmentFilter: "all",
  locationFilter: "all",
  employeeSearch: "",
  dateFrom: "",
  dateTo: "",
};

function readPersistedAlertsExceptionsFilters(): PersistedAlertsExceptionsFilters {
  if (typeof window === "undefined") return ALERTS_EXCEPTIONS_FILTER_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(ALERTS_EXCEPTIONS_FILTERS_STORAGE_KEY);
    if (!raw) return ALERTS_EXCEPTIONS_FILTER_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedAlertsExceptionsFilters> | null;
    if (!parsed || typeof parsed !== "object") return ALERTS_EXCEPTIONS_FILTER_DEFAULTS;
    const pickString = (value: unknown, fallback: string) =>
      typeof value === "string" ? value : fallback;
    return {
      statusFilter: pickString(parsed.statusFilter, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.statusFilter),
      typeFilter: pickString(parsed.typeFilter, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.typeFilter),
      departmentFilter: pickString(parsed.departmentFilter, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.departmentFilter),
      locationFilter: pickString(parsed.locationFilter, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.locationFilter),
      employeeSearch: pickString(parsed.employeeSearch, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.employeeSearch),
      dateFrom: pickString(parsed.dateFrom, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.dateFrom),
      dateTo: pickString(parsed.dateTo, ALERTS_EXCEPTIONS_FILTER_DEFAULTS.dateTo),
    };
  } catch {
    return ALERTS_EXCEPTIONS_FILTER_DEFAULTS;
  }
}

function useAlertsExceptionsFilters(): AlertsExceptionsFilters {
  const initialRef = useRef<PersistedAlertsExceptionsFilters | null>(null);
  if (initialRef.current === null) {
    initialRef.current = readPersistedAlertsExceptionsFilters();
  }
  const initial = initialRef.current;

  const [statusFilter, setStatusFilter] = useState(initial.statusFilter);
  const [typeFilter, setTypeFilter] = useState(initial.typeFilter);
  const [departmentFilter, setDepartmentFilter] = useState(initial.departmentFilter);
  const [locationFilter, setLocationFilter] = useState(initial.locationFilter);
  const [employeeSearch, setEmployeeSearch] = useState(initial.employeeSearch);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: PersistedAlertsExceptionsFilters = {
        statusFilter,
        typeFilter,
        departmentFilter,
        locationFilter,
        employeeSearch,
        dateFrom,
        dateTo,
      };
      window.localStorage.setItem(
        ALERTS_EXCEPTIONS_FILTERS_STORAGE_KEY,
        JSON.stringify(payload),
      );
    } catch {
      // Ignore quota or access errors; filters simply won't persist.
    }
  }, [statusFilter, typeFilter, departmentFilter, locationFilter, employeeSearch, dateFrom, dateTo]);

  const reset = () => {
    setStatusFilter(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.statusFilter);
    setTypeFilter(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.typeFilter);
    setDepartmentFilter(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.departmentFilter);
    setLocationFilter(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.locationFilter);
    setEmployeeSearch(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.employeeSearch);
    setDateFrom(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.dateFrom);
    setDateTo(ALERTS_EXCEPTIONS_FILTER_DEFAULTS.dateTo);
  };
  return {
    statusFilter, setStatusFilter,
    typeFilter, setTypeFilter,
    departmentFilter, setDepartmentFilter,
    locationFilter, setLocationFilter,
    employeeSearch, setEmployeeSearch,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    reset,
  };
}

export default function PtoLeavePage() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialTab = urlParams.get("tab") || "balances";

  const { data: pendingExceptions } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });
  const pendingCount = pendingExceptions?.length || 0;

  const alertsFilters = useAlertsExceptionsFilters();

  return (
    <div className="max-w-5xl space-y-6" data-testid="pto-leave-page">
      <PageHeader title="PTO & Leave" subtitle="Manage time-off policies, employee settings, and attendance exceptions" />
      <Tabs defaultValue={initialTab} data-testid="tabs-pto">
        <TabsList>
          <TabsTrigger value="balances" data-testid="tab-balances">PTO Balances</TabsTrigger>
          <TabsTrigger value="policies" data-testid="tab-policies">Policies</TabsTrigger>
          <TabsTrigger value="employee-settings" data-testid="tab-employee-settings">Employee Settings</TabsTrigger>
          <TabsTrigger value="alerts-exceptions" data-testid="tab-alerts-exceptions" className="flex items-center gap-1.5">
            Alerts & Exceptions
            {pendingCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-[20px] px-1.5 text-[10px]" data-testid="badge-tab-pending-count">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="anniversary-history" data-testid="tab-anniversary-history">Anniversary History</TabsTrigger>
        </TabsList>
        <TabsContent value="balances"><PtoBalancesTab /></TabsContent>
        <TabsContent value="policies"><PoliciesTab /></TabsContent>
        <TabsContent value="employee-settings"><EmployeePtoTab /></TabsContent>
        <TabsContent value="alerts-exceptions"><AlertsExceptionsTab filters={alertsFilters} /></TabsContent>
        <TabsContent value="anniversary-history"><AnniversaryHistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function PtoBalanceBar({ used, pending, total, color }: { used: number; pending: number; total: number; color: string }) {
  const safeTot = Math.max(total, 1);
  const usedPct = Math.min((used / safeTot) * 100, 100);
  const pendPct = Math.min((pending / safeTot) * 100, 100 - usedPct);
  const remaining = Math.max(total - used - pending, 0);

  const colorClasses: Record<string, { bar: string; pending: string; text: string }> = {
    blue: { bar: "bg-blue-600", pending: "bg-blue-300", text: "text-blue-600" },
    red: { bar: "bg-red-600", pending: "bg-red-300", text: "text-red-600" },
    purple: { bar: "bg-purple-600", pending: "bg-purple-300", text: "text-purple-600" },
  };
  const c = colorClasses[color] || colorClasses.blue;

  return (
    <div>
      <div className="h-2 rounded-full bg-muted overflow-hidden flex">
        <div className={`${c.bar} rounded-full`} style={{ width: `${usedPct}%` }} />
        <div className={c.pending} style={{ width: `${pendPct}%` }} />
      </div>
      <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
        <span><span className={`${c.text} font-bold`}>{used}</span> hrs used</span>
        {pending > 0 && <span><span className={`${c.text} opacity-60 font-bold`}>{pending}</span> hrs pending</span>}
        <span><span className="font-bold text-foreground">{remaining}</span> hrs remaining</span>
        <span className="ml-auto">{total} hrs total</span>
      </div>
    </div>
  );
}

function PtoBalancesTab() {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");

  const { data: balances, isLoading } = useQuery<PtoBalanceEntry[]>({
    queryKey: ["/api/pto-balances/all"],
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const filtered = (balances || []).filter(b => {
    const matchSearch = !search || `${b.firstName} ${b.lastName}`.toLowerCase().includes(search.toLowerCase());
    const matchDept = deptFilter === "all" || b.departmentId === deptFilter;
    return matchSearch && matchDept;
  });

  return (
    <div className="space-y-4 mt-4" data-testid="pto-balances-tab">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative flex-1 min-w-[200px] max-w-[280px]">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1 block">Search Employee</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name..."
              className="pl-9"
              data-testid="input-pto-search"
            />
          </div>
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1 block">Department</Label>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger data-testid="select-pto-dept-filter">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {(departments || []).map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-balances">
            No employees found matching your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(emp => {
            const initials = ((emp.firstName?.[0] || "") + (emp.lastName?.[0] || "")).toUpperCase();
            return (
              <Card key={emp.userId} data-testid={`card-pto-balance-${emp.userId}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-4 mb-4 flex-wrap">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={emp.profileImageUrl || undefined} />
                      <AvatarFallback className="text-sm font-bold">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-[150px]">
                      <div className="font-bold text-sm" data-testid={`text-pto-name-${emp.userId}`}>
                        {emp.firstName} {emp.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground" data-testid={`text-pto-info-${emp.userId}`}>
                        {emp.role} &middot; {emp.departmentName}
                        {emp.managerNames && emp.managerNames.length > 0 && (
                          <span className="ml-1">&middot; Mgr: {emp.managerNames.join(", ")}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {([
                        ["Vacation", emp.vacation, "blue"],
                        ["Sick", emp.sick, "red"],
                        ["Personal", emp.personal, "purple"],
                      ] as const).map(([label, bal, color]) => {
                        const remaining = Math.max(bal.total - bal.used - bal.pending, 0);
                        const borderColor = color === "blue" ? "border-blue-200 bg-blue-50" : color === "red" ? "border-red-200 bg-red-50" : "border-purple-200 bg-purple-50";
                        const textColor = color === "blue" ? "text-blue-600" : color === "red" ? "text-red-600" : "text-purple-600";
                        return (
                          <div key={label} className={`border rounded-lg px-3 py-1.5 text-center ${borderColor}`}>
                            <div className={`text-lg font-black ${textColor}`}>{remaining}<span className="text-[10px] font-medium ml-0.5">hrs</span></div>
                            <div className="text-[10px] text-muted-foreground">{label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([
                      ["Vacation", emp.vacation, "blue"],
                      ["Sick", emp.sick, "red"],
                      ["Personal", emp.personal, "purple"],
                    ] as const).map(([label, bal, color]) => (
                      <div key={label}>
                        <div className={`text-xs font-bold mb-1 ${color === "blue" ? "text-blue-600" : color === "red" ? "text-red-600" : "text-purple-600"}`}>
                          {label}
                        </div>
                        <PtoBalanceBar used={bal.used} pending={bal.pending} total={bal.total} color={color} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PoliciesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", description: "", accrualType: "annual", accrualHoursPerYear: "120",
    yearlyCapHours: "", carryoverCapHours: "0", waitingPeriodDays: "0",
    sickAccrualEnabled: true, personalHoursPerYear: "40",
    holidayPayEnabled: true, isDefault: false, expirationDate: "",
    vacationAccrualPerHoursWorked: "30", vacationAccrualHoursPerThreshold: "1",
  });

  const { data: policies, isLoading } = useQuery<PtoPolicy[]>({ queryKey: ["/api/pto-policies"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        accrualType: form.accrualType,
        accrualHoursPerYear: parseFloat(form.accrualHoursPerYear) || 120,
        yearlyCapHours: form.yearlyCapHours ? parseFloat(form.yearlyCapHours) : null,
        carryoverCapHours: parseFloat(form.carryoverCapHours) || 0,
        waitingPeriodDays: parseInt(form.waitingPeriodDays) || 0,
        sickAccrualEnabled: form.sickAccrualEnabled,
        personalHoursPerYear: parseFloat(form.personalHoursPerYear) || 40,
        holidayPayEnabled: form.holidayPayEnabled,
        isDefault: form.isDefault,
        expirationDate: form.expirationDate || null,
        companyId: divisions?.[0]?.id || null,
      };

      if (form.accrualType === "per_hours_worked") {
        const perHours = parseFloat(form.vacationAccrualPerHoursWorked);
        const earned = parseFloat(form.vacationAccrualHoursPerThreshold);
        if (!Number.isFinite(perHours) || perHours <= 0) {
          throw new Error("\"Hours worked per accrual\" must be a number greater than 0.");
        }
        if (!Number.isFinite(earned) || earned < 0) {
          throw new Error("\"PTO hours earned per threshold\" must be a number greater than or equal to 0.");
        }
        payload.vacationAccrualPerHoursWorked = perHours;
        payload.vacationAccrualHoursPerThreshold = earned;
      }
      if (editingId) {
        await apiRequest("PATCH", `/api/pto-policies/${editingId}`, payload);
      } else {
        await apiRequest("POST", "/api/pto-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pto-policies"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editingId ? "Policy updated" : "Policy created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({
      name: "", description: "", accrualType: "annual", accrualHoursPerYear: "120",
      yearlyCapHours: "", carryoverCapHours: "0", waitingPeriodDays: "0",
      sickAccrualEnabled: true, personalHoursPerYear: "40",
      holidayPayEnabled: true, isDefault: false, expirationDate: "",
      vacationAccrualPerHoursWorked: "30", vacationAccrualHoursPerThreshold: "1",
    });
    setEditingId(null);
  };

  const startEdit = (p: PtoPolicy) => {
    setForm({
      name: p.name,
      description: p.description || "",
      accrualType: p.accrualType,
      accrualHoursPerYear: String(p.accrualHoursPerYear),
      yearlyCapHours: p.yearlyCapHours ? String(p.yearlyCapHours) : "",
      carryoverCapHours: String(p.carryoverCapHours || 0),
      waitingPeriodDays: String(p.waitingPeriodDays || 0),
      sickAccrualEnabled: p.sickAccrualEnabled,
      personalHoursPerYear: String(p.personalHoursPerYear),
      holidayPayEnabled: p.holidayPayEnabled,
      isDefault: p.isDefault,
      expirationDate: p.expirationDate || "",
      vacationAccrualPerHoursWorked: String(p.vacationAccrualPerHoursWorked ?? 30),
      vacationAccrualHoursPerThreshold: String(p.vacationAccrualHoursPerThreshold ?? 1),
    });
    setEditingId(p.id);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-policy"><Plus className="h-4 w-4 mr-1" /> Add Policy</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-policy-form">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit PTO Policy" : "Create PTO Policy"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Policy Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-policy-name" /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-policy-description" /></div>
              <div>
                <Label>Accrual Type</Label>
                <Select value={form.accrualType} onValueChange={(v) => setForm({ ...form, accrualType: v })}>
                  <SelectTrigger data-testid="select-accrual-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="per_pay_period">Per Pay Period</SelectItem>
                    <SelectItem value="per_hours_worked">Per Hours Worked</SelectItem>
                  </SelectContent>
                </Select>
                {form.accrualType === "per_hours_worked" && (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-per-hours-worked-help">
                    Vacation PTO is earned from clocked time:
                    floor(hours worked / "Hours worked per accrual") × "PTO hours earned per threshold",
                    capped by the Yearly Cap. Hours clocked before the waiting period ends do not count.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Accrual Rate (hours/year)</Label><Input type="number" value={form.accrualHoursPerYear} onChange={(e) => setForm({ ...form, accrualHoursPerYear: e.target.value })} data-testid="input-accrual-rate" /></div>
                <div><Label>Yearly Cap (hours)</Label><Input type="number" value={form.yearlyCapHours} onChange={(e) => setForm({ ...form, yearlyCapHours: e.target.value })} data-testid="input-yearly-cap" /></div>
              </div>
              {form.accrualType === "per_hours_worked" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Hours worked per accrual</Label>
                    <Input
                      type="number"
                      min="1"
                      step="0.1"
                      value={form.vacationAccrualPerHoursWorked}
                      onChange={(e) => setForm({ ...form, vacationAccrualPerHoursWorked: e.target.value })}
                      data-testid="input-vacation-hours-per-accrual"
                    />
                  </div>
                  <div>
                    <Label>PTO hours earned per threshold</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.vacationAccrualHoursPerThreshold}
                      onChange={(e) => setForm({ ...form, vacationAccrualHoursPerThreshold: e.target.value })}
                      data-testid="input-vacation-hours-earned"
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Carryover Cap (hours)</Label><Input type="number" value={form.carryoverCapHours} onChange={(e) => setForm({ ...form, carryoverCapHours: e.target.value })} data-testid="input-carryover-cap" /></div>
                <div><Label>Waiting Period (days)</Label><Input type="number" value={form.waitingPeriodDays} onChange={(e) => setForm({ ...form, waitingPeriodDays: e.target.value })} data-testid="input-waiting-period" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Personal Hours/Year</Label><Input type="number" value={form.personalHoursPerYear} onChange={(e) => setForm({ ...form, personalHoursPerYear: e.target.value })} data-testid="input-personal-hours" /></div>
                <div><Label>Expiration Date</Label><Input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} placeholder="Defaults to Dec 31" data-testid="input-expiration-date" /></div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Sick Accrual Enabled</Label>
                <Switch checked={form.sickAccrualEnabled} onCheckedChange={(v) => setForm({ ...form, sickAccrualEnabled: v })} data-testid="switch-sick-accrual" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Holiday Pay Enabled</Label>
                <Switch checked={form.holidayPayEnabled} onCheckedChange={(v) => setForm({ ...form, holidayPayEnabled: v })} data-testid="switch-holiday-pay" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Set as Default</Label>
                <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} data-testid="switch-is-default" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending} data-testid="button-save-policy">
                {saveMutation.isPending ? "Saving..." : "Save Policy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card data-testid="card-policies-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !policies || policies.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-policies">No PTO policies configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Accrual Type</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Rate</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Default</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id} data-testid={`row-policy-${p.id}`}>
                    <TableCell className="font-medium" data-testid={`text-policy-name-${p.id}`}>{p.name}</TableCell>
                    <TableCell data-testid={`text-policy-accrual-${p.id}`}>{p.accrualType}</TableCell>
                    <TableCell data-testid={`text-policy-rate-${p.id}`}>{p.accrualHoursPerYear} hrs/yr</TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"} data-testid={`badge-policy-status-${p.id}`}>
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-policy-default-${p.id}`}>
                      {p.isDefault && <Badge className="bg-blue-600">Default</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => startEdit(p)} data-testid={`button-edit-policy-${p.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
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

function EmployeePtoTab() {
  const { toast } = useToast();
  const [selectedUser, setSelectedUser] = useState<string>("");

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: policies } = useQuery<PtoPolicy[]>({ queryKey: ["/api/pto-policies"] });

  const { data: settings, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ["/api/employee-pto-settings", selectedUser],
    enabled: !!selectedUser,
  });

  const [form, setForm] = useState({
    ptoPolicyId: "",
    vacationHoursOverride: "",
    sickHoursOverride: "",
    personalHoursOverride: "",
    notes: "",
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        userId: selectedUser,
        ptoPolicyId: form.ptoPolicyId || null,
        vacationHoursOverride: form.vacationHoursOverride ? parseFloat(form.vacationHoursOverride) : null,
        sickHoursOverride: form.sickHoursOverride ? parseFloat(form.sickHoursOverride) : null,
        personalHoursOverride: form.personalHoursOverride ? parseFloat(form.personalHoursOverride) : null,
        notes: form.notes || null,
      };
      if (settings?.id) {
        await apiRequest("PATCH", `/api/employee-pto-settings/${selectedUser}`, payload);
      } else {
        await apiRequest("POST", "/api/employee-pto-settings", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-pto-settings", selectedUser] });
      toast({ title: "PTO settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleUserSelect = (userId: string) => {
    setSelectedUser(userId);
    setForm({
      ptoPolicyId: "",
      vacationHoursOverride: "",
      sickHoursOverride: "",
      personalHoursOverride: "",
      notes: "",
    });
  };

  return (
    <div className="space-y-4 mt-4">
      <Card data-testid="card-employee-pto-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Per-Employee PTO Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Select Employee</Label>
            <Select value={selectedUser} onValueChange={handleUserSelect}>
              <SelectTrigger data-testid="select-employee-pto">
                <SelectValue placeholder="Choose an employee..." />
              </SelectTrigger>
              <SelectContent>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUser && (
            <>
              {settingsLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Assigned PTO Policy</Label>
                    <Select value={form.ptoPolicyId || "none"} onValueChange={(v) => setForm({ ...form, ptoPolicyId: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="select-assigned-policy">
                        <SelectValue placeholder="Use default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Use Division Default</SelectItem>
                        {policies?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Vacation Override (hours)</Label>
                      <Input type="number" value={form.vacationHoursOverride} onChange={(e) => setForm({ ...form, vacationHoursOverride: e.target.value })} data-testid="input-vacation-override" />
                    </div>
                    <div>
                      <Label>Sick Override (hours)</Label>
                      <Input type="number" value={form.sickHoursOverride} onChange={(e) => setForm({ ...form, sickHoursOverride: e.target.value })} data-testid="input-sick-override" />
                    </div>
                    <div>
                      <Label>Personal Override (hours)</Label>
                      <Input type="number" value={form.personalHoursOverride} onChange={(e) => setForm({ ...form, personalHoursOverride: e.target.value })} data-testid="input-personal-override" />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-pto-notes" />
                  </div>
                  <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-employee-pto">
                    {saveMutation.isPending ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AlertsExceptionsTab({ filters }: { filters: AlertsExceptionsFilters }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const {
    statusFilter, setStatusFilter,
    typeFilter, setTypeFilter,
    departmentFilter, setDepartmentFilter,
    locationFilter, setLocationFilter,
    employeeSearch, setEmployeeSearch,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    reset,
  } = filters;

  const { data: exceptions, isLoading, isError } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions"],
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    enabled: isAdmin,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: isAdmin,
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

  const userMap = new Map((users || []).map(u => [u.id, u]));

  const allExceptions = exceptions || [];
  const dateFromTs = dateFrom ? new Date(dateFrom).getTime() : null;
  const dateToTs = dateTo ? new Date(dateTo).getTime() : null;
  const employeeSearchLower = employeeSearch.trim().toLowerCase();

  const filtered = allExceptions.filter((ex) => {
    if (statusFilter !== "all" && ex.status !== statusFilter) return false;
    if (typeFilter !== "all" && ex.type !== typeFilter) return false;

    if (isAdmin) {
      const u = userMap.get(ex.employeeId);
      if (departmentFilter !== "all" && (u?.departmentId || "") !== departmentFilter) return false;
      if (locationFilter !== "all" && (u?.locationId || "") !== locationFilter) return false;
      if (employeeSearchLower) {
        const name = (ex.employeeName || (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "")).toLowerCase();
        if (!name.includes(employeeSearchLower)) return false;
      }
      if (dateFromTs !== null || dateToTs !== null) {
        const exDateTs = ex.exceptionDate ? new Date(ex.exceptionDate).getTime() : NaN;
        if (Number.isNaN(exDateTs)) return false;
        if (dateFromTs !== null && exDateTs < dateFromTs) return false;
        if (dateToTs !== null && exDateTs > dateToTs) return false;
      }
    }

    return true;
  });

  const exceptionTypes = Array.from(new Set(allExceptions.map((e) => e.type)));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>;
      case "approved": return <Badge variant="default" className="bg-green-600">Approved</Badge>;
      case "denied": return <Badge variant="destructive">Denied</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    const labels: Record<string, string> = {
      missing_punch: "Missing Punch",
      late_arrival: "Late Arrival",
      early_departure: "Early Departure",
      missed_break: "Missed Break",
      manual_correction: "Manual Correction",
    };
    return <Badge variant="outline">{labels[type] || type}</Badge>;
  };

  const hasActiveAdminFilters = isAdmin && (
    departmentFilter !== "all" ||
    locationFilter !== "all" ||
    employeeSearch !== "" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    statusFilter !== "pending" ||
    typeFilter !== "all"
  );

  return (
    <div className="space-y-4 mt-4" data-testid="alerts-exceptions-tab">
      <div className="flex items-center gap-3 flex-wrap" data-testid="exceptions-filter-bar">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-exception-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-exception-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {exceptionTypes.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isAdmin && (
          <>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-exception-department-filter">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {(departments || []).map(d => (
                  <SelectItem key={d.id} value={d.id} data-testid={`option-exception-department-${d.id}`}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-exception-location-filter">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {(locations || []).map(l => (
                  <SelectItem key={l.id} value={l.id} data-testid={`option-exception-location-${l.id}`}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                placeholder="Employee name..."
                className="pl-9"
                data-testid="input-exception-employee-search"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[150px]"
                data-testid="input-exception-date-from"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[150px]"
                data-testid="input-exception-date-to"
              />
            </div>

            {hasActiveAdminFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                className="h-8 text-xs"
                data-testid="button-clear-exception-filters"
              >
                <RotateCcw className="h-3 w-3 mr-1" /> Clear filters
              </Button>
            )}
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground" data-testid="text-exception-filter-count">
          Showing {filtered.length} of {allExceptions.length}
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-destructive" data-testid="error-exceptions">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm">Failed to load exceptions.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-no-exceptions">
            No exceptions found matching your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((ex) => (
            <PtoAlertExceptionRow
              key={ex.id}
              ex={ex}
              getTypeBadge={getTypeBadge}
              getStatusBadge={getStatusBadge}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PtoAlertExceptionRow({
  ex,
  getTypeBadge,
  getStatusBadge,
}: {
  ex: EnrichedException;
  getTypeBadge: (type: string) => JSX.Element;
  getStatusBadge: (status: string) => JSX.Element;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const parsed = parseExceptionTimeInfo(ex.reason);
  const isTimeCorrection = ex.type === "time_correction";
  const needsManualTimes = isTimeCorrection && !parsed.reqIn && !parsed.reqOut;
  const [manualReqIn, setManualReqIn] = useState("");
  const [manualReqOut, setManualReqOut] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { action: "approve", reviewNotes: notes };
      if (isTimeCorrection) {
        const reqIn = needsManualTimes ? manualReqIn : parsed.reqIn;
        const reqOut = needsManualTimes ? manualReqOut : parsed.reqOut;
        const payload = buildTimeCorrectionPayload(ex.exceptionDate, reqIn, reqOut);
        if (!payload.correctedClockIn && !payload.correctedClockOut) {
          throw new Error("Enter at least one corrected time before approving.");
        }
        Object.assign(body, payload);
      }
      await apiRequest("POST", `/api/attendance/exceptions/${ex.id}/resolve`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      toast({ title: "Exception approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/attendance/exceptions/${ex.id}/resolve`, { action: "deny", reviewNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      toast({ title: "Exception denied" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveDisabled =
    approveMutation.isPending ||
    denyMutation.isPending ||
    (needsManualTimes && !manualReqIn && !manualReqOut);

  return (
    <Card data-testid={`card-exception-${ex.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {getTypeBadge(ex.type)}
              {getStatusBadge(ex.status)}
            </div>
            <p className="font-semibold" data-testid={`text-exception-employee-${ex.id}`}>
              {ex.employeeName || "Employee"}
            </p>
            {(ex.departmentName || ex.locationName) && (
              <p
                className="text-xs text-muted-foreground"
                data-testid={`text-exception-dept-loc-${ex.id}`}
              >
                {[ex.departmentName, ex.locationName].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-sm text-muted-foreground" data-testid={`text-exception-date-${ex.id}`}>
              Date: {ex.exceptionDate}
              {ex.exceptionTime && ` at ${formatTime12(ex.exceptionTime)}`}
            </p>
            <p className="text-sm" data-testid={`text-exception-reason-${ex.id}`}>
              {ex.reason}
            </p>
            {ex.reviewNotes && (
              <p className="text-sm text-muted-foreground italic" data-testid={`text-exception-review-notes-${ex.id}`}>
                Review: {ex.reviewNotes}
              </p>
            )}
            {ex.status === "pending" && needsManualTimes && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 mt-2 space-y-2" data-testid={`box-manual-times-${ex.id}`}>
                <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>This request didn't include corrected times. Enter at least one before approving.</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Corrected In</label>
                    <Input
                      type="time"
                      value={manualReqIn}
                      onChange={(e) => setManualReqIn(e.target.value)}
                      data-testid={`input-manual-corrected-in-${ex.id}`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Corrected Out</label>
                    <Input
                      type="time"
                      value={manualReqOut}
                      onChange={(e) => setManualReqOut(e.target.value)}
                      data-testid={`input-manual-corrected-out-${ex.id}`}
                    />
                  </div>
                </div>
              </div>
            )}
            {ex.status === "pending" && (
              <Textarea
                placeholder="Review notes (optional)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
                data-testid={`input-review-notes-${ex.id}`}
              />
            )}
          </div>
          {ex.status === "pending" && (
            <div className="flex md:flex-col gap-2 md:min-w-[140px]">
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveDisabled}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                data-testid={`button-approve-exception-${ex.id}`}
              >
                <Check className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button
                onClick={() => denyMutation.mutate()}
                disabled={approveMutation.isPending || denyMutation.isPending}
                variant="destructive"
                className="flex-1"
                data-testid={`button-deny-exception-${ex.id}`}
              >
                <X className="h-4 w-4 mr-1" /> Deny
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AnniversaryHistoryTab() {
  const { data: users, isLoading: usersLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const { data: history, isLoading: historyLoading } = useQuery<(PtoAnniversaryAdjustment & { ptoPolicyName: string | null })[]>({
    queryKey: ["/api/users", selectedUserId, "pto-anniversary-adjustments"],
    queryFn: async () => {
      if (!selectedUserId) return [];
      const res = await fetch(`/api/users/${selectedUserId}/pto-anniversary-adjustments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load anniversary history");
      return res.json();
    },
    enabled: !!selectedUserId,
  });

  return (
    <Card data-testid="card-anniversary-history">
      <CardHeader>
        <CardTitle className="text-base">PTO Anniversary Adjustments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Employee</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger data-testid="select-anniversary-employee" className="mt-1">
              <SelectValue placeholder={usersLoading ? "Loading…" : "Select an employee"} />
            </SelectTrigger>
            <SelectContent>
              {users?.map((u) => (
                <SelectItem key={u.id} value={u.id} data-testid={`option-anniversary-employee-${u.id}`}>
                  {u.firstName} {u.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!selectedUserId ? (
          <p className="text-sm text-muted-foreground" data-testid="text-anniversary-pick-employee">
            Pick an employee to view their PTO anniversary tier-bump history.
          </p>
        ) : historyLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !history || history.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-anniversary-empty">
            No anniversary adjustments recorded for this employee.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Effective Date</TableHead>
                <TableHead>Years</TableHead>
                <TableHead>Old Tier → New Tier</TableHead>
                <TableHead>Hours Added</TableHead>
                <TableHead>Source Policy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row) => (
                <TableRow key={row.id} data-testid={`row-anniversary-${row.id}`}>
                  <TableCell data-testid={`text-anniversary-effective-${row.id}`}>
                    {new Date(row.effectiveDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{row.yearsOfService}</TableCell>
                  <TableCell className="text-sm">
                    {row.oldTierLabel || "—"} → {row.newTierLabel || "—"}
                  </TableCell>
                  <TableCell data-testid={`text-anniversary-hours-${row.id}`}>+{row.hoursAdded}</TableCell>
                  <TableCell className="text-sm" data-testid={`text-anniversary-policy-${row.id}`}>
                    {row.ptoPolicyName || "—"}
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
