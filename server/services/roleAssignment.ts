import { storage } from "../storage";
import { writeAuditLog } from "./audit";
import type { RoleAssignmentRule, User, EmploymentProfile } from "@shared/schema";

const ALLOWED_FIELDS = new Set([
  "companyId",
  "locationId",
  "departmentId",
  "employmentType",
  "payType",
  "overtimeEligible",
  "holidayPayEnabled",
]);

const ALLOWED_OPS = new Set(["eq", "neq", "in", "nin", "exists", "not_exists"]);

const ALLOWED_ROLES = new Set(["employee", "manager", "admin"]);

type Leaf = { field: string; op: string; value?: unknown };
type Group = { all?: Condition[]; any?: Condition[] };
type Condition = Leaf | Group;

function isGroup(node: Condition): node is Group {
  return Array.isArray((node as Group).all) || Array.isArray((node as Group).any);
}

function asRecord(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  return node as Record<string, unknown>;
}

export function validateConditions(node: unknown): { ok: true } | { ok: false; error: string } {
  const obj = asRecord(node);
  if (!obj) return { ok: false, error: "Conditions must be an object" };
  if (Array.isArray(obj.all) || Array.isArray(obj.any)) {
    const list = (obj.all ?? obj.any) as unknown[];
    if (!Array.isArray(list) || list.length === 0) {
      return { ok: false, error: "Group must have a non-empty list of conditions" };
    }
    if (list.length > 50) return { ok: false, error: "Too many conditions in group" };
    for (const child of list) {
      const r = validateConditions(child);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (typeof obj.field !== "string" || !ALLOWED_FIELDS.has(obj.field)) {
    return { ok: false, error: `Unknown or disallowed field: ${obj.field}` };
  }
  if (typeof obj.op !== "string" || !ALLOWED_OPS.has(obj.op)) {
    return { ok: false, error: `Unknown operator: ${obj.op}` };
  }
  if (obj.op === "in" || obj.op === "nin") {
    if (!Array.isArray(obj.value)) return { ok: false, error: `${obj.op} requires array value` };
  }
  if (obj.op === "eq" || obj.op === "neq") {
    if (obj.value === undefined) return { ok: false, error: `${obj.op} requires value` };
  }
  return { ok: true };
}

export function isAllowedRole(role: string): boolean {
  return ALLOWED_ROLES.has(role);
}

function getFieldValue(field: string, user: User, profile: EmploymentProfile | undefined): unknown {
  switch (field) {
    case "companyId": return user.companyId;
    case "locationId": return user.locationId;
    case "departmentId": return user.departmentId;
    case "employmentType": return profile?.employmentType ?? null;
    case "payType": return profile?.payType ?? null;
    case "overtimeEligible": return profile?.overtimeEligible ?? null;
    case "holidayPayEnabled": return profile?.holidayPayEnabled ?? null;
    default: return undefined;
  }
}

function evalNode(node: Condition, user: User, profile: EmploymentProfile | undefined): boolean {
  if (isGroup(node)) {
    if (Array.isArray(node.all)) return node.all.every(c => evalNode(c, user, profile));
    if (Array.isArray(node.any)) return node.any.some(c => evalNode(c, user, profile));
    return false;
  }
  const leaf = node;
  const value = getFieldValue(leaf.field, user, profile);
  switch (leaf.op) {
    case "eq": return value === leaf.value;
    case "neq": return value !== leaf.value;
    case "in": return Array.isArray(leaf.value) && (leaf.value as unknown[]).includes(value as never);
    case "nin": return Array.isArray(leaf.value) && !(leaf.value as unknown[]).includes(value as never);
    case "exists": return value !== null && value !== undefined && value !== "";
    case "not_exists": return value === null || value === undefined || value === "";
    default: return false;
  }
}

function tsToMs(ts: Date | string | null | undefined): number {
  if (!ts) return 0;
  return ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
}

export function evaluateRoleForUser(
  user: User,
  profile: EmploymentProfile | undefined,
  rules: RoleAssignmentRule[],
): { rule: RoleAssignmentRule; targetRole: string } | null {
  const sorted = [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return tsToMs(a.createdAt) - tsToMs(b.createdAt);
  });
  for (const rule of sorted) {
    if (!rule.isActive) continue;
    try {
      if (evalNode(rule.conditions as Condition, user, profile)) {
        return { rule, targetRole: rule.targetRole };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// IDs that are protected from automated rule-based role changes. Privileges may
// only be modified for these accounts via explicitly-guarded admin routes.
const PROTECTED_USER_IDS = new Set<string>(["admin-dev-001"]);

export function isProtectedUser(userId: string): boolean {
  return PROTECTED_USER_IDS.has(userId);
}

export async function applyRoleForUser(
  userId: string,
  opts: { actorUserId: string; reason: string; force?: boolean },
): Promise<{ changed: boolean; oldRole?: string; newRole?: string; ruleId?: string; skippedReason?: string }> {
  if (isProtectedUser(userId)) {
    return { changed: false, skippedReason: "protected_user" };
  }

  const user = await storage.getUser(userId);
  if (!user) return { changed: false, skippedReason: "user_not_found" };

  const profile = await storage.getEmploymentProfile(userId);
  const isActive = !profile?.terminationDate || new Date(profile.terminationDate) > new Date();
  if (!isActive) return { changed: false, skippedReason: "inactive_employee" };

  const rules = await storage.getActiveRoleAssignmentRules();
  const match = evaluateRoleForUser(user, profile, rules);

  // Manual admin overrides win until explicitly cleared OR until a matched
  // rule has been updated more recently than the override timestamp
  // (per docs/phase3/architecture.md §15.3). Editing/adding a rule that now
  // matches a manually-overridden user dislodges that stale override.
  // `force: true` (used by clear-override flow) bypasses entirely.
  if (user.roleManuallyOverriddenAt && !opts.force) {
    const overrideAt = new Date(user.roleManuallyOverriddenAt).getTime();
    const ruleUpdatedAt = match?.rule.updatedAt
      ? new Date(match.rule.updatedAt).getTime()
      : 0;
    const ruleSupersedes = match && ruleUpdatedAt > overrideAt;
    if (!ruleSupersedes) {
      return { changed: false, skippedReason: "manual_override_active" };
    }
    // Rule update is newer than the override — clear the override stamp so
    // the new role assignment is treated as rule-driven, not manual.
    await storage.updateUser(userId, { roleManuallyOverriddenAt: null });
  }

  if (!match) return { changed: false, skippedReason: "no_matching_rule" };

  if (user.role === match.targetRole) {
    return { changed: false, skippedReason: "already_assigned" };
  }

  const oldRole = user.role;
  await storage.updateUser(userId, { role: match.targetRole });

  await writeAuditLog({
    actorUserId: opts.actorUserId,
    targetType: "user",
    targetId: userId,
    action: "user.role_change",
    oldValue: { role: oldRole },
    newValue: { role: match.targetRole },
    context: { source: "rule", ruleId: match.rule.id, ruleName: match.rule.name, reason: opts.reason },
  });

  return { changed: true, oldRole, newRole: match.targetRole, ruleId: match.rule.id };
}

export async function reevaluateAllUsers(actorUserId: string, reason: string): Promise<{
  evaluated: number;
  changed: number;
  results: Array<{ userId: string; changed: boolean; oldRole?: string; newRole?: string; ruleId?: string; skippedReason?: string }>;
}> {
  // Protected users (e.g. super-admin) are excluded entirely from automated
  // bulk reevaluation so a misconfigured rule cannot strip their privileges.
  const allUsers = (await storage.getAllUsers()).filter(u => !isProtectedUser(u.id));
  const results: Array<{ userId: string; changed: boolean; oldRole?: string; newRole?: string; ruleId?: string; skippedReason?: string }> = [];
  let changed = 0;
  for (const u of allUsers) {
    const r = await applyRoleForUser(u.id, { actorUserId, reason });
    results.push({ userId: u.id, ...r });
    if (r.changed) changed++;
  }
  return { evaluated: allUsers.length, changed, results };
}
