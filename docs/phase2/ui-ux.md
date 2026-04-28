# Rules Command Center — UI/UX Design Spec (Phase 2)

> Companion document: [`docs/phase2/architecture.md`](./architecture.md). Every screen described here is wired to the routes and engines defined there; cross-references are inline.

This spec is the source of truth for what the Rules Command Center looks like and how it behaves. A frontend developer should be able to build it from this document alone, with the architecture spec as the API contract.

---

## 1. Design system constraints

These rules are **non-negotiable**. The Command Center inherits the existing Ahava design language (`replit.md` "Corporate Design System") and tightens the conventions for an enterprise-grade admin surface.

- **Colors (Ahava palette only)**:
  - Dark Navy `#123047` — primary text, page backgrounds in dark mode, header bars.
  - Teal `#56b9ca` — primary accent, active state on tabs, CTA buttons (`Button` default variant maps to this in our theme).
  - Green `#009972` — success, "Active" badge background, positive deltas.
  - Blue `#1f97d4` — informational, "Scheduled" badge, simulator chips, links.
  - Severity colors (used **only** for warnings/errors, never decorative): `text-amber-600` for `medium`, `text-destructive` for `high`. Emergency banners use a destructive-toned background.
- **Components**: Shadcn UI only (`Card`, `Button`, `Badge`, `Tabs`, `Dialog`, `Sheet`, `Form`, `Select`, `Switch`, `Table`, `Alert`, `Skeleton`, `Tooltip`, `Progress`, `Calendar`, `Popover`, `Separator`, `Accordion`). No new third-party UI deps.
- **Typography**: existing Inter stack. Numeric values (counts, version numbers, hours) use `tabular-nums`. Table headers use `text-xs font-medium uppercase tracking-wider` per existing convention.
- **Layout**: `PageHeader` component at the top. Page container is `max-w-6xl` (admin standard). Section rhythm is `space-y-6`. Internal card padding stays `p-4` to `p-6` consistent with existing admin pages.
- **Touch safety**: every interactive control ≥ 36px tall (Shadcn default). Click targets in tables use the standard `h-8 w-8` icon button.
- **Aesthetic**: enterprise HR. No emojis. No marketing language. Empty states are explanatory, not playful.
- **Dark mode**: all new components must declare both light and dark variants when using arbitrary colors. Tokens from `tailwind.config.ts` (e.g. `bg-card`, `bg-muted`) are preferred.

---

## 2. Information architecture

### 2.1 Navigation order

The Command Center owns 13 rule categories, exposed as a sticky left nav rail (Page A & B share it). Listed in their final navigation order:

1. **Attendance** — clock-in/out, grace period, rounding
2. **Breaks** — required break length and timing
3. **Auto Clock-Out** — stale-punch sweep behavior
4. **Overtime** — daily/weekly thresholds, multipliers
5. **PTO Accrual** — accrual rate, caps, carryover
6. **Holiday Calendars** — opens the Holiday Calendar Manager (Page H)
7. **Blackout Dates** — opens the Blackout Date Manager (Page I)
8. **Approval Chains** — approval workflows for PTO/exceptions
9. **Kiosk Restrictions** — kiosk PIN, photo, session timeout
10. **Payroll Rounding** — pay period, bonuses, rounding
11. **Department Overrides** — sub-view filtered to department-scoped assignments across categories
12. **Employee Overrides** — sub-view filtered to employee-scoped assignments across categories
13. **Emergency Policy Overrides** — opens the Emergency Override Center (Page E)

The first 5 + 8 + 9 + 10 (8 categories) map 1:1 to existing `policy_types` keys. **Breaks**, **Auto Clock-Out**, and **Overtime** are surface views that filter and group fields out of the existing `attendance` and `payroll` rule sets — they edit subsets of the same underlying `policy_rules` rows. This keeps the underlying schema and enforcement code unchanged (architecture §1.6).

### 2.2 Global tabs

A top-level tab bar inside the page (Shadcn `Tabs`) sits beneath the `PageHeader`:

- **Dashboard** (default landing — Page A)
- **Simulator Lab** (Page C)
- **Emergency Center** (Page E)
- **Holiday Calendars** (Page H)
- **Blackout Dates** (Page I)
- **Audit** (filtered audit log scoped to `targetType IN (policy, policy_assignment, holiday_calendar, blackout_list)`)

The Category Detail (Page B) and Version History (Page D) are sub-routes reached by clicking into a category card from the Dashboard or Simulator. They use the same persistent left nav rail, so the admin can hop between categories without losing the tab they're on.

### 2.3 Legacy redirect

`client/src/App.tsx` keeps the route `/rules-controls` but renders the new `RulesCommandCenterPage` instead of the existing `RulesControlsPage`. Sidebar menu items in `client/src/components/app-layout.tsx` continue to point at `/rules-controls`. The legacy file is renamed to `rules-controls-legacy.tsx` and held in the repo through Phase 2.1 (architecture §11.1).

---

## 3. Page A — Command Center Dashboard

**URL**: `/rules-controls` (default tab `dashboard`).

### 3.1 Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ PageHeader: "Rules Command Center"   subtitle: "Manage every policy …" │
├──────┬─────────────────────────────────────────────────────────────────┤
│ NAV  │ Tabs: [ Dashboard | Simulator | Emergency | Holidays | Black… ] │
│ rail ├─────────────────────────────────────────────────────────────────┤
│      │ Live Emergency Banner (only when activeEmergencyCount > 0)      │
│      ├─────────────────────────────────────────────────────────────────┤
│ A1   │ Card grid (3 columns desktop, 2 tablet, 1 mobile)               │
│ A2   │  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│ ...  │  │ Attendance │  │ Breaks     │  │ Auto C/Out │  ...           │
│ A13  │  │  …card…    │  │  …card…    │  │  …card…    │                │
│      │  └────────────┘  └────────────┘  └────────────┘                │
└──────┴─────────────────────────────────────────────────────────────────┘
```

- Left nav rail: same `w-56 shrink-0` rail used today in `rules-controls.tsx`. Each item is a `Button variant="ghost"` with the category icon (`lucide-react`) and label, with the active item using the Teal accent.
- Tab strip uses Shadcn `Tabs` immediately below the header.

### 3.2 Category card

Each card uses `Card` with the following structure:

```
CardHeader:
  Icon (lucide) — category-specific
  CardTitle (text-base)
  Right-aligned: ConflictBadge (only if conflictCount > 0)
CardContent:
  Row: Active count    | Draft count    | Scheduled count
       (Badge variant="default" Green)  (Badge variant="secondary" Slate)  (Badge variant="outline" Blue)
  Row: "Live emergency overrides: N"  (Badge destructive when > 0; hidden when 0)
  Row: "Last changed by {name} · {relativeTime}"
CardFooter:
  Button "Open" (primary) — navigates to Page B (`/rules-controls/category/:typeKey`)
  Button "Open in Simulator" (variant="outline") — opens Page C with this category preselected
```

`data-testid` per card: `card-category-${typeKey}` and per CTA: `button-open-category-${typeKey}`, `button-simulate-category-${typeKey}`.

### 3.3 Severity color usage

- **Green** badge = something is healthy (`active` policy exists for this category, no conflicts).
- **Blue** badge = scheduled future change present (informational).
- **Amber** text or icon = `medium`-severity conflict.
- **Destructive** background or text = `high`-severity conflict OR live emergency override active.

### 3.4 States

- **Loading**: 13 `Skeleton` cards (same grid layout) shown for up to 1.5s, then content fades in.
- **Empty** (fresh install with zero policies): every card shows "No active policy yet" with a primary CTA "Set up {category}". Empty state never blocks navigation.
- **Error**: `Alert variant="destructive"` at the top of the grid, "Couldn't load category status. [Retry]". The grid still renders skeletons until retry succeeds.

### 3.5 Wired endpoint

`GET /api/rules/categories` (architecture §10 route #1). One round trip serves the whole grid.

---

## 4. Page B — Category Detail View

**URL**: `/rules-controls/category/:typeKey`.

### 4.1 Header

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← Back to Dashboard                                                    │
│                                                                        │
│ {Category Icon} {Category Name}                                        │
│                                                                        │
│ Chips:                                                                 │
│   ●Active v{N}  ◐Draft  ⏰Scheduled (effective {date})                 │
│                                                                        │
│ Right-aligned actions:                                                 │
│   [ Save Draft ]  [ Schedule ]  [ Publish Now ]  [ Rollback… ]         │
└────────────────────────────────────────────────────────────────────────┘
```

- The chips use Shadcn `Badge`: Active = Green (`bg-[hsl(160_100%_30%)]`), Draft = Slate, Scheduled = Blue, with the version number using `tabular-nums`.
- Disabled-state rules:
  - **Save Draft** disabled if the rule form has no validation errors AND no unsaved changes.
  - **Schedule** disabled if the form is invalid OR there is no draft yet.
  - **Publish Now** disabled if the form is invalid OR conflict check returned `blockingCount > 0` and the user hasn't acknowledged the warnings (see §4.6).
  - **Rollback** disabled if there is exactly one version (nothing to roll back to).

### 4.2 Section order

Below the header, six stacked sections separated by `Separator`:

1. **Rule Builder** (the editable form, §4.3)
2. **Assignment Scope** (§4.4)
3. **Impact Preview** (§4.5)
4. **Conflict Warnings** (§4.6)
5. **Simulation Preview** (§4.7)
6. **Version History** (§4.8 — links to Page D)

### 4.3 Rule Builder form

Per category, the form renders the field map from `getRuleFieldsForType(typeKey)` in `client/src/components/policy-wizard.tsx` lines 39–85, **extended** to cover the additional categories. Reuse the existing field definitions verbatim where present; for the new sub-views (Breaks, Auto Clock-Out, Overtime, Holidays, Blackout, Department Overrides, Employee Overrides) the form is composed of subsets of the underlying `attendance` / `payroll` / `pto` rule sets:

| Category | Underlying rules subset |
|----------|------------------------|
| Attendance | `gracePeriodMinutes`, `roundingRule`, `roundingIntervalMinutes`, `requirePhotoVerification`, `allowEarlyClockIn`, `earlyClockInMinutes` |
| Breaks | `requireBreakAfterHours`, `breakDurationMinutes` (subset of attendance rules) |
| Auto Clock-Out | `autoClockOutEnabled`, `autoClockOutAfterHours` (subset of attendance rules) |
| Overtime | `otThresholdDaily`, `otThresholdWeekly`, `overtimeMultiplier`, `doubleTimeThresholdDaily`, `doubleTimeMultiplier` (split between attendance + payroll) |
| Payroll Rounding | full payroll rules including `dayOfWeekBonuses`, `earlyArrivalBonuses` |
| PTO Accrual | full PTO rules |
| Holiday Calendars | not a rule — opens Page H |
| Blackout Dates | not a rule — opens Page I |
| Approval Chains | full approvals rules |
| Kiosk Restrictions | full kiosk rules |
| Department/Employee Overrides | a tabular view (no rule fields), filtering all assignments by `assignment.departmentId IS NOT NULL` / `assignment.userId IS NOT NULL` |

Form layout uses Shadcn `Form` + `useForm` + `zodResolver` per the fullstack-js skill. Validation messages render inline beneath each field. Number fields use `Input type="number"` with `tabular-nums`. Booleans use `Switch`. Selects use Shadcn `Select`.

A muted subline beneath the form title shows: "Editing draft (v{nextVersionNumber}). Active is v{activeVersionNumber}."

### 4.4 Assignment Scope picker

Reusable component `<AssignmentScopePicker>` (component inventory §12). UI:

```
Apply this policy to:
  ( ) Global (all divisions)
  (•) Division          [ Select division ▼ ]
  ( ) Location          [ Select location ▼ ]
  ( ) Department        [ Select department ▼ ]
  ( ) Specific employee [ Search employees… ]

Existing assignments (chips):
  [Engineering ×]  [Mountain View ×]  [+ Add assignment]
```

Each chip is a Shadcn `Badge` with an `X` button. Clicking `+ Add assignment` opens a Shadcn `Dialog` with the picker. The component supports a `disabled` prop for view-only contexts.

### 4.5 Impact Preview panel

Uses `<ImpactPreviewPanel>` (§12). Renders:

- A summary line: "**{totalUsers} employees** would be affected by this draft."
- Two horizontal bar lists: by Location and by Department, showing top 5 with counts. A "Show all" link expands to full lists (paginated via route #17).
- A disclosure: "Show employees" reveals the first 50 names from `sample[]` in a 2-column grid.
- A button "Refresh impact preview" recomputes via route #16.

Empty state: "No employees match the current scope yet." Loading state: 3-row `Skeleton`.

### 4.6 Conflict Warnings panel

Uses `<ConflictWarningPanel>` (§12). Renders one `Alert` per conflict from `analyzeDraftConflicts` (architecture §6):

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ HIGH — Overlapping windows                                │
│ "Holiday OT v3" overlaps with "Holiday OT v4" for           │
│   42 employees in Mountain View between Jan 1–Jan 5.        │
│ Related policies: Holiday OT v3 (link), v4 (link)           │
│ [ Acknowledge ]                                             │
└─────────────────────────────────────────────────────────────┘
```

Severity → color mapping:
- `high` → `Alert variant="destructive"` + bold "HIGH" pill.
- `medium` → `Alert` with `border-amber-500` + "MEDIUM" pill.
- `low` → `Alert variant="default"` + "INFO" pill.

**Publish-blocking flow**: The `Publish Now` and `Schedule` buttons stay disabled while there are unacknowledged `high` conflicts. Each `high` conflict has an "Acknowledge" button that adds its `class+relatedPolicyIds` hash into a local set, which is then sent as `acknowledgedConflicts` in the publish/schedule request body. The backend re-runs the conflict check and rejects the request if any high conflict isn't in that set, so the UI cannot be bypassed by stale state.

Empty state: "No conflicts detected — safe to publish."

### 4.7 Simulation Preview panel

Inline mini-version of Page C (Simulator Lab). Three quick inputs (employee, date, optional sample punch/PTO request) and a single output card showing what the resolved policy would be **if this draft were active**. A link "Open in Simulator Lab" navigates to the full Page C with the same inputs preserved via URL params.

### 4.8 Version History list (preview)

The last 5 versions displayed inline: version number, created by, created at, note, and a "Diff vs Active" button. A "View full history" button navigates to Page D.

### 4.9 `data-testid` plan for Page B

- `page-category-detail-${typeKey}`
- `text-active-version-${policyId}`, `text-draft-version-${policyId}`
- `button-save-draft-${policyId}`, `button-schedule-${policyId}`, `button-publish-${policyId}`, `button-rollback-${policyId}`
- `panel-impact-preview`, `panel-conflict-warnings`, `panel-simulation-preview`, `panel-version-history`
- `badge-conflict-${conflictId}`, `button-acknowledge-conflict-${conflictId}`

---

## 5. Page C — Simulator Lab

**URL**: `/rules-controls/simulator`.

### 5.1 Layout

Two-column layout (lg breakpoint and above), stacked on smaller screens:

```
┌──────────────────────┬────────────────────────────────────────────────┐
│ INPUTS               │ OUTPUTS                                         │
│                      │                                                 │
│ Employee  [combobox] │  ┌─ Resolved policy ──────────────────────────┐ │
│ Date      [date]     │  │ Attendance: "Standard Attendance" v4       │ │
│ Time      [time]     │  │ Resolved at: department-level (Engineering)│ │
│                      │  │ via emergency override: NO                 │ │
│ Department override  │  │ Effective from 2026-01-01 (no end)         │ │
│ Location override    │  └────────────────────────────────────────────┘ │
│                      │                                                 │
│ ▾ Sample punch       │  ┌─ Resolution chain ─────────────────────────┐ │
│   Clock-in   [time]  │  │ employee   — no match                       │ │
│   Clock-out  [time]  │  │ department — MATCHED (Standard Attendance) │ │
│   Break (m)  [num]   │  │ location   — skipped                       │ │
│                      │  │ division   — skipped                       │ │
│ ▾ Sample PTO request │  │ global     — skipped                       │ │
│   Start, End         │  └────────────────────────────────────────────┘ │
│                      │                                                 │
│ ▾ Sample overtime    │  ┌─ Outcome ──────────────────────────────────┐ │
│   Hours today, week  │  │ Allowed: ✓                                 │ │
│                      │  │ Late: NO   Late minutes: 0                 │ │
│ [ Run simulation ]   │  │ Hours worked: 8.25                         │ │
│                      │  │ Overtime hours: 0.25                       │ │
│                      │  └────────────────────────────────────────────┘ │
│                      │                                                 │
│                      │  ┌─ Side-by-side vs Active ──────────────────┐ │
│                      │  │  See §5.2 below                            │ │
│                      │  └────────────────────────────────────────────┘ │
└──────────────────────┴────────────────────────────────────────────────┘
```

Inputs render with Shadcn `Form` + `Combobox`, `Calendar`+`Popover` for date, native `Input type="time"`, and `Accordion` for the optional sample sections. The "Department override" and "Location override" inputs let the admin simulate "what if this employee were in another department for a moment" without touching their record.

### 5.2 Side-by-side comparison

Two columns labeled **Currently Active** and **What you'd get** showing the same outcome card. Differences are highlighted:

- Fields with same value → muted gray text.
- Fields where the value differs → background `bg-blue-500/10` with a pill in the right margin: "+0.5h" (green) or "−5min" (red), using the Ahava Green/Destructive tones.
- Fields only present on one side render as `<missing>` in the other.

### 5.3 Wired endpoint

`POST /api/rules/simulate` (architecture §10 route #20). One call returns both the projected (against draft) and current (against active) results, computed inside `simulatePolicies()` (architecture §5).

### 5.4 `data-testid` plan

- `panel-simulator-inputs`, `panel-simulator-outputs`
- `input-simulator-user`, `input-simulator-date`, `input-simulator-time`
- `button-run-simulation`
- `text-simulator-resolved-policy`, `text-simulator-resolution-trace`, `text-simulator-outcome`
- `panel-simulator-comparison`, `text-comparison-field-${fieldName}`

---

## 6. Page D — Version History

**URL**: `/rules-controls/category/:typeKey/policy/:policyId/history`.

### 6.1 Table

Shadcn `Table` with these columns:

| Column | Notes |
|--------|-------|
| Version # | `tabular-nums`, with a Green dot if it's the currently active version |
| Created by | First/last name + role badge |
| Created at | Localized timestamp + relative ("3 hours ago") |
| Note | The `note` field; truncated to ~80 chars with full text on hover via `Tooltip` |
| Activated | Activation date if known, blank otherwise |
| Emergency? | `Badge variant="destructive"` if this version was published as emergency, else blank |
| Diff | `Button variant="ghost" size="sm"` — opens the Diff Viewer modal |
| Rollback | `Button variant="outline" size="sm"` — opens Rollback confirmation modal |

Sorting is fixed to "newest first." Pagination: 25 per page using Shadcn `Pagination`.

### 6.2 Diff Viewer modal

Shadcn `Dialog`, full width on lg, scrollable. Header: "Diff: v{from} → v{to}" with a `Select` to pick the comparison version on either side.

Body uses a key-value diff renderer (`<RuleDiffViewer>` §12):

```
gracePeriodMinutes:  5    →    10   ← changed
roundingRule:        nearest_15   (unchanged)
breakDurationMinutes: removed ← was: 30
holidayCalendarIds: + added ← ["holiday-cal-uuid"]
```

- Removed lines: red text, `bg-red-500/10`.
- Added lines: green text, `bg-green-500/10`.
- Changed lines: amber text with the old → new arrow.
- Unchanged lines: muted, collapsible behind an `Accordion` set to closed by default for diffs > 20 fields.

Footer: a `Close` button.

### 6.3 Rollback confirmation modal

Shadcn `Dialog` with the following fields:

```
Roll back to v{N}?
  This will create a new version v{latest+1} that copies v{N}'s rules.
  History is preserved — v{latest} stays in the timeline.

  Reason / note (required):
  [ Textarea, min 1 character ]

  [ Cancel ]   [ Confirm rollback ]
```

The Confirm button is disabled until the textarea has content. On submit, calls route #8 (`POST /api/rules/policies/:policyId/rollback/:versionNumber`). On success, closes the modal, refetches version list, shows a toast "Rolled back to v{N} (now at v{newVersionNumber})."

### 6.4 `data-testid` plan

- `table-version-history-${policyId}`, `row-version-${versionNumber}`
- `button-diff-version-${versionNumber}`, `button-rollback-version-${versionNumber}`
- `dialog-rollback-${policyId}`, `input-rollback-note`, `button-confirm-rollback`

---

## 7. Page E — Emergency Override Center

**URL**: `/rules-controls/emergency`.

### 7.1 Live overrides list

`Card` titled "Live overrides" with a Shadcn `Table`:

| Column | Notes |
|--------|-------|
| Category | Policy type with icon |
| Policy | Linked name + version |
| Scope | "Global" / "Division: …" / "Location: …" / "Department: …" / "Employee: …" |
| Reason | Truncated; tooltip on hover |
| Started | Time + relative |
| Ends in | Live-counting countdown (`react-use` interval-based or a small `useEffect` with `setInterval(1000)`) — "2h 14m" |
| Created by | Name |
| Actions | `End now` button (sets `emergency_ends_at = now()`, audited as `emergency.ended_manually`) |

A persistent banner across the entire Command Center reads "{N} live emergency override(s) — view details" linking here when count > 0. Banner uses destructive background.

### 7.2 Create override form

`Card` titled "Create override" with these inputs (single-page form, no wizard — speed matters in an emergency):

```
Category    [ Select policyType ▼ ]
Base policy [ Select policy of that type ▼ ]   (defaults to the currently active one)

Scope       [ AssignmentScopePicker — see §11 ]
Priority    [ Number 0–100, default 100 ]      (so emergency outranks even other emergencies if needed)

Reason *    [ Textarea — required ]
Starts at   [ Date + time, default = now ]
Ends at *   [ Date + time, no default; quick-set buttons "+1h", "+8h", "+24h", "+7d" ]

[ Preview impact ]   [ Create override ]
```

**Validation**:
- Reason: min 1 char.
- Ends at: must be after Starts at.
- Scope: at least one level selected (or explicit "Global").

The `Preview impact` button opens an `ImpactPreviewPanel` modal (component §10) showing who will be affected before commit.

### 7.3 Confirmation modal

When `Create override` is clicked, a Shadcn `Dialog` appears:

```
Create emergency override for {N} employees?
  This will take effect at {start} and auto-expire at {end}.
  The policy will outrank all normal department/location rules
  for these employees during this window.

  [ Cancel ]   [ Create override ]
```

The Create button is `variant="destructive"` to convey weight.

### 7.4 Auto-expire badge

In the live list, when `emergency_ends_at` passes, the row's countdown becomes "Expired" (slate badge) and the Sweep job (architecture §4.3) eventually writes the `emergency.expired` audit row. The row stays visible in the list for 24h after expiry, then drops off; "View expired (last 30 days)" button opens a separate table.

### 7.5 `data-testid` plan

- `table-live-emergencies`, `row-emergency-${assignmentId}`
- `text-emergency-countdown-${assignmentId}`
- `button-end-emergency-${assignmentId}`
- `form-create-emergency`, `input-emergency-reason`, `input-emergency-ends-at`
- `button-emergency-preview-impact`, `button-emergency-create`

---

## 8. Holiday Calendar Manager (Page H)

**URL**: `/rules-controls/holiday-calendars`.

### 8.1 Layout

Two-pane: left list of calendars, right detail of selected calendar.

```
┌────────────────────┬─────────────────────────────────────────────┐
│ My Calendars       │ {Calendar name}              [ Edit name ] │
│ + New calendar     │                                             │
│ ▸ US Federal       │ Scope: Division "Ahava Medical Center"     │
│ ▸ Ahava Holidays   │ Description: ...                           │
│ ▸ NY State         │                                             │
│                    │ Entries:                                    │
│                    │  ┌──────────────────────────────────────┐  │
│                    │  │ Date      Name           Recurrence  │  │
│                    │  │ 2026-01-01 New Year's    yearly      │  │
│                    │  │ 2026-07-04 Independence  yearly      │  │
│                    │  │ 2026-11-26 Thanksgiving  yearly      │  │
│                    │  │ + Add entry                          │  │
│                    │  └──────────────────────────────────────┘  │
│                    │                                             │
│                    │ Used by: 3 PTO policies, 1 payroll policy  │
│                    │ [ View dependents ]                         │
└────────────────────┴─────────────────────────────────────────────┘
```

### 8.2 CRUD flows

- **Create calendar**: opens a `Dialog` with name, scope (`AssignmentScopePicker` limited to global or division), description, and a starter list of entries.
- **Add entry**: inline row at the bottom of the entries table with Date picker, name input, recurrence `Select` (`none` | `yearly`), and `is_paid` `Switch`.
- **Delete**: trash icon per row with `Dialog` confirmation. If the calendar is referenced by any active policy (`Used by` count > 0), the confirm modal warns "This calendar is referenced by N policies. Removing it may change PTO/holiday calculations." with a checkbox "I understand."

### 8.3 Wired endpoints

Routes #19, #19a–d in architecture §10.

### 8.4 `data-testid` plan

- `list-holiday-calendars`, `item-holiday-calendar-${id}`
- `button-new-calendar`, `dialog-new-calendar`
- `table-calendar-entries`, `row-calendar-entry-${entryId}`
- `button-add-entry`, `button-delete-entry-${entryId}`

---

## 9. Blackout Date Manager (Page I)

**URL**: `/rules-controls/blackout-dates`.

Same two-pane layout as Page H, scoped to PTO blackout date lists. Each list contains date **ranges** (start + end) rather than single dates.

### 9.1 Conflict warning

When an admin adds a new range (or creates a new list referenced by an active PTO policy), the backend cross-checks `time_off_requests` for `status='approved'` requests overlapping the range. If any exist, a `ConflictWarningPanel` (§10) renders inline:

```
⚠ MEDIUM — 4 approved PTO requests fall inside this blackout
  • Jane Doe — 2026-01-02 to 2026-01-04
  • John Smith — 2026-01-03 to 2026-01-03
  • ...
  These existing approvals are not auto-revoked. Future requests in this window will be blocked.
  [ Acknowledge ]
```

Acknowledgement is required to save.

### 9.2 `data-testid` plan

- `list-blackout-lists`, `item-blackout-list-${id}`
- `table-blackout-ranges`, `row-blackout-range-${rangeId}`
- `button-add-range`, `panel-blackout-conflict-${listId}`

---

## 10. Conflict Detector & Impact Preview panels (reusable)

These two panels are used in Pages B, C, and E. Both are presentational components — they take props, render UI, and emit callbacks; they never fetch on their own.

### 10.1 `<ConflictWarningPanel>` props

```ts
interface ConflictWarningPanelProps {
  conflicts: ConflictReport["conflicts"];     // architecture §6.2
  acknowledgedIds: Set<string>;                // hash of class+relatedPolicyIds
  onAcknowledge: (id: string) => void;
  onIgnore?: (id: string) => void;             // for `low` severity only
  emptyMessage?: string;
}
```

Severity → color rules: `high` = destructive `Alert`, `medium` = amber border, `low` = default. Each conflict has a "View details" disclosure showing `affectedUserIds` (count + first 10 names with "Show all" link to a modal). The "acknowledge to proceed" pattern: for `high` severity, an `Acknowledge` button appears; for `medium`/`low`, an `OK, got it` button just dismisses inline. The parent component is responsible for blocking the publish button while `acknowledgedIds.size < blockingCount`.

Empty state: "No conflicts detected." in muted text.

### 10.2 `<ImpactPreviewPanel>` props

```ts
interface ImpactPreviewPanelProps {
  result: ImpactPreviewResult | null;          // architecture §7.1
  isLoading?: boolean;
  onRefresh?: () => void;
  onShowAllUsers?: () => void;                 // navigates to paginated list
}
```

When `result.totalUsers === 0`, render "No employees match this scope." When `result.truncated`, the names disclosure shows the first 50 names plus a "+ {totalUsers - 50} more" link that calls `onShowAllUsers`.

---

## 11. Reusable component specs

### 11.1 Rollback confirmation modal

Already specified in §6.3. Component exported as `<RollbackConfirmationModal>`:

```ts
interface RollbackConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  fromVersion: number;            // current latest
  toVersion: number;              // version being rolled back to
  onConfirm: (note: string) => Promise<void>;
}
```

Required note (min 1 char). Confirm button uses `variant="destructive"` to convey weight; disabled while note is empty or submission is in flight.

### 11.2 Assignment scope selector

```ts
interface AssignmentScopePickerProps {
  value: AssignmentScope;          // { companyId?, locationId?, departmentId?, userId? } — exactly one or none for global
  onChange: (scope: AssignmentScope) => void;
  disabledLevels?: Array<"global" | "division" | "location" | "department" | "employee">;
  showGlobalOption?: boolean;      // default true
  data-testid prefix              // e.g. "assignment-scope-emergency"
}
```

UI: 5 radio rows (`global`, `division`, `location`, `department`, `employee`). Each row except `global` reveals a Shadcn `Select` (or `Combobox` for employees) with the appropriate options once selected. Validation: radio must be picked; the dependent select must have a value (except for `global`).

---

## 12. Component inventory

New reusable components introduced in this work, all under `client/src/components/rules/`:

| Component | Props sketch |
|-----------|--------------|
| `<RulesCommandCenterPage />` | Top-level page; owns tab state and the left nav rail. |
| `<CategoryDashboardCard />` | `{ category, stats, onOpen, onSimulate }` — Page A card |
| `<CategoryDetailView />` | `{ typeKey, policyId? }` — Page B layout |
| `<RuleBuilderForm />` | `{ typeKey, defaults, value, onChange, errors }` — wraps Shadcn `Form` |
| `<AssignmentScopePicker />` | §11.2 |
| `<ImpactPreviewPanel />` | §10.2 |
| `<ConflictWarningPanel />` | §10.1 |
| `<SimulationResultPanel />` | `{ result, comparison, isLoading }` — used both inline (B) and standalone (C) |
| `<PolicyVersionTimeline />` | `{ policyId, versions, activeVersion, onDiff, onRollback }` |
| `<RuleDiffViewer />` | `{ from, to, fields }` — §6.2 diff modal body |
| `<RollbackConfirmationModal />` | §11.1 |
| `<EmergencyOverrideForm />` | `{ defaultPolicyTypeKey?, onCreated }` — Page E form |
| `<EmergencyOverrideList />` | `{ overrides, onEnd }` — Page E table with countdowns |
| `<HolidayCalendarManager />` | top-level for Page H |
| `<BlackoutDateManager />` | top-level for Page I |
| `<EffectiveDatePicker />` | `{ value, onChange, minDate? }` — date+time picker w/ quick-set chips ("Now", "+1h", "+24h", "Next Monday 8am") |

---

## 13. Accessibility & data-testid plan

### 13.1 `data-testid` patterns

Project convention from `replit.md` and the fullstack-js skill:

| Element type | Pattern |
|--------------|---------|
| Buttons | `button-{action}-{target}`, e.g. `button-publish-policy-${policyId}`, `button-acknowledge-conflict-${conflictId}` |
| Inputs | `input-{purpose}`, e.g. `input-rollback-note`, `input-emergency-reason`, `input-simulator-user` |
| Selects | `select-{purpose}` |
| Switches | `switch-{purpose}` |
| Display text | `text-{content}`, e.g. `text-active-version-${policyId}`, `text-emergency-countdown-${assignmentId}` |
| Badges | `badge-{type}-${id}`, e.g. `badge-conflict-${conflictId}`, `badge-emergency-${assignmentId}` |
| Tables | `table-{name}` and rows `row-{name}-${id}` |
| Cards/panels | `card-{name}` / `panel-{name}` |
| Dialogs | `dialog-{purpose}-${id?}` |

Every Page A card, every Page B section, every Diff modal field, every Emergency row gets a stable `data-testid` so the e2e test in implementation step 7 (Task #86) can drive the full flow.

### 13.2 Keyboard & focus rules

- All Shadcn dialogs use `Dialog`, which provides focus trap and ESC-to-close out of the box. The Rollback modal must move focus to the textarea on open.
- The left nav rail items are `<button>` elements (focusable via Tab). `Enter` activates.
- Form fields follow the standard label-association pattern via Shadcn `Form`. All labels are associated with their controls via `id`/`htmlFor` (handled by Shadcn `FormField`).
- Conflict acknowledgement buttons must be reachable via Tab from the publish button area and announce their state via `aria-live="polite"` ("Conflict acknowledged. Publish is now enabled." / "1 unacknowledged conflict remains.").
- Emergency countdown text uses `aria-live="off"` (it changes every second; we don't want screen readers reading every tick). The total time remaining is announced once when the page loads via `aria-label` on the row.
- Color is never the only carrier of meaning. Severity badges always pair color with the literal text "HIGH" / "MEDIUM" / "INFO". Active vs Draft chips have icons (●/◐) in addition to color.

---

## 14. Open design questions for product

Decisions needed from product before implementation begins. Each lists the proposed default and the alternatives.

1. **Color of the "Scheduled" badge.** Proposed: Ahava Blue `#1f97d4`. Alternatives: muted slate, amber. *The choice should not collide with "Informational" use elsewhere.*
2. **Impact preview default disclosure.** Proposed: counts + breakdowns visible by default; employee names hidden behind a "Show employees" disclosure to reduce sensitive data exposure on screen. Alternative: names visible by default (more transparency, more PII on screen).
3. **Emergency override max duration.** Proposed: 30-day soft cap (warning at 14 days, hard limit at 30). Alternative: no cap.
4. **Diff viewer default expand depth.** Proposed: changes visible, unchanged collapsed. Alternative: everything expanded for full audit visibility.
5. **Sticky left nav rail vs collapsing rail.** Proposed: sticky always visible at lg+, becomes a `Sheet`-style drawer at md and below. Alternative: collapsing per the existing employee profile sidebar pattern.
6. **Where Department/Employee Override sub-views live.** Proposed: dedicated entries in the left nav rail (#11 and #12 in §2.1). Alternative: tabs inside each category detail page.
7. **Should the simulator allow simulating a future date relative to a *scheduled* policy that's not yet live?** Proposed: yes — that's the point of scheduling preview. The simulator's `atTimestamp` input is unrestricted. Alternative: clamp to "now" with a separate "scheduled-date preview" mode for clarity.
8. **What appears under "Department Overrides" / "Employee Overrides" left-nav entries.** Proposed: a flat table grouping every assignment with `departmentId` (or `userId`) non-null across all policy types, with click-through to the corresponding category detail. Alternative: separate detail pages per scope.
