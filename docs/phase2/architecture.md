# Rules Command Center — Technical Architecture Spec (Phase 2)

> **Status:** Draft for review. No code changes have been made. Implementation is gated on Task #86 and must not begin until this spec and the companion `docs/phase2/ui-ux.md` are approved.
>
> **Companion document:** [`./ui-ux.md`](./ui-ux.md) — UI/UX Design Spec. Cross-references appear inline where they apply.

---

## 1. Current state baseline

This section is the source of truth for what exists today in the codebase. The Phase 2 work in section 2+ is incremental on top of it; nothing listed here changes behavior unless explicitly called out.

### 1.1 Schema (existing)

In `shared/schema.ts` (which re-exports tables from `shared/models/*`):

- `policy_types` — declared in `shared/models/auth.ts:217` (`export const policyTypes = pgTable("policy_types", { ... })`) and re-exported via `shared/schema.ts`. Seeded with the keys: `attendance`, `pto`, `payroll`, `approvals`, `alerts`, `kiosk`. Each row has `id`, `key`, `name`, `description`, `module`, `isActive`.
- `policies` (`shared/schema.ts:133-151`):
  - `id varchar PK default gen_random_uuid()`
  - `companyId varchar` (nullable, FK → `companies.id`) — used as the "division" scope.
  - `policyTypeId varchar NOT NULL` (FK → `policy_types.id`).
  - `name varchar(200) NOT NULL`, `description text`.
  - `status varchar(20) DEFAULT 'draft' NOT NULL` — used values today: `draft`, `active`, `archived`.
  - `version integer DEFAULT 1 NOT NULL` — manually incremented today (no version table).
  - `createdAt`, `updatedAt`.
- `policy_rules` (`shared/schema.ts:153-167`):
  - `id`, `policyId` (FK → `policies.id`), `rules jsonb NOT NULL`, `createdAt`, `updatedAt`.
  - Today there is exactly one rules row per policy (`upsertPolicyRules` writes-or-replaces).
- `policy_assignments` (`shared/schema.ts:169-184`):
  - `id`, `policyId` (FK → `policies.id`), `companyId` (nullable, FK → `companies.id`), `locationId` (nullable, FK → `locations.id`), `departmentId` (nullable, FK → `departments.id`), `userId` (nullable, FK → `users.id`), `createdAt`.
  - Convention: exactly one of the four scope fields is non-null; "global" is represented by all four being null.
- `audit_logs` (`shared/schema.ts:272-291`): generic event store used by `writeAuditLog` (`server/services/audit.ts`).

### 1.2 Resolver (existing)

`server/policyEngine.ts` exports `getEffectivePolicy(companyId, userId, policyTypeKey, user)`. It:

1. Loads the `policy_type` row for `policyTypeKey`.
2. Loads every assignment + joined active policy of that type in one query.
3. Walks the candidates in this strict precedence order, picking the **first** match found:
   1. **Employee** — `assignment.userId === userId`.
   2. **Department** — `assignment.departmentId === user.departmentId` AND `userId IS NULL`.
   3. **Location** — `assignment.locationId === user.locationId` AND `departmentId IS NULL` AND `userId IS NULL`.
   4. **Division (company)** — `assignment.companyId === companyId` AND `locationId/departmentId/userId IS NULL`.
   5. **Global** — all four scope fields NULL.
4. Loads the (single) `policy_rules` row for the resolved policy and returns `{ policyId, policyName, policyTypeKey, assignmentLevel, rules }`.

### 1.3 Defaults (existing)

`server/policyEngine.ts` exports `DEFAULT_ATTENDANCE_RULES`, `DEFAULT_PTO_RULES`, `DEFAULT_PAYROLL_RULES`, `DEFAULT_APPROVALS_RULES`, `DEFAULT_ALERTS_RULES`, `DEFAULT_KIOSK_RULES`, plus the convenience function `getDefaultRulesForType(policyTypeKey)`. These are the fall-back when no policy exists or when a key is missing from the resolved rules.

### 1.4 Enforcement consumers (existing)

`server/services/policyEnforcement.ts` reads through `getEffectivePolicy` and applies the resolved rules:

- `enforceClockIn`, `enforceClockOut`, `evaluateDayOfWeekBonuses`, `evaluateEarlyArrivalBonuses`, `enforcePtoAdvanceNotice`, `enforcePtoBlackoutDates`, `runAutoClockOut`, `computeAutoClockOutValues`, `roundTime`, `createPolicyAlert`.

These are called from the punch routes, PTO submission routes, and the 15-minute auto clock-out background job.

### 1.5 Routes (existing)

Defined inline in `server/routes.ts`:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/policy-types` | Auth only. |
| GET | `/api/policies` | Admin. Optional `?companyId=`. |
| GET | `/api/policies/:id` | Admin. Returns policy + first rules row + assignments. |
| POST | `/api/policies` | Admin. Validates with `insertPolicySchema`. |
| PATCH | `/api/policies/:id` | Admin. |
| POST | `/api/policies/:id/activate` | Admin. Sets `status='active'`. |
| POST | `/api/policies/:id/archive` | Admin. Sets `status='archived'`. |
| GET | `/api/policies/:id/rules` | Admin. |
| PUT | `/api/policies/:id/rules` | Admin. Single-row upsert into `policy_rules`. |
| GET | `/api/policy-assignments` | Admin. Optional `?policyId=`. |
| POST | `/api/policy-assignments` | Admin. |
| PATCH | `/api/policy-assignments/:id` | Admin. |
| DELETE | `/api/policy-assignments/:id` | Admin. |
| GET | `/api/policy-defaults/:policyType` | Admin. Returns `getDefaultRulesForType(...)`. |

### 1.6 Frontend (existing)

`client/src/pages/rules-controls.tsx` is a single 816-line page mounted at `/rules-controls` (registered in `client/src/App.tsx`). It renders a left rail with 10 sections (`general`, `locations`, `attendance`, `pto`, `payroll`, `approval`, `roles`, `alerts`, `kiosk`, `audit`) and uses three reusable components:

- `PolicySection` — listing/CRUD for one policy type.
- `PolicyWizard` (`client/src/components/policy-wizard.tsx`) — 4-step Basics → Rules → Assignments → Review modal.
- `WorkflowBuilder` (`client/src/components/workflow-builder.tsx`) — visual approval workflow builder using `@xyflow/react`.

### 1.7 What stays unchanged (must not regress)

- The `policies`, `policy_rules`, `policy_assignments`, and `policy_types` tables keep their existing columns and existing rows. Phase 2 only **adds** columns and **adds** new tables.
- `getEffectivePolicy(...)` keeps its public signature and continues to work for callers that pass no `atTimestamp`. The 5-level precedence order (employee → department → location → division → global) is preserved.
- All existing `/api/policies/*` and `/api/policy-assignments/*` routes keep their paths, request bodies, and response bodies. They become thin adapters that share storage code with the new `/api/rules/*` surface (see §10 and §11).
- `DEFAULT_*_RULES` shapes in `server/policyEngine.ts` are reused as the field schema for the rule-builder forms in the new UI (see UI-UX §4).
- `rules-controls.tsx` is **not deleted** in Phase 2; it redirects to the new Command Center (see UI-UX §2).
- Existing `policyEnforcement.ts` functions are not duplicated — the simulator in §5 calls them directly.

---

## 2. Schema expansion

All new schema changes are additive. Existing rows must continue to read and write without backfill failure.

### 2.1 Added columns on `policies`

```ts
// shared/schema.ts (additions inside the existing `policies` table)
effectiveAt:     timestamp("effective_at"),     // nullable. NULL = "active immediately when status flips to active"
effectiveUntil:  timestamp("effective_until"),  // nullable. NULL = "no automatic end"
```

- Both `timestamp with time zone NULL`, no default.
- Backfill: none required. Existing rows leave both NULL — interpreted as "always-on while active", matching today's behavior.
- Index: `CREATE INDEX policies_status_effective_at_idx ON policies(status, effective_at);` to support the activation sweep job (§4).

### 2.2 Added columns on `policy_assignments`

```ts
priority:           integer("priority").default(0).notNull(),     // higher = wins ties at same level
isEmergency:        boolean("is_emergency").default(false).notNull(),
emergencyReason:    text("emergency_reason"),                     // required when isEmergency=true
emergencyStartsAt:  timestamp("emergency_starts_at"),
emergencyEndsAt:    timestamp("emergency_ends_at"),
```

- `priority` defaults to 0 for all existing rows. Tie-breaker: when two non-emergency assignments resolve to the same level for the same employee, the higher `priority` wins; ties are broken by newest `createdAt`.
- Emergency rules: when `isEmergency=true`, `emergencyReason`, `emergencyStartsAt`, `emergencyEndsAt` MUST all be non-null. Enforced in the new `insertPolicyAssignmentSchema.refine(...)` and at the route layer.
- Backfill: none. All existing rows are non-emergency with `priority=0`.
- Indexes:
  - `CREATE INDEX policy_assignments_emergency_window_idx ON policy_assignments(is_emergency, emergency_starts_at, emergency_ends_at) WHERE is_emergency = true;`
  - `CREATE INDEX policy_assignments_priority_idx ON policy_assignments(policy_id, priority DESC);`

### 2.3 New table — `policy_versions`

Immutable snapshot of a policy's rules at the moment it became active (or when a rollback or scheduled draft was promoted).

```ts
export const policyVersions = pgTable("policy_versions", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  policyId:       varchar("policy_id").notNull().references(() => policies.id),
  versionNumber:  integer("version_number").notNull(),
  rules:          jsonb("rules").notNull(),                   // full snapshot of policy_rules.rules
  note:           text("note"),                               // free-form change note
  isRollback:     boolean("is_rollback").default(false).notNull(),
  rolledBackFromVersion: integer("rolled_back_from_version"), // version # this rollback restored
  effectiveAt:    timestamp("effective_at"),                  // copied from policies.effectiveAt at promotion
  effectiveUntil: timestamp("effective_until"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});
```

- Unique: `(policyId, versionNumber)`.
- Index: `(policyId, createdAt DESC)` for the version-history list.
- The `policies.version` integer continues to be the **current** version. `policy_versions` stores history.
- Backfill: a one-time SQL migration writes `versionNumber=1` for every existing **active** policy by snapshotting its current `policy_rules.rules`. Drafts are skipped.

### 2.4 New table — `holiday_calendars`

```ts
export const holidayCalendars = pgTable("holiday_calendars", {
  id:        varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),  // null = global default
  name:      varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  isActive:  boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const holidayCalendarEntries = pgTable("holiday_calendar_entries", {
  id:         varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  calendarId: varchar("calendar_id").notNull().references(() => holidayCalendars.id),
  date:       date("date").notNull(),                     // calendar date
  name:       varchar("name", { length: 200 }).notNull(), // "Memorial Day"
  recurrence: varchar("recurrence", { length: 20 }).default("none").notNull(), // 'none' | 'annual'
  payMultiplier: numeric("pay_multiplier", { precision: 4, scale: 2 }), // optional override for that day
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
```

- Index: `(calendarId, date)` unique; `(date)` for fast "is today a holiday?" lookups.
- Scope assignment is reused from the existing `policy_assignments` model conceptually but is its own join table:

```ts
export const holidayCalendarAssignments = pgTable("holiday_calendar_assignments", {
  id:         varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  calendarId: varchar("calendar_id").notNull().references(() => holidayCalendars.id),
  companyId:  varchar("company_id").references(() => companies.id),
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id").references(() => departments.id),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
```

- Backfill: insert one global `holiday_calendars` row called "Default Holidays" with the existing federal-holiday list currently hard-coded inside `payroll` rules (none today — the new table starts empty, see §13 open questions).

### 2.5 New table — `blackout_dates`

```ts
export const blackoutDates = pgTable("blackout_dates", {
  id:        varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  startDate: date("start_date").notNull(),
  endDate:   date("end_date").notNull(),
  reason:    text("reason").notNull(),
  scope:     varchar("scope", { length: 20 }).default("company").notNull(), // 'company' | 'location' | 'department'
  locationId: varchar("location_id").references(() => locations.id),
  departmentId: varchar("department_id").references(() => departments.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

- Index: `(start_date, end_date)`; partial indexes per scope.
- Backfill: copy any string entries currently sitting inside `policy_rules.rules.blackoutDates` (PTO policies) into rows here, scoped to the policy's `companyId`. Original JSON keys are kept for backwards-compat reads in the resolver.

### 2.6 Migration order

1. Add nullable columns on `policies` (`effectiveAt`, `effectiveUntil`).
2. Add columns on `policy_assignments` (`priority`, `isEmergency`, `emergencyReason`, `emergencyStartsAt`, `emergencyEndsAt`) with safe defaults.
3. Create `policy_versions`, `holiday_calendars`, `holiday_calendar_entries`, `holiday_calendar_assignments`, `blackout_dates`.
4. Backfill `policy_versions` from existing active policies (`versionNumber=1`).
5. Backfill `blackout_dates` from existing PTO `rules.blackoutDates`.
6. Create indexes listed above.

All migrations follow the existing convention used in `replit.md` ("Schema columns added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`"). No `drizzle-kit push` runs — the migrations are checked-in SQL files invoked once.

---

## 3. Resolver precedence updates

`getEffectivePolicy` is extended in place. The signature stays backward-compatible:

```ts
export async function getEffectivePolicy(
  companyId: string | null,
  userId: string,
  policyTypeKey: string,
  user?: User,
  atTimestamp?: Date,            // NEW. Defaults to `new Date()`.
): Promise<EffectivePolicy | null>;
```

A new `EffectivePolicy` field is added (additive only):

```ts
export interface EffectivePolicy {
  policyId: string;
  policyName: string;
  policyTypeKey: string;
  assignmentLevel: "global" | "division" | "location" | "department" | "employee" | "emergency";
  rules: Record<string, any>;
  matchedAssignmentId: string;       // NEW
  versionNumber: number;             // NEW (from policies.version)
  isEmergency: boolean;              // NEW
}
```

### 3.1 Algorithm

1. `now = atTimestamp ?? new Date()`.
2. Load `policyType` by key (unchanged).
3. Load all candidate `(assignment, policy)` joined rows of that type where:
   - `policies.status = 'active'`,
   - **AND** (`policies.effective_at IS NULL` OR `policies.effective_at <= now`),
   - **AND** (`policies.effective_until IS NULL` OR `policies.effective_until > now`).
4. **Emergency pass first.** Filter the candidate set to assignments where `isEmergency = true` AND `emergencyStartsAt <= now < emergencyEndsAt`. Walk the same 5-level precedence (employee → department → location → division → global) over emergency-only assignments. If anything matches, return it with `assignmentLevel='emergency'` and `isEmergency=true`. Tie-break inside one level by `priority DESC`, then `createdAt DESC`.
5. **Normal pass.** Walk the 5-level precedence over the non-emergency candidates, exactly as today. Tie-break inside one level by `priority DESC`, then `createdAt DESC`.
6. If a policy resolves, look up the **active** version snapshot — i.e. the row in `policy_versions` whose `versionNumber = policies.version`. If found, use `versionRow.rules`; otherwise fall through to the legacy single `policy_rules` row.
7. Return the populated `EffectivePolicy`.

### 3.2 Simulator entry point

```ts
export async function simulateEffectivePolicy(input: {
  userId: string;
  policyTypeKey: string;
  atTimestamp: Date;
}): Promise<{
  effective: EffectivePolicy | null;
  chain: Array<{
    level: EffectivePolicy["assignmentLevel"];
    assignmentId: string | null;
    policyId: string | null;
    policyName: string | null;
    versionNumber: number | null;
    matched: boolean;
    skippedReason?: string; // e.g. "before effectiveAt", "outside emergency window", "lower priority"
  }>;
  defaultsUsed: boolean;
  defaults: Record<string, any>;
}>;
```

Pseudo-code:

```
load user
load companyId from user
build candidate set with the same time/status filters as getEffectivePolicy
for each level in [employee, department, location, division, global]:
  for emergency in [true, false]:
    matches = filter candidates where emergency==flag and scope matches level
    sort matches by (priority DESC, createdAt DESC)
    for each m in matches:
      record { level, assignmentId, policyId, policyName, versionNumber,
               matched: (effective is null), skippedReason: null | "lower priority" }
      if effective is null:
        effective = m
return { effective, chain, defaultsUsed: !effective, defaults: getDefaultRulesForType(policyTypeKey) }
```

This explicit `chain` is what powers the side-by-side display in **UI-UX §5 (Page C — Simulator Lab)**.

---

## 4. Scheduling engine

A draft is "scheduled" by being saved with `status='active'` *and* an `effectiveAt > now`. Two paths converge to the right answer:

1. **Lazy resolution.** `getEffectivePolicy` already filters by `effective_at <= now`, so a future-dated active policy is invisible until its time arrives. **No cron is required for correctness.**
2. **Idempotent sweep job.** Runs every 5 minutes (re-using the existing background job runner that already hosts `runAutoClockOut`). For audit symmetry with manual activations, when a future-dated policy crosses its `effective_at`:
   - Insert a `policy_versions` row for the current `policies.version` if one doesn't already exist for that version.
   - Write an `audit_logs` row with `action='policy.scheduled_activated'` (see §9 for shape).
   - The job is idempotent: it tracks the last sweep timestamp and only writes audit rows for transitions in the new window.

### 4.1 Collisions

If two scheduled activations land in the same 5-minute window for assignments that resolve to the same scope+level for the same employee, the one with higher `priority` wins; ties go to the newest `createdAt`. The other is **not** archived — it remains active in the table but is shadowed by the resolver's tie-break and is reported by the conflict detector (§6) as `severity='warning'`.

### 4.2 What happens to an in-progress shift?

This is **Open Question #1** (see §13). The default proposed behavior: a scheduled change applies to **future evaluations only**. Punches that were already created against the old rules keep the old computed values; new evaluations (next clock-in, next OT calculation, etc.) use the new rules.

---

## 5. Simulation service

### 5.1 Inputs

```ts
type SimulationInput = {
  userId: string;
  atTimestamp: string;            // ISO-8601
  policyTypeKey?: string;         // if omitted, simulate all 6 types
  samplePunch?: {
    clockIn: string;              // ISO-8601
    clockOut?: string;
    breakMinutes?: number;
  };
  samplePtoRequest?: {
    startDate: string;            // YYYY-MM-DD
    endDate: string;
    hoursPerDay: number;
  };
  sampleOvertimeScenario?: {
    workDate: string;
    hoursWorked: number;
  };
};
```

### 5.2 Output

```ts
type SimulationOutput = {
  resolutions: Array<{
    policyTypeKey: string;
    effective: EffectivePolicy | null;
    chain: SimulateResult["chain"];   // see §3.2
    defaults: Record<string, any>;
  }>;
  enforcement: {
    clockIn?: ClockInEnforcementResult;     // from policyEnforcement.ts
    clockOut?: ClockOutEnforcementResult;
    earlyArrival?: EarlyArrivalBonusResult;
    dayOfWeek?: DayOfWeekBonusResult;
    pto?: { advanceNotice: PtoEnforcementResult; blackouts: PtoEnforcementResult };
    overtime?: { overtimeHours: number; doubleTimeHours: number };
  };
  comparedAgainstActive?: SimulationOutput;  // when "compare to current active" is requested
};
```

### 5.3 Implementation

The service lives at `server/services/policySimulation.ts` and is a thin coordinator:

1. Call `simulateEffectivePolicy` from `server/policyEngine.ts` for each requested type.
2. For each provided sample input, call the existing exported functions in `server/services/policyEnforcement.ts` (`enforceClockIn`, `enforceClockOut`, `evaluateEarlyArrivalBonuses`, `evaluateDayOfWeekBonuses`, `enforcePtoAdvanceNotice`, `enforcePtoBlackoutDates`). **No enforcement logic is duplicated**; the simulator just passes the resolved `rules` map and the sample input through.
3. If `?compareToActive=true` query flag is set, run the whole simulation a second time with `atTimestamp = now` and attach as `comparedAgainstActive`.

### 5.4 Side effects

None. Simulation never writes to `audit_logs`, `system_alerts`, or `punch_logs`. The only DB calls are reads.

This service backs the route `POST /api/rules/simulate` (§10).

---

## 6. Conflict detection engine

`server/services/policyConflicts.ts`. Pure function over the current state of the policy tables; called on demand from the UI (Dashboard, Category Detail, Emergency Center) and on every Publish/Schedule attempt.

### 6.1 Conflict classes

| Class | Definition | Severity |
|---|---|---|
| `overlapping_active` | Two `status='active'` policies of the same `policyTypeId` whose `effective_at`/`effective_until` windows overlap, AND that share at least one assignment scope (same `companyId`, `locationId`, `departmentId`, or `userId`). | `error` if both are non-emergency at same level; `warning` if differing priorities resolve cleanly. |
| `overlapping_scheduled` | Same as above but the second policy is scheduled for a future `effectiveAt` that falls inside the first's active window. | `warning` |
| `draft_masked_by_higher_precedence` | A draft assignment exists at e.g. department level, but the same employee already has an emergency or higher-precedence active assignment that will continue to win. | `info` |
| `emergency_collision` | Two emergency overrides of the same type with overlapping `[emergencyStartsAt, emergencyEndsAt)` windows that resolve to the same scope. | `error` |
| `emergency_missing_expiry` | An emergency assignment was created with `emergencyEndsAt > now + 30 days`. | `warning` (configurable in §13). |
| `assignment_orphan` | An assignment points at a location/department/user that no longer exists or is inactive. | `warning` |

### 6.2 Output shape

```ts
type Conflict = {
  id: string;                      // hash of (policyIds, scope, type) — stable across runs
  type: keyof typeof CONFLICT_CLASSES;
  severity: "info" | "warning" | "error";
  message: string;                 // human-readable, includes policy names
  policies: Array<{ id: string; name: string; status: string }>;
  scope: { companyId: string|null; locationId: string|null; departmentId: string|null; userId: string|null };
  acknowledgedByUserId?: string;   // populated if user dismissed it (stored in a small `policy_conflict_acks` table — to add)
};
```

### 6.3 Severity rules in the UI

`error` = blocks Publish in **UI-UX §4 (Page B)**. `warning` = surfaces a confirm-to-proceed modal. `info` = decorative badge only.

---

## 7. Impact preview engine

Given either `{ policyId }` or a draft scope `{ companyId?, locationId?, departmentId?, userId? }` plus a `policyTypeKey`, return the set of users that **would** be affected if it were activated now.

### 7.1 Algorithm

1. Build the target user query:
   - `userId` → exactly that one user.
   - `departmentId` → all users in that department.
   - `locationId` → all users in that location with no overriding department assignment of a higher-priority policy of the same type.
   - `companyId` → all users in that division minus those overridden at lower levels.
   - global → all users minus those overridden at any lower level.
2. For each candidate user, call `getEffectivePolicy(...)` (capped at 200 users in one call; otherwise paginate). The user is "affected" iff the resolved policy would actually change to the target draft.
3. Return:

```ts
type ImpactPreview = {
  totalAffected: number;
  sample: Array<{ userId: string; firstName: string; lastName: string; department: string|null; location: string|null }>; // first 25
  byDepartment: Record<string, number>;
  byLocation: Record<string, number>;
  truncated: boolean;
};
```

### 7.2 Limits & pagination

- Hard cap: 5,000 users in `totalAffected` computation. Above that, return `truncated=true` with an estimate from a `COUNT(*)` over the scope only.
- Sample list is always 25, sorted by last name.
- Backed by `POST /api/rules/impact-preview` (§10) — POST so the draft scope can be sent in the body without crafting query strings.

---

## 8. Rollback engine

"Rollback to version N" is non-destructive: history is never deleted.

### 8.1 Algorithm

```
input: policyId, targetVersionNumber, note (required), actorUserId
load policy by id
load version row { policy_id=policyId, version_number=targetVersionNumber }
if not found: 400 Bad Request
in a transaction:
  newVersion = policy.version + 1
  insert policy_versions {
    policyId,
    versionNumber: newVersion,
    rules: targetVersion.rules,
    note,
    isRollback: true,
    rolledBackFromVersion: targetVersionNumber,
    effectiveAt: now,
    effectiveUntil: null,
    createdByUserId: actorUserId,
  }
  update policy_rules set rules=targetVersion.rules where policy_id=policyId
  update policies set version=newVersion, updated_at=now where id=policyId
  write audit_logs row { action: 'policy.rolled_back', oldValue: { fromVersion: policy.version }, newValue: { toContentOfVersion: targetVersionNumber, newVersionNumber: newVersion, note } }
```

### 8.2 Constraints

- Cannot rollback to a version that is itself the current `version`.
- Cannot rollback while an active emergency override is in effect for the same policy (returns 409 with the override id; the user must end the override first).
- Note is required (min 5 chars).

This backs the route `POST /api/rules/policies/:id/rollback`.

---

## 9. Audit logging integration

Every lifecycle event writes one row via the existing `writeAuditLog(...)` helper (`server/services/audit.ts`) used everywhere else in the codebase. Shapes below are normative.

| Event | `action` | `targetType` | `targetId` | `oldValue` | `newValue` |
|---|---|---|---|---|---|
| Draft saved | `policy.draft_saved` | `policy` | policyId | `{ version }` | `{ name, ruleKeysChanged: string[], effectiveAt, effectiveUntil }` |
| Scheduled (status=active, effectiveAt in future) | `policy.scheduled` | `policy` | policyId | `{ version, status }` | `{ version, status, effectiveAt }` |
| Sweep job promoted scheduled → live | `policy.scheduled_activated` | `policy` | policyId | `{ version }` | `{ version, activatedAt: now }` |
| Manual activate | `policy.activated` | `policy` | policyId | `{ status }` | `{ status: 'active', version }` |
| Rollback | `policy.rolled_back` | `policy` | policyId | `{ fromVersion }` | `{ newVersionNumber, restoredFromVersion, note }` |
| Emergency created | `policy_assignment.emergency_created` | `policy_assignment` | assignmentId | `null` | `{ policyId, scope, reason, startsAt, endsAt }` |
| Emergency expired (sweep) | `policy_assignment.emergency_expired` | `policy_assignment` | assignmentId | `{ endsAt }` | `{ expiredAt: now }` |
| Emergency manually ended | `policy_assignment.emergency_ended` | `policy_assignment` | assignmentId | `{ endsAt }` | `{ endedAt: now, endedByUserId }` |
| Holiday calendar entry created/edited/deleted | `holiday_calendar_entry.{created\|updated\|deleted}` | `holiday_calendar_entry` | entryId | prev row | new row |
| Blackout date created/deleted | `blackout_date.{created\|deleted}` | `blackout_date` | id | prev row | new row |

The existing `getAuditContext(req)` helper supplies `ipAddress` and `userAgent` for each.

---

## 10. Route modularization plan

A new file `server/routes/rules.ts` exports a `registerRulesRoutes(app: Express)` function. `server/routes.ts` calls it once near the existing `/api/policies/*` block. The legacy `/api/policies/*` and `/api/policy-assignments/*` routes are not removed — they are reduced to thin shims that call into the same storage layer.

All new routes are admin-only via `requireAuth` + `requireRole("admin")` (matching today's convention) and validate request bodies with Zod schemas in `shared/schema.ts` or co-located in `server/routes/rules.ts`.

| # | Method | Path | Body | Response | Required role | Schema |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/rules/dashboard` | — | `{ categories: Array<{ key, name, activeCount, draftCount, scheduledCount, emergencyCount, conflictCount, lastChange: { byUserId, at } }> }` | admin | — |
| 2 | GET | `/api/rules/categories/:typeKey` | — | `{ type, policies: Policy[], assignments: PolicyAssignment[], conflicts: Conflict[] }` | admin | — |
| 3 | POST | `/api/rules/policies` | `{ name, policyTypeId, description?, rules, assignments[], effectiveAt?, effectiveUntil?, status: 'draft'|'active' }` | `{ policy, version }` | admin | `createRulePolicySchema` |
| 4 | PATCH | `/api/rules/policies/:id` | partial of above | `{ policy, version }` | admin | `updateRulePolicySchema` |
| 5 | POST | `/api/rules/policies/:id/schedule` | `{ effectiveAt: ISO, effectiveUntil?: ISO, note? }` | `{ policy, version }` | admin | `schedulePolicySchema` |
| 6 | POST | `/api/rules/policies/:id/activate` | `{ note? }` | `{ policy, version }` | admin | — |
| 7 | POST | `/api/rules/policies/:id/rollback` | `{ targetVersionNumber: number, note: string }` | `{ policy, newVersion }` | admin | `rollbackPolicySchema` |
| 8 | GET | `/api/rules/policies/:id/versions` | — | `PolicyVersion[]` | admin | — |
| 9 | GET | `/api/rules/policies/:id/versions/:n/diff?against=:m` | — | `{ added, removed, changed: Array<{ key, from, to }> }` | admin | — |
| 10 | GET | `/api/rules/policies/:id/conflicts` | — | `Conflict[]` | admin | — |
| 11 | POST | `/api/rules/policies/:id/impact-preview` | `{ scope?: { companyId?, locationId?, departmentId?, userId? } }` | `ImpactPreview` | admin | `impactPreviewSchema` |
| 12 | POST | `/api/rules/simulate` | `SimulationInput` | `SimulationOutput` | admin | `simulationInputSchema` |
| 13 | POST | `/api/rules/emergency-overrides` | `{ policyId, scope, reason, startsAt, endsAt, priority? }` | `PolicyAssignment` | admin | `emergencyOverrideSchema` |
| 14 | GET | `/api/rules/emergency-overrides` | — | `PolicyAssignment[]` (active + upcoming) | admin | — |
| 15 | POST | `/api/rules/emergency-overrides/:id/end` | `{ note? }` | `PolicyAssignment` | admin | — |
| 16 | GET | `/api/rules/holiday-calendars` | — | `HolidayCalendar[]` | admin | — |
| 17 | POST | `/api/rules/holiday-calendars` | calendar fields | `HolidayCalendar` | admin | `createHolidayCalendarSchema` |
| 18 | PATCH | `/api/rules/holiday-calendars/:id` | partial | `HolidayCalendar` | admin | — |
| 19 | DELETE | `/api/rules/holiday-calendars/:id` | — | `204` | admin | — |
| 20 | POST | `/api/rules/holiday-calendars/:id/entries` | entry fields | `HolidayCalendarEntry` | admin | `createHolidayEntrySchema` |
| 21 | PATCH | `/api/rules/holiday-calendars/:id/entries/:entryId` | partial | `HolidayCalendarEntry` | admin | — |
| 22 | DELETE | `/api/rules/holiday-calendars/:id/entries/:entryId` | — | `204` | admin | — |
| 23 | GET | `/api/rules/blackout-dates` | optional `?scope=` | `BlackoutDate[]` | admin | — |
| 24 | POST | `/api/rules/blackout-dates` | blackout fields | `BlackoutDate` | admin | `createBlackoutDateSchema` |
| 25 | DELETE | `/api/rules/blackout-dates/:id` | — | `204` | admin | — |
| 26 | GET | `/api/rules/audit?policyId=&action=&from=&to=&page=` | — | `{ entries: AuditLog[], page, total }` | admin | — |

Endpoint-to-screen mapping:
- Dashboard tile data → #1.
- Category detail page → #2, #3, #4, #5, #6, #7, #8, #10, #11.
- Simulator Lab → #12.
- Version History → #8, #9, #7.
- Emergency Center → #13, #14, #15.
- Holiday Calendars → #16–22.
- Blackout Dates → #23–25.
- Audit tab → #26.

(Cross-reference: see UI-UX §3 through §10 for the screens that consume each endpoint.)

---

## 11. Migration & coexistence plan

Phase 2 ships in three sequenced PRs (each independently revertible):

1. **PR-A — Schema + storage:** migrations from §2 + `IStorage` additions in `server/storage.ts`. No new routes, no new UI. Existing code keeps working because every new column is nullable or has a default.
2. **PR-B — `/api/rules/*` surface + simulator/conflict/impact services:** all logic in `server/policyEngine.ts`, `server/services/policySimulation.ts`, `server/services/policyConflicts.ts`, `server/services/policyImpact.ts`, `server/routes/rules.ts`. Legacy routes still exist and still work; they continue to read from `policy_rules` (and now also write a `policy_versions` row on activate, so history starts being recorded).
3. **PR-C — UI:** new pages described in `docs/phase2/ui-ux.md`. The legacy `/rules-controls` route stays mounted but renders a top banner that says "We've moved — open the new Rules Command Center" with a button linking to the new dashboard. After two weeks (configurable) the old route 302-redirects.

Existing callers that keep working unchanged:

- `client/src/pages/rules-controls.tsx` (until the redirect ships in PR-C).
- `server/services/policyEnforcement.ts` — already calls `getEffectivePolicy` and consumes a `rules` object; the additive changes in §3 are backward-compatible.
- The PTO submission flow that consults `enforcePtoBlackoutDates` — keeps reading `rules.blackoutDates`. The new `blackout_dates` table is additionally consulted via a small helper in `policyEnforcement.ts` that merges both sources for the duration of the deprecation window.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Scheduled activation race** between the sweep job and a concurrent admin save. | Sweep job runs in a transaction with `SELECT ... FOR UPDATE` on the policy row. Admin save uses optimistic concurrency on `policies.version`; conflicting save returns `409` with the current version. |
| **Emergency override forgotten to expire.** | (a) `emergencyEndsAt` is required when `isEmergency=true`. (b) Sweep job writes `emergency_expired` audit and clears the active flag in the resolver naturally. (c) Conflict detector flags `emergency_missing_expiry` for windows > 30 days. (d) Daily admin email summary of active overrides (out of scope for Phase 2 but listed here for follow-up). |
| **Simulator drift from real enforcement.** | Simulator does not duplicate enforcement logic — it imports and calls the same `policyEnforcement.ts` functions. A unit test `server/services/__tests__/policySimulation.test.ts` runs each scenario against both `simulateEffectivePolicy` and `getEffectivePolicy(now)` and asserts equality when no scheduled/emergency factors are in play. |
| **Conflict false positives** when two policies are deliberately overlapping (e.g., different scopes that resolve cleanly via priority). | Conflict classifier honors the resolver's tie-break rules and only flags a true ambiguity (same level, same priority). Lower-priority overlaps are `info`, not `warning`. |
| **Impact preview timeout** on a global scope at scale. | 5,000-user hard cap with a fallback `COUNT(*)` estimate. UI shows a "showing first N of M" banner. Long-running previews can be queued via a background job in a future phase. |
| **Migration backfill** of `policy_versions` produces wrong snapshots if a policy is mid-edit at the time of the migration. | Backfill runs in a single transaction and reads `policy_rules.rules` at that instant. Admin UI is taken offline for the window of the migration (announced via maintenance banner). |
| **Audit log volume.** | Each lifecycle event writes ≤1 row. The sweep job is throttled to one emergency-expired row per assignment per expiry. |
| **Holiday/blackout source duplication** between `policy_rules.blackoutDates` and the new `blackout_dates` table during the deprecation window. | Helper `getEffectiveBlackoutDates(user, atTimestamp)` merges both sources and de-duplicates. Removed in a later phase once `policy_rules.blackoutDates` is empty everywhere. |

---

## 13. Open questions for product

These need a decision before PR-A starts.

1. **Retroactive scheduled changes.** When a scheduled change activates at 9am, does it apply to a shift that's already in progress (clocked in at 7am) for that day's overtime calculation? Default proposed: **No, future evaluations only**. Confirm.
2. **Maximum emergency override duration.** Cap proposed at **30 days** (warning at creation, hard error above). Confirm or change.
3. **Holiday calendar bootstrap.** Should we seed a default U.S. federal holiday calendar (10 entries) on first install, or leave the table empty and require admins to create their own?
4. **Conflict acknowledgment persistence.** When an admin dismisses a `warning` conflict, should that ack survive across sessions (new `policy_conflict_acks` table) or only for the current session (in-memory)?
5. **Who can publish?** Today every admin can. Phase 2 introduces a Publish action that has heavier consequences. Should we gate Publish behind a separate `policies.publish` permission, or keep it under blanket `admin`?
6. **Version snapshot trigger.** Snapshot every Save, or only at activate/schedule/rollback? Default proposed: **only at activate/schedule/rollback** — drafts mutate the same `policy_rules` row in place.
7. **Holiday calendar scope precedence.** When two assigned calendars overlap on the same date for the same user (e.g., a location calendar and a department calendar), which wins? Default proposed: **same 5-level precedence as policies**.
8. **Blackout vs. existing approved PTO.** When an admin creates a blackout that conflicts with an already-approved PTO request, do we (a) block the blackout creation, (b) allow it and grandfather the PTO, or (c) allow it and surface a list of PTOs that need re-approval? Default proposed: **(c)**.

---

> ➡️ Continue to [`docs/phase2/ui-ux.md`](./ui-ux.md) for the screen-by-screen UI/UX spec that consumes the endpoints in §10.
