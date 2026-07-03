import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateRange } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Users, UserCheck, CalendarOff, Clock, AlertTriangle, Timer,
  CheckSquare, FileText, Download, UserPlus, AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AttendancePunchTable } from "@/components/attendance-punch-table";
import type { User, Department, Location, TimeOffRequest, AttendanceException } from "@shared/schema";
import { userDepartmentIds, userLocationIds } from "@shared/schema";

type PendingPtoRequest = TimeOffRequest & { employeeName: string };
type EnrichedException = AttendanceException & { employeeName?: string };

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md" data-testid="error-banner">
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [locationFilter, setLocationFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const { data: allUsers, isLoading: usersLoading, isError: usersError } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: pendingPto, isLoading: ptoLoading, isError: ptoError } = useQuery<PendingPtoRequest[]>({
    queryKey: ["/api/time-off/pending"],
  });

  const { data: pendingExceptions, isLoading: exceptionsLoading, isError: exceptionsError } = useQuery<EnrichedException[]>({
    queryKey: ["/api/attendance/exceptions/pending"],
  });

  const { data: departments, isError: deptsError } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const { data: locations, isError: locsError } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // Company-wide "Active Today" (currently clocked in), respecting the top
  // Location/Department selection. The admin variant of team-status returns
  // company-wide data and `total` reflects the applied filters + status.
  const activeTodayParams = new URLSearchParams({
    status: "clocked_in",
    department: departmentFilter,
    location: locationFilter,
    page: "0",
    pageSize: "1",
  });
  const { data: activeTodayData, isLoading: activeLoading } = useQuery<{ total: number }>({
    queryKey: ["/api/manager/team-status", "active-today", departmentFilter, locationFilter],
    queryFn: async () => {
      const res = await fetch(`/api/manager/team-status?${activeTodayParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load active count");
      return res.json();
    },
  });

  // Employees matching the current Location/Department selection. Employees are
  // M2M with departments/locations, so match on ANY membership.
  const filteredUsers = (allUsers ?? []).filter((u) => {
    if (departmentFilter !== "all" && !userDepartmentIds(u).includes(departmentFilter)) return false;
    if (locationFilter !== "all" && !userLocationIds(u).includes(locationFilter)) return false;
    return true;
  });

  // Filter PTO/exceptions counts by the requesting employee's memberships so the
  // block counts track the selected Location/Department.
  const membershipByUser = new Map(
    (allUsers ?? []).map((u) => [u.id, { deptIds: userDepartmentIds(u), locIds: userLocationIds(u) }]),
  );
  const matchesFilter = (userId: string | null | undefined) => {
    if (departmentFilter === "all" && locationFilter === "all") return true;
    if (!userId) return false;
    const m = membershipByUser.get(userId);
    if (!m) return false;
    if (departmentFilter !== "all" && !m.deptIds.includes(departmentFilter)) return false;
    if (locationFilter !== "all" && !m.locIds.includes(locationFilter)) return false;
    return true;
  };

  const totalEmployees = filteredUsers.length;
  const ptoPendingCount = (pendingPto ?? []).filter((r) => matchesFilter(r.userId)).length;
  const exceptionsPendingCount = (pendingExceptions ?? []).filter((e) => matchesFilter(e.employeeId)).length;
  const departmentsCount = departmentFilter !== "all" ? 1 : departments?.length ?? 0;
  const locationsCount = locationFilter !== "all" ? 1 : locations?.length ?? 0;
  const activeTodayCount = activeTodayData?.total ?? 0;

  // Department Overview reflects the selection: narrow to the chosen department,
  // and when a location is chosen show only departments that have employees there.
  const deptsForOverview = (departments ?? []).filter((d) => {
    if (departmentFilter !== "all" && d.id !== departmentFilter) return false;
    if (locationFilter !== "all") {
      return filteredUsers.some((u) => userDepartmentIds(u).includes(d.id));
    }
    return true;
  });

  // Carry the current Location/Department selection into a destination that
  // supports both filters (Requests & Approvals, Team Overview).
  const withFilters = (base: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (departmentFilter !== "all") p.set("department", departmentFilter);
    if (locationFilter !== "all") p.set("location", locationFilter);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const kpiCards = [
    {
      label: "Total Employees",
      value: totalEmployees,
      icon: Users,
      color: "text-blue-600",
      testId: "kpi-total-employees",
      href: departmentFilter !== "all" ? `/employees?department=${departmentFilter}` : "/employees",
    },
    {
      label: "Departments",
      value: departmentsCount,
      icon: UserCheck,
      color: "text-green-600",
      testId: "kpi-departments",
      href: "/locations?tab=departments",
    },
    {
      label: "PTO Pending",
      value: ptoPendingCount,
      icon: CalendarOff,
      color: "text-amber-500",
      testId: "kpi-pto-pending",
      href: withFilters("/requests-approvals", { tab: "pto" }),
    },
    {
      label: "Exceptions Pending",
      value: exceptionsPendingCount,
      icon: Clock,
      color: "text-orange-500",
      testId: "kpi-exceptions-pending",
      href: withFilters("/requests-approvals", { tab: "exceptions" }),
    },
    {
      label: "Locations",
      value: locationsCount,
      icon: AlertTriangle,
      color: "text-purple-500",
      testId: "kpi-locations",
      href: "/locations?tab=locations",
    },
    {
      label: "Active Today",
      value: activeTodayCount,
      icon: Timer,
      color: "text-teal-500",
      testId: "kpi-active-today",
      href: withFilters("/team", { status: "clocked_in" }),
    },
  ];

  const statsLoading = usersLoading || ptoLoading || exceptionsLoading || activeLoading;

  return (
    <div className="max-w-6xl space-y-6" data-testid="admin-dashboard-page">
      <PageHeader
        title="Dashboard"
        subtitle="Company-wide overview"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-location-filter">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-department-filter">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statsLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          kpiCards.map((kpi) => (
            <Link key={kpi.testId} href={kpi.href} data-testid={`link-${kpi.testId}`}>
              <Card
                data-testid={`card-${kpi.testId}`}
                className="cursor-pointer hover-elevate active-elevate-2 transition-colors"
              >
                <CardContent className="flex flex-col items-center justify-center p-4">
                  <kpi.icon className={`h-5 w-5 mb-1 ${kpi.color}`} />
                  <p className="text-xs text-muted-foreground text-center">{kpi.label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${kpi.color}`} data-testid={`text-${kpi.testId}`}>
                    {kpi.value}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card data-testid="card-live-attendance">
            <CardHeader>
              <CardTitle>Department Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {deptsError ? (
                <ErrorBanner message="Failed to load department data." />
              ) : deptsForOverview.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wider">Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deptsForOverview.map((dept) => (
                      <TableRow key={dept.id} data-testid={`row-dept-${dept.id}`}>
                        <TableCell className="font-medium" data-testid={`text-dept-name-${dept.id}`}>{dept.name}</TableCell>
                        <TableCell data-testid={`text-dept-desc-${dept.id}`}>{dept.description || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4" data-testid="text-no-departments">
                  {departmentFilter !== "all" || locationFilter !== "all"
                    ? "No departments match the current filters."
                    : "No departments configured."}
                </p>
              )}
            </CardContent>
          </Card>

          <AttendancePunchTable title="Live Attendance — Punch Records" />

          <Card data-testid="card-exceptions-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Exceptions
                {pendingExceptions && pendingExceptions.length > 0 && (
                  <Badge variant="destructive">{pendingExceptions.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!pendingExceptions || pendingExceptions.length === 0 ? (
                <p className="text-muted-foreground text-center py-4" data-testid="text-no-exceptions">
                  No pending exceptions.
                </p>
              ) : (
                <div className="space-y-2">
                  {pendingExceptions.slice(0, 5).map((ex) => (
                    <div key={ex.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md" data-testid={`row-exception-${ex.id}`}>
                      <div>
                        <p className="text-sm font-medium">{ex.employeeName || "Employee"}</p>
                        <p className="text-xs text-muted-foreground">{ex.type.replace(/_/g, " ")} — {formatDate(ex.exceptionDate)}</p>
                      </div>
                      <Link href="/alerts-exceptions">
                        <Badge variant="outline" className="cursor-pointer">Review</Badge>
                      </Link>
                    </div>
                  ))}
                  {pendingExceptions.length > 5 && (
                    <Link href="/alerts-exceptions">
                      <p className="text-sm text-primary cursor-pointer text-center mt-2">
                        View all {pendingExceptions.length} exceptions →
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card data-testid="card-approval-queue">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5" />
                Approval Queue
                {pendingPto && pendingPto.length > 0 && (
                  <Badge variant="destructive">{pendingPto.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!pendingPto || pendingPto.length === 0 ? (
                <p className="text-muted-foreground text-center py-4" data-testid="text-no-approvals">
                  No pending approvals.
                </p>
              ) : (
                <div className="space-y-2">
                  {pendingPto.slice(0, 5).map((req) => (
                    <div key={req.id} className="p-3 bg-muted/50 rounded-md" data-testid={`row-approval-${req.id}`}>
                      <p className="text-sm font-medium">{req.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {req.type} — {formatDateRange(req.startDate, req.endDate)}
                      </p>
                    </div>
                  ))}
                  {pendingPto.length > 5 && (
                    <Link href="/requests-approvals">
                      <p className="text-sm text-primary cursor-pointer text-center mt-2">
                        View all →
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-quick-actions">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/reports">
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors" data-testid="link-generate-report">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Generate Report</span>
                </div>
              </Link>
              <Link href="/payroll-prep">
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors" data-testid="link-payroll-prep">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Payroll Prep</span>
                </div>
              </Link>
              <Link href="/employees">
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 hover:bg-muted cursor-pointer transition-colors" data-testid="link-add-employee">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Manage Employees</span>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card data-testid="card-recent-activity">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm" data-testid="text-no-activity">No recent activity.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
