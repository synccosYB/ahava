import { useQuery } from "@tanstack/react-query";
import { formatHoursMinutes } from "@/lib/utils";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Users, UserCheck, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AttendancePunchTable } from "@/components/attendance-punch-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TeamStats = {
  teamSize: number;
  clockedIn: number;
  usingPto: number;
  pendingApprovals: number;
};

type TeamMemberStatus = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  departmentName: string;
  status: string;
  hasPtoToday: boolean;
  todayHours: number;
  weekHours: number;
};

export default function ManagerDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<TeamStats>({
    queryKey: ["/api/manager/team-stats"],
  });

  const { data: teamStatus, isLoading: teamLoading } = useQuery<TeamMemberStatus[]>({
    queryKey: ["/api/manager/team-status"],
  });

  return (
    <div className="max-w-5xl space-y-6" data-testid="manager-dashboard-page">
      <PageHeader title="Team Overview" subtitle="Monitor your team's attendance and status" />

      {stats && stats.pendingApprovals > 0 && (
        <Link href="/approvals">
          <Card className="border-destructive bg-destructive/5 cursor-pointer hover:bg-destructive/10 transition-colors" data-testid="card-pending-alert">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <div>
                <p className="font-semibold" data-testid="text-pending-count">Pending Approvals: {stats.pendingApprovals}</p>
                <p className="text-sm text-destructive">Action required</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statsLoading ? (
          <>
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </>
        ) : (
          <>
            <Card data-testid="card-team-size">
              <CardContent className="flex flex-col items-center justify-center p-6">
                <Users className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Team Size</p>
                <p className="text-3xl font-bold tabular-nums text-primary" data-testid="text-team-size">{stats?.teamSize ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-clocked-in">
              <CardContent className="flex flex-col items-center justify-center p-6">
                <UserCheck className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Clocked In</p>
                <p className="text-3xl font-bold tabular-nums text-green-600" data-testid="text-clocked-in">{stats?.clockedIn ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-using-pto">
              <CardContent className="flex flex-col items-center justify-center p-6">
                <Clock className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Using PTO</p>
                <p className="text-3xl font-bold tabular-nums text-amber-500" data-testid="text-using-pto">{stats?.usingPto ?? 0}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card data-testid="card-team-status">
        <CardHeader>
          <CardTitle>Team Status</CardTitle>
        </CardHeader>
        <CardContent>
          {teamLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : teamStatus && teamStatus.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Today</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">This Week</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamStatus.map((member) => (
                  <TableRow key={member.id} data-testid={`row-team-member-${member.id}`}>
                    <TableCell className="font-medium" data-testid={`text-member-name-${member.id}`}>
                      {member.firstName} {member.lastName}
                    </TableCell>
                    <TableCell data-testid={`text-member-department-${member.id}`}>
                      {member.departmentName ?? "Unassigned"}
                    </TableCell>
                    <TableCell data-testid={`text-member-status-${member.id}`}>
                      <span className="flex items-center gap-2">
                        <Badge
                          variant={
                            member.status.startsWith("Clocked In") ? "default" : "outline"
                          }
                        >
                          {member.status}
                        </Badge>
                        {member.hasPtoToday && (
                          <Badge variant="secondary" data-testid={`badge-pto-${member.id}`}>
                            PTO
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-member-today-${member.id}`}>
                      {formatHoursMinutes(member.todayHours)}
                    </TableCell>
                    <TableCell className="tabular-nums" data-testid={`text-member-week-${member.id}`}>
                      {formatHoursMinutes(member.weekHours)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-team">No team members found.</p>
          )}
        </CardContent>
      </Card>

      <AttendancePunchTable title="Punch Records" />
    </div>
  );
}
