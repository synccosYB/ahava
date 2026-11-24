import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, CalendarDays, AlertCircle, Plus, Trash2, Scissors, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/empty-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { formatHoursMinutes, formatDate, formatTime12InTz } from "@/lib/utils";

// ISO <-> <input type="datetime-local"> in the viewer's local (clinic Eastern)
// time, matching the app-wide punch-edit dialogs.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Raw punch, for the editable surface (ids + both clock times so a single-field
// inline edit can send the whole punch and revert can restore it).
type RawPunch = {
  id: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string | null;
  source: string | null;
};

export type TimesheetStatus = "complete" | "in_progress" | "missing_punch" | "overtime" | "pto" | "confirmation" | "error" | "none";

// One worked shift within a day. A day with a lunch gap longer than an hour is
// shown as two (or more) of these — a separate line per shift, same date.
export type TimesheetSegment = {
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  hours: number;
  clockInPunchId: string | null;
  clockOutPunchId: string | null;
};

export type TimesheetEntry = {
  date: string;
  dayOfWeek: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  // Per-shift breakdown. Present when the day has completed punches; the table
  // shows a line per shift when there is more than one (a >1h lunch splits the
  // day). Absent/one → the single day row is shown.
  segments?: TimesheetSegment[];
  totalHours: number | null;
  // Worked hours for REFERENCE (attendance-only employees paid per day): shown
  // muted, not counted toward pay. null when totalHours is the pay basis.
  referenceHours?: number | null;
  overtimeHours: number;
  status: TimesheetStatus;
  ptoType: string | null;
  // Day-of-week bonus money earned this day (e.g. a $20 Sunday bonus). Absent
  // for viewers without pay access.
  bonusAmount?: number;
  sources?: Array<{
    kioskDeviceId: string | null;
    kioskName: string | null;
    kiosk: { id: string; name: string } | null;
  }>;
};

function formatMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function formatSources(sources: TimesheetEntry["sources"]): string {
  if (!sources || sources.length === 0) return "—";
  const labels = sources.map((s) => s.kiosk?.name ?? s.kioskName ?? (s.kioskDeviceId ? "Kiosk" : "Web"));
  return Array.from(new Set(labels)).join(", ");
}

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
    // Total day-of-week bonus money for the range (e.g. two $20 Sundays → $40).
    // null when the viewer may not see pay; may be absent on older responses.
    totalBonus?: number | null;
  };
  // When true (per-day / attendance-only employees), the summary emphasizes DAYS
  // worked over hours. Absent on older responses → treated as false.
  emphasizeDays?: boolean;
  // Business/location timezone so clock-in/out render in the medical center's
  // wall-clock time, not the viewer's device timezone.
  timezone?: string | null;
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
  showEmployeeName = false,
  navSlot,
  editable = false,
}: {
  employeeId: string;
  startDate: string;
  endDate: string;
  showExport?: boolean;
  exportFileName?: string;
  // Show the employee's name inside the summary bar (used on the profile tab so
  // the name sits right next to the totals — no scrolling up to the page title).
  showEmployeeName?: boolean;
  // Period navigation (◀ / ▶ / Current + range label) rendered INSIDE the
  // summary bar, so the totals and the controls that change them share one spot.
  navSlot?: ReactNode;
  // When true, each row gets a pencil that opens one popup to edit that day's
  // clock-in, clock-out and work date, plus Add / Split / Delete. Needs
  // attendance.edit (delete needs attendance.delete).
  editable?: boolean;
}) {
  const { data, isLoading, isError } = useQuery<TimesheetResponse>({
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

  // ── Inline editing (Time Sheet Review only) ──────────────────────────────
  const { has } = usePermissions();
  const { toast } = useToast();
  const canEdit = editable && has("attendance.edit");
  const canDelete = editable && has("attendance.delete");

  // Raw punches back the editable clock cells: a single-field inline edit sends
  // the whole punch, and Revert restores it. Only fetched when editing.
  const { data: punchData } = useQuery<{ punches: RawPunch[] }>({
    queryKey: ["/api/attendance/punches", employeeId, startDate, endDate],
    queryFn: async () => {
      const p = new URLSearchParams({ employeeId, startDate, endDate });
      const res = await fetch(`/api/attendance/punches?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load punches");
      return res.json();
    },
    enabled: canEdit && !!employeeId && !!startDate && !!endDate,
  });
  const punchById = useMemo(() => {
    const m = new Map<string, RawPunch>();
    for (const p of punchData?.punches ?? []) m.set(p.id, p);
    return m;
  }, [punchData]);
  // Raw punches keyed by work date — used to make a missing-punch day (which has
  // no completed pair, so no segment) editable: the day's one open/missing punch
  // is bound to the row so the reviewer can fill in the side that's blank.
  const punchesByDate = useMemo(() => {
    const m = new Map<string, RawPunch[]>();
    for (const p of punchData?.punches ?? []) {
      const arr = m.get(p.workDate) ?? [];
      arr.push(p);
      m.set(p.workDate, arr);
    }
    return m;
  }, [punchData]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
  };

  // Edit dialog — a pencil on each row opens one popup to edit that day's
  // clock-in, clock-out AND work date (plus an optional reason), all in one place.
  const [editPunch, setEditPunch] = useState<RawPunch | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editWorkDate, setEditWorkDate] = useState("");
  const [editReason, setEditReason] = useState("");
  const openEdit = (p: RawPunch) => {
    setEditPunch(p);
    setEditIn(toLocalInput(p.clockIn));
    // A missing clock-out carries only a placeholder; start it empty so the real
    // time is entered rather than the placeholder edited.
    setEditOut(p.status === "missing_clockout" ? "" : toLocalInput(p.clockOut));
    setEditWorkDate(p.workDate);
    setEditReason("");
  };

  const editMutation = useMutation({
    mutationFn: async (vars: { id: string; clockIn: string | null; clockOut: string | null; workDate: string; reason: string }) => {
      const res = await apiRequest("PATCH", `/api/attendance/punches/${vars.id}`, {
        clockIn: vars.clockIn, clockOut: vars.clockOut, workDate: vars.workDate, reason: vars.reason,
      });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Punch updated" }); invalidate(); setEditPunch(null); },
    onError: (err: any) => toast({ title: "Could not save punch", description: err?.message ?? "Please try again.", variant: "destructive" }),
  });
  const submitEdit = () => {
    if (!editPunch) return;
    editMutation.mutate({
      id: editPunch.id,
      clockIn: fromLocalInput(editIn),
      clockOut: fromLocalInput(editOut),
      workDate: editWorkDate,
      reason: editReason.trim(),
    });
  };

  // Add / Delete / Split — the less-common repairs, kept as compact controls.
  const [addOpen, setAddOpen] = useState(false);
  const [addIn, setAddIn] = useState("");
  const [addOut, setAddOut] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; date: string } | null>(null);
  const [splitTarget, setSplitTarget] = useState<RawPunch | null>(null);
  const [splitDay1Out, setSplitDay1Out] = useState("");
  const [splitNewIn, setSplitNewIn] = useState("");
  const [splitNewOut, setSplitNewOut] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/attendance/punches`, {
        employeeId, clockIn: fromLocalInput(addIn), clockOut: fromLocalInput(addOut), reason: "Added on Time Sheet Review",
      });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Punch added" }); invalidate(); setAddOpen(false); },
    onError: (err: any) => toast({ title: "Could not add punch", description: err?.message ?? "Please try again.", variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/attendance/punches/${id}`, { reason: "Deleted on Time Sheet Review" });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Punch deleted" }); invalidate(); setDeleteTarget(null); },
    onError: (err: any) => toast({ title: "Could not delete punch", description: err?.message ?? "Please try again.", variant: "destructive" }),
  });
  const splitMutation = useMutation({
    mutationFn: async () => {
      if (!splitTarget) return;
      await apiRequest("PATCH", `/api/attendance/punches/${splitTarget.id}`, {
        clockOut: fromLocalInput(splitDay1Out), reason: "Split shift: set the real clock-out for the first shift",
      });
      await apiRequest("POST", `/api/attendance/punches`, {
        employeeId, clockIn: fromLocalInput(splitNewIn), clockOut: fromLocalInput(splitNewOut),
        reason: "Split shift: moved the absorbed punch to its own shift",
      });
    },
    onSuccess: () => { toast({ title: "Shift split" }); invalidate(); setSplitTarget(null); },
    onError: (err: any) => toast({ title: "Could not split shift", description: err?.message ?? "Please try again.", variant: "destructive" }),
  });
  const openAdd = () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    setAddIn(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`);
    setAddOut(""); setAddOpen(true);
  };
  const openSplit = (p: RawPunch) => {
    setSplitTarget(p);
    const inDate = toLocalInput(p.clockIn).split("T")[0];
    setSplitDay1Out(inDate ? `${inDate}T17:00` : "");
    setSplitNewIn(toLocalInput(p.clockOut));
    setSplitNewOut("");
  };

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="timesheet-loading">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }

  const hasNoPunches =
    !data ||
    !data.entries ||
    data.entries.length === 0 ||
    data.entries.every((e) => e.status === "none");

  if (isError) {
    return (
      <Alert variant="destructive" className="my-4" data-testid="alert-timesheet-error">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load the timesheet. Please try again.</AlertDescription>
      </Alert>
    );
  }

  if (hasNoPunches) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No timesheet data"
        description="No punches have been recorded for this employee in the selected date range."
        testId="text-timesheet-empty"
      />
    );
  }

  const EXPORT_HEADERS = ["Date", "Day", "Clock In", "Clock Out", "Break (min)", "Total Hours", "Overtime", "Source", "Status"];

  // One row per day. An EMPTY day (no clock-in and no clock-out) shows only the
  // date + day, every other column blank — never a placeholder dash (a stray
  // em-dash is also what broke the file's encoding in Excel).
  const exportRows = (): string[][] =>
    data.entries.map((e) => {
      if (!e.clockIn && !e.clockOut) {
        return [e.date, e.dayOfWeek, "", "", "", "", "", "", ""];
      }
      return [
        e.date,
        e.dayOfWeek,
        e.clockIn ? formatTime12InTz(e.clockIn, data.timezone) : "",
        e.clockOut ? formatTime12InTz(e.clockOut, data.timezone) : "",
        String(e.breakMinutes || 0),
        e.totalHours != null ? formatHoursMinutes(e.totalHours) : "",
        formatHoursMinutes(e.overtimeHours || 0),
        formatSources(e.sources),
        timesheetStatusLabel(e),
      ];
    });

  const exportTotalsRow = (): string[] =>
    ["Totals", "", "", "", "", formatHoursMinutes(data.totals.totalHours), formatHoursMinutes(data.totals.overtimeHours), "", `${data.totals.daysWorked} days worked`];

  const baseFileName = () =>
    (exportFileName || `timesheet-${data.employeeName.replace(/\s+/g, "_")}-${startDate}-${endDate}.csv`).replace(/\.csv$/i, "");

  const exportCSV = () => {
    const csv = [EXPORT_HEADERS, ...exportRows(), exportTotalsRow()]
      .map((row) => row.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(","))
      .join("\n");
    // Lead with a UTF-8 BOM so Excel reads the file as UTF-8 (otherwise it falls
    // back to a legacy codepage and mangles any non-ASCII character).
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseFileName()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // "Download PDF" via the browser's print-to-PDF (no extra dependency): open a
  // clean, print-styled copy of the timesheet and trigger print; the person picks
  // "Save as PDF" as the destination.
  const exportPDF = () => {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const bodyRows = exportRows()
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join("");
    const totals = exportTotalsRow();
    const title = `Timesheet — ${data.employeeName}`;
    const period = `${startDate} to ${endDate}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(baseFileName())}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}
        h1{font-size:18px;margin:0 0 2px} .sub{color:#555;font-size:12px;margin:0 0 16px}
        table{border-collapse:collapse;width:100%;font-size:12px}
        th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}
        th{background:#f3f4f6} tfoot td{font-weight:bold;background:#fafafa}
        @media print{@page{margin:14mm}}
      </style></head><body>
      <h1>${esc(title)}</h1><p class="sub">${esc(period)}</p>
      <table><thead><tr>${EXPORT_HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr>${totals.map((c) => `<td>${esc(c)}</td>`).join("")}</tr></tfoot></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-3" data-testid="timesheet-table-container">
      {/* One compact bar groups the three things a reviewer scans — the
          employee name, the headline total, and the period controls — so the
          eye doesn't travel up and down the page. */}
      <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap rounded-md border bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          {showEmployeeName && (
            <div className="text-lg font-bold leading-tight pr-1" data-testid="text-timesheet-employee-name">
              {data.employeeName}
            </div>
          )}
          {data.emphasizeDays ? (
            <div data-testid="stat-timesheet-primary">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Days worked this period</p>
              <p className="text-3xl font-bold tabular-nums leading-tight text-blue-600 dark:text-blue-400" data-testid="text-timesheet-days-big">
                {data.totals.daysWorked}
              </p>
              {data.totals.totalHours > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">{formatHoursMinutes(data.totals.totalHours)} total</p>
              )}
            </div>
          ) : (
            <div data-testid="stat-timesheet-primary">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total hours this period</p>
              <p className="text-3xl font-bold tabular-nums leading-tight text-blue-600 dark:text-blue-400" data-testid="text-timesheet-total-hours-big">
                {formatHoursMinutes(data.totals.totalHours)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{data.totals.daysWorked} day{data.totals.daysWorked === 1 ? "" : "s"} worked</p>
            </div>
          )}
          {data.totals.totalBonus != null && data.totals.totalBonus > 0 && (
            <div data-testid="stat-timesheet-total-bonus">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Bonuses this period</p>
              <p className="text-3xl font-bold tabular-nums leading-tight text-green-600 dark:text-green-400" data-testid="text-timesheet-total-bonus-big">
                {formatMoney(data.totals.totalBonus)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Earned day-of-week bonuses</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {navSlot}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={openAdd} data-testid="button-timesheet-add-punch">
              <Plus className="h-4 w-4 mr-2" /> Add punch
            </Button>
          )}
          {showExport && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                disabled={!data.entries.length}
                data-testid="button-timesheet-export-csv"
              >
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportPDF}
                disabled={!data.entries.length}
                data-testid="button-timesheet-export-pdf"
              >
                <Download className="h-4 w-4 mr-2" /> Download PDF
              </Button>
            </>
          )}
        </div>
      </div>
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
              <TableHead className="text-xs font-medium uppercase tracking-wider">Source</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
              {canEdit && <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => {
              const isRefDay = e.totalHours == null && e.referenceHours != null;
              const hoursCell = (hours: number | null) =>
                hours == null ? "—"
                : isRefDay ? (
                  <span className="font-normal text-muted-foreground" title="For reference — paid per day, not per hour">
                    ({formatHoursMinutes(hours)})
                  </span>
                ) : formatHoursMinutes(hours);
              // The single backing punch for a shift (when the shift is one punch
              // pair), so Split/Delete can target it.
              const segPunch = (seg?: TimesheetSegment): RawPunch | undefined =>
                seg && seg.clockInPunchId && seg.clockInPunchId === seg.clockOutPunchId
                  ? punchById.get(seg.clockInPunchId) : undefined;
              // Per-row actions: Edit (pencil → popup) + Split / Delete.
              const actionsCellFor = (p?: RawPunch) => {
                if (!canEdit) return null;
                return (
                  <TableCell className="text-right">
                    {p && (
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit this day's clock & work date" onClick={() => openEdit(p)} data-testid={`button-edit-${p.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {p.clockIn && p.clockOut && p.status !== "missing_clockout" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Split: the clock-out is really a new clock-in" onClick={() => openSplit(p)} data-testid={`button-split-${p.id}`}>
                            <Scissors className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete this punch" onClick={() => setDeleteTarget({ id: p.id, date: e.date })} data-testid={`button-delete-${p.id}`}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                );
              };
              // A day where the person clocked out and back in with a gap over an
              // hour is shown as one line per shift (same date). A shorter lunch
              // stays a single row with the break. The day's overtime, source and
              // status sit on the first shift line; the totals are unchanged.
              const shifts = e.segments && e.segments.length > 1 ? e.segments : null;
              if (!shifts) {
                const seg0 = e.segments && e.segments.length === 1 ? e.segments[0] : undefined;
                // The punch this row's pencil edits: the single shift's punch, or
                // (for a missing / in-progress day, which has no segment) the day's
                // one open/missing punch.
                let rowPunch = segPunch(seg0);
                if (canEdit && !rowPunch && (e.status === "missing_punch" || e.status === "in_progress")) {
                  const dayPunches = punchesByDate.get(e.date) ?? [];
                  rowPunch = dayPunches.find((p) =>
                    p.status === "missing_clockout" || p.status === "missing_clockin" ||
                    (!!p.clockIn && !p.clockOut) || (!!p.clockOut && !p.clockIn),
                  ) ?? (dayPunches.length === 1 ? dayPunches[0] : undefined);
                }
                return (
                  <TableRow key={e.date} data-testid={`row-timesheet-${e.date}`}>
                    <TableCell className="text-sm font-medium">{formatDate(e.date)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.dayOfWeek}</TableCell>
                    <TableCell className="text-sm tabular-nums" data-testid={`text-timesheet-in-${e.date}`}>
                      {e.clockIn ? formatTime12InTz(e.clockIn, data.timezone) : "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums" data-testid={`text-timesheet-out-${e.date}`}>
                      {e.clockOut ? formatTime12InTz(e.clockOut, data.timezone) : "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{e.breakMinutes ? `${e.breakMinutes} min` : "—"}</TableCell>
                    <TableCell className="text-sm font-semibold tabular-nums" data-testid={`text-timesheet-hours-${e.date}`}>
                      {hoursCell(e.totalHours ?? e.referenceHours ?? null)}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums" data-testid={`text-timesheet-ot-${e.date}`}>
                      {e.overtimeHours > 0 ? (
                        <span className="text-amber-600 font-semibold">{formatHoursMinutes(e.overtimeHours)}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground" data-testid={`text-timesheet-source-${e.date}`}>
                      {formatSources(e.sources)}
                    </TableCell>
                    <TableCell data-testid={`badge-timesheet-status-${e.date}`}>
                      <TimesheetStatusBadge entry={e} />
                    </TableCell>
                    {actionsCellFor(rowPunch)}
                  </TableRow>
                );
              }
              return (
                <Fragment key={e.date}>
                  {shifts.map((seg, i) => (
                    <TableRow key={`${e.date}-shift-${i}`} data-testid={`row-timesheet-${e.date}-shift-${i}`}>
                      <TableCell className="text-sm font-medium">
                        {formatDate(e.date)}
                        {i > 0 && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">shift {i + 1}</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{i === 0 ? e.dayOfWeek : ""}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {seg.clockIn ? formatTime12InTz(seg.clockIn, data.timezone) : "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {seg.clockOut ? formatTime12InTz(seg.clockOut, data.timezone) : "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{seg.breakMinutes ? `${seg.breakMinutes} min` : "—"}</TableCell>
                      <TableCell className="text-sm font-semibold tabular-nums">{hoursCell(seg.hours)}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {i === 0 && e.overtimeHours > 0 ? (
                          <span className="text-amber-600 font-semibold">{formatHoursMinutes(e.overtimeHours)}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i === 0 ? formatSources(e.sources) : ""}</TableCell>
                      <TableCell>{i === 0 ? <TimesheetStatusBadge entry={e} /> : null}</TableCell>
                      {actionsCellFor(segPunch(seg))}
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
            <TableRow className="bg-muted/40 font-semibold" data-testid="row-timesheet-totals">
              <TableCell colSpan={5} className="text-right text-sm uppercase tracking-wider">Totals</TableCell>
              <TableCell className="text-sm tabular-nums" data-testid="text-timesheet-total-hours">
                {formatHoursMinutes(data.totals.totalHours)}
              </TableCell>
              <TableCell className="text-sm tabular-nums" data-testid="text-timesheet-total-overtime">
                {formatHoursMinutes(data.totals.overtimeHours)}
              </TableCell>
              <TableCell />
              <TableCell className="text-sm" data-testid="text-timesheet-days-worked">
                {data.totals.daysWorked} day{data.totals.daysWorked === 1 ? "" : "s"} worked
              </TableCell>
              {canEdit && <TableCell />}
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
      {canEdit && (
        <p className="text-xs text-muted-foreground" data-testid="text-timesheet-edit-hint">
          Use the <span className="font-medium">pencil</span> on a row to edit that day's clock-in,
          clock-out and work date.
        </p>
      )}

      {/* Edit day's clock */}
      <Dialog open={!!editPunch} onOpenChange={(open) => { if (!open) setEditPunch(null); }}>
        <DialogContent data-testid="dialog-timesheet-edit-punch">
          <DialogHeader>
            <DialogTitle>Edit clock</DialogTitle>
            <DialogDescription>{editPunch ? formatDate(editPunch.workDate) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="ts-edit-workdate">Work date</Label>
              <Input id="ts-edit-workdate" type="date" value={editWorkDate} onChange={(ev) => setEditWorkDate(ev.target.value)} data-testid="input-timesheet-edit-workdate" />
              <p className="text-xs text-muted-foreground">The day this shift is counted on. Change it to move a shift that landed on the wrong day.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-edit-in">Clock In</Label>
              <Input id="ts-edit-in" type="datetime-local" value={editIn} onChange={(ev) => setEditIn(ev.target.value)} data-testid="input-timesheet-edit-in" />
              <p className="text-xs text-muted-foreground">Leave empty to keep it a missing punch (clock-out only).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-edit-out">Clock Out</Label>
              <Input id="ts-edit-out" type="datetime-local" value={editOut} onChange={(ev) => setEditOut(ev.target.value)} data-testid="input-timesheet-edit-out" />
              <p className="text-xs text-muted-foreground">Leave empty to mark the shift still in progress (or a missing punch).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-edit-reason">Reason (optional)</Label>
              <Textarea id="ts-edit-reason" value={editReason} onChange={(ev) => setEditReason(ev.target.value)} placeholder="Why is this punch being changed?" data-testid="input-timesheet-edit-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPunch(null)} data-testid="button-timesheet-cancel-edit">Cancel</Button>
            <Button onClick={submitEdit} disabled={editMutation.isPending} data-testid="button-timesheet-save-edit">
              {editMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add punch */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-timesheet-add-punch">
          <DialogHeader>
            <DialogTitle>Add punch</DialogTitle>
            <DialogDescription>Enter a clock-in, a clock-out, or both. Leave one empty to record a missing punch on that side.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="ts-add-in">Clock In</Label>
              <Input id="ts-add-in" type="datetime-local" value={addIn} onChange={(ev) => setAddIn(ev.target.value)} data-testid="input-timesheet-add-in" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-add-out">Clock Out</Label>
              <Input id="ts-add-out" type="datetime-local" value={addOut} onChange={(ev) => setAddOut(ev.target.value)} data-testid="input-timesheet-add-out" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-timesheet-cancel-add">Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || (!addIn && !addOut)} data-testid="button-timesheet-save-add">
              {addMutation.isPending ? "Adding…" : "Add punch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Split shift */}
      <Dialog open={!!splitTarget} onOpenChange={(open) => { if (!open) setSplitTarget(null); }}>
        <DialogContent data-testid="dialog-timesheet-split-punch">
          <DialogHeader>
            <DialogTitle>Split shift</DialogTitle>
            <DialogDescription>
              Use this when a punch-out was missed and the next clock-in got absorbed into the same shift. Set the real
              clock-out for the first shift; the second punch becomes its own shift.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="ts-split-day1out">Real clock-out for the first shift</Label>
              <Input id="ts-split-day1out" type="datetime-local" value={splitDay1Out} onChange={(ev) => setSplitDay1Out(ev.target.value)} data-testid="input-timesheet-split-day1out" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-split-newin">New shift — clock-in</Label>
              <Input id="ts-split-newin" type="datetime-local" value={splitNewIn} onChange={(ev) => setSplitNewIn(ev.target.value)} data-testid="input-timesheet-split-newin" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ts-split-newout">New shift — clock-out (optional)</Label>
              <Input id="ts-split-newout" type="datetime-local" value={splitNewOut} onChange={(ev) => setSplitNewOut(ev.target.value)} data-testid="input-timesheet-split-newout" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitTarget(null)} data-testid="button-timesheet-cancel-split">Cancel</Button>
            <Button onClick={() => splitMutation.mutate()} disabled={splitMutation.isPending || !splitDay1Out || !splitNewIn} data-testid="button-timesheet-save-split">
              {splitMutation.isPending ? "Splitting…" : "Split shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete punch */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-timesheet-delete-punch">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this punch?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `This permanently removes the punch on ${formatDate(deleteTarget.date)}. This cannot be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-timesheet-cancel-delete">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} data-testid="button-timesheet-confirm-delete">
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function timesheetStatusLabel(e: TimesheetEntry): string {
  switch (e.status) {
    case "complete": return "Complete";
    case "overtime": return "Overtime";
    case "in_progress": return "In Progress";
    case "missing_punch": return "Missing Punch";
    case "confirmation": return "Attendance captured";
    case "pto": return e.ptoType ? `PTO (${e.ptoType.replace(/_/g, " ")})` : "PTO";
    case "error": return "Couldn't load — needs review";
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
    case "confirmation":
      return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{label}</Badge>;
    case "pto":
      return <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{label}</Badge>;
    case "error":
      return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />{label}</Badge>;
    default:
      return <span className="text-xs text-muted-foreground">—</span>;
  }
}
