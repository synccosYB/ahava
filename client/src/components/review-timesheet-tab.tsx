import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Pencil, Check, CalendarClock, CalendarDays } from "lucide-react";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { EmployeeReviewRules } from "@/components/employee-review-rules";
import { TimesheetEditor } from "@/components/timesheet-editor";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { currentWeek, shiftWeeks, formatRangeLabel, type DateRange } from "@/lib/payroll-week";
import { formatDate } from "@/lib/utils";
import { type Period, PERIOD_LABELS, PERIOD_KEYS, rangeForPeriod, ymdLocal, ymdToDate } from "@/lib/timesheet-period";

// "this_week" and "pay_period" keep the ◀ / ▶ week-stepping; the rest are fixed
// or custom ranges with no stepping.
const NAVIGABLE: Period[] = ["this_week", "pay_period"];

// Per-user period preference. Stored in the browser, keyed by user, so each
// admin/manager keeps their own default. View convenience only — guarded.
function prefKey(userId: string | undefined) {
  return `ahava.reviewTimesheet.period.${userId ?? "anon"}`;
}
function loadPeriod(userId: string | undefined): Period {
  try {
    const v = localStorage.getItem(prefKey(userId));
    return v && (PERIOD_LABELS as Record<string, string>)[v] ? (v as Period) : "this_week";
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

  const [period, setPeriod] = useState<Period>(() => loadPeriod(currentUser?.id));
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  // `anchor` is the LATEST payroll week in view for the navigable (◀/▶) modes.
  const [anchor, setAnchor] = useState<DateRange>(() => currentWeek());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPeriod(loadPeriod(currentUser?.id));
  }, [currentUser?.id]);
  const changePeriod = (p: Period) => {
    setPeriod(p);
    if (NAVIGABLE.includes(p)) setAnchor(currentWeek()); // reset stepping to current
    try { localStorage.setItem(prefKey(currentUser?.id), p); } catch { /* ignore */ }
  };

  const thisWeek = currentWeek();
  const navigable = NAVIGABLE.includes(period);
  const isCurrent = anchor.end === thisWeek.end;
  const step = period === "pay_period" ? 2 : 1;

  // Displayed range: navigable modes step through weeks from the anchor; every
  // other preset (and custom dates) resolves to a fixed range.
  const displayed: DateRange = !navigable
    ? rangeForPeriod(period, customStart, customEnd)
    : period === "pay_period"
      ? { start: shiftWeeks(anchor, -1).start, end: anchor.end }
      : anchor;

  const goPrev = () => setAnchor((a) => shiftWeeks(a, -step));
  const goNext = () =>
    setAnchor((a) => {
      const candidate = shiftWeeks(a, step);
      return candidate.start >= thisWeek.start ? thisWeek : candidate;
    });
  const goCurrent = () => setAnchor(thisWeek);

  return (
    <Card data-testid="card-review-timesheet">
      <CardHeader className="space-y-3">
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
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <Select value={period} onValueChange={(v) => changePeriod(v as Period)}>
              <SelectTrigger className="w-[220px]" data-testid="select-timesheet-period">
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {navigable && (
              <Button variant="outline" size="sm" onClick={goPrev} data-testid="button-timesheet-prev">
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
            )}
            <span className="text-sm font-medium min-w-[200px] text-center" data-testid="text-timesheet-week">
              {formatRangeLabel(displayed)}{navigable && isCurrent ? " · current" : ""}
            </span>
            {navigable && (
              <Button variant="outline" size="sm" onClick={goNext} disabled={isCurrent} data-testid="button-timesheet-next">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
          {navigable && !isCurrent && (
            <Button variant="secondary" size="sm" onClick={goCurrent} data-testid="button-timesheet-current">
              <CalendarClock className="h-4 w-4 mr-1" /> Jump to current
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <EmployeeReviewRules employeeId={employeeId} />
        <EmployeeTimesheetTable
          employeeId={employeeId}
          startDate={displayed.start}
          endDate={displayed.end}
          showExport
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
