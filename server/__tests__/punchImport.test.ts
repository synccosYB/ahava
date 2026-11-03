/**
 * Punch migration importer: verifies shift rows (Clock #, Clock In, Clock Out)
 * create punch logs matched by employee number, with timezone-correct
 * timestamps, idempotent re-runs, and clear handling of unmatched / incomplete
 * rows.
 *
 * Run with: `npx tsx server/__tests__/punchImport.test.ts` (needs DATABASE_URL).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { importPunchesFromBuffer, COMPANY_NAME } from "../services/punchImport";

const stamp = `pi-${Date.now().toString(36)}`;
const CK = { a: `${stamp}-1`, b: `${stamp}-2`, missing: `${stamp}-x` };

function wbBuffer(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Operational company must exist (importer never creates it).
let company = (await db.select().from(schema.companies).where(eq(schema.companies.name, COMPANY_NAME)))[0];
if (!company) {
  [company] = await db.insert(schema.companies).values({ name: COMPANY_NAME }).returning();
}
const [loc] = await db
  .insert(schema.locations)
  .values({ name: `Sumner ${stamp}`, companyId: company.id, timezone: "America/New_York" })
  .returning();

async function mkEmp(tag: string, clock: string) {
  const [u] = await db
    .insert(schema.users)
    .values({ id: `${stamp}-${tag}`, firstName: tag, lastName: stamp, role: "employee", companyId: company.id })
    .returning();
  await db.insert(schema.employeeLocations).values({ userId: u.id, locationId: loc.id });
  await db.insert(schema.userEmploymentProfiles).values({ userId: u.id, employeeNumber: clock });
  return u;
}
const empA = await mkEmp("a", CK.a);
const empB = await mkEmp("b", CK.b);

async function punchesFor(userId: string) {
  return db.select().from(schema.punchLogs).where(eq(schema.punchLogs.employeeId, userId));
}

test("imports shift rows with timezone-correct timestamps", async () => {
  const buf = wbBuffer([
    { "Clock #": CK.a, "Clock In": "2026-10-29 08:07", "Clock Out": "2026-10-29 16:32" },
    { "Clock #": CK.b, "Clock In": "2026-10-30 09:00", "Clock Out": "2026-10-30 17:00" },
  ]);
  const summary = await importPunchesFromBuffer(buf);
  assert.equal(summary.imported, 2, "two shifts imported");
  assert.equal(summary.employeesTouched, 2);

  const [pa] = await punchesFor(empA.id);
  assert.ok(pa, "punch created for A");
  assert.equal(pa.workDate, "2026-10-29", "work date is the local calendar day");
  // Oct 29 2026 is EDT (UTC-4): 08:07 local => 12:07 UTC.
  assert.equal(new Date(pa.clockIn!).toISOString(), "2026-10-29T12:07:00.000Z");
  assert.equal(new Date(pa.clockOut!).toISOString(), "2026-10-29T20:32:00.000Z");
  assert.ok(Math.abs((pa.hoursWorked ?? 0) - (8 + 25 / 60)) < 0.001, "hours ~8:25");
  assert.equal(pa.source, "manager");
  assert.equal(pa.status, "completed");
});

test("idempotent: re-running the same file adds nothing", async () => {
  const buf = wbBuffer([
    { "Clock #": CK.a, "Clock In": "2026-10-29 08:07", "Clock Out": "2026-10-29 16:32" },
  ]);
  const summary = await importPunchesFromBuffer(buf);
  assert.equal(summary.imported, 0, "no new punches");
  assert.equal(summary.duplicates, 1, "recognized as already present");
  const pas = await punchesFor(empA.id);
  assert.equal(pas.length, 1, "still exactly one punch for that shift");
});

test("a new shift for the same employee is still added on re-run", async () => {
  const buf = wbBuffer([
    { "Clock #": CK.a, "Clock In": "2026-10-29 08:07", "Clock Out": "2026-10-29 16:32" }, // dup
    { "Clock #": CK.a, "Clock In": "2026-10-31 08:00", "Clock Out": "2026-10-31 12:00" }, // new
  ]);
  const summary = await importPunchesFromBuffer(buf);
  assert.equal(summary.imported, 1);
  assert.equal(summary.duplicates, 1);
});

test("unmatched Clock # is reported; an open clock-in is pre-loaded as an open shift", async () => {
  const buf = wbBuffer([
    { "Clock #": CK.missing, "Clock In": "2026-10-29 08:00", "Clock Out": "2026-10-29 12:00" },
    { "Clock #": CK.b, "Clock In": "2026-10-31 09:00", "Clock Out": "" }, // no out -> open
  ]);
  const summary = await importPunchesFromBuffer(buf);
  assert.equal(summary.imported, 0, "no completed shifts");
  assert.equal(summary.openImported, 1, "the open clock-in was pre-loaded");
  assert.ok(summary.unmatchedClockNumbers.includes(CK.missing), "unmatched clock # surfaced");

  // empB now has an OPEN punch (clock-out null) that a later live punch can close.
  const open = (await punchesFor(empB.id)).filter((p) => p.clockIn && !p.clockOut);
  assert.equal(open.length, 1, "exactly one open punch");
  assert.equal(open[0].status, "in-progress");
  assert.equal(new Date(open[0].clockIn!).toISOString(), "2026-10-31T13:00:00.000Z"); // 09:00 EDT
});

test("a second open clock-in for someone already open is left for manual fix", async () => {
  const buf = wbBuffer([
    { "Clock #": CK.b, "Clock In": "2026-10-31 14:00", "Clock Out": "" },
  ]);
  const summary = await importPunchesFromBuffer(buf);
  assert.equal(summary.openImported, 0, "not loaded — only one open punch allowed per employee");
  assert.ok(summary.skipped.some((s) => /already has an open shift/i.test(s.reason)), "flagged for manual fix");
});

test.after(async () => {
  const ids = [empA.id, empB.id];
  await db.delete(schema.punchLogs).where(inArray(schema.punchLogs.employeeId, ids)).catch(() => {});
  await db.delete(schema.userEmploymentProfiles).where(inArray(schema.userEmploymentProfiles.userId, ids)).catch(() => {});
  await db.delete(schema.employeeLocations).where(inArray(schema.employeeLocations.userId, ids)).catch(() => {});
  await db.delete(schema.users).where(inArray(schema.users.id, ids)).catch(() => {});
  await db.delete(schema.locations).where(eq(schema.locations.id, loc.id)).catch(() => {});
});
