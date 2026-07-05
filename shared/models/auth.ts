import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { normalizeTimezone } from "../timezone";

// Task #518: a single, bypass-proof Zod guard for any persisted `timezone`
// field. Root cause context lives in shared/timezone.ts — a malformed IANA zone
// ("America/New york") that reaches the DB later inflates lateness/OT. Rather
// than relying on each route to remember to call the guard, this coerces a
// recoverable value to its canonical form and REJECTS an unrecoverable one at
// parse time, so EVERY write path that validates through an insert schema
// (present or future) is protected automatically. A blank/omitted zone is
// allowed (downstream falls back to company/default). Reuse this on the insert
// schema of any new table that stores a timezone.
export const timezoneFieldSchema = z
  .string()
  .optional()
  .nullable()
  .transform((val, ctx) => {
    if (val === undefined || val === null || val.trim() === "") return val;
    const normalized = normalizeTimezone(val);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${val}" is not a valid IANA timezone.`,
      });
      return z.NEVER;
    }
    return normalized;
  });

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  legalName: varchar("legal_name", { length: 200 }),
  slug: varchar("slug", { length: 100 }).unique(),
  address: varchar("address", { length: 500 }),
  latitude: real("latitude"),
  longitude: real("longitude"),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 200 }),
  timezone: varchar("timezone", { length: 50 }).default("America/New_York"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  timezone: timezoneFieldSchema,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

export const divisions = companies;
export const insertDivisionSchema = insertCompanySchema;
export type InsertDivision = InsertCompany;
export type Division = Company;

export const locations = pgTable("locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 20 }),
  timezone: varchar("timezone", { length: 50 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  timezone: timezoneFieldSchema,
});
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

// Task #258: locations can belong to multiple companies. `locations.companyId`
// remains the "primary" company (and the legacy single-tenant default) but the
// join table is the source of truth for company-scoped filtering.
export const locationCompanies = pgTable(
  "location_companies",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: varchar("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
    companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    unique("location_companies_unique").on(table.locationId, table.companyId),
    index("IDX_location_companies_company").on(table.companyId),
    index("IDX_location_companies_location").on(table.locationId),
  ],
);

export const insertLocationCompanySchema = createInsertSchema(locationCompanies).omit({
  id: true,
  createdAt: true,
});
export type InsertLocationCompany = z.infer<typeof insertLocationCompanySchema>;
export type LocationCompany = typeof locationCompanies.$inferSelect;

export const locationAddresses = pgTable("location_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 100 }),
  address: varchar("address", { length: 500 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  latitude: real("latitude"),
  longitude: real("longitude"),
  geofenceEnabled: boolean("geofence_enabled").default(false).notNull(),
  geofenceRadiusMeters: integer("geofence_radius_meters").default(150).notNull(),
});

export const insertLocationAddressSchema = createInsertSchema(locationAddresses).omit({
  id: true,
});
export type InsertLocationAddress = z.infer<typeof insertLocationAddressSchema>;
export type LocationAddress = typeof locationAddresses.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email"),
  password: varchar("password"),
  passwordHash: varchar("password_hash"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 20 }).default("employee").notNull(),
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id"),
  forcePasswordChange: boolean("force_password_change").default(false).notNull(),
  roleManuallyOverriddenAt: timestamp("role_manually_overridden_at"),
  deactivatedAt: timestamp("deactivated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
// `departmentIds`/`locationIds` are the many-to-many memberships, hydrated onto
// user reads from the `employee_departments` / `employee_locations` join tables.
// They are optional because not every read path hydrates them; consumers should
// use `userDepartmentIds`/`userLocationIds` which fall back to the legacy single
// column when the arrays aren't present.
export type User = typeof users.$inferSelect & {
  departmentIds?: string[];
  locationIds?: string[];
};

/**
 * Canonical accessor for an employee's department memberships. Prefers the
 * hydrated many-to-many `departmentIds`; falls back to the legacy single
 * `departmentId` column so un-hydrated rows still resolve to a membership set.
 */
export function userDepartmentIds(u: { departmentIds?: string[]; departmentId?: string | null }): string[] {
  if (u.departmentIds && u.departmentIds.length > 0) return u.departmentIds;
  return u.departmentId ? [u.departmentId] : [];
}

/**
 * Canonical accessor for an employee's location memberships. Prefers the
 * hydrated many-to-many `locationIds`; falls back to the legacy single
 * `locationId` column.
 */
export function userLocationIds(u: { locationIds?: string[]; locationId?: string | null }): string[] {
  if (u.locationIds && u.locationIds.length > 0) return u.locationIds;
  return u.locationId ? [u.locationId] : [];
}

/**
 * Canonical form for `users.email` — trimmed + lowercased so duplicates that
 * differ only in casing/whitespace collide. Returns `null` for nullish or
 * empty input so optional-email rows stay null. Use this anywhere we write
 * or look up `users.email` (Add Employee, Replit Auth upsert, password
 * reset, seed) so the DB-level case-insensitive unique index never has to
 * paper over inconsistent app-layer normalization.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null;
  const trimmed = String(email).trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    requestedIp: varchar("requested_ip", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("IDX_password_reset_tokens_user").on(table.userId),
    index("IDX_password_reset_tokens_expires").on(table.expiresAt),
  ],
);

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
  usedAt: true,
});
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  isSystem: boolean("is_system").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  companyId: varchar("company_id").references(() => companies.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  module: varchar("module", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
});
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").notNull().references(() => roles.id),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("role_permission_unique").on(table.roleId, table.permissionId),
]);

export type RolePermission = typeof rolePermissions.$inferSelect;

export const userRoles = pgTable("user_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  roleId: varchar("role_id").notNull().references(() => roles.id),
  companyId: varchar("company_id").references(() => companies.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("user_role_unique").on(table.userId, table.roleId),
]);

export type UserRole = typeof userRoles.$inferSelect;

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id),
  allowed: boolean("allowed").notNull(),
  reason: varchar("reason", { length: 500 }),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("user_permission_override_unique").on(table.userId, table.permissionId),
]);

export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;

export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  // Departments are a single shared list across all companies (Task #433).
  // companyId is retained (nullable, unused for scoping) to avoid a destructive
  // schema change; name is now globally unique.
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("departments_name_unique").on(table.name),
]);

export const insertDepartmentSchema = createInsertSchema(departments)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.string().nullish(),
  });
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departments.$inferSelect;

export const departmentManagers = pgTable("department_managers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  departmentId: varchar("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("department_manager_unique").on(table.departmentId, table.userId),
]);

export const insertDepartmentManagerSchema = createInsertSchema(departmentManagers).omit({
  id: true,
  createdAt: true,
});
export type InsertDepartmentManager = z.infer<typeof insertDepartmentManagerSchema>;
export type DepartmentManager = typeof departmentManagers.$inferSelect;

export const userAccessScopes = pgTable("user_access_scopes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  scopeType: varchar("scope_type", { length: 30 }).notNull(),
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id").references(() => departments.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type UserAccessScope = typeof userAccessScopes.$inferSelect;

// Many-to-many: an employee belongs to one OR MORE departments. Mirrors the
// `location_companies` pivot pattern. The legacy `users.department_id` column
// is kept as a compatibility shim (populated with one of the assignments).
export const employeeDepartments = pgTable(
  "employee_departments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    departmentId: varchar("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    unique("employee_departments_unique").on(table.userId, table.departmentId),
    index("IDX_employee_departments_user").on(table.userId),
    index("IDX_employee_departments_department").on(table.departmentId),
  ],
);

export const insertEmployeeDepartmentSchema = createInsertSchema(employeeDepartments).omit({
  id: true,
  createdAt: true,
});
export type InsertEmployeeDepartment = z.infer<typeof insertEmployeeDepartmentSchema>;
export type EmployeeDepartment = typeof employeeDepartments.$inferSelect;

// Many-to-many: an employee belongs to one OR MORE locations.
export const employeeLocations = pgTable(
  "employee_locations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    locationId: varchar("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    unique("employee_locations_unique").on(table.userId, table.locationId),
    index("IDX_employee_locations_user").on(table.userId),
    index("IDX_employee_locations_location").on(table.locationId),
  ],
);

export const insertEmployeeLocationSchema = createInsertSchema(employeeLocations).omit({
  id: true,
  createdAt: true,
});
export type InsertEmployeeLocation = z.infer<typeof insertEmployeeLocationSchema>;
export type EmployeeLocation = typeof employeeLocations.$inferSelect;

export const policyTypes = pgTable("policy_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  module: varchar("module", { length: 50 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPolicyTypeSchema = createInsertSchema(policyTypes).omit({
  id: true,
  createdAt: true,
});
export type InsertPolicyType = z.infer<typeof insertPolicyTypeSchema>;
export type PolicyType = typeof policyTypes.$inferSelect;
