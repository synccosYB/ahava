import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, CalendarOff, Clock, FileText, Download, UserPlus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CompanyStats = {
  totalEmployees: number;
  activeNow: number;
  onLeave: number;
  pendingRequests: number;
};

type DepartmentBreakdown = {
  id: string;
  name: string;
  employees: number;
  active: number;
  onLeave: number;
  avgHoursPerWeek: number;
};

type ActivityItem = {
  text: string;
  timestamp: string;
};

export default function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<CompanyStats>({
    queryKey: ["/api/admin/company-stats"],
  });

  const { data: breakdown, isLoading: breakdownLoading } = useQuery<DepartmentBreakdown[]>({
    queryKey: ["/api/admin/department-breakdown"],
  });

  const { data: activity, isLoading: activityLoading } = useQuery<ActivityItem[]>({
    queryKey: ["/api/admin/recent-activity"],
  });

  return (
    <div className="p-6 space-y-6" data-testid="admin-dashboard-page">
      <h1 className="text-2xl font-bold" data-testid="text-page-title">Company Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsLoading ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : (
          <>
            <Card data-testid="card-total-employees">
              <CardContent className="flex flex-col items-center justify-center p-4">
                <p className="text-xs text-muted-foreground">Total Employees</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-total-employees">{stats?.totalEmployees ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-active-now">
              <CardContent className="flex flex-col items-center justify-center p-4">
                <p className="text-xs text-muted-foreground">Active Now</p>
                <p className="text-3xl font-bold text-green-600" data-testid="text-active-now">{stats?.activeNow ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-on-leave">
              <CardContent className="flex flex-col items-center justify-center p-4">
                <p className="text-xs text-muted-foreground">On Leave</p>
                <p className="text-3xl font-bold text-amber-500" data-testid="text-on-leave">{stats?.onLeave ?? 0}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-pending">
              <CardContent className="flex flex-col items-center justify-center p-4">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-3xl font-bold text-destructive" data-testid="text-pending">{stats?.pendingRequests ?? 0}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card data-testid="card-department-breakdown">
        <CardHeader>
          <CardTitle>Department Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {breakdownLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : breakdown && breakdown.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>On Leave</TableHead>
                  <TableHead>Avg Hrs/Wk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map((dept) => (
                  <TableRow key={dept.id} data-testid={`row-dept-${dept.id}`}>
                    <TableCell className="font-medium" data-testid={`text-dept-name-${dept.id}`}>{dept.name}</TableCell>
                    <TableCell data-testid={`text-dept-employees-${dept.id}`}>{dept.employees}</TableCell>
                    <TableCell data-testid={`text-dept-active-${dept.id}`}>{dept.active}</TableCell>
                    <TableCell data-testid={`text-dept-leave-${dept.id}`}>{dept.onLeave}</TableCell>
                    <TableCell data-testid={`text-dept-avg-${dept.id}`}>{dept.avgHoursPerWeek}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-4" data-testid="text-no-departments">No departments configured.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-quick-actions">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/reports">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors" data-testid="link-generate-report">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Generate Payroll Report</span>
              </div>
            </Link>
            <Link href="/reports">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors" data-testid="link-export-data">
                <Download className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Export All Data</span>
              </div>
            </Link>
            <Link href="/users">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors" data-testid="link-add-employee">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Add New Employee</span>
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card data-testid="card-recent-activity">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-3">
                {activity.map((item, idx) => (
                  <p className="text-sm" key={idx} data-testid={`text-activity-${idx}`}>
                    &bull; {item.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm" data-testid="text-no-activity">No recent activity.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
