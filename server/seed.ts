import { db } from "./db";
import { users, permissions, roles, rolePermissions, policyTypes, userRoles } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const PERMISSION_KEYS = [
  { key: "system.super_admin", name: "Super Admin", description: "Full system access", module: "system" },
  { key: "company.manage", name: "Manage Division", description: "Manage division settings", module: "company" },
  { key: "company.view", name: "View Division", description: "View division information", module: "company" },
  { key: "users.create", name: "Create Users", description: "Create users", module: "users" },
  { key: "users.view", name: "View Users", description: "View users", module: "users" },
  { key: "users.edit", name: "Edit Users", description: "Edit user details", module: "users" },
  { key: "users.deactivate", name: "Deactivate Users", description: "Deactivate users", module: "users" },
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
  { key: "audit.view", name: "View Audit Logs", description: "View audit logs", module: "audit" },
];

const SYSTEM_ROLES = [
  {
    name: "Super Admin",
    description: "Full system access across all divisions",
    permissions: ["system.super_admin"],
  },
  {
    name: "Division Admin",
    description: "Full access within a division",
    permissions: [
      "company.manage", "company.view",
      "users.create", "users.view", "users.edit", "users.deactivate",
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
      "audit.view",
    ],
  },
  {
    name: "HR Admin",
    description: "Human resources management",
    permissions: [
      "company.view",
      "users.create", "users.view", "users.edit",
      "departments.view", "departments.edit",
      "attendance.view_all", "attendance.edit", "attendance.approve_corrections",
      "pto.view_all", "pto.approve", "pto.manage_policies",
      "reports.view", "reports.export",
      "locations.view",
      "approvals.view",
      "alerts.view",
      "audit.view",
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
    console.log("Permissions already seeded, skipping.");
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
    console.log("Roles already seeded, skipping.");
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
    console.log("Policy types already seeded, skipping.");
  }

  console.log("Seed complete.");
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
