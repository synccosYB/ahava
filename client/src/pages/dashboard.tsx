import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Clock, Timer, CalendarDays, Play, Square, TrendingUp } from "lucide-react";
import type { AttendanceRecord } from "@shared/schema";

interface DashboardStatus {
  isClockedIn: boolean;
  currentRecord: AttendanceRecord | null;
  todayHours: number;
  weekHours: number;
  ptoBalance: { vacation: number; sick: number; personal: number };
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading, isError: statusError } = useQuery<DashboardStatus>({
    queryKey: ["/api/attendance/status"],
    refetchInterval: 30000,
  });

  const { data: recentRecords, isLoading: recordsLoading, isError: recordsError } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance/records"],
  });

  const clockInMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/attendance/clock-in"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/records"] });
      toast({ title: "Clocked In", description: "You have successfully clocked in." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/attendance/clock-out"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/records"] });
      toast({ title: "Clocked Out", description: "You have successfully clocked out." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
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
          <CardContent className="pt-6 text-center text-destructive text-sm">
            Failed to load dashboard status. Please refresh the page.
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
                    <p className="text-xs text-muted-foreground" data-testid="text-clocked-in-since">
                      Since {new Date(status.currentRecord.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              </div>
              <div>
                {status?.isClockedIn ? (
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statusLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
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
                  {status?.todayHours ?? 0}<span className="text-sm font-normal text-muted-foreground ml-1">hrs</span>
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
                  {status?.weekHours ?? 0}<span className="text-sm font-normal text-muted-foreground ml-1">hrs</span>
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-vacation-balance">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Vacation</p>
                  <CalendarDays className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-vacation-balance">
                  {status?.ptoBalance?.vacation ?? 0}<span className="text-sm font-normal text-muted-foreground ml-1">days</span>
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-sick-balance">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Sick Leave</p>
                  <Timer className="h-4 w-4 text-muted-foreground/60" />
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-sick-balance">
                  {status?.ptoBalance?.sick ?? 0}<span className="text-sm font-normal text-muted-foreground ml-1">days</span>
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
            <p className="text-destructive text-center py-4 text-sm" data-testid="text-records-error">
              Failed to load recent activity.
            </p>
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
                {recentActivity.map((record) => (
                  <TableRow key={record.id} data-testid={`row-activity-${record.id}`}>
                    <TableCell className="font-medium text-sm">{record.date}</TableCell>
                    <TableCell className="text-sm">
                      {record.clockIn
                        ? new Date(record.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                      {record.clockOut
                        ? ` – ${new Date(record.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : " – Present"}
                    </TableCell>
                    <TableCell className="font-semibold text-sm tabular-nums">
                      {record.totalHours ? `${record.totalHours} hrs` : "In progress"}
                    </TableCell>
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
