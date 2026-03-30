import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Monitor, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type KioskDevice = {
  id: string;
  name: string;
  locationDescription: string | null;
  departmentId: string | null;
  isActive: boolean;
  lastHeartbeat: string | null;
  createdAt: string;
};

type Department = {
  id: string;
  name: string;
};

export default function KioskManagementPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<KioskDevice | null>(null);
  const [formName, setFormName] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formDeptId, setFormDeptId] = useState("none");
  const [formActive, setFormActive] = useState(true);

  const { data: devices, isLoading } = useQuery<KioskDevice[]>({
    queryKey: ["/api/kiosk-devices"],
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/kiosk-devices", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
      closeDialog();
      toast({ title: "Kiosk device created" });
    },
    onError: () => toast({ title: "Failed to create device", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/kiosk-devices/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
      closeDialog();
      toast({ title: "Kiosk device updated" });
    },
    onError: () => toast({ title: "Failed to update device", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/kiosk-devices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
      toast({ title: "Kiosk device deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/kiosk-devices/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
    },
  });

  function openCreate() {
    setEditingDevice(null);
    setFormName("");
    setFormLocation("");
    setFormDeptId("none");
    setFormActive(true);
    setDialogOpen(true);
  }

  function openEdit(device: KioskDevice) {
    setEditingDevice(device);
    setFormName(device.name);
    setFormLocation(device.locationDescription || "");
    setFormDeptId(device.departmentId || "none");
    setFormActive(device.isActive);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingDevice(null);
  }

  function handleSubmit() {
    const payload: any = {
      name: formName,
      locationDescription: formLocation || null,
      departmentId: formDeptId === "none" ? null : formDeptId,
      isActive: formActive,
    };
    if (editingDevice) {
      updateMutation.mutate({ id: editingDevice.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const deptMap = new Map((departments || []).map(d => [d.id, d.name]));

  return (
    <div className="max-w-6xl space-y-6" data-testid="kiosk-management-page">
      <PageHeader
        title="Kiosk Management"
        subtitle="Manage clock-in kiosk devices"
        actions={
          <Button onClick={openCreate} data-testid="button-create-device">
            <Plus className="h-4 w-4 mr-2" /> Add Device
          </Button>
        }
      />

      <Card data-testid="card-device-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" /> Kiosk Devices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : devices && devices.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Department</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Last Heartbeat</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.id} data-testid={`row-device-${device.id}`}>
                    <TableCell className="font-medium" data-testid={`text-name-${device.id}`}>
                      {device.name}
                    </TableCell>
                    <TableCell data-testid={`text-location-${device.id}`}>
                      {device.locationDescription || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-dept-${device.id}`}>
                      {device.departmentId ? deptMap.get(device.departmentId) || "Unknown" : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={device.isActive}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: device.id, isActive: checked })}
                          data-testid={`switch-active-${device.id}`}
                        />
                        <Badge variant={device.isActive ? "default" : "secondary"} data-testid={`badge-status-${device.id}`}>
                          {device.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-heartbeat-${device.id}`}>
                      {device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(device)} data-testid={`button-edit-${device.id}`}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(device.id)} data-testid={`button-delete-${device.id}`}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-devices">
              No kiosk devices configured. Add one to get started.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-device-form">
          <DialogHeader>
            <DialogTitle>{editingDevice ? "Edit Device" : "Add Device"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Front Lobby Kiosk"
                data-testid="input-device-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Location Description</Label>
              <Input
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                placeholder="e.g. Building A, 1st floor entrance"
                data-testid="input-device-location"
              />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={formDeptId} onValueChange={setFormDeptId}>
                <SelectTrigger data-testid="select-trigger-department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific department</SelectItem>
                  {(departments || []).map(dept => (
                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formActive} onCheckedChange={setFormActive} data-testid="switch-form-active" />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Cancel</Button>
            <Button onClick={handleSubmit} disabled={!formName || isPending} data-testid="button-submit-device">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingDevice ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
