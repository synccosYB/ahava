/**
 * Fingerprint-template upload parsing (Phase 2 Harvest). Pure — no DB.
 * Covers both the legacy `FP`/`FINGERTMP` format and the newer `BIODATA` format,
 * and makes sure ordinary lines / non-fingerprint biodata are ignored.
 *
 * Run with: `npx tsx server/__tests__/bioUpload.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBioUpload, buildUserInfoCommand, buildFingerprintUpdateCommand } from "../adms/protocol";

test("parses legacy USER + FP lines", () => {
  const body = [
    "USER PIN=5\tName=Jane Doe\tPri=0\tPasswd=\tCard=0\tGrp=1",
    "FP PIN=5\tFID=6\tSize=1998\tValid=1\tTMP=QUJDREVGHIJK==",
  ].join("\n");
  const r = parseBioUpload(body);
  assert.equal(r.users.length, 1);
  assert.equal(r.users[0].pin, "5");
  assert.equal(r.fingerprints.length, 1);
  const fp = r.fingerprints[0];
  assert.equal(fp.pin, "5");
  assert.equal(fp.fingerIndex, 6);
  assert.equal(fp.size, 1998);
  assert.equal(fp.valid, true);
  assert.equal(fp.template, "QUJDREVGHIJK==");
  assert.equal(fp.format, "FP");
});

test("parses newer BIODATA fingerprint lines (Type=1)", () => {
  const body = "BIODATA Pin=9\tNo=0\tIndex=3\tValid=1\tDuress=0\tType=1\tMajorVer=10\tMinorVer=0\tFormat=0\tTmp=Zm9vYmFy";
  const r = parseBioUpload(body);
  assert.equal(r.fingerprints.length, 1);
  const fp = r.fingerprints[0];
  assert.equal(fp.pin, "9");
  assert.equal(fp.fingerIndex, 3, "prefers Index over No");
  assert.equal(fp.template, "Zm9vYmFy");
  assert.equal(fp.format, "BIODATA");
});

test("ignores non-fingerprint BIODATA (face/palm Type) and junk lines", () => {
  const body = [
    "BIODATA Pin=9\tIndex=0\tType=2\tTmp=ZmFjZQ==", // face → skip
    "OPLOG something unrelated",
    "", // blank
    "FP PIN=\tFID=0\tTMP=", // no pin/template → skip
  ].join("\n");
  const r = parseBioUpload(body);
  assert.equal(r.fingerprints.length, 0);
  assert.equal(r.users.length, 0);
});

test("empty body is safe", () => {
  const r = parseBioUpload("");
  assert.equal(r.users.length, 0);
  assert.equal(r.fingerprints.length, 0);
});

// --- Distribute: command builders ---
test("buildUserInfoCommand emits a DATA UPDATE USERINFO line", () => {
  const cmd = buildUserInfoCommand("123", "Jane Doe");
  assert.match(cmd, /^DATA UPDATE USERINFO /);
  assert.match(cmd, /PIN=123/);
  assert.match(cmd, /Name=Jane Doe/);
});

test("buildFingerprintUpdateCommand: legacy FP carries PIN/FID/TMP", () => {
  const cmd = buildFingerprintUpdateCommand({ pin: "123", fingerIndex: 6, size: 1998, valid: true, template: "QUJD", format: "FP" });
  assert.match(cmd, /^DATA UPDATE FINGERTMP /);
  assert.match(cmd, /PIN=123/);
  assert.match(cmd, /FID=6/);
  assert.match(cmd, /Valid=1/);
  assert.match(cmd, /TMP=QUJD/);
});

test("buildFingerprintUpdateCommand: BIODATA format for newer firmware", () => {
  const cmd = buildFingerprintUpdateCommand({ pin: "9", fingerIndex: 3, size: null, valid: false, template: "Zm9v", format: "BIODATA" });
  assert.match(cmd, /^DATA UPDATE BIODATA /);
  assert.match(cmd, /Pin=9/);
  assert.match(cmd, /Index=3/);
  assert.match(cmd, /Valid=0/);
  assert.match(cmd, /Tmp=Zm9v/);
});
