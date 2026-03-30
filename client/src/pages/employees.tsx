import { useState, useRef } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Search, UserPlus, ArrowLeft, ChevronRight, AlertCircle, KeyRound, Copy, Upload, Download, FileText, CheckCircle2, Circle, Clock, Trash2, Eye, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { User, Department, Location, EmploymentProfile } from "@shared/schema";

type EmployeeListItem = User & {
  departmentName?: string;
  locationName?: string;
  lastPunch?: string;
  payType?: string;
  ptoEligible?: boolean;
};

const REQUIRED_DOCUMENT_TYPES = [
  { key: "w9", label: "W-9" },
  { key: "i9", label: "I-9" },
  { key: "direct_deposit", label: "Direct Deposit Authorization" },
  { key: "emergency_contact", label: "Emergency Contact Form" },
  { key: "handbook_ack", label: "Employee Handbook Acknowledgment" },
];

export default function EmployeesPage() {
  const [, navigate] = useLocation();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

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
        <AddEmployeeDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          departments={departments || []}
          locations={locations || []}
        />
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

function AddEmployeeDialog({
  open,
  onOpenChange,
  departments,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: Department[];
  locations: Location[];
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    role: "employee",
    departmentId: "",
    locationId: "",
    employmentType: "full_time",
    hireDate: new Date().toISOString().split("T")[0],
    payType: "hourly",
    hourlyRate: "",
    weeklySalary: "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string | number | null> = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        role: formData.role,
        departmentId: formData.departmentId || null,
        locationId: formData.locationId || null,
        employmentType: formData.employmentType,
        hireDate: formData.hireDate,
        payType: formData.payType,
      };
      if (formData.payType === "hourly" && formData.hourlyRate) {
        body.hourlyRate = parseFloat(formData.hourlyRate);
      }
      if (formData.payType === "salary" && formData.weeklySalary) {
        body.weeklySalary = parseFloat(formData.weeklySalary);
      }
      const res = await apiRequest("POST", "/api/users", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setTempPassword(data.temporaryPassword);
      setStep(4);
      toast({ title: "Employee created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setStep(1);
    setTempPassword(null);
    setFormData({
      firstName: "", lastName: "", email: "", role: "employee",
      departmentId: "", locationId: "", employmentType: "full_time",
      hireDate: new Date().toISOString().split("T")[0], payType: "hourly",
      hourlyRate: "", weeklySalary: "",
    });
    onOpenChange(false);
  };

  const copyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      toast({ title: "Copied to clipboard" });
    }
  };

  const canProceedStep1 = formData.firstName && formData.lastName && formData.email;
  const canProceedStep2 = true;
  const canProceedStep3 = true;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-employee" onClick={() => onOpenChange(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" data-testid="dialog-add-employee">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {step === 4 ? "Employee Created" : `Add Employee — Step ${step} of 3`}
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Enter basic information for the new employee."}
            {step === 2 && "Set employment details."}
            {step === 3 && "Configure pay setup."}
            {step === 4 && "Share the temporary password with the employee."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="First name"
                  data-testid="input-add-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Last name"
                  data-testid="input-add-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="employee@company.com"
                data-testid="input-add-email"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                <SelectTrigger data-testid="select-add-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={formData.departmentId || "none"} onValueChange={(v) => setFormData({ ...formData, departmentId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-add-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={formData.locationId || "none"} onValueChange={(v) => setFormData({ ...formData, locationId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-add-location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Location</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Employment Type</Label>
              <Select value={formData.employmentType} onValueChange={(v) => setFormData({ ...formData, employmentType: v })}>
                <SelectTrigger data-testid="select-add-employment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="per_diem">Per Diem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hire Date</Label>
              <Input
                type="date"
                value={formData.hireDate}
                onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                data-testid="input-add-hire-date"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pay Type</Label>
              <Select value={formData.payType} onValueChange={(v) => setFormData({ ...formData, payType: v })}>
                <SelectTrigger data-testid="select-add-pay-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="salary">Salary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.payType === "hourly" && (
              <div className="space-y-2">
                <Label>Hourly Rate ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.hourlyRate}
                  onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-add-hourly-rate"
                />
              </div>
            )}
            {formData.payType === "salary" && (
              <div className="space-y-2">
                <Label>Weekly Salary ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.weeklySalary}
                  onChange={(e) => setFormData({ ...formData, weeklySalary: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-add-weekly-salary"
                />
              </div>
            )}
          </div>
        )}

        {step === 4 && tempPassword && (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                The employee has been created with a temporary password. Share this password securely — they will be required to change it on first login.
              </p>
              <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded border p-3">
                <code className="flex-1 text-lg font-mono" data-testid="text-temp-password">{tempPassword}</code>
                <Button size="sm" variant="outline" onClick={copyPassword} data-testid="button-copy-password">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step < 4 && step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} data-testid="button-step-back">
              Back
            </Button>
          )}
          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!canProceedStep1} data-testid="button-step-next">
              Next
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!canProceedStep2} data-testid="button-step-next">
              Next
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              data-testid="button-create-employee"
            >
              {createMutation.isPending ? "Creating..." : "Create Employee"}
            </Button>
          )}
          {step === 4 && (
            <Button onClick={handleClose} data-testid="button-done">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            <ResetPasswordButton userId={userId} />
          </div>
        }
      />

      <OnboardingChecklist userId={userId} user={user} profile={profile} />

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
                Time clock settings are managed through the Rules & Controls center. This employee follows the division default time clock rules.
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
          <DocumentsTab userId={userId} />
        </TabsContent>

        <TabsContent value="history">
          <EmployeeAuditHistory userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResetPasswordButton({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/users/${userId}/reset-password`);
      return res.json();
    },
    onSuccess: (data) => {
      setTempPassword(data.temporaryPassword);
      toast({ title: "Password reset successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      toast({ title: "Copied to clipboard" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTempPassword(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-reset-password">
          <KeyRound className="h-4 w-4 mr-2" />
          Reset Password
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-reset-password">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            {tempPassword
              ? "A new temporary password has been generated. Share it securely with the employee."
              : "Generate a new temporary password for this employee. They will be required to change it on next login."}
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-muted rounded border p-3">
              <code className="flex-1 text-lg font-mono" data-testid="text-reset-temp-password">{tempPassword}</code>
              <Button size="sm" variant="outline" onClick={copyPassword} data-testid="button-copy-reset-password">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              data-testid="button-confirm-reset"
            >
              {resetMutation.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

type DocumentRecord = {
  id: string;
  employeeId: string;
  documentType: string;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  uploadedBy: string | null;
  uploadedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

function DocumentsTab({ userId }: { userId: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery<DocumentRecord[]>({
    queryKey: ["/api/users", userId, "documents"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", documentType);
      const res = await fetch(`/api/users/${userId}/documents`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Document uploaded" });
      setUploadingType(null);
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setUploadingType(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ docId, status }: { docId: string; status: string }) => {
      await apiRequest("PATCH", `/api/documents/${docId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiRequest("DELETE", `/api/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (docType: string) => {
    setUploadingType(docType);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadingType) {
      uploadMutation.mutate({ file, documentType: uploadingType });
    }
    e.target.value = "";
  };

  const getDocForType = (type: string) => {
    return (docs || []).filter((d) => d.documentType === type);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "reviewed":
        return <Badge className="bg-green-600">Reviewed</Badge>;
      case "uploaded":
        return <Badge variant="outline" className="text-amber-600 border-amber-300">Uploaded</Badge>;
      default:
        return <Badge variant="secondary">Missing</Badge>;
    }
  };

  return (
    <Card data-testid="card-documents">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={handleFileChange}
          data-testid="input-file-upload"
        />

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {REQUIRED_DOCUMENT_TYPES.map((docType) => {
              const typeDocs = getDocForType(docType.key);
              const latestDoc = typeDocs[0];

              return (
                <div
                  key={docType.key}
                  className="border rounded-lg p-4"
                  data-testid={`doc-section-${docType.key}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium" data-testid={`text-doc-type-${docType.key}`}>{docType.label}</p>
                        {latestDoc ? (
                          <p className="text-xs text-muted-foreground" data-testid={`text-doc-file-${docType.key}`}>
                            {latestDoc.fileName}
                            {latestDoc.uploadedAt && ` — ${new Date(latestDoc.uploadedAt).toLocaleDateString()}`}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not yet uploaded</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {latestDoc ? (
                        <>
                          {getStatusBadge(latestDoc.status)}
                          {latestDoc.status === "uploaded" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => statusMutation.mutate({ docId: latestDoc.id, status: "reviewed" })}
                              data-testid={`button-review-${docType.key}`}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Mark Reviewed
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            data-testid={`button-view-${docType.key}`}
                          >
                            <a href={`/api/documents/${latestDoc.id}/download?view=inline`} target="_blank" rel="noopener noreferrer" title="View">
                              <Eye className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            data-testid={`button-download-${docType.key}`}
                          >
                            <a href={`/api/documents/${latestDoc.id}/download`} target="_blank" rel="noopener noreferrer" title="Download">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(latestDoc.id)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-${docType.key}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Badge variant="secondary">Missing</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleFileSelect(docType.key)}
                        disabled={uploadMutation.isPending && uploadingType === docType.key}
                        data-testid={`button-upload-${docType.key}`}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        {latestDoc ? "Replace" : "Upload"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OnboardingChecklist({
  userId,
  user,
  profile,
}: {
  userId: string;
  user: User | undefined;
  profile: EmploymentProfile | undefined;
}) {
  const { data: docs } = useQuery<DocumentRecord[]>({
    queryKey: ["/api/users", userId, "documents"],
  });

  const hasBasicInfo = !!(user?.firstName && user?.lastName && user?.email);
  const hasEmployment = !!(profile?.employmentType && profile?.hireDate);
  const hasPaySetup = !!(profile?.payType && (profile?.hourlyRate || profile?.weeklySalary));

  const uploadedDocTypes = new Set((docs || []).map((d) => d.documentType));
  const allDocsCollected = REQUIRED_DOCUMENT_TYPES.every((dt) => uploadedDocTypes.has(dt.key));
  const docsCount = REQUIRED_DOCUMENT_TYPES.filter((dt) => uploadedDocTypes.has(dt.key)).length;

  const steps = [
    { label: "Basic Info Complete", done: hasBasicInfo },
    { label: "Employment Set Up", done: hasEmployment },
    { label: "Pay Configured", done: hasPaySetup },
    { label: `Documents Collected (${docsCount}/${REQUIRED_DOCUMENT_TYPES.length})`, done: allDocsCollected },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allComplete = completedCount === steps.length;

  return (
    <Card data-testid="card-onboarding-checklist">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Onboarding Checklist</CardTitle>
          <Badge
            variant={allComplete ? "default" : "secondary"}
            className={allComplete ? "bg-green-600" : ""}
            data-testid="badge-onboarding-status"
          >
            {allComplete ? "Complete" : `${completedCount}/${steps.length}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {steps.map((step) => (
            <div
              key={step.label}
              className="flex items-center gap-2 p-2 rounded"
              data-testid={`checklist-item-${step.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
            >
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className={`text-sm ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface AuditLogEntry {
  id: string;
  action: string;
  actorUserId: string;
  targetId: string;
  targetType: string;
  createdAt: string;
}

function EmployeeAuditHistory({ userId }: { userId: string }) {
  const { data: logs, isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/audit-logs"],
  });

  const userLogs = (logs || []).filter((l) => l.actorUserId === userId || l.targetId === userId).slice(0, 20);

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
              {userLogs.map((log) => (
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
