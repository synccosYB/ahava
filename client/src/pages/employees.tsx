import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Search, UserPlus, ArrowLeft, ChevronRight, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { User, Department, Location, EmploymentProfile } from "@shared/schema";

type EmployeeListItem = User & {
  departmentName?: string;
  locationName?: string;
  lastPunch?: string;
  payType?: string;
  ptoEligible?: boolean;
};

export default function EmployeesPage() {
  const [, navigate] = useLocation();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const { data: users, isLoading, isError } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const filtered = (users || []).filter((u) => {
    const name = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase()) && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
    if (departmentFilter !== "all" && u.departmentId !== departmentFilter) return false;
    return true;
  });

  if (selectedEmployee) {
    return <EmployeeProfile userId={selectedEmployee} onBack={() => setSelectedEmployee(null)} />;
  }

  return (
    <div className="max-w-6xl space-y-6" data-testid="employees-page">
      <PageHeader title="Employees" subtitle="Manage employee records and profiles" />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-employees"
          />
        </div>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-department-filter">
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

      <Card data-testid="card-employees-list">
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6 flex items-center gap-2 text-destructive" data-testid="error-employees">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm">Failed to load employees.</p>
            </div>
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-employees">
              No employees found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Email</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Role</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => {
                  const dept = departments?.find((d) => d.id === emp.departmentId);
                  const loc = locations?.find((l) => l.id === emp.locationId);
                  return (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedEmployee(emp.id)}
                      data-testid={`row-employee-${emp.id}`}
                    >
                      <TableCell className="font-medium" data-testid={`text-employee-name-${emp.id}`}>
                        {emp.firstName} {emp.lastName}
                      </TableCell>
                      <TableCell data-testid={`text-employee-email-${emp.id}`}>{emp.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" data-testid={`badge-employee-role-${emp.id}`}>
                          {emp.role}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-employee-dept-${emp.id}`}>{dept?.name || "—"}</TableCell>
                      <TableCell data-testid={`text-employee-loc-${emp.id}`}>{loc?.name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="default" className="bg-green-600" data-testid={`badge-employee-status-${emp.id}`}>
                          Active
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
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

function EmployeeProfile({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("basic");

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const user = users?.find((u) => u.id === userId);

  const { data: profile, isLoading: profileLoading } = useQuery<EmploymentProfile>({
    queryKey: ["/api/employment-profiles", userId],
  });

  const { data: departments } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const roleMutation = useMutation({
    mutationFn: async (newRole: string) => {
      await apiRequest("PATCH", `/api/users/${userId}/role`, { role: newRole });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const dept = departments?.find((d) => d.id === user?.departmentId);
  const loc = locations?.find((l) => l.id === user?.locationId);

  return (
    <div className="max-w-6xl space-y-6" data-testid="employee-profile-page">
      <PageHeader
        title={`${user?.firstName || ""} ${user?.lastName || ""}`}
        subtitle={user?.email || ""}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Badge variant="outline" data-testid="badge-employee-profile-role">
              {user?.role}
            </Badge>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-employee-profile">
        <TabsList className="flex-wrap" data-testid="tabs-list-employee">
          <TabsTrigger value="basic" data-testid="tab-basic-info">Basic Info</TabsTrigger>
          <TabsTrigger value="employment" data-testid="tab-employment">Employment</TabsTrigger>
          <TabsTrigger value="pay" data-testid="tab-pay-setup">Pay Setup</TabsTrigger>
          <TabsTrigger value="timeclock" data-testid="tab-time-clock">Time Clock Settings</TabsTrigger>
          <TabsTrigger value="pto" data-testid="tab-pto-leave">PTO/Leave</TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-schedule">Schedule</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History/Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card data-testid="card-basic-info">
            <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">First Name</Label>
                <p className="font-medium" data-testid="text-profile-first-name">{user?.firstName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Last Name</Label>
                <p className="font-medium" data-testid="text-profile-last-name">{user?.lastName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Email</Label>
                <p className="font-medium" data-testid="text-profile-email">{user?.email || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Role</Label>
                <Select value={user?.role || "employee"} onValueChange={(v) => roleMutation.mutate(v)}>
                  <SelectTrigger data-testid="select-profile-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment">
          <Card data-testid="card-employment">
            <CardHeader><CardTitle>Employment Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Department</Label>
                <p className="font-medium" data-testid="text-profile-department">{dept?.name || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Location</Label>
                <p className="font-medium" data-testid="text-profile-location">{loc?.name || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Employment Type</Label>
                <p className="font-medium" data-testid="text-profile-employment-type">{profile?.employmentType || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Hire Date</Label>
                <p className="font-medium" data-testid="text-profile-hire-date">{profile?.hireDate || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Overtime Eligible</Label>
                <p className="font-medium" data-testid="text-profile-overtime">
                  {profile?.overtimeEligible ? "Yes" : "No"}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pay">
          <Card data-testid="card-pay-setup">
            <CardHeader><CardTitle>Pay Setup</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Pay Type</Label>
                <p className="font-medium" data-testid="text-profile-pay-type">{profile?.payType || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Hourly Rate</Label>
                <p className="font-medium" data-testid="text-profile-hourly-rate">
                  {profile?.hourlyRate ? `$${profile.hourlyRate.toFixed(2)}` : "—"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Weekly Salary</Label>
                <p className="font-medium" data-testid="text-profile-weekly-salary">
                  {profile?.weeklySalary ? `$${profile.weeklySalary.toFixed(2)}` : "—"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Holiday Pay</Label>
                <p className="font-medium" data-testid="text-profile-holiday-pay">
                  {profile?.holidayPayEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeclock">
          <Card data-testid="card-time-clock-settings">
            <CardHeader><CardTitle>Time Clock Settings</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-timeclock-info">
                Time clock settings are managed through the Rules & Controls center. This employee follows the company default time clock rules.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pto">
          <Card data-testid="card-pto-leave">
            <CardHeader><CardTitle>PTO / Leave</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-pto-info">
                PTO settings for this employee can be managed in the PTO & Leave section.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <Card data-testid="card-schedule">
            <CardHeader><CardTitle>Schedule</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-schedule-info">
                Scheduling module will be available in Phase 2.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card data-testid="card-documents">
            <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground" data-testid="text-documents-info">
                No documents uploaded yet.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <EmployeeAuditHistory userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmployeeAuditHistory({ userId }: { userId: string }) {
  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/audit-logs"],
  });

  const userLogs = (logs || []).filter((l: any) => l.actorUserId === userId || l.targetId === userId).slice(0, 20);

  return (
    <Card data-testid="card-audit-history">
      <CardHeader><CardTitle>History / Audit</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : userLogs.length === 0 ? (
          <p className="text-muted-foreground text-center py-4" data-testid="text-no-audit">No audit history found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Action</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Target</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userLogs.map((log: any) => (
                <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                  <TableCell className="font-medium">{log.action}</TableCell>
                  <TableCell>{log.targetType}</TableCell>
                  <TableCell>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
