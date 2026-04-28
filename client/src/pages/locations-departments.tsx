import { useState, useEffect } from "react";
import { Link } from "wouter";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MapPin, Building2, Plus, Pencil, Trash2, ChevronsUpDown, X, Building } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";
import type { Location, Department, Division, User, LocationAddress } from "@shared/schema";

const NO_COMPANY_MESSAGE =
  "No company is set up yet — please set one up in Rules & Controls → General.";

const GENERIC_LOCATION_INVALID =
  "Couldn't save location — please check the highlighted fields and try again.";
const GENERIC_ADDRESS_INVALID =
  "Couldn't save address — please check the highlighted fields and try again.";
const GENERIC_DEPARTMENT_INVALID =
  "Couldn't save department — please check the highlighted fields and try again.";

interface ServerErrorBody {
  message?: string;
  errors?: {
    fieldErrors?: Record<string, string[]>;
  };
}

function isServerErrorBody(value: unknown): value is ServerErrorBody {
  return typeof value === "object" && value !== null;
}

function friendlyMutationError(err: Error, fallback: string): string {
  const msg = err?.message || "";

  let body = msg;
  const match = msg.match(/^\d+:\s*([\s\S]*)$/);
  if (match) {
    body = match[1].trim();
  }

  let parsed: ServerErrorBody | null = null;
  try {
    const raw: unknown = JSON.parse(body);
    if (isServerErrorBody(raw)) {
      parsed = raw;
    }
  } catch {
    parsed = null;
  }

  const fieldErrors = parsed?.errors?.fieldErrors ?? {};
  const serverMessage = parsed?.message;

  const companyIdErrors = fieldErrors.companyId;
  if (Array.isArray(companyIdErrors) && /required/i.test(companyIdErrors.join(" "))) {
    return NO_COMPANY_MESSAGE;
  }
  if (/companyId/i.test(body) && /required/i.test(body)) {
    return NO_COMPANY_MESSAGE;
  }

  if (serverMessage) {
    if (/invalid location data/i.test(serverMessage)) return fallback || GENERIC_LOCATION_INVALID;
    if (/invalid address data/i.test(serverMessage)) return GENERIC_ADDRESS_INVALID;
    if (/invalid department data/i.test(serverMessage)) return fallback || GENERIC_DEPARTMENT_INVALID;
    return serverMessage;
  }

  if (parsed) {
    return fallback;
  }

  if (body && !/^\s*[{\[]/.test(body)) {
    return body;
  }

  return fallback;
}

function NoCompanyEmptyState({ entity }: { entity: string }) {
  return (
    <Card data-testid={`empty-state-no-company-${entity}`}>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <Building className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">Set up your company first</p>
          <p className="text-sm text-muted-foreground max-w-md">
            You need to create your company (division) before adding {entity}. Head to Rules &amp; Controls
            → General to set it up.
          </p>
        </div>
        <Link href="/rules-controls">
          <Button data-testid={`button-go-to-general-${entity}`}>
            Set up company
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

interface AddressEntry {
  id?: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const emptyAddress = (): AddressEntry => ({ label: "", address: "", city: "", state: "", zip: "" });

type DepartmentWithManagers = Department & { managerIds: string[] };

function resolveActiveCompanyId(
  user: { companyId?: string | null } | null | undefined,
  divisions: Division[] | undefined,
): string | undefined {
  const userCompanyId = user?.companyId || undefined;
  if (userCompanyId) {
    const match = divisions?.find((d) => d.id === userCompanyId);
    if (match) return match.id;
    return userCompanyId;
  }
  if (divisions && divisions.length === 1) {
    return divisions[0].id;
  }
  return undefined;
}

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
  const { user, isLoading: authLoading } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", timezone: "" });
  const [addresses, setAddresses] = useState<AddressEntry[]>([emptyAddress()]);
  const [addressCounts, setAddressCounts] = useState<Record<string, LocationAddress[]>>({});
  const [editOriginalAddresses, setEditOriginalAddresses] = useState<LocationAddress[]>([]);

  const { data: locations, isLoading } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: divisions, isLoading: divisionsLoading } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const divisionId = resolveActiveCompanyId(user, divisions);
  const hasCompany = !!divisionId;
  const companyContextLoading = authLoading || divisionsLoading;
  const addDisabled = companyContextLoading || !hasCompany;
  const addDisabledReason = companyContextLoading
    ? "Loading company info…"
    : "Set up your company first in Rules & Controls → General.";

  useEffect(() => {
    if (locations && locations.length > 0) {
      const fetchAddresses = async () => {
        const counts: Record<string, LocationAddress[]> = {};
        for (const loc of locations) {
          try {
            const res = await fetch(`/api/locations/${loc.id}/addresses`, { credentials: "include" });
            if (res.ok) {
              counts[loc.id] = await res.json();
            }
          } catch { /* ignore */ }
        }
        setAddressCounts(counts);
      };
      fetchAddresses();
    }
  }, [locations]);

  const createMutation = useMutation({
    mutationFn: async () => {
      let locationId = editingId;
      if (editingId) {
        await apiRequest("PATCH", `/api/locations/${editingId}`, form);
      } else {
        if (!divisionId) {
          throw new Error(NO_COMPANY_MESSAGE);
        }
        const res = await apiRequest("POST", "/api/locations", {
          ...form,
          companyId: divisionId,
        });
        const created = await res.json();
        locationId = created.id;
      }

      if (editingId) {
        const currentIds = addresses.filter(a => a.id).map(a => a.id);
        for (const existing of editOriginalAddresses) {
          if (!currentIds.includes(existing.id)) {
            await apiRequest("DELETE", `/api/locations/${editingId}/addresses/${existing.id}`);
          }
        }
        for (const addr of addresses) {
          const { id, ...data } = addr;
          if (!data.address && !data.city && !data.state && !data.zip && !data.label) continue;
          if (id) {
            await apiRequest("PATCH", `/api/locations/${editingId}/addresses/${id}`, data);
          } else {
            await apiRequest("POST", `/api/locations/${editingId}/addresses`, data);
          }
        }
      } else if (locationId) {
        for (const addr of addresses) {
          const { id, ...data } = addr;
          if (!data.address && !data.city && !data.state && !data.zip && !data.label) continue;
          await apiRequest("POST", `/api/locations/${locationId}/addresses`, data);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editingId ? "Location updated" : "Location created" });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not save location",
        description: friendlyMutationError(err, GENERIC_LOCATION_INVALID),
        variant: "destructive",
      });
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
      toast({
        title: "Could not delete location",
        description: friendlyMutationError(err, "Couldn't delete location — please try again."),
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setForm({ name: "", code: "", timezone: "" });
    setAddresses([emptyAddress()]);
    setEditOriginalAddresses([]);
    setEditingId(null);
  };

  const startEdit = async (loc: Location) => {
    setForm({
      name: loc.name,
      code: loc.code || "",
      timezone: loc.timezone || "",
    });
    setEditingId(loc.id);

    try {
      const res = await fetch(`/api/locations/${loc.id}/addresses`, { credentials: "include" });
      if (res.ok) {
        const addrs: LocationAddress[] = await res.json();
        setEditOriginalAddresses(addrs);
        if (addrs.length > 0) {
          setAddresses(addrs.map(a => ({
            id: a.id,
            label: a.label || "",
            address: a.address || "",
            city: a.city || "",
            state: a.state || "",
            zip: a.zip || "",
          })));
        } else {
          setAddresses([emptyAddress()]);
        }
      }
    } catch {
      setEditOriginalAddresses([]);
      setAddresses([emptyAddress()]);
    }

    setDialogOpen(true);
  };

  const updateAddress = (index: number, field: keyof AddressEntry, value: string) => {
    setAddresses(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a));
  };

  const addAddress = () => {
    setAddresses(prev => [...prev, emptyAddress()]);
  };

  const removeAddress = (index: number) => {
    setAddresses(prev => prev.length <= 1 ? [emptyAddress()] : prev.filter((_, i) => i !== index));
  };

  const getAddressSummary = (locId: string) => {
    const addrs = addressCounts[locId] || [];
    if (addrs.length === 0) return "—";
    const first = addrs[0];
    const parts = [first.city, first.state].filter(Boolean).join(", ");
    const display = first.label ? `${first.label}: ${parts || first.address || ""}` : (parts || first.address || "—");
    if (addrs.length === 1) return display;
    return `${display} +${addrs.length - 1} more`;
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          if (open && addDisabled) return;
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          {addDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled data-testid="button-add-location">
                    <Plus className="h-4 w-4 mr-1" /> Add Location
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent data-testid="tooltip-add-location-disabled">{addDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <DialogTrigger asChild>
              <Button data-testid="button-add-location"><Plus className="h-4 w-4 mr-1" /> Add Location</Button>
            </DialogTrigger>
          )}
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-location-form">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Location" : "Add Location"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-location-name" /></div>
              <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="input-location-code" /></div>
              <div><Label>Timezone</Label><Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/New_York" data-testid="input-location-timezone" /></div>

              <div className="border-t pt-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Addresses</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addAddress} data-testid="button-add-address">
                    <Plus className="h-3 w-3 mr-1" /> Add Address
                  </Button>
                </div>
                <div className="space-y-3">
                  {addresses.map((addr, idx) => (
                    <div key={idx} className="border rounded-md p-3 relative" data-testid={`address-entry-${idx}`}>
                      {(addresses.length > 1 || addr.id) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => removeAddress(idx)}
                          data-testid={`button-remove-address-${idx}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs">Label</Label>
                          <Input
                            value={addr.label}
                            onChange={(e) => updateAddress(idx, "label", e.target.value)}
                            placeholder="e.g. Main Entrance, Warehouse"
                            className="h-8 text-sm"
                            data-testid={`input-address-label-${idx}`}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Address</Label>
                          <Input
                            value={addr.address}
                            onChange={(e) => updateAddress(idx, "address", e.target.value)}
                            className="h-8 text-sm"
                            data-testid={`input-address-address-${idx}`}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">City</Label>
                            <Input
                              value={addr.city}
                              onChange={(e) => updateAddress(idx, "city", e.target.value)}
                              className="h-8 text-sm"
                              data-testid={`input-address-city-${idx}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">State</Label>
                            <Input
                              value={addr.state}
                              onChange={(e) => updateAddress(idx, "state", e.target.value)}
                              className="h-8 text-sm"
                              data-testid={`input-address-state-${idx}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">ZIP</Label>
                            <Input
                              value={addr.zip}
                              onChange={(e) => updateAddress(idx, "zip", e.target.value)}
                              className="h-8 text-sm"
                              data-testid={`input-address-zip-${idx}`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={
                  !form.name ||
                  createMutation.isPending ||
                  (!editingId && (companyContextLoading || !divisionId))
                }
                data-testid="button-save-location"
              >
                {createMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {companyContextLoading || isLoading ? (
        <Card data-testid="card-locations-list">
          <CardContent className="p-0">
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          </CardContent>
        </Card>
      ) : !hasCompany ? (
        <NoCompanyEmptyState entity="locations" />
      ) : (
      <Card data-testid="card-locations-list">
        <CardContent className="p-0">
          {!locations || locations.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground" data-testid="text-no-locations">No locations configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Code</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Addresses</TableHead>
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
                      {getAddressSummary(loc.id)}
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
      )}
    </div>
  );
}

function DepartmentsTab() {
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", managerIds: [] as string[], locationId: "" });
  const [managersPopoverOpen, setManagersPopoverOpen] = useState(false);

  const { data: departments, isLoading } = useQuery<DepartmentWithManagers[]>({ queryKey: ["/api/departments"] });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: divisions, isLoading: divisionsLoading } = useQuery<Division[]>({ queryKey: ["/api/companies"] });
  const divisionId = resolveActiveCompanyId(user, divisions);
  const hasCompany = !!divisionId;
  const companyContextLoading = authLoading || divisionsLoading;
  const addDisabled = companyContextLoading || !hasCompany;
  const addDisabledReason = companyContextLoading
    ? "Loading company info…"
    : "Set up your company first in Rules & Controls → General.";

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!editingId && !divisionId) {
        throw new Error(NO_COMPANY_MESSAGE);
      }
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
      toast({
        title: "Could not save department",
        description: friendlyMutationError(err, GENERIC_DEPARTMENT_INVALID),
        variant: "destructive",
      });
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
      toast({
        title: "Could not delete department",
        description: friendlyMutationError(err, "Couldn't delete department — please try again."),
        variant: "destructive",
      });
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
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          if (open && addDisabled) return;
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          {addDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled data-testid="button-add-department">
                    <Plus className="h-4 w-4 mr-1" /> Add Department
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent data-testid="tooltip-add-department-disabled">{addDisabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            <DialogTrigger asChild>
              <Button data-testid="button-add-department"><Plus className="h-4 w-4 mr-1" /> Add Department</Button>
            </DialogTrigger>
          )}
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
              <Button
                onClick={() => createMutation.mutate()}
                disabled={
                  !form.name ||
                  createMutation.isPending ||
                  (!editingId && (companyContextLoading || !divisionId))
                }
                data-testid="button-save-department"
              >
                {createMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {companyContextLoading || isLoading ? (
        <Card data-testid="card-departments-list">
          <CardContent className="p-0">
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          </CardContent>
        </Card>
      ) : !hasCompany ? (
        <NoCompanyEmptyState entity="departments" />
      ) : (
      <Card data-testid="card-departments-list">
        <CardContent className="p-0">
          {!departments || departments.length === 0 ? (
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
      )}
    </div>
  );
}
