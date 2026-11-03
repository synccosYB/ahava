/**
 * Unit tests for the ADMS/"iclock" wire-format helpers (server/adms/protocol).
 * Pure functions — no DB — so this runs anywhere. The DB-backed ingest flow is
 * exercised by the integration suite in CI.
 *
 * Run with: `tsx server/__tests__/admsProtocol.test.ts`
 */
import assert from "node:assert/strict";

const { parseAttlog, tableKind, serialFromQuery, buildOptionsResponse, ackOk } = await import(
  "../adms/protocol.js"
);

const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// --- parseAttlog ---
test("parses a standard two-punch ATTLOG body", () => {
  const body = "1\t2026-10-20 08:03:11\t0\t1\t0\t0\n2\t2026-10-20 08:05:42\t1\t1\t0\t0";
  const punches = parseAttlog(body);
  assert.equal(punches.length, 2);
  assert.equal(punches[0].deviceUserId, "1");
  assert.equal(punches[0].timeRaw, "2026-10-20 08:03:11");
  assert.equal(punches[0].status, "0");
  assert.equal(punches[0].verify, "1");
  assert.equal(punches[1].deviceUserId, "2");
  assert.equal(punches[1].timeRaw, "2026-10-20 08:05:42");
});

test("tolerates CRLF line endings and trailing blank lines", () => {
  const body = "7\t2026-10-20 09:00:00\t0\t1\r\n\r\n";
  const punches = parseAttlog(body);
  assert.equal(punches.length, 1);
  assert.equal(punches[0].deviceUserId, "7");
});

test("skips a truncated row (user id but no timestamp) and pure garbage", () => {
  // "5\t" = pin present, timestamp missing (truncated); "garbage" = no columns.
  const body = ["5\t", "garbage", "3\t2026-10-20 08:10:00\t0"].join("\n");
  const punches = parseAttlog(body);
  assert.equal(punches.length, 1);
  assert.equal(punches[0].deviceUserId, "3");
});

test("keeps the original line for audit", () => {
  const raw = "4\t2026-10-20 10:00:00\t0\t1";
  const [p] = parseAttlog(raw);
  assert.equal(p.rawLine, raw);
});

test("empty body yields no punches", () => {
  assert.deepEqual(parseAttlog(""), []);
  assert.deepEqual(parseAttlog("   \n  \n"), []);
});

// --- query helpers ---
test("tableKind reads and upper-cases the table param", () => {
  assert.equal(tableKind({ table: "ATTLOG" }), "ATTLOG");
  assert.equal(tableKind({ table: "operlog" }), "OPERLOG");
  assert.equal(tableKind({}), "");
});

test("serialFromQuery extracts SN (any case) or null", () => {
  assert.equal(serialFromQuery({ SN: "ABC123" }), "ABC123");
  assert.equal(serialFromQuery({ sn: "xyz" }), "xyz");
  assert.equal(serialFromQuery({}), null);
  assert.equal(serialFromQuery({ SN: "" }), null);
});

// --- response formatting ---
test("options response names the device and enables realtime push", () => {
  const out = buildOptionsResponse("SN-9000");
  assert.ok(out.includes("GET OPTION FROM: SN-9000"));
  assert.ok(out.includes("Realtime=1"));
});

test("ackOk formats with and without a count", () => {
  assert.equal(ackOk(3), "OK: 3");
  assert.equal(ackOk(0), "OK: 0");
  assert.equal(ackOk(), "OK");
});

// --- runner ---
let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
