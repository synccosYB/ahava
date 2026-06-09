import { useState, useMemo, useEffect } from "react";
import { formatHoursMinutes, getOvernightShiftInfo, formatTime12, formatTime12FromHHmm, formatDate } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { Download, Filter, ArrowUpDown, ArrowUp, ArrowDown, Send, AlertCircle, Wrench, MessageSquare, Lock, Unlock } from "lucide-react";
import type { AttendanceRecord, AttendanceException } from "@shared/schema";
import { parseExceptionTimeInfo } from "@/lib/exceptionTimeInfo";
import {
  HIGH_CORRECTION_THRESHOLD,
  type CorrectionCountSummary,
  isHighCorrectionCount,
} from "@shared/correctionCounts";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

type SortKey = "date" | "clockIn" | "totalHours" | "status";
type SortDir = "asc" | "desc";

type FixDialogState = {
  open: boolean;
  date: string;
  origIn: string;
  origOut: string;
  missingPunch: boolean;
  punchLogId?: string | null;
  editingExceptionId?: string;
  initialReqIn?: string;
  initialReqOut?: string;
  initialReason?: string;
};

function parseExceptionReason(fullReason: string): {
  reason: string;
  origIn: string;
  origOut: string;
  reqIn: string;
  reqOut: string;
} {
  const parsed = parseExceptionTimeInfo(fullReason);
  return {
    reason: parsed.cleanReason,
    origIn: parsed.origIn,
    origOut: parsed.origOut,
    reqIn: parsed.reqIn,
    reqOut: parsed.reqOut,
  };
}

function toTimeInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

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
  const [fixDialog, setFixDialog] = useState<FixDialogState>({
    open: false,
    date: "",
    origIn: "",
    origOut: "",
    missingPunch: false,
  });

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

  const { data: myExceptions, isLoading: exceptionsLoading } = useQuery<AttendanceException[]>({
    queryKey: ["/api/attendance/exceptions/my"],
    queryFn: async () => {
      const res = await fetch("/api/attendance/exceptions/my", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch exceptions");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const pendingByPunchId = useMemo(() => {
    const map = new Map<string, AttendanceException>();
    (myExceptions || []).forEach((ex) => {
      if (ex.status === "pending" && ex.punchLogId) {
        map.set(ex.punchLogId, ex);
      }
    });
    return map;
  }, [myExceptions]);

  // Pending exceptions without a specific punch reference, grouped by date.
  // These attach to the day's missing/in-progress row when one exists; if not,
  // they stay only in the "My Correction Requests" list.
  const pendingUnboundByDate = useMemo(() => {
    const map = new Map<string, AttendanceException>();
    (myExceptions || []).forEach((ex) => {
      if (ex.status === "pending" && !ex.punchLogId) {
        if (!map.has(ex.exceptionDate)) {
          map.set(ex.exceptionDate, ex);
        }
      }
    });
    return map;
  }, [myExceptions]);

  const latestResolvedByDate = useMemo(() => {
    const map = new Map<string, AttendanceException>();
    (myExceptions || []).forEach((ex) => {
      if (ex.status === "pending") return;
      const existing = map.get(ex.exceptionDate);
      const exTime = ex.createdAt ? new Date(ex.createdAt).getTime() : 0;
      const exTime2 = existing?.createdAt ? new Date(existing.createdAt).getTime() : 0;
      if (!existing || exTime > exTime2) {
        map.set(ex.exceptionDate, ex);
      }
    });
    return map;
  }, [myExceptions]);

  // Set of dates where this user has any pending unbound request — used by the
  // standalone "New Correction Request" form to block a duplicate same-date
  // standalone submission. Row-bound submissions are not blocked by this set.
  const pendingUnboundDates = useMemo(() => {
    return new Set(pendingUnboundByDate.keys());
  }, [pendingUnboundByDate]);

  const [reopenDialog, setReopenDialog] = useState<{ open: boolean; exception: AttendanceException | null }>({
    open: false,
    exception: null,
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // For each record, decide which (if any) pending exception should drive its
  // "Pending — Edit" badge. Strict per-punch first; then fall back to a single
  // missing/in-progress row per date for legacy unbound pending requests.
  const pendingForRow = useMemo(() => {
    const map = new Map<string, AttendanceException>();
    if (!records) return map;
    records.forEach((r) => {
      const direct = pendingByPunchId.get(r.id);
      if (direct) map.set(r.id, direct);
    });
    const claimedUnboundDates = new Set<string>();
    records.forEach((r) => {
      if (map.has(r.id)) return;
      const isInProgressRow = r.status === "in-progress" || !r.clockOut;
      if (!isInProgressRow) return;
      if (claimedUnboundDates.has(r.date)) return;
      const unbound = pendingUnboundByDate.get(r.date);
      if (unbound) {
        map.set(r.id, unbound);
        claimedUnboundDates.add(r.date);
      }
    });
    return map;
  }, [records, pendingByPunchId, pendingUnboundByDate]);

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
    const headers = ["Date", "Clock In", "Clock Out", "Break (min)", "Source", "Total Hours", "Status"];
    const rows = records.map((r) => [
      r.date,
      r.clockIn ? formatTime12(r.clockIn) : "",
      r.clockOut ? formatTime12(r.clockOut) : "",
      r.breakMinutes || 0,
      r.kiosk?.name
        ? `Kiosk — ${r.kiosk.name}`
        : r.kioskDeviceName
          ? `Kiosk — ${r.kioskDeviceName}`
          : r.kioskDeviceId
            ? "Kiosk"
            : "Web",
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

  const openFixDialog = (record: AttendanceRecord) => {
    const missingPunch = record.status === "in-progress" || !record.clockOut;
    setFixDialog({
      open: true,
      date: record.date,
      origIn: toTimeInputValue(record.clockIn),
      origOut: toTimeInputValue(record.clockOut),
      missingPunch,
      // Tie the new request to the punch the employee is looking at so the
      // resolve handler updates that exact punch — not whichever happens to
      // be the most recent on this date. Missing-punch flows leave it null
      // because there's no existing punch to attach to yet.
      punchLogId: missingPunch ? null : record.id,
    });
  };

  const openEditDialog = (ex: AttendanceException) => {
    const parsed = parseExceptionReason(ex.reason || "");
    setFixDialog({
      open: true,
      date: ex.exceptionDate,
      origIn: parsed.origIn,
      origOut: parsed.origOut,
      missingPunch: ex.type === "missing_punch",
      punchLogId: ex.punchLogId ?? null,
      editingExceptionId: ex.id,
      initialReqIn: parsed.reqIn,
      initialReqOut: parsed.reqOut,
      initialReason: parsed.reason,
    });
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
              <span>Showing {formatDate(startDate)} to {formatDate(endDate)}</span>
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
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Source</TableHead>
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
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRecords.map((record) => {
                  const isInProgress = record.status === "in-progress" || !record.clockOut;
                  const pendingException = pendingForRow.get(record.id);
                  const hasPending = !!pendingException;
                  const overnightInfo = getOvernightShiftInfo(record.date, record.clockOut);
                  return (
                    <TableRow key={record.id} data-testid={`row-attendance-${record.id}`}>
                      <TableCell className="text-sm font-medium">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{formatDate(record.date)}</span>
                          {overnightInfo && (
                            <>
                              <span className="text-muted-foreground" aria-hidden="true">→</span>
                              <span data-testid={`text-shift-end-date-${record.id}`}>
                                {formatDate(overnightInfo.endDate)}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    tabIndex={0}
                                    data-testid={`badge-overnight-${record.id}`}
                                    className="inline-flex"
                                  >
                                    <Badge
                                      variant="outline"
                                      className="border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                                    >
                                      +{overnightInfo.daysSpan}d
                                    </Badge>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {overnightInfo.daysSpan === 1
                                    ? "Overnight shift"
                                    : `Spanned ${overnightInfo.daysSpan} days`}
                                  {" "}• Ended {formatDate(overnightInfo.endDate)} at {overnightInfo.endTime}
                                </TooltipContent>
                              </Tooltip>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {record.clockIn
                          ? formatTime12(record.clockIn)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {record.clockOut
                          ? (
                            <span className="inline-flex items-baseline gap-1">
                              <span>{formatTime12(record.clockOut)}</span>
                              {overnightInfo && (
                                <span
                                  className="text-xs text-muted-foreground"
                                  data-testid={`text-shift-end-time-date-${record.id}`}
                                >
                                  ({overnightInfo.endDateLabel})
                                </span>
                              )}
                            </span>
                          )
                          : (
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400" data-testid={`hint-missing-clock-out-${record.id}`}>
                              <AlertCircle className="h-3 w-3" />
                              <span className="text-xs">Missing clock-out – request a fix</span>
                            </span>
                          )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{record.breakMinutes || 0} min</TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        data-testid={`text-attendance-source-${record.id}`}
                      >
                        {record.kiosk?.name
                          ? `Kiosk — ${record.kiosk.name}`
                          : record.kioskDeviceName
                            ? `Kiosk — ${record.kioskDeviceName}`
                            : record.kioskDeviceId
                              ? "Kiosk"
                              : "Web"}
                      </TableCell>
                      <TableCell className="text-sm font-semibold tabular-nums">
                        {record.totalHours != null ? formatHoursMinutes(record.totalHours) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {getStatusBadge(record.status)}
                          {record.wasCorrected && (
                            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300" data-testid={`badge-corrected-${record.id}`}>
                              Corrected
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          if (hasPending && pendingException) {
                            return (
                              <button
                                type="button"
                                onClick={() => openEditDialog(pendingException)}
                                title="Edit your pending correction request"
                                data-testid={`badge-pending-fix-${record.id}`}
                                className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
                              >
                                Pending — Edit
                              </button>
                            );
                          }

                          const resolvedEx = latestResolvedByDate.get(record.date);
                          const reopenGrantedUnused =
                            resolvedEx?.reopenStatus === "granted" && !resolvedEx?.reopenConsumedAt;

                          if (resolvedEx && !reopenGrantedUnused) {
                            return (
                              <ResolvedActionCell
                                record={record}
                                exception={resolvedEx}
                                onAskToReopen={(ex) => setReopenDialog({ open: true, exception: ex })}
                              />
                            );
                          }

                          return (
                            <div className="flex flex-col items-end gap-1">
                              {reopenGrantedUnused && (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  data-testid={`badge-reopen-granted-${record.id}`}
                                >
                                  <Unlock className="h-3 w-3 mr-1" />
                                  Reopen granted
                                </Badge>
                              )}
                              <Button
                                size="sm"
                                variant={isInProgress ? "default" : "outline"}
                                onClick={() => openFixDialog(record)}
                                disabled={exceptionsLoading}
                                title={exceptionsLoading ? "Loading correction requests..." : undefined}
                                data-testid={`button-request-fix-${record.id}`}
                              >
                                <Wrench className="h-3 w-3 mr-1" />
                                Request Fix
                              </Button>
                            </div>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PunchCorrectionForm
        myExceptions={myExceptions}
        exceptionsLoading={exceptionsLoading}
        pendingDates={pendingUnboundDates}
        pendingPunchIds={pendingByPunchId}
        records={records}
        onEdit={openEditDialog}
      />

      <Dialog
        open={fixDialog.open}
        onOpenChange={(open) => setFixDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-lg" data-testid="dialog-request-fix">
          <DialogHeader>
            <DialogTitle>
              {fixDialog.editingExceptionId
                ? "Edit Pending Correction Request"
                : fixDialog.missingPunch
                  ? "Request Missing Punch Fix"
                  : "Request Time Correction"}
            </DialogTitle>
            <DialogDescription>
              {fixDialog.editingExceptionId
                ? "Update the times or reason for your pending correction request. Your manager will see the latest version."
                : fixDialog.missingPunch
                  ? "Your shift on this date is missing a clock-out. Fill in what time you actually finished and submit the request to your manager."
                  : "Update the recorded times for this date and submit the correction to your manager."}
            </DialogDescription>
          </DialogHeader>
          <CorrectionFormBody
            key={fixDialog.editingExceptionId || fixDialog.punchLogId || fixDialog.date || "new"}
            initialDate={fixDialog.date}
            initialOrigIn={fixDialog.origIn}
            initialOrigOut={fixDialog.origOut}
            initialReqIn={fixDialog.initialReqIn ?? fixDialog.origIn}
            initialReqOut={fixDialog.initialReqOut ?? (fixDialog.missingPunch ? "" : fixDialog.origOut)}
            initialReason={fixDialog.initialReason}
            missingPunch={fixDialog.missingPunch}
            editingExceptionId={fixDialog.editingExceptionId}
            punchLogId={fixDialog.punchLogId ?? null}
            pendingPunchIds={pendingByPunchId}
            lockDate
            onSuccess={() => setFixDialog((prev) => ({ ...prev, open: false }))}
          />
        </DialogContent>
      </Dialog>

      <ReopenRequestDialog
        open={reopenDialog.open}
        exception={reopenDialog.exception}
        onClose={() => setReopenDialog({ open: false, exception: null })}
      />
    </div>
  );
}

type CorrectionFormBodyProps = {
  initialDate?: string;
  initialOrigIn?: string;
  initialOrigOut?: string;
  initialReqIn?: string;
  initialReqOut?: string;
  initialReason?: string;
  missingPunch?: boolean;
  lockDate?: boolean;
  pendingDates?: Set<string>;
  pendingPunchIds?: Map<string, AttendanceException>;
  punchLogId?: string | null;
  editingExceptionId?: string;
  records?: AttendanceRecord[];
  onSuccess?: () => void;
};

function CorrectionFormBody({
  initialDate = "",
  initialOrigIn = "",
  initialOrigOut = "",
  initialReqIn = "",
  initialReqOut = "",
  initialReason,
  missingPunch = false,
  lockDate = false,
  pendingDates,
  pendingPunchIds,
  punchLogId,
  editingExceptionId,
  records,
  onSuccess,
}: CorrectionFormBodyProps) {
  const { toast } = useToast();
  const isEditing = !!editingExceptionId;
  const defaultReason = initialReason ?? (missingPunch ? "I forgot to clock out at the end of my shift." : "");
  const [date, setDate] = useState(initialDate);
  const [reqIn, setReqIn] = useState(initialReqIn);
  const [reqOut, setReqOut] = useState(initialReqOut);
  const [reason, setReason] = useState(defaultReason);

  // In the standalone "New Correction Request" card we receive the loaded
  // attendance records and look up the punch for the selected date so the
  // read-only Original Punch fields auto-fill (mirroring the Request Fix
  // dialog). When no record matches, treat it as a missing-punch request with
  // empty originals so the user can still submit corrected times.
  const isLookupMode = !!records && !lockDate;
  const matchedRecord = isLookupMode && date ? records!.find((r) => r.date === date) : undefined;
  const effectiveMissingPunch = isLookupMode
    ? (matchedRecord ? (matchedRecord.status === "in-progress" || !matchedRecord.clockOut) : true)
    : missingPunch;
  const origIn = isLookupMode
    ? (matchedRecord ? toTimeInputValue(matchedRecord.clockIn) : "")
    : initialOrigIn;
  const origOut = isLookupMode
    ? (matchedRecord ? toTimeInputValue(matchedRecord.clockOut) : "")
    : initialOrigOut;
  const effectivePunchLogId = isLookupMode
    ? (matchedRecord && !effectiveMissingPunch ? matchedRecord.id : null)
    : (punchLogId ?? null);
  const noPunchForDate = isLookupMode && !!date && !matchedRecord;

  // Block duplicates on a per-punch basis when a punch is linked, otherwise
  // fall back to the legacy per-date check (which now only counts pending
  // requests with no punch reference — see `pendingUnboundDates`).
  const hasPendingForPunch =
    !isEditing && !!effectivePunchLogId && !!pendingPunchIds && pendingPunchIds.has(effectivePunchLogId);
  const hasPendingForDate =
    !isEditing &&
    !effectivePunchLogId &&
    !!(date && pendingDates && pendingDates.has(date));
  const blockDuplicate = hasPendingForPunch || hasPendingForDate;
  const duplicateMessage = hasPendingForPunch
    ? "A correction request for this punch is already pending review."
    : "A correction request for this date is already pending review.";

  const correctionCountKey = isEditing
    ? ["/api/attendance/exceptions/correction-counts/me", { excludeId: editingExceptionId }]
    : ["/api/attendance/exceptions/correction-counts/me"];

  const { data: correctionCount } = useQuery<CorrectionCountSummary>({
    queryKey: correctionCountKey,
    queryFn: async () => {
      const url = isEditing
        ? `/api/attendance/exceptions/correction-counts/me?excludeId=${encodeURIComponent(editingExceptionId!)}`
        : `/api/attendance/exceptions/correction-counts/me`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch correction count");
      return res.json();
    },
  });

  const displayCount = correctionCount?.total ?? 0;
  const nextOrdinal = ordinal(displayCount + 1);
  const isHighCount = isHighCorrectionCount(displayCount);

  useEffect(() => {
    setDate(initialDate);
    setReqIn(initialReqIn);
    setReqOut(initialReqOut);
    setReason(initialReason ?? (missingPunch ? "I forgot to clock out at the end of my shift." : ""));
  }, [initialDate, initialReqIn, initialReqOut, initialReason, missingPunch]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const timeInfo = [];
      if (origIn) timeInfo.push(`Original In: ${origIn}`);
      if (origOut) timeInfo.push(`Original Out: ${origOut}`);
      if (reqIn) timeInfo.push(`Corrected In: ${reqIn}`);
      if (reqOut) timeInfo.push(`Corrected Out: ${reqOut}`);
      const fullReason = `${reason}${timeInfo.length > 0 ? ` [${timeInfo.join(", ")}]` : ""}`;
      const payload: Record<string, unknown> = {
        exceptionDate: date,
        type: effectiveMissingPunch ? "missing_punch" : "time_correction",
        reason: fullReason,
      };
      if (isEditing) {
        // Allow callers to clear or change the punch target on edit by
        // explicitly sending punchLogId (null clears it).
        if (!effectiveMissingPunch) {
          payload.punchLogId = effectivePunchLogId;
        }
        return apiRequest("PATCH", `/api/attendance/exceptions/${editingExceptionId}`, payload);
      }
      if (effectivePunchLogId) {
        payload.punchLogId = effectivePunchLogId;
      }
      return apiRequest("POST", "/api/attendance/exceptions", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/correction-counts/me"] });
      if (!lockDate && !isEditing) {
        setDate("");
        setReqIn("");
        setReqOut("");
        setReason("");
      }
      toast({
        title: isEditing ? "Correction Updated" : "Correction Submitted",
        description: isEditing
          ? "Your changes have been sent to your manager."
          : "Your punch correction has been sent to your manager.",
      });
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Date of Punch</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={lockDate}
          data-testid="input-correction-date"
        />
      </div>

      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4" data-testid="section-original-punch">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Original Punch (what was recorded)</div>
        <p className="text-xs text-muted-foreground mb-3" data-testid="text-original-punch-help">
          These times come from your recorded attendance and can't be edited.
        </p>
        {noPunchForDate ? (
          <div
            className="flex items-start gap-2 rounded-md border border-dashed border-gray-300 dark:border-gray-700 bg-muted/30 px-3 py-3 text-sm text-muted-foreground"
            data-testid="text-no-punch-recorded"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>No punch recorded for this date. Enter the times you actually worked below and submit it as a missing-punch request.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Clock In</Label>
              <div
                className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-mono text-foreground select-text cursor-default"
                aria-readonly="true"
                data-testid="display-orig-clock-in"
              >
                {origIn ? formatTime12FromHHmm(origIn) : <span className="text-muted-foreground">—</span>}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Clock Out</Label>
              <div
                className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-mono text-foreground select-text cursor-default"
                aria-readonly="true"
                data-testid="display-orig-clock-out"
              >
                {origOut ? formatTime12FromHHmm(origOut) : <span className="text-muted-foreground">{effectiveMissingPunch ? "missing" : "—"}</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4" data-testid="section-corrected-punch">
        <div className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-3">
          Corrected Times (what it should be)
        </div>
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
            <Label className="text-xs text-blue-700 dark:text-blue-300">
              Clock Out{effectiveMissingPunch ? " (required)" : ""}
            </Label>
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
          placeholder={effectiveMissingPunch ? "Explain why a clock-out is missing..." : "Explain what happened..."}
          data-testid="input-correction-reason"
        />
      </div>

      {correctionCount && (
        <div
          className={`text-xs rounded-md border px-3 py-2 ${
            isHighCount
              ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              : "border-muted bg-muted/30 text-muted-foreground"
          }`}
          data-testid="text-self-correction-count"
        >
          {displayCount === 0 ? (
            <>This will be your first correction request in the last {correctionCount.windowDays} days.</>
          ) : (
            <>
              This is your {nextOrdinal} correction request in the last {correctionCount.windowDays} days.
              {isHighCount && (
                <span className="ml-1 font-medium">
                  Frequent corrections may be a sign to double-check your clock-in/out.
                </span>
              )}
            </>
          )}
        </div>
      )}
      {blockDuplicate && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-duplicate-warning">
          {duplicateMessage}
        </p>
      )}
      <Button
        onClick={() => submitMutation.mutate()}
        disabled={!date || !reason || submitMutation.isPending || (effectiveMissingPunch && !reqOut) || blockDuplicate}
        className="w-full"
        data-testid="button-submit-correction"
      >
        <Send className="h-4 w-4 mr-1" />
        {submitMutation.isPending
          ? (isEditing ? "Saving..." : "Submitting...")
          : (isEditing ? "Save Changes" : "Submit Correction")}
      </Button>
    </div>
  );
}

function verdictBadge(status: string, testIdSuffix: string) {
  if (status === "approved") {
    return (
      <Badge
        className="bg-green-600 hover:bg-green-600"
        data-testid={`badge-verdict-approved-${testIdSuffix}`}
      >
        Approved
      </Badge>
    );
  }
  if (status === "denied") {
    return (
      <Badge variant="destructive" data-testid={`badge-verdict-denied-${testIdSuffix}`}>
        Denied
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      data-testid={`badge-verdict-cancelled-${testIdSuffix}`}
    >
      Cancelled
    </Badge>
  );
}

type ResolvedActionCellProps = {
  record: AttendanceRecord;
  exception: AttendanceException;
  onAskToReopen: (ex: AttendanceException) => void;
};

function ResolvedActionCell({ record, exception, onAskToReopen }: ResolvedActionCellProps) {
  return (
    <div className="flex flex-col items-end gap-1">
      {verdictBadge(exception.status, record.id)}
      {exception.reopenStatus === "pending" ? (
        <span
          className="inline-flex items-center text-[11px] text-muted-foreground"
          data-testid={`text-reopen-pending-${record.id}`}
        >
          <MessageSquare className="h-3 w-3 mr-1" />
          Reopen requested
        </span>
      ) : exception.reopenStatus === "declined" ? (
        <span
          className="inline-flex items-center text-[11px] text-muted-foreground"
          data-testid={`text-reopen-declined-${record.id}`}
        >
          <Lock className="h-3 w-3 mr-1" />
          Reopen declined
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => onAskToReopen(exception)}
          data-testid={`button-ask-reopen-${record.id}`}
        >
          <MessageSquare className="h-3 w-3 mr-1" />
          Ask to reopen
        </Button>
      )}
    </div>
  );
}

type ReopenRequestDialogProps = {
  open: boolean;
  exception: AttendanceException | null;
  onClose: () => void;
};

function ReopenRequestDialog({ open, exception, onClose }: ReopenRequestDialogProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) setMessage("");
  }, [open, exception?.id]);

  const reopenMutation = useMutation({
    mutationFn: async (vars: { id: string; message: string }) => {
      return apiRequest("POST", `/api/attendance/exceptions/${vars.id}/reopen-request`, {
        message: vars.message,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      toast({
        title: "Reopen request sent",
        description: "Your manager will review and decide whether to reopen this correction.",
      });
      onClose();
    },
    onError: (error: unknown) => {
      const description = error instanceof Error ? error.message : "Could not send your reopen request.";
      toast({ title: "Reopen request failed", description, variant: "destructive" });
    },
  });

  const trimmed = message.trim();
  const tooLong = trimmed.length > 1000;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-reopen-request">
        <DialogHeader>
          <DialogTitle>Ask to reopen this correction</DialogTitle>
          <DialogDescription>
            {exception ? (
              <>
                Send your manager a short note explaining why the correction for{" "}
                <span className="font-medium">{exception.exceptionDate}</span> should be revisited. You can only send one reopen request per resolved correction.
              </>
            ) : (
              "Send your manager a short note explaining why this correction should be revisited."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reopen-message">Message to your manager</Label>
          <Textarea
            id="reopen-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. I forgot to mention that I worked through lunch — could we take another look?"
            rows={4}
            data-testid="textarea-reopen-message"
          />
          <p className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
            {trimmed.length}/1000 characters
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={reopenMutation.isPending}
            data-testid="button-cancel-reopen"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!exception) return;
              if (!trimmed) {
                toast({
                  title: "Message required",
                  description: "Please add a short explanation before sending.",
                  variant: "destructive",
                });
                return;
              }
              if (tooLong) return;
              reopenMutation.mutate({ id: exception.id, message: trimmed });
            }}
            disabled={!exception || !trimmed || tooLong || reopenMutation.isPending}
            data-testid="button-submit-reopen"
          >
            <Send className="h-3 w-3 mr-1" />
            Send request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PunchCorrectionFormProps = {
  myExceptions?: AttendanceException[];
  exceptionsLoading: boolean;
  pendingDates?: Set<string>;
  pendingPunchIds?: Map<string, AttendanceException>;
  records?: AttendanceRecord[];
  onEdit?: (ex: AttendanceException) => void;
};

function PunchCorrectionForm({ myExceptions, exceptionsLoading, pendingDates, pendingPunchIds, records, onEdit }: PunchCorrectionFormProps) {
  const { toast } = useToast();
  const getStatusBadgeForException = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Pending</Badge>;
      case "approved": return <Badge variant="default" className="bg-green-600">Approved</Badge>;
      case "denied": return <Badge variant="destructive">Denied</Badge>;
      case "cancelled": return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/attendance/exceptions/${id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/exceptions/correction-counts/me"] });
      toast({ title: "Request Cancelled", description: "Your correction request has been cancelled." });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Could not cancel the correction request.";
      toast({
        title: "Failed to cancel",
        description: message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Punch Correction Request</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-punch-correction-form">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Correction Request</CardTitle>
          </CardHeader>
          <CardContent>
            <CorrectionFormBody pendingDates={pendingDates} pendingPunchIds={pendingPunchIds} records={records} />
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
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(ex.exceptionDate)}</span>
                        {ex.status === "pending" && onEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={() => onEdit(ex)}
                            data-testid={`button-edit-correction-${ex.id}`}
                          >
                            <Wrench className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                        {ex.status === "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Cancel this pending correction request? This cannot be undone.")) {
                                cancelMutation.mutate(ex.id);
                              }
                            }}
                            disabled={cancelMutation.isPending}
                            data-testid={`button-cancel-correction-${ex.id}`}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
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
