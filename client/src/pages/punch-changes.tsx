import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { Undo2, History, Loader2 } from "lucide-react";
import { formatTime12InTz } from "@/lib/utils";

// The clinics' wall-clock zone — audit before/after store UTC instants.
const TZ = "America/New_York";

type PunchSnapshot = {
  clockIn?: string | null;
  clockOut?: string | null;
  workDate?: string | null;
  hoursWorked?: number | null;
  status?: string | null;
} | null;

type Change = {
  id: string;
  createdAt: string | null;
  employeeId: string | null;
  employeeName: string;
  actorName: string;
  kind: string;
  action: string;
  before: PunchSnapshot;
  after: PunchSnapshot;
  reverted: boolean;
};

type FilterOptions = { employees: { id: string; name: string }[] };

function t(v: string | null | undefined) {
  return v ? formatTime12InTz(v, TZ) : "—";
}
function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// One-line before→after summary of just the fields that changed.
function summarize(c: Change): string {
  const b = c.before ?? {};
  const a = c.after ?? {};
  if (c.kind === "Added") return `In ${t(a.clockIn)}, Out ${t(a.clockOut)} (${a.workDate ?? "—"})`;
  if (c.kind === "Deleted") return `Removed: In ${t(b.clockIn)}, Out ${t(b.clockOut)} (${b.workDate ?? "—"})`;
  const parts: string[] = [];
  if (String(b.clockIn) !== String(a.clockIn)) parts.push(`In ${t(b.clockIn)} → ${t(a.clockIn)}`);
  if (String(b.clockOut) !== String(a.clockOut)) parts.push(`Out ${t(b.clockOut)} → ${t(a.clockOut)}`);
  if ((b.workDate ?? null) !== (a.workDate ?? null)) parts.push(`Day ${b.workDate ?? "—"} → ${a.workDate ?? "—"}`);
  return parts.join(" · ") || "No change";
}

function kindBadge(kind: string) {
  const map: Record<string, string> = {
    Added: "bg-green-600",
    Deleted: "bg-red-600",
    "Moved day": "bg-amber-500 text-white",
    Edited: "bg-blue-600",
  };
  return <Badge className={map[kind] ?? ""}>{kind}</Badge>;
}

export default function PunchChangesPage() {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [confirm, setConfirm] = useState<Change | null>(null);

  const { data: filterOptions } = useQuery<FilterOptions>({ queryKey: ["/api/reports/filter-options"] });
  const employeeOptions = filterOptions?.employees ?? [];

  const { data, isLoading, isError } = useQuery<{ changes: Change[] }>({
    queryKey: ["/api/attendance/punch-changes", employeeId],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "200" });
      if (employeeId !== "all") p.set("employeeId", employeeId);
      const res = await fetch(`/api/attendance/punch-changes?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/audit-logs/${id}/undo`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Change undone", description: "The punch was reverted and totals recomputed." });
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punch-changes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
    },
    onError: (err: Error) => toast({ title: "Could not undo", description: err.message, variant: "destructive" }),
  });

  const changes = useMemo(() => data?.changes ?? [], [data]);

  return (
    <div className="max-w-6xl space-y-6" data-testid="punch-changes-page">
      <PageHeader title="Punch Changes" subtitle="Every punch added, edited, moved or deleted — with one-click undo" />

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-3 flex-wrap mb-4">
            <div className="space-y-1">
              <Label className="text-xs">Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="w-[240px]" data-testid="select-punchchanges-employee">
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {employeeOptions.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : isError ? (
            <p className="text-sm text-destructive">Failed to load punch changes.</p>
          ) : changes.length === 0 ? (
            <EmptyState icon={History} title="No punch changes" description="No punches have been added, edited or deleted in the recorded history." testId="text-punchchanges-empty" />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">When</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Employee</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Change</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">Details</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider">By</TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => (
                    <TableRow key={c.id} data-testid={`row-punchchange-${c.id}`}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtWhen(c.createdAt)}</TableCell>
                      <TableCell className="text-sm font-medium">{c.employeeName}</TableCell>
                      <TableCell>{kindBadge(c.kind)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{summarize(c)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.actorName}</TableCell>
                      <TableCell className="text-right">
                        {c.reverted ? (
                          <Badge variant="outline">Undone</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setConfirm(c)} data-testid={`button-undo-${c.id}`}>
                            <Undo2 className="h-4 w-4 mr-1" /> Undo
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent data-testid="dialog-undo-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this change?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? `This reverts the ${confirm.kind.toLowerCase()} of ${confirm.employeeName}'s punch (${summarize(confirm)}) and recomputes the day totals. Finalized payroll is never touched.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} data-testid="button-undo-cancel">Cancel</Button>
            <Button onClick={() => confirm && undoMutation.mutate(confirm.id)} disabled={undoMutation.isPending} data-testid="button-undo-apply">
              {undoMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Undo change
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
