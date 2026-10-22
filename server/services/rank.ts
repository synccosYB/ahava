// Chain-of-command ranks (Note: roles & permissions epic).
//
// Lower number = higher authority. A person can ACT ON (edit / lock / undo for)
// someone only when they rank strictly ABOVE them. Equal ranks cannot act on
// each other (so one owner can't edit another owner). Unlocking is governed by
// the LOCKER's rank: only someone at that rank or higher can unlock.
//
// This module is READ-ONLY policy used by the NEW lock / unlock / undo
// endpoints. It intentionally does NOT change the existing edit-permission gate
// (requirePermission("users.edit")) on the profile/pay edit routes.

import type { User } from "@shared/schema";
import { storage } from "../storage";
import { resolveUserPermissions } from "../middleware/rbac";

export const RANK = {
  SUPER_ADMIN: 1,
  OWNER: 2,
  LOCATION_MANAGER: 3,
  GLOBAL_DEPT_MANAGER: 4,
  LOCAL_DEPT_MANAGER: 5,
  EMPLOYEE: 6,
} as const;

export const RANK_LABEL: Record<number, string> = {
  1: "Super Admin",
  2: "Owner",
  3: "Location Manager",
  4: "Global Department Manager",
  5: "Local Department Manager",
  6: "Employee",
};

// Resolve a user's rank from their role, super-admin permission, and manager
// hats (manager_scopes). A manager's rank is their HIGHEST hat:
//   location-only hat   → Location Manager
//   department-only hat  → Global Department Manager
//   location+department  → Local Department Manager
export async function getUserRank(user: Pick<User, "id" | "role">): Promise<number> {
  const perms = await resolveUserPermissions(user.id);
  if (perms.has("system.super_admin")) return RANK.SUPER_ADMIN;
  if (user.role === "admin") return RANK.OWNER;
  if (user.role === "manager") {
    const hats = await storage.getManagerScopes(user.id);
    let hasLocationOnly = false;
    let hasDeptOnly = false;
    for (const h of hats) {
      if (h.locationId && !h.departmentId) hasLocationOnly = true;
      else if (!h.locationId && h.departmentId) hasDeptOnly = true;
    }
    if (hasLocationOnly) return RANK.LOCATION_MANAGER;
    if (hasDeptOnly) return RANK.GLOBAL_DEPT_MANAGER;
    // location+department hats, or a manager with no hats yet → lowest manager.
    return RANK.LOCAL_DEPT_MANAGER;
  }
  return RANK.EMPLOYEE;
}

// True when `actorRank` outranks `targetRank` (strictly higher authority).
export function outranks(actorRank: number, targetRank: number): boolean {
  return actorRank < targetRank;
}

// True when a locker of rank `lockedByRank` can be undone by `actorRank`
// (at the locker's rank or higher).
export function canUnlock(actorRank: number, lockedByRank: number): boolean {
  return actorRank <= lockedByRank;
}
