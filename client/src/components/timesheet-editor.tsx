import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Pencil, Trash2, Plus, AlertCircle, Scissors } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { formatHoursMinutes, formatDate, formatTime12InTz } from "@/lib/utils";

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
  timezone?: string | null;
};

type PunchesResponse = {
  punches: Punch[];
};

// ISO timestamp -> value for <input type="datetime-local"> in the viewer's local
// time. (Ahava admins are in the clinics' Eastern timezone, matching the
// app-wide punch-edit dialogs.)
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

/**
 * Inline punch editor for one employee over a fixed date range (the Review Time
 * Sheet week). Lists the raw punches, lets a manager/admin edit a punch's times,
 * delete a punch, or add a missing punch — all through the same audited
 * /api/attendance/punches endpoints the Punch Records admin table uses. On any
 * change it refreshes both the raw punches and the day-rollup timesheet so the
 * numbers above update immediately.
 */
export function TimesheetEditor({
  employeeId,
  startDate,
  endDate,
}: {
  employeeId: string;
  startDate: string;
  endDate: string;
}) {
  const { has } = usePermissions();
  const { toast } = useToast();
  const canEdit = has("attendance.edit");
  const canDelete = has("attendance.delete");

  const [editPunch, setEditPunch] = useState<Punch | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editWorkDate, setEditWorkDate] = useState("");
  const [editReason, setEditReason] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addClockIn, setAddClockIn] = useState("");
  const [addClockOut, setAddClockOut] = useState("");
  const [addReason, setAddReason] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Punch | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  // Split an overnight / over-long shift: the clock-out is really the start of a
  // new shift (missed punch-out + next clock-in absorbed). We close the first day
  // at the real time and move the second punch to its own shift.
  const [splitPunch, setSplitPunch] = useState<Punch | null>(null);
  const [splitDay1Out, setSplitDay1Out] = useState("");
  const [splitNewIn, setSplitNewIn] = useState("");
  const [splitNewOut, setSplitNewOut] = useState("");
  const [splitReason, setSplitReason] = useState("");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("employeeId", employeeId);
    p.set("startDate", startDate);
    p.set("endDate", endDate);
    return p.toString();
  }, [employeeId, startDate, endDate]);

  const { data, isLoading, isError } = useQuery<PunchesResponse>({
    queryKey: ["/api/attendance/punches", employeeId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/punches?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load punches");
      return res.json();
    },
    enabled: !!employeeId && !!startDate && !!endDate,
  });

  // Refresh the raw punches AND the day-rollup timesheet (which this editor
  // sits beneath) so both reflect the change right away.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
  };

  const editMutation = useMutation({
    mutationFn: async (vars: { id: string; clockIn: string | null; clockOut: string | null; workDate: string; reason: string }) => {
      const res = await apiRequest("PATCH", `/api/attendance/punches/${vars.id}`, {
        clockIn: vars.clockIn,
        clockOut: vars.clockOut,
        workDate: vars.workDate,
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

  const addMutation = useMutation({
    mutationFn: async (vars: { clockIn: string | null; clockOut: string | null; reason: string }) => {
      const res = await apiRequest("POST", `/api/attendance/punches`, {
        employeeId,
        clockIn: vars.clockIn,
        clockOut: vars.clockOut,
        reason: vars.reason,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Punch added" });
      invalidate();
      setAddOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Could not add punch", description: err?.message ?? "Please try again.", variant: "destructive" });
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
      setDeleteTarget(null);
      setDeleteReason("");
    },
    onError: (err: any) => {
      toast({ title: "Could not delete punch", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  // Split = close the first day's shift at its real clock-out, then create the
  // second shift from the punch that was wrongly absorbed as the clock-out. Uses
  // the same audited endpoints; respects the one-open-punch rule because the
  // first shift ends up closed and only the new shift can be left open.
  const splitMutation = useMutation({
    mutationFn: async (vars: { id: string; day1Out: string | null; newIn: string | null; newOut: string | null; reason: string }) => {
      await apiRequest("PATCH", `/api/attendance/punches/${vars.id}`, {
        clockOut: vars.day1Out,
        reason: vars.reason || "Split overnight shift: set the real clock-out for day 1",
      });
      await apiRequest("POST", `/api/attendance/punches`, {
        employeeId,
        clockIn: vars.newIn,
        clockOut: vars.newOut,
        reason: vars.reason || "Split overnight shift: moved the absorbed punch to its own shift",
      });
    },
    onSuccess: () => {
      toast({ title: "Shift split", description: "Day 1 was closed at its real time and the second punch moved to its own shift." });
      invalidate();
      setSplitPunch(null);
    },
    onError: (err: any) => {
      toast({ title: "Could not split shift", description: err?.message ?? "If the new shift is left open, make sure the employee has no other open shift first.", variant: "destructive" });
    },
  });

  const openSplit = (p: Punch) => {
    setSplitPunch(p);
    // Day-1 real clock-out: default to the clock-in's date at 5:00 PM (manager edits it).
    const inLocal = toLocalInput(p.clockIn);
    const inDate = inLocal.split("T")[0];
    setSplitDay1Out(inDate ? `${inDate}T17:00` : "");
    // New shift's clock-in = the punch currently (wrongly) recorded as the clock-out.
    setSplitNewIn(toLocalInput(p.clockOut));
    setSplitNewOut("");
    setSplitReason("");
  };

  const submitSplit = () => {
    if (!splitPunch) return;
    splitMutation.mutate({
      id: splitPunch.id,
      day1Out: fromLocalInput(splitDay1Out),
      newIn: fromLocalInput(splitNewIn),
      newOut: fromLocalInput(splitNewOut),
      reason: splitReason.trim(),
    });
  };

  const openEdit = (p: Punch) => {
    setEditPunch(p);
    setEditClockIn(toLocalInput(p.clockIn));
    // A missing-clock-out punch carries only a placeholder clock-out (the point
    // the clock was stopped). Start the field empty so the manager enters the
    // REAL clock-out rather than editing the placeholder.
    setEditClockOut(p.status === "missing_clockout" ? "" : toLocalInput(p.clockOut));
    setEditWorkDate(p.workDate);
    setEditReason("");
  };

  // YYYY-MM-DD for "yesterday" (the day before today) — managers are almost
  // always entering a missing punch for the prior day.
  const yesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const openAdd = () => {
    // Default the clock-IN to yesterday 9:00 (the usual missing-punch day), and
    // leave the clock-OUT EMPTY so an open/in-only punch is one step (no need to
    // clear a prefilled time). The clock-out date follows the clock-in date below.
    setAddClockIn(`${yesterdayStr()}T09:00`);
    setAddClockOut("");
    setAddReason("");
    setAddOpen(true);
  };

  // Keep the clock-out on the SAME day as the clock-in. When the clock-in date
  // changes and a clock-out is set, move the clock-out onto the clock-in's date
  // (keeping its time). Leaves an empty clock-out empty.
  const onAddClockInChange = (val: string) => {
    setAddClockIn(val);
    if (addClockOut) {
      const inDate = val.split("T")[0];
      const outTime = addClockOut.split("T")[1] || "17:00";
      if (inDate) setAddClockOut(`${inDate}T${outTime}`);
    }
  };

  // When the admin first enters a clock-out (field is empty), seed it to the
  // clock-in's date at 5:00 PM so the date matches by default — they only tweak
  // the time. If the clock-in was cleared (recording a clock-out-only "missing
  // clock-in" punch), fall back to yesterday. Leaving it untouched keeps the
  // shift open / in-only.
  const onAddClockOutFocus = () => {
    if (!addClockOut) {
      const inDate = addClockIn ? addClockIn.split("T")[0] : yesterdayStr();
      if (inDate) setAddClockOut(`${inDate}T17:00`);
    }
  };

  const submitEdit = () => {
    if (!editPunch) return;
    editMutation.mutate({
      id: editPunch.id,
      clockIn: fromLocalInput(editClockIn),
      clockOut: fromLocalInput(editClockOut),
      workDate: editWorkDate,
      reason: editReason.trim(),
    });
  };

  const submitAdd = () => {
    addMutation.mutate({
      clockIn: fromLocalInput(addClockIn),
      clockOut: fromLocalInput(addClockOut),
      reason: addReason.trim(),
    });
  };

  const submitDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason.trim() });
  };

  const punches = data?.punches ?? [];
  const tz = punches[0]?.timezone ?? null;
  const showActions = canEdit || canDelete;

  return (
    <div className="space-y-3 border-t pt-4" data-testid="timesheet-editor">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Edit punches for this week</p>
        {canEdit && (
          <Button size="sm" onClick={openAdd} data-testid="button-add-punch">
            <Plus className="h-4 w-4 mr-1" /> Add punch
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <Alert variant="destructive" data-testid="text-editor-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load punches for editing.</AlertDescription>
        </Alert>
      ) : punches.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-editor-empty">
          No punches recorded this week. Use <span className="font-medium">Add punch</span> to enter a missing one.
        </p>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Clock In</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Clock Out</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Hours</TableHead>
                {showActions && (
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {punches.map((p) => (
                <TableRow key={p.id} data-testid={`row-editor-punch-${p.id}`}>
                  <TableCell className="text-sm font-medium">{formatDate(p.workDate) || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatTime12InTz(p.clockIn, p.timezone) || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {p.status === "missing_clockout" ? (
                      <span className="text-destructive font-medium">Missing</span>
                    ) : p.status === "confirmation" ? (
                      <span className="text-muted-foreground">Present ✓</span>
                    ) : (
                      formatTime12InTz(p.clockOut, p.timezone) || "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{(p.status === "missing_clockout" || p.status === "confirmation") ? "—" : (p.hoursWorked != null ? formatHoursMinutes(p.hoursWorked) : "—")}</TableCell>
                  {showActions && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(p)} aria-label="Edit punch" data-testid={`button-editor-edit-${p.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canEdit && p.clockIn && p.clockOut && p.status !== "missing_clockout" && (
                          <Button size="icon" variant="ghost" onClick={() => openSplit(p)} aria-label="Split shift (clock-out is a new clock-in)" title="Split: the clock-out is really a new clock-in" data-testid={`button-editor-split-${p.id}`}>
                            <Scissors className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="icon" variant="ghost" onClick={() => { setDeleteTarget(p); setDeleteReason(""); }} aria-label="Delete punch" data-testid={`button-editor-delete-${p.id}`}>
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
        </div>
      )}
      {tz && (
        <p className="text-xs text-muted-foreground">
          Times are shown and entered in the location's timezone ({tz}).
        </p>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editPunch} onOpenChange={(open) => { if (!open) setEditPunch(null); }}>
        <DialogContent data-testid="dialog-editor-edit-punch">
          <DialogHeader>
            <DialogTitle>Edit Punch</DialogTitle>
            <DialogDescription>{editPunch ? formatDate(editPunch.workDate) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="editor-edit-workdate">Work date</Label>
              <Input id="editor-edit-workdate" type="date" value={editWorkDate} onChange={(e) => setEditWorkDate(e.target.value)} data-testid="input-editor-edit-workdate" />
              <p className="text-xs text-muted-foreground">The day this shift is counted on. Change it to move a shift that landed on the wrong day (e.g. a late-evening shift that rolled to the next day).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-edit-in">Clock In</Label>
              <Input id="editor-edit-in" type="datetime-local" value={editClockIn} onChange={(e) => setEditClockIn(e.target.value)} data-testid="input-editor-edit-in" />
              <p className="text-xs text-muted-foreground">Leave clock-in empty to keep it a missing punch (clock-out only).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-edit-out">Clock Out</Label>
              <Input id="editor-edit-out" type="datetime-local" value={editClockOut} onChange={(e) => setEditClockOut(e.target.value)} data-testid="input-editor-edit-out" />
              <p className="text-xs text-muted-foreground">Leave clock-out empty to mark the punch as still in progress.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-edit-reason">Reason (optional)</Label>
              <Textarea id="editor-edit-reason" value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Why is this punch being changed?" data-testid="input-editor-edit-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPunch(null)} data-testid="button-editor-cancel-edit">Cancel</Button>
            <Button onClick={submitEdit} disabled={editMutation.isPending} data-testid="button-editor-save-edit">
              {editMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-editor-add-punch">
          <DialogHeader>
            <DialogTitle>Add Punch</DialogTitle>
            <DialogDescription>Enter a clock-in, a clock-out, or both. Leave one empty to record a missing punch on that side.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="editor-add-in">Clock In</Label>
              <Input id="editor-add-in" type="datetime-local" value={addClockIn} onChange={(e) => onAddClockInChange(e.target.value)} data-testid="input-editor-add-in" />
              <p className="text-xs text-muted-foreground">Clear this to record a clock-out only (the clock-in stays a missing punch).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-add-out">Clock Out</Label>
              <Input id="editor-add-out" type="datetime-local" value={addClockOut} onFocus={onAddClockOutFocus} onChange={(e) => setAddClockOut(e.target.value)} data-testid="input-editor-add-out" />
              <p className="text-xs text-muted-foreground">Empty by default — leave it empty to add an open clock-in. If you set it, it starts on the clock-in's date.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-add-reason">Reason (optional)</Label>
              <Textarea id="editor-add-reason" value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="Why is this punch being added?" data-testid="input-editor-add-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-editor-cancel-add">Cancel</Button>
            <Button onClick={submitAdd} disabled={addMutation.isPending || (!addClockIn && !addClockOut)} data-testid="button-editor-save-add">
              {addMutation.isPending ? "Adding…" : "Add punch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Split overnight / over-long shift */}
      <Dialog open={!!splitPunch} onOpenChange={(open) => { if (!open) setSplitPunch(null); }}>
        <DialogContent data-testid="dialog-editor-split-punch">
          <DialogHeader>
            <DialogTitle>Split shift</DialogTitle>
            <DialogDescription>
              Use this when a punch-out was missed and the next clock-in got absorbed into the same shift (an
              overnight / 24-hour shift). Set the real clock-out for the first day; the second punch becomes its
              own shift.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="editor-split-day1out">Real clock-out for the first day</Label>
              <Input id="editor-split-day1out" type="datetime-local" value={splitDay1Out} onChange={(e) => setSplitDay1Out(e.target.value)} data-testid="input-editor-split-day1out" />
              <p className="text-xs text-muted-foreground">Closes the first shift at the time the employee actually left.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-split-newin">New shift — clock-in</Label>
              <Input id="editor-split-newin" type="datetime-local" value={splitNewIn} onChange={(e) => setSplitNewIn(e.target.value)} data-testid="input-editor-split-newin" />
              <p className="text-xs text-muted-foreground">Prefilled from the punch that was wrongly recorded as the clock-out. Change the date/time if needed — it moves to the day it belongs.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-split-newout">New shift — clock-out (optional)</Label>
              <Input id="editor-split-newout" type="datetime-local" value={splitNewOut} onChange={(e) => setSplitNewOut(e.target.value)} data-testid="input-editor-split-newout" />
              <p className="text-xs text-muted-foreground">Leave empty if the new shift is still open (e.g. it's today and they're still working).</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="editor-split-reason">Reason (optional)</Label>
              <Textarea id="editor-split-reason" value={splitReason} onChange={(e) => setSplitReason(e.target.value)} placeholder="Why is this shift being split?" data-testid="input-editor-split-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitPunch(null)} data-testid="button-editor-cancel-split">Cancel</Button>
            <Button onClick={submitSplit} disabled={splitMutation.isPending || !splitDay1Out || !splitNewIn} data-testid="button-editor-save-split">
              {splitMutation.isPending ? "Splitting…" : "Split shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-editor-delete-punch">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this punch?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `This permanently removes the punch on ${formatDate(deleteTarget.workDate)}. This cannot be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="editor-delete-reason">Reason (optional)</Label>
            <Textarea id="editor-delete-reason" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Why is this punch being deleted?" data-testid="input-editor-delete-reason" />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-editor-cancel-delete">Cancel</Button>
            <Button variant="destructive" onClick={submitDelete} disabled={deleteMutation.isPending} data-testid="button-editor-confirm-delete">
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
