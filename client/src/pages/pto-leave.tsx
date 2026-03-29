import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { CalendarDays, Plus, Pencil, Settings } from "lucide-react";
import type { PtoPolicy, User, Company } from "@shared/schema";

export default function PtoLeavePage() {
  return (
    <div className="p-6 space-y-6" data-testid="pto-leave-page">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-6 w-6" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">PTO & Leave</h1>
      </div>
      <Tabs defaultValue="policies" data-testid="tabs-pto">
        <TabsList>
          <TabsTrigger value="policies" data-testid="tab-policies">Policies</TabsTrigger>
          <TabsTrigger value="employee-settings" data-testid="tab-employee-settings">Employee Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="policies"><PoliciesTab /></TabsContent>
        <TabsContent value="employee-settings"><EmployeePtoTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function PoliciesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", description: "", accrualType: "annual", accrualRate: "15",
    yearlyCapHours: "", carryoverCapHours: "0", waitingPeriodDays: "0",
    sickAccrualEnabled: true, personalDaysPerYear: "5",
    holidayPayEnabled: true, isDefault: false,
  });

  const { data: policies, isLoading } = useQuery<PtoPolicy[]>({ queryKey: ["/api/pto-policies"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        accrualType: form.accrualType,
        accrualRate: parseFloat(form.accrualRate) || 15,
        yearlyCapHours: form.yearlyCapHours ? parseFloat(form.yearlyCapHours) : null,
        carryoverCapHours: parseFloat(form.carryoverCapHours) || 0,
        waitingPeriodDays: parseInt(form.waitingPeriodDays) || 0,
        sickAccrualEnabled: form.sickAccrualEnabled,
        personalDaysPerYear: parseFloat(form.personalDaysPerYear) || 5,
        holidayPayEnabled: form.holidayPayEnabled,
        isDefault: form.isDefault,
        companyId: companies?.[0]?.id || null,
      };
      if (editingId) {
        await apiRequest("PATCH", `/api/pto-policies/${editingId}`, payload);
      } else {
        await apiRequest("POST", "/api/pto-policies", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pto-policies"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editingId ? "Policy updated" : "Policy created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({
      name: "", description: "", accrualType: "annual", accrualRate: "15",
      yearlyCapHours: "", carryoverCapHours: "0", waitingPeriodDays: "0",
      sickAccrualEnabled: true, personalDaysPerYear: "5",
      holidayPayEnabled: true, isDefault: false,
    });
    setEditingId(null);
  };

  const startEdit = (p: PtoPolicy) => {
    setForm({
      name: p.name,
      description: p.description || "",
      accrualType: p.accrualType,
      accrualRate: String(p.accrualRate),
      yearlyCapHours: p.yearlyCapHours ? String(p.yearlyCapHours) : "",
      carryoverCapHours: String(p.carryoverCapHours || 0),
      waitingPeriodDays: String(p.waitingPeriodDays || 0),
      sickAccrualEnabled: p.sickAccrualEnabled,
      personalDaysPerYear: String(p.personalDaysPerYear),
      holidayPayEnabled: p.holidayPayEnabled,
      isDefault: p.isDefault,
    });
    setEditingId(p.id);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-policy"><Plus className="h-4 w-4 mr-1" /> Add Policy</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-policy-form">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit PTO Policy" : "Create PTO Policy"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Policy Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-policy-name" /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-policy-description" /></div>
              <div>
                <Label>Accrual Type</Label>
                <Select value={form.accrualType} onValueChange={(v) => setForm({ ...form, accrualType: v })}>
                  <SelectTrigger data-testid="select-accrual-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="per_pay_period">Per Pay Period</SelectItem>
                    <SelectItem value="per_hours_worked">Per Hours Worked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Accrual Rate (days/year)</Label><Input type="number" value={form.accrualRate} onChange={(e) => setForm({ ...form, accrualRate: e.target.value })} data-testid="input-accrual-rate" /></div>
                <div><Label>Yearly Cap (hours)</Label><Input type="number" value={form.yearlyCapHours} onChange={(e) => setForm({ ...form, yearlyCapHours: e.target.value })} data-testid="input-yearly-cap" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Carryover Cap (hours)</Label><Input type="number" value={form.carryoverCapHours} onChange={(e) => setForm({ ...form, carryoverCapHours: e.target.value })} data-testid="input-carryover-cap" /></div>
                <div><Label>Waiting Period (days)</Label><Input type="number" value={form.waitingPeriodDays} onChange={(e) => setForm({ ...form, waitingPeriodDays: e.target.value })} data-testid="input-waiting-period" /></div>
              </div>
              <div><Label>Personal Days/Year</Label><Input type="number" value={form.personalDaysPerYear} onChange={(e) => setForm({ ...form, personalDaysPerYear: e.target.value })} data-testid="input-personal-days" /></div>
              <div className="flex items-center justify-between">
                <Label>Sick Accrual Enabled</Label>
                <Switch checked={form.sickAccrualEnabled} onCheckedChange={(v) => setForm({ ...form, sickAccrualEnabled: v })} data-testid="switch-sick-accrual" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Holiday Pay Enabled</Label>
                <Switch checked={form.holidayPayEnabled} onCheckedChange={(v) => setForm({ ...form, holidayPayEnabled: v })} data-testid="switch-holiday-pay" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Set as Default</Label>
                <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} data-testid="switch-is-default" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending} data-testid="button-save-policy">
                {saveMutation.isPending ? "Saving..." : "Save Policy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card data-testid="card-policies-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !policies || policies.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-policies">No PTO policies configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Accrual Type</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id} data-testid={`row-policy-${p.id}`}>
                    <TableCell className="font-medium" data-testid={`text-policy-name-${p.id}`}>{p.name}</TableCell>
                    <TableCell data-testid={`text-policy-accrual-${p.id}`}>{p.accrualType}</TableCell>
                    <TableCell data-testid={`text-policy-rate-${p.id}`}>{p.accrualRate} days/yr</TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"} data-testid={`badge-policy-status-${p.id}`}>
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-policy-default-${p.id}`}>
                      {p.isDefault && <Badge className="bg-blue-600">Default</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => startEdit(p)} data-testid={`button-edit-policy-${p.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
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

function EmployeePtoTab() {
  const { toast } = useToast();
  const [selectedUser, setSelectedUser] = useState<string>("");

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: policies } = useQuery<PtoPolicy[]>({ queryKey: ["/api/pto-policies"] });

  const { data: settings, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ["/api/employee-pto-settings", selectedUser],
    enabled: !!selectedUser,
  });

  const [form, setForm] = useState({
    ptoPolicyId: "",
    vacationBalanceOverride: "",
    sickBalanceOverride: "",
    personalBalanceOverride: "",
    notes: "",
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        userId: selectedUser,
        ptoPolicyId: form.ptoPolicyId || null,
        vacationBalanceOverride: form.vacationBalanceOverride ? parseFloat(form.vacationBalanceOverride) : null,
        sickBalanceOverride: form.sickBalanceOverride ? parseFloat(form.sickBalanceOverride) : null,
        personalBalanceOverride: form.personalBalanceOverride ? parseFloat(form.personalBalanceOverride) : null,
        notes: form.notes || null,
      };
      if (settings?.id) {
        await apiRequest("PATCH", `/api/employee-pto-settings/${selectedUser}`, payload);
      } else {
        await apiRequest("POST", "/api/employee-pto-settings", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-pto-settings", selectedUser] });
      toast({ title: "PTO settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleUserSelect = (userId: string) => {
    setSelectedUser(userId);
    setForm({
      ptoPolicyId: "",
      vacationBalanceOverride: "",
      sickBalanceOverride: "",
      personalBalanceOverride: "",
      notes: "",
    });
  };

  return (
    <div className="space-y-4 mt-4">
      <Card data-testid="card-employee-pto-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Per-Employee PTO Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Select Employee</Label>
            <Select value={selectedUser} onValueChange={handleUserSelect}>
              <SelectTrigger data-testid="select-employee-pto">
                <SelectValue placeholder="Choose an employee..." />
              </SelectTrigger>
              <SelectContent>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUser && (
            <>
              {settingsLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Assigned PTO Policy</Label>
                    <Select value={form.ptoPolicyId || "none"} onValueChange={(v) => setForm({ ...form, ptoPolicyId: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="select-assigned-policy">
                        <SelectValue placeholder="Use default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Use Company Default</SelectItem>
                        {policies?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Vacation Override (days)</Label>
                      <Input type="number" value={form.vacationBalanceOverride} onChange={(e) => setForm({ ...form, vacationBalanceOverride: e.target.value })} data-testid="input-vacation-override" />
                    </div>
                    <div>
                      <Label>Sick Override (days)</Label>
                      <Input type="number" value={form.sickBalanceOverride} onChange={(e) => setForm({ ...form, sickBalanceOverride: e.target.value })} data-testid="input-sick-override" />
                    </div>
                    <div>
                      <Label>Personal Override (days)</Label>
                      <Input type="number" value={form.personalBalanceOverride} onChange={(e) => setForm({ ...form, personalBalanceOverride: e.target.value })} data-testid="input-personal-override" />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-pto-notes" />
                  </div>
                  <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-employee-pto">
                    {saveMutation.isPending ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
