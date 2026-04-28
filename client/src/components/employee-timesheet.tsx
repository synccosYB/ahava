import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";
import { formatHoursMinutes } from "@/lib/utils";

export type TimesheetStatus = "complete" | "in_progress" | "missing_punch" | "overtime" | "pto" | "none";

export type TimesheetEntry = {
  date: string;
  dayOfWeek: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  totalHours: number | null;
  overtimeHours: number;
  status: TimesheetStatus;
  ptoType: string | null;
};

export type TimesheetResponse = {
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  otThresholdDaily: number;
  entries: TimesheetEntry[];
  totals: {
    totalHours: number;
    overtimeHours: number;
    daysWorked: number;
  };
};

function defaultTimesheetRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 13);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

export function EmployeeTimesheetCard({ userId }: { userId: string }) {
  const initial = useMemo(defaultTimesheetRange, []);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);

  return (
    <Card data-testid="card-employee-timesheet">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle>Timesheet</CardTitle>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="ts-start" className="text-xs uppercase tracking-wider text-muted-foreground">Start</Label>
              <Input
                id="ts-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[160px]"
                data-testid="input-timesheet-start"
              />
            </div>
            <div>
              <Label htmlFor="ts-end" className="text-xs uppercase tracking-wider text-muted-foreground">End</Label>
              <Input
                id="ts-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[160px]"
                data-testid="input-timesheet-end"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <EmployeeTimesheetTable employeeId={userId} startDate={startDate} endDate={endDate} />
      </CardContent>
    </Card>
  );
}

export function EmployeeTimesheetTable({
  employeeId,
  startDate,
  endDate,
  showExport = false,
  exportFileName,
}: {
  employeeId: string;
  startDate: string;
  endDate: string;
  showExport?: boolean;
  exportFileName?: string;
}) {
  const { data, isLoading, isError, error } = useQuery<TimesheetResponse>({
    queryKey: ["/api/attendance/timesheet", employeeId, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`/api/attendance/timesheet/${employeeId}?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: !!employeeId && !!startDate && !!endDate && startDate <= endDate,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="timesheet-loading">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive py-4" data-testid="text-timesheet-error">
        Couldn't load this timesheet.{error instanceof Error && error.message ? ` ${error.message}` : ""}
      </p>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground py-4" data-testid="text-timesheet-empty">
        No timesheet data available.
      </p>
    );
  }

  const exportCSV = () => {
    const headers = ["Date", "Day", "Clock In", "Clock Out", "Break (min)", "Total Hours", "Overtime", "Status"];
    const rows = data.entries.map((e) => [
      e.date,
      e.dayOfWeek,
      e.clockIn ? new Date(e.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      String(e.breakMinutes || 0),
      e.totalHours != null ? formatHoursMinutes(e.totalHours) : "—",
      formatHoursMinutes(e.overtimeHours || 0),
      timesheetStatusLabel(e),
    ]);
    const totalsRow = ["Totals", "", "", "", "", formatHoursMinutes(data.totals.totalHours), formatHoursMinutes(data.totals.overtimeHours), `${data.totals.daysWorked} days worked`];
    const csv = [headers, ...rows, totalsRow]
      .map((row) => row.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName || `timesheet-${data.employeeName.replace(/\s+/g, "_")}-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3" data-testid="timesheet-table-container">
      {showExport && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={!data.entries.length}
            data-testid="button-timesheet-export-csv"
          >
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      )}
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Day</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Clock In</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Clock Out</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Break</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Total Hours</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Overtime</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => (
              <TableRow key={e.date} data-testid={`row-timesheet-${e.date}`}>
                <TableCell className="text-sm font-medium">{e.date}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{e.dayOfWeek}</TableCell>
                <TableCell className="text-sm tabular-nums" data-testid={`text-timesheet-in-${e.date}`}>
                  {e.clockIn ? new Date(e.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums" data-testid={`text-timesheet-out-${e.date}`}>
                  {e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums">{e.breakMinutes ? `${e.breakMinutes} min` : "—"}</TableCell>
                <TableCell className="text-sm font-semibold tabular-nums" data-testid={`text-timesheet-hours-${e.date}`}>
                  {e.totalHours != null ? formatHoursMinutes(e.totalHours) : "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums" data-testid={`text-timesheet-ot-${e.date}`}>
                  {e.overtimeHours > 0 ? (
                    <span className="text-amber-600 font-semibold">{formatHoursMinutes(e.overtimeHours)}</span>
                  ) : "—"}
                </TableCell>
                <TableCell data-testid={`badge-timesheet-status-${e.date}`}>
                  <TimesheetStatusBadge entry={e} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold" data-testid="row-timesheet-totals">
              <TableCell colSpan={5} className="text-right text-sm uppercase tracking-wider">Totals</TableCell>
              <TableCell className="text-sm tabular-nums" data-testid="text-timesheet-total-hours">
                {formatHoursMinutes(data.totals.totalHours)}
              </TableCell>
              <TableCell className="text-sm tabular-nums" data-testid="text-timesheet-total-overtime">
                {formatHoursMinutes(data.totals.overtimeHours)}
              </TableCell>
              <TableCell className="text-sm" data-testid="text-timesheet-days-worked">
                {data.totals.daysWorked} day{data.totals.daysWorked === 1 ? "" : "s"} worked
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-testid="text-timesheet-overtime-basis"
      >
        Daily overtime per row is calculated against the {data.otThresholdDaily}h
        daily threshold. Total overtime in the totals row uses the aggregate
        time-report formula: max(0, total hours &minus; days worked &times; 8h),
        so this number matches the Reports → Time report for the same range.
      </p>
    </div>
  );
}

function timesheetStatusLabel(e: TimesheetEntry): string {
  switch (e.status) {
    case "complete": return "Complete";
    case "overtime": return "Overtime";
    case "in_progress": return "In Progress";
    case "missing_punch": return "Missing Punch";
    case "pto": return e.ptoType ? `PTO (${e.ptoType.replace(/_/g, " ")})` : "PTO";
    default: return "—";
  }
}

function TimesheetStatusBadge({ entry }: { entry: TimesheetEntry }) {
  const label = timesheetStatusLabel(entry);
  switch (entry.status) {
    case "complete":
      return <Badge variant="default" className="bg-green-600">{label}</Badge>;
    case "overtime":
      return <Badge variant="secondary" className="bg-amber-500 text-white">{label}</Badge>;
    case "in_progress":
      return <Badge variant="outline">{label}</Badge>;
    case "missing_punch":
      return <Badge variant="destructive">{label}</Badge>;
    case "pto":
      return <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{label}</Badge>;
    default:
      return <span className="text-xs text-muted-foreground">—</span>;
  }
}
