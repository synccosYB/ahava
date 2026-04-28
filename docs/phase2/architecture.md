# Rules Command Center — Technical Architecture Spec (Phase 2)

> Companion document: [`docs/phase2/ui-ux.md`](./ui-ux.md). Every API and engine documented here maps to a screen described there; cross-references are inline.

This spec governs implementation Task #86. It describes precisely what is added, what is reused, and what stays unchanged. Implementation must follow this document exactly. If anything needs to change once code starts, pause, update this doc, get re-approval, then resume.

---

## 1. Current state baseline

This section locks down what already exists today so the rest of the spec is unambiguous about "added" vs "preserved."

### 1.1 Existing tables (`shared/schema.ts`)

- **`policies`** (lines 133–151): `id`, `companyId` (nullable FK → `companies.id`), `policyTypeId` (FK → `policy_types.id`, NOT NULL), `name` (varchar 200), `description` (text), `status` (varchar 20, default `"draft"` — values used today: `draft`, `active`, `archived`), `version` (integer, default 1), `createdAt`, `updatedAt`.
- **`policy_rules`** (lines 153–167): `id`, `policyId` (FK → `policies.id`, NOT NULL), `rules` (jsonb, NOT NULL), `createdAt`, `updatedAt`. There is exactly one rules row per policy in practice (`storage.upsertPolicyRules` overwrites it).
- **`policy_assignments`** (lines 169–184): `id`, `policyId` (FK), `companyId` (nullable), `locationId` (nullable), `departmentId` (nullable), `userId` (nullable), `createdAt`. The four scope columns are mutually exclusive in practice (the level is whichever is non-null).
- **`policy_types`** (in `shared/models/auth.ts`, exported through `shared/schema.ts`): seeded with the keys `attendance`, `pto`, `payroll`, `approvals`, `alerts`, `kiosk`. The Wizard at `client/src/components/policy-wizard.tsx` only renders rule fields for the first four; `alerts` and `kiosk` exist but are configured today via dedicated panels in `client/src/pages/rules-controls.tsx` (`AlertsSection`, `KioskSection`).
- **`audit_logs`** (lines 272–291): `actorUserId` (FK), `targetType`, `targetId`, `action`, `oldValue` (jsonb), `newValue` (jsonb), `context` (jsonb), `ipAddress`, `userAgent`, `createdAt`. `server/routes.ts` writes via the helper `writeAuditLog(...)` with `getAuditContext(req)`.

**No existing tables called `policy_versions`, `holiday_calendars`, or `blackout_dates` exist.** Today, holidays and blackout date lists are stored as inline arrays inside the `rules` jsonb of the relevant policy (see `DEFAULT_PTO_RULES.blackoutDates` in `server/policyEngine.ts`).

### 1.2 Existing resolver (`server/policyEngine.ts`)

`getEffectivePolicy(companyId, userId, policyTypeKey, user?)` resolves the active policy for one user as follows (lines 21–127):

1. Loads the `policy_type` row by key. If missing → returns `null`.
2. Loads every `(assignment, policy)` pair where `policy.policyTypeId = type.id` AND `policy.status = 'active'`.
3. Walks the precedence ladder, returning the first match:
   1. **Employee** — `assignment.userId === userId`.
   2. **Department** — `assignment.departmentId === user.departmentId` AND `userId` is null.
   3. **Location** — `assignment.locationId === user.locationId` AND department/user are null.
   4. **Division (company)** — `assignment.companyId === companyId` AND location/department/user are null.
   5. **Global** — all four scope columns null.
4. Loads the latest `policy_rules` row for that policy and returns `{ policyId, policyName, policyTypeKey, assignmentLevel, rules }`.

If nothing matches, returns `null` and callers fall back to `DEFAULT_*_RULES`.

### 1.3 Existing defaults (`server/policyEngine.ts` lines 129–233)

`DEFAULT_ATTENDANCE_RULES`, `DEFAULT_PTO_RULES`, `DEFAULT_PAYROLL_RULES`, `DEFAULT_APPROVALS_RULES`, `DEFAULT_ALERTS_RULES`, `DEFAULT_KIOSK_RULES`, plus the dispatcher `getDefaultRulesForType(key)`. These shapes are the contract the enforcement layer relies on and **must remain field-for-field stable** across this work.

### 1.4 Existing enforcement (`server/services/policyEnforcement.ts`)

- `enforceClockIn(user, now, rules, policyName?)` — grace period, early window, rounding, late detection, alerts.
- `enforceClockOut(clockInTime, now, breakMinutes, rules, payrollRules, user, policyName?)` — rounding, OT/double-OT, break violation alert.
- `evaluateEarlyArrivalBonuses(...)`, `evaluateDayOfWeekBonuses(...)` — pay bonus rules.
- `enforcePtoAdvanceNotice(startDate, rules)`, `enforcePtoBlackoutDates(startDate, endDate, rules)` — PTO gates.
- `runAutoClockOut()` — sweep job already scheduled by `server/services/jobs.ts`.

These functions all consume `rules: Record<string, any>` shaped exactly like the `DEFAULT_*_RULES` objects; they don't know or care where the rules came from. **They will not change in this work.** The Command Center is responsible for handing them the same shapes through the same `getEffectivePolicy` contract.

### 1.5 Existing routes (`server/routes.ts:2893–3163`, `:3980+`)

Routes that stay (see §11 for coexistence):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/audit-logs` | Recent audit logs (admin) |
| GET | `/api/audit-logs/filtered` | Filtered audit logs (admin) |
| GET | `/api/policy-types` | List policy types |
| GET | `/api/policies` | List policies (optional `?companyId=`) |
| GET | `/api/policies/:id` | Single policy w/ rules + assignments |
| POST | `/api/policies` | Create policy |
| PATCH | `/api/policies/:id` | Update policy fields |
| POST | `/api/policies/:id/activate` | Set status → active |
| POST | `/api/policies/:id/archive` | Set status → archived |
| GET | `/api/policies/:id/rules` | Get rules jsonb |
| PUT | `/api/policies/:id/rules` | Upsert rules jsonb |
| GET | `/api/policy-assignments` | List (optional `?policyId=`) |
| POST | `/api/policy-assignments` | Create assignment |
| PATCH | `/api/policy-assignments/:id` | Update assignment |
| DELETE | `/api/policy-assignments/:id` | Delete assignment |
| GET | `/api/effective-policy` | Resolve effective policy for a user |

All admin routes are guarded by `requireAuth` + `requireRole("admin")` and most write paths log via `writeAuditLog` + `getAuditContext(req)`.

### 1.6 What stays **unchanged**

- Every `DEFAULT_*_RULES` shape and the `getDefaultRulesForType(key)` contract.
- Every signature in `server/services/policyEnforcement.ts`.
- The `policies`, `policy_rules`, `policy_assignments`, `policy_types`, `audit_logs` tables (only **added** columns; never renamed or dropped).
- The legacy `/api/policies/*` and `/api/policy-assignments/*` routes (they continue to work for backward compatibility, see §11).
- The Wizard at `client/src/components/policy-wizard.tsx` (it remains on disk and exported, but the new Command Center category detail view replaces it as the primary editor for the listed categories — see UI-UX spec §4 "Page B").
- The Visual Workflow Builder (`client/src/components/workflow-builder.tsx`, table `workflows`). Workflows are *not* one of the 13 rule categories and stay where they are.

---

## 2. Schema expansion

All additions follow the project convention: edits to `shared/schema.ts` plus a new SQL migration under `migrations/0018_*.sql`. **Do not run `drizzle-kit push`** — see `replit.md` "DB column sync" — emit `ALTER TABLE … ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` statements explicitly.

### 2.1 New table: `policy_versions`

Stores an immutable snapshot of the rules at every publish, schedule, activation, or rollback event.

```ts
// shared/schema.ts
export const policyVersions = pgTable("policy_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  policyId: varchar("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  rules: jsonb("rules").notNull(),
  note: text("note"),
  isRollback: boolean("is_rollback").default(false).notNull(),
  rolledBackFromVersion: integer("rolled_back_from_version"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | varchar (uuid) | no | `gen_random_uuid()` | PK |
| `policy_id` | varchar | no | — | FK → `policies.id`, ON DELETE CASCADE |
| `version_number` | integer | no | — | Monotonically increasing per policy |
| `rules` | jsonb | no | — | Full snapshot of the rules at this version |
| `note` | text | yes | — | Free-form note, also used for rollback reason |
| `is_rollback` | boolean | no | `false` | True if this version was created by a rollback |
| `rolled_back_from_version` | integer | yes | — | If `is_rollback`, the version number that was copied |
| `created_by` | varchar | no | — | FK → `users.id` |
| `created_at` | timestamp | no | `now()` | |

Indexes:
- `UNIQUE (policy_id, version_number)` — enforced via `CREATE UNIQUE INDEX policy_versions_policy_version_uidx`.
- `INDEX (policy_id, created_at DESC)` — for History List queries (UI-UX §6).

### 2.2 Added columns on `policies`

```ts
effectiveAt:    timestamp("effective_at"),                 // nullable
effectiveUntil: timestamp("effective_until"),              // nullable
publishedAt:    timestamp("published_at"),                 // nullable
publishedBy:    varchar("published_by").references(() => users.id), // nullable
```

| Column | Type | Null | Default | Semantics |
|--------|------|------|---------|-----------|
| `effective_at` | timestamp | yes | — | When `status='active'`, this policy only resolves at/after this instant. NULL on an active policy means "active immediately, no scheduled start" (back-compat). |
| `effective_until` | timestamp | yes | — | When set, the policy stops resolving at this instant. NULL = open-ended. |
| `published_at` | timestamp | yes | — | Set the moment a draft is published or scheduled. |
| `published_by` | varchar | yes | — | User who published. |

**Backfill** (in the same migration): for every existing row where `status='active'` and `effective_at IS NULL`, leave `effective_at` NULL — the resolver treats NULL as "in window" (see §3.1). No data movement required.

### 2.3 Added columns on `policy_assignments`

```ts
priority:           integer("priority").default(0).notNull(),
isEmergency:        boolean("is_emergency").default(false).notNull(),
emergencyReason:    text("emergency_reason"),
emergencyStartsAt:  timestamp("emergency_starts_at"),
emergencyEndsAt:    timestamp("emergency_ends_at"),
createdBy:          varchar("created_by").references(() => users.id),
```

| Column | Type | Null | Default | Semantics |
|--------|------|------|---------|-----------|
| `priority` | integer | no | `0` | Tie-breaker among same-level assignments. Higher wins. |
| `is_emergency` | boolean | no | `false` | If true, this assignment outranks the normal hierarchy while in window. |
| `emergency_reason` | text | yes | — | Required at create time when `is_emergency=true`. |
| `emergency_starts_at` | timestamp | yes | — | Required when `is_emergency=true`. |
| `emergency_ends_at` | timestamp | yes | — | Required when `is_emergency=true`; the resolver auto-ignores past this. |
| `created_by` | varchar | yes | — | FK → `users.id`. Audit of who created the assignment. |

Backfill: existing rows get `priority=0`, `is_emergency=false`, others NULL. No data movement required.

### 2.4 New table: `holiday_calendars`

A calendar is a named bag of dated entries scoped to a division (company). Multiple PTO/payroll policies can reference the same calendar by id.

```ts
export const holidayCalendars = pgTable("holiday_calendars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),  // null = global
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const holidayCalendarEntries = pgTable("holiday_calendar_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  calendarId: varchar("calendar_id").notNull().references(() => holidayCalendars.id, { onDelete: "cascade" }),
  entryDate: date("entry_date").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  recurrence: varchar("recurrence", { length: 20 }).default("none").notNull(), // none | yearly
  isPaid: boolean("is_paid").default(true).notNull(),
});
```

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `holiday_calendars.id` | varchar | no | uuid | PK |
| `holiday_calendars.company_id` | varchar | yes | — | FK → `companies.id`. NULL = applies to all divisions. |
| `holiday_calendars.name` | varchar(200) | no | — | |
| `holiday_calendar_entries.calendar_id` | varchar | no | — | FK, ON DELETE CASCADE |
| `holiday_calendar_entries.entry_date` | date | no | — | Concrete calendar date |
| `holiday_calendar_entries.recurrence` | varchar(20) | no | `'none'` | `none` or `yearly` (yearly recurrence reuses the month/day, ignores year) |
| `holiday_calendar_entries.is_paid` | boolean | no | `true` | Affects holiday pay enforcement |

Indexes: `INDEX (company_id, name)`, `INDEX (calendar_id, entry_date)`.

PTO/payroll policy `rules` jsonb gains an optional `holidayCalendarIds: string[]` field. When present, the enforcement layer expands those calendars to a date set (already done by `enforcePtoBlackoutDates`'s shape — same string-array contract). The defaults stay empty arrays so existing enforcement keeps working without touching `policyEnforcement.ts`.

### 2.5 New table: `blackout_dates`

Structured replacement for the inline `blackoutDates: string[]` array in PTO rules. PTO policy `rules` jsonb gains `blackoutListIds: string[]`; the resolver helper `expandBlackoutDates(policyRules)` (added to `server/policyEngine.ts`) merges any inline `blackoutDates` (legacy) with the union of dates from those lists, returning a flat `string[]` so `enforcePtoBlackoutDates` works unchanged.

```ts
export const blackoutDateLists = pgTable("blackout_date_lists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: varchar("name", { length: 200 }).notNull(),
  reason: text("reason"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blackoutDateRanges = pgTable("blackout_date_ranges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  listId: varchar("list_id").notNull().references(() => blackoutDateLists.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  label: varchar("label", { length: 200 }),
});
```

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `blackout_date_lists.id` | varchar | no | uuid | PK |
| `blackout_date_lists.company_id` | varchar | yes | — | FK |
| `blackout_date_lists.name` | varchar(200) | no | — | |
| `blackout_date_ranges.list_id` | varchar | no | — | FK, CASCADE |
| `blackout_date_ranges.start_date` | date | no | — | Inclusive |
| `blackout_date_ranges.end_date` | date | no | — | Inclusive |

Indexes: `INDEX (company_id)`, `INDEX (list_id, start_date)`.

### 2.6 Migration order

One migration file: `migrations/0018_rules_command_center.sql`. Run order inside the file:

1. `CREATE TABLE IF NOT EXISTS policy_versions ...`
2. `CREATE UNIQUE INDEX IF NOT EXISTS policy_versions_policy_version_uidx ...`
3. `CREATE INDEX IF NOT EXISTS policy_versions_policy_created_idx ...`
4. `ALTER TABLE policies ADD COLUMN IF NOT EXISTS effective_at timestamp;` (and the other 3 columns in §2.2)
5. `ALTER TABLE policy_assignments ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;` (and the other 5 columns in §2.3)
6. `CREATE TABLE IF NOT EXISTS holiday_calendars ...`, then `holiday_calendar_entries ...`, then indexes.
7. `CREATE TABLE IF NOT EXISTS blackout_date_lists ...`, then `blackout_date_ranges ...`, then indexes.
8. **Backfill**: `INSERT INTO policy_versions (policy_id, version_number, rules, note, created_by, created_at) SELECT pr.policy_id, 1, pr.rules, 'Initial snapshot from migration', (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1), now() FROM policy_rules pr WHERE NOT EXISTS (SELECT 1 FROM policy_versions pv WHERE pv.policy_id = pr.policy_id);` — every existing policy gets a v1 row so the History tab is never empty.

If no admin user exists at migration time (cold install), the backfill in step 8 is a no-op; new policies will create their v1 row through the normal publish path.

### 2.7 Drizzle exports

In addition to the table consts, `shared/schema.ts` exports:

```ts
export const insertPolicyVersionSchema = createInsertSchema(policyVersions).omit({ id: true, createdAt: true });
export type InsertPolicyVersion = z.infer<typeof insertPolicyVersionSchema>;
export type PolicyVersion = typeof policyVersions.$inferSelect;

export const insertHolidayCalendarSchema = createInsertSchema(holidayCalendars).omit({ id: true, createdAt: true, updatedAt: true });
export type HolidayCalendar = typeof holidayCalendars.$inferSelect;
export type InsertHolidayCalendar = z.infer<typeof insertHolidayCalendarSchema>;
// (and entries, blackoutDateLists, blackoutDateRanges)
```

---

## 3. Resolver precedence updates

### 3.1 Effective-window filter

`getEffectivePolicy(companyId, userId, policyTypeKey, user?, atTimestamp = new Date())` is extended:

1. The base SQL query gains two predicates:
   - `(policies.effective_at IS NULL OR policies.effective_at <= atTimestamp)`
   - `(policies.effective_until IS NULL OR policies.effective_until > atTimestamp)`
2. `policies.status = 'active'` stays.
3. The result set is the candidate pool for the precedence ladder.

### 3.2 Emergency-first precedence

Before walking the existing employee → department → location → division → global ladder, the resolver runs an **emergency pass** on the same candidate pool:

```
emergency_pool = candidates where assignment.is_emergency = true
                                  AND (emergency_starts_at IS NULL OR emergency_starts_at <= atTimestamp)
                                  AND (emergency_ends_at   IS NOT NULL AND emergency_ends_at > atTimestamp)
                                  AND the assignment scope still matches the user (employee/dept/loc/div/global)
```

If the emergency pool is non-empty, pick the highest-precedence emergency match using the **same** ladder and tie-break on `priority` then `created_at DESC`. Return immediately.

If the emergency pool is empty, fall through to the existing precedence ladder, also tie-broken by `priority` then `created_at DESC` within a level.

`emergency_ends_at` is required at create time (see §2.3) so the resolver never has to guess. An expired emergency is silently ignored — the sweep job in §4.3 handles the audit/expire entry.

### 3.3 Return shape

```ts
interface EffectivePolicy {
  policyId: string;
  policyName: string;
  policyTypeKey: string;
  assignmentLevel: "global" | "division" | "location" | "department" | "employee";
  assignmentId: string;          // NEW — which assignment row matched
  isEmergency: boolean;          // NEW — true if matched via emergency pass
  versionNumber: number;         // NEW — the policy_versions row that produced these rules
  rules: Record<string, any>;
}
```

Existing callers that read only `rules`, `policyName`, and `assignmentLevel` are unaffected. The three new fields are optional from the consumer's perspective until the Simulator (Page C) and Conflict engine (§6) need them.

### 3.4 `simulateEffectivePolicy`

```ts
export async function simulateEffectivePolicy(args: {
  userId: string;
  policyTypeKey: string;
  atTimestamp: Date;
}): Promise<{
  resolved: EffectivePolicy | null;
  defaults: Record<string, any>;     // returned even on null so the UI can show the fallback
  resolutionTrace: ResolutionTraceStep[]; // see §3.5
}>
```

Pseudo-code:

```
user = storage.getUser(userId)
candidates = allActiveAssignmentsForType(policyTypeKey, atTimestamp)
trace = []
for each level in [employee, department, location, division, global]:
  for each candidate at that level matching user (filtered by emergency pass first):
    trace.push({ level, isEmergency, assignmentId, policyId, policyName, matched: true|false, reason })
resolved = first match per §3.1–§3.2
return { resolved, defaults: getDefaultRulesForType(policyTypeKey), resolutionTrace: trace }
```

### 3.5 ResolutionTraceStep shape

```ts
interface ResolutionTraceStep {
  level: "global" | "division" | "location" | "department" | "employee";
  pass: "emergency" | "standard";
  assignmentId: string;
  policyId: string;
  policyName: string;
  matched: boolean;
  rejected?: "scope-mismatch" | "outside-effective-window" | "expired-emergency" | "not-active";
  effectiveAt?: string | null;
  effectiveUntil?: string | null;
  emergencyEndsAt?: string | null;
}
```

Used by Simulator Lab (UI-UX §5) to render the resolution chain.

---

## 4. Scheduling engine

### 4.1 Lifecycle states

Three operational states that build on the existing `policies.status` column without renaming any value:

| State | `status` | `effective_at` | Behavior |
|-------|----------|---------------|----------|
| Draft | `draft` | NULL or any future | Editable, never resolved |
| Scheduled | `active` | `> now()` | Visible in resolver only after `effective_at` |
| Live | `active` | NULL or `<= now()` | Resolvable now (existing behavior) |
| Ended | `active` | any | `effective_until <= now()` → resolver ignores it; Sweep job in §4.3 archives it |
| Archived | `archived` | any | Not resolvable; kept for history |

A draft becomes live by writing `status='active'` + setting `effective_at`. There is no separate "scheduled" status — the resolver's window filter (§3.1) handles the difference.

### 4.2 Lazy resolution at read time

Because the resolver already filters by `effective_at <= now()`, **no cron is required for activations to take effect.** A scheduled policy automatically starts resolving at the moment of its `effective_at` because the next call to `getEffectivePolicy` simply passes the new threshold.

### 4.3 Idempotent sweep job

A new background job — `policy_lifecycle_sweep` — registered via `server/services/jobs.ts` exists only for two side-effects that need to happen **once per transition**:

1. Emit an `audit_logs` row when a scheduled policy actually goes live.
2. Auto-end emergency assignments whose `emergency_ends_at` has passed (writes audit log, no row delete).

Algorithm (runs every 5 minutes via the existing scheduled deployment, see `replit.md` "Replit Deployment Topology"):

```
now = currentInstant()

// (a) scheduled → live transitions we haven't audited yet
for p in policies where status='active'
                    and effective_at IS NOT NULL
                    and effective_at <= now
                    and (published_at IS NULL OR audit log of `policy.activated_scheduled` for this policy is missing):
  writeAuditLog({ action: "policy.activated_scheduled", targetType: "policy", targetId: p.id,
                  newValue: { effectiveAt: p.effective_at, versionNumber: latestVersion(p.id) } })

// (b) expired emergencies
for a in policy_assignments where is_emergency=true
                              and emergency_ends_at IS NOT NULL
                              and emergency_ends_at <= now
                              and audit log of `emergency.expired` for this assignment is missing:
  writeAuditLog({ action: "emergency.expired", targetType: "policy_assignment", targetId: a.id,
                  newValue: { policyId: a.policy_id, expiredAt: a.emergency_ends_at } })
  // we do not delete the assignment — history is preserved; the resolver already ignores it
```

The "audit log is missing" check makes the job **idempotent** — if it runs twice in the same window, no duplicate audit rows are written. Implemented via a simple existence query keyed on `targetId + action`.

### 4.4 Scheduling collisions

Two drafts of the same `policyTypeId` can be scheduled with overlapping `effective_at`/`effective_until` windows on overlapping target sets. The Conflict Detector (§6) flags this **before** the second one is scheduled. If two are scheduled despite the warning, the resolver's tie-break (`priority` DESC, `created_at` DESC, §3.2) picks one deterministically — there is no race because the resolver is read-side and idempotent. The audit log captures both `policy.scheduled` events and the user's explicit acknowledgement of the conflict warning (see §9).

---

## 5. Simulation service

### 5.1 Inputs

```ts
interface SimulateRequest {
  userId: string;
  atTimestamp: string;                        // ISO; defaults to now if omitted
  policyTypeKeys?: string[];                  // default: all 6 types
  samplePunch?: {                             // optional — drives attendance/payroll evaluation
    clockIn: string;
    clockOut?: string;
    breakMinutes?: number;
  };
  samplePtoRequest?: {                        // optional — drives PTO evaluation
    startDate: string;
    endDate: string;
  };
  sampleOvertimeScenario?: {                  // optional — drives payroll evaluation
    hoursWorkedToday: number;
    hoursWorkedThisWeek: number;
  };
}
```

### 5.2 Output

```ts
interface SimulateResult {
  atTimestamp: string;
  perType: Array<{
    policyTypeKey: string;
    resolution: ResolutionTraceStep[];        // §3.5
    resolvedPolicy: EffectivePolicy | null;
    rulesApplied: Record<string, any>;
    outcome: SimulationOutcome | null;        // see below
    comparison: {
      currentlyActive: EffectivePolicy | null;
      changedFields: string[];                // keys that differ between currentlyActive.rules and rulesApplied
    };
  }>;
}

interface SimulationOutcome {
  type: "clockIn" | "clockOut" | "ptoCheck" | "overtimeCheck";
  allowed: boolean;
  alerts: Array<{ type: string; severity: string; message: string }>;
  computed: Record<string, any>;              // e.g. { isLate, lateMinutes, hoursWorked, overtimeHours }
}
```

### 5.3 Reuse of enforcement code

The simulator is a **thin orchestrator** — it does not reimplement enforcement logic. For each `policyTypeKey`:

| Type | Enforcement function called |
|------|----------------------------|
| `attendance` + samplePunch.clockIn only | `enforceClockIn(user, parseDate(samplePunch.clockIn), rules, policyName)` |
| `attendance` + samplePunch.clockIn + clockOut | also `enforceClockOut(...)` |
| `pto` + samplePtoRequest | `enforcePtoAdvanceNotice(...)` and `enforcePtoBlackoutDates(...)` |
| `payroll` + sampleOvertimeScenario | `enforceClockOut` is reused with synthetic input; `evaluateDayOfWeekBonuses` and `evaluateEarlyArrivalBonuses` for bonus rules |
| `approvals`, `alerts`, `kiosk` | No outcome computed — only the resolved rules are returned (UI shows them as a config diff). |

This guarantees the simulator can never disagree with real enforcement.

### 5.4 Implementation file

New file `server/services/simulation.ts` exporting `simulatePolicies(req: SimulateRequest, actor: User): Promise<SimulateResult>`. Wired by `POST /api/rules/simulate` (see §10, route #20).

---

## 6. Conflict detection engine

### 6.1 Conflict classes

| Class | Definition | Severity |
|-------|------------|----------|
| `OVERLAPPING_WINDOWS` | Two active or scheduled policies of the same `policyTypeId` whose `[effective_at, effective_until)` ranges overlap **and** share at least one matching target user. | high |
| `MASKED_BY_OVERRIDE` | A draft (or its current scope) would be masked by a higher-precedence assignment (employee > department > location > division > global) that is already active for the same user set. | medium |
| `MASKED_BY_EMERGENCY` | A scheduled policy's resolution path is currently shadowed by an active emergency override on any of its target users. | medium |
| `EMERGENCY_COLLISION` | Two emergency assignments of the same `policyTypeId` with overlapping `emergency_starts_at`/`emergency_ends_at` windows on overlapping target users. | high |
| `INVALID_WINDOW` | `effective_until <= effective_at`, or `emergency_ends_at <= emergency_starts_at`. | high (blocks save) |
| `EMERGENCY_NO_REASON` | `is_emergency=true` and `emergency_reason` empty. | high (blocks save) |

### 6.2 Output shape

```ts
interface ConflictReport {
  conflicts: Array<{
    class: ConflictClass;
    severity: "low" | "medium" | "high";
    message: string;                      // human-readable, used in the UI
    affectedUserIds: string[];            // count + names rendered by UI (see §7)
    relatedPolicyIds: string[];
    relatedAssignmentIds: string[];
  }>;
  blockingCount: number;                  // count of severity='high' that must be acknowledged
}
```

### 6.3 Implementation file

New file `server/services/conflicts.ts` exporting `analyzeDraftConflicts(args: { policyId: string; assignmentScope?: AssignmentScope }): Promise<ConflictReport>`. Wired by `POST /api/rules/conflict-check` (route #18).

---

## 7. Impact preview engine

### 7.1 Inputs and algorithm

```ts
interface ImpactPreviewArgs {
  policyId?: string;                                       // existing policy
  scope?: { companyId?: string; locationId?: string; departmentId?: string; userId?: string };
}

interface ImpactPreviewResult {
  totalUsers: number;
  byLocation: Array<{ locationId: string; locationName: string; count: number }>;
  byDepartment: Array<{ departmentId: string; departmentName: string; count: number }>;
  sample: Array<{ id: string; firstName: string; lastName: string; locationId: string | null; departmentId: string | null }>;
  truncated: boolean;
}
```

Algorithm:
- Pull the assignment scope from `policyId`'s current assignments OR from `scope` directly.
- For `userId` scope → list of one user.
- For `departmentId` → `users WHERE department_id = ?`.
- For `locationId` → `users WHERE location_id = ?`.
- For `companyId` → `users WHERE company_id = ?`.
- For global (no scope) → all users in active companies.
- Group by `location_id` and `department_id` for the breakdown.
- `sample`: first 50 users sorted by last name, first name. `truncated = totalUsers > 50`.

### 7.2 Pagination strategy

The summary view always returns `byLocation`/`byDepartment` aggregates (small). The `sample` is hard-capped at 50 to keep payload bounded. A separate `GET /api/rules/impact/:policyId/users?cursor=&limit=` endpoint (route #17) returns paginated full lists when the admin clicks "Show all" in the panel.

### 7.3 Implementation file

New file `server/services/impactPreview.ts` exporting `computeImpactPreview(args: ImpactPreviewArgs): Promise<ImpactPreviewResult>`.

---

## 8. Rollback engine

"Rollback to version N" copies version N's `rules` jsonb into a new `policy_versions` row at version `latest+1` with `is_rollback=true` and `rolled_back_from_version=N`, then upserts that snapshot back into `policy_rules` for the policy. **Historical versions are never edited or deleted.**

```
function rollback(policyId, targetVersionN, note, actor):
  target = policy_versions WHERE policy_id=policyId AND version_number=N
  if not target: 404
  latest = max(version_number) for this policy
  next = latest + 1
  insert policy_versions(policy_id, version_number=next, rules=target.rules,
                         note=note, is_rollback=true, rolled_back_from_version=N,
                         created_by=actor.id)
  storage.upsertPolicyRules(policyId, target.rules)        // existing helper
  policies.updatedAt = now()
  writeAuditLog(action="policy.rolled_back", targetId=policyId,
                oldValue={fromVersion: latest}, newValue={toVersion: N, note})
```

The old version remains intact and rollback-able again at any time.

---

## 9. Audit logging integration

Every lifecycle event writes one `audit_logs` row using the existing `writeAuditLog` helper.

| Event | `targetType` | `action` | `oldValue` | `newValue` |
|-------|-------------|----------|------------|------------|
| Save draft | `policy` | `policy.draft_saved` | `{ rules: priorRules }` | `{ rules: newRules, versionNumber }` |
| Schedule activation | `policy` | `policy.scheduled` | `{ status, effectiveAt }` | `{ status: "active", effectiveAt, effectiveUntil, versionNumber, acknowledgedConflicts }` |
| Activate now | `policy` | `policy.activated` | `{ status }` | `{ status: "active", effectiveAt, versionNumber }` |
| Scheduled→live transition (sweep) | `policy` | `policy.activated_scheduled` | `null` | `{ effectiveAt, versionNumber }` |
| Rollback | `policy` | `policy.rolled_back` | `{ fromVersion }` | `{ toVersion, note }` |
| Emergency override created | `policy_assignment` | `emergency.created` | `null` | `{ policyId, scope, reason, startsAt, endsAt }` |
| Emergency expired (sweep) | `policy_assignment` | `emergency.expired` | `null` | `{ policyId, expiredAt }` |
| Holiday calendar created | `holiday_calendar` | `holiday_calendar.created` | `null` | `{ name, companyId }` |
| Blackout list created | `blackout_list` | `blackout_list.created` | `null` | `{ name, companyId, ranges }` |
| Holiday/blackout updated/deleted | same | `*.updated`/`*.deleted` | prior | new |

`context` carries the IP/UA via `getAuditContext(req)` already in use. UI-UX §6 ("Version History") renders these rows directly from `/api/audit-logs/filtered?targetType=policy&targetId=...`.

---

## 10. Route modularization plan

### 10.1 New surface: `/api/rules/*`

All routes are guarded by `requireAuth` + `requireRole("admin")` and write events are audited. Request/response bodies use Zod schemas in a new file `server/schemas/rules.ts`.

| # | Method | Path | Request body | Response | Notes |
|---|--------|------|--------------|----------|-------|
| 1 | GET | `/api/rules/categories` | — | `Array<{ key, label, activeCount, draftCount, scheduledCount, liveEmergencyCount, conflictCount, lastChangedAt, lastChangedBy }>` | Drives Page A dashboard cards. |
| 2 | GET | `/api/rules/categories/:typeKey` | — | `{ active: PolicySummary[], draft: PolicySummary[], scheduled: PolicySummary[] }` | Page B header. |
| 3 | GET | `/api/rules/policies/:policyId` | — | `{ policy, rules, assignments, versions, latestVersionNumber }` | Page B detail load. |
| 4 | POST | `/api/rules/policies` | `CreatePolicy` (name, typeKey, description) | `Policy` | Creates a draft. |
| 5 | PUT | `/api/rules/policies/:policyId/draft` | `{ rules: object, note?: string }` | `{ policy, versionNumber }` | Save draft → snapshot to `policy_versions`. |
| 6 | POST | `/api/rules/policies/:policyId/schedule` | `{ effectiveAt: ISO, effectiveUntil?: ISO, acknowledgedConflicts?: string[] }` | `{ policy, versionNumber }` | Promotes draft to scheduled-active. Blocks if `analyzeDraftConflicts` returns `blockingCount > acknowledgedConflicts.length`. |
| 7 | POST | `/api/rules/policies/:policyId/activate` | `{ acknowledgedConflicts?: string[] }` | `{ policy, versionNumber }` | Activate immediately (sets `effective_at = now()`). |
| 8 | POST | `/api/rules/policies/:policyId/rollback/:versionNumber` | `{ note: string }` | `{ policy, newVersionNumber }` | §8. |
| 9 | GET | `/api/rules/policies/:policyId/versions` | — | `PolicyVersion[]` | Newest first. |
| 10 | GET | `/api/rules/policies/:policyId/versions/diff` | `?fromVersion=&toVersion=` | `{ added, removed, changed }` | Returns a JSON diff used by RuleDiffViewer (UI-UX §6). |
| 11 | GET | `/api/rules/policies/:policyId/assignments` | — | `PolicyAssignment[]` | Same as `/api/policy-assignments?policyId=…` but always includes new emergency fields. |
| 12 | POST | `/api/rules/policies/:policyId/assignments` | `AssignmentScope` | `PolicyAssignment` | Standard scope assignment. |
| 13 | POST | `/api/rules/policies/:policyId/emergency` | `{ scope, reason, startsAt, endsAt, priority? }` | `PolicyAssignment` | Reason required; validates window. |
| 14 | DELETE | `/api/rules/assignments/:assignmentId` | — | 204 | Same audit as legacy. |
| 15 | GET | `/api/rules/emergencies` | — | `Array<EmergencyOverrideSummary>` | Page E listing. |
| 16 | POST | `/api/rules/impact-preview` | `ImpactPreviewArgs` (§7.1) | `ImpactPreviewResult` | |
| 17 | GET | `/api/rules/impact/:policyId/users` | `?cursor=&limit=` | `{ users: User[], nextCursor?: string }` | Paginated full impact list. |
| 18 | POST | `/api/rules/conflict-check` | `{ policyId?: string, draftRules?: object, scope?: AssignmentScope }` | `ConflictReport` (§6) | Used by Page B before publish/schedule. |
| 19 | GET | `/api/rules/holiday-calendars` | `?companyId=` | `Array<HolidayCalendar & { entries }>` | |
| 19a | POST | `/api/rules/holiday-calendars` | `Insert` | `HolidayCalendar` | |
| 19b | PUT | `/api/rules/holiday-calendars/:id` | partial | updated | |
| 19c | DELETE | `/api/rules/holiday-calendars/:id` | — | 204 | Cascade entries. |
| 19d | POST/PUT/DELETE | `/api/rules/holiday-calendars/:id/entries[/:entryId]` | `Insert/Update` | `HolidayCalendarEntry` | |
| 19e | GET/POST/PUT/DELETE | `/api/rules/blackout-lists[/:id[/ranges[/:rangeId]]]` | analogous | analogous | Same CRUD shape as 19. |
| 20 | POST | `/api/rules/simulate` | `SimulateRequest` (§5.1) | `SimulateResult` (§5.2) | Drives Page C. |
| 21 | GET | `/api/rules/audit?policyId=&action=` | — | `AuditLog[]` | Thin proxy to `/api/audit-logs/filtered` scoped to rules events; mainly for UI convenience. |

### 10.2 File organization

A new file `server/routes/rules.ts` exports `registerRulesRoutes(app: Express, deps)`. `server/routes.ts` calls `registerRulesRoutes(app, { storage, writeAuditLog, getAuditContext, requireAuth, requireRole })` once near the existing policy section. **No existing routes are moved or deleted in this work** — `server/routes.ts` simply gets one new line plus the import. This avoids disturbing 4,400+ lines of unrelated routing.

If desired in a follow-up cleanup, the legacy `/api/policies/*` block (`server/routes.ts:2915–3163`) can be relocated into `server/routes/policies-legacy.ts`. That move is **not** part of this task.

### 10.3 Validation

`server/schemas/rules.ts` defines:

```ts
export const draftRulesSchema = z.object({ rules: z.record(z.any()), note: z.string().optional() });
export const scheduleSchema = z.object({
  effectiveAt: z.string().datetime(),
  effectiveUntil: z.string().datetime().nullable().optional(),
  acknowledgedConflicts: z.array(z.string()).optional(),
}).refine(d => !d.effectiveUntil || new Date(d.effectiveUntil) > new Date(d.effectiveAt),
          { message: "effectiveUntil must be after effectiveAt" });
export const emergencySchema = z.object({
  scope: assignmentScopeSchema,                 // exactly one of {companyId, locationId, departmentId, userId} or none for global
  reason: z.string().min(1, "Reason is required"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  priority: z.number().int().min(0).max(100).optional(),
}).refine(d => new Date(d.endsAt) > new Date(d.startsAt), { message: "endsAt must be after startsAt" });
```

Per-category rule shape validation reuses existing `DEFAULT_*_RULES` shapes via `z.object({...}).partial()` — Zod schemas live next to the defaults in `server/policyEngine.ts` to keep one source of truth.

---

## 11. Migration & coexistence plan

### 11.1 Existing callers keep working

- `server/services/policyEnforcement.ts` calls `getEffectivePolicy(...)` only for resolved rules. The extended resolver returns the same `rules` shape; the new fields (`assignmentId`, `isEmergency`, `versionNumber`) are additions. **No enforcement code change required.**
- `server/services/jobs.ts` keeps invoking `runAutoClockOut()` unchanged.
- `client/src/pages/rules-controls.tsx` continues to call `/api/policies`, `/api/policy-assignments`, `/api/policies/:id/rules`, `/api/policies/:id/activate`. None of these are removed; they keep their current signatures and audit log actions.
- The legacy page route (`/rules-controls`) is repointed in `client/src/App.tsx` to render the new `RulesCommandCenterPage`. The legacy page component file itself is preserved (renamed to `rules-controls-legacy.tsx`) so it can be reached if needed during the rollout. After implementation Task #86 step 7 confirms the migration in tests, the legacy file can be removed in a separate cleanup task.

### 11.2 Inline blackout/holiday data migration

Existing PTO policies that store inline `rules.blackoutDates: string[]` keep working through `expandBlackoutDates(policyRules)` (§2.5), which merges the inline array with the union of any `blackoutListIds` references. No data migration is required at this time; the Command Center's UI for Blackout Date Manager (UI-UX §9) shows a one-click "Convert inline dates to a list" affordance for each policy.

### 11.3 Deprecation timeline

- **Phase 2 (this work):** new `/api/rules/*` and Command Center go live. Legacy routes remain.
- **Phase 2.1 (follow-up):** legacy `rules-controls.tsx` removed; legacy `/api/policies/*` and `/api/policy-assignments/*` routes are kept indefinitely as the underlying CRUD primitives — they are the actual storage operations the new routes call into.

---

## 12. Risks & mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Scheduled activation race with concurrent edits (admin keeps editing a draft while it's scheduled to flip live). | The `effective_at` is captured into a `policy_versions` snapshot at schedule time. Once scheduled, the draft form on Page B is locked and shows "Scheduled — unschedule to edit" with a "Cancel schedule" button (sets `effective_at` back to NULL and `status='draft'`). Audit log entry: `policy.unscheduled`. |
| 2 | Emergency override forgotten and stays live forever. | `emergency_ends_at` is required at create time (§2.3 NOT-NULL via Zod refinement). Sweep job (§4.3 step b) writes `emergency.expired` audit row at expiry. The Emergency Center (UI-UX §7) shows a live countdown for every active override and a banner across the Command Center when any override is active. |
| 3 | Simulator drift from real enforcement. | The simulator does not reimplement logic — it calls the same `enforceClockIn` / `enforceClockOut` / `enforcePto*` functions from `server/services/policyEnforcement.ts` (§5.3). Add a regression test: same input through simulator vs through the real `/api/punch/clockin` route → identical alerts and computed values. |
| 4 | Conflict detection produces too many false-positives, training admins to click through them. | Conflict severity is graded (`high` blocks; `medium` is acknowledge-and-proceed; `low` is informational). Severity values are documented (§6.1). |
| 5 | Backfill in §2.6 step 8 fails on cold install (no admin user). | Step 8 wrapped in `IF EXISTS (SELECT 1 FROM users WHERE role='admin')` guard; new policies create their v1 row through the publish path so cold installs are unaffected. |
| 6 | Routes file already 4,400 lines; adding 21 more routes balloons it. | New routes live in `server/routes/rules.ts`, registered with one line in `server/routes.ts` (§10.2). |
| 7 | Resolver perf regression (more candidates per call). | Add `INDEX (policy_type_id, status)` on `policies` and `INDEX (policy_id)` on `policy_assignments` (verify both already exist; add via the same migration if not). Resolver query stays O(candidates per type) — the candidate set is bounded by total policies of that type, typically << 100 even at scale. |
| 8 | Holiday calendar lookups inside enforcement balloon DB calls. | Calendars are looked up once per `getEffectivePolicy` call, cached in-memory inside the resolver call only (no shared cache to avoid stale-read bugs). The PTO/payroll enforcement code never re-queries on its own. |

---

## 13. Open questions for product

These need an explicit decision before implementation starts:

1. **Retroactive rules.** When a scheduled change goes live mid-shift (e.g., overtime threshold drops), should it apply retroactively to in-progress shifts that started before `effective_at`, or only to shifts started at/after? Default proposed: **only at/after**.
2. **Maximum emergency override duration.** Should the system cap how long an emergency can run (e.g., 14 days)? Default proposed: **soft cap of 30 days** — UI shows a warning above 14 days; backend allows any duration.
3. **Holiday calendar default.** When the platform is first deployed, do we seed a "US Federal Holidays" calendar at the global scope, or leave it empty? Default proposed: **leave empty**, with a one-click "Import US Federal Holidays" button on the Holiday Calendar Manager (UI-UX §8).
4. **Impact preview privacy.** Should the impact preview show employee names by default, counts only, or counts with click-to-reveal names? Default proposed: **counts + breakdown by location/department by default; first 50 names visible behind a "Show employees" disclosure**.
5. **Emergency override scope width.** Can a single emergency override target the whole division, or must it be limited to a department/location/employee? Default proposed: **any scope is allowed**; the UI requires explicit acknowledgement of the impact size before commit.
6. **Conflict acknowledgement persistence.** Once an admin acknowledges a `high` conflict and publishes anyway, do later edits re-prompt? Default proposed: **yes — every publish/schedule action runs a fresh conflict check**.
