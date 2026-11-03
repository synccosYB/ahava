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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { WorkDateBackfillCard } from "@/components/workdate-backfill-card";
import { FileText, Loader2, ChevronRight, ChevronDown, CalendarRange } from "lucide-react";
import { formatHoursMinutes } from "@/lib/utils";
import {
  currentWeek, currentBiWeek, shiftWeeks, formatRangeLabel, type DateRange,
} from "@/lib/payroll-week";

type ViewMode = "weekly" | "biweekly";
type PeriodScope = "current" | "current_plus_last";

type FilterOptions = {
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

// Per-account defaults for this page, remembered in the browser (guarded).
type Prefs = { viewMode: ViewMode; scope: PeriodScope; locationIds: string[]; departmentIds: string[] };
function prefKey(userId: string | undefined) {
  return `ahava.timesheetReview.prefs.${userId ?? "anon"}`;
}
function loadPrefs(userId: string | undefined): Prefs {
  const fallback: Prefs = { viewMode: "weekly", scope: "current", locationIds: [], departmentIds: [] };
  try {
    const raw = localStorage.getItem(prefKey(userId));
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      viewMode: p.viewMode === "biweekly" ? "biweekly" : "weekly",
      scope: p.scope === "current_plus_last" ? "current_plus_last" : "current",
      locationIds: Array.isArray(p.locationIds) ? p.locationIds : [],
      departmentIds: Array.isArray(p.departmentIds) ? p.departmentIds : [],
    };
  } catch {
    return fallback;
  }
}

// Map the view mode + scope to an actual Thu–Wed date range.
function rangeFor(viewMode: ViewMode, scope: PeriodScope): DateRange {
  const thisWeek = currentWeek();
  if (viewMode === "weekly") {
    return scope === "current"
      ? thisWeek
      : { start: shiftWeeks(thisWeek, -1).start, end: thisWeek.end }; // current + last week
  }
  // bi-weekly
  const biWeek = currentBiWeek(); // this week + last week
  return scope === "current"
    ? biWeek
    : { start: shiftWeeks(thisWeek, -3).start, end: thisWeek.end }; // current + last bi-weekly payroll (4 weeks)
}

export default function TimeSheetReviewPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const initial = useMemo(() => loadPrefs(user?.id), [user?.id]);
  const [viewMode, setViewMode] = useState<ViewMode>(initial.viewMode);
  const [scope, setScope] = useState<PeriodScope>(initial.scope);
  const [locationIds, setLocationIds] = useState<string[]>(initial.locationIds);
  const [departmentIds, setDepartmentIds] = useState<string[]>(initial.departmentIds);
  const [result, setResult] = useState<TimeResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Re-apply saved prefs once the user resolves (first load).
  useEffect(() => {
    const p = loadPrefs(user?.id);
    setViewMode(p.viewMode);
    setScope(p.scope);
    setLocationIds(p.locationIds);
    setDepartmentIds(p.departmentIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Persist the current selections as this account's default.
  useEffect(() => {
    try {
      localStorage.setItem(
        prefKey(user?.id),
        JSON.stringify({ viewMode, scope, locationIds, departmentIds }),
      );
    } catch { /* ignore */ }
  }, [user?.id, viewMode, scope, locationIds, departmentIds]);

  const range = useMemo(() => rangeFor(viewMode, scope), [viewMode, scope]);

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

  const loadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports/generate", {
        category: "time",
        reportType: "company",
        startDate: range.start,
        endDate: range.end,
        departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
        locationIds: locationIds.length > 0 ? locationIds : undefined,
      });
      return res.json();
    },
    onSuccess: (data: unknown) => {
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
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Load once on first mount so the page opens with the saved default view.
  const [autoLoaded, setAutoLoaded] = useState(false);
  useEffect(() => {
    if (autoLoaded) return;
    setAutoLoaded(true);
    loadMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoaded]);

  const rows = result?.rows ?? [];
  const totalHours = rows.reduce((s, r) => s + (r.totalHours || 0), 0);
  const totalOt = rows.reduce((s, r) => s + (r.overtime || 0), 0);

  return (
    <div className="max-w-6xl space-y-6" data-testid="timesheet-review-page">
      <PageHeader title="Time Sheet Review" subtitle="Review everyone's time sheets by location, department and payroll period" />

      {user?.role === "admin" && <WorkDateBackfillCard />}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>View</Label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <SelectTrigger data-testid="select-review-view"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as PeriodScope)}>
                <SelectTrigger data-testid="select-review-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">
                    {viewMode === "biweekly" ? "Current (this + last week)" : "Current week"}
                  </SelectItem>
                  <SelectItem value="current_plus_last">
                    {viewMode === "biweekly" ? "Current + last bi-weekly payroll" : "Current + last week"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => loadMutation.mutate()} disabled={loadMutation.isPending} data-testid="button-review-load">
              {loadMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              Load
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="text-review-range">
              <CalendarRange className="h-4 w-4" /> {formatRangeLabel(range)}
            </span>
            <span className="text-xs text-muted-foreground">Your view and filters are saved as your default.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loadMutation.isPending && !result ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-review-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading time sheets…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="No time sheets"
              description="No employees match these filters for the selected period. Adjust the location/department or period and press Load."
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
                              <div className="py-2" data-testid={`detail-review-${r.id}`}>
                                <EmployeeTimesheetTable
                                  employeeId={r.id}
                                  startDate={range.start}
                                  endDate={range.end}
                                  showExport
                                  exportFileName={`timesheet-${r.employeeName.replace(/\s+/g, "_")}-${range.start}-to-${range.end}`}
                                />
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
