/**
 * Per-shift segments on the day rollup: a day where the employee clocked out and
 * back in is shown as ONE shift when the gap is a short lunch (<= 60 min, folded
 * into the break) and as TWO shifts (same date) when the gap exceeds 60 min.
 * Display only — the day's totalHours are unchanged either way.
 *
 * Run with: `npx tsx server/__tests__/timesheetSegments.test.ts` (needs DATABASE_URL + seed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, punchLogs } from "@shared/schema";
import { buildEmployeeTimesheet } from "../timesheetService";

const WORK_DATE = "2025-06-16"; // a fixed past Monday, so nothing is "in progress"
const stamp = `seg-${Date.now().toString(36)}`;

async function makeEmployee(suffix: string) {
  const admin = await storage.getUser("admin-dev-001");
  const [emp] = await db.insert(users).values({
    email: `${stamp}-${suffix}@example.invalid`, firstName: "Seg", lastName: `${stamp}${suffix}`,
    role: "employee", companyId: admin?.companyId ?? null,
  }).returning();
  return emp.id;
}
async function cleanup(id: string) {
  await db.delete(punchLogs).where(eq(punchLogs.employeeId, id)).catch(() => {});
  await db.delete(users).where(eq(users.id, id)).catch(() => {});
}
async function addPair(employeeId: string, startH: number, startM: number, endH: number, endM: number) {
  const cin = new Date(`${WORK_DATE}T${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}:00Z`);
  const cout = new Date(`${WORK_DATE}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00Z`);
  const hours = (cout.getTime() - cin.getTime()) / 3_600_000;
  await storage.createPunchLog({
    employeeId, workDate: WORK_DATE, clockIn: cin, clockOut: cout,
    hoursWorked: hours, status: "completed", source: "manager", approved: true,
  });
}
async function dayEntry(employeeId: string) {
  const u = await storage.getUser(employeeId);
  const r = await buildEmployeeTimesheet(u!, WORK_DATE, WORK_DATE);
  return r.entries.find((e) => e.date === WORK_DATE);
}

test("a short lunch (<= 60 min) stays one shift, folded into the break", async (t) => {
  const id = await makeEmployee("short");
  t.after(() => cleanup(id));
  await addPair(id, 9, 0, 12, 0);   // 3h
  await addPair(id, 12, 30, 17, 0); // 30-min lunch, then 4.5h

  const e = await dayEntry(id);
  assert.ok(e, "the day has an entry");
  assert.equal(e!.segments?.length, 1, "one shift (the lunch is folded in)");
  assert.equal(e!.segments?.[0].breakMinutes, 30, "the 30-min lunch is the shift's break");
  // The break carries its out/in times (for the Break Start / Break End columns).
  assert.equal(e!.segments?.[0].breaks?.length, 1, "one folded break interval");
  assert.equal(e!.segments?.[0].breaks?.[0].minutes, 30, "break interval is 30 min");
  assert.equal(e!.segments?.[0].breaks?.[0].start.slice(11, 16), "12:00", "break starts at the noon clock-out");
  assert.equal(e!.segments?.[0].breaks?.[0].end.slice(11, 16), "12:30", "break ends at the 12:30 clock-in");
});

test("a long lunch (> 60 min) splits the day into two shifts, same date", async (t) => {
  const id = await makeEmployee("long");
  t.after(() => cleanup(id));
  await addPair(id, 9, 0, 12, 0);   // 3h
  await addPair(id, 13, 30, 17, 0); // 90-min gap, then 3.5h

  const e = await dayEntry(id);
  assert.ok(e, "the day has an entry");
  assert.equal(e!.segments?.length, 2, "two separate shifts");
  assert.equal(e!.segments?.[0].clockOut?.slice(11, 16), "12:00", "first shift ends at noon");
  assert.equal(e!.segments?.[1].clockIn?.slice(11, 16), "13:30", "second shift starts at 1:30");
  // Display only: the two shifts' hours sum to the day's worked hours (6.5h).
  const sum = (e!.segments ?? []).reduce((s, g) => s + g.hours, 0);
  assert.equal(Math.round(sum * 100) / 100, 6.5, "shift hours sum to the day");
});
