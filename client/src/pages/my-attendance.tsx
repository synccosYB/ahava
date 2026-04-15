import { useState, useMemo } from "react";
import { formatHoursMinutes } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { Download, Filter, ArrowUpDown, ArrowUp, ArrowDown, Send } from "lucide-react";
import type { AttendanceRecord, AttendanceException } from "@shared/schema";

type SortKey = "date" | "clockIn" | "totalHours" | "status";
type SortDir = "asc" | "desc";

export default function MyAttendance() {
  const { isAuthenticated } = useAuth();

  const getDefaultStartDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  };

  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: records, isLoading, isError } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance/records", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/api/attendance/records?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedRecords = useMemo(() => {
    if (!records) return [];
    return [...records].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "date":
          return dir * (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        case "clockIn": {
          const aTime = a.clockIn ? new Date(a.clockIn).getTime() : 0;
          const bTime = b.clockIn ? new Date(b.clockIn).getTime() : 0;
          return dir * (aTime - bTime);
        }
        case "totalHours":
          return dir * ((a.totalHours || 0) - (b.totalHours || 0));
        case "status":
          return dir * (a.status < b.status ? -1 : a.status > b.status ? 1 : 0);
        default:
          return 0;
      }
    });
  }, [records, sortKey, sortDir]);

  const stats = useMemo(() => {
    if (!records || records.length === 0) return { totalHours: 0, daysWorked: 0, dailyAvg: 0 };
    const completedRecords = records.filter((r) => r.totalHours != null);
    const totalHours = completedRecords.reduce((sum, r) => sum + (r.totalHours || 0), 0);
    const daysWorked = new Set(completedRecords.map((r) => r.workDate)).size;
    const dailyAvg = daysWorked > 0 ? totalHours / daysWorked : 0;
    return {
      totalHours: Math.round(totalHours * 10) / 10,
      daysWorked,
      dailyAvg: Math.round(dailyAvg * 10) / 10,
    };
  }, [records]);

  const exportCSV = () => {
    if (!records || records.length === 0) return;
    const headers = ["Date", "Clock In", "Clock Out", "Break (min)", "Total Hours", "Status"];
    const rows = records.map((r) => [
      r.date,
      r.clockIn ? new Date(r.clockIn).toLocaleTimeString() : "",
      r.clockOut ? new Date(r.clockOut).toLocaleTimeString() : "",
      r.breakMinutes || 0,
      r.totalHours != null ? formatHoursMinutes(r.totalHours) : "",
      r.status,
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "complete":
        return <Badge variant="default" className="bg-green-600" data-testid="badge-status-complete">Complete</Badge>;
      case "overtime":
        return <Badge variant="secondary" className="bg-amber-500 text-white" data-testid="badge-status-overtime">Overtime</Badge>;
      case "in-progress":
        return <Badge variant="outline" data-testid="badge-status-in-progress">In Progress</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 h-3 w-3 inline text-primary" />
      : <ArrowDown className="ml-1 h-3 w-3 inline text-primary" />;
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Attendance History"
        subtitle="View and export your attendance records"
        actions={
          <Button onClick={exportCSV} disabled={!records || records.length === 0} data-testid="button-export-csv">
            <Download className="mr-2 h-4 w-4" />
            Export to CSV
          </Button>
        }
      />

      <Card data-testid="card-date-filter">
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="start-date" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-date" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span>Showing {startDate} to {endDate}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-stats">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 text-center">
              <div data-testid="stat-total-hours">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-semibold tabular-nums">{formatHoursMinutes(stats.totalHours)}</p>
              </div>
              <div data-testid="stat-days-worked">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Days Worked</p>
                <p className="text-2xl font-semibold tabular-nums">{stats.daysWorked}</p>
              </div>
              <div data-testid="stat-daily-average">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Daily Average</p>
                <p className="text-2xl font-semibold tabular-nums">{formatHoursMinutes(stats.dailyAvg)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-attendance-table">
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : isError ? (
            <p className="text-center text-destructive py-8 text-sm" data-testid="text-error">
              Failed to load attendance records. Please try again.
            </p>
          ) : !records || records.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm" data-testid="text-no-records">
              No attendance records found for this date range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("date")}
                      className="flex items-center hover:text-foreground transition-colors"
                      data-testid="sort-date"
                    >
                      Date <SortIcon column="date" />
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("clockIn")}
                      className="flex items-center hover:text-foreground transition-colors"
                      data-testid="sort-clock-in"
                    >
                      Clock In <SortIcon column="clockIn" />
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Clock Out</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Break</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("totalHours")}
                      className="flex items-center hover:text-foreground transition-colors"
                      data-testid="sort-total-hours"
                    >
                      Total Hours <SortIcon column="totalHours" />
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("status")}
                      className="flex items-center hover:text-foreground transition-colors"
                      data-testid="sort-status"
                    >
                      Status <SortIcon column="status" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRecords.map((record) => (
                  <TableRow key={record.id} data-testid={`row-attendance-${record.id}`}>
                    <TableCell className="text-sm font-medium">{record.date}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {record.clockIn
                        ? new Date(record.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {record.clockOut
                        ? new Date(record.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{record.breakMinutes || 0} min</TableCell>
                    <TableCell className="text-sm font-semibold tabular-nums">
                      {record.totalHours != null ? formatHoursMinutes(record.totalHours) : "—"}
                    </TableCell>
                    <TableCell>{getStatusBadge(record.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PunchCorrectionForm />
    </div>
  );
}

function PunchCorrectionForm() {
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [origIn, setOrigIn] = useState("");
  const [origOut, setOrigOut] = useState("");
  const [reqIn, setReqIn] = useState("");
  const [reqOut, setReqOut] = useState("");
  const [reason, setReason] = useState("");

  const { data: myExceptions, isLoading: exceptionsLoading } = useQuery<AttendanceException[]>({
    queryKey: ["/api/attendance/exceptions/my"],
    queryFn: async () => {
      const res = await fetch("/api/attendance/exceptions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch exceptions");
      return res.json();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const timeInfo = [];
      if (origIn) timeInfo.push(`Original In: ${origIn}`);
      if (origOut) timeInfo.push(`Original Out: ${origOut}`);
      if (reqIn) timeInfo.push(`Corrected In: ${reqIn}`);
      if (reqOut) timeInfo.push(`Corrected Out: ${reqOut}`);
      const fullReason = `${reason}${timeInfo.length > 0 ? ` [${timeInfo.join(", ")}]` : ""}`;
      return apiRequest("POST", "/api/attendance/exceptions", {
        exceptionDate: date,
        type: "time_correction",
        reason: fullReason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      setDate("");
      setOrigIn("");
      setOrigOut("");
      setReqIn("");
      setReqOut("");
      setReason("");
      toast({ title: "Correction Submitted", description: "Your punch correction has been sent to your manager." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getStatusBadgeForException = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>;
      case "approved": return <Badge variant="default" className="bg-green-600">Approved</Badge>;
      case "denied": return <Badge variant="destructive">Denied</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Punch Correction Request</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-punch-correction-form">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Correction Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Date of Punch</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="input-correction-date"
              />
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4" data-testid="section-original-punch">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Original Punch (what was recorded)</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Clock In</Label>
                  <Input
                    type="time"
                    value={origIn}
                    onChange={(e) => setOrigIn(e.target.value)}
                    data-testid="input-orig-clock-in"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Clock Out</Label>
                  <Input
                    type="time"
                    value={origOut}
                    onChange={(e) => setOrigOut(e.target.value)}
                    data-testid="input-orig-clock-out"
                  />
                </div>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4" data-testid="section-corrected-punch">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">Corrected Times (what it should be)</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-blue-700 dark:text-blue-300">Clock In</Label>
                  <Input
                    type="time"
                    value={reqIn}
                    onChange={(e) => setReqIn(e.target.value)}
                    data-testid="input-corrected-clock-in"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-blue-700 dark:text-blue-300">Clock Out</Label>
                  <Input
                    type="time"
                    value={reqOut}
                    onChange={(e) => setReqOut(e.target.value)}
                    data-testid="input-corrected-clock-out"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reason</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain what happened..."
                data-testid="input-correction-reason"
              />
            </div>

            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!date || !reason || submitMutation.isPending}
              className="w-full"
              data-testid="button-submit-correction"
            >
              <Send className="h-4 w-4 mr-1" />
              {submitMutation.isPending ? "Submitting..." : "Submit Correction"}
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-my-corrections">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My Correction Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {exceptionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : !myExceptions || myExceptions.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-sm" data-testid="text-no-corrections">
                No correction requests yet.
              </p>
            ) : (
              <div className="space-y-3">
                {myExceptions.map((ex) => (
                  <div key={ex.id} className="rounded-md border p-3" data-testid={`card-correction-${ex.id}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      {getStatusBadgeForException(ex.status)}
                      <span className="text-xs text-muted-foreground">{ex.exceptionDate}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{ex.reason}</p>
                    {ex.reviewNotes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">Review: {ex.reviewNotes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
