import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Fingerprint, Loader2, Activity, Link2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type BiometricDevice = {
  id: string;
  serialNumber: string;
  name: string;
  locationId: string | null;
  companyId: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  firmware: string | null;
  createdAt: string;
};

type BiometricDeviceEvent = {
  id: string;
  deviceId: string;
  deviceUserId: string;
  devicePunchTime: string;
  deviceStatus: string | null;
  userId: string | null;
  punchLogId: string | null;
  direction: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type LocationLite = { id: string; name: string };
type UserLite = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null };

const EVENT_STATUS_META: Record<string, { label: string; className: string }> = {
  processed: { label: "Recorded", className: "bg-emerald-500 hover:bg-emerald-500 text-white" },
  pending_mapping: { label: "Needs employee", className: "bg-amber-500 hover:bg-amber-500 text-white" },
  duplicate: { label: "Duplicate", className: "bg-slate-400 hover:bg-slate-400 text-white" },
  error: { label: "Error", className: "bg-red-500 hover:bg-red-500 text-white" },
  pending: { label: "Pending", className: "bg-slate-300 hover:bg-slate-300 text-slate-700" },
};

function userName(u: UserLite | undefined): string {
  if (!u) return "—";
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return name || u.email || u.id;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

export default function FingerprintClocksPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formSerial, setFormSerial] = useState("");
  const [formLocationId, setFormLocationId] = useState("none");
  const [activityFor, setActivityFor] = useState<BiometricDevice | null>(null);
  // Per unmatched device-user-number, the employee the admin has picked to map.
  const [mapPicks, setMapPicks] = useState<Record<string, string>>({});

  const { data: devices, isLoading } = useQuery<BiometricDevice[]>({
    queryKey: ["/api/biometric-devices"],
    refetchInterval: 15_000,
  });

  const { data: locations } = useQuery<LocationLite[]>({ queryKey: ["/api/locations"] });
  const { data: users } = useQuery<UserLite[]>({ queryKey: ["/api/users"] });

  // Live event feed for the clock whose monitor dialog is open.
  const { data: events } = useQuery<BiometricDeviceEvent[]>({
    queryKey: ["/api/biometric-devices", activityFor?.id, "events"],
    enabled: !!activityFor,
    refetchInterval: activityFor ? 8_000 : false,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/biometric-devices", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometric-devices"] });
      closeDialog();
      toast({ title: "Fingerprint clock added" });
    },
    onError: (err: any) =>
      toast({
        title: err?.payload?.message || "Failed to add clock",
        variant: "destructive",
      }),
  });

  const mapMutation = useMutation({
    mutationFn: ({ id, deviceUserId, userId }: { id: string; deviceUserId: string; userId: string }) =>
      apiRequest("POST", `/api/biometric-devices/${id}/map-user`, { deviceUserId, userId }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometric-devices", vars.id, "events"] });
      setMapPicks((p) => {
        const next = { ...p };
        delete next[vars.deviceUserId];
        return next;
      });
      toast({ title: "Employee linked", description: "Future punches from this finger will attach to them." });
    },
    onError: () => toast({ title: "Failed to link employee", variant: "destructive" }),
  });

  function openCreate() {
    setFormName("");
    setFormSerial("");
    setFormLocationId("none");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  function handleSubmit() {
    createMutation.mutate({
      name: formName.trim(),
      serialNumber: formSerial.trim(),
      locationId: formLocationId === "none" ? null : formLocationId,
    });
  }

  const locationMap = useMemo(
    () => new Map((locations || []).map((l) => [l.id, l.name])),
    [locations],
  );
  const userMap = useMemo(() => new Map((users || []).map((u) => [u.id, u])), [users]);

  // Distinct device user-numbers that have punched but aren't linked to an
  // employee yet — surfaced so an admin can bind them in one place.
  const unmatched = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of events || []) {
      if (e.status === "pending_mapping" && !seen.has(e.deviceUserId)) {
        seen.add(e.deviceUserId);
        out.push(e.deviceUserId);
      }
    }
    return out;
  }, [events]);

  // The connection values an installer types into each clock. Derived from the
  // live host so it's correct for whichever domain Ahava is served on.
  const host = typeof window !== "undefined" ? window.location.host : "your-ahava-domain";
  const isHttps = typeof window !== "undefined" ? window.location.protocol === "https:" : true;

  return (
    <div className="max-w-6xl space-y-6" data-testid="fingerprint-clocks-page">
      <PageHeader
        title="Fingerprint Clocks"
        subtitle="Connect wall-mounted fingerprint clocks that push punches straight to Ahava"
        actions={
          <Button onClick={openCreate} data-testid="button-add-clock">
            <Plus className="h-4 w-4 mr-2" /> Add Clock
          </Button>
        }
      />

      {/* Setup card: the exact values to enter on the clock (Comm → Cloud Server). */}
      <Card data-testid="card-connection-settings">
        <CardHeader>
          <CardTitle className="text-base">Clock connection settings</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground mb-3">
            On each clock, open <strong>Menu → Comm → Cloud Server</strong> and enter:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Setting label="Server Mode" value="ADMS" />
            <Setting label="Enable Domain Name" value="ON" />
            <Setting label="Server Address" value={host} />
            <Setting label="Server Port" value={isHttps ? "443" : "80"} />
            <Setting label="HTTPS" value={isHttps ? "ON" : "OFF"} />
            <Setting label="Enable Proxy Server" value="OFF" />
          </div>
          <p className="text-muted-foreground mt-3">
            Tip: give each employee an <strong>Employee Number</strong> in Ahava that matches the
            number they're enrolled as on the clock — then their punches link automatically.
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-clock-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" /> Clocks
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
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Serial</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider">Last Seen</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => {
                  const connected = device.lastSeenAt
                    ? Date.now() - new Date(device.lastSeenAt).getTime() < 5 * 60_000
                    : false;
                  return (
                    <TableRow key={device.id} data-testid={`row-clock-${device.id}`}>
                      <TableCell className="font-medium" data-testid={`text-name-${device.id}`}>
                        {device.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-serial-${device.id}`}>
                        {device.serialNumber}
                      </TableCell>
                      <TableCell data-testid={`text-location-${device.id}`}>
                        {device.locationId ? locationMap.get(device.locationId) || "Unknown" : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={
                              connected
                                ? "bg-emerald-500 hover:bg-emerald-500 text-white"
                                : "bg-slate-400 hover:bg-slate-400 text-white"
                            }
                            data-testid={`badge-connected-${device.id}`}
                          >
                            {connected ? "Connected" : "Not seen"}
                          </Badge>
                          <span data-testid={`text-lastseen-${device.id}`}>{timeAgo(device.lastSeenAt)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActivityFor(device)}
                            title="Live punches"
                            data-testid={`button-activity-${device.id}`}
                          >
                            <Activity className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-clocks">
              No fingerprint clocks yet. Add one, then point it at Ahava using the settings above.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add-clock dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-clock-form">
          <DialogHeader>
            <DialogTitle>Add Fingerprint Clock</DialogTitle>
            <DialogDescription>
              Register the clock by its hardware serial number so Ahava trusts its punches.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Williamsburg — 2nd floor"
                data-testid="input-clock-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Serial Number</Label>
              <Input
                value={formSerial}
                onChange={(e) => setFormSerial(e.target.value)}
                placeholder="From the clock: Menu → System Info → Device Info"
                data-testid="input-clock-serial"
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={formLocationId} onValueChange={setFormLocationId}>
                <SelectTrigger data-testid="select-trigger-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific location</SelectItem>
                  {(locations || []).map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formName.trim() || !formSerial.trim() || createMutation.isPending}
              data-testid="button-submit-clock"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Clock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Live punches + map-unmatched dialog */}
      <Dialog open={!!activityFor} onOpenChange={(open) => !open && setActivityFor(null)}>
        <DialogContent className="max-w-3xl" data-testid="dialog-clock-activity">
          <DialogHeader>
            <DialogTitle>Live punches — {activityFor?.name}</DialogTitle>
            <DialogDescription>
              Punches arrive here within seconds of a finger press. Updates automatically.
            </DialogDescription>
          </DialogHeader>

          {unmatched.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 mb-3" data-testid="section-unmatched">
              <p className="text-sm font-medium text-amber-900 mb-2 flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Unlinked clock users — pick who they are
              </p>
              <div className="space-y-2">
                {unmatched.map((deviceUserId) => (
                  <div key={deviceUserId} className="flex items-center gap-2" data-testid={`row-unmatched-${deviceUserId}`}>
                    <span className="text-sm font-mono w-24 shrink-0">#{deviceUserId}</span>
                    <Select
                      value={mapPicks[deviceUserId] || ""}
                      onValueChange={(v) => setMapPicks((p) => ({ ...p, [deviceUserId]: v }))}
                    >
                      <SelectTrigger className="flex-1" data-testid={`select-employee-${deviceUserId}`}>
                        <SelectValue placeholder="Choose employee…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(users || []).map((u) => (
                          <SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!mapPicks[deviceUserId] || mapMutation.isPending}
                      onClick={() =>
                        activityFor &&
                        mapMutation.mutate({
                          id: activityFor.id,
                          deviceUserId,
                          userId: mapPicks[deviceUserId],
                        })
                      }
                      data-testid={`button-map-${deviceUserId}`}
                    >
                      Link
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto border rounded">
            {!events ? (
              <div className="p-6 text-center"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
            ) : events.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground" data-testid="text-no-events">
                No punches yet. Press a finger on the clock to test.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Clock user</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => {
                    const meta = EVENT_STATUS_META[e.status] || EVENT_STATUS_META.pending;
                    return (
                      <TableRow key={e.id} data-testid={`row-event-${e.id}`}>
                        <TableCell className="font-medium">
                          {e.userId ? userName(userMap.get(e.userId)) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">#{e.deviceUserId}</TableCell>
                        <TableCell>
                          {e.direction ? (
                            <Badge variant={e.direction === "clock_in" ? "default" : "secondary"}>
                              {e.direction === "clock_in" ? "Clock in" : "Clock out"}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={meta.className}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground" data-testid={`text-event-time-${e.id}`}>
                          {timeAgo(e.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-medium break-all">{value}</div>
    </div>
  );
}
