/**
 * Regression tests for task #246 — guards the payroll bonus draft auto-advance
 * behavior added in task #244 so a future refactor of `policy-wizard.tsx`
 * cannot re-introduce the "A rule for Sunday already exists" warning when an
 * admin adds the first Day-of-Week or Early-Arrival rule.
 *
 * The wizard's `DayOfWeekBonusEditor` and `EarlyArrivalBonusEditor` both
 * delegate their draft-day picking and conflict detection to the helpers
 * exercised here. Keep the editors using these helpers — that is the contract
 * this suite is enforcing.
 *
 * Run with: `tsx shared/__tests__/policyDraftBonuses.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pickNextDayOfWeekDraftDay,
  dayOfWeekDraftConflict,
  pickNextEarlyArrivalDraftDays,
  earlyArrivalDraftConflict,
} from "../policyOverlap";

type DowBonus = { id: string; dayOfWeek: number };
type EarlyBonus = { id: string; daysOfWeek?: number[] | null };

const dow = (id: string, dayOfWeek: number): DowBonus => ({ id, dayOfWeek });
const early = (id: string, daysOfWeek?: number[] | null): EarlyBonus => ({ id, daysOfWeek });

// ────────────────────────────────────────────────────────────────────────────
// Day-of-Week bonus draft helpers
// ────────────────────────────────────────────────────────────────────────────

test("pickNextDayOfWeekDraftDay: empty rules → Sunday (0)", () => {
  assert.equal(pickNextDayOfWeekDraftDay([]), 0);
});

test("pickNextDayOfWeekDraftDay: after adding Sunday → Monday (1)", () => {
  // The "Sunday rule already exists" bug from task #244 happened because the
  // draft day stayed on Sunday after the first rule was added. The editor now
  // calls this helper to advance the draft; if it returns 0 here, the regression
  // is back.
  assert.equal(pickNextDayOfWeekDraftDay([dow("a", 0)]), 1);
});

test("pickNextDayOfWeekDraftDay: skips covered days and returns first gap", () => {
  // Sun, Mon, Wed taken → next draft should be Tue (2), not Thu.
  assert.equal(
    pickNextDayOfWeekDraftDay([dow("a", 0), dow("b", 1), dow("c", 3)]),
    2,
  );
});

test("pickNextDayOfWeekDraftDay: all 7 days covered → null (signals 'all taken')", () => {
  const all = [0, 1, 2, 3, 4, 5, 6].map((d) => dow(`r${d}`, d));
  assert.equal(pickNextDayOfWeekDraftDay(all), null);
});

test("pickNextDayOfWeekDraftDay: ignores invalid dayOfWeek entries", () => {
  // Out-of-range / non-integer entries must not poison the 'used' set.
  const bonuses = [
    dow("a", -1),
    dow("b", 7),
    { id: "c", dayOfWeek: 1.5 } as DowBonus,
    dow("d", 0),
  ];
  assert.equal(pickNextDayOfWeekDraftDay(bonuses), 1);
});

test("dayOfWeekDraftConflict: empty rules + draft Sunday → no conflict, no message", () => {
  const result = dayOfWeekDraftConflict([], 0);
  assert.equal(result.hasConflict, false);
  assert.equal(result.allDaysTaken, false);
  assert.equal(result.message, null);
});

test("dayOfWeekDraftConflict: draft day collides with existing → human-readable Sunday message", () => {
  const result = dayOfWeekDraftConflict([dow("a", 0)], 0);
  assert.equal(result.hasConflict, true);
  assert.equal(result.allDaysTaken, false);
  assert.equal(
    result.message,
    "A rule for Sunday already exists. Edit or remove it first.",
  );
});

test("dayOfWeekDraftConflict: all days taken → suppresses per-day message, sets allDaysTaken", () => {
  const all = [0, 1, 2, 3, 4, 5, 6].map((d) => dow(`r${d}`, d));
  const result = dayOfWeekDraftConflict(all, 0);
  assert.equal(result.allDaysTaken, true);
  assert.equal(result.hasConflict, false);
  assert.equal(result.message, null);
});

// ────────────────────────────────────────────────────────────────────────────
// Early-Arrival bonus draft helpers
// ────────────────────────────────────────────────────────────────────────────

test("pickNextEarlyArrivalDraftDays: empty rules → [] (apply every day)", () => {
  // No coverage yet → the editor should default to the empty / "all days" toggle
  // rather than pre-selecting a subset.
  assert.deepEqual(pickNextEarlyArrivalDraftDays([]), []);
});

test("pickNextEarlyArrivalDraftDays: after a Sunday rule → only the remaining 6 days", () => {
  // Regression: previously the editor could default the draft toggles to a day
  // already covered (e.g. Sunday), so the user got an instant overlap warning.
  // The helper now returns the days NOT yet covered.
  const result = pickNextEarlyArrivalDraftDays([early("a", [0])]);
  assert.deepEqual(result, [1, 2, 3, 4, 5, 6]);
});

test("pickNextEarlyArrivalDraftDays: existing 'every day' rule → all 7 covered → []", () => {
  // An existing rule with no daysOfWeek means "every day"; nothing is available.
  // We return [] (which the editor surfaces as 'All days already have a rule').
  assert.deepEqual(pickNextEarlyArrivalDraftDays([early("a")]), []);
  assert.deepEqual(pickNextEarlyArrivalDraftDays([early("a", null)]), []);
  assert.deepEqual(pickNextEarlyArrivalDraftDays([early("a", [])]), []);
});

test("pickNextEarlyArrivalDraftDays: multiple partial rules union to remaining days", () => {
  const result = pickNextEarlyArrivalDraftDays([
    early("a", [0, 6]),
    early("b", [3]),
  ]);
  assert.deepEqual(result, [1, 2, 4, 5]);
});

test("earlyArrivalDraftConflict: empty rules + empty draft → no conflict", () => {
  const result = earlyArrivalDraftConflict([], []);
  assert.deepEqual(result.conflictingDays, []);
  assert.equal(result.allDaysTaken, false);
  assert.equal(result.message, null);
});

test("earlyArrivalDraftConflict: draft Sunday vs existing Sunday rule → conflict message", () => {
  const result = earlyArrivalDraftConflict([early("a", [0])], [0]);
  assert.deepEqual(result.conflictingDays, [0]);
  assert.equal(
    result.message,
    "Day(s) overlap with another rule: Sunday. Edit or remove the conflicting rule first.",
  );
});

test("earlyArrivalDraftConflict: draft auto-pruned to available days → no conflict", () => {
  // Mirrors the editor flow: existing Sunday rule, draft auto-fills to [1..6].
  const draft = pickNextEarlyArrivalDraftDays([early("a", [0])]);
  const result = earlyArrivalDraftConflict([early("a", [0])], draft);
  assert.deepEqual(result.conflictingDays, []);
  assert.equal(result.message, null);
});

test("earlyArrivalDraftConflict: all 7 days covered → allDaysTaken=true", () => {
  const result = earlyArrivalDraftConflict([early("a")], []);
  assert.equal(result.allDaysTaken, true);
});

// ────────────────────────────────────────────────────────────────────────────
// Integration scenarios mirroring the wizard's editor flow
// ────────────────────────────────────────────────────────────────────────────

test("Day-of-Week flow: add Sunday rule, draft advances to Monday with no conflict", () => {
  // Step 1: brand-new payroll policy, no rules. Draft starts on Sunday.
  let bonuses: DowBonus[] = [];
  let draftDay = pickNextDayOfWeekDraftDay(bonuses) ?? 0;
  assert.equal(draftDay, 0, "draft starts on Sunday");
  assert.equal(
    dayOfWeekDraftConflict(bonuses, draftDay).hasConflict,
    false,
    "no conflict before adding",
  );

  // Step 2: user clicks Add → a Sunday rule is created and the draft advances.
  bonuses = [...bonuses, dow("rule-sun", draftDay)];
  draftDay = pickNextDayOfWeekDraftDay(bonuses) ?? draftDay;
  assert.equal(draftDay, 1, "draft day advances to Monday after add");

  const post = dayOfWeekDraftConflict(bonuses, draftDay);
  assert.equal(post.hasConflict, false, "Monday draft does not conflict");
  assert.equal(post.message, null, "no 'A rule for Sunday already exists' warning");
});

test("Day-of-Week flow: all 7 days taken disables further additions", () => {
  const bonuses = [0, 1, 2, 3, 4, 5, 6].map((d) => dow(`r${d}`, d));
  assert.equal(pickNextDayOfWeekDraftDay(bonuses), null);
  // The editor's canAdd uses both signals; this combination is what disables
  // the Add button AND surfaces the 'All days already have a rule' hint.
  const conflict = dayOfWeekDraftConflict(bonuses, 0);
  assert.equal(conflict.allDaysTaken, true);
  assert.equal(conflict.hasConflict, false);
});

test("Early-Arrival flow: existing Sunday rule → draft toggles default to remaining days, no conflict", () => {
  const bonuses: EarlyBonus[] = [early("rule-sun", [0])];
  const draftDays = pickNextEarlyArrivalDraftDays(bonuses);
  assert.deepEqual(draftDays, [1, 2, 3, 4, 5, 6], "Sunday is excluded from the draft");
  const conflict = earlyArrivalDraftConflict(bonuses, draftDays);
  assert.deepEqual(conflict.conflictingDays, []);
  assert.equal(conflict.message, null);
  assert.equal(conflict.allDaysTaken, false);
});

test("Early-Arrival flow: rule covering all 7 days marks editor as 'all days taken'", () => {
  const bonuses: EarlyBonus[] = [early("rule-all")];
  assert.deepEqual(pickNextEarlyArrivalDraftDays(bonuses), []);
  assert.equal(earlyArrivalDraftConflict(bonuses, []).allDaysTaken, true);
});
