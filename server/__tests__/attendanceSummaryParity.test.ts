import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { buildEmployeeTimesheet } from "../timesheetService";
import { generateToken } from "../middleware/auth";
import { registerRoutes } from "../routes";
import { attendanceLedger, punchLogs, users, userEmploymentProfiles, type InsertPunchLog, type User } from "@shared/schema";

test("attendance, PTO and HTTP summaries agree on minutes, missing punches and paid breaks", async t => {
  const ids: string[] = [];
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  t.after(async () => {
    if (ids.length) {
      await db.delete(attendanceLedger).where(inArray(attendanceLedger.employeeId, ids));
      await db.delete(punchLogs).where(inArray(punchLogs.employeeId, ids));
      await db.delete(userEmploymentProfiles).where(inArray(userEmploymentProfiles.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  });
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const admin = await storage.getUser("admin-dev-001");
  assert.ok(admin, "seeded admin is required");
  const adminToken = generateToken(admin);
  const year = new Date().getUTCFullYear();
  const day = `${year}-01-06`;
  const at = (time: string) => new Date(`${day}T${time}:00Z`);
  async function employee(label: string, requireLunchBreak = false) {
    const [u] = await db.insert(users).values({id: randomUUID(), firstName:"Summary QA",lastName:label,role:"employee",status:"active"}).returning();
    ids.push(u.id);
    await db.insert(userEmploymentProfiles).values({userId:u.id,payType:"hourly",requireLunchBreak});
    return u;
  }
  async function punch(u: User, start: string|null, end: string|null, hours: number|null, extra: Partial<InsertPunchLog> = {}) {
    return storage.createPunchLog({employeeId:u.id,workDate:day,clockIn:start?at(start):null,clockOut:end?at(end):null,hoursWorked:hours,status:"complete",source:"test",...extra});
  }
  async function totals(u: User, expectedHours: number, expectedDays: number) {
    const timesheet = await buildEmployeeTimesheet(u,day,day);
    assert.equal(timesheet.totals.totalHours,expectedHours,`${u.lastName}: detailed hours`);
    assert.equal(timesheet.totals.daysWorked,expectedDays,`${u.lastName}: worked days`);
    assert.equal(await storage.computeTotalHoursWorked(u.id,year),expectedHours,`${u.lastName}: PTO hours match attendance`);
    // This is also the response My Attendance uses for its summary cards.
    const own = await fetch(`${origin}/api/attendance/timesheet/${u.id}?startDate=${day}&endDate=${day}`,{headers:{Authorization:`Bearer ${generateToken(u)}`}});
    assert.equal(own.status,200);
    assert.deepEqual((await own.json()).totals,timesheet.totals,`${u.lastName}: self-service summary matches reviewer`);
    return timesheet;
  }
  const missing = await employee("missing");
  await punch(missing,"09:00","22:00",0,{status:"missing_clockout"});
  await totals(missing,0,0);
  const missingWithStaleHours = await employee("missing-stale-hours");
  await punch(missingWithStaleHours,"09:00","22:00",13,{status:"missing_clockout"});
  await totals(missingWithStaleHours,0,0);
  const missingIn = await employee("missing-in");
  await punch(missingIn,null,"17:00",8,{status:"missing_clockin"});
  await totals(missingIn,0,0);
  const zero = await employee("verified-zero");
  await punch(zero,"09:00","10:00",0);
  await totals(zero,0,0);
  const paidBreak = await employee("paid-lunch");
  await punch(paidBreak,"09:00","12:00",3);
  await punch(paidBreak,"12:30","17:00",4.5);
  await totals(paidBreak,8,1);
  const lunchRequired = await employee("lunch-required",true);
  await punch(lunchRequired,"09:00","17:00",8);
  await totals(lunchRequired,7.25,1);
  const unpaidBreak = await employee("unpaid-break");
  await punch(unpaidBreak,"09:00","17:00",null,{breakMinutes:30});
  await totals(unpaidBreak,7.5,1);
  const overlong = await employee("overlong-open");
  await punch(overlong,"09:00",null,null,{status:"in-progress"});
  await totals(overlong,0,0);

  for (const [label,hours,end] of [["one-minute",1.02,"10:01"],["overtime-minute",9.02,"18:01"]] as const) {
    const u = await employee(label);
    await punch(u,"09:00",end,hours);
    const ts = await totals(u,hours,1);
    for (const category of ["time","attendance"]) {
      const response = await fetch(`${origin}/api/reports/generate`,{method:"POST",headers:{Authorization:`Bearer ${adminToken}`,"Content-Type":"application/json"},body:JSON.stringify({category,startDate:day,endDate:day,employeeIds:[u.id]})});
      assert.equal(response.status,200);
      const row = (await response.json()).rows.find((r: {id:string})=>r.id===u.id);
      assert.ok(row);
      assert.equal(row.totalHours,ts.totals.totalHours,`${category}: minute precision`);
      assert.equal(row.daysWorked,ts.totals.daysWorked,`${category}: worked days`);
      assert.equal(row.overtime,ts.totals.overtimeHours,`${category}: overtime minute precision`);
    }
  }
});
