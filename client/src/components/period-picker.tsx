/**
 * One date-range control, shared.
 *
 * The period presets (This week, Current payroll period, Past month, This
 * year, Custom dates…) already lived in `@/lib/timesheet-period`, but the
 * *controls* for choosing one were copied into the Time Sheet Review page and
 * the per-employee Review Time Sheet tab, each with its own private copy of
 * the little pop-up calendar field. My Attendance had neither — just two bare
 * date boxes — so an employee could not ask for "this payroll period" the way
 * a reviewer can.
 *
 * Rather than add a third copy, the pieces live here:
 *
 *   usePeriodRange()  the state: which preset, the custom dates, how many
 *                     periods back the ◀ ▶ stepper has walked, and the
 *                     concrete { start, end } that falls out of all that.
 *                     Remembers the preset per user in the browser.
 *   PeriodPicker      the preset dropdown plus the two custom date fields.
 *   PeriodStepper     ◀ range ▶ · Current, for the presets that step.
 *   PeriodDateField   the pop-up calendar field, on its own if you want it.
 *
 * The two reviewer screens still carry their own copies; they can be moved
 * onto this component whenever they are next touched, which is why nothing
 * here assumes anything about its surroundings.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils";
import {
  currentWeek, currentWorkPeriod, currentPayrollPeriod,
  shiftWeeks, shiftBiweekly, formatRangeLabel, type DateRange,
} from "@/lib/payroll-week";
import {
  type Period, PERIOD_LABELS, PERIOD_KEYS, rangeForPeriod, normalizePeriod,
  ymdLocal, ymdToDate,
} from "@/lib/timesheet-period";

export { PERIOD_LABELS, PERIOD_KEYS, formatRangeLabel };
export type { Period, DateRange };

/**
 * "This week" steps a week at a time and the two bi-weekly pay periods step a
 * whole 14-day period. Everything else is a fixed window ("past month") or
 * hand-picked dates, where stepping would mean nothing.
 */
const NAVIGABLE: Period[] = ["this_week", "work_period", "payroll_period"];

export function isNavigablePeriod(p: Period) {
  return NAVIGABLE.includes(p);
}

// ---------------------------------------------------------------------------
//  The pop-up calendar field
// ---------------------------------------------------------------------------
export function PeriodDateField({ label, value, onChange, testId, size = "sm" }: {
  label: string;
  value: string;
  onChange: (ymd: string) => void;
  testId?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const selected = ymdToDate(value);
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={size}
            className="justify-start font-normal"
            data-testid={testId}
          >
            <CalendarDays className="h-4 w-4 mr-2 opacity-70" />
            {selected ? formatDate(value) : <span className="text-muted-foreground">Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => { if (d) { onChange(ymdLocal(d)); setOpen(false); } }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  The state
// ---------------------------------------------------------------------------
export type PeriodRange = {
  period: Period;
  setPeriod: (p: Period) => void;
  customStart: string;
  setCustomStart: (ymd: string) => void;
  customEnd: string;
  setCustomEnd: (ymd: string) => void;
  /** The range actually being shown, after any ◀ ▶ stepping. */
  range: DateRange;
  navigable: boolean;
  isCurrent: boolean;
  goPrev: () => void;
  goNext: () => void;
  goCurrent: () => void;
};

/**
 * `storageKey` scopes the remembered preset — pass something per screen and
 * per user, e.g. `ahava.myAttendance.period.<userId>`. Reading and writing
 * the browser's store is wrapped: a private window, cleared site data or a
 * blocked store must leave the screen working, just without the memory.
 */
export function usePeriodRange(storageKey: string, fallback: Period = "this_week"): PeriodRange {
  const read = (): Period => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? normalizePeriod(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const [period, setPeriodState] = useState<Period>(read);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  // How many steps back from the current week/period we are. 0 is current.
  const [offset, setOffset] = useState(0);

  // The key carries the user id, so it changes when the signed-in user does.
  useEffect(() => { setPeriodState(read()); setOffset(0); }, [storageKey]);

  const setPeriod = (p: Period) => {
    setPeriodState(p);
    setOffset(0);
    try { localStorage.setItem(storageKey, p); } catch { /* no memory, no matter */ }
  };

  const navigable = NAVIGABLE.includes(period);

  const range = useMemo<DateRange>(() => {
    const base: DateRange =
      period === "this_week" ? currentWeek()
      : period === "work_period" ? currentWorkPeriod()
      : period === "payroll_period" ? currentPayrollPeriod()
      : rangeForPeriod(period, customStart, customEnd);
    if (!navigable || offset === 0) return base;
    return period === "this_week" ? shiftWeeks(base, -offset) : shiftBiweekly(base, -offset);
  }, [period, customStart, customEnd, navigable, offset]);

  return {
    period, setPeriod,
    customStart, setCustomStart,
    customEnd, setCustomEnd,
    range,
    navigable,
    isCurrent: offset === 0,
    goPrev: () => setOffset((o) => o + 1),
    goNext: () => setOffset((o) => Math.max(0, o - 1)),
    goCurrent: () => setOffset(0),
  };
}

// ---------------------------------------------------------------------------
//  The preset dropdown (+ custom dates when "Custom dates…" is chosen)
// ---------------------------------------------------------------------------
export function PeriodPicker({ state, idPrefix = "period", label = "Period", className = "" }: {
  state: PeriodRange;
  idPrefix?: string;
  label?: string | null;
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-2 flex-wrap ${className}`}>
      <div className="space-y-1">
        {label ? <Label className="text-xs text-muted-foreground">{label}</Label> : null}
        <Select value={state.period} onValueChange={(v) => state.setPeriod(v as Period)}>
          <SelectTrigger className="w-[240px]" data-testid={`select-${idPrefix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_KEYS.map((p) => (
              <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {state.period === "custom" && (
        <>
          <PeriodDateField
            label="From"
            value={state.customStart}
            onChange={state.setCustomStart}
            testId={`date-${idPrefix}-from`}
          />
          <PeriodDateField
            label="To"
            value={state.customEnd}
            onChange={state.setCustomEnd}
            testId={`date-${idPrefix}-to`}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  ◀ range ▶ · Current
// ---------------------------------------------------------------------------
export function PeriodStepper({ state, idPrefix = "period" }: {
  state: PeriodRange;
  idPrefix?: string;
}) {
  if (!state.navigable) return null;
  return (
    <div className="flex items-center gap-1" data-testid={`${idPrefix}-nav`}>
      <Button
        variant="outline" size="icon" className="h-8 w-8"
        onClick={state.goPrev}
        data-testid={`button-${idPrefix}-prev`}
        aria-label="Previous period"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span
        className="text-sm font-medium text-center whitespace-nowrap px-1"
        data-testid={`text-${idPrefix}-range`}
      >
        {formatRangeLabel(state.range)}{state.isCurrent ? " · current" : ""}
      </span>
      <Button
        variant="outline" size="icon" className="h-8 w-8"
        onClick={state.goNext}
        disabled={state.isCurrent}
        data-testid={`button-${idPrefix}-next`}
        aria-label="Next period"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!state.isCurrent && (
        <Button
          variant="secondary" size="sm" className="h-8"
          onClick={state.goCurrent}
          data-testid={`button-${idPrefix}-current`}
        >
          <CalendarClock className="h-4 w-4 mr-1" /> Current
        </Button>
      )}
    </div>
  );
}
