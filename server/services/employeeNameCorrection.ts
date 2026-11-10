import type { PoolClient } from "pg";

export interface NameCorrection {
  id: string;
  employeeNumber: string;
  before: { firstName: string; lastName: string };
  after: { firstName: string; lastName: string };
}

export interface NameCorrectionPlan {
  version: 1;
  companyId: string;
  entries: NameCorrection[];
}

/** Preview only. The operator reviews the saved plan before applying it, since
 * a combined legacy name cannot identify compound surnames reliably.
 */
export async function planNameCorrection(client: PoolClient, companyId: string): Promise<NameCorrectionPlan> {
  const { rows } = await client.query(`
    SELECT u.id, u.first_name, u.last_name, p.employee_number
    FROM users u
    JOIN user_employment_profiles p ON p.user_id = u.id
    WHERE u.company_id = $1
      AND NULLIF(BTRIM(p.employee_number), '') IS NOT NULL
      AND NULLIF(BTRIM(u.first_name), '') IS NOT NULL
      AND NULLIF(BTRIM(u.last_name), '') IS NOT NULL
      AND u.first_name <> u.last_name
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.target_type = 'user' AND a.target_id = u.id
          AND a.action IN ('user.identity_change', 'user.name_order_corrected')
          AND (a.new_value ? 'firstName' OR a.new_value ? 'lastName')
          AND COALESCE(a.new_value->>'firstName', u.first_name) = u.first_name
          AND COALESCE(a.new_value->>'lastName', u.last_name) = u.last_name
      )
    ORDER BY u.first_name, u.last_name, u.id
  `, [companyId]);
  return {
    version: 1,
    companyId,
    entries: rows.map((r) => ({
      id: r.id,
      employeeNumber: r.employee_number,
      before: { firstName: r.first_name, lastName: r.last_name },
      after: { firstName: r.last_name, lastName: r.first_name },
    })),
  };
}

export function validateNameCorrectionPlan(plan: NameCorrectionPlan): void {
  if (plan.version !== 1 || !plan.companyId || !Array.isArray(plan.entries)) throw new Error("Invalid correction plan");
  const ids = new Set<string>();
  for (const e of plan.entries) {
    if (!e.id || !e.employeeNumber || ids.has(e.id)) throw new Error("Missing or duplicate employee in correction plan");
    ids.add(e.id);
    for (const name of [e.before, e.after]) {
      if (!name || typeof name.firstName !== "string" || typeof name.lastName !== "string" || !name.firstName.trim()) {
        throw new Error(`Invalid name for employee ${e.id}`);
      }
    }
  }
}

/** All-or-nothing, company-scoped and protected against stale names/clock IDs.
 * A saved plan can be replayed without swapping anybody back.
 */
export async function applyNameCorrection(client: PoolClient, plan: NameCorrectionPlan): Promise<number> {
  validateNameCorrectionPlan(plan);
  await client.query("BEGIN");
  try {
    let updated = 0;
    // Stable lock order also protects overlapping correction plans.
    for (const e of [...plan.entries].sort((a, b) => a.id.localeCompare(b.id))) {
      const { rows } = await client.query(`
        SELECT u.first_name, u.last_name
        FROM users u JOIN user_employment_profiles p ON p.user_id = u.id
        WHERE u.id = $1 AND u.company_id = $2 AND p.employee_number = $3
        FOR UPDATE OF u, p
      `, [e.id, plan.companyId, e.employeeNumber]);
      const current = rows[0];
      if (!current) throw new Error(`Employee ${e.id} no longer matches the company and clock number; regenerate the plan`);
      const { rows: applied } = await client.query(`
        SELECT 1 FROM audit_logs WHERE target_type = 'user' AND target_id = $1
          AND action = 'user.name_order_corrected' AND old_value = $2::jsonb AND new_value = $3::jsonb
      `, [e.id, JSON.stringify(e.before), JSON.stringify(e.after)]);
      if (applied.length && current.first_name === e.after.firstName && current.last_name === e.after.lastName) continue;
      if (current.first_name !== e.before.firstName || current.last_name !== e.before.lastName) {
        throw new Error(`Employee ${e.id} changed since preview; regenerate the plan`);
      }
      await client.query("UPDATE users SET first_name = $2, last_name = $3, updated_at = NOW() WHERE id = $1", [e.id, e.after.firstName, e.after.lastName]);
      await client.query(`
        INSERT INTO audit_logs (target_type, target_id, action, old_value, new_value, context)
        VALUES ('user', $1, 'user.name_order_corrected', $2::jsonb, $3::jsonb, $4::jsonb)
      `, [e.id, JSON.stringify(e.before), JSON.stringify(e.after), JSON.stringify({ source: "correct-employee-name-order", companyId: plan.companyId })]);
      updated++;
    }
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
