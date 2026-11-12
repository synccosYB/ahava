import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Pencil, Check, CalendarClock, CalendarDays, Send } from "lucide-react";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { EmployeeReviewRules } from "@/components/employee-review-rules";
import { TimesheetEditor } from "@/components/timesheet-editor";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { currentWeek, currentWorkPeriod, currentPayrollPeriod, shiftWeeks, shiftBiweekly, formatRangeLabel, type DateRange } from "@/lib/payroll-week";
import { formatDate } from "@/lib/utils";
import { type Period, PERIOD_LABELS, PERIOD_KEYS, rangeForPeriod, normalizePeriod, ymdLocal, ymdToDate } from "@/lib/timesheet-period";

// "this_week" steps one week at a time; the two bi-weekly pay periods step one
// 14-day period at a time. Every other preset is a fixed/custom range.
const NAVIGABLE: Period[] = ["this_week", "work_period", "payroll_period"];

// Per-user period preference. Stored in the browser, keyed by user, so each
// admin/manager keeps their own default. View convenience only — guarded.
function prefKey(userId: string | undefined) {
  return `ahava.reviewTimesheet.period.${userId ?? "anon"}`;
}
function loadPeriod(userId: string | undefined): Period {
  try {
    return normalizePeriod(localStorage.getItem(prefKey(userId)));
  } catch {
    return "this_week";
  }
}

function DateField({ label, value, onChange, testId }: {
  label: string; value: string; onChange: (ymd: string) => void; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = ymdToDate(value);
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="justify-start font-normal" data-testid={testId}>
            <CalendarDays className="h-4 w-4 mr-2 opacity-70" />
            {selected ? formatDate(value) : <span className="text-muted-foreground">Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={selected} onSelect={(d) => { if (d) { onChange(ymdLocal(d)); setOpen(false); } }} initialFocus />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Employee-profile tab: the person's time sheet for a payroll period (Thu–Wed
 * weeks). Each viewer picks Weekly (one week) or Bi-weekly (two weeks) and that
 * choice is remembered for them. ◀ / ▶ walk whole periods; "Current" jumps back
 * to the in-progress period. Reuses the same timesheet table as Reports, so the
 * numbers match.
 */
export function ReviewTimeSheetTab({ employeeId }: { employeeId: string }) {
  const { has } = usePermissions();
  const { user: currentUser } = useAuth();
  const canEdit = has("attendance.edit");
  const canSendPayroll = has("payroll.manage");

  const [period, setPeriod] = useState<Period>(() => loadPeriod(currentUser?.id));
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  // How many steps back from the current week/period the ◀/▶ controls are (0 =
  // current). A step is one week for "this_week" and one 14-day pay period for
  // the work/payroll periods.
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPeriod(loadPeriod(currentUser?.id));
  }, [currentUser?.id]);
  const changePeriod = (p: Period) => {
    setPeriod(p);
    setOffset(0); // reset stepping to current
    try { localStorage.setItem(prefKey(currentUser?.id), p); } catch { /* ignore */ }
  };

  const navigable = NAVIGABLE.includes(period);
  const isCurrent = offset === 0;

  // The current (offset 0) range for this preset, then stepped back by `offset`:
  // whole weeks for "this_week", whole 14-day periods for the pay periods.
  const baseRange: DateRange =
    period === "this_week" ? currentWeek()
    : period === "work_period" ? currentWorkPeriod()
    : period === "payroll_period" ? currentPayrollPeriod()
    : rangeForPeriod(period, customStart, customEnd);
  const displayed: DateRange =
    !navigable || offset === 0 ? baseRange
    : period === "this_week" ? shiftWeeks(baseRange, -offset)
    : shiftBiweekly(baseRange, -offset);

  const goPrev = () => setOffset((o) => o + 1);
  const goNext = () => setOffset((o) => Math.max(0, o - 1));
  const goCurrent = () => setOffset(0);

  // The period stepper (◀ range ▶ + "Current") rides INSIDE the timesheet's
  // summary bar — next to the employee name and totals — so the three things a
  // reviewer scans share one line instead of being stacked down the page.
  const periodNav = navigable ? (
    <div className="flex items-center gap-1" data-testid="timesheet-period-nav">
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={goPrev} data-testid="button-timesheet-prev" aria-label="Previous period">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-medium text-center whitespace-nowrap px-1" data-testid="text-timesheet-week">
        {formatRangeLabel(displayed)}{isCurrent ? " · current" : ""}
      </span>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={goNext} disabled={isCurrent} data-testid="button-timesheet-next" aria-label="Next period">
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isCurrent && (
        <Button variant="secondary" size="sm" className="h-8" onClick={goCurrent} data-testid="button-timesheet-current">
          <CalendarClock className="h-4 w-4 mr-1" /> Current
        </Button>
      )}
    </div>
  ) : null;

  return (
    <Card data-testid="card-review-timesheet">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CardTitle>Review Time Sheet</CardTitle>
            {canEdit && (
              <Button
                variant={editing ? "default" : "outline"}
                size="sm"
                onClick={() => setEditing((v) => !v)}
                data-testid="button-timesheet-edit-toggle"
              >
                {editing ? (<><Check className="h-4 w-4 mr-1" /> Done</>) : (<><Pencil className="h-4 w-4 mr-1" /> Edit</>)}
              </Button>
            )}
            {canSendPayroll && <SendToPayrollControl employeeId={employeeId} range={displayed} />}
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <Select value={period} onValueChange={(v) => changePeriod(v as Period)}>
              <SelectTrigger className="w-[240px]" data-testid="select-timesheet-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_KEYS.map((p) => (
                  <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {period === "custom" && (
              <>
                <DateField label="From" value={customStart} onChange={setCustomStart} testId="date-timesheet-from" />
                <DateField label="To" value={customEnd} onChange={setCustomEnd} testId="date-timesheet-to" />
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <EmployeeReviewRules employeeId={employeeId} />
        <EmployeeTimesheetTable
          employeeId={employeeId}
          startDate={displayed.start}
          endDate={displayed.end}
          showExport
          showEmployeeName
          navSlot={periodNav}
          exportFileName={`timesheet-${displayed.start}-to-${displayed.end}`}
        />
        {editing && canEdit && (
          <div className="mt-4">
            <TimesheetEditor
              employeeId={employeeId}
              startDate={displayed.start}
              endDate={displayed.end}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type SubmissionStatus = {
  status: "open" | "sent" | "sent_with_missing";
  counts: { sendable: number; held: number; sent: number; unsent: number };
};

// "Send to Payroll" for the viewed period: confirms this employee's COMPLETE
// days and leaves missing-punch days open (to send in a later run). Shows the
// rollup status as a badge.
function SendToPayrollControl({ employeeId, range }: { employeeId: string; range: DateRange }) {
  const { toast } = useToast();
  const statusKey = ["/api/payroll/submission-status", employeeId, range.start, range.end];
  const { data } = useQuery<SubmissionStatus>({
    queryKey: statusKey,
    queryFn: async () => {
      const p = new URLSearchParams({ employeeId, startDate: range.start, endDate: range.end });
      const res = await fetch(`/api/payroll/submission-status?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payroll status");
      return res.json();
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/send-to-payroll", { employeeId, startDate: range.start, endDate: range.end });
      return res.json() as Promise<{ added: number; heldBack: number }>;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      toast({
        title: r.added > 0 ? `Sent ${r.added} day${r.added === 1 ? "" : "s"} to payroll` : "Nothing new to send",
        description: r.heldBack > 0
          ? `${r.heldBack} day${r.heldBack === 1 ? "" : "s"} held back for missing punches — fix them and send in a later run.`
          : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Could not send to payroll", description: e.message, variant: "destructive" }),
  });

  const badge = !data ? null
    : data.status === "sent"
      ? <Badge className="bg-green-600" data-testid="badge-payroll-status">Sent to Payroll</Badge>
      : data.status === "sent_with_missing"
        ? <Badge variant="secondary" className="bg-amber-500 text-white" data-testid="badge-payroll-status">Sent · missing punches</Badge>
        : <Badge variant="outline" className="text-muted-foreground" data-testid="badge-payroll-status">Open · not sent</Badge>;

  const nothingToSend = !data || data.counts.unsent === 0;
  return (
    <div className="flex items-center gap-2" data-testid="send-to-payroll-control">
      {badge}
      <Button
        size="sm"
        variant="outline"
        onClick={() => send.mutate()}
        disabled={send.isPending || nothingToSend}
        title={nothingToSend ? "No complete, unsent days in this period" : undefined}
        data-testid="button-send-to-payroll"
      >
        <Send className="h-4 w-4 mr-1" /> Send to Payroll
      </Button>
    </div>
  );
}
