# Rules Command Center — UI/UX Design Spec (Phase 2)

> **Status:** Draft for review. No code or visual prototypes have been produced. This document is the source of truth for what a frontend engineer would build once Task #86 starts.
>
> **Companion document:** [`./architecture.md`](./architecture.md). Each screen below references the API endpoints it consumes by their numbered IDs from architecture §10.

---

## 1. Design system constraints

These rules apply to every screen in the Rules Command Center without exception.

- **Color palette (Ahava):**
  - **Dark Navy `#123047`** — primary text, page header background, top of severity-neutral chips.
  - **Teal `#56b9ca`** — primary accent. CTA buttons, active tab underline, focus rings.
  - **Green `#009972`** — success / "active" status / "added" lines in diffs.
  - **Blue `#1f97d4`** — informational / "scheduled" badges / charts.
  - Severity colors derived from the palette (no new hues): `info` → Blue, `success` → Green, `warning` → existing Shadcn amber token, `error` → existing Shadcn destructive token, `emergency` → Dark Navy on Teal background.
- **Components:** Shadcn UI only (`Card`, `CardHeader`, `CardContent`, `Button`, `Badge`, `Dialog`, `Sheet`, `Select`, `Tabs`, `Table`, `Skeleton`, `Switch`, `Tooltip`, `Alert`, `Form`, `Input`, `Textarea`, `Label`, `Separator`, `Progress`, `Calendar`, `Popover`, `Command`). No custom one-off components for things Shadcn already covers.
- **Layout primitives:** every page uses `<PageHeader />` (`client/src/components/page-header.tsx`) for title/subtitle/actions. Page container is `max-w-6xl` (matches every other admin page in this product). Vertical rhythm is `space-y-6`.
- **Tables:** column headers use `text-xs font-medium uppercase tracking-wider` (matches today's Rules & Controls page). Numeric cells use `tabular-nums`. First column is left-aligned, count/number columns right-aligned.
- **Touch-safe:** every interactive control is at least 40×40px. Dialog primary buttons are full-width on screens narrower than `sm`.
- **Typography:** body 14px, table cells 14px, numerics `tabular-nums`, page title 24px/semibold, section headings 18px/semibold. No drop shadows beyond Shadcn's default Card elevation.
- **Voice:** terse, present tense, no exclamation marks. Errors describe what to do next ("Resolve the conflict before publishing"), not what failed ("Failed to publish").
- **Aesthetic:** enterprise HR. No marketing language, no hero illustrations, no animated gradients.

---

## 2. Information architecture

The Rules Command Center lives at `/rules` (new top-level route) and replaces `/rules-controls` for admins.

Navigation surface:

- **Sidebar nav (sticky, 220px wide, Dark Navy `#123047` background, white text):**
  - **Dashboard** — landing screen, Page A.
  - **Categories** — collapsible group containing the 13 policy categories listed in order below. Clicking a category opens Page B for that category.
  - **Simulator Lab** — Page C.
  - **Emergency Center** — Page E.
  - **Holiday Calendars** — Page H.
  - **Blackout Dates** — Page I.
  - **Audit** — filtered audit log scoped to `targetType='policy'`/`policy_assignment'`/`policy_version`/`holiday_calendar_entry`/`blackout_date`.

The 13 categories appear in this final order (matches the policy hierarchy from operational priority, locked into nav and into the dashboard tile order):

1. **Attendance** — clock-in/out rules, grace periods, rounding.
2. **Overtime** — daily/weekly thresholds, multipliers, double-time.
3. **Breaks** — required-break thresholds, break duration.
4. **PTO Accrual** — accrual rates, caps, carryover.
5. **PTO Requests** — advance notice, max consecutive, blackout integration.
6. **Holidays** — holiday-pay multiplier, holiday OT exclusion.
7. **Payroll** — pay period, day-of-week bonuses, early-arrival bonuses.
8. **Approvals** — approval chains, escalation, auto-approve thresholds.
9. **Alerts & Notifications** — late arrival, no-show, OT, missed clock-out alerting.
10. **Kiosk & Devices** — PIN policy, session timeout, photo verification.
11. **Schedules** — early/late clock-in window, required-shift behavior.
12. **Documents** — pay-stub release rules, retention.
13. **Roles & Permissions** — display only in Phase 2 (read-only; full editor remains under `/permissions`).

**Legacy redirect:** the old `/rules-controls` route stays mounted for backwards-compat but renders a non-dismissable `Alert` of `variant='default'` at the top:

> "Rules & Controls has moved. Open the new Rules Command Center for scheduling, simulation, and emergency overrides." — primary `Button` "Open Command Center" navigates to `/rules`.

After the deprecation window (set by environment flag `VITE_RULES_LEGACY_REDIRECT_DAYS`, default 14) the page issues a `wouter` 302-equivalent redirect to `/rules`.

---

## 3. Page A — Command Center Dashboard

**Route:** `/rules` (default `Dashboard` tab).
**Purpose:** at a glance, every category's health and recent activity, with one-click access to the Category Detail page or to Simulator Lab pre-filled with that category.

### 3.1 Layout

- `<PageHeader title="Rules Command Center" subtitle="Manage every policy. Schedule changes. Simulate impact." />` with an actions slot containing two buttons: **"Open Simulator Lab"** (`variant='outline'`, navigates to Page C) and **"Create Emergency Override"** (`variant='default'`, opens the Page E creation flow as a modal).
- Below the header, a row of four compact `Card` summary tiles full-width (4-column grid on `lg`, 2-column on `sm`):
  - **Active policies** — total count.
  - **Drafts** — total count.
  - **Scheduled changes** — count of policies with `effectiveAt > now` AND `status='active'`. Badge `Blue`.
  - **Live emergency overrides** — count from `/api/rules/emergency-overrides` filtered to in-window. Badge `Dark Navy on Teal`.
- Below summary, the **category grid**: 13 cards in a responsive grid (3 cols `lg`, 2 cols `md`, 1 col `sm`) **in the order from §2**.

### 3.2 Category card

Per card (consumes endpoint #1):

```
┌──────────────────────────────────────┐
│  [icon]  Attendance                  │  ← title row, icon left
│  Last changed by Sarah Cohen, 2h ago │  ← muted small text
│                                       │
│  3 active   1 draft   1 scheduled    │  ← stat row, tabular-nums
│  ●  No emergency override            │  ← optional emergency line, Teal dot if active
│                                       │
│  ⚠ 1 conflict                        │  ← only if conflicts > 0, severity color
│                                       │
│  [ Open ]   [ Open in Simulator ]    │  ← two Buttons, sm variant
└──────────────────────────────────────┘
```

- Counts use `Badge` with these tokens: `active` → `default` (Teal), `draft` → `secondary` (gray), `scheduled` → custom Blue, `emergency` → custom Dark Navy bg with Teal text.
- "Open" navigates to Page B for that category. "Open in Simulator" navigates to Page C with `?policyTypeKey=` pre-set.
- Conflict line is only rendered if `conflictCount > 0`. Click toggles a `Tooltip` listing the first 3 conflict messages from `/api/rules/categories/:typeKey` (endpoint #2).

### 3.3 States

- **Loading:** 13 `Skeleton` cards in the grid, 4 `Skeleton` tiles in the summary row.
- **Empty (fresh install):** the page still renders the 13 cards. Each shows `0 active 0 draft 0 scheduled` and a muted prompt "Create your first policy" linking to Page B.
- **Error (endpoint #1 fails):** Shadcn `Alert variant='destructive'` at the top of the page with a Retry button that re-runs the query. Cards collapse to a single compact "couldn't load summary" row.
- **Conflict severity color usage:** `error` → red dot + red badge; `warning` → amber dot; `info` → blue dot. No emoji — Lucide icons (`AlertTriangle`, `AlertCircle`, `Info`) only.

### 3.4 `data-testid` on this page

- `page-rules-dashboard`
- `card-summary-active`, `card-summary-drafts`, `card-summary-scheduled`, `card-summary-emergencies`
- `card-category-${typeKey}` (e.g., `card-category-attendance`)
- `text-category-last-changed-${typeKey}`
- `badge-category-active-count-${typeKey}`, `badge-category-draft-count-${typeKey}`, `badge-category-scheduled-count-${typeKey}`, `badge-category-emergency-${typeKey}`, `badge-category-conflicts-${typeKey}`
- `button-open-category-${typeKey}`, `button-open-simulator-${typeKey}`

---

## 4. Page B — Category Detail View

**Route:** `/rules/categories/:typeKey`.
**Endpoints:** #2 (initial load), #3/#4 (save), #5 (schedule), #6 (publish), #7 (rollback), #8 (versions), #10 (conflicts), #11 (impact preview), plus #12 (simulate) when the inline preview tab is opened.

### 4.1 Header

`<PageHeader>` with:
- **Title:** category display name (e.g., "Attendance").
- **Subtitle:** one-line description from `policy_types.description`.
- **Active version chip:** `Badge variant='default'` Teal — `v{policies.version}`.
- **Draft chip:** `Badge variant='secondary'` — "Editing draft" (only when there are unsaved changes).
- **Scheduled chip:** `Badge` Blue — "Scheduled · Apr 30, 9:00 AM" (only when `effectiveAt > now`).
- **Actions slot (right-aligned):**
  - **Publish** (`Button variant='default'`) — disabled when conflicts of severity `error` exist OR when no draft changes pending. Tooltip explains why.
  - **Schedule** (`Button variant='outline'`) — opens schedule date/time popover (uses `Calendar` + time `Input`).
  - **Rollback** (`Button variant='ghost'`) — opens the Version History panel pre-scrolled.

### 4.2 Sections (rendered top-to-bottom in this order)

#### 4.2.1 Rule Builder Form

Per-category field map. Each category reuses the shape of the corresponding `DEFAULT_*_RULES` constant from `server/policyEngine.ts` so we never duplicate field metadata. The wizard logic in `getRuleFieldsForType` (`client/src/components/policy-wizard.tsx`) is extracted to `client/src/lib/ruleFieldDefs.ts` and extended to cover all 13 categories.

Form layout: 2-column grid on `md`+, single column on `sm`. Each field is a Shadcn `FormField` with `FormLabel`, `FormControl` (`Input` / `Switch` / `Select`), and `FormDescription` for the rule rationale. Validation errors render under the field via `FormMessage`.

Special handling:
- **Number fields** show min/max in the description.
- **Boolean fields** use `Switch` (touch-safe).
- **List-of-rules fields** (e.g., `dayOfWeekBonuses`, `earlyArrivalBonuses` for the Payroll category) render as a sub-`Card` per entry with an "Add rule" `Button variant='outline'` underneath.

#### 4.2.2 Assignment Scope Picker

A reusable `<AssignmentScopePicker />` (see §11). Shows the current list of assignments as removable `Badge`s. Below the list, an "Add assignment" `Button` opens a `Popover` containing a Shadcn `Command` palette: pick level (Global / Division / Location / Department / Employee) → autocomplete the target. Below each assignment a `Switch` toggles `isEmergency` — flipping it on reveals reason `Textarea` and start/end `Input` fields (this is the lightweight in-line emergency creator; the full Center is on Page E).

#### 4.2.3 Impact Preview Panel

Embeds the reusable `<ImpactPreviewPanel />` (see §10). On every change to the form or assignments, debounced 500ms, the panel calls endpoint #11 with the draft scope and renders:
- Big number — "**142 employees** would be affected if you publish now."
- Two small bar groups — by department and by location.
- A `Button variant='link'` "View affected employees" opens a `Sheet` with the first 25 names and a "Showing 25 of 142" footer.

#### 4.2.4 Conflict Warnings Panel

Embeds the reusable `<ConflictWarningPanel />` (see §10). Renders one `Alert` per conflict from endpoint #10, ordered `error → warning → info`. Each conflict has its severity icon, message, and an "Acknowledge" `Button` (warnings/infos only — errors cannot be acknowledged away).

If at least one `error` conflict is present, the **Publish** button in the header is disabled and shows tooltip: "Resolve the X conflict listed below before publishing." Clicking the disabled button scrolls to the panel.

#### 4.2.5 Simulation Preview Panel

A `Tabs` block with two tabs: **"Resolved policy"** and **"Sample scenario"**.
- **Resolved policy** tab — shows what the rule builder produces for an example employee (defaulting to the page admin themselves), via endpoint #12. Renders the `chain` array from §3.2 of architecture.md as a vertical list of `Card`s — one per assignment level — with the matched one outlined in Teal and skipped ones muted.
- **Sample scenario** tab — adds inputs for a sample punch (clock in/out, break minutes), or a sample PTO request (start/end date, hours), and re-runs simulate. Output mirrors Page C but in compact form.

#### 4.2.6 Version History List

Uses the reusable `<PolicyVersionTimeline />` (see §12). Inline list (last 5) with a "View all" link that navigates to Page D (Version History full screen).

### 4.3 Publish-blocking flow

```
admin clicks Publish
  → if conflicts.error.length > 0:
      button is disabled (handled in §4.2.4) — never reaches click handler
  → if scheduled (effectiveAt > now):
      Dialog: "Schedule this draft to go live on Apr 30, 9:00 AM?" with Cancel / Confirm
  → if not scheduled:
      Dialog: "Publish version v(N+1) now?
               This affects 142 employees (impact preview)."
      with Cancel / Confirm Publish
  → on Confirm: call endpoint #6 (or #5 if scheduling)
  → success toast "Policy v(N+1) published" + reload Page B
  → failure: Alert at top of dialog with the API error message
```

### 4.4 States

- **Loading:** form fields render as `Skeleton` rows; assignment list shows 3 skeleton chips; impact and conflict panels render skeletons.
- **Empty (no policy yet for this category):** centered Card "No policy created for {category} yet — Create your first policy" with a `Button` that creates a Draft and immediately puts the form in edit mode.
- **Save error:** non-blocking inline `Alert variant='destructive'` above the form's primary buttons.

### 4.5 `data-testid`

- `page-category-${typeKey}`
- `text-active-version-${policyId}`, `badge-draft-${policyId}`, `badge-scheduled-${policyId}`
- `button-publish-policy-${policyId}`, `button-schedule-policy-${policyId}`, `button-rollback-policy-${policyId}`
- `form-rule-builder-${typeKey}`
- `panel-assignment-scope`, `panel-impact-preview`, `panel-conflicts`, `panel-simulation`, `panel-version-history`
- `button-add-assignment`, `button-add-bonus-rule`
- `button-acknowledge-conflict-${conflictId}`
- `button-confirm-publish`, `button-cancel-publish`

---

## 5. Page C — Simulator Lab

**Route:** `/rules/simulator` (optional `?policyTypeKey=&userId=&atTimestamp=` query string for deep links from Page A and Page B).
**Endpoint:** #12.

### 5.1 Layout

Two-pane layout on `lg`+: left **Inputs** (`w-1/3`), right **Outputs** (`w-2/3`). On `sm` they stack.

### 5.2 Inputs panel (left)

Card "Simulation inputs" with:
- **Employee** — Shadcn `Command`-backed combobox over `/api/users` (existing endpoint). Required.
- **At date/time** — `Popover` with `Calendar` + a 24-h time `Input`. Defaults to "Now". Required.
- **Department override** — optional Select (defaults to the employee's department). Useful for "what if I moved them?".
- **Location override** — optional Select.
- **Policy categories to simulate** — multi-select chip group (default: all 13).
- **Optional sample punch** — collapsible `Card` with `clockIn`, `clockOut`, `breakMinutes`.
- **Optional sample PTO request** — collapsible `Card` with `startDate`, `endDate`, `hoursPerDay`.
- **Optional sample overtime scenario** — collapsible `Card` with `workDate`, `hoursWorked`.
- **Compare against current Active** — `Switch`, default ON. When on, the request is sent twice and the right pane shows side-by-side.
- Footer: **Run simulation** primary button.

### 5.3 Outputs panel (right)

Per simulated category, a `Card`:

```
┌─────────────────────────────────────────────────────────────┐
│  Attendance                              [v3 · Active]      │
│  Resolved at: Department  →  Acme HQ Nursing                │
│  ─────────────────────────────────────────────────────────  │
│  Resolution chain                                           │
│  ✓ Employee — none                                          │
│  ✓ Department — Acme HQ Nursing  ← matched, Teal outline    │
│  ↳ Location — would have matched, lower priority            │
│  ↳ Division — Acme HQ                                       │
│  ↳ Global — Default                                         │
│  ─────────────────────────────────────────────────────────  │
│  Rule evaluation                                            │
│  • Clock-in 08:07 → rounded 08:00, late (grace 5)           │
│  • Late by 7 min — generates "late_clock_in" alert          │
│  • OT threshold daily 8h — not triggered                    │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 Side-by-side diff

When **Compare against current Active** is ON, each category card shows two columns ("Current Active" left, "Simulated" right) above the "Rule evaluation" section. Differences are highlighted:
- **Added** (key only present in simulated) — left cell muted, right cell `bg-green-500/10` text Green `#009972`.
- **Removed** (key only present in current) — right cell muted, left cell `bg-destructive/10` text destructive.
- **Changed** — both cells with the differing values bolded; an arrow `→` between them in Dark Navy.

A small `Badge` in the card header summarizes: "3 added · 1 changed · 0 removed".

### 5.5 States

- **Loading (after Run):** the right pane shows a skeleton `Card` per requested category.
- **Empty (before Run):** the right pane shows an empty-state `Card` with an icon and the copy: "Pick an employee and a time, then Run simulation. The simulator never writes anything — it's safe to experiment."
- **Error:** `Alert variant='destructive'` at the top of the outputs pane.

### 5.6 `data-testid`

- `page-simulator-lab`
- `combobox-simulator-employee`, `input-simulator-datetime`, `select-simulator-department`, `select-simulator-location`
- `multiselect-simulator-categories`, `switch-simulator-compare`
- `button-run-simulation`
- `card-simulation-result-${typeKey}`
- `text-resolved-level-${typeKey}`, `text-resolved-policy-${typeKey}`
- `row-resolution-chain-${typeKey}-${level}`
- `text-evaluation-${typeKey}-${index}`
- `badge-diff-summary-${typeKey}`

---

## 6. Page D — Version History

**Route:** `/rules/categories/:typeKey/versions` (also reachable via "View all" from Page B §4.2.6).
**Endpoints:** #7 (rollback), #8 (versions list), #9 (diff).

### 6.1 Table

Full-width `Table` inside a `Card`:

| Column | Content |
|---|---|
| Version | `v{versionNumber}` — Teal `Badge` if it's the current active. |
| Created by | `firstName lastName` (from `users` join) — link opens employee profile. |
| Created at | locale date/time, tabular-nums. |
| Note | left-truncated text; full text in `Tooltip` on hover. |
| Activation date | from `effectiveAt` if set; otherwise "—". |
| Emergency | `Badge` Dark Navy + Teal text "Emergency" if `isRollback=false` AND associated with an emergency assignment; otherwise "Rollback" `Badge` if `isRollback=true`; else empty. |
| Diff | `Button variant='outline' size='sm'` "Diff vs current" → opens Diff Viewer modal. |
| Rollback | `Button variant='ghost' size='sm'` "Rollback" — disabled for the current active version. |

Sort default: `versionNumber DESC`. Pagination: 20 rows per page, server-driven.

### 6.2 Diff Viewer modal

Triggered from the Diff column. `Dialog` (`max-w-3xl`):

- Header: "Diff: v3 → v5" with two `Select`s to change either side ("Compare v3 with vN").
- Body: `Tabs` with **"Side-by-side"** and **"Unified"**.
- **Side-by-side**: a 2-column scrollable area; each rule key occupies one row across both columns. Rule keys removed are red-tinted on the left; added keys are green-tinted on the right; changed keys highlight the differing values in both columns.
  - Color tokens: `bg-green-500/10` + text `#009972` for additions; `bg-destructive/10` + text destructive for removals; `bg-blue-500/10` + text `#1f97d4` for "type changed" (rare).
- **Unified**: a single column with `+` / `−` line prefixes in green/red.
- Footer: `Button "Close"` and `Button variant='default' "Rollback to v3"` (only visible if v3 is the current's predecessor, otherwise hidden).

### 6.3 Rollback confirmation modal

Reusable component (see §11). When triggered:

- Header: "Roll back to v3?"
- Body: short paragraph with the version's `note` and `createdAt`. A required `Textarea` with label "Note (required)" — minimum 5 chars (matches API constraint).
- An `<ImpactPreviewPanel />` mini-instance showing how many employees this rollback would affect right now.
- Footer: `Button variant='outline' "Cancel"` and `Button variant='destructive' "Confirm rollback"` — disabled until note is valid.

### 6.4 `data-testid`

- `page-version-history-${typeKey}`
- `table-version-history`
- `row-version-${versionNumber}`, `text-version-note-${versionNumber}`, `badge-version-emergency-${versionNumber}`
- `button-diff-version-${versionNumber}`, `button-rollback-version-${versionNumber}`
- `dialog-diff-viewer`, `tab-diff-side-by-side`, `tab-diff-unified`
- `dialog-rollback-confirm`, `textarea-rollback-note`, `button-confirm-rollback`, `button-cancel-rollback`

---

## 7. Page E — Emergency Override Center

**Route:** `/rules/emergency`.
**Endpoints:** #13 (create), #14 (list), #15 (end).

### 7.1 Live overrides list

Top of page: `Card` "Live emergency overrides" containing a table of overrides where `now ∈ [emergencyStartsAt, emergencyEndsAt)`. Columns:

| Column | Content |
|---|---|
| Policy | "Attendance · Acme HQ Snowstorm Override" — link to Page B for that category. |
| Scope | resolved label, e.g., "Department: Nursing" or "Division: Acme HQ" or "Employee: Sarah Cohen". |
| Reason | truncated, full in `Tooltip`. |
| Started | locale time, tabular-nums. |
| Ends | locale time + a live countdown `Badge` Teal — "Ends in 3h 12m". |
| Created by | name + avatar (Shadcn `Avatar`). |
| End now | `Button variant='destructive' size='sm'` — opens confirm modal. |

Auto-refresh every 60 seconds via TanStack Query refetch interval.

Below this table, a second `Card` "Upcoming overrides" for those scheduled with `emergencyStartsAt > now`, same columns minus the countdown.

### 7.2 "Create override" form

Top-right `Button variant='default'` **"Create override"** opens a `Dialog` (`max-w-2xl`):

1. **Step 1 — Scope:** `<AssignmentScopePicker />` (§11). Required.
2. **Step 2 — Target categories:** multi-select chips of the 13 categories. Required, ≥ 1.
3. **Step 3 — Reason:** `Textarea`, required, min 10 chars. Helper text: "Visible to anyone reviewing the override later."
4. **Step 4 — Window:** two `Popover` date/time pickers for `startsAt` and `endsAt`. Default: now → +24h. Hard cap from architecture §13 open question #2 (default 30 days).
5. **Step 5 — Priority:** `Input type='number'` 0–100, default 100 (so emergencies always outrank normal assignments by default).

Below the form, an inline `<ImpactPreviewPanel />` updates as scope and categories change, showing total affected.

### 7.3 Confirmation modal

After clicking "Create" in the form, a second `Dialog` (`max-w-md`):

> "This will override **142 employees** with the Snowstorm Override across **Attendance, Overtime, Schedules** from Apr 28 4:00 PM until Apr 29 4:00 PM. Continue?"

`Button variant='outline' "Back"` returns to the form. `Button variant='default' "Create override"` calls endpoint #13 and writes the audit row described in architecture §9.

### 7.4 Auto-expire badge state

In the Live list, when `emergencyEndsAt - now < 1 hour`, the countdown badge changes from Teal to amber. When it crosses 0, the row drops out of "Live" on next refetch and a `Toast` fires: "Snowstorm Override expired."

### 7.5 `data-testid`

- `page-emergency-center`
- `table-live-overrides`, `row-override-${id}`, `badge-countdown-${id}`, `button-end-override-${id}`
- `table-upcoming-overrides`
- `button-create-override`, `dialog-create-override`, `textarea-override-reason`, `input-override-priority`
- `dialog-confirm-override`, `text-confirm-impact-count`

---

## 8. Holiday Calendar Manager (Page H)

**Route:** `/rules/holidays`.
**Endpoints:** #16–#22.

### 8.1 Layout

Two columns on `lg`+: left list of calendars (`w-1/3`), right detail of the selected calendar (`w-2/3`).

### 8.2 Calendar list (left)

`Card` with header "Calendars" and a `Button variant='outline' size='sm'` "+ New". Each list item:

```
[●]  Acme U.S. Federal Holidays            12 entries
     Active · 3 locations
```

Click an item to load detail on the right. Active dot is Teal; inactive is muted.

### 8.3 Calendar detail (right)

`Card` with:
- **Header row:** calendar name (inline-editable on click), description (inline-editable Textarea), `Switch` "Active", and a `Button variant='destructive' size='sm'` "Delete" (Confirm modal).
- **Scope assignment subsection:** the same `<AssignmentScopePicker />` from §11 (limited to Division / Location / Department levels — no per-employee).
- **Entries table:**
  - Columns: Date, Name, Recurrence (`Select` cell — None / Annual), Pay multiplier (`Input` cell, optional), Actions (delete icon).
  - Footer: `Button variant='outline' size='sm'` "+ Add entry" — appends an editable row.
- **Save bar (sticky bottom):** appears only when there are unsaved changes. `Button variant='outline' "Discard"` and `Button variant='default' "Save changes"`.

### 8.4 States

- **Loading:** left list skeleton rows; right pane skeleton.
- **Empty:** left "No calendars yet — Create one"; right "Select a calendar from the left."
- **No entries:** the entries table renders the header row plus a single muted row "No holiday entries yet."

### 8.5 `data-testid`

- `page-holiday-calendars`
- `button-new-calendar`, `list-calendars`, `item-calendar-${id}`
- `input-calendar-name-${id}`, `switch-calendar-active-${id}`, `button-delete-calendar-${id}`
- `table-calendar-entries`, `row-calendar-entry-${entryId}`, `input-entry-date-${entryId}`, `input-entry-name-${entryId}`, `select-entry-recurrence-${entryId}`, `input-entry-multiplier-${entryId}`, `button-delete-entry-${entryId}`
- `button-add-calendar-entry`, `button-save-calendar`, `button-discard-calendar`

---

## 9. Blackout Date Manager (Page I)

**Route:** `/rules/blackouts`.
**Endpoints:** #23–#25.

### 9.1 Layout

Single-column page. `<PageHeader />` with title "Blackout Dates" and an actions slot containing `Button variant='default' "+ New blackout"`.

### 9.2 List

Full-width `Table`:

| Column | Content |
|---|---|
| Range | "Apr 28 → May 1" |
| Scope | "Division: Acme HQ" / "Location: West Tower" / "Department: Surgery" |
| Reason | text |
| Created | date + creator name |
| Actions | trash icon → confirm modal |

Sortable by Range (default DESC).

### 9.3 Create form

`Dialog` (`max-w-lg`) with:
- Start date (`Calendar`)
- End date (`Calendar`)
- Reason (`Textarea`, required, min 5 chars)
- Scope (`Select`: Division / Location / Department) → second `Select` to pick the target

After valid submission, an inline `<ConflictWarningPanel />` runs against existing **approved** PTO requests (read from `/api/time-off-requests?status=approved`). If any approved PTO falls inside the new blackout, the panel renders:

> "**3 approved PTO requests** overlap this blackout. They will need to be re-approved by a manager."

with a `Button variant='link' "View affected requests"` listing them in a Sheet. The user can still click the primary `Button variant='default' "Create blackout"` — per architecture §13 open question #8, default is option (c): allow with a flag and surface the list. The button copy changes to "Create blackout · 3 requests need re-approval" when conflicts exist.

### 9.4 `data-testid`

- `page-blackout-dates`
- `button-new-blackout`, `dialog-new-blackout`
- `input-blackout-start`, `input-blackout-end`, `textarea-blackout-reason`, `select-blackout-scope-level`, `select-blackout-scope-target`
- `panel-blackout-conflicts`, `button-view-affected-pto`
- `button-create-blackout`, `button-cancel-blackout`
- `table-blackouts`, `row-blackout-${id}`, `button-delete-blackout-${id}`

---

## 10. Reusable panels — `<ConflictWarningPanel />` & `<ImpactPreviewPanel />`

Both are pure presentational components that take their data via props (so they can be used inside a draft form before the policy exists).

### 10.1 `<ConflictWarningPanel />`

```ts
interface ConflictWarningPanelProps {
  conflicts: Conflict[];                           // from architecture §6
  onAcknowledge?: (conflictId: string) => void;
  onResolve?: (conflict: Conflict) => void;        // optional CTA per conflict
  emptyState?: React.ReactNode;                    // override default empty
  testIdPrefix?: string;                           // defaults to 'panel-conflicts'
}
```

Render rules:
- Group by severity. Render order: `error` → `warning` → `info`.
- One Shadcn `Alert` per conflict with the severity icon (`AlertTriangle` for error, `AlertCircle` for warning, `Info` for info).
- `error` severity: red background tint, no Acknowledge button; an `onResolve` button if provided shows as `Button variant='outline' size='sm'` "Resolve".
- `warning` and `info`: `Button variant='ghost' size='sm'` "Acknowledge" — calling `onAcknowledge` removes the row optimistically.
- **Empty state:** small Teal-on-light-Teal `Alert variant='default'` with an `Info` icon and copy "No conflicts detected. Safe to publish."

### 10.2 `<ImpactPreviewPanel />`

```ts
interface ImpactPreviewPanelProps {
  policyId?: string;
  draftScope?: { companyId?: string; locationId?: string; departmentId?: string; userId?: string };
  policyTypeKey: string;
  showByDepartment?: boolean;     // default true
  showByLocation?: boolean;       // default true
  defaultView?: 'count' | 'names'; // default 'count' — see architecture §13 question
  testIdPrefix?: string;
}
```

Render rules:
- Internally calls endpoint #11 with TanStack Query, debounced 500ms when props change.
- Shows a single big number (`text-3xl font-semibold tabular-nums`) — "**142** employees affected".
- Two horizontal bar mini-charts (Shadcn `Progress` per row, sized to fit the panel). Colors: Teal for departments, Blue for locations.
- "View affected employees" `Button variant='link'` opens a `Sheet` with the `sample` array (first 25), then a footer "Showing 25 of 142".
- **Empty:** "No employees would be affected — this assignment is unscoped or matches nobody."
- **Loading:** `Skeleton` for the big number plus 3 bar rows.
- **Severity color usage** is reused inside the warning when the count exceeds the cautious threshold (default 500): the count badge flips from neutral to amber.

### 10.3 "Acknowledge to proceed" pattern

Used in Pages B and E. Pattern:
1. Render the `<ConflictWarningPanel />` as described.
2. The Publish/Create button is disabled if any `error` exists and shows tooltip "Resolve the X errors below."
3. If only `warning` conflicts exist, the button stays enabled but its click triggers an extra `Dialog` listing the warnings with checkboxes "I acknowledge this risk" — all must be checked to enable the modal's primary button.

### 10.4 Empty / loading / error standards (cross-page)

- **Empty:** muted `Card` with a Lucide icon centered, one-line title, one-line description, and at most one CTA.
- **Loading:** `Skeleton` placeholders, never a spinner alone.
- **Error:** Shadcn `Alert variant='destructive'` with the API error message and a `Button variant='outline' size='sm'` "Retry".

---

## 11. Reusable components — Rollback & Assignment Scope Picker

### 11.1 `<RollbackConfirmationModal />`

```ts
interface RollbackConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  policyTypeKey: string;
  targetVersion: PolicyVersion;
  onConfirm: (note: string) => Promise<void>;
}
```

- Title: `"Roll back to v{targetVersion.versionNumber}?"`
- Body:
  - Read-only summary of the target version (`note`, `createdAt`, `createdBy`).
  - Required `Textarea` "Note" (min 5 chars). `FormMessage` on blur.
  - Embedded `<ImpactPreviewPanel policyId={policyId} policyTypeKey={policyTypeKey} />`.
- Footer: `Button variant='outline' "Cancel"` and `Button variant='destructive' "Confirm rollback"` — disabled until note ≥ 5 chars; in flight shows spinner.

### 11.2 `<AssignmentScopePicker />`

```ts
interface AssignmentScopePickerProps {
  value: AssignmentEntry[];                         // existing AssignmentEntry from policy-wizard.tsx
  onChange: (next: AssignmentEntry[]) => void;
  allowEmergency?: boolean;                         // default false
  allowedLevels?: Array<'global'|'division'|'location'|'department'|'employee'>;
  emergencyDefaults?: { startsAt: string; endsAt: string; priority: number };
  testIdPrefix?: string;                            // defaults to 'picker-assignment-scope'
}
```

- Renders existing entries as removable Shadcn `Badge`s (matching today's `PolicyAssignmentBadges` styling in `rules-controls.tsx`).
- "Add assignment" `Button variant='outline' size='sm'` opens a `Popover` with a `Command` palette: first pick level (filtered by `allowedLevels`), then autocomplete the target (driven by the existing `/api/companies`, `/api/locations`, `/api/departments`, `/api/users` endpoints).
- When `allowEmergency=true`, after picking a target the popover reveals a `Switch` "Emergency override" + reason `Textarea` + start/end inputs + priority `Input`.

### 11.3 `<EffectiveDatePicker />`

```ts
interface EffectiveDatePickerProps {
  value: { effectiveAt: Date|null; effectiveUntil: Date|null };
  onChange: (next: EffectiveDatePickerProps['value']) => void;
  minDate?: Date;       // default: now
  testIdPrefix?: string;
}
```

- Pair of Shadcn `Popover` + `Calendar` + 24-h time `Input`.
- A small Teal `Badge` shows "Now" when `effectiveAt` is null/in the past, "Scheduled" with the formatted date when in future.
- An optional `Switch` "Auto-end" reveals the `effectiveUntil` controls.

---

## 12. Component inventory (new reusable components to add)

| Component | Path (proposed) | Props | Used by |
|---|---|---|---|
| `<PolicyVersionTimeline />` | `client/src/components/policy/policy-version-timeline.tsx` | `policyId: string; limit?: number; onRollback?: (v: PolicyVersion) => void` | Page B (§4.2.6), Page D (§6) |
| `<RuleDiffViewer />` | `client/src/components/policy/rule-diff-viewer.tsx` | `from: PolicyVersion; to: PolicyVersion; mode: 'unified'\|'side-by-side'` | Page D Diff modal (§6.2) |
| `<ImpactPreviewPanel />` | `client/src/components/policy/impact-preview-panel.tsx` | see §10.2 | Pages B, E, I, Rollback modal |
| `<ConflictWarningPanel />` | `client/src/components/policy/conflict-warning-panel.tsx` | see §10.1 | Pages B, C, E, I |
| `<SimulationResultPanel />` | `client/src/components/policy/simulation-result-panel.tsx` | `result: SimulationOutput['resolutions'][number]; compare?: SimulationOutput['resolutions'][number]` | Page C (§5.3) |
| `<EmergencyOverrideForm />` | `client/src/components/policy/emergency-override-form.tsx` | `defaultScope?; onSubmit: (data) => Promise<void>` | Page E (§7.2), Page A header action |
| `<AssignmentScopePicker />` | `client/src/components/policy/assignment-scope-picker.tsx` | see §11.2 | Pages B, E, H, I |
| `<EffectiveDatePicker />` | `client/src/components/policy/effective-date-picker.tsx` | see §11.3 | Page B header (Schedule), Page E |
| `<RollbackConfirmationModal />` | `client/src/components/policy/rollback-confirmation-modal.tsx` | see §11.1 | Pages B, D |
| `<RuleBuilderForm />` | `client/src/components/policy/rule-builder-form.tsx` | `policyTypeKey: string; value; onChange; errors?` | Page B (§4.2.1); reused inside `policy-wizard.tsx` so the wizard and the new page share field maps. |

`client/src/lib/ruleFieldDefs.ts` (new): the extracted-and-extended `getRuleFieldsForType(...)` map covering all 13 categories, sourced from the `DEFAULT_*_RULES` constants in `server/policyEngine.ts`. The existing `policy-wizard.tsx` is updated to import from this file instead of redefining the map.

---

## 13. Accessibility & `data-testid` plan

### 13.1 Naming convention (matches `fullstack-js` skill)

- Interactive elements: `{action}-{target}` — e.g., `button-publish-policy`, `input-override-priority`, `select-rollback-version`, `link-open-category`.
- Display elements: `{type}-{content}` — e.g., `text-active-version`, `badge-emergency-active`, `text-conflict-message`.
- For per-row identifiers, append the unique entity id: `row-version-${versionNumber}`, `card-category-${typeKey}`, `badge-assignment-${assignmentId}`.

### 13.2 Required test-ids per page (selection)

Page A: `page-rules-dashboard`, `card-summary-active`, `card-category-${typeKey}`, `button-open-category-${typeKey}`.
Page B: `page-category-${typeKey}`, `text-active-version-${policyId}`, `button-publish-policy-${policyId}`, `panel-conflicts`, `panel-impact-preview`, `panel-version-history`.
Page C: `page-simulator-lab`, `button-run-simulation`, `card-simulation-result-${typeKey}`, `text-resolved-policy-${typeKey}`.
Page D: `table-version-history`, `row-version-${n}`, `dialog-rollback-confirm`, `textarea-rollback-note`, `button-confirm-rollback`.
Page E: `page-emergency-center`, `table-live-overrides`, `button-create-override`, `badge-countdown-${id}`.
Page H: `page-holiday-calendars`, `button-new-calendar`, `table-calendar-entries`.
Page I: `page-blackout-dates`, `button-new-blackout`, `panel-blackout-conflicts`, `button-create-blackout`.

### 13.3 Keyboard & focus

- Every `Dialog` uses Shadcn's default focus trap. The first focusable element is the primary input (e.g., the note `Textarea` in the rollback modal); the close button is the last tab stop.
- `Sheet` panels (e.g., affected-employees list) restore focus to the trigger button on close.
- `Tabs` are keyboard-navigable with arrow keys (Shadcn default).
- Severity colors are paired with Lucide icons so colorblind admins still see the severity at a glance.
- Live countdowns in the Emergency Center use `aria-live='polite'` so screen readers announce the change once per minute (not every second).
- Tables marked with `<caption className='sr-only'>` for screen-reader context.

### 13.4 Color contrast

- Body text on white meets WCAG AA at minimum (the four palette colors all pass against white at 14px+).
- Teal `#56b9ca` is used on Dark Navy for emergency badges (the only place white text on Teal is avoided since contrast is borderline at small sizes).
- Severity badges always include an icon, so contrast does not rely on color alone.

---

## 14. Open design questions for product

Mirror of architecture.md §13 plus design-only decisions.

1. **Scheduled badge color.** Default proposed: Blue `#1f97d4`. Alternative: a derived "future Teal" lighter tint. Choose one for visual consistency with the Live emergency badge.
2. **Impact preview default view.** Show "**142** employees" (count) by default, with a "View affected employees" link, or always show the first 5 names inline? Default proposed: **count by default**, names behind the link. Faster page load; fewer privacy concerns.
3. **Category icons.** Each category needs a Lucide icon for the dashboard tile. Proposed: Attendance `Clock`, Overtime `AlarmClock`, Breaks `Coffee`, PTO Accrual `CalendarPlus`, PTO Requests `CalendarDays`, Holidays `PartyPopper`, Payroll `DollarSign`, Approvals `GitBranch`, Alerts `Bell`, Kiosk `Tablet`, Schedules `CalendarRange`, Documents `FileText`, Roles `Shield`. Confirm or substitute.
4. **"Acknowledge to proceed" friction.** For warnings, do we require a single bulk acknowledgement or one checkbox per warning? Default proposed: **one checkbox per warning** for clarity.
5. **Diff viewer default mode.** Side-by-side or unified? Default proposed: **side-by-side** (matches Git review tools admins are likely familiar with).
6. **Emergency creation entry points.** Two exist (Page A header button and Page E primary). Should the Page A button open the same `<EmergencyOverrideForm />` Dialog, or navigate to Page E? Default proposed: **open Dialog** for fewer clicks.
7. **Legacy `/rules-controls` deprecation banner copy.** Confirm the wording in §2 above is acceptable for HR admins, who may have bookmarked the old route.
8. **Holiday entry pay multiplier visibility.** Show the multiplier column always, or only when at least one entry uses it? Default proposed: **always**, to make the field discoverable.

---

> ⬅️ Back to [`docs/phase2/architecture.md`](./architecture.md) for the schema, resolver, and API definitions backing each screen.
