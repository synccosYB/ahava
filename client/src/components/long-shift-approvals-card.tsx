import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Hourglass, ChevronRight, ChevronDown, RefreshCw, Check } from "lucide-react";

type Pending = {
  punchId: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  hoursWorked: number | null;
  clockInLocal: string;
  clockOutLocal: string;
};
type Response = { punches: Pending[]; count: number };

/**
 * Long shifts that closed in the 13–16h approval band (B3). Each is held for a
 * decision: APPROVE keeps it as a real clock-out (hours count), or START NEW
 * SHIFT treats it as a forgotten punch-out (the shift becomes a missing punch
 * and a fresh shift opens at the clock-out time).
 */
export function LongShiftApprovalsCard() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Pending | null>(null);

  const query = useQuery<Response>({
    queryKey: ["/api/attendance/long-shift-approvals"],
    queryFn: () => apiRequest("GET", "/api/attendance/long-shift-approvals").then((r) => r.json()),
    enabled: open,
  });

  const resolveMutation = useMutation({
    mutationFn: (vars: { punchId: string; action: "approve" | "reject" }) =>
      apiRequest("POST", `/api/attendance/punches/${vars.punchId}/resolve-long-shift`, { action: vars.action }).then((r) => r.json()),
    onSuccess: (_d, vars) => {
      setRejectTarget(null);
      toast({
        title: vars.action === "approve" ? "Long shift approved" : "Marked as a missing punch",
        description: vars.action === "approve" ? "Kept as a real clock-out; the hours count." : "A fresh shift was opened at the clock-out time.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/long-shift-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
    },
    onError: (err: Error) => toast({ title: "Couldn't resolve", description: err.message, variant: "destructive" }),
  });

  const punches = query.data?.punches ?? [];

  return (
    <Card data-testid="card-long-shift-approvals">
      <CardHeader className="py-3">
        <button type="button" className="flex items-center gap-2 text-left w-full" onClick={() => setOpen((v) => !v)} data-testid="button-approvals-toggle">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Hourglass className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Long shifts pending approval (13–16h)</CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            A shift that ran between <strong>13 and 16 hours</strong> is held here. <strong>Approve</strong> to keep it as a
            real clock-out (the hours count), or <strong>Start new shift</strong> to treat it as a forgotten punch-out — the
            shift becomes a missing punch and a fresh shift opens at the clock-out time.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching} data-testid="button-approvals-refresh">
              {query.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
            {!query.isLoading && <span className="text-xs text-muted-foreground">{punches.length} awaiting approval</span>}
          </div>

          {query.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : punches.length === 0 ? (
            <p className="font-medium">No long shifts pending approval. 🎉</p>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {punches.map((p) => (
                <li key={p.punchId} className="flex items-center justify-between gap-2 rounded-md border p-2" data-testid={`row-approval-${p.punchId}`}>
                  <div className="min-w-0">
                    <div className="font-medium">{p.employeeName} · {p.hoursWorked != null ? `${Number(p.hoursWorked).toFixed(2)}h` : "—"}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">in {p.clockInLocal} · out {p.clockOutLocal}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" onClick={() => resolveMutation.mutate({ punchId: p.punchId, action: "approve" })} disabled={resolveMutation.isPending} data-testid={`button-approve-${p.punchId}`}>
                      <Check className="h-4 w-4 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRejectTarget(p)} disabled={resolveMutation.isPending} data-testid={`button-reject-${p.punchId}`}>
                      New shift
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}

      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <AlertDialogContent data-testid="dialog-reject-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Treat this as a forgotten punch-out?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget?.employeeName}'s {rejectTarget?.hoursWorked != null ? `${Number(rejectTarget.hoursWorked).toFixed(2)}h ` : ""}
              shift will become a <strong>missing punch</strong> (no hours), and a fresh shift will open at the clock-out
              time ({rejectTarget?.clockOutLocal}). Enter the real clock-out later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} data-testid="button-reject-cancel">Cancel</Button>
            <Button onClick={() => rejectTarget && resolveMutation.mutate({ punchId: rejectTarget.punchId, action: "reject" })} disabled={resolveMutation.isPending} data-testid="button-reject-confirm">
              {resolveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Start new shift
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
