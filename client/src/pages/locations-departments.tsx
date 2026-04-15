import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MapPin, Building2, Plus, Pencil, Trash2, ChevronsUpDown, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { Location, Department, Division, User } from "@shared/schema";

type DepartmentWithManagers = Department & { managerIds: string[] };

export default function LocationsDepartmentsPage() {
  return (
    <div className="max-w-6xl space-y-6" data-testid="locations-departments-page">
      <PageHeader title="Locations & Departments" subtitle="Configure division locations and department structure" />
      <Tabs defaultValue="locations" data-testid="tabs-loc-dept">
        <TabsList>
          <TabsTrigger value="locations" data-testid="tab-locations">
            <MapPin className="h-4 w-4 mr-1" /> Locations
          </TabsTrigger>
          <TabsTrigger value="departments" data-testid="tab-departments">
            <Building2 className="h-4 w-4 mr-1" /> Departments
          </TabsTrigger>
        </TabsList>
        <TabsContent value="locations"><LocationsTab /></TabsContent>
        <TabsContent value="departments"><DepartmentsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function LocationsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", address: "", city: "", state: "", zip: "", timezone: "" });

  const { data: locations, isLoading } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const divisionId = divisions?.[0]?.id;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (editingId) {
        await apiRequest("PATCH", `/api/locations/${editingId}`, form);
      } else {
        await apiRequest("POST", "/api/locations", { ...form, companyId: divisionId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editingId ? "Location updated" : "Location created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", code: "", address: "", city: "", state: "", zip: "", timezone: "" });
    setEditingId(null);
  };

  const startEdit = (loc: Location) => {
    setForm({
      name: loc.name,
      code: loc.code || "",
      address: loc.address || "",
      city: loc.city || "",
      state: loc.state || "",
      zip: loc.zip || "",
      timezone: loc.timezone || "",
    });
    setEditingId(loc.id);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-location"><Plus className="h-4 w-4 mr-1" /> Add Location</Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-location-form">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Location" : "Add Location"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-location-name" /></div>
              <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="input-location-code" /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-location-address" /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="input-location-city" /></div>
                <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} data-testid="input-location-state" /></div>
                <div><Label>ZIP</Label><Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} data-testid="input-location-zip" /></div>
              </div>
              <div><Label>Timezone</Label><Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/New_York" data-testid="input-location-timezone" /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} data-testid="button-save-location">
                {createMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card data-testid="card-locations-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !locations || locations.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-locations">No locations configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Code</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Address</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((loc) => (
                  <TableRow key={loc.id} data-testid={`row-location-${loc.id}`}>
                    <TableCell className="font-medium" data-testid={`text-location-name-${loc.id}`}>{loc.name}</TableCell>
                    <TableCell data-testid={`text-location-code-${loc.id}`}>{loc.code || "—"}</TableCell>
                    <TableCell data-testid={`text-location-address-${loc.id}`}>
                      {[loc.city, loc.state].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={loc.isActive ? "default" : "secondary"} data-testid={`badge-location-status-${loc.id}`}>
                        {loc.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => startEdit(loc)} data-testid={`button-edit-location-${loc.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(loc.id)} data-testid={`button-delete-location-${loc.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
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

function DepartmentsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", managerIds: [] as string[], locationId: "" });
  const [managersPopoverOpen, setManagersPopoverOpen] = useState(false);

  const { data: departments, isLoading } = useQuery<DepartmentWithManagers[]>({ queryKey: ["/api/departments"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const divisionId = divisions?.[0]?.id;

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        managerIds: form.managerIds,
        locationId: form.locationId || null,
        companyId: divisionId || null,
      };
      if (editingId) {
        await apiRequest("PATCH", `/api/departments/${editingId}`, payload);
      } else {
        await apiRequest("POST", "/api/departments", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editingId ? "Department updated" : "Department created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({ title: "Department deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", description: "", managerIds: [], locationId: "" });
    setEditingId(null);
  };

  const startEdit = (dept: DepartmentWithManagers) => {
    setForm({
      name: dept.name,
      description: dept.description || "",
      managerIds: dept.managerIds || [],
      locationId: dept.locationId || "",
    });
    setEditingId(dept.id);
    setDialogOpen(true);
  };

  const eligibleManagers = (users || []).filter((u) => u.role === "manager" || u.role === "admin");

  const toggleManager = (userId: string) => {
    setForm(prev => ({
      ...prev,
      managerIds: prev.managerIds.includes(userId)
        ? prev.managerIds.filter(id => id !== userId)
        : [...prev.managerIds, userId],
    }));
  };

  const getManagerNames = (ids: string[]) => {
    return ids
      .map(id => users?.find(u => u.id === id))
      .filter(Boolean)
      .map(u => `${u!.firstName} ${u!.lastName}`);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-department"><Plus className="h-4 w-4 mr-1" /> Add Department</Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-department-form">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Department" : "Add Department"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-department-name" /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-department-description" /></div>
              <div>
                <Label>Managers</Label>
                <Popover open={managersPopoverOpen} onOpenChange={setManagersPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between font-normal" data-testid="select-department-managers">
                      {form.managerIds.length === 0
                        ? "Select managers..."
                        : `${form.managerIds.length} manager${form.managerIds.length > 1 ? "s" : ""} selected`}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <div className="max-h-60 overflow-y-auto p-1">
                      {eligibleManagers.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">No managers available</p>
                      ) : (
                        eligibleManagers.map((u) => (
                          <label
                            key={u.id}
                            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
                            data-testid={`option-manager-${u.id}`}
                          >
                            <Checkbox
                              checked={form.managerIds.includes(u.id)}
                              onCheckedChange={() => toggleManager(u.id)}
                              data-testid={`checkbox-manager-${u.id}`}
                            />
                            {u.firstName} {u.lastName}
                          </label>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {form.managerIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5" data-testid="selected-managers-list">
                    {getManagerNames(form.managerIds).map((name, i) => (
                      <Badge key={form.managerIds[i]} variant="secondary" className="text-xs">
                        {name}
                        <button
                          type="button"
                          className="ml-1 hover:text-destructive"
                          onClick={() => toggleManager(form.managerIds[i])}
                          data-testid={`remove-manager-${form.managerIds[i]}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label>Location</Label>
                <Select value={form.locationId || "none"} onValueChange={(v) => setForm({ ...form, locationId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-department-location">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {locations?.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} data-testid="button-save-department">
                {createMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card data-testid="card-departments-list">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !departments || departments.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-departments">No departments configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Description</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Managers</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((dept) => {
                  const mgrNames = getManagerNames(dept.managerIds || []);
                  const loc = locations?.find((l) => l.id === dept.locationId);
                  return (
                    <TableRow key={dept.id} data-testid={`row-department-${dept.id}`}>
                      <TableCell className="font-medium" data-testid={`text-department-name-${dept.id}`}>{dept.name}</TableCell>
                      <TableCell data-testid={`text-department-desc-${dept.id}`}>{dept.description || "—"}</TableCell>
                      <TableCell data-testid={`text-department-managers-${dept.id}`}>
                        {mgrNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {mgrNames.map((name, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{name}</Badge>
                            ))}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell data-testid={`text-department-location-${dept.id}`}>{loc?.name || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => startEdit(dept)} data-testid={`button-edit-department-${dept.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(dept.id)} data-testid={`button-delete-department-${dept.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
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
