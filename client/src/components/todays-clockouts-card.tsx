import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, LogIn, ChevronRight, ChevronDown, RefreshCw } from "lucide-react";

type ClockOutPunch = {
  punchId: string;
  employeeId: string;
  employeeName: string;
  status: string | null;
  source: string | null;
  workDate: string;
  clockInLocal: string | null;
  clockOutLocal: string;
  spansFromPriorDay: boolean;
};
type Response = { punches: ClockOutPunch[]; count: number };

function isManualEntry(source: string | null): boolean {
  return !!source && (source.startsWith("manager") || source === "import");
}

/**
 * Live-rollout triage: every punch recorded as a CLOCK-OUT so far today. After a
 * missing punch, a morning arrival can get recorded as the clock-OUT of a stale/
 * overnight shift instead of a new clock-in. Admin reviews the list and, for the
 * wrong ones, clicks "Make clock-in" to flip it (the prior part becomes a missing
 * punch and a fresh shift opens at that tap). Prior-day-spanning rows are
 * highlighted as the most likely mistakes.
 */
export function TodaysClockOutsCard() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ClockOutPunch | null>(null);

  const query = useQuery<Response>({
    queryKey: ["/api/attendance/clockouts-today"],
    queryFn: () => apiRequest("GET", "/api/attendance/clockouts-today").then((r) => r.json()),
    enabled: open,
  });

  const convertMutation = useMutation({
    mutationFn: (punchId: string) =>
      apiRequest("POST", `/api/attendance/punches/${punchId}/make-clockin`).then((r) => r.json()),
    onSuccess: (_data, punchId) => {
      setConfirmTarget(null);
      toast({ title: "Changed to a clock-in", description: "The punch now opens a new shift; the prior part is a missing punch if its clock-out is unknown." });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/clockouts-today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
      void punchId;
    },
    onError: (err: Error) => toast({ title: "Couldn't convert", description: err.message, variant: "destructive" }),
  });

  const punches = query.data?.punches ?? [];
  const suspicious = punches.filter((p) => p.spansFromPriorDay).length;

  return (
    <Card data-testid="card-todays-clockouts">
      <CardHeader className="py-3">
        <button
          type="button"
          className="flex items-center gap-2 text-left w-full"
          onClick={() => setOpen((v) => !v)}
          data-testid="button-clockouts-toggle"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <LogIn className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Today's punches recorded as clock-outs</CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Every punch recorded as a <strong>clock-out</strong> so far today (from 6am). After a missing punch, a
            morning arrival can get recorded as a clock-out by mistake. Review the list and click
            <strong> Make clock-in</strong> on any that should really be a clock-in — it opens a fresh shift at that
            time and leaves the prior part as a missing punch. <strong>Highlighted</strong> rows (shift started a
            previous day) are the most likely mistakes.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              data-testid="button-clockouts-refresh"
            >
              {query.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
            {!query.isLoading && (
              <span className="text-xs text-muted-foreground">
                {punches.length} clock-out{punches.length === 1 ? "" : "s"} today
                {suspicious > 0 ? ` · ${suspicious} likely need fixing` : ""}
              </span>
            )}
          </div>

          {query.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : punches.length === 0 ? (
            <p className="font-medium">No clock-outs recorded today since 6am. 🎉</p>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {punches.map((p) => (
                <li
                  key={p.punchId}
                  className={`flex items-center justify-between gap-2 rounded-md border p-2 ${p.spansFromPriorDay ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : ""}`}
                  data-testid={`row-clockout-${p.punchId}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{p.employeeName}</span>
                      {p.spansFromPriorDay && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-amber-700 border-amber-400 dark:text-amber-400 dark:border-amber-700">
                          started prior day
                        </Badge>
                      )}
                      {isManualEntry(p.source) && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-muted-foreground">
                          Manual
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      in {p.clockInLocal ?? "—"} · out {p.clockOutLocal}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmTarget(p)}
                    disabled={convertMutation.isPending}
                    data-testid={`button-make-clockin-${p.punchId}`}
                  >
                    <LogIn className="h-4 w-4 mr-1" />
                    Make clock-in
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}

      <AlertDialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <AlertDialogContent data-testid="dialog-clockout-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Change this clock-out to a clock-in?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.employeeName}'s punch at <strong>{confirmTarget?.clockOutLocal}</strong> will become a
              new clock-in (a fresh open shift). {confirmTarget?.clockInLocal
                ? "The earlier part of this shift will be left as a MISSING PUNCH so you can enter its real clock-out."
                : "It will simply open a new shift."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} data-testid="button-clockout-cancel">Cancel</Button>
            <Button
              onClick={() => confirmTarget && convertMutation.mutate(confirmTarget.punchId)}
              disabled={convertMutation.isPending}
              data-testid="button-clockout-confirm"
            >
              {convertMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Make clock-in
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
