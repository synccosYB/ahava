import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { EmployeeReviewRules } from "@/components/employee-review-rules";
import { TimesheetEditor } from "@/components/timesheet-editor";
import { WorkDateBackfillCard } from "@/components/workdate-backfill-card";
import { OverlongShiftReconcileCard } from "@/components/overlong-shift-reconcile-card";
import { TodaysClockOutsCard } from "@/components/todays-clockouts-card";
import { LongShiftApprovalsCard } from "@/components/long-shift-approvals-card";
import { usePermissions } from "@/hooks/use-permissions";
import { FileText, Loader2, ChevronRight, ChevronDown, CalendarRange, RefreshCw, Save, CalendarDays } from "lucide-react";
import { formatHoursMinutes, formatDate } from "@/lib/utils";
import { formatRangeLabel } from "@/lib/payroll-week";
import {
  type Period, PERIOD_LABELS, PERIOD_KEYS, rangeForPeriod, normalizePeriod, ymdLocal, ymdToDate,
} from "@/lib/timesheet-period";

type FilterOptions = {
  employees: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
};

type TimeRow = {
  id: string; // employee id
  employeeName: string;
  department: string;
  daysWorked: number;
  totalHours: number;
  overtime: number;
};

type TimeResult = { category: string; rows: TimeRow[] };

function isTimeResult(data: unknown): data is TimeResult {
  return (
    typeof data === "object" && data !== null && Array.isArray((data as TimeResult).rows)
  );
}

// Per-account saved default for this page, remembered in the browser (guarded).
// `savedDefault` is set only when the user presses "Save as default" — then the
// page auto-runs that search next time it opens (without it, the page waits for
// an explicit Apply so it doesn't load everyone).
type Prefs = { period: Period; customStart: string; customEnd: string; locationIds: string[]; departmentIds: string[]; employeeIds: string[]; savedDefault: boolean };
function prefKey(userId: string | undefined) {
  return `ahava.timesheetReview.prefs.${userId ?? "anon"}`;
}
function loadPrefs(userId: string | undefined): Prefs {
  const fallback: Prefs = { period: "this_week", customStart: "", customEnd: "", locationIds: [], departmentIds: [], employeeIds: [], savedDefault: false };
  try {
    const raw = localStorage.getItem(prefKey(userId));
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    const period: Period = normalizePeriod(p.period);
    return {
      period,
      customStart: typeof p.customStart === "string" ? p.customStart : "",
      customEnd: typeof p.customEnd === "string" ? p.customEnd : "",
      locationIds: Array.isArray(p.locationIds) ? p.locationIds : [],
      departmentIds: Array.isArray(p.departmentIds) ? p.departmentIds : [],
      employeeIds: Array.isArray(p.employeeIds) ? p.employeeIds : [],
      savedDefault: p.savedDefault === true,
    };
  } catch {
    return fallback;
  }
}


// A date field that opens a pop-up calendar to pick a specific day.
function DateField({ label, value, onChange, testId }: {
  label: string;
  value: string;
  onChange: (ymd: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = ymdToDate(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start font-normal" data-testid={testId}>
            <CalendarDays className="h-4 w-4 mr-2 opacity-70" />
            {selected ? formatDate(value) : <span className="text-muted-foreground">Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              if (d) {
                onChange(ymdLocal(d));
                setOpen(false);
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function TimeSheetReviewPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { has } = usePermissions();
  const canEdit = has("attendance.edit");

  const initial = useMemo(() => loadPrefs(user?.id), [user?.id]);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [customStart, setCustomStart] = useState<string>(initial.customStart);
  const [customEnd, setCustomEnd] = useState<string>(initial.customEnd);
  const [locationIds, setLocationIds] = useState<string[]>(initial.locationIds);
  const [departmentIds, setDepartmentIds] = useState<string[]>(initial.departmentIds);
  const [employeeIds, setEmployeeIds] = useState<string[]>(initial.employeeIds);
  const [result, setResult] = useState<TimeResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const range = useMemo(() => rangeForPeriod(period, customStart, customEnd), [period, customStart, customEnd]);

  // "Save as default": persist the current period + filters so next time the
  // page opens it auto-runs this exact search.
  const saveAsDefault = () => {
    try {
      localStorage.setItem(
        prefKey(user?.id),
        JSON.stringify({ period, customStart, customEnd, locationIds, departmentIds, employeeIds, savedDefault: true }),
      );
      toast({ title: "Saved as your default", description: "This search will run automatically when you open the page." });
    } catch {
      toast({ title: "Couldn't save default", variant: "destructive" });
    }
  };

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["/api/reports/filter-options"],
  });
  const locationOptions = useMemo(
    () => (filterOptions?.locations ?? []).map((l) => ({ label: l.name, value: l.id })),
    [filterOptions],
  );
  const departmentOptions = useMemo(
    () => (filterOptions?.departments ?? []).map((d) => ({ label: d.name, value: d.id })),
    [filterOptions],
  );
  const employeeOptions = useMemo(
    () => (filterOptions?.employees ?? []).map((e) => ({ label: e.name, value: e.id })),
    [filterOptions],
  );

  const loadMutation = useMutation({
    mutationFn: async (force: boolean = false) => {
      const res = await apiRequest("POST", "/api/reports/generate", {
        category: "time",
        reportType: "company",
        startDate: range.start,
        endDate: range.end,
        departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
        locationIds: locationIds.length > 0 ? locationIds : undefined,
        employeeIds: employeeIds.length > 0 ? employeeIds : undefined,
        // A deliberate Refresh click bypasses the server's report cooldown.
        force: force || undefined,
      });
      return res.json();
    },
    onSuccess: (data: unknown, force: boolean = false) => {
      if (!isTimeResult(data)) {
        const cd = data as { message?: string; retryAfterMs?: number } | null;
        const secs = cd?.retryAfterMs ? Math.ceil(cd.retryAfterMs / 1000) : null;
        toast({
          title: "One moment",
          description: cd?.message || (secs ? `Try again in ${secs}s.` : "Please try again in a moment."),
        });
        return;
      }
      setResult(data);
      setExpanded(null);
      if (force) toast({ title: "Refreshed", description: "Time sheets reloaded with the latest data." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // No auto-load by default: the page opens on the filter bar so you choose a
  // location / department (or employee) and press Apply. This keeps it fast and
  // makes the search explicit. The ONE exception: if the user pressed "Save as
  // default", that saved search auto-runs once on open. `hasApplied` tracks
  // whether a search has been run yet.
  const [hasApplied, setHasApplied] = useState(false);
  const applyFilters = (force: boolean = false) => {
    setHasApplied(true);
    loadMutation.mutate(force);
  };
  useEffect(() => {
    if (initial.savedDefault && !hasApplied) {
      applyFilters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.savedDefault]);

  const rows = result?.rows ?? [];
  const totalHours = rows.reduce((s, r) => s + (r.totalHours || 0), 0);
  const totalOt = rows.reduce((s, r) => s + (r.overtime || 0), 0);

  return (
    <div className="max-w-6xl space-y-6" data-testid="timesheet-review-page">
      <PageHeader title="Time Sheet Review" subtitle="Review everyone's time sheets by location, department and payroll period" />

      {user?.role === "admin" && <WorkDateBackfillCard />}
      {user?.role === "admin" && <OverlongShiftReconcileCard />}
      {user?.role === "admin" && <TodaysClockOutsCard />}
      {(user?.role === "admin" || user?.role === "manager") && <LongShiftApprovalsCard />}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger data-testid="select-review-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIOD_KEYS.map((p) => (
                    <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {period === "custom" ? (
              <>
                <DateField label="From" value={customStart} onChange={setCustomStart} testId="date-review-from" />
                <DateField label="To" value={customEnd} onChange={setCustomEnd} testId="date-review-to" />
              </>
            ) : (
              <div className="hidden lg:block" />
            )}
            <div className="space-y-2">
              <Label>Location</Label>
              <MultiSelect
                options={locationOptions}
                selected={locationIds}
                onChange={setLocationIds}
                placeholder="All locations"
                allLabel="All locations"
                searchPlaceholder="Search locations..."
                data-testid="multiselect-review-location"
              />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <MultiSelect
                options={departmentOptions}
                selected={departmentIds}
                onChange={setDepartmentIds}
                placeholder="All departments"
                allLabel="All departments"
                searchPlaceholder="Search departments..."
                data-testid="multiselect-review-department"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Employee</Label>
              <MultiSelect
                options={employeeOptions}
                selected={employeeIds}
                onChange={setEmployeeIds}
                placeholder="All employees"
                allLabel="All employees"
                searchPlaceholder="Search by name..."
                data-testid="multiselect-review-employee"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => applyFilters(false)} disabled={loadMutation.isPending} data-testid="button-review-load">
              {loadMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              Apply
            </Button>
            {hasApplied && result && (
              <Button variant="outline" onClick={() => applyFilters(true)} disabled={loadMutation.isPending} data-testid="button-review-refresh">
                <RefreshCw className={`h-4 w-4 mr-2 ${loadMutation.isPending ? "animate-spin" : ""}`} /> Refresh
              </Button>
            )}
            <Button variant="outline" onClick={saveAsDefault} data-testid="button-review-save-default">
              <Save className="h-4 w-4 mr-2" /> Save as default
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="text-review-range">
              <CalendarRange className="h-4 w-4" /> {formatRangeLabel(range)}
            </span>
            <span className="text-xs text-muted-foreground">Save as default to auto-run this search next time.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {!hasApplied ? (
            <EmptyState
              icon={CalendarRange}
              title="Choose your filters, then press Apply"
              description="Pick a location, department or employee (or leave them as All) and the payroll period above, then press Apply to load the time sheets."
              testId="text-review-prompt"
            />
          ) : loadMutation.isPending && !result ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-review-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading time sheets…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="No time sheets"
              description="No employees match these filters for the selected period. Adjust the location/department or period and press Apply."
              testId="text-review-empty"
            />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Days</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Total Hours</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Overtime</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = expanded === r.id;
                    return (
                      <Fragment key={r.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          data-testid={`row-review-${r.id}`}
                        >
                          <TableCell className="text-muted-foreground">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{r.employeeName}</TableCell>
                          <TableCell className="text-muted-foreground">{r.department}</TableCell>
                          <TableCell className="tabular-nums">{r.daysWorked}</TableCell>
                          <TableCell className="tabular-nums font-semibold">{formatHoursMinutes(r.totalHours)}</TableCell>
                          <TableCell className="tabular-nums">
                            {r.overtime > 0 ? <span className="text-amber-600 font-semibold">{formatHoursMinutes(r.overtime)}</span> : "—"}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-muted/30">
                              <div className="py-2 space-y-3" data-testid={`detail-review-${r.id}`}>
                                <EmployeeReviewRules employeeId={r.id} />
                                <EmployeeTimesheetTable
                                  employeeId={r.id}
                                  startDate={range.start}
                                  endDate={range.end}
                                  showExport
                                  exportFileName={`timesheet-${r.employeeName.replace(/\s+/g, "_")}-${range.start}-to-${range.end}`}
                                />
                                {canEdit && (
                                  <TimesheetEditor
                                    employeeId={r.id}
                                    startDate={range.start}
                                    endDate={range.end}
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell />
                    <TableCell colSpan={3} className="text-right text-sm uppercase tracking-wider">
                      {rows.length} employee{rows.length === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell className="tabular-nums" data-testid="text-review-total-hours">{formatHoursMinutes(totalHours)}</TableCell>
                    <TableCell className="tabular-nums" data-testid="text-review-total-ot">{formatHoursMinutes(totalOt)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
