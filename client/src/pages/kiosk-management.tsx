import { useEffect, useState } from "react";
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
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INLINE_ADD_NEW_VALUE,
  PermissionedAddNewItem,
  CreateDepartmentDialog,
} from "@/components/inline-entity-create";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Monitor, Loader2, KeyRound, Unlink, Activity } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatTime12InTz } from "@/lib/utils";

type DerivedStatus = "online" | "idle" | "offline" | "unpaired" | "inactive";

type KioskDevice = {
  id: string;
  name: string;
  locationDescription: string | null;
  departmentId: string | null;
  isActive: boolean;
  lastHeartbeat: string | null;
  pairedAt: string | null;
  status: string | null;
  derivedStatus: DerivedStatus;
  createdAt: string;
};

type Department = {
  id: string;
  name: string;
};

type RecentPunch = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "clock_in" | "clock_out";
  timestamp: string;
  workDate: string;
  timezone: string | null;
};

type RecentPunchesResponse = {
  deviceId: string;
  punches: RecentPunch[];
  totals: { clockIns: number; clockOuts: number };
};

const STATUS_META: Record<DerivedStatus, { label: string; className: string }> = {
  online: { label: "Online", className: "bg-emerald-500 hover:bg-emerald-500 text-white" },
  idle: { label: "Idle", className: "bg-amber-500 hover:bg-amber-500 text-white" },
  offline: { label: "Offline", className: "bg-slate-400 hover:bg-slate-400 text-white" },
  unpaired: { label: "Unpaired", className: "bg-blue-500 hover:bg-blue-500 text-white" },
  inactive: { label: "Inactive", className: "bg-slate-300 hover:bg-slate-300 text-slate-700" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

export default function KioskManagementPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<KioskDevice | null>(null);
  const [formName, setFormName] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formDeptId, setFormDeptId] = useState("none");
  const [createDeptOpen, setCreateDeptOpen] = useState(false);
  const [formActive, setFormActive] = useState(true);
  const [pairingFor, setPairingFor] = useState<KioskDevice | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [activityFor, setActivityFor] = useState<KioskDevice | null>(null);

  // Poll devices every 15s so the status badges stay fresh without needing a
  // page reload. The server's derivedStatus is recomputed each request from
  // last_heartbeat, so just refetching the list is enough.
  const { data: devices, isLoading } = useQuery<KioskDevice[]>({
    queryKey: ["/api/kiosk-devices"],
    refetchInterval: 15_000,
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  // Live punch feed for the currently-open activity dialog. WebSocket nudges
  // refetch; otherwise we fall back to a 15s poll while the dialog is open.
  const { data: recentActivity } = useQuery<RecentPunchesResponse>({
    queryKey: ["/api/kiosk-devices", activityFor?.id, "recent-punches"],
    enabled: !!activityFor,
    refetchInterval: activityFor ? 15_000 : false,
  });

  useEffect(() => {
    if (!activityFor) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === "attendance_update" || msg?.type === "kiosk_punch") {
            queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices", activityFor.id, "recent-punches"] });
            queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
          }
        } catch {}
      };
    } catch {}
    return () => { try { ws?.close(); } catch {} };
  }, [activityFor]);

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

  const pairingMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/kiosk-devices/${id}/pairing-code`);
      return res.json();
    },
    onSuccess: (data) => {
      setPairingCode(data.code);
      setPairingExpiresAt(data.expiresAt);
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
    },
    onError: () => toast({ title: "Failed to generate pairing code", variant: "destructive" }),
  });

  const unpairMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/kiosk-devices/${id}/unpair`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kiosk-devices"] });
      toast({ title: "Kiosk unpaired" });
    },
    onError: () => toast({ title: "Failed to unpair", variant: "destructive" }),
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

  function openPairing(device: KioskDevice) {
    setPairingFor(device);
    setPairingCode(null);
    setPairingExpiresAt(null);
    pairingMutation.mutate(device.id);
  }

  function closePairing() {
    setPairingFor(null);
    setPairingCode(null);
    setPairingExpiresAt(null);
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
        subtitle="Pair tablets, monitor live status, and review recent punches"
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
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => {
                  const meta = STATUS_META[device.derivedStatus] || STATUS_META.offline;
                  return (
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
                          <Badge className={meta.className} data-testid={`badge-status-${device.id}`}>
                            {meta.label}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-heartbeat-${device.id}`}>
                        {timeAgo(device.lastHeartbeat)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActivityFor(device)}
                            title="Recent activity"
                            data-testid={`button-activity-${device.id}`}
                          >
                            <Activity className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openPairing(device)}
                            title="Pair tablet"
                            data-testid={`button-pair-${device.id}`}
                          >
                            <KeyRound className="h-3 w-3" />
                          </Button>
                          {device.status === "paired" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => unpairMutation.mutate(device.id)}
                              title="Unpair tablet"
                              data-testid={`button-unpair-${device.id}`}
                            >
                              <Unlink className="h-3 w-3" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(device)} data-testid={`button-edit-${device.id}`}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(device.id)} data-testid={`button-delete-${device.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
              <Select
                value={formDeptId}
                onValueChange={(v) => {
                  if (v === INLINE_ADD_NEW_VALUE) {
                    setCreateDeptOpen(true);
                    return;
                  }
                  setFormDeptId(v);
                }}
              >
                <SelectTrigger data-testid="select-trigger-department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific department</SelectItem>
                  {(departments || []).map(dept => (
                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                  ))}
                  <PermissionedAddNewItem
                    permission="departments.create"
                    label="Add new department"
                    testId="option-kiosk-add-new-department"
                  />
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
        <CreateDepartmentDialog
          open={createDeptOpen}
          onOpenChange={setCreateDeptOpen}
          onCreated={(dept) => {
            setFormDeptId(dept.id);
          }}
        />
      </Dialog>

      <Dialog open={!!pairingFor} onOpenChange={(open) => !open && closePairing()}>
        <DialogContent data-testid="dialog-pairing-code">
          <DialogHeader>
            <DialogTitle>Pair {pairingFor?.name}</DialogTitle>
            <DialogDescription>
              Open <code>/kiosk</code> on the tablet and enter this 6-digit code. The code expires after 10 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 text-center">
            {pairingMutation.isPending || !pairingCode ? (
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
            ) : (
              <>
                <div
                  className="text-5xl font-mono font-bold tracking-widest text-primary"
                  data-testid="text-pairing-code"
                >
                  {pairingCode}
                </div>
                {pairingExpiresAt && (
                  <p className="text-xs text-muted-foreground mt-3" data-testid="text-pairing-expires">
                    Expires {new Date(pairingExpiresAt).toLocaleTimeString()}
                  </p>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => pairingFor && pairingMutation.mutate(pairingFor.id)}
              disabled={pairingMutation.isPending}
              data-testid="button-regenerate-pairing"
            >
              Regenerate
            </Button>
            <Button onClick={closePairing} data-testid="button-close-pairing">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!activityFor} onOpenChange={(open) => !open && setActivityFor(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-recent-activity">
          <DialogHeader>
            <DialogTitle>Recent activity — {activityFor?.name}</DialogTitle>
            <DialogDescription>
              Live punches captured at this kiosk. Updates in real time.
            </DialogDescription>
          </DialogHeader>
          {recentActivity && (
            <div className="text-sm text-muted-foreground mb-3" data-testid="text-activity-totals">
              Today: <span className="font-medium text-foreground">{recentActivity.totals.clockIns}</span> clock-ins
              {" · "}
              <span className="font-medium text-foreground">{recentActivity.totals.clockOuts}</span> clock-outs
            </div>
          )}
          <div className="max-h-96 overflow-y-auto border rounded">
            {!recentActivity ? (
              <div className="p-6 text-center"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
            ) : recentActivity.punches.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground" data-testid="text-no-activity">
                No punches yet at this kiosk.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentActivity.punches.map((p) => (
                    <TableRow key={p.id} data-testid={`row-activity-${p.id}`}>
                      <TableCell className="font-medium">{p.employeeName}</TableCell>
                      <TableCell>
                        <Badge variant={p.type === "clock_in" ? "default" : "secondary"}>
                          {p.type === "clock_in" ? "Clock in" : "Clock out"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-activity-time-${p.id}`}>
                        {formatDate(p.workDate)} · {formatTime12InTz(p.timestamp, p.timezone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setActivityFor(null)} data-testid="button-close-activity">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
