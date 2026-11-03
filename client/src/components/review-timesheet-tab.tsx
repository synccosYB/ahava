import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Pencil, Check, CalendarClock } from "lucide-react";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { TimesheetEditor } from "@/components/timesheet-editor";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { currentWeek, shiftWeeks, formatRangeLabel, type DateRange } from "@/lib/payroll-week";

type ViewMode = "weekly" | "biweekly";

// Per-user view preference (1 week vs 2 weeks at a time). Stored in the
// browser, keyed by user, so each admin/manager keeps their own default. It is
// only a view convenience, so localStorage is fine — every access is guarded.
function prefKey(userId: string | undefined) {
  return `ahava.reviewTimesheet.viewMode.${userId ?? "anon"}`;
}
function loadViewMode(userId: string | undefined): ViewMode {
  try {
    return localStorage.getItem(prefKey(userId)) === "biweekly" ? "biweekly" : "weekly";
  } catch {
    return "weekly";
  }
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

  const [mode, setMode] = useState<ViewMode>(() => loadViewMode(currentUser?.id));
  // `anchor` is the LATEST payroll week in view (always a single Thu–Wed week).
  // Weekly shows just this week; Bi-weekly shows this week plus the one before.
  const [anchor, setAnchor] = useState<DateRange>(() => currentWeek());
  const [editing, setEditing] = useState(false);

  // Persist the view choice for this user, and re-read it if the user changes.
  useEffect(() => {
    setMode(loadViewMode(currentUser?.id));
  }, [currentUser?.id]);
  const changeMode = (m: ViewMode) => {
    setMode(m);
    try { localStorage.setItem(prefKey(currentUser?.id), m); } catch { /* ignore */ }
  };

  const thisWeek = currentWeek();
  const isCurrent = anchor.end === thisWeek.end;
  const step = mode === "biweekly" ? 2 : 1;

  // Displayed range: bi-weekly extends back one week from the anchor.
  const displayed: DateRange =
    mode === "biweekly" ? { start: shiftWeeks(anchor, -1).start, end: anchor.end } : anchor;

  const goPrev = () => setAnchor((a) => shiftWeeks(a, -step));
  const goNext = () =>
    setAnchor((a) => {
      const candidate = shiftWeeks(a, step);
      // Never move past the in-progress week.
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
          <Select value={mode} onValueChange={(v) => changeMode(v as ViewMode)}>
            <SelectTrigger className="w-[150px]" data-testid="select-timesheet-view-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Bi-weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goPrev} data-testid="button-timesheet-prev">
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm font-medium min-w-[200px] text-center" data-testid="text-timesheet-week">
              {formatRangeLabel(displayed)}{isCurrent ? " · current" : ""}
            </span>
            <Button variant="outline" size="sm" onClick={goNext} disabled={isCurrent} data-testid="button-timesheet-next">
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          {!isCurrent && (
            <Button variant="secondary" size="sm" onClick={goCurrent} data-testid="button-timesheet-current">
              <CalendarClock className="h-4 w-4 mr-1" /> Jump to current
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
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
