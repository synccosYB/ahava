import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db";
import { applyNameCorrection, planNameCorrection } from "../services/employeeNameCorrection";

test("name correction is scoped, audited, replay-safe and rejects stale previews", async () => {
  const client = await pool.connect();
  try {
    // Session-local tables isolate this suite from the real employee data.
    await client.query(`
      CREATE TEMP TABLE users (id text PRIMARY KEY, company_id text, first_name text, last_name text, updated_at timestamp);
      CREATE TEMP TABLE user_employment_profiles (user_id text, employee_number text);
      CREATE TEMP TABLE audit_logs (target_type text, target_id text, action text, old_value jsonb, new_value jsonb, context jsonb);
      INSERT INTO users VALUES
        ('a', 'ahava', 'ABDOU', 'Nourhan Ussma', NULL),
        ('b', 'ahava', 'Aboody', 'Sarah', NULL),
        ('fixed', 'ahava', 'Miriam', 'ABADI', NULL),
        ('admin', 'ahava', 'Admin', 'User', NULL),
        ('other', 'other-company', 'Family', 'Given', NULL);
      INSERT INTO user_employment_profiles VALUES ('a', '1'), ('b', '2'), ('fixed', '2020'), ('other', '3');
      INSERT INTO audit_logs (target_type, target_id, action, new_value)
        VALUES ('user', 'fixed', 'user.identity_change', '{"firstName":"Miriam","lastName":"ABADI"}');
    `);
    const plan = await planNameCorrection(client, "ahava");
    assert.deepEqual(plan.entries.map((e) => e.id), ["a", "b"]);
    assert.deepEqual(plan.entries[0].after, { firstName: "Nourhan Ussma", lastName: "ABDOU" });

    // Changing even one name after preview must roll back earlier updates too.
    await client.query("UPDATE users SET last_name = 'Changed' WHERE id = 'b'");
    await assert.rejects(applyNameCorrection(client, plan), /changed since preview/);
    assert.equal((await client.query("SELECT first_name FROM users WHERE id = 'a'")).rows[0].first_name, "ABDOU");
    assert.equal((await client.query("SELECT * FROM audit_logs WHERE action = 'user.name_order_corrected'")).rowCount, 0);
    await client.query("UPDATE users SET last_name = 'Sarah' WHERE id = 'b'");

    // Guard the tenant and the clock ID, even if a plan was edited or stale.
    await assert.rejects(applyNameCorrection(client, { ...plan, companyId: "other-company" }), /no longer matches/);
    await assert.rejects(applyNameCorrection(client, { ...plan, entries: [{ ...plan.entries[0], employeeNumber: "wrong" }] }), /no longer matches/);

    assert.equal(await applyNameCorrection(client, plan), 2);
    assert.equal(await applyNameCorrection(client, plan), 0);
    assert.equal((await client.query("SELECT * FROM audit_logs WHERE action = 'user.name_order_corrected'")).rowCount, 2);
    assert.equal((await planNameCorrection(client, "ahava")).entries.length, 0);
    const { rows } = await client.query("SELECT id, first_name, last_name FROM users WHERE id IN ('fixed', 'admin', 'other') ORDER BY id");
    assert.deepEqual(rows, [
      { id: "admin", first_name: "Admin", last_name: "User" },
      { id: "fixed", first_name: "Miriam", last_name: "ABADI" },
      { id: "other", first_name: "Family", last_name: "Given" },
    ]);
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.audit_logs, pg_temp.user_employment_profiles, pg_temp.users");
    client.release();
    await pool.end();
  }
});
