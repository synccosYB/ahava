import type { RequestHandler } from "express";
import { db } from "../db";
import {
  users,
  userRoles,
  roles,
  rolePermissions,
  permissions,
  userPermissionOverrides,
  userAccessScopes,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "Company Admin",
  manager: "Department Manager",
  employee: "Employee",
};

export async function resolveUserPermissions(userId: string): Promise<Set<string>> {
  const rolePerms = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  const permSet = new Set(rolePerms.map((r) => r.key));

  if (permSet.size === 0) {
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (user?.role) {
      const mappedRoleName = LEGACY_ROLE_MAP[user.role];
      if (mappedRoleName) {
        const legacyPerms = await db
          .select({ key: permissions.key })
          .from(roles)
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(eq(roles.name, mappedRoleName));
        for (const p of legacyPerms) {
          permSet.add(p.key);
        }
      }
    }
  }

  const overrides = await db
    .select({
      key: permissions.key,
      allowed: userPermissionOverrides.allowed,
    })
    .from(userPermissionOverrides)
    .innerJoin(permissions, eq(permissions.id, userPermissionOverrides.permissionId))
    .where(eq(userPermissionOverrides.userId, userId));

  for (const override of overrides) {
    if (override.allowed) {
      permSet.add(override.key);
    } else {
      permSet.delete(override.key);
    }
  }

  return permSet;
}

export const requirePermission = (key: string): RequestHandler => {
  return async (req, res, next) => {
    const user = (req as any).authUser;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const effectivePerms = await resolveUserPermissions(user.id);
    if (!effectivePerms.has("system.super_admin") && !effectivePerms.has(key)) {
      return res.status(403).json({ message: "Forbidden: missing permission " + key });
    }

    (req as any).userPermissions = effectivePerms;
    next();
  };
};

export type ScopeType = "company" | "location" | "department";

export async function resolveUserScopes(
  userId: string,
  scopeType: ScopeType
): Promise<string[]> {
  const scopes = await db
    .select()
    .from(userAccessScopes)
    .where(
      and(
        eq(userAccessScopes.userId, userId),
        eq(userAccessScopes.scopeType, scopeType)
      )
    );

  const scopeIds: string[] = [];
  for (const scope of scopes) {
    if (scopeType === "company" && scope.companyId) {
      scopeIds.push(scope.companyId);
    } else if (scopeType === "location" && scope.locationId) {
      scopeIds.push(scope.locationId);
    } else if (scopeType === "department" && scope.departmentId) {
      scopeIds.push(scope.departmentId);
    }
  }
  return scopeIds;
}

export const requireScopedAccess = (
  module: string,
  scopeResolver: (req: any) => { scopeType: ScopeType; scopeId: string }
): RequestHandler => {
  return async (req, res, next) => {
    const user = (req as any).authUser;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const effectivePerms =
      (req as any).userPermissions || (await resolveUserPermissions(user.id));

    if (effectivePerms.has("system.super_admin")) {
      return next();
    }

    const { scopeType, scopeId } = scopeResolver(req);
    const allowedScopes = await resolveUserScopes(user.id, scopeType);

    if (allowedScopes.length > 0 && allowedScopes.includes(scopeId)) {
      return next();
    }

    return res
      .status(403)
      .json({ message: `Forbidden: no ${scopeType} access for ${module}` });
  };
};
