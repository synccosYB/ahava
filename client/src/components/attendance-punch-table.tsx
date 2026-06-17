import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Clock, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { formatHoursMinutes, formatDate, formatTime12 } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

type Punch = {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  hoursWorked: number | null;
  status: string | null;
  source: string | null;
  locationNames: string[];
};

type Option = { id: string; name: string };

type PunchesResponse = {
  punches: Punch[];
  employees: Option[];
  locations: Option[];
};

const ALL = "all";

function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 13);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

// ISO timestamp -> value for <input type="datetime-local"> in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// <input type="datetime-local"> value -> ISO string (or null when empty).
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AttendancePunchTable({ title = "Punch Records" }: { title?: string }) {
  const { has } = usePermissions();
  const { toast } = useToast();
  const canEdit = has("attendance.edit");
  const canDelete = has("attendance.delete");

  const range = defaultRange();
  const [employeeId, setEmployeeId] = useState<string>(ALL);
  const [locationId, setLocationId] = useState<string>(ALL);
  const [startDate, setStartDate] = useState<string>(range.startDate);
  const [endDate, setEndDate] = useState<string>(range.endDate);

  const [editPunch, setEditPunch] = useState<Punch | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editReason, setEditReason] = useState("");

  const [deletePunchTarget, setDeletePunchTarget] = useState<Punch | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (employeeId !== ALL) p.set("employeeId", employeeId);
    if (locationId !== ALL) p.set("locationId", locationId);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    return p.toString();
  }, [employeeId, locationId, startDate, endDate]);

  const { data, isLoading, isError } = useQuery<PunchesResponse>({
    queryKey: ["/api/attendance/punches", employeeId, locationId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/punches?${queryParams}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load punches");
      return res.json();
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
  };

  const editMutation = useMutation({
    mutationFn: async (vars: { id: string; clockIn: string | null; clockOut: string | null; reason: string }) => {
      const res = await apiRequest("PATCH", `/api/attendance/punches/${vars.id}`, {
        clockIn: vars.clockIn,
        clockOut: vars.clockOut,
        reason: vars.reason,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Punch updated" });
      invalidate();
      setEditPunch(null);
    },
    onError: (err: any) => {
      toast({ title: "Could not update punch", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (vars: { id: string; reason: string }) => {
      const res = await apiRequest("DELETE", `/api/attendance/punches/${vars.id}`, { reason: vars.reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Punch deleted" });
      invalidate();
      setDeletePunchTarget(null);
      setDeleteReason("");
    },
    onError: (err: any) => {
      toast({ title: "Could not delete punch", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const openEdit = (p: Punch) => {
    setEditPunch(p);
    setEditClockIn(toLocalInput(p.clockIn));
    setEditClockOut(toLocalInput(p.clockOut));
    setEditReason("");
  };

  const submitEdit = () => {
    if (!editPunch) return;
    editMutation.mutate({
      id: editPunch.id,
      clockIn: fromLocalInput(editClockIn),
      clockOut: fromLocalInput(editClockOut),
      reason: editReason.trim(),
    });
  };

  const submitDelete = () => {
    if (!deletePunchTarget) return;
    deleteMutation.mutate({ id: deletePunchTarget.id, reason: deleteReason.trim() });
  };

  const punches = data?.punches ?? [];
  const showActions = canEdit || canDelete;

  return (
    <Card data-testid="card-punch-table">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-[200px]" data-testid="select-punch-employee">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All employees</SelectItem>
                {(data?.employees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-[180px]" data-testid="select-punch-location">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All locations</SelectItem>
                {(data?.locations ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="punch-start">Start</Label>
            <Input
              id="punch-start"
              type="date"
              className="w-[160px]"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-testid="input-punch-start"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="punch-end">End</Label>
            <Input
              id="punch-end"
              type="date"
              className="w-[160px]"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              data-testid="input-punch-end"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="destructive" className="my-4" data-testid="text-punch-error">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to load punch records.</AlertDescription>
          </Alert>
        ) : punches.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No punches found"
            description="No punch records match the selected filters. Try a different employee, location, or date range."
            testId="text-no-punches"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Clock In</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Clock Out</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Hours</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Location</TableHead>
                {showActions && (
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {punches.map((p) => (
                <TableRow key={p.id} data-testid={`row-punch-${p.id}`}>
                  <TableCell className="font-medium" data-testid={`text-punch-employee-${p.id}`}>
                    {p.employeeName}
                  </TableCell>
                  <TableCell data-testid={`text-punch-date-${p.id}`}>{formatDate(p.workDate) || "—"}</TableCell>
                  <TableCell data-testid={`text-punch-in-${p.id}`}>{formatTime12(p.clockIn) || "—"}</TableCell>
                  <TableCell data-testid={`text-punch-out-${p.id}`}>{formatTime12(p.clockOut) || "—"}</TableCell>
                  <TableCell className="tabular-nums" data-testid={`text-punch-hours-${p.id}`}>
                    {p.hoursWorked != null ? formatHoursMinutes(p.hoursWorked) : "—"}
                  </TableCell>
                  <TableCell data-testid={`text-punch-location-${p.id}`}>
                    {p.locationNames.length > 0 ? p.locationNames.join(", ") : "—"}
                  </TableCell>
                  {showActions && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(p)}
                            data-testid={`button-edit-punch-${p.id}`}
                            aria-label="Edit punch"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => { setDeletePunchTarget(p); setDeleteReason(""); }}
                            data-testid={`button-delete-punch-${p.id}`}
                            aria-label="Delete punch"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!editPunch} onOpenChange={(open) => { if (!open) setEditPunch(null); }}>
        <DialogContent data-testid="dialog-edit-punch">
          <DialogHeader>
            <DialogTitle>Edit Punch</DialogTitle>
            <DialogDescription>
              {editPunch ? `${editPunch.employeeName} — ${formatDate(editPunch.workDate)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="edit-clock-in">Clock In</Label>
              <Input
                id="edit-clock-in"
                type="datetime-local"
                value={editClockIn}
                onChange={(e) => setEditClockIn(e.target.value)}
                data-testid="input-edit-clock-in"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-clock-out">Clock Out</Label>
              <Input
                id="edit-clock-out"
                type="datetime-local"
                value={editClockOut}
                onChange={(e) => setEditClockOut(e.target.value)}
                data-testid="input-edit-clock-out"
              />
              <p className="text-xs text-muted-foreground">Leave clock-out empty to mark the punch as still in progress.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-reason">Reason (optional)</Label>
              <Textarea
                id="edit-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Why is this punch being changed?"
                data-testid="input-edit-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPunch(null)} data-testid="button-cancel-edit-punch">
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={editMutation.isPending} data-testid="button-save-punch">
              {editMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePunchTarget} onOpenChange={(open) => { if (!open) setDeletePunchTarget(null); }}>
        <AlertDialogContent data-testid="dialog-delete-punch">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this punch?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletePunchTarget
                ? `This permanently removes the punch for ${deletePunchTarget.employeeName} on ${formatDate(deletePunchTarget.workDate)}. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="delete-reason">Reason (optional)</Label>
            <Textarea
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Why is this punch being deleted?"
              data-testid="input-delete-reason"
            />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeletePunchTarget(null)} data-testid="button-cancel-delete-punch">
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitDelete} disabled={deleteMutation.isPending} data-testid="button-confirm-delete-punch">
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
