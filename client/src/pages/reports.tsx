import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatHoursMinutes, formatDate, formatTime12, formatTime12InTz } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText, Loader2, Clock, CalendarDays, AlertTriangle, FileSearch, Users, CalendarRange } from "lucide-react";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { PageHeader } from "@/components/page-header";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { AuditLog } from "@shared/schema";

type ReportColumn = {
  key: string;
  label: string;
  kind?: "hours" | "date" | "datetime" | "number" | "text";
};

type ReportRow = { id: string } & Record<string, unknown>;

type ReportResult = {
  category: string;
  columns: ReportColumn[];
  rows: ReportRow[];
};

// A response is only a renderable report when it actually carries columns and
// rows arrays. The /api/reports/generate endpoint can return a 202 cooldown
// payload ({ message, retryAfterMs }) that apiRequest still resolves as a 2xx
// success, so this guard keeps non-report payloads from crashing the table.
function isReportResult(data: unknown): data is ReportResult {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as ReportResult).columns) &&
    Array.isArray((data as ReportResult).rows)
  );
}

type FilterOptions = {
  employees: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  companies: { id: string; name: string }[];
};

const reportTypes = [
  { key: "attendance", label: "Attendance", icon: Clock },
  { key: "time", label: "Time", icon: FileText },
  { key: "pto", label: "PTO", icon: CalendarDays },
  { key: "missing-punches", label: "Missing Punches", icon: AlertTriangle },
  { key: "exceptions", label: "Exceptions", icon: FileSearch },
  { key: "audit", label: "Audit", icon: Users },
  { key: "employee-timesheet", label: "Employee Timesheet", icon: CalendarRange },
];

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState("attendance");

  return (
    <div className="max-w-6xl space-y-6" data-testid="reports-page">
      <PageHeader title="Reports" subtitle="Generate and export workforce reports" />

      <Tabs value={activeReport} onValueChange={setActiveReport} data-testid="tabs-reports">
        <TabsList className="flex-wrap">
          {reportTypes.map((rt) => (
            <TabsTrigger key={rt.key} value={rt.key} data-testid={`tab-report-${rt.key}`}>
              <rt.icon className="h-4 w-4 mr-1" />
              {rt.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="attendance"><StandardReport category="attendance" reportType="company" title="Attendance Report" /></TabsContent>
        <TabsContent value="time"><StandardReport category="time" reportType="employee" title="Time Report" /></TabsContent>
        <TabsContent value="pto"><StandardReport category="pto" reportType="team" title="PTO Report" statusFilter="timeOff" /></TabsContent>
        <TabsContent value="missing-punches"><StandardReport category="missing-punches" reportType="company" title="Missing Punches Report" /></TabsContent>
        <TabsContent value="exceptions"><StandardReport category="exceptions" reportType="company" title="Exceptions Report" statusFilter="exception" /></TabsContent>
        <TabsContent value="audit"><AuditReport /></TabsContent>
        <TabsContent value="employee-timesheet"><EmployeeTimesheetReport /></TabsContent>
      </Tabs>
    </div>
  );
}

const TIME_OFF_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "partially_approved", label: "Partially Approved" },
  { value: "denied", label: "Denied" },
];

const EXCEPTION_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "cancelled", label: "Cancelled" },
];

function formatCell(
  value: unknown,
  kind: ReportColumn["kind"],
  mode: "display" | "csv" = "display",
  timezone?: string | null,
): string {
  if (value === null || value === undefined || value === "") {
    return mode === "display" ? "—" : "";
  }
  if (kind === "hours") {
    return formatHoursMinutes(Number(value));
  }
  if (kind === "date") {
    // Date-only string (YYYY-MM-DD) — render without timezone shifting.
    return formatDate(String(value)) || String(value);
  }
  if (kind === "datetime") {
    const d = new Date(String(value));
    if (isNaN(d.getTime())) return String(value);
    if (mode === "csv") return d.toISOString();
    // Punch times (e.g. clock-in/out) carry the clinic/business timezone so the
    // wall-clock time matches the clinic, not the viewer's browser. Other
    // datetimes fall back to local formatting.
    const time = timezone ? formatTime12InTz(String(value), timezone) : formatTime12(d);
    return `${formatDate(d)} ${time}`;
  }
  return String(value);
}

function StandardReport({
  category,
  reportType,
  title,
  statusFilter,
}: {
  category: string;
  reportType: string;
  title: string;
  statusFilter?: "timeOff" | "exception";
}) {
  const { toast } = useToast();
  const showStatusFilter = !!statusFilter;
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [taxClassifications, setTaxClassifications] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [reportData, setReportData] = useState<ReportResult | null>(null);

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["/api/reports/filter-options"],
  });

  const departmentOptions = useMemo(
    () => (filterOptions?.departments ?? []).map((d) => ({ label: d.name, value: d.id })),
    [filterOptions],
  );
  const employeeOptions = useMemo(
    () => (filterOptions?.employees ?? []).map((e) => ({ label: e.name, value: e.id })),
    [filterOptions],
  );
  const locationOptions = useMemo(
    () => (filterOptions?.locations ?? []).map((l) => ({ label: l.name, value: l.id })),
    [filterOptions],
  );
  const companyOptions = useMemo(
    () => (filterOptions?.companies ?? []).map((c) => ({ label: c.name, value: c.id })),
    [filterOptions],
  );
  const taxClassOptions = useMemo(
    () => [
      { label: "W-2", value: "W-2" },
      { label: "1099", value: "1099" },
    ],
    [],
  );

  const generateMutation = useMutation({
    mutationFn: async () => {
      // INTENTIONALLY user-triggered only.
      // DO NOT call generateMutation.mutate() from a useEffect or auto-fire on mount.
      // Report generation is an expensive endpoint (server cooldown applies).
      const res = await apiRequest("POST", "/api/reports/generate", {
        category,
        reportType,
        startDate,
        endDate,
        departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
        employeeIds: employeeIds.length > 0 ? employeeIds : undefined,
        locationIds: locationIds.length > 0 ? locationIds : undefined,
        companyIds: companyIds.length > 0 ? companyIds : undefined,
        taxClassifications: taxClassifications.length > 0 ? taxClassifications : undefined,
        status: showStatusFilter && status !== "all" ? status : undefined,
      });
      return res.json();
    },
    onSuccess: (data: unknown) => {
      // The server returns a 202 with { message, retryAfterMs } when the
      // per-params cooldown is active. apiRequest treats any 2xx as success,
      // so guard here: only a payload with real columns/rows is a renderable
      // report. Anything else (cooldown, future non-report 2xx) must NOT
      // overwrite the currently displayed report — keep it on screen and just
      // surface a friendly message.
      if (!isReportResult(data)) {
        const cooldown = data as { message?: string; retryAfterMs?: number } | null;
        const retrySecs = cooldown?.retryAfterMs ? Math.ceil(cooldown.retryAfterMs / 1000) : null;
        toast({
          title: "Report is cooling down",
          description:
            cooldown?.message ||
            (retrySecs ? `Try again in ${retrySecs}s.` : "Please try again in a moment."),
        });
        return;
      }
      setReportData(data);
      toast({ title: `${title} generated` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const escapeCsv = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const downloadCSV = () => {
    if (!reportData || reportData.rows.length === 0) return;
    const { columns, rows } = reportData;
    const headers = columns.map((c) => c.label);
    const dataRows = rows.map((r) =>
      columns.map((c) => escapeCsv(formatCell(r[c.key], c.kind, "csv"))),
    );
    const csv = [headers.map(escapeCsv).join(","), ...dataRows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card data-testid="card-report-filters">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-start-date" />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="input-end-date" />
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
                data-testid="multiselect-department"
              />
            </div>
            <div className="space-y-2">
              <Label>Employee</Label>
              <MultiSelect
                options={employeeOptions}
                selected={employeeIds}
                onChange={setEmployeeIds}
                placeholder="All employees"
                allLabel="All employees"
                searchPlaceholder="Search employees..."
                data-testid="multiselect-employee"
              />
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
                data-testid="multiselect-location"
              />
            </div>
            <div className="space-y-2">
              <Label>Company</Label>
              <MultiSelect
                options={companyOptions}
                selected={companyIds}
                onChange={setCompanyIds}
                placeholder="All companies"
                allLabel="All companies"
                searchPlaceholder="Search companies..."
                data-testid="multiselect-company"
              />
            </div>
            <div className="space-y-2">
              <Label>Tax Classification</Label>
              <MultiSelect
                options={taxClassOptions}
                selected={taxClassifications}
                onChange={setTaxClassifications}
                placeholder="All tax classifications"
                allLabel="All tax classifications"
                searchPlaceholder="Search..."
                data-testid="multiselect-tax-classification"
              />
            </div>
            {showStatusFilter && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-trigger-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(statusFilter === "exception" ? EXCEPTION_STATUS_OPTIONS : TIME_OFF_STATUS_OPTIONS).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-end sm:col-span-2 lg:col-span-3">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="button-generate-report"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {reportData && (
        <>
          <Card data-testid="card-report-preview">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{title}</CardTitle>
                <Button variant="outline" size="sm" onClick={downloadCSV} data-testid="button-download-csv">
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {reportData.rows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {reportData.columns.map((col) => (
                        <TableHead key={col.key} className="text-xs font-medium uppercase tracking-wider">{col.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.rows.map((row) => (
                      <TableRow key={row.id} data-testid={`row-report-${row.id}`}>
                        {reportData.columns.map((col) => {
                          const numeric = col.kind === "hours" || col.kind === "number";
                          const isOvertime = col.key === "overtime" && Number(row[col.key]) > 0;
                          return (
                            <TableCell
                              key={col.key}
                              className={`${numeric ? "tabular-nums" : ""} ${col.key === "employeeName" ? "font-medium" : ""}`}
                              data-testid={`cell-report-${col.key}-${row.id}`}
                            >
                              <span className={isOvertime ? "text-amber-500 font-bold" : ""}>
                                {formatCell(row[col.key], col.kind, "display", row.timezone as string | null | undefined)}
                              </span>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No data found"
                  description="No records match the selected criteria. Try adjusting the date range or filters."
                  testId="text-no-report-data"
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function AuditReport() {
  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-logs"],
  });

  const downloadCSV = () => {
    if (!logs || logs.length === 0) return;
    const headers = ["Action", "Target Type", "Target ID", "IP Address", "Date"];
    const rows = logs.map((l) => [l.action, l.targetType, l.targetId, l.ipAddress || "", l.createdAt ? new Date(l.createdAt).toISOString() : ""]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card data-testid="card-audit-report">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Audit Report</CardTitle>
            <Button variant="outline" size="sm" onClick={downloadCSV} disabled={!logs || logs.length === 0} data-testid="button-export-audit">
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !logs || logs.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No audit logs"
              description="Audit activity will appear here as actions are recorded."
              testId="text-no-audit-data"
            />
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
                  <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell>{log.targetType}</TableCell>
                    <TableCell className="text-xs font-mono">{log.targetId.substring(0, 8)}...</TableCell>
                    <TableCell>{log.ipAddress || "—"}</TableCell>
                    <TableCell>{log.createdAt ? `${formatDate(log.createdAt)} ${formatTime12(log.createdAt)}` : "—"}</TableCell>
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

type TimesheetEligibleEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
};

type GeneratedTimesheet = {
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
};

function EmployeeTimesheetReport() {
  const today = new Date();
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(today.getDate() - 13);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [startDate, setStartDate] = useState(twoWeeksAgo.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split("T")[0]);
  const [generated, setGenerated] = useState<GeneratedTimesheet | null>(null);

  const { data: employees, isLoading: loadingEmployees } = useQuery<TimesheetEligibleEmployee[]>({
    queryKey: ["/api/timesheet/eligible-employees"],
  });

  const sortedEmployees = (employees || []).slice().sort((a, b) => {
    const an = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
    const bn = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });

  const selectedEmployee = sortedEmployees.find((e) => e.id === employeeId);
  const rangeInvalid = startDate > endDate;
  const generateDisabled = !employeeId || rangeInvalid;

  const handleGenerate = () => {
    if (generateDisabled || !selectedEmployee) return;
    setGenerated({
      employeeId,
      employeeName: `${selectedEmployee.firstName} ${selectedEmployee.lastName}`.trim(),
      startDate,
      endDate,
    });
  };

  const fileName = generated
    ? `timesheet-${generated.employeeName.replace(/\s+/g, "_")}-${generated.startDate}-${generated.endDate}.csv`
    : undefined;

  return (
    <Card data-testid="card-employee-timesheet-report">
      <CardHeader>
        <CardTitle>Employee Timesheet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label htmlFor="emp-select" className="text-xs uppercase tracking-wider text-muted-foreground">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={loadingEmployees}>
              <SelectTrigger id="emp-select" data-testid="select-timesheet-employee">
                <SelectValue placeholder={loadingEmployees ? "Loading..." : "Select an employee"} />
              </SelectTrigger>
              <SelectContent>
                {sortedEmployees.map((e) => (
                  <SelectItem key={e.id} value={e.id} data-testid={`option-employee-${e.id}`}>
                    {`${e.firstName} ${e.lastName}`.trim() || "Unnamed"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ts-rep-start" className="text-xs uppercase tracking-wider text-muted-foreground">Start Date</Label>
            <Input
              id="ts-rep-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-testid="input-report-timesheet-start"
            />
          </div>
          <div>
            <Label htmlFor="ts-rep-end" className="text-xs uppercase tracking-wider text-muted-foreground">End Date</Label>
            <Input
              id="ts-rep-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              data-testid="input-report-timesheet-end"
            />
          </div>
          <div>
            <Button
              onClick={handleGenerate}
              disabled={generateDisabled}
              data-testid="button-generate-timesheet"
              className="w-full"
            >
              <FileText className="h-4 w-4 mr-2" /> Generate
            </Button>
          </div>
        </div>

        {rangeInvalid && (
          <p className="text-sm text-destructive py-2" data-testid="text-timesheet-bad-range">
            Start date must be on or before the end date.
          </p>
        )}

        {!generated ? (
          <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-timesheet-select-prompt">
            Choose an employee and a date range, then click Generate.
          </p>
        ) : (
          <EmployeeTimesheetTable
            employeeId={generated.employeeId}
            startDate={generated.startDate}
            endDate={generated.endDate}
            showExport
            exportFileName={fileName}
          />
        )}
      </CardContent>
    </Card>
  );
}
