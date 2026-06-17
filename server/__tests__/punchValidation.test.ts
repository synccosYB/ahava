/**
 * Unit coverage for the shared punch-integrity validator (task #450).
 *
 * Exercises the PURE `validatePunchIntegrity` function — one assertion per
 * rejection case the validator is responsible for — plus the accepting cases.
 * No DB / no Express; the route-level integration (recalc-on-edit, locked
 * payroll) is covered separately in punchIntegrityRoute.test.ts.
 *
 * Run with: `npx tsx server/__tests__/punchValidation.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePunchIntegrity,
  type ExistingPunchForValidation,
} from "../punchValidation";

const NONE: ExistingPunchForValidation[] = [];
const NOW = new Date("2026-06-17T23:00:00Z");

test("accepts a normal closed shift", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T09:00:00Z"),
    clockOut: new Date("2026-06-17T17:00:00Z"),
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, true);
});

test("accepts an open (in-progress) punch with no clock-out", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T09:00:00Z"),
    clockOut: undefined,
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, true);
});

test("rejects a missing clock-in", () => {
  const r = validatePunchIntegrity({
    clockIn: null,
    clockOut: new Date("2026-06-17T17:00:00Z"),
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /clock-in time/i);
});

test("rejects an unparseable clock-in", () => {
  const r = validatePunchIntegrity({
    clockIn: "not-a-date",
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /not a valid date/i);
});

test("rejects an unparseable clock-out (when present)", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T09:00:00Z"),
    clockOut: "garbage",
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /clock-out time is not a valid date/i);
});

test("rejects clock-out equal to clock-in (zero duration)", () => {
  const t = new Date("2026-06-17T09:00:00Z");
  const r = validatePunchIntegrity({
    clockIn: t,
    clockOut: new Date(t),
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /must be after clock-in/i);
});

test("rejects clock-out before clock-in (negative duration)", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T17:00:00Z"),
    clockOut: new Date("2026-06-17T09:00:00Z"),
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /must be after clock-in/i);
});

test("rejects a future-dated clock-in by default", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-18T09:00:00Z"),
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /future/i);
});

test("rejects a future-dated clock-out by default", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T09:00:00Z"),
    clockOut: new Date("2026-06-18T17:00:00Z"),
    existingPunches: NONE,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /future/i);
});

test("allows a future-dated punch when allowFuturePunch is true", () => {
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-18T09:00:00Z"),
    clockOut: new Date("2026-06-18T17:00:00Z"),
    existingPunches: NONE,
    now: NOW,
    allowFuturePunch: true,
  });
  assert.equal(r.ok, true);
});

test("rejects a duplicate open shift", () => {
  const existing: ExistingPunchForValidation[] = [
    { id: "p1", clockIn: new Date("2026-06-17T08:00:00Z"), clockOut: null },
  ];
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T09:00:00Z"),
    clockOut: undefined,
    existingPunches: existing,
    now: NOW,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /already has an open shift/i);
});

test("rejects a shift that overlaps another closed shift", () => {
  const existing: ExistingPunchForValidation[] = [
    {
      id: "p1",
      clockIn: new Date("2026-06-17T09:00:00Z"),
      clockOut: new Date("2026-06-17T13:00:00Z"),
    },
  ];
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T12:00:00Z"),
    clockOut: new Date("2026-06-17T15:00:00Z"),
    existingPunches: existing,
    now: new Date("2026-06-17T23:00:00Z"),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /overlaps/i);
});

test("does not flag a punch overlapping itself (punchId excluded)", () => {
  const existing: ExistingPunchForValidation[] = [
    {
      id: "self",
      clockIn: new Date("2026-06-17T09:00:00Z"),
      clockOut: new Date("2026-06-17T13:00:00Z"),
    },
  ];
  const r = validatePunchIntegrity({
    punchId: "self",
    clockIn: new Date("2026-06-17T09:30:00Z"),
    clockOut: new Date("2026-06-17T14:00:00Z"),
    existingPunches: existing,
    now: new Date("2026-06-17T23:00:00Z"),
  });
  assert.equal(r.ok, true);
});

test("accepts back-to-back shifts that only touch at the boundary", () => {
  const existing: ExistingPunchForValidation[] = [
    {
      id: "p1",
      clockIn: new Date("2026-06-17T09:00:00Z"),
      clockOut: new Date("2026-06-17T13:00:00Z"),
    },
  ];
  const r = validatePunchIntegrity({
    clockIn: new Date("2026-06-17T13:00:00Z"),
    clockOut: new Date("2026-06-17T17:00:00Z"),
    existingPunches: existing,
    now: new Date("2026-06-17T23:00:00Z"),
  });
  assert.equal(r.ok, true);
});
