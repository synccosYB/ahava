import { useState } from "react";
import { useTimeClock } from "@/hooks/use-time-clock";
import { Button } from "@/components/ui/button";
import { Clock, Coffee, Square, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact floating Time Clock widget rendered app-wide (except the dashboard,
 * which already shows the full status card). It only surfaces while the employee
 * is ON the clock — a quick-access break / clock-out control with a live timer.
 * Shares ALL state and actions with the dashboard card via `useTimeClock`, so
 * both surfaces stay perfectly in sync. Collapsible to a small pill.
 */
export function TimeClockWidget() {
  const {
    isClockedIn,
    onBreak,
    elapsedLabel,
    breakElapsedLabel,
    canSelfPunch,
    clockOutMutation,
    startBreakMutation,
    endBreakMutation,
  } = useTimeClock();

  const [collapsed, setCollapsed] = useState(false);

  // Only visible while on the clock; clock-in lives on the dashboard.
  if (!isClockedIn) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        data-testid="button-expand-time-clock"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-green-300 bg-card px-4 py-2 shadow-lg transition hover:shadow-xl dark:border-green-800"
      >
        <Clock className="h-4 w-4 text-green-600" />
        <span className="text-sm font-medium tabular-nums" data-testid="text-widget-collapsed-elapsed">
          {onBreak ? breakElapsedLabel : elapsedLabel}
        </span>
        <ChevronUp className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div
      data-testid="widget-time-clock"
      className="fixed bottom-4 right-4 z-40 w-64 rounded-xl border border-green-300 bg-card p-4 shadow-xl dark:border-green-800"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <Clock className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground leading-none">Time Clock</p>
            <p className="text-sm font-semibold leading-tight" data-testid="text-widget-status">
              {onBreak ? "On Break" : "Clocked In"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          data-testid="button-collapse-time-clock"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Collapse time clock"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 space-y-0.5">
        <p className="text-2xl font-semibold tabular-nums" data-testid="text-widget-elapsed">
          {elapsedLabel}
        </p>
        {onBreak && (
          <p className="flex items-center gap-1 text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400" data-testid="text-widget-break-elapsed">
            <Coffee className="h-3 w-3" />
            On break · {breakElapsedLabel}
          </p>
        )}
      </div>

      {!canSelfPunch ? (
        <p className="text-xs text-muted-foreground" data-testid="text-widget-self-punch-disabled">
          Self clock-out isn't enabled for you. Please use a kiosk.
        </p>
      ) : (
        <div className="space-y-2">
          {onBreak ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => endBreakMutation.mutate()}
              disabled={endBreakMutation.isPending}
              data-testid="button-widget-end-break"
              className="w-full border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
            >
              <Coffee className="mr-2 h-4 w-4" />
              {endBreakMutation.isPending ? "Ending..." : "End Break"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => startBreakMutation.mutate()}
              disabled={startBreakMutation.isPending}
              data-testid="button-widget-take-break"
              className="w-full"
            >
              <Coffee className="mr-2 h-4 w-4" />
              {startBreakMutation.isPending ? "Starting..." : "Take Break"}
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => clockOutMutation.mutate()}
            disabled={clockOutMutation.isPending}
            data-testid="button-widget-clock-out"
            className="w-full"
          >
            <Square className="mr-2 h-4 w-4" />
            {clockOutMutation.isPending ? "Clocking Out..." : "Clock Out"}
          </Button>
        </div>
      )}
    </div>
  );
}
