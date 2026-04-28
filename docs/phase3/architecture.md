# Employee Lifecycle Automation — Technical Architecture Spec (Phase 3)

> **Status:** Draft for review. No code changes have been made. Implementation of the four downstream tasks (Lifecycle Wizards, HR Compliance Alerts, Automation Rules, Recurring HR Reminders) is gated on this spec and on the companion `docs/phase3/ui-ux.md` being approved.
>
> **Companion document:** [`./ui-ux.md`](./ui-ux.md) — UI/UX Design Spec.
>
> **Builds on:** [`../phase2/architecture.md`](../phase2/architecture.md) — the Rules Command Center precedence resolver and policy data model. Phase 3 reuses those primitives, it does not redesign them.

---

## 1. Current state baseline

This section enumerates what already exists in the repo, with concrete file references, so reviewers can see exactly what Phase 3 changes versus what it leaves untouched.

### 1.1 Identity & employment

- **User creation** — `POST /api/users` in `server/routes.ts:225-283`.
  - Validates with `createUserSchema` (`server/routes.ts:210-223`): `email`, `firstName`, `lastName`, `role`, optional `companyId`/`locationId`/`departmentId`, optional employment fields (`employmentType`, `hireDate`, `payType`, `hourlyRate`, `weeklySalary`).
  - Generates a 12-character temp password via `generateTempPassword()` (`server/routes.ts:60-67`), bcrypt-hashes it, sets `forcePasswordChange: true` on the user, and returns the plaintext temp password in the response payload as `temporaryPassword`.
  - When any employment field is provided, also creates a row in `user_employment_profiles` with defaults (`overtimeEligible:false`, `holidayPayEnabled:false`, `voluntaryPayEnabled:false`).
  - **Phase 3 does not change this route's request shape or response shape.** Phase 3 hooks into it as a post-create side effect (see §3).
- **Employment profile** — `user_employment_profiles` table in `shared/schema.ts:186-209`. Owns `employmentType`, `payType`, `hourlyRate`, `weeklySalary`, `dailySalary`, `overtimeEligible`, `holidayPayEnabled`, `voluntaryPayEnabled`, `hireDate`, `terminationDate`. There is exactly one row per user (`userId` is `unique`).
- **`isActive` semantics** — there is no `isActive` column on `users`. "Active employee" today is defined operationally as `userEmploymentProfiles.terminationDate IS NULL OR > today`. Phase 3 preserves this definition; we will not introduce an `isActive` column on `users`.
- **Role system** — `users.role` is a `varchar(20)` with values `employee | manager | admin` (`shared/models/auth.ts:86`). The richer RBAC system lives in `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permission_overrides`, `user_access_scopes` (`shared/models/auth.ts:98-215`). Today, `users.role` is set on create and changed via `PATCH /api/users/:id/role` (`server/routes.ts:196-208`). Phase 3 only writes to `users.role`; it does not change the `roles`/`user_roles` model.

### 1.2 Documents

- **`documents` table** — `shared/schema.ts:76-104`. Columns: `id`, `employeeId`, `documentType varchar(50)`, `fileName`, `filePath`, `mimeType`, `fileSize`, `status` (`uploaded` default), `uploadedBy`, `uploadedAt`, `reviewedBy`, `reviewedAt`.
- **Allowed types** — `ALLOWED_DOCUMENT_TYPES` in `server/routes.ts:473`: `["w9", "i9", "direct_deposit", "emergency_contact", "handbook_ack"]`. Validated in `POST /api/users/:id/documents` (`server/routes.ts:480-`).
- **Storage backend** — `server/services/documentStorage.ts` writes to Replit Object Storage under `${PRIVATE_OBJECT_DIR}/documents/<uuid>`.
- **Phase 3 does not change** the `documents` table, the existing upload route, or the storage backend. It adds a *requirement* layer on top (see §5).

### 1.3 Alerts

- **`system_alerts` table** — `shared/schema.ts:566-590`. Columns: `id`, `type varchar(50)`, `severity varchar(20)` default `medium`, `status varchar(20)` default `open`, `employeeId` (nullable FK), `message text`, `details jsonb`, `acknowledgedBy/At`, `resolvedBy/At`, `createdAt`.
- **Detection engine** — `server/services/alerts.ts`. Today emits these `AlertType` values (`server/services/alerts.ts:7-14`): `missing_clock_out`, `late_clock_in`, `overtime_threshold`, `no_show`, `repeated_exception`, `break_violation`, `auto_clock_out`. `runAlertDetection()` (`server/services/alerts.ts:299-345`) runs each detector and returns `GeneratedAlert[]`; persistence is done by `createPolicyAlert` in `server/services/policyEnforcement.ts:485-` which dedupes against open alerts of the same `(type, employeeId, message)`.
- **Surface** — admin/manager `/alerts` page (`client/src/pages/alerts.tsx`).
- **Phase 3 adds new `AlertType` values** but reuses the same table, the same `createPolicyAlert` dedupe helper, and the same `/alerts` page.

### 1.4 Background jobs

- **`jobs` table** — `shared/schema.ts:728-744`. Columns: `id`, `type varchar(64)`, `payload jsonb`, `status varchar(20)` (`pending|running|completed|failed`), `error`, `createdAt`, `completedAt`.
- **Engine** — `server/services/jobs.ts`. Currently knows two types (`server/services/jobs.ts:6`): `auto-clock-out`, `rebuild-report`. `enqueue(type, payload)` inserts a pending row, `drainPending(limit)` claims+executes via `processJob`, `ensureRecurringEnqueued()` keeps a single `auto-clock-out` job pending at a time.
- **Phase 3 adds new job types** to the same `JobType` union and the same `processJob` switch statement. We do not introduce a separate scheduler.

### 1.5 Schedules

- **`employee_schedules` table** — `shared/schema.ts:709-722`. Per-day-of-week (`dayOfWeek 0-6`), per-employee row with `startTime varchar(5)` and `endTime varchar(5)` and an `isActive` flag. There can be at most one row per `(employeeId, dayOfWeek)` in practice (no DB unique constraint today; storage layer treats it as upsert).
- **Storage helpers** — `IStorage.getEmployeeSchedules(employeeId)`, `getEmployeeScheduleByDay(employeeId, dayOfWeek)`, `upsertEmployeeSchedule(schedule)`, `deleteEmployeeSchedules(employeeId)` (`server/storage.ts:335-338`).
- **Phase 3 does not change** the `employee_schedules` table; it adds a template layer that *writes through* to it (see §8).

### 1.6 PTO accrual

- **`pto_policies` table** — `shared/schema.ts:370-401`. Carries the rule values shown in `DEFAULT_PTO_RULES` (`server/policyEngine.ts:142-159`).
- **`employee_pto_settings` table** — `shared/schema.ts:403-422`. Per-employee policy override + balance overrides + per-employee `hireDate`.
- **`time_off_balances` table** — `shared/schema.ts:323-336`. Per `(userId, type, year)` with `totalDays`, `usedDays`.
- **Resolver** — `getEffectivePolicy(companyId, userId, "pto", user)` in `server/policyEngine.ts:21-127` (Phase 2). Returns the resolved PTO rules in the same `EffectivePolicy` shape used by attendance/payroll.
- **Phase 3 does not change** `pto_policies`, `employee_pto_settings`, or the precedence resolver. It writes adjustments to `time_off_balances` and writes audit rows to a new `pto_anniversary_adjustments` table (see §9).

### 1.7 Phase 2 Rules Command Center

`getEffectivePolicy` resolves `policyTypeKey → effective rules` walking employee → department → location → division → global. Phase 3 reuses this verbatim wherever a lifecycle feature needs a configurable threshold (review lead times, certification warning thresholds, required documents per scope).

### 1.8 What stays unchanged (explicit list)

- `users` table shape, `users.role` semantics, `POST /api/users` request/response shape, the temp-password mechanism.
- `user_employment_profiles` columns (we do not move `terminationDate` elsewhere).
- `documents` table, `ALLOWED_DOCUMENT_TYPES`, the existing upload route and object-storage backend.
- `system_alerts` table shape, the dedupe rules in `createPolicyAlert`, the `/alerts` page contract.
- `employee_schedules` table shape and storage helpers.
- `pto_policies`, `employee_pto_settings`, `time_off_balances` columns, and the Phase 2 precedence resolver.
- `jobs` table shape and `drainPending` engine.
- `audit_logs` table shape.
- The `roles`/`permissions`/`user_roles` RBAC tables. Auto role assignment writes to `users.role` only.

---

## 2. Schema additions and extensions

All new tables go in `shared/schema.ts` (or a new `shared/models/lifecycle.ts` re-exported from `shared/schema.ts` if the file is split for readability — this is an implementation detail, not a contract). Every new `varchar` PK uses the same `gen_random_uuid()` default that the rest of the codebase uses.

**Migration order** (one Drizzle push, but logically ordered so FKs resolve):

1. Templates (no FKs into Phase-3 tables): `onboarding_templates`, `onboarding_template_tasks`, `offboarding_templates`, `offboarding_template_tasks`, `schedule_templates`, `schedule_template_days`, `required_document_rules`, `role_assignment_rules`, `performance_review_cycles`.
2. Per-employee instance tables (FK into templates): `onboarding_checklists`, `onboarding_tasks`, `offboarding_checklists`, `offboarding_tasks`, `certifications`, `pto_anniversary_adjustments`, `performance_review_reminders`.

**Backfill** is intentionally minimal (Phase 3 is opt-in):

- No backfill of `onboarding_checklists` for existing employees. New hires created after merge get a checklist; existing employees do not retroactively get one. An admin can trigger one from the employee detail drawer ("Start onboarding now") if needed.
- No backfill of `certifications` rows.
- `pto_anniversary_adjustments` is purely additive; the first run of `apply-pto-anniversary-adjustments` evaluates today's anniversaries only.
- `performance_review_reminders` is created by the first run of `evaluate-performance-reviews` and is idempotent.

### 2.1 Onboarding templates

```ts
export const onboardingTemplates = pgTable("onboarding_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  companyId: varchar("company_id").references(() => companies.id), // null = global default
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- One template can be marked `isDefault=true` per `companyId` (and one for `companyId IS NULL`). The chooser in §3 falls back from company → global default.
- Index: `(companyId, isDefault)` for the default lookup.

```ts
export const onboardingTemplateTasks = pgTable("onboarding_template_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => onboardingTemplates.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  ownerRole: varchar("owner_role", { length: 20 }).notNull(), // 'system' | 'new_hire' | 'hr' | 'manager'
  category: varchar("category", { length: 30 }).notNull(),    // 'account' | 'paperwork' | 'training' | 'equipment' | 'introduction'
  dueOffsetDays: integer("due_offset_days").default(0).notNull(), // days from hire date
  isRequired: boolean("is_required").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  documentType: varchar("document_type", { length: 50 }), // when set, completion requires uploading this document type
  createdAt: timestamp("created_at").defaultNow(),
});
```

- `ownerRole='system'` tasks are auto-completed by the materializer (e.g., "Account created", "Temporary password issued").
- `documentType`, when set, must be one of `ALLOWED_DOCUMENT_TYPES` (validated at write time).
- Index: `(templateId, sortOrder)`.

### 2.2 Onboarding instances

```ts
export const onboardingChecklists = pgTable("onboarding_checklists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().unique().references(() => users.id),
  templateId: varchar("template_id").references(() => onboardingTemplates.id), // null if template was deleted; tasks survive
  status: varchar("status", { length: 20 }).default("in_progress").notNull(), // 'in_progress' | 'complete' | 'cancelled'
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledReason: text("cancelled_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- `employeeId` is `unique` — at most one checklist per employee, lifetime.

```ts
export const onboardingTasks = pgTable("onboarding_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistId: varchar("checklist_id").notNull().references(() => onboardingChecklists.id, { onDelete: "cascade" }),
  templateTaskId: varchar("template_task_id").references(() => onboardingTemplateTasks.id), // null if template task deleted
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  ownerRole: varchar("owner_role", { length: 20 }).notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  dueDate: date("due_date"),
  isRequired: boolean("is_required").default(true).notNull(),
  documentType: varchar("document_type", { length: 50 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // 'pending' | 'complete' | 'skipped'
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id),
  skippedReason: text("skipped_reason"),
  documentId: varchar("document_id").references(() => documents.id), // when completion was via doc upload
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

- Indexes: `(checklistId, sortOrder)`, `(checklistId, status)`.
- `templateTaskId` nullable so that deleting a template task does not cascade-delete the per-employee row.

### 2.3 Offboarding templates and instances

Mirror of onboarding, with these field changes:

- `offboarding_templates`: same shape as `onboarding_templates`.
- `offboarding_template_tasks`:
  - `ownerRole` ∈ `'hr' | 'manager' | 'it' | 'finance' | 'system'` (no `new_hire`).
  - `category` ∈ `'access' | 'equipment' | 'pay' | 'documentation' | 'exit_interview'`.
  - `dueOffsetDays` is days from `terminationDate` (negative allowed: `-7` means a week before last day).
  - `blocksDeactivation boolean default true` — task must be `complete` or `skipped` before account deactivation is allowed.
- `offboarding_checklists`:
  - `employeeId` is `unique`.
  - Adds `terminationDate date NOT NULL` (snapshot at trigger time so a later edit doesn't shift due dates silently).
  - Adds `accountDeactivatedAt timestamp` and `accountDeactivatedBy varchar references users.id`.
- `offboarding_tasks`: same shape as `onboarding_tasks` plus `blocksDeactivation boolean`.

### 2.4 Certifications

```ts
export const certifications = pgTable("certifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  issuer: varchar("issuer", { length: 200 }),
  issueDate: date("issue_date"),
  expirationDate: date("expiration_date"),
  documentId: varchar("document_id").references(() => documents.id), // optional uploaded proof
  notes: text("notes"),
  status: varchar("status", { length: 20 }).default("valid").notNull(), // 'valid' | 'expiring_soon' | 'expired' | 'archived'
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- `status` is computed by the recurring detector and the `POST/PATCH` routes; consumers must not rely on it being trustworthy without a recent detection run, so the UI also computes a derived display status from `expirationDate` on read.
- Indexes: `(employeeId)`, `(expirationDate)`, `(status)`.

### 2.5 Required-document rules

```ts
export const requiredDocumentRules = pgTable("required_document_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentType: varchar("document_type", { length: 50 }).notNull(), // must be in ALLOWED_DOCUMENT_TYPES
  scopeType: varchar("scope_type", { length: 20 }).notNull(), // 'global' | 'company' | 'location' | 'department' | 'employee'
  companyId: varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id").references(() => departments.id),
  employeeId: varchar("employee_id").references(() => users.id),
  dueOffsetDays: integer("due_offset_days").default(0).notNull(), // grace period after hire date before alert fires
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

- Convention mirrors `policy_assignments` — exactly one of the four scope FKs is non-null for non-global rules; all four null for `scopeType='global'`. Validated at write time.
- Index: `(documentType, scopeType)`.
- A rule is satisfied for an employee if the employee has at least one row in `documents` with the matching `documentType` and `status != 'rejected'`.

### 2.6 Role-assignment rules

```ts
export const roleAssignmentRules = pgTable("role_assignment_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  conditions: jsonb("conditions").notNull(), // see "conditions DSL" below
  targetRole: varchar("target_role", { length: 20 }).notNull(), // 'employee' | 'manager' | 'admin'
  priority: integer("priority").default(100).notNull(), // lower runs first
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- **Conditions DSL** (stored in `conditions jsonb`):
  ```ts
  type Condition =
    | { field: string; op: "eq" | "neq" | "in" | "nin"; value: string | string[] }
    | { field: string; op: "exists" | "not_exists" }
    | { all: Condition[] }
    | { any: Condition[] };
  ```
- Allowed `field` values are restricted to a whitelist evaluated against `users` ∪ `user_employment_profiles`: `companyId`, `locationId`, `departmentId`, `employmentType`, `payType`, `overtimeEligible`, `holidayPayEnabled`. Unknown fields cause the rule to skip with an audit entry (so a typo doesn't silently flip everyone to admin).
- Index: `(isActive, priority)`.
- See §7 for evaluation semantics.

### 2.7 Schedule templates

```ts
export const scheduleTemplates = pgTable("schedule_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  companyId: varchar("company_id").references(() => companies.id),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scheduleTemplateDays = pgTable("schedule_template_days", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => scheduleTemplates.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0-6
  startTime: varchar("start_time", { length: 5 }).notNull(),
  endTime: varchar("end_time", { length: 5 }).notNull(),
  isWorkDay: boolean("is_work_day").default(true).notNull(), // false => off day
}, (table) => [unique("schedule_template_day_unique").on(table.templateId, table.dayOfWeek)]);
```

- **Linkage:** add a nullable `scheduleTemplateId varchar references schedule_templates.id` column to `employee_schedules`. This is the only extension to an existing table in Phase 3.
  - When a template is applied to an employee, every written `employee_schedules` row stamps `scheduleTemplateId` with the template's id.
  - When the employee edits any individual day, the row's `scheduleTemplateId` is cleared on that row only — that day is now "customized." The other days remain linked. This is what powers the "linked vs. customized" indicator (UI/UX §7).

### 2.8 PTO anniversary adjustments

```ts
export const ptoAnniversaryAdjustments = pgTable("pto_anniversary_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  effectiveDate: date("effective_date").notNull(),         // employee's anniversary day
  ptoPolicyId: varchar("pto_policy_id").references(() => ptoPolicies.id), // resolved policy at the time
  yearsOfService: integer("years_of_service").notNull(),
  oldAccrualRate: real("old_accrual_rate"),
  newAccrualRate: real("new_accrual_rate"),
  oldTierLabel: varchar("old_tier_label", { length: 100 }),
  newTierLabel: varchar("new_tier_label", { length: 100 }),
  hoursAdded: real("hours_added").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [unique("pto_anniversary_unique").on(table.employeeId, table.effectiveDate)]);
```

- `(employeeId, effectiveDate)` unique → idempotency: re-running the job on the same day is a no-op.
- `audit_logs` row is also written via `writeAuditLog` (`server/services/audit.ts`) with `targetType='pto_balance'`, `action='pto.anniversary_adjustment'`.

### 2.9 Performance review cycles & reminders

```ts
export const performanceReviewCycles = pgTable("performance_review_cycles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id), // null = global default
  cadence: varchar("cadence", { length: 20 }).notNull(), // 'annual' | 'semi_annual' | 'quarterly' | 'new_hire_90'
  anchor: varchar("anchor", { length: 20 }).notNull(),    // 'hire_date' | 'calendar_year' (ignored for new_hire_90)
  leadTimes: jsonb("lead_times").default(sql`'[14,7,0]'::jsonb`).notNull(), // alert lead-time days
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- A company can have multiple active cycles (e.g., `annual` for everyone + `new_hire_90` for the 90-day check-in).
- `cadence='new_hire_90'` is a one-shot reminder fired exactly once per employee, 90 days after `hireDate`.

```ts
export const performanceReviewReminders = pgTable("performance_review_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => users.id),
  cycleId: varchar("cycle_id").notNull().references(() => performanceReviewCycles.id),
  dueDate: date("due_date").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // 'pending' | 'completed' | 'skipped'
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [unique("review_reminder_unique").on(table.employeeId, table.cycleId, table.dueDate)]);
```

- `(employeeId, cycleId, dueDate)` unique → idempotency: re-running `evaluate-performance-reviews` for the same date is a no-op.

### 2.10 Extension to `employee_schedules`

Add nullable `scheduleTemplateId varchar references schedule_templates.id`. Existing rows backfill to `NULL` (= "customized / not from a template"). No data loss.

This is the only schema *extension*; everything else is *additive* (new tables only).

---

## 3. Onboarding wizard

**Trigger:** the existing `POST /api/users` route (`server/routes.ts:225-283`). After the user + employment profile are created, but before the response is returned, the route invokes `materializeOnboardingChecklist(newUser)`. If the materializer throws, the user creation still succeeds — the materializer logs the error and emits an alert of type `onboarding_materialization_failed` so HR can recover. This keeps user creation strictly backwards-compatible.

**Template selection** (in priority order):
1. If the request includes an explicit `onboardingTemplateId`, use it (validated to belong to the new user's company or to be global).
2. Else, the active `onboarding_templates` row with `companyId = newUser.companyId` and `isDefault = true`.
3. Else, the active `onboarding_templates` row with `companyId IS NULL` and `isDefault = true`.
4. Else, no checklist is created. The user is created normally, and an alert of type `onboarding_no_template` is emitted (severity `low`).

**Materialization:**
- Creates one `onboarding_checklists` row.
- For each template task in `sortOrder`, creates one `onboarding_tasks` row, copying `title`, `description`, `ownerRole`, `category`, `isRequired`, `documentType`, `sortOrder`. `dueDate = newUser.employmentProfile.hireDate + dueOffsetDays` (or `null` if no hire date).
- Tasks with `ownerRole='system'` are immediately marked `status='complete'`, `completedAt=now`, `completedBy=actor`. Concretely two system tasks are always honored: `category='account'` (account created) and `category='paperwork'` with `documentType IS NULL` and a known title `Issue temporary password` (handled by the existing temp-password mechanism). The materializer pattern-matches on these; it does *not* hard-code task titles.

**Progress computation** (`computeOnboardingProgress(checklistId)`):
- `totalRequired = COUNT(tasks WHERE isRequired=true AND status != 'skipped')`.
- `completedRequired = COUNT(tasks WHERE isRequired=true AND status='complete')`.
- `progressPct = totalRequired === 0 ? 100 : floor(completedRequired/totalRequired * 100)`.
- Optional tasks count toward a separate `optionalCompleted` number for display only.

**Completion trigger:** `onboarding_checklists.status` is flipped to `complete` (and `completedAt` set) the moment the last required task transitions to `complete` (or `skipped` with reason). Done by the storage layer in `updateOnboardingTask` so it cannot be missed by callers.

**Skip semantics:** marking a task `status='skipped'` requires `skippedReason`. The task is then treated as satisfied for completion purposes but remains visible in the audit history.

**Document-completing tasks:** tasks with non-null `documentType` are auto-completed the moment a `documents` row with the matching `(employeeId, documentType)` is created. This hook is added to the existing `POST /api/users/:id/documents` route as a post-insert side effect (no contract change to that route).

**Alerts emitted:**
- `onboarding_overdue` — daily detector finds checklists with at least one `pending` `isRequired` task whose `dueDate < today` and the checklist is `in_progress`. Severity `medium`.
- `onboarding_stalled` — checklist has been `in_progress` > 30 days. Severity `medium`.
- `onboarding_no_template`, `onboarding_materialization_failed` — emitted at create time (above).

**Audit:** `audit_logs` rows on every state change with `targetType='onboarding_task'` or `'onboarding_checklist'`, actions `task.complete | task.skip | task.reopen | checklist.start | checklist.complete | checklist.cancel`.

---

## 4. Offboarding workflow

**Trigger:** when `userEmploymentProfiles.terminationDate` transitions from `NULL` to a date, *or* the explicit `POST /api/offboarding/start` route is called. The `PATCH /api/users/:id` and the existing employment-profile updates emit a hook that detects this transition and calls `materializeOffboardingChecklist(employee, terminationDate)`. If a checklist already exists for the employee, the call is a no-op (we never auto-recreate).

**Template selection:** same fallback chain as onboarding (explicit → company default → global default). If no template is found, the checklist is still created with zero tasks and an alert `offboarding_no_template` is emitted.

**Materialization:**
- Creates one `offboarding_checklists` row with `terminationDate` snapshotted from the employee at trigger time.
- For each template task: due date = `terminationDate + dueOffsetDays`. Negative offsets compute to dates before the last day.
- `ownerRole='system'` tasks (e.g., generic "Schedule exit interview email") may be auto-completed at materialization if implemented; the default seed data does not include any.

**Account deactivation gate:** the offboarding workflow *stages* deactivation rather than performing it on `terminationDate` automatically. Specifically:

- `PATCH /api/users/:id` continues to accept `terminationDate` and continues to update the employment profile, but **does not log the user out** and **does not flip any `isActive` flag** on the user record (we don't have one). The user retains login until HR explicitly clicks "Deactivate account."
- "Deactivate account" calls `POST /api/offboarding/:checklistId/deactivate`, which:
  1. Verifies all tasks with `blocksDeactivation=true` are `complete` or `skipped`. If not, returns 409 with the list of blocking tasks.
  2. Sets a new column `users.deactivatedAt timestamp` (added in §2 as part of the offboarding migration). When non-null, the auth middleware in `server/middleware/auth.ts` rejects the session and forces logout. **This adds one new column to `users`, the only `users` extension in Phase 3.**
  3. Stamps `offboarding_checklists.accountDeactivatedAt` and `accountDeactivatedBy`.
  4. Writes an audit row.
- "Reactivate account" (super-admin only) clears `deactivatedAt`.

**`isActive` semantics preserved:** queries that previously relied on `terminationDate IS NULL OR > today` continue to work. Auth additionally checks `deactivatedAt IS NULL`. The two checks are independent so HR can offboard in their own time without locking the employee out prematurely.

**Alerts emitted:**
- `offboarding_overdue` — task past due date and still `pending`.
- `offboarding_blocking_termination` — `terminationDate <= today` AND any `blocksDeactivation` task still `pending`. Severity `high`.

**Audit:** `targetType='offboarding_task' | 'offboarding_checklist' | 'user'` (for the deactivation event), with `action='offboarding.materialize | task.complete | task.skip | account.deactivate | account.reactivate'`.

---

## 5. Missing-document alerts

**Detector:** new function `detectMissingDocuments()` in a new file `server/services/lifecycleAlerts.ts` (so we don't bloat `alerts.ts`). Re-exported from `alerts.ts` so `runAlertDetection()` can call it.

**Algorithm:**
```
for each active employee (terminationDate IS NULL OR > today, deactivatedAt IS NULL):
  scope = { employeeId, departmentId, locationId, companyId } from user record
  rules = active required_document_rules whose scope matches in this precedence:
          employee == employeeId
          OR department == departmentId
          OR location == locationId
          OR company == companyId
          OR scopeType == 'global'
        deduped by documentType, with the most-specific scope winning per documentType
  for each rule:
    grace_until = (employmentProfile.hireDate || createdAt::date) + rule.dueOffsetDays
    if today < grace_until: skip
    if EXISTS(documents WHERE employeeId=… AND documentType=rule.documentType AND status != 'rejected'): skip
    emit alert {
      type: 'missing_document',
      severity: 'high',
      employeeId,
      message: `Missing required document: ${humanLabel(documentType)}`,
      details: { documentType, ruleId, scopeType, dueOffsetDays, hireDate }
    }
```

**Frequency:** added as job type `evaluate-missing-documents`, cadence daily (kept pending by `ensureRecurringEnqueued` similar to `auto-clock-out`).

**Dedupe:** existing `createPolicyAlert` dedupe (`server/services/policyEnforcement.ts:485-`) collapses by `(type, employeeId, message)`. Our message includes `documentType` so different missing types don't collide.

**Resolution:** the existing `POST /api/users/:id/documents` route, on successful upload, calls `resolveMissingDocumentAlertsFor(employeeId, documentType)` which marks any matching open `missing_document` alerts as `resolved` with `resolvedAt=now`. This is the same hook used by onboarding tasks (§3) — both happen in the same post-upload code path.

---

## 6. Expiring-certification alerts

**Detector:** `detectExpiringCertifications()` in `server/services/lifecycleAlerts.ts`.

**Thresholds:** read from the Phase 2 policy resolver under a new policy type key `certifications`. The default rules object (added to `server/policyEngine.ts` as `DEFAULT_CERTIFICATION_RULES`) is:

```ts
export const DEFAULT_CERTIFICATION_RULES = {
  warningThresholdsDays: [60, 30, 7], // warn at each
  expiredAlertEnabled: true,
  expiredReminderEveryDays: 14, // re-emit every two weeks while still expired
};
```

`getDefaultRulesForType("certifications")` is extended to return this. No new policy_type seed migration is required as `policy_types` is data-seeded at boot today; the seeding step adds `certifications` with `module='hr'`.

**Algorithm:**
```
for each certification where status != 'archived' and expirationDate IS NOT NULL:
  resolved = getEffectivePolicy(employee.companyId, employee.id, 'certifications', employee)
  thresholds = resolved?.rules.warningThresholdsDays ?? [60,30,7]
  daysUntil = expirationDate - today
  if daysUntil < 0:
    if expiredAlertEnabled and (no recent open alert OR last >= expiredReminderEveryDays days ago):
      emit { type: 'certification_expired', severity: 'high', ... }
  else for threshold in thresholds (descending):
    if daysUntil <= threshold:
      if no open alert with details.threshold == threshold for this certification:
        emit { type: 'certification_expiring', severity: thresholdSeverity(threshold), ... }
        break  // emit only the most-urgent unfired threshold this run
```

`thresholdSeverity(t)` = `t <= 7 ? 'critical' : t <= 30 ? 'high' : 'medium'`.

**Dedupe:** alert `details` includes `{ certificationId, threshold }`, so the standard `(type, employeeId, message)` dedupe naturally collapses re-emits within a run; the per-threshold guard ("no open alert with this threshold") is enforced inside the detector.

**Resolution:** when a certification's `expirationDate` is updated to a future date (renewal), `PATCH /api/certifications/:id` calls `resolveCertificationAlertsFor(certificationId)`, which marks all open `certification_expiring` and `certification_expired` alerts whose `details.certificationId == this.id` as `resolved`.

**Status sync:** the same detector also updates `certifications.status` (`valid | expiring_soon | expired`) so list views can filter without recomputing.

---

## 7. Auto role assignment

**Engine:** `server/services/roleAssignment.ts` (new file).

**Public entry points:**
- `evaluateRoleForUser(userId): Promise<{ matchedRule: RoleAssignmentRule | null; appliedRole: string | null; manualOverride: boolean }>` — pure function, does not write.
- `applyRoleForUser(userId, options: { actorUserId: string; reason: 'on_create' | 'on_change' | 'manual_reeval'; })` — calls `evaluateRoleForUser`, writes if changed, returns the result.
- `reevaluateAllUsers(actorUserId): Promise<{ evaluated: number; changed: number; skipped: number }>` — bounded loop, per-batch progress.

**Manual-override tracking:** add column `users.roleManuallyOverriddenAt timestamp` (the second and last `users` extension in Phase 3). `PATCH /api/users/:id/role` (the existing manual route) sets this to `now()` on every call. `applyRoleForUser` *does not change the role* if `roleManuallyOverriddenAt` is non-null AND younger than the rule's `updatedAt` for the matched rule. Concretely: a manual override beats every rule until either (a) an admin clears the override on the employee profile, or (b) the matching rule is edited *after* the override timestamp (signaling "the rule has changed; re-evaluate from scratch").

**Evaluation order:**
1. Load all `role_assignment_rules WHERE isActive=true ORDER BY priority ASC, createdAt ASC`.
2. For each rule, evaluate `conditions` against the user's `(users + user_employment_profiles)` row using the DSL in §2.6.
3. First match wins. Ties on `priority` are broken by `createdAt ASC` (older wins, deterministic).
4. If no rule matches, no change is made (we do not "demote to employee" silently).

**When rules run:**
- **On create:** `POST /api/users` calls `applyRoleForUser(newUser.id, { reason: 'on_create' })` after the employment profile is written.
- **On change:** `PATCH /api/users/:id` and any update to `user_employment_profiles` calls `applyRoleForUser(userId, { reason: 'on_change' })`. Manual `PATCH /api/users/:id/role` does *not* trigger re-evaluation.
- **On demand:** `POST /api/role-rules/reevaluate-all` (admin) iterates active employees in batches of 100, calling `applyRoleForUser`. The endpoint is async-style: returns 202 with a job id, work runs through the existing `jobs` table as type `re-evaluate-role-assignments`.

**Audit:** every role change writes `audit_logs` with `targetType='user'`, `action='user.role_change'`, `oldValue={role, manualOverride}`, `newValue={role, ruleId, ruleName}`.

---

## 8. Schedule templates

**Storage:** §2.7 above.

**Apply semantics** (`POST /api/schedule-templates/:id/apply`):
- Body: `{ employeeIds: string[], mode: 'replace' | 'merge' }`.
- For each employee:
  - **`replace`:** delete all existing `employee_schedules` rows for the employee, then insert one row per `schedule_template_days` row where `isWorkDay=true`, all stamped with `scheduleTemplateId`.
  - **`merge`:** for each template day, upsert by `(employeeId, dayOfWeek)` — overwrite the times, set `scheduleTemplateId`. Days the template marks `isWorkDay=false` are *deleted* from the employee's schedule (so a Mon–Fri template applied on top of a 7-day schedule clears Saturday and Sunday). Days the template doesn't mention are left alone.
- Returns `{ updated: string[], failed: { employeeId, reason }[] }`.

**Divergence** (a single day diverging from its template):
- Any write to `employee_schedules` via the existing edit endpoint (already in `server/routes.ts`) sets that row's `scheduleTemplateId = NULL`. The other days of that employee still keep their `scheduleTemplateId`. UI shows a "customized" badge per day.
- An employee can have a mix of `(scheduleTemplateId = X)` for some days and `(scheduleTemplateId = NULL)` for others. There is no single "is this employee on the template" boolean — the template-link badge in the UI is computed as "all 7 days share the same non-null template id."

**Bulk-apply progress:** the apply endpoint runs synchronously for ≤ 50 employees, and falls back to the `jobs` engine (new job type `apply-schedule-template`) for larger batches.

**Audit:** `audit_logs` row per employee per apply, `targetType='employee_schedule'`, `action='schedule.template_applied'`, `newValue={templateId, mode}`.

---

## 9. PTO anniversary adjustments

**New job type:** `apply-pto-anniversary-adjustments`.

**Cadence:** daily, kept pending by `ensureRecurringEnqueued()`.

**Per-employee processing:**
1. Read the resolved PTO policy via `getEffectivePolicy(employee.companyId, employee.id, 'pto', employee)`.
2. The resolved rules MAY contain a new optional field `anniversaryTiers` of the form:
   ```ts
   anniversaryTiers?: Array<{ yearsOfService: number; accrualRate: number; tierLabel?: string }>;
   ```
   If absent, the job is a no-op for that employee. (Phase 3 does **not** invent tier defaults; the field is opt-in per policy.)
3. Compute `effectiveHireDate = employeePtoSettings.hireDate ?? employmentProfile.hireDate`. Skip if missing.
4. If `today` is the employee's anniversary in this calendar year (month + day match), proceed; else skip.
5. `yearsOfService = today.year - effectiveHireDate.year` (calendar-year anniversaries; the standard interpretation).
6. Pick the highest tier with `tier.yearsOfService <= yearsOfService`. If the picked tier's `accrualRate` differs from the previous tier (i.e., the employee just crossed a tier boundary):
   - Insert a `pto_anniversary_adjustments` row with `(employeeId, effectiveDate=today, oldAccrualRate, newAccrualRate, oldTierLabel, newTierLabel, yearsOfService, hoursAdded=newAccrualRate-oldAccrualRate, ptoPolicyId=resolved.policyId)`. The unique constraint on `(employeeId, effectiveDate)` makes this an atomic no-op on retry.
   - Update the current year's `time_off_balances` row for `type='vacation'`: `totalDays += hoursAdded` (we keep `time_off_balances` in days; the conversion is `hoursAdded / 8` rounded to the nearest day, with the residual hours tracked in the adjustment row's `hoursAdded` field for audit).
   - Write an audit row: `targetType='pto_balance'`, `action='pto.anniversary_adjustment'`.

**Idempotency:** the unique `(employeeId, effectiveDate)` constraint guarantees re-runs on the same day cannot double-credit. The job uses `INSERT ... ON CONFLICT DO NOTHING` and only updates `time_off_balances` when the insert actually wrote a row.

**Failure handling:** per-employee try/catch. A single bad row does not abort the job; failures are counted into the job's error string.

---

## 10. Performance review reminders

**New job type:** `evaluate-performance-reviews`.

**Cadence:** daily.

**Per-cycle / per-employee processing:**

For each active `performance_review_cycles` row, scope to employees whose `companyId` matches (or all employees if `companyId IS NULL`), filtered to active employees (`terminationDate IS NULL OR > today`, `deactivatedAt IS NULL`):

- `cadence='annual'`, `anchor='hire_date'`: `dueDate` = next future occurrence of the employee's anniversary.
- `cadence='annual'`, `anchor='calendar_year'`: `dueDate` = December 31 of this year.
- `cadence='semi_annual'`, `anchor='hire_date'`: `dueDate` = next future occurrence of `hireDate ± 6 months`.
- `cadence='semi_annual'`, `anchor='calendar_year'`: `dueDate` = next of `June 30` or `December 31`.
- `cadence='quarterly'`, `anchor='calendar_year'`: `dueDate` = next of Mar 31 / Jun 30 / Sep 30 / Dec 31.
- `cadence='quarterly'`, `anchor='hire_date'`: `dueDate` = next of `hireDate + 3,6,9,12 months` from today.
- `cadence='new_hire_90'`: `dueDate` = `hireDate + 90 days`. Skip if `dueDate < today - 365` (don't backfill ancient hires) or if a row already exists for this `(employeeId, cycleId)`.

For each `(employeeId, cycleId, dueDate)`:
1. `INSERT ... ON CONFLICT DO NOTHING` into `performance_review_reminders`. Unique constraint guarantees idempotency.
2. For each `leadTime` in the cycle's `leadTimes` (e.g., `[14, 7, 0]`): if `dueDate - today == leadTime`, emit alert `review_due` with `severity = leadTime === 0 ? 'high' : 'medium'`, `details = { reminderId, cycleId, dueDate, leadTime }`.

**Resolution:** `PATCH /api/review-reminders/:id` with `{ status: 'completed' }` flips the reminder, writes audit, and resolves all open `review_due` alerts whose `details.reminderId == this.id`.

---

## 11. Job scheduler additions

All new jobs are added to `JobType` in `server/services/jobs.ts:6` and to the `processJob` switch:

| Job type | Cadence | Owner task | Idempotency | Failure handling |
|---|---|---|---|---|
| `evaluate-missing-documents` | daily | HR Compliance Alerts | `createPolicyAlert` dedupe | per-employee try/catch; failures counted in job's `error` string |
| `evaluate-expiring-certifications` | daily | HR Compliance Alerts | per-threshold guard inside detector | as above |
| `apply-pto-anniversary-adjustments` | daily | Recurring HR Reminders | unique `(employeeId, effectiveDate)` | as above |
| `evaluate-performance-reviews` | daily | Recurring HR Reminders | unique `(employeeId, cycleId, dueDate)` | as above |
| `re-evaluate-role-assignments` | on demand | Automation Rules | per-user comparison (no-op if role unchanged) | as above |
| `apply-schedule-template` | on demand for large batches | Automation Rules | per-employee idempotent (replace/merge defined deterministically) | as above |

`ensureRecurringEnqueued()` is extended to keep one pending job of each daily type at a time (mirroring its current `auto-clock-out` behavior). The existing 15-minute drain loop runs them. No new cron infrastructure is introduced.

---

## 12. API surface

All new routes are mounted in `server/routes.ts`, using existing middleware (`requireAuth`, `requireRole`, `requirePermission`). Request/response shapes use Zod validators matching the `createInsertSchema` outputs.

### Onboarding
- `GET /api/onboarding-templates` — admin. List active templates filtered by `?companyId=`.
- `POST /api/onboarding-templates` — admin. Create.
- `PATCH /api/onboarding-templates/:id` — admin.
- `DELETE /api/onboarding-templates/:id` — admin. Soft delete (`isActive=false`).
- `GET /api/onboarding-templates/:id/tasks` — admin.
- `POST /api/onboarding-templates/:id/tasks` — admin.
- `PATCH /api/onboarding-template-tasks/:id` — admin.
- `DELETE /api/onboarding-template-tasks/:id` — admin.
- `GET /api/onboarding-checklists` — admin/manager (scoped). `?status=`, `?employeeId=`.
- `GET /api/onboarding-checklists/:id` — admin/manager (scoped) or the employee themselves.
- `POST /api/employees/:id/start-onboarding` — admin. Body `{ templateId? }`. Returns the new checklist + tasks.
- `PATCH /api/onboarding-tasks/:id` — body `{ status: 'complete' | 'skipped', skippedReason?, notes? }`. Auth: assigned `ownerRole` matches caller, OR HR/admin.
- `POST /api/onboarding-checklists/:id/cancel` — admin. Body `{ reason }`.

### Offboarding
- `GET /api/offboarding-templates`, `POST`, `PATCH`, `DELETE` — same shapes as onboarding.
- `GET /api/offboarding-template-tasks/:templateId`, `POST`, `PATCH`, `DELETE` — same.
- `GET /api/offboarding-checklists` — admin/manager (scoped).
- `GET /api/offboarding-checklists/:id` — admin/manager (scoped). Includes a derived `canDeactivate boolean`.
- `POST /api/offboarding/start` — admin. Body `{ employeeId, terminationDate, templateId? }`. Idempotent: 409 if checklist already exists.
- `PATCH /api/offboarding-tasks/:id` — same shape as onboarding tasks.
- `POST /api/offboarding-checklists/:id/deactivate` — admin. Sets `users.deactivatedAt`. Returns 409 with blocking task list if not allowed.
- `POST /api/users/:id/reactivate` — super-admin. Clears `deactivatedAt`.

### Certifications
- `GET /api/users/:id/certifications` — employee (own), manager/admin (scoped).
- `POST /api/users/:id/certifications` — admin/HR.
- `PATCH /api/certifications/:id` — admin/HR.
- `DELETE /api/certifications/:id` — admin/HR. Soft delete (`status='archived'`).

### Required-document rules
- `GET /api/required-documents` — admin. `?scopeType=`.
- `POST /api/required-documents` — admin.
- `PATCH /api/required-documents/:id` — admin.
- `DELETE /api/required-documents/:id` — admin. Soft delete (`isActive=false`).
- `POST /api/required-documents/evaluate-now` — admin. Synchronously runs `detectMissingDocuments()`, returns counts.

### Auto role assignment
- `GET /api/role-rules` — admin.
- `POST /api/role-rules` — admin.
- `PATCH /api/role-rules/:id` — admin.
- `DELETE /api/role-rules/:id` — admin. Soft delete.
- `POST /api/role-rules/test` — admin. Body `{ ruleId?, conditions?, employeeId }`. Returns `{ matched: boolean, appliedRole: string | null }` without writing.
- `POST /api/role-rules/reevaluate-all` — admin. Returns `{ jobId }`.
- `POST /api/users/:id/clear-role-override` — admin. Sets `roleManuallyOverriddenAt = NULL`.

### Schedule templates
- `GET /api/schedule-templates` — admin/manager.
- `POST /api/schedule-templates` — admin.
- `PATCH /api/schedule-templates/:id` — admin.
- `DELETE /api/schedule-templates/:id` — admin. Soft delete (`isActive=false`); existing employee schedules retain their `scheduleTemplateId` even after the template is archived (read-side joins handle nulls and flag "template archived").
- `GET /api/schedule-templates/:id/days`, `PUT /api/schedule-templates/:id/days` — admin.
- `POST /api/schedule-templates/:id/apply` — admin. Body `{ employeeIds: string[], mode: 'replace' | 'merge' }`.

### Performance review cycles
- `GET /api/review-cycles` — admin. `?companyId=`.
- `POST /api/review-cycles` — admin.
- `PATCH /api/review-cycles/:id` — admin.
- `DELETE /api/review-cycles/:id` — admin. Soft delete.
- `GET /api/review-reminders` — admin/manager (scoped). `?employeeId=`, `?status=`.
- `PATCH /api/review-reminders/:id` — admin/manager (scoped). Body `{ status: 'completed' | 'skipped', notes? }`.

### Read-only
- `GET /api/users/:id/pto-anniversary-adjustments` — admin/HR or the employee themselves.

---

## 13. Storage interface additions

Add to `IStorage` in `server/storage.ts:103-346`. Method signatures use the types defined in §2.

```ts
// Onboarding templates
getOnboardingTemplate(id: string): Promise<OnboardingTemplate | undefined>;
getOnboardingTemplates(filters: { companyId?: string | null; isActive?: boolean }): Promise<OnboardingTemplate[]>;
getDefaultOnboardingTemplate(companyId: string | null): Promise<OnboardingTemplate | undefined>;
createOnboardingTemplate(data: InsertOnboardingTemplate): Promise<OnboardingTemplate>;
updateOnboardingTemplate(id: string, data: Partial<InsertOnboardingTemplate>): Promise<OnboardingTemplate | undefined>;
getOnboardingTemplateTasks(templateId: string): Promise<OnboardingTemplateTask[]>;
createOnboardingTemplateTask(data: InsertOnboardingTemplateTask): Promise<OnboardingTemplateTask>;
updateOnboardingTemplateTask(id: string, data: Partial<InsertOnboardingTemplateTask>): Promise<OnboardingTemplateTask | undefined>;
deleteOnboardingTemplateTask(id: string): Promise<void>;

// Onboarding instances
getOnboardingChecklist(id: string): Promise<OnboardingChecklist | undefined>;
getOnboardingChecklistByEmployee(employeeId: string): Promise<OnboardingChecklist | undefined>;
listOnboardingChecklists(filters: { status?: string; employeeIds?: string[] }): Promise<OnboardingChecklist[]>;
materializeOnboardingChecklist(args: { employeeId: string; templateId: string; actorUserId: string; hireDate: string | null }): Promise<{ checklist: OnboardingChecklist; tasks: OnboardingTask[] }>;
getOnboardingTasks(checklistId: string): Promise<OnboardingTask[]>;
updateOnboardingTask(id: string, data: { status?: string; skippedReason?: string; completedBy?: string; documentId?: string }): Promise<OnboardingTask | undefined>;
cancelOnboardingChecklist(id: string, reason: string, actorUserId: string): Promise<void>;
computeOnboardingProgress(checklistId: string): Promise<{ progressPct: number; completedRequired: number; totalRequired: number; optionalCompleted: number; optionalTotal: number }>;

// Offboarding templates + instances — mirror of onboarding signatures
// (omitted here for brevity; identical pattern)

// Certifications
getCertification(id: string): Promise<Certification | undefined>;
getCertificationsByEmployee(employeeId: string): Promise<Certification[]>;
listCertifications(filters: { status?: string; expiringWithinDays?: number }): Promise<Certification[]>;
createCertification(data: InsertCertification): Promise<Certification>;
updateCertification(id: string, data: Partial<InsertCertification>): Promise<Certification | undefined>;
archiveCertification(id: string): Promise<void>;
recomputeCertificationStatus(id: string): Promise<Certification | undefined>;

// Required-document rules
getRequiredDocumentRules(filters: { scopeType?: string; isActive?: boolean }): Promise<RequiredDocumentRule[]>;
createRequiredDocumentRule(data: InsertRequiredDocumentRule): Promise<RequiredDocumentRule>;
updateRequiredDocumentRule(id: string, data: Partial<InsertRequiredDocumentRule>): Promise<RequiredDocumentRule | undefined>;
deleteRequiredDocumentRule(id: string): Promise<void>;
resolveMissingDocumentAlertsFor(employeeId: string, documentType: string): Promise<number>;

// Role-assignment rules
getRoleAssignmentRules(filters: { isActive?: boolean }): Promise<RoleAssignmentRule[]>;
createRoleAssignmentRule(data: InsertRoleAssignmentRule): Promise<RoleAssignmentRule>;
updateRoleAssignmentRule(id: string, data: Partial<InsertRoleAssignmentRule>): Promise<RoleAssignmentRule | undefined>;
deleteRoleAssignmentRule(id: string): Promise<void>;
clearUserRoleOverride(userId: string): Promise<void>;

// Schedule templates
getScheduleTemplate(id: string): Promise<ScheduleTemplate | undefined>;
getScheduleTemplates(filters: { companyId?: string | null; isActive?: boolean }): Promise<ScheduleTemplate[]>;
createScheduleTemplate(data: InsertScheduleTemplate): Promise<ScheduleTemplate>;
updateScheduleTemplate(id: string, data: Partial<InsertScheduleTemplate>): Promise<ScheduleTemplate | undefined>;
getScheduleTemplateDays(templateId: string): Promise<ScheduleTemplateDay[]>;
setScheduleTemplateDays(templateId: string, days: InsertScheduleTemplateDay[]): Promise<void>;
applyScheduleTemplate(templateId: string, employeeIds: string[], mode: 'replace' | 'merge', actorUserId: string): Promise<{ updated: string[]; failed: { employeeId: string; reason: string }[] }>;

// Performance review cycles + reminders
getReviewCycles(filters: { companyId?: string | null; isActive?: boolean }): Promise<PerformanceReviewCycle[]>;
createReviewCycle(data: InsertPerformanceReviewCycle): Promise<PerformanceReviewCycle>;
updateReviewCycle(id: string, data: Partial<InsertPerformanceReviewCycle>): Promise<PerformanceReviewCycle | undefined>;
listReviewReminders(filters: { employeeId?: string; status?: string }): Promise<PerformanceReviewReminder[]>;
upsertReviewReminder(data: InsertPerformanceReviewReminder): Promise<PerformanceReviewReminder>;
updateReviewReminder(id: string, data: { status: string; completedBy?: string; notes?: string }): Promise<PerformanceReviewReminder | undefined>;

// PTO anniversary adjustments
listPtoAnniversaryAdjustments(employeeId: string): Promise<PtoAnniversaryAdjustment[]>;
recordPtoAnniversaryAdjustment(data: InsertPtoAnniversaryAdjustment): Promise<PtoAnniversaryAdjustment | undefined>;
```

The `recordPtoAnniversaryAdjustment` storage method is the only place that writes to `pto_anniversary_adjustments`; it returns `undefined` on `ON CONFLICT DO NOTHING` so the caller knows whether to update `time_off_balances`.

---

## 14. RBAC and audit

**RBAC for configuration screens** (Rules & Controls sub-sections):

| Resource | View | Edit |
|---|---|---|
| Onboarding templates | `admin` | `admin` |
| Offboarding templates | `admin` | `admin` |
| Required-document rules | `admin` | `admin` |
| Role-assignment rules | `admin` | `admin` |
| Schedule templates | `admin`, `manager` (read-only) | `admin` |
| Review cycles | `admin` | `admin` |

**RBAC for instances:**

| Resource | View | Edit |
|---|---|---|
| Onboarding checklist (own) | `employee` (own) | `employee` (own) for `ownerRole='new_hire'` tasks |
| Onboarding checklist (others) | `manager`/`admin` scoped | `admin` (HR-owned tasks); `manager` for direct reports' status changes |
| Offboarding checklist | `admin`, `manager` for direct reports (read-only) | `admin` only |
| Account deactivation | `admin` | `admin` (gated by `blocksDeactivation`) |
| Account reactivation | `super-admin` | `super-admin` |
| Certifications (own) | `employee` (own) | read-only |
| Certifications (others) | `admin`, `manager` for direct reports | `admin` only |
| Performance review reminder | `admin`, the assigned reviewer (manager) | `admin`, the assigned reviewer |
| PTO anniversary history (own) | `employee` (own) | read-only (system-written) |

**Audit:** every state-changing route writes one `audit_logs` row via `writeAuditLog`. Specific actions:

- `onboarding.template.create | update | delete | task.create | update | delete`
- `onboarding.checklist.materialize | cancel | complete`
- `onboarding.task.complete | skip | reopen`
- `offboarding.template.*` (mirror of onboarding)
- `offboarding.checklist.materialize | task.complete | task.skip`
- `user.account.deactivate | account.reactivate`
- `certification.create | update | archive | renew`
- `required_document_rule.create | update | delete`
- `role_assignment_rule.create | update | delete`
- `user.role_change` (existing action; new `context` field includes `{ source: 'rule' | 'manual', ruleId? }`)
- `schedule_template.create | update | delete | apply`
- `review_cycle.create | update | delete`
- `review_reminder.complete | skip`
- `pto.anniversary_adjustment`

---

## 15. File-level boundaries between implementation tasks

The four downstream implementation tasks must be runnable in parallel without merge conflicts. The table below assigns ownership at the file level. A task **owns** a file when it is the only task that may add or modify code in that file; a task **shares** a file when it appends-only to a clearly delimited region (such as adding a new switch case or appending a new route block).

| File | Lifecycle Wizards | HR Compliance Alerts | Automation Rules | Recurring HR Reminders |
|---|---|---|---|---|
| `shared/schema.ts` (or `shared/models/lifecycle.ts` re-exports) | adds onboarding/offboarding tables + `users.deactivatedAt` + `employee_schedules.scheduleTemplateId` is **not** owned here | adds `certifications` + `required_document_rules` | adds `role_assignment_rules` + `schedule_templates` + `schedule_template_days` + `users.roleManuallyOverriddenAt` + `employee_schedules.scheduleTemplateId` extension | adds `pto_anniversary_adjustments` + `performance_review_cycles` + `performance_review_reminders` |
| `server/storage.ts` | onboarding/offboarding methods + `users.deactivatedAt` setters | certifications + required-doc methods | role-rule + schedule-template methods + `clearUserRoleOverride` | review-cycle/reminder + pto-anniversary methods |
| `server/routes.ts` | `/api/onboarding/*`, `/api/offboarding/*`, `/api/employees/:id/start-onboarding`, `/api/users/:id/reactivate` | `/api/certifications/*`, `/api/required-documents/*`, `/api/users/:id/certifications` | `/api/role-rules/*`, `/api/schedule-templates/*`, `/api/users/:id/clear-role-override` | `/api/review-cycles/*`, `/api/review-reminders/*`, `/api/users/:id/pto-anniversary-adjustments` |
| `server/services/jobs.ts` | append `apply-schedule-template`? **No** — owned by Automation Rules | append `evaluate-missing-documents`, `evaluate-expiring-certifications` to `JobType` + `processJob` switch | append `re-evaluate-role-assignments`, `apply-schedule-template` | append `apply-pto-anniversary-adjustments`, `evaluate-performance-reviews` |
| `server/services/alerts.ts` | adds onboarding-related detector exports | adds `missing_document`, `certification_expiring`, `certification_expired` detectors via re-export from new `lifecycleAlerts.ts` | — | adds `review_due` detector via re-export from new file |
| `server/services/lifecycleAlerts.ts` (new) | onboarding/offboarding detectors (`detectOnboardingOverdue`, `detectOffboardingOverdue`, `detectOffboardingBlockingTermination`) | `detectMissingDocuments`, `detectExpiringCertifications` | — | `detectPerformanceReviewsDue` |
| `server/services/onboarding.ts` (new) | **owned** | — | — | — |
| `server/services/offboarding.ts` (new) | **owned** | — | — | — |
| `server/services/certifications.ts` (new) | — | **owned** | — | — |
| `server/services/requiredDocuments.ts` (new) | — | **owned** | — | — |
| `server/services/roleAssignment.ts` (new) | — | — | **owned** | — |
| `server/services/scheduleTemplates.ts` (new) | — | — | **owned** | — |
| `server/services/ptoAnniversary.ts` (new) | — | — | — | **owned** |
| `server/services/performanceReviews.ts` (new) | — | — | — | **owned** |
| `server/policyEngine.ts` | — | adds `DEFAULT_CERTIFICATION_RULES` + `'certifications'` case in `getDefaultRulesForType` | — | adds `'review'` case if any rules become configurable; otherwise no edits |
| `server/middleware/auth.ts` | adds the `users.deactivatedAt` rejection branch | — | — | — |
| `client/src/pages/employees.tsx` | adds "Onboarding" and "Offboarding" tabs to the employee detail drawer | adds Certifications filter to the employees list | adds "Set role from rule" indicator and "Clear override" action; adds template indicator badge to the Schedule tab | — |
| `client/src/pages/profile.tsx` | — | adds "Certifications" section + PTO anniversary history block? **No** — anniversary block owned by Recurring HR Reminders | — | adds PTO anniversary history block |
| `client/src/pages/rules-controls.tsx` | adds "Onboarding Templates" + "Offboarding Templates" sub-sections | adds "Required Documents" sub-section | adds "Auto Role Assignment" + "Schedule Templates" sub-sections | adds "Review Cycles" sub-section |
| `client/src/pages/alerts.tsx` | adds `onboarding_overdue`, `onboarding_stalled`, `offboarding_overdue`, `offboarding_blocking_termination` to label/severity maps | adds `missing_document`, `certification_expiring`, `certification_expired` | — | adds `review_due` |
| `client/src/pages/pto-leave.tsx` | — | — | — | adds anniversary adjustments read-only history view (linked from profile page block) |
| `client/src/components/onboarding-wizard/*` (new) | **owned** | — | — | — |
| `client/src/components/offboarding-drawer/*` (new) | **owned** | — | — | — |
| `client/src/components/certifications/*` (new) | — | **owned** | — | — |
| `client/src/components/required-documents/*` (new) | — | **owned** | — | — |
| `client/src/components/role-rules/*` (new) | — | — | **owned** | — |
| `client/src/components/schedule-templates/*` (new) | — | — | **owned** | — |
| `client/src/components/review-cycles/*` (new) | — | — | — | **owned** |

**Shared-file rules of engagement:**

- `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, `server/services/jobs.ts`, `server/services/alerts.ts`, `client/src/pages/employees.tsx`, `client/src/pages/rules-controls.tsx`, `client/src/pages/alerts.tsx` — multiple tasks add to these files. Each task **only appends** in its own clearly named region. Tasks that need to add a `JobType` value or alert label add it on its own line in alphabetical order; conflicts resolve by taking both lines.
- The `users.deactivatedAt`, `users.roleManuallyOverriddenAt`, and `employee_schedules.scheduleTemplateId` columns each have a single owning task (Wizards, Automation Rules, Automation Rules respectively). The other tasks may *read* those columns but must not add or remove them.
- No task touches `package.json`, `vite.config.ts`, `server/vite.ts`, or `drizzle.config.ts`.

This boundary table is normative: if implementers find they need to cross a boundary, they must come back and update this spec first.
