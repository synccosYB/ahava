/**
 * Per-employee geofence exemption on self-service clock-in.
 *   - A NON-exempt employee outside the geofence is BLOCKED (403).
 *   - An EXEMPT employee outside the geofence is allowed through, the punch is
 *     recorded with GPS, and marked clock_in_off_site = true.
 *
 * Run with: `npx tsx server/__tests__/geofenceExempt.test.ts` (needs DATABASE_URL + seed).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { companies, locations, locationAddresses, users, userEmploymentProfiles, userLocationIds, punchLogs } from "@shared/schema";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

// Geofence centre and a point ~111 km away (1° latitude) — safely outside 150 m.
const FENCE = { lat: 40.0, lng: -75.0 };
const FAR = { lat: 41.0, lng: -75.0 };

test("geofence exemption: exempt clocks in off-site (flagged); non-exempt is blocked", async (t) => {
  const stamp = Date.now().toString(36);
  const co = await storage.createCompany({ name: `Geo ${stamp}` });
  const loc = await storage.createLocation({ companyId: co.id, name: `Site ${stamp}` });
  await storage.createLocationAddress({
    locationId: loc.id, label: "HQ", latitude: FENCE.lat, longitude: FENCE.lng,
    geofenceEnabled: true, geofenceRadiusMeters: 150,
  } as any);

  const mkEmp = async (exempt: boolean) => {
    const u = await storage.createUser({ firstName: exempt ? "Exempt" : "Fenced", lastName: stamp, role: "employee", companyId: co.id });
    await storage.setUserLocationIds(u.id, [loc.id]);
    await storage.createEmploymentProfile({ userId: u.id, payType: "hourly", hourlyRate: 15, geofenceExempt: exempt } as any);
    return u;
  };
  const exempt = await mkEmp(true);
  const fenced = await mkEmp(false);

  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const ids = [exempt.id, fenced.id];
    await db.delete(punchLogs).where(inArray(punchLogs.employeeId, ids)).catch(() => {});
    await db.delete(userLocationIds).where(inArray(userLocationIds.userId, ids)).catch(() => {});
    await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, ids)).catch(() => {});
    await db.delete(users).where(inArray(users.id, ids)).catch(() => {});
    await db.delete(locationAddresses).where(eq(locationAddresses.locationId, loc.id)).catch(() => {});
    await db.delete(locations).where(eq(locations.id, loc.id)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, co.id)).catch(() => {});
  });

  const clockIn = (u: { id: string }, token: string) =>
    fetch(`${origin}/api/attendance/clock-in`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "web", latitude: FAR.lat, longitude: FAR.lng }),
    });

  // Non-exempt, outside the fence -> blocked.
  const blocked = await clockIn(fenced, generateToken(fenced));
  assert.equal(blocked.status, 403, "non-exempt off-site clock-in is blocked");
  assert.equal((await blocked.json()).code, "geofence_blocked", "blocked with geofence code");

  // Exempt, outside the fence -> allowed, and flagged off-site with GPS.
  const ok = await clockIn(exempt, generateToken(exempt));
  assert.equal(ok.status, 200, `exempt off-site clock-in allowed (got ${ok.status})`);

  const [punch] = await db.select().from(punchLogs).where(eq(punchLogs.employeeId, exempt.id));
  assert.ok(punch, "exempt employee's punch was recorded");
  assert.equal(punch.clockInOffSite, true, "punch flagged off-site");
  assert.equal(Number(punch.punchLatitude), FAR.lat, "GPS latitude recorded");
  assert.equal(Number(punch.punchLongitude), FAR.lng, "GPS longitude recorded");
});
