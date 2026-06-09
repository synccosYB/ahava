import { db } from "./db";
import {
  users,
  permissions,
  roles,
  rolePermissions,
  policyTypes,
  policies,
  policyRules,
  userRoles,
  biometricSettings,
  biometricLegalProfiles,
  ptoPolicies,
  employeePtoSettings,
} from "@shared/schema";
import { isNull } from "drizzle-orm";
import { getDefaultRulesForType } from "./policyEngine";
import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const PERMISSION_KEYS = [
  { key: "system.super_admin", name: "Super Admin", description: "Full system access", module: "system" },
  { key: "company.manage", name: "Manage Company", description: "Manage company settings", module: "company" },
  { key: "company.view", name: "View Company", description: "View company information", module: "company" },
  { key: "company.create", name: "Create Company", description: "Create a new company", module: "company" },
  { key: "company.edit", name: "Edit Company", description: "Edit company details", module: "company" },
  { key: "company.delete", name: "Delete Company", description: "Delete a company", module: "company" },
  { key: "users.create", name: "Create Users", description: "Create users", module: "users" },
  { key: "users.view", name: "View Users", description: "View users", module: "users" },
  { key: "users.edit", name: "Edit Users", description: "Edit user details", module: "users" },
  { key: "users.deactivate", name: "Deactivate Users", description: "Deactivate users", module: "users" },
  { key: "users.delete", name: "Delete Users", description: "Permanently delete user accounts (cleanup of test/duplicate accounts)", module: "users" },
  { key: "roles.manage", name: "Manage Roles", description: "Manage roles and permissions", module: "roles" },
  { key: "departments.create", name: "Create Departments", description: "Create departments", module: "departments" },
  { key: "departments.view", name: "View Departments", description: "View departments", module: "departments" },
  { key: "departments.edit", name: "Edit Departments", description: "Edit departments", module: "departments" },
  { key: "departments.delete", name: "Delete Departments", description: "Delete departments", module: "departments" },
  { key: "attendance.view_self", name: "View Own Attendance", description: "View own attendance", module: "attendance" },
  { key: "attendance.view_team", name: "View Team Attendance", description: "View team attendance", module: "attendance" },
  { key: "attendance.view_all", name: "View All Attendance", description: "View all attendance", module: "attendance" },
  { key: "attendance.clock", name: "Clock In/Out", description: "Clock in/out", module: "attendance" },
  { key: "attendance.edit", name: "Edit Attendance", description: "Edit attendance records", module: "attendance" },
  { key: "attendance.manage_rules", name: "Manage Attendance Rules", description: "Manage attendance rules and policies", module: "attendance" },
  { key: "attendance.approve_corrections", name: "Approve Corrections", description: "Approve attendance corrections", module: "attendance" },
  { key: "pto.request", name: "Request PTO", description: "Submit PTO/time-off requests", module: "pto" },
  { key: "pto.view_self", name: "View Own PTO", description: "View own PTO/time-off", module: "pto" },
  { key: "pto.view_team", name: "View Team PTO", description: "View team PTO/time-off", module: "pto" },
  { key: "pto.view_all", name: "View All PTO", description: "View all PTO/time-off", module: "pto" },
  { key: "pto.approve", name: "Approve PTO", description: "Approve/deny PTO/time-off requests", module: "pto" },
  { key: "pto.manage_policies", name: "Manage PTO Policies", description: "Manage PTO policies and balances", module: "pto" },
  { key: "payroll.view_self", name: "View Own Payroll", description: "View own payroll", module: "payroll" },
  { key: "payroll.view_all", name: "View All Payroll", description: "View all payroll", module: "payroll" },
  { key: "payroll.view_batches", name: "View Payroll Batches", description: "View payroll batches", module: "payroll" },
  { key: "payroll.manage", name: "Manage Payroll", description: "Manage payroll runs", module: "payroll" },
  { key: "payroll.mark_sent", name: "Mark Payroll Sent", description: "Mark payroll as sent", module: "payroll" },
  { key: "payroll.export", name: "Export Payroll", description: "Export payroll data", module: "payroll" },
  { key: "reports.view", name: "View Reports", description: "View reports", module: "reports" },
  { key: "reports.export", name: "Export Reports", description: "Export reports", module: "reports" },
  { key: "kiosk.manage", name: "Manage Kiosk", description: "Manage kiosk devices", module: "kiosk" },
  { key: "kiosk.use", name: "Use Kiosk", description: "Use kiosk for clock-in", module: "kiosk" },
  { key: "locations.manage", name: "Manage Locations", description: "Manage locations", module: "locations" },
  { key: "locations.view", name: "View Locations", description: "View locations", module: "locations" },
  { key: "approvals.view", name: "View Approvals", description: "View pending approvals", module: "approvals" },
  { key: "approvals.manage", name: "Manage Approvals", description: "Manage approval workflows", module: "approvals" },
  { key: "alerts.view", name: "View Alerts", description: "View alerts and notifications", module: "alerts" },
  { key: "alerts.manage", name: "Manage Alerts", description: "Manage alert configurations", module: "alerts" },
  { key: "settings.manage", name: "Manage Settings", description: "Manage system settings", module: "settings" },
  { key: "system.jobs.view", name: "View Background Jobs", description: "View background job health and run the job queue", module: "system" },
  { key: "audit.view", name: "View Audit Logs", description: "View audit logs", module: "audit" },
  { key: "biometrics.manage", name: "Manage Biometrics", description: "Manage biometric kiosk settings, legal profiles, enrollments, and review attempts", module: "biometrics" },
  { key: "policies.view", name: "View Policies", description: "View policies, assignments, and policy defaults", module: "policies" },
  { key: "policies.manage", name: "Manage Policies", description: "Create, edit, assign, activate, and archive policies and rules", module: "policies" },
  { key: "schedules.view", name: "View Schedules", description: "View employee schedules and schedule templates", module: "schedules" },
  { key: "schedules.manage", name: "Manage Schedules", description: "Edit employee schedules and manage schedule templates", module: "schedules" },
  { key: "workflows.manage", name: "Manage Workflows", description: "Create and manage visual workflows", module: "workflows" },
  { key: "reviews.manage", name: "Manage Review Cycles", description: "Manage performance review cycles", module: "reviews" },
  { key: "reviews.update_reminders", name: "Update Review Reminders", description: "Update performance review reminders for direct reports", module: "reviews" },
  { key: "offboarding.update_tasks", name: "Update Offboarding Tasks", description: "Update offboarding checklist tasks for direct reports", module: "offboarding" },
];

const SYSTEM_ROLES = [
  {
    name: "Super Admin",
    description: "Full system access across all companies",
    permissions: ["system.super_admin"],
  },
  {
    name: "Division Admin",
    description: "Full access within a company",
    permissions: [
      "company.manage", "company.view", "company.create", "company.edit", "company.delete",
      "users.create", "users.view", "users.edit", "users.deactivate", "users.delete",
      "roles.manage",
      "departments.create", "departments.view", "departments.edit", "departments.delete",
      "attendance.view_all", "attendance.edit", "attendance.manage_rules", "attendance.approve_corrections",
      "pto.view_all", "pto.approve", "pto.manage_policies",
      "payroll.view_all", "payroll.view_batches", "payroll.manage", "payroll.mark_sent", "payroll.export",
      "reports.view", "reports.export",
      "kiosk.manage",
      "locations.manage", "locations.view",
      "approvals.view", "approvals.manage",
      "alerts.view", "alerts.manage",
      "settings.manage",
      "system.jobs.view",
      "audit.view",
      "biometrics.manage",
      "attendance.view_team", "pto.view_team",
      "policies.view", "policies.manage",
      "schedules.view", "schedules.manage",
      "workflows.manage",
      "reviews.manage", "reviews.update_reminders",
      "offboarding.update_tasks",
    ],
  },
  {
    name: "HR Admin",
    description: "Human resources management",
    permissions: [
      "company.view", "company.create",
      "users.create", "users.view", "users.edit", "users.delete",
      "departments.view", "departments.edit",
      "attendance.view_all", "attendance.edit", "attendance.approve_corrections",
      "pto.view_all", "pto.approve", "pto.manage_policies",
      "reports.view", "reports.export",
      "locations.view",
      "approvals.view",
      "alerts.view",
      "audit.view",
      "biometrics.manage",
      "attendance.view_team", "pto.view_team",
      "schedules.view", "schedules.manage",
      "reviews.manage", "reviews.update_reminders",
      "offboarding.update_tasks",
    ],
  },
  {
    name: "Payroll Admin",
    description: "Payroll processing and management",
    permissions: [
      "company.view",
      "users.view",
      "departments.view",
      "attendance.view_all",
      "pto.view_all",
      "payroll.view_all", "payroll.view_batches", "payroll.manage", "payroll.mark_sent", "payroll.export",
      "reports.view", "reports.export",
      "locations.view",
    ],
  },
  {
    name: "Location Manager",
    description: "Manage a specific location",
    permissions: [
      "company.view",
      "users.view",
      "departments.view", "departments.edit",
      "attendance.view_team", "attendance.edit", "attendance.approve_corrections",
      "pto.view_team", "pto.approve",
      "reports.view",
      "kiosk.manage",
      "locations.view",
      "approvals.view",
      "schedules.view", "schedules.manage",
      "reviews.update_reminders",
      "offboarding.update_tasks",
    ],
  },
  {
    name: "Department Manager",
    description: "Manage a specific department",
    permissions: [
      "company.view",
      "users.view",
      "departments.view",
      "attendance.view_team", "attendance.clock", "attendance.view_self",
      "pto.view_team", "pto.approve", "pto.request", "pto.view_self",
      "payroll.view_self",
      "reports.view",
      "approvals.view",
      "attendance.approve_corrections",
      "schedules.view", "schedules.manage",
      "reviews.update_reminders",
      "offboarding.update_tasks",
    ],
  },
  {
    name: "Supervisor",
    description: "Team supervision with limited management",
    permissions: [
      "company.view",
      "users.view",
      "departments.view",
      "attendance.view_team", "attendance.clock", "attendance.view_self",
      "pto.view_team", "pto.approve", "pto.request", "pto.view_self",
      "payroll.view_self",
      "approvals.view",
      "attendance.approve_corrections",
      "schedules.view", "schedules.manage",
      "reviews.update_reminders",
      "offboarding.update_tasks",
    ],
  },
  {
    name: "Employee",
    description: "Standard employee access",
    permissions: [
      "attendance.view_self", "attendance.clock",
      "pto.request", "pto.view_self",
      "payroll.view_self",
      "kiosk.use",
    ],
  },
  {
    name: "Kiosk Device",
    description: "Kiosk terminal access",
    permissions: [
      "kiosk.use",
      "attendance.clock",
    ],
  },
];

const POLICY_TYPES = [
  { key: "attendance", name: "Attendance", description: "Attendance tracking policies", module: "attendance" },
  { key: "pto", name: "PTO", description: "Paid time off and leave policies", module: "pto" },
  { key: "payroll", name: "Payroll", description: "Payroll processing policies", module: "payroll" },
  { key: "approvals", name: "Approvals", description: "Approval workflow policies", module: "approvals" },
  { key: "alerts", name: "Alerts", description: "Alert and notification policies", module: "alerts" },
  { key: "kiosk", name: "Kiosk", description: "Kiosk device policies", module: "kiosk" },
  { key: "certifications", name: "Certifications", description: "Certification expiration and required document policies", module: "hr" },
];

export async function seed() {
  console.log("Seeding database...");

  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@ahavamedical.com"));

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await db.insert(users).values({
      id: "admin-dev-001",
      email: "admin@ahavamedical.com",
      password: hashedPassword,
      passwordHash: hashedPassword,
      firstName: "Admin",
      lastName: "User",
      role: "admin",
    });
    console.log("Created admin user: admin@ahavamedical.com / admin123");
  } else {
    console.log("Admin user already exists, skipping.");
  }

  const [existingPerm] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.key, "system.super_admin"));

  if (!existingPerm) {
    console.log("Seeding permissions...");
    await db.insert(permissions).values(PERMISSION_KEYS);
    console.log(`Inserted ${PERMISSION_KEYS.length} permissions.`);
  } else {
    // Idempotently insert any newly added permissions (e.g. when a release adds permission keys).
    const existingKeys = new Set(
      (await db.select({ key: permissions.key }).from(permissions)).map((p) => p.key),
    );
    const missing = PERMISSION_KEYS.filter((p) => !existingKeys.has(p.key));
    if (missing.length > 0) {
      await db.insert(permissions).values(missing);
      console.log(`Inserted ${missing.length} new permissions: ${missing.map((p) => p.key).join(", ")}`);
    } else {
      console.log("Permissions already seeded, skipping.");
    }
  }

  const allPerms = await db.select().from(permissions);
  const permMap = new Map(allPerms.map((p) => [p.key, p.id]));

  const [existingRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, "Super Admin"));

  if (!existingRole) {
    console.log("Seeding roles and role_permissions...");
    for (const roleDef of SYSTEM_ROLES) {
      const [role] = await db
        .insert(roles)
        .values({
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
        })
        .returning();

      const rpValues = roleDef.permissions
        .map((permKey) => {
          const permId = permMap.get(permKey);
          if (!permId) {
            console.warn(`Permission ${permKey} not found for role ${roleDef.name}`);
            return null;
          }
          return { roleId: role.id, permissionId: permId };
        })
        .filter(Boolean) as { roleId: string; permissionId: string }[];

      if (rpValues.length > 0) {
        await db.insert(rolePermissions).values(rpValues);
      }
      console.log(`  Created role "${roleDef.name}" with ${rpValues.length} permissions.`);
    }
  } else {
    // One-time rename: the "Company" → "Division" terminology refresh renamed the
    // canonical role from "Company Admin" to "Division Admin". Older deployments
    // still carry the legacy row, which prevents the top-up loop below from finding
    // it (and was the root cause of task #210 — Division Admins couldn't pick up
    // the restored company.* permissions). Rename in place so the loop matches.
    const [legacyDivAdmin] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, "Company Admin"));
    const [newDivAdmin] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, "Division Admin"));
    if (legacyDivAdmin && !newDivAdmin) {
      await db
        .update(roles)
        .set({ name: "Division Admin", description: "Full access within a division" })
        .where(eq(roles.id, legacyDivAdmin.id));
      console.log('Renamed legacy role "Company Admin" → "Division Admin".');
    }

    // Idempotently grant any newly added permissions to system roles. (Run after every
    // seed so post-deploy permission additions reach the canned roles automatically.)
    for (const roleDef of SYSTEM_ROLES) {
      const [role] = await db.select().from(roles).where(eq(roles.name, roleDef.name));
      if (!role) continue;
      const existingForRole = await db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));
      const existingPermIds = new Set(existingForRole.map((r) => r.permissionId));
      const toAdd = roleDef.permissions
        .map((permKey) => permMap.get(permKey))
        .filter((id): id is string => !!id && !existingPermIds.has(id))
        .map((permId) => ({ roleId: role.id, permissionId: permId }));
      if (toAdd.length > 0) {
        await db.insert(rolePermissions).values(toAdd);
        console.log(`  Topped up role "${roleDef.name}" with ${toAdd.length} new permissions.`);
      }
    }
  }

  const allRoles = await db.select().from(roles);
  const superAdminRole = allRoles.find((r) => r.name === "Super Admin");
  if (superAdminRole) {
    const [existingAdminUserRole] = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, "admin-dev-001"));

    if (!existingAdminUserRole) {
      await db.insert(userRoles).values({
        userId: "admin-dev-001",
        roleId: superAdminRole.id,
      });
      console.log("Assigned Super Admin role to admin user.");
    } else {
      console.log("Admin user role already assigned, skipping.");
    }
  }

  const [existingPolicyType] = await db
    .select()
    .from(policyTypes)
    .where(eq(policyTypes.key, "attendance"));

  if (!existingPolicyType) {
    console.log("Seeding policy types...");
    await db.insert(policyTypes).values(POLICY_TYPES);
    console.log(`Inserted ${POLICY_TYPES.length} policy types.`);
  } else {
    const existingTypes = await db.select().from(policyTypes);
    const existingKeys = new Set(existingTypes.map((t) => t.key));
    const missingTypes = POLICY_TYPES.filter((p) => !existingKeys.has(p.key));
    if (missingTypes.length > 0) {
      console.log(`Adding ${missingTypes.length} missing policy types: ${missingTypes.map((m) => m.key).join(", ")}`);
      await db.insert(policyTypes).values(missingTypes);
    } else {
      console.log("Policy types already seeded, skipping.");
    }
  }

  // System default policies — one per policy type with sensible defaults from
  // policyEngine.getDefaultRulesForType. Flagged with isSystemDefault=true so
  // the Delete action in /rules-controls disables the trash button and the
  // server rejects deletion. Idempotent — only inserts when no system default
  // exists for a given policy type.
  const SYSTEM_DEFAULT_POLICY_TYPES: { key: string; name: string; description: string }[] = [
    { key: "attendance", name: "Default Attendance Policy", description: "System default attendance rules. Used when no more specific policy applies." },
    { key: "pto", name: "Default PTO Policy", description: "System default PTO rules. Used when no more specific policy applies." },
    { key: "payroll", name: "Default Payroll Policy", description: "System default payroll rules. Used when no more specific policy applies." },
    { key: "approvals", name: "Default Approval Workflow", description: "System default approval rules. Used when no more specific policy applies." },
  ];

  const allTypes = await db.select().from(policyTypes);
  const typesByKey = new Map(allTypes.map((t) => [t.key, t]));
  for (const def of SYSTEM_DEFAULT_POLICY_TYPES) {
    const type = typesByKey.get(def.key);
    if (!type) continue;
    const [existingDefault] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.policyTypeId, type.id), eq(policies.isSystemDefault, true)));
    if (existingDefault) continue;
    const [created] = await db
      .insert(policies)
      .values({
        policyTypeId: type.id,
        name: def.name,
        description: def.description,
        status: "active",
        isSystemDefault: true,
      })
      .returning();
    const rules = getDefaultRulesForType(def.key);
    if (Object.keys(rules).length > 0) {
      await db.insert(policyRules).values({ policyId: created.id, rules });
    }
    console.log(`Seeded system default policy: ${def.name}`);
  }

  // Backfill — if any previously seeded policies match a default name but
  // lack the flag (legacy data from before this column existed), mark them
  // as system defaults so they're protected from deletion.
  for (const def of SYSTEM_DEFAULT_POLICY_TYPES) {
    const type = typesByKey.get(def.key);
    if (!type) continue;
    await db
      .update(policies)
      .set({ isSystemDefault: true })
      .where(and(
        eq(policies.policyTypeId, type.id),
        eq(policies.name, def.name),
        eq(policies.isSystemDefault, false),
      ));
  }

  // Default PTO policy: 1 hour PTO per 30 hours worked, capped at 40/year,
  // use-it-or-lose-it (0 carryover). Idempotent: looks up by name, then
  // ensures the rule values match and the row is the company default.
  const DEFAULT_PTO_POLICY_NAME = "Standard PTO (1 per 30, 40 cap)";
  const DEFAULT_PTO_POLICY_DESCRIPTION =
    "Company default: employees earn 1 hour of PTO for every 30 hours worked, capped at 40 hours per year. Unused PTO resets at year end (use it or lose it).";
  const defaultPtoRules = {
    accrualType: "per_hours_worked" as const,
    accrualHoursPerYear: 40,
    yearlyCapHours: 40,
    carryoverCapHours: 0,
    waitingPeriodDays: 0,
    vacationAccrualPerHoursWorked: 30,
    vacationAccrualHoursPerThreshold: 1,
    isDefault: true,
    isActive: true,
  };
  const [existingDefaultPto] = await db
    .select()
    .from(ptoPolicies)
    .where(eq(ptoPolicies.name, DEFAULT_PTO_POLICY_NAME));
  let defaultPtoPolicyId: string;
  if (!existingDefaultPto) {
    // Clear any other default first to satisfy the single-default invariant.
    await db.update(ptoPolicies).set({ isDefault: false }).where(eq(ptoPolicies.isDefault, true));
    const [created] = await db
      .insert(ptoPolicies)
      .values({
        name: DEFAULT_PTO_POLICY_NAME,
        description: DEFAULT_PTO_POLICY_DESCRIPTION,
        ...defaultPtoRules,
      })
      .returning();
    defaultPtoPolicyId = created.id;
    console.log(`Seeded default PTO policy: ${DEFAULT_PTO_POLICY_NAME}`);
  } else {
    if (!existingDefaultPto.isDefault) {
      await db.update(ptoPolicies).set({ isDefault: false }).where(eq(ptoPolicies.isDefault, true));
    }
    await db
      .update(ptoPolicies)
      .set({
        description: DEFAULT_PTO_POLICY_DESCRIPTION,
        ...defaultPtoRules,
        updatedAt: new Date(),
      })
      .where(eq(ptoPolicies.id, existingDefaultPto.id));
    defaultPtoPolicyId = existingDefaultPto.id;
    console.log(`Refreshed default PTO policy: ${DEFAULT_PTO_POLICY_NAME}`);
  }

  // Auto-assign active employees who don't already have an explicit policy.
  const activeUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.deactivatedAt));
  let assigned = 0;
  for (const u of activeUsers) {
    const [existing] = await db
      .select()
      .from(employeePtoSettings)
      .where(eq(employeePtoSettings.userId, u.id));
    if (!existing) {
      await db.insert(employeePtoSettings).values({
        userId: u.id,
        ptoPolicyId: defaultPtoPolicyId,
      });
      assigned += 1;
    } else if (!existing.ptoPolicyId) {
      await db
        .update(employeePtoSettings)
        .set({ ptoPolicyId: defaultPtoPolicyId, updatedAt: new Date() })
        .where(eq(employeePtoSettings.id, existing.id));
      assigned += 1;
    }
  }
  if (assigned > 0) {
    console.log(`Linked ${assigned} active employee(s) to the default PTO policy.`);
  }

  // Biometric singleton settings — feature flag defaults OFF.
  const [existingSettings] = await db
    .select()
    .from(biometricSettings)
    .where(eq(biometricSettings.key, "global"));
  if (!existingSettings) {
    await db.insert(biometricSettings).values({ key: "global" });
    console.log("Seeded default biometric settings (feature flag OFF).");
  }

  // Default legal profile — disabled, ships with placeholder consent text that legal
  // must review before enabling. Per spec: new profiles default disabled.
  const [existingDefaultProfile] = await db
    .select()
    .from(biometricLegalProfiles)
    .where(eq(biometricLegalProfiles.isDefault, true));
  if (!existingDefaultProfile) {
    await db.insert(biometricLegalProfiles).values({
      name: "Default",
      description:
        "Fallback consent profile applied to any user/location without a more specific assignment. Disabled by default — review wording with legal counsel before enabling.",
      consentText: DEFAULT_CONSENT_TEXT,
      consentVersion: 1,
      retentionDays: 180,
      isEnabled: false,
      isDefault: true,
    });
    console.log("Seeded Default biometric legal profile (disabled).");
  }

  console.log("Seed complete.");
}

const DEFAULT_CONSENT_TEXT = `Ahava Medical Center — Biometric Information Consent

I voluntarily authorize Ahava Medical Center ("Ahava") to collect, store, and use a
mathematical representation (a "biometric template") of my face for the sole purpose of
verifying my identity when I clock in and out at a workplace time-and-attendance kiosk.

What is collected: A numeric face template only. Ahava will NOT store or transmit any
photograph or video of my face. Templates are stored encrypted on Ahava's systems and
are scoped to my employer entity.

How long it is kept: Templates are retained for as long as I am actively employed and
using face login, and for no more than 180 days after my last successful match (or as
required by applicable law). Templates are deleted automatically when I revoke this
consent, when my employment ends, or after the inactivity window above.

My rights: I may revoke this consent at any time from my profile, which immediately
deletes all of my stored face templates and disables face login for me. I may continue
to use my PIN to clock in/out at any time — face login is optional.

By accepting below I confirm I have read and understood this notice.`;

if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
