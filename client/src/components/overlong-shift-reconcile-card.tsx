import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, AlarmClockOff, ChevronRight, ChevronDown } from "lucide-react";

type Item = {
  employeeName: string;
  workDate: string;
  clockIn: string;
  originalClockOut: string;
  originalHours: number;
  cappedHours: number;
};
type Result = {
  applied: boolean;
  thresholdHours: number;
  found: number;
  fixed: number;
  employeesAffected: number;
  items: Item[];
};

const TZ = "America/New_York";
function when(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Admin maintenance: find forgotten punch-outs recorded over the 13-hour limit
 * (and shifts an older tool wrongly capped-and-counted at 13h), and turn each
 * into a MISSING PUNCH (no hours counted) per the attendance rule. Preview
 * first, then Apply.
 */
export function OverlongShiftReconcileCard() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = (apply: boolean) =>
    apiRequest("POST", "/api/attendance/reconcile-overlong-shifts", { apply }).then((r) => r.json());

  const previewMutation = useMutation({
    mutationFn: () => run(false),
    onSuccess: (data: Result) => setResult(data),
    onError: (err: Error) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: () => run(true),
    onSuccess: (data: Result) => {
      setResult(data);
      setConfirmOpen(false);
      toast({
        title: "Forgotten punch-outs fixed",
        description: `${data.fixed} shift${data.fixed === 1 ? "" : "s"} marked as a missing punch (no hours) and flagged for review.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
    },
    onError: (err: Error) => toast({ title: "Fix failed", description: err.message, variant: "destructive" }),
  });

  const count = result?.found ?? 0;

  return (
    <Card data-testid="card-overlong-reconcile">
      <CardHeader className="py-3">
        <button
          type="button"
          className="flex items-center gap-2 text-left w-full"
          onClick={() => setOpen((v) => !v)}
          data-testid="button-overlong-toggle"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <AlarmClockOff className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Fix forgotten punch-outs (over-long shifts)</CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Finds forgotten punch-outs recorded over the <strong>13-hour</strong> limit — almost always a shift
            closed by the next day's clock-in (a ~24h shift) — and shifts an older tool wrongly capped and counted
            at 13h. Each becomes a <strong>missing punch</strong> (<strong>no hours counted</strong>) and is flagged
            for a manager to enter the real clock-out. It never touches shifts under 13h and is safe to run again.
            <strong> Preview first.</strong>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || applyMutation.isPending}
              data-testid="button-overlong-preview"
            >
              {previewMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Preview
            </Button>
            {result && !result.applied && count > 0 && (
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={applyMutation.isPending}
                data-testid="button-overlong-apply"
              >
                Fix {count} shift{count === 1 ? "" : "s"}
              </Button>
            )}
          </div>

          {result && (
            <div className="rounded-md border p-3 space-y-2" data-testid="text-overlong-result">
              {result.applied ? (
                <p className="font-medium text-green-700 dark:text-green-400">
                  Marked {result.fixed} shift{result.fixed === 1 ? "" : "s"} as a missing punch (no hours) and flagged for review.
                </p>
              ) : count === 0 ? (
                <p className="font-medium">No forgotten punch-outs — nothing to fix. 🎉</p>
              ) : (
                <p className="font-medium">
                  {count} forgotten punch-out{count === 1 ? "" : "s"} across {result.employeesAffected} employee
                  {result.employeesAffected === 1 ? "" : "s"} will become missing punches (no hours).
                </p>
              )}
              {result.items.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-56 overflow-y-auto">
                  {result.items.slice(0, 50).map((it, i) => (
                    <li key={i} className="tabular-nums">
                      <span className="font-medium text-foreground">{it.employeeName}</span>{" "}
                      — in {when(it.clockIn)}, recorded out {when(it.originalClockOut)}{" "}
                      ({it.originalHours}h → missing punch, 0h)
                    </li>
                  ))}
                  {result.items.length > 50 && <li>…and {result.items.length - 50} more</li>}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-overlong-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {count} forgotten punch-out{count === 1 ? "" : "s"} as missing punches?</AlertDialogTitle>
            <AlertDialogDescription>
              Each forgotten punch-out becomes a <strong>missing punch</strong> — no hours are counted, a
              placeholder clock-out sits at the {result?.thresholdHours ?? 13}-hour mark, and a review flag is added
              so a manager can enter the real clock-out. Nothing under {result?.thresholdHours ?? 13}h is touched.
              Run it again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-overlong-cancel">Cancel</Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending} data-testid="button-overlong-confirm">
              {applyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Fix shifts
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
