import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Pencil, Check } from "lucide-react";
import { EmployeeTimesheetTable } from "@/components/employee-timesheet";
import { TimesheetEditor } from "@/components/timesheet-editor";
import { usePermissions } from "@/hooks/use-permissions";
import { currentWeek, shiftWeeks, formatRangeLabel, type DateRange } from "@/lib/payroll-week";

/**
 * Employee-profile tab: the person's time sheet for a payroll week (Thu–Wed),
 * opening on the current in-progress week, with Previous/Next to walk whole
 * payroll weeks. Reuses the same timesheet table as Reports, so numbers match.
 */
export function ReviewTimeSheetTab({ employeeId }: { employeeId: string }) {
  const [range, setRange] = useState<DateRange>(() => currentWeek());
  const [editing, setEditing] = useState(false);
  const { has } = usePermissions();
  const canEdit = has("attendance.edit");
  const isCurrent = range.end === currentWeek().end;

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
                {editing ? (
                  <><Check className="h-4 w-4 mr-1" /> Done</>
                ) : (
                  <><Pencil className="h-4 w-4 mr-1" /> Edit</>
                )}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRange((r) => shiftWeeks(r, -1))}
              data-testid="button-timesheet-prev"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span
              className="text-sm font-medium min-w-[190px] text-center"
              data-testid="text-timesheet-week"
            >
              {formatRangeLabel(range)}
              {isCurrent ? " · current" : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRange((r) => shiftWeeks(r, 1))}
              disabled={isCurrent}
              data-testid="button-timesheet-next"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <EmployeeTimesheetTable
          employeeId={employeeId}
          startDate={range.start}
          endDate={range.end}
          showExport
          exportFileName={`timesheet-${range.start}-to-${range.end}`}
        />
        {editing && canEdit && (
          <div className="mt-4">
            <TimesheetEditor
              employeeId={employeeId}
              startDate={range.start}
              endDate={range.end}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
