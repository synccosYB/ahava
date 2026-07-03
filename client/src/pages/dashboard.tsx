import { useQuery } from "@tanstack/react-query";
import { formatHoursMinutes, addLiveElapsedHours, getOvernightShiftInfo, formatTime12InTz, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useTimeClock } from "@/hooks/use-time-clock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Clock, Coffee, Play, Square, TrendingUp } from "lucide-react";
import type { AttendanceRecord } from "@shared/schema";

// The records endpoint stamps each row with the employee's business timezone so
// punch times render in the medical center's wall-clock, not the device's tz.
type DashboardRecord = AttendanceRecord & { timezone?: string | null };

export default function Dashboard() {
  const { user } = useAuth();

  // Shared time-clock state/actions — identical logic to the floating widget.
  const {
    status,
    query: { isLoading: statusLoading, isError: statusError, refetch: refetchStatus, isFetching: statusFetching },
    dataUpdatedAt,
    nowMs,
    onBreak,
    elapsedLabel,
    breakElapsedLabel,
    canSelfPunch,
    clockInMutation,
    clockOutMutation,
    startBreakMutation,
    endBreakMutation,
  } = useTimeClock();

  const liveTodayHours = status?.isClockedIn
    ? addLiveElapsedHours(status?.todayHours, dataUpdatedAt, nowMs)
    : status?.todayHours ?? 0;
  const liveWeekHours = status?.isClockedIn
    ? addLiveElapsedHours(status?.weekHours, dataUpdatedAt, nowMs)
    : status?.weekHours ?? 0;

  const {
    data: recentRecords,
    isLoading: recordsLoading,
    isError: recordsError,
    refetch: refetchRecords,
    isFetching: recordsFetching,
  } = useQuery<DashboardRecord[]>({
    queryKey: ["/api/attendance/records"],
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const recentActivity = (recentRecords || []).slice(0, 5);

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title={user?.firstName ? `Welcome back, ${user.firstName}` : "Dashboard"}
        subtitle="Your attendance overview and quick actions"
      />

      {statusLoading ? (
        <Skeleton className="h-36 w-full rounded-xl" data-testid="skeleton-clock-status" />
      ) : statusError ? (
        <Card className="border-destructive/50" data-testid="card-clock-error">
          <CardContent className="pt-6 pb-6 flex flex-col items-center gap-3 text-center text-destructive text-sm">
            <p>Failed to load dashboard status.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchStatus()}
              disabled={statusFetching}
              data-testid="button-retry-dashboard-status"
            >
              {statusFetching ? "Retrying..." : "Try again"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card
          className={`overflow-hidden ${status?.isClockedIn ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20" : ""}`}
          data-testid="card-clock-status"
        >
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`h-12 w-12 rounded-full flex items-center justify-center ${status?.isClockedIn ? "bg-green-100 dark:bg-green-900/40" : "bg-muted"}`}>
                  <Clock className={`h-6 w-6 ${status?.isClockedIn ? "text-green-600" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Current Status</p>
                  <p className="text-lg font-semibold" data-testid="text-clock-status">
                    {status?.isClockedIn ? "Clocked In" : "Clocked Out"}
                  </p>
                  {status?.isClockedIn && status.currentRecord?.clockIn && (
                    <>
                      <p className="text-xs text-muted-foreground" data-testid="text-clocked-in-since">
                        Since {formatTime12InTz(status.currentRecord.clockIn, status.timezone)}
                      </p>
                      <p className="text-xs font-medium tabular-nums text-green-700 dark:text-green-400" data-testid="text-live-elapsed">
                        {elapsedLabel}
                      </p>
                      {onBreak && (
                        <p className="text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="text-break-elapsed">
                          <Coffee className="h-3 w-3" />
                          On break · {breakElapsedLabel}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
                {!canSelfPunch ? (
                  <p className="text-sm text-muted-foreground max-w-[16rem] text-center sm:text-right" data-testid="text-self-punch-disabled">
                    Self clock-in isn't enabled for you. Please use a kiosk or ask your manager.
                  </p>
                ) : status?.isClockedIn ? (
                  <>
                    {onBreak ? (
                      <Button
                        variant="outline"
                        onClick={() => endBreakMutation.mutate()}
                        disabled={endBreakMutation.isPending}
                        data-testid="button-end-break"
                        className="px-6 border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                      >
                        <Coffee className="mr-2 h-4 w-4" />
                        {endBreakMutation.isPending ? "Ending..." : "End Break"}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => startBreakMutation.mutate()}
                        disabled={startBreakMutation.isPending}
                        data-testid="button-take-break"
                        className="px-6"
                      >
                        <Coffee className="mr-2 h-4 w-4" />
                        {startBreakMutation.isPending ? "Starting..." : "Take Break"}
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      onClick={() => clockOutMutation.mutate()}
                      disabled={clockOutMutation.isPending}
                      data-testid="button-clock-out"
                      className="px-6"
                    >
                      <Square className="mr-2 h-4 w-4" />
                      {clockOutMutation.isPending ? "Clocking Out..." : "Clock Out"}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => clockInMutation.mutate()}
                    disabled={clockInMutation.isPending}
                    data-testid="button-clock-in"
                    className="px-6 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {clockInMutation.isPending ? "Clocking In..." : "Clock In"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {statusLoading ? (
          <>
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </>
        ) : (
          <>
            <Card data-testid="card-today-hours">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Today</p>
                  <Clock className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-today-hours">
                  {formatHoursMinutes(liveTodayHours)}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-week-hours">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">This Week</p>
                  <TrendingUp className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-week-hours">
                  {formatHoursMinutes(liveWeekHours)}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card data-testid="card-recent-activity">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recordsError ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-destructive text-center text-sm" data-testid="text-records-error">
                Failed to load recent activity.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchRecords()}
                disabled={recordsFetching}
                data-testid="button-retry-recent-activity"
              >
                {recordsFetching ? "Retrying..." : "Try again"}
              </Button>
            </div>
          ) : recentActivity.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-sm" data-testid="text-no-activity">
              No recent activity
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Time</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((record) => {
                  const overnightInfo = getOvernightShiftInfo(record.date, record.clockOut, record.timezone);
                  return (
                  <TableRow key={record.id} data-testid={`row-activity-${record.id}`}>
                    <TableCell className="font-medium text-sm">
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
                    <TableCell className="text-sm">
                      {record.clockIn
                        ? formatTime12InTz(record.clockIn, record.timezone)
                        : "—"}
                      {record.clockOut ? (
                        <>
                          {` – ${formatTime12InTz(record.clockOut, record.timezone)}`}
                          {overnightInfo && (
                            <span
                              className="ml-1 text-xs text-muted-foreground"
                              data-testid={`text-shift-end-time-date-${record.id}`}
                            >
                              ({overnightInfo.endDateLabel})
                            </span>
                          )}
                        </>
                      ) : (
                        " – Present"
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-sm tabular-nums">
                      {record.totalHours != null ? formatHoursMinutes(record.totalHours) : "In progress"}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
