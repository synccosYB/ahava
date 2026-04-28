import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatHoursMinutes } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText, Loader2, Clock, CalendarDays, AlertTriangle, FileSearch, Users } from "lucide-react";
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

type ReportRow = {
  employeeId: string;
  employeeName: string;
  department: string;
  totalHours: number;
  daysWorked: number;
  daysOff: number;
  overtime: number;
};

type FilterOptions = {
  employees: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
};

const reportTypes = [
  { key: "attendance", label: "Attendance", icon: Clock },
  { key: "time", label: "Time", icon: FileText },
  { key: "pto", label: "PTO", icon: CalendarDays },
  { key: "missing-punches", label: "Missing Punches", icon: AlertTriangle },
  { key: "exceptions", label: "Exceptions", icon: FileSearch },
  { key: "audit", label: "Audit", icon: Users },
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

        <TabsContent value="attendance"><StandardReport reportType="company" title="Attendance Report" /></TabsContent>
        <TabsContent value="time"><StandardReport reportType="employee" title="Time Report" /></TabsContent>
        <TabsContent value="pto"><StandardReport reportType="team" title="PTO Report" showStatusFilter /></TabsContent>
        <TabsContent value="missing-punches"><StandardReport reportType="company" title="Missing Punches Report" /></TabsContent>
        <TabsContent value="exceptions"><StandardReport reportType="company" title="Exceptions Report" /></TabsContent>
        <TabsContent value="audit"><AuditReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function StandardReport({
  reportType,
  title,
  showStatusFilter,
}: {
  reportType: string;
  title: string;
  showStatusFilter?: boolean;
}) {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [reportData, setReportData] = useState<ReportRow[] | null>(null);

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

  const generateMutation = useMutation({
    mutationFn: async () => {
      // INTENTIONALLY user-triggered only.
      // DO NOT call generateMutation.mutate() from a useEffect or auto-fire on mount.
      // Report generation is an expensive endpoint (server cooldown applies).
      const res = await apiRequest("POST", "/api/reports/generate", {
        reportType,
        startDate,
        endDate,
        departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
        employeeIds: employeeIds.length > 0 ? employeeIds : undefined,
        locationIds: locationIds.length > 0 ? locationIds : undefined,
        status: showStatusFilter && status !== "all" ? status : undefined,
      });
      return res.json();
    },
    onSuccess: (data: ReportRow[]) => {
      setReportData(data);
      toast({ title: `${title} generated` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const downloadCSV = () => {
    if (!reportData || reportData.length === 0) return;
    const headers = ["Employee", "Department", "Total Hours", "Days Worked", "Days Off", "Overtime"];
    const rows = reportData.map((r) => [r.employeeName, r.department, formatHoursMinutes(r.totalHours), r.daysWorked, r.daysOff, formatHoursMinutes(r.overtime)]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
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
            {showStatusFilter && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-trigger-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="partially_approved">Partially Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
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
              {reportData.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Total Hours</TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Days Worked</TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Days Off</TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Overtime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((row) => (
                      <TableRow key={row.employeeId} data-testid={`row-report-${row.employeeId}`}>
                        <TableCell className="font-medium" data-testid={`text-report-name-${row.employeeId}`}>{row.employeeName}</TableCell>
                        <TableCell data-testid={`text-report-dept-${row.employeeId}`}>{row.department}</TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-report-hours-${row.employeeId}`}>{formatHoursMinutes(row.totalHours)}</TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-report-days-${row.employeeId}`}>{row.daysWorked}</TableCell>
                        <TableCell className="tabular-nums" data-testid={`text-report-off-${row.employeeId}`}>{row.daysOff}</TableCell>
                        <TableCell data-testid={`text-report-overtime-${row.employeeId}`}>
                          <span className={row.overtime > 0 ? "text-amber-500 font-bold" : ""}>{formatHoursMinutes(row.overtime)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4" data-testid="text-no-report-data">
                  No data found for the selected criteria.
                </p>
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
            <p className="text-muted-foreground text-center py-4" data-testid="text-no-audit-data">No audit logs found.</p>
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
                    <TableCell>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</TableCell>
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
