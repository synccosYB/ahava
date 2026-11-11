import assert from "node:assert/strict";
import { db, pool } from "../db";
import { users, roles, userRoles, userEmploymentProfiles, policyTypes, policies, policyRules, policyAssignments } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { getEffectivePolicy, loadPolicyResolutionContext } from "../policyEngine";

const stamp = `bulk-policy-${Date.now()}`;
const [user] = await db.insert(users).values({ email: `${stamp}@example.invalid`, firstName: "Bulk", lastName: "Policy" }).returning();
const [role] = await db.insert(roles).values({ name: stamp }).returning();
const [type] = await db.insert(policyTypes).values({ key: stamp, name: stamp }).returning();
const policyIds: string[] = [];
try {
  await db.insert(userRoles).values({ userId: user.id, roleId: role.id });
  await db.insert(userEmploymentProfiles).values({ userId: user.id, employmentType: "full_time", payType: "hourly" });
  const levels = [
    ["global", {}],
    ["role", { roleId: role.id }],
    ["employment_type", { employmentType: "full_time" }],
    ["pay_type", { payType: "hourly" }],
    ["employee", { userId: user.id }],
  ] as const;
  for (const [level, target] of levels) {
    const [policy] = await db.insert(policies).values({ policyTypeId: type.id, name: `${stamp}-${level}`, status: "active" }).returning();
    policyIds.push(policy.id);
    await db.insert(policyRules).values({ policyId: policy.id, rules: { marker: level } });
    await db.insert(policyAssignments).values({ policyId: policy.id, ...target });
  }
  // Remove overrides in precedence order, proving the batch snapshot and the
  // original SQL path choose the same rules, level and policy version.
  for (const [level] of [...levels].reverse()) {
    const context = await loadPolicyResolutionContext([user.id]);
    const single = await getEffectivePolicy(user.companyId, user.id, type.key, user);
    const bulk = await getEffectivePolicy(user.companyId, user.id, type.key, user, context);
    assert.deepEqual(bulk, single);
    assert.equal(bulk?.assignmentLevel, level);
    assert.equal(bulk?.rules.marker, level);
    await db.delete(policyAssignments).where(eq(policyAssignments.policyId, bulk!.policyId));
  }
  const fresh = await loadPolicyResolutionContext([user.id]);
  assert.equal(await getEffectivePolicy(user.companyId, user.id, type.key, user, fresh), null, "fresh calls see removed assignments");
  assert.equal(await getEffectivePolicy(user.companyId, user.id, "unknown-type", user, fresh), null);
  console.log("✓ bulk policy resolution: precedence, rules, versions and fresh snapshots match single reads");
} finally {
  if (policyIds.length) {
    await db.delete(policyAssignments).where(inArray(policyAssignments.policyId, policyIds));
    await db.delete(policyRules).where(inArray(policyRules.policyId, policyIds));
    await db.delete(policies).where(inArray(policies.id, policyIds));
  }
  await db.delete(policyTypes).where(eq(policyTypes.id, type.id));
  await db.delete(userRoles).where(eq(userRoles.userId, user.id));
  await db.delete(userEmploymentProfiles).where(eq(userEmploymentProfiles.userId, user.id));
  await db.delete(roles).where(eq(roles.id, role.id));
  await db.delete(users).where(eq(users.id, user.id));
  await pool.end();
}
