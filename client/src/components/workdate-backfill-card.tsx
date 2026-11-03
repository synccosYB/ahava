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
import { Loader2, Wrench, ChevronRight, ChevronDown } from "lucide-react";

type Preview = {
  applied: boolean;
  totalPunches: number;
  toFix?: number;
  fixed?: number;
  skippedFinalized: number;
  moves: { move: string; count: number }[];
};

/**
 * Admin maintenance: re-date punches that were filed under the UTC date (an
 * evening Eastern shift that rolled to the next day) onto the correct local
 * day. Preview first (dry run), then Apply with a confirm. Never touches
 * finalized payroll. Idempotent — safe to run again.
 */
export function WorkDateBackfillCard() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = (apply: boolean) =>
    apiRequest("POST", "/api/attendance/backfill-work-dates", { apply }).then((r) => r.json());

  const previewMutation = useMutation({
    mutationFn: () => run(false),
    onSuccess: (data: Preview) => setPreview(data),
    onError: (err: Error) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: () => run(true),
    onSuccess: (data: Preview) => {
      setPreview(data);
      setConfirmOpen(false);
      toast({
        title: "Punch dates fixed",
        description: `${data.fixed ?? 0} punch${(data.fixed ?? 0) === 1 ? "" : "es"} moved to the correct day.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/timesheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/punches"] });
    },
    onError: (err: Error) => toast({ title: "Fix failed", description: err.message, variant: "destructive" }),
  });

  const count = preview?.toFix ?? preview?.fixed ?? 0;

  return (
    <Card data-testid="card-workdate-backfill">
      <CardHeader className="py-3">
        <button
          type="button"
          className="flex items-center gap-2 text-left w-full"
          onClick={() => setOpen((v) => !v)}
          data-testid="button-backfill-toggle"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Fix timezone-shifted punch dates</CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Earlier punches could be filed one day late (an evening shift recorded in UTC rolled to the next
            calendar day). This moves each affected punch to the correct local day. It never changes clock
            times or hours, skips any finalized payroll, and is safe to run more than once.
            <strong> Preview first</strong> to see how many will move.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || applyMutation.isPending}
              data-testid="button-backfill-preview"
            >
              {previewMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Preview
            </Button>
            {preview && !preview.applied && count > 0 && (
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={applyMutation.isPending}
                data-testid="button-backfill-apply"
              >
                Apply fix ({count})
              </Button>
            )}
          </div>

          {preview && (
            <div className="rounded-md border p-3 space-y-2" data-testid="text-backfill-result">
              {preview.applied ? (
                <p className="font-medium text-green-700 dark:text-green-400">
                  Fixed {preview.fixed ?? 0} punch{(preview.fixed ?? 0) === 1 ? "" : "es"}.
                </p>
              ) : count === 0 ? (
                <p className="font-medium">Nothing to fix — all {preview.totalPunches} punches are on the correct day.</p>
              ) : (
                <p className="font-medium">{count} punch{count === 1 ? "" : "es"} will move to the correct day.</p>
              )}
              {preview.skippedFinalized > 0 && (
                <p className="text-xs text-amber-600">
                  {preview.skippedFinalized} skipped because they're in finalized payroll (reopen that batch first to move them).
                </p>
              )}
              {preview.moves.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {preview.moves.slice(0, 12).map((m) => (
                    <li key={m.move} className="tabular-nums">{m.move}: {m.count}</li>
                  ))}
                  {preview.moves.length > 12 && <li>…and {preview.moves.length - 12} more</li>}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-backfill-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Move {count} punch{count === 1 ? "" : "es"} to the correct day?</AlertDialogTitle>
            <AlertDialogDescription>
              This updates each affected punch's work date (not its clock times) and recomputes the day totals.
              Finalized payroll is left untouched. You can run it again later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-backfill-cancel">Cancel</Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending} data-testid="button-backfill-confirm">
              {applyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Apply fix
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
