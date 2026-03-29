import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Clock, Timer, CalendarDays, Play, Square } from "lucide-react";
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
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold" data-testid="text-page-title">
        Dashboard{user?.firstName ? ` — Welcome, ${user.firstName}` : ""}
      </h2>

      {statusLoading ? (
        <Skeleton className="h-40 w-full" data-testid="skeleton-clock-status" />
      ) : statusError ? (
        <Card className="border-destructive" data-testid="card-clock-error">
          <CardContent className="pt-6 text-center text-destructive">
            Failed to load dashboard status. Please refresh the page.
          </CardContent>
        </Card>
      ) : (
        <Card
          className={`border-2 ${status?.isClockedIn ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-muted bg-muted/30"}`}
          data-testid="card-clock-status"
        >
          <CardContent className="pt-6 text-center">
            <p className="text-lg font-semibold mb-4" data-testid="text-clock-status">
              Current Status: {status?.isClockedIn ? "Clocked In" : "Clocked Out"}
            </p>
            {status?.isClockedIn && status.currentRecord?.clockIn && (
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-clocked-in-since">
                Since {new Date(status.currentRecord.clockIn).toLocaleTimeString()}
              </p>
            )}
            {status?.isClockedIn ? (
              <Button
                size="lg"
                variant="destructive"
                onClick={() => clockOutMutation.mutate()}
                disabled={clockOutMutation.isPending}
                data-testid="button-clock-out"
                className="text-lg px-8 py-3"
              >
                <Square className="mr-2 h-5 w-5" />
                {clockOutMutation.isPending ? "Clocking Out..." : "CLOCK OUT"}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={() => clockInMutation.mutate()}
                disabled={clockInMutation.isPending}
                data-testid="button-clock-in"
                className="text-lg px-8 py-3 bg-green-600 hover:bg-green-700"
              >
                <Play className="mr-2 h-5 w-5" />
                {clockInMutation.isPending ? "Clocking In..." : "CLOCK IN"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {statusLoading ? (
          <>
            <Skeleton className="h-32" data-testid="skeleton-today-hours" />
            <Skeleton className="h-32" data-testid="skeleton-week-hours" />
          </>
        ) : (
          <>
            <Card data-testid="card-today-hours">
              <CardContent className="pt-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="h-5 w-5 text-primary" />
                  <p className="font-semibold">Today's Hours</p>
                </div>
                <p className="text-4xl font-bold text-primary" data-testid="text-today-hours">
                  {status?.todayHours ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">hrs</p>
              </CardContent>
            </Card>

            <Card data-testid="card-week-hours">
              <CardContent className="pt-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Timer className="h-5 w-5 text-primary" />
                  <p className="font-semibold">This Week</p>
                </div>
                <p className="text-4xl font-bold text-primary" data-testid="text-week-hours">
                  {status?.weekHours ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">hrs</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {statusLoading ? (
        <Skeleton className="h-28" data-testid="skeleton-pto" />
      ) : (
        <Card data-testid="card-pto-balance">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              PTO Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div data-testid="text-vacation-balance">
                <p className="text-sm text-muted-foreground">Vacation</p>
                <p className="text-xl font-bold">{status?.ptoBalance?.vacation ?? 0} days</p>
              </div>
              <div data-testid="text-sick-balance">
                <p className="text-sm text-muted-foreground">Sick Leave</p>
                <p className="text-xl font-bold">{status?.ptoBalance?.sick ?? 0} days</p>
              </div>
              <div data-testid="text-personal-balance">
                <p className="text-sm text-muted-foreground">Personal</p>
                <p className="text-xl font-bold">{status?.ptoBalance?.personal ?? 0} days</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-recent-activity">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recordsError ? (
            <p className="text-destructive text-center py-4" data-testid="text-records-error">
              Failed to load recent activity.
            </p>
          ) : recentActivity.length === 0 ? (
            <p className="text-muted-foreground text-center py-4" data-testid="text-no-activity">
              No recent activity
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivity.map((record) => (
                  <TableRow key={record.id} data-testid={`row-activity-${record.id}`}>
                    <TableCell className="font-medium">{record.date}</TableCell>
                    <TableCell>
                      {record.clockIn
                        ? new Date(record.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                      {record.clockOut
                        ? ` - ${new Date(record.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : " - Present"}
                    </TableCell>
                    <TableCell className="font-bold">
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
