# Employee Lifecycle Automation — UI/UX Design Spec (Phase 3)

> **Status:** Draft for review. No frontend code has been written. Implementation of the four downstream tasks is gated on this spec and on the companion `docs/phase3/architecture.md` being approved.
>
> **Companion document:** [`./architecture.md`](./architecture.md).

---

## 1. Information architecture

Every Phase 3 surface lives inside an existing page; we do not introduce new top-level routes or sidebar entries. The goal is that an admin who already knows how to use Phase 2's Rules & Controls and the existing Employees page can find the new features without retraining.

### 1.1 Employees page (`client/src/pages/employees.tsx`)

The employee detail drawer today has these tabs (`client/src/pages/employees.tsx:817-827`): `Basic Info | Employment | Pay Setup | Time Clock Settings | PTO/Leave | Schedule | Documents | History/Audit`.

Phase 3 adds two tabs at the appropriate place:

- **`Onboarding`** — inserted after `Employment`. Visible only when an `onboarding_checklists` row exists for this employee, OR (for admins) always with an empty-state CTA "Start onboarding now."
- **`Offboarding`** — inserted after `Schedule`. Visible only when an `offboarding_checklists` row exists, OR (for admins on active employees) always, with an empty-state CTA "Initiate offboarding."

The `Schedule` tab gains a small "Template: <name>" badge in its header when all 7 days of the employee's schedule share the same `scheduleTemplateId`, with a "linked / mixed / customized" indicator (see §7).

The `Documents` tab gains an inline "Required documents" section at the top, listing each rule that applies to this employee with a Valid / Missing / Overdue pill — the same data the missing-document detector uses, so the two surfaces never disagree.

The employees **list** view gains:
- A "Certification status" filter (Valid / Expiring soon / Expired / Any).
- A "Onboarding status" filter (In progress / Complete / Cancelled / None).
- A "Set role from rule" badge in the role column for any employee whose role currently matches an active `role_assignment_rule` and who does not have a manual override (UI: small icon next to the role pill, tooltip "Set by rule: <ruleName>").

### 1.2 Profile page (`client/src/pages/profile.tsx`)

The profile page currently shows the employee's own basic info, employment, and PTO summary. Phase 3 adds two read-only sections (employees can view their own):

- **`Certifications`** — list of the employee's certifications with status pills.
- **`PTO anniversary history`** — placed inside the existing PTO summary block. Read-only table of `pto_anniversary_adjustments` rows for this employee.

### 1.3 Rules & Controls (`client/src/pages/rules-controls.tsx`)

Today the page is the Phase 2 Policy Editor / Assignment Manager. Phase 3 adds new sub-sections on the same page using the existing left-rail navigation pattern. New sub-sections, in order:

1. **Required Documents**
2. **Auto Role Assignment**
3. **Schedule Templates**
4. **Review Cycles**
5. **Onboarding Templates**
6. **Offboarding Templates**

Each sub-section reuses the same shadcn `Card` + `Table` layout the Phase 2 sections use, so the page looks like a unified control center, not a grab-bag of new screens.

### 1.4 Alerts page (`client/src/pages/alerts.tsx`)

Today the page has a single `Table` of alerts with severity / type / employee / message / status / created columns and `typeLabels` / `severityColors` lookup objects (`client/src/pages/alerts.tsx:216-260`). Phase 3 only **extends** those lookup objects — it does not change the page's layout.

New `type` values added to `typeLabels`:

- `missing_document` → "Missing document"
- `certification_expiring` → "Certification expiring"
- `certification_expired` → "Certification expired"
- `review_due` → "Performance review due"
- `onboarding_overdue` → "Onboarding task overdue"
- `onboarding_stalled` → "Onboarding stalled"
- `offboarding_overdue` → "Offboarding task overdue"
- `offboarding_blocking_termination` → "Offboarding blocking termination"

Each new alert row gets a context-aware "Action" link in the existing actions cell:

| Alert type | Action label | Deep link |
|---|---|---|
| `missing_document` | "Upload now" | `/employees?employeeId=…&tab=documents&focus=<documentType>` |
| `certification_expiring` / `certification_expired` | "Renew" | `/employees?employeeId=…&tab=basic&section=certifications` (admin) or `/profile?section=certifications` (employee) |
| `review_due` | "Mark complete" | `/employees?employeeId=…&tab=history&focus=review-<reminderId>` |
| `onboarding_overdue` / `onboarding_stalled` | "Open checklist" | `/employees?employeeId=…&tab=onboarding` |
| `offboarding_overdue` / `offboarding_blocking_termination` | "Open checklist" | `/employees?employeeId=…&tab=offboarding` |

Existing severity colors apply (`severityColors` already covers `low/medium/high/critical`); no new entries are needed.

A simple type filter dropdown is added above the table — the existing pattern in Rules Command Center is reused.

### 1.5 Sidebar

No changes. Every Phase 3 surface is reachable from existing sidebar entries (Employees, Profile, Rules & Controls, Alerts).

---

## 2. Onboarding wizard UI

### 2.1 Launch path

- **From "Add employee"** (existing button on `/employees`): the existing dialog stays exactly the same. After the form is submitted and the user is created, a success modal replaces the current "User created with temporary password X" toast. The success modal:
  - Shows the temporary password with a copy button.
  - Shows a "Onboarding started — N tasks created" line with a primary "View checklist" button that opens the new Onboarding tab on the employee's drawer.
  - Has a secondary "Close" button.
  - If the materializer failed, the modal still shows the temp password (since user creation succeeded) and surfaces the error inline with a "Start onboarding manually" button.
- **From "Start onboarding now"** (admin-only empty state on the Onboarding tab for an existing employee with no checklist): opens a small dialog asking which template to use (if more than one exists), then opens the same wizard.

### 2.2 HR's view (the Onboarding tab on the employee drawer)

Two-column layout:

**Left column (60%): step list grouped by category**
- Section headers: `Account` | `Paperwork` | `Training` | `Equipment` | `Introduction` (only categories with at least one task render).
- Each task row shows:
  - Status pill (Pending / Complete / Skipped / Overdue).
  - Title.
  - Owner role pill (System / New hire / HR / Manager).
  - Due date, with "Overdue by N days" in destructive color when relevant.
  - Required / Optional pill.
  - Inline action buttons:
    - For pending HR-owned tasks: "Mark complete," "Skip…" (opens reason modal).
    - For pending system tasks: read-only.
    - For pending new-hire-owned tasks: "Mark complete on behalf" (admin only, audit-logged), "Skip…".
- Drag handle for reorder is *not* offered on instances (instances are derived from the template); reorder happens in the template editor.

**Right column (40%): summary panel**
- Big circular progress (computed from `computeOnboardingProgress`), e.g., "12 / 18 required complete (66%)".
- "Start date" (from `hireDate`).
- "Days since start" counter.
- "Optional tasks: 3 / 5 done".
- "Cancel onboarding" button at the bottom (admin only) — opens a confirm dialog requiring a reason.
- A "Audit trail" expander showing the most recent task state changes (timestamp, actor, action).

### 2.3 New hire's view (their first login on `/profile`)

When the logged-in employee has an `in_progress` onboarding checklist with at least one `ownerRole='new_hire'` pending task, a banner appears at the top of `/profile`:

> "Welcome! You have N onboarding tasks to finish."
> [View my onboarding] (primary)

Clicking opens a focused page (`/profile?section=onboarding`) showing only the `new_hire`-owned tasks for the employee, with the same step layout as the HR view but no other-owner tasks visible. Each task can be:

- Marked complete (the row disappears with a small celebration micro-animation if it was the last required task).
- For document-typed tasks: tapping "Mark complete" opens the existing document upload dialog with the document type pre-filled.
- Skipped — only tasks with `isRequired=false` show a "Skip" button on this view; required tasks the employee can't do themselves should not be assigned `ownerRole='new_hire'` in the template.

### 2.4 Completion celebration

When the last required task moves to `complete` (or `skipped`), the checklist flips to `status='complete'`. The HR drawer shows a confetti header (small, single occurrence, can be dismissed) and the new-hire `/profile` banner is replaced with "Onboarding complete — welcome aboard!" for 7 days, then disappears.

### 2.5 Empty / loading / error states

- **Empty (no template found):** "No onboarding template is set up for this employee's company. [Create template] (admin)" — links to Rules & Controls → Onboarding Templates.
- **Loading:** standard shadcn `Skeleton` rows mirroring the section layout (3 skeleton rows per category).
- **Error (load failed):** inline error card with "Retry" button; the existing employee detail tabs remain usable.

### 2.6 Template editor (Rules & Controls → Onboarding Templates)

- Left rail lists templates (with default badge); "+ New template" button.
- Right pane: template metadata (name, description, company scope, default toggle, active toggle), then a sortable table of tasks with columns: Order (drag handle) / Title / Owner / Category / Due offset (days from hire) / Required / Document type / Actions.
- Inline "+ Add task" row at the bottom of the table.
- Saving a template does not retroactively rebuild existing checklists — a banner near the save button reminds the admin: "Changes apply to new hires from now on."

---

## 3. Offboarding workflow UI

### 3.1 Trigger

- "Initiate offboarding" appears as a destructive-secondary button on the employee drawer (admin only) for employees with no existing offboarding checklist.
- Clicking opens a dialog: "Termination date" (date picker), "Template" (selector — defaults to the resolved default), an optional "Reason" textarea. Submit creates the checklist and switches the drawer to the new "Offboarding" tab.
- Setting `terminationDate` directly on the Employment tab also fires this trigger automatically (server-side hook in `PATCH /api/users/:id`). The UI surfaces a one-time confirm: "Setting a termination date will also start the offboarding checklist. [OK / Cancel]".

### 3.2 Offboarding tab (drawer)

Same two-column layout as onboarding, with:

**Left column: tasks grouped by category** (`Access | Equipment | Pay | Documentation | Exit interview`).

Per-task row additions vs. onboarding:
- "Blocks deactivation" pill on tasks with `blocksDeactivation=true`.
- "Due before / Due on / Due after" relative to the termination date.

**Right column: summary panel**
- Termination date (display only — to change it, edit the Employment tab).
- Days remaining (or "Past termination by N days" in destructive color).
- Tasks that block deactivation: "X / Y complete."
- A primary, destructive **"Deactivate account"** button.
  - Disabled (with tooltip "X required tasks remain") whenever any `blocksDeactivation=true` task is `pending`.
  - Enabled when all blocking tasks are `complete` or `skipped`.
  - Click opens a confirm dialog: "This will log <employee> out of all sessions and prevent future logins. Continue?"
- A "Account is deactivated since <date>" pill (instead of the button) once `deactivatedAt` is set. A super-admin sees a small "Reactivate" link.
- "Audit trail" expander identical to onboarding's.

### 3.3 Empty / loading / error states

- **Active employee, no checklist, admin view:** the empty state with "Initiate offboarding" CTA.
- **Active employee, no checklist, manager view:** tab is hidden entirely.
- **Loading / error:** same patterns as onboarding.

### 3.4 Template editor (Rules & Controls → Offboarding Templates)

Identical structure to onboarding templates with these differences:

- The Owner column allows `HR | Manager | IT | Finance | System` (not `New hire`).
- Each task row has a "Blocks deactivation" toggle.
- Due offset accepts negative numbers (rendered as "N days before termination").

---

## 4. Certifications UI

### 4.1 Profile page section (employee, read-only)

A new card titled "Certifications" near the bottom of `/profile`. For each certification:

- Name, issuer (subdued), issue date — expiration date.
- Status pill:
  - **Valid** — neutral / muted color, no icon.
  - **Expiring soon** — amber, clock icon, "Expires in N days" inline.
  - **Expired** — destructive, red, alert icon, "Expired N days ago".
  - **Archived** — hidden by default; a "Show archived" toggle reveals.
- If a `documentId` exists, a "View document" link.

Empty state: "No certifications on file. Contact HR to add one."

### 4.2 Admin / HR section (employee detail drawer)

Same data, but the Certifications card lives inside the drawer's `Basic Info` tab (we do not add a new tab solely for certifications — most employees have 0–2 of them). Each row has Edit / Archive icons.

"+ Add certification" button opens a dialog with: Name, Issuer, Issue date, Expiration date (optional), Notes, Document upload (optional). Saving auto-runs the status detector for that certification.

Editing uses the same dialog pre-filled. Archiving is soft-delete (`status='archived'`).

### 4.3 List view filter

The employees list page gets a "Certification status" filter (in the existing filter bar). When a status is selected, the list shows only employees with at least one certification in that status.

### 4.4 Empty / loading / error states

- **Empty:** "No certifications added yet."
- **Loading:** 2 skeleton rows.
- **Error:** inline error with "Retry"; the rest of the profile/drawer remains usable.

### 4.5 Status pill rendering rules

Use existing `Badge` variants:
- Valid → `secondary`.
- Expiring soon → custom amber class (matching the "warning" treatment Phase 2 already uses for thresholds).
- Expired → `destructive`.
- Archived → `outline` with `text-muted-foreground`.

---

## 5. Missing-document and certification alert cards

On `/alerts`, missing-document and certification alerts use the existing alert table row (no separate card layout — the page is a table). What changes is the action cell:

- **Missing document** row: action button "Upload now" (primary, small). On click, navigates to `/employees?employeeId=…&tab=documents&focus=<documentType>`. The Documents tab listens for the `?focus` query param and pre-opens the upload dialog with the right type pre-selected.
- **Certification expiring** row: action button "Renew" (primary, small). Navigates to the drawer's Basic Info tab and scrolls to the Certifications card, with the relevant row outlined for 2 seconds.
- **Certification expired** row: same "Renew" action; the row's severity pill is the existing `critical` variant.

The alert message text follows the same pattern Phase 2 uses (concise + key data inline). Examples:
- "Missing required document: Form W-9 (required for employees in <Department>)"
- "Certification 'Forklift Operator' expires in 7 days"
- "Certification 'CPR' expired 14 days ago"

---

## 6. Auto role assignment UI

Lives inside Rules & Controls → Auto Role Assignment.

### 6.1 Rule list

Table columns: Priority | Name | Conditions summary | Target role | Active? | Updated | Actions.

The "Conditions summary" cell renders a compact human-readable form: e.g., `employmentType is 'manager' AND department in ['Ops', 'Eng']`. Long summaries truncate with a tooltip showing the full expression.

Buttons in the page header:
- **+ New rule**.
- **Re-evaluate all employees** — opens a confirm dialog explaining the action and showing the current count of active employees that would be evaluated. After confirm, returns immediately with a toast "Re-evaluation started" and shows a small inline progress chip ("Evaluating…") that polls until done; on completion the chip changes to "Re-evaluation complete: X changed, Y unchanged."

### 6.2 Rule editor (modal)

Sections, top to bottom:

1. **Identity** — Name, Description.
2. **Conditions** — a stack of condition rows, each row: `Field` selector (whitelist from §2.6 of the architecture spec) → `Operator` selector (`is`, `is not`, `is one of`, `is not one of`, `exists`, `does not exist`) → `Value` input (text, multi-select, or hidden for exists/not-exists). A "+ Add condition" button appends a row. A toggle at the top: "Match all (AND)" / "Match any (OR)". (Nesting is not surfaced in v1; the JSON DSL supports it but the UI keeps a flat AND/OR for simplicity.)
3. **Outcome** — `Target role` selector (employee / manager / admin).
4. **Priority** — number input, default 100, with a hint "Lower numbers run first."
5. **Test rule** — paired controls: an employee picker + a "Run test" button. Output panel shows: "Would match: yes / no" and, if yes, "Would change role from <X> to <Y>" or "No change (already <Y>)" or "No change (employee has manual override)."
6. **Active toggle**.

Save and Cancel at the bottom. Save validates that at least one condition exists.

### 6.3 Manual override indicator on the employee profile

On the employee drawer's Basic Info tab, the Role field shows:

- The current role pill.
- One of three small badges below it:
  - "Set by rule: <ruleName>" — when role matches a rule and no manual override exists.
  - "Manually set on <date>" — when `roleManuallyOverriddenAt` is non-null.
  - (no badge) — when no rule matches and no manual override.

A "Clear override" link is shown when an override exists (admin only). Clicking it clears `roleManuallyOverriddenAt` and re-runs `applyRoleForUser` on save, then refreshes the badge.

### 6.4 Empty / loading / error states

- **Empty:** "No role assignment rules yet. [+ New rule]".
- **Loading:** skeleton table rows.
- **Error:** inline error with "Retry".
- **Re-evaluate-all in flight, page navigated away and back:** the inline progress chip re-renders from the existing job's status (read via `GET /api/jobs/:id` — implementer reuses whatever job-status pattern the team adopts; if none exists, the chip simply re-fetches the rule list and shows the latest counts).

---

## 7. Schedule templates UI

Lives inside Rules & Controls → Schedule Templates.

### 7.1 Template list

Table: Name | Description | Used by (employee count) | Active? | Updated | Actions.

The "Used by" cell is a count of employees with at least one `employee_schedules` row pointing at this template; clicking opens a side panel with the list (and a "Apply to more / Remove" action).

### 7.2 Template editor (right pane on the same page)

A 7-day weekly grid:
- One row per day Monday–Sunday.
- Per row: a "Workday" toggle (off = day off), `Start time` and `End time` inputs (15-minute step), a small "Copy from above" link.
- Below the grid, summary line: "40 hours / week across 5 workdays."

Save / Cancel at the bottom of the editor.

### 7.3 Apply dialog

Triggered from the template list ("Apply") and from individual employees' Schedule tab ("Apply template").

- Step 1 — Choose template (skipped when triggered from a template's Apply button).
- Step 2 — Choose employees:
  - Single mode: a search picker (single-select).
  - Bulk mode: a multi-select with filters (Company, Location, Department, Role).
  - "Selected: N employees" summary at the bottom.
- Step 3 — Choose mode:
  - **Replace** (radio): "Replaces the employee's current schedule entirely." A small warning banner appears: "This deletes the employee's existing schedule rows."
  - **Merge** (radio): "Overwrites only the days defined by the template; days marked 'off' in the template clear those days from the employee."
- Step 4 — Confirm: shows a preview ("3 employees, replace mode, template 'Mon–Fri 9–5'"). Apply triggers the API; on completion, a toast summarizes "Updated X, failed Y," with a "View failures" link if Y > 0.

### 7.4 Linked vs. customized indicator (employee Schedule tab)

In the employee drawer's Schedule tab:

- A header line: "Template: <name>" with one of three states:
  - **Linked** (all 7 days share the same non-null template id) — neutral pill.
  - **Mixed** (some days link to a template, others are customized) — amber pill "Mixed: 4 of 7 days linked to <name>".
  - **Customized** (no rows have a template id) — outline pill "Customized — no template".
- Per-day rows show a small "Custom" badge when that day's `scheduleTemplateId` is null but the rest are linked.
- A "Re-link to template" button appears in Mixed/Customized states (admin only), which re-applies the underlying template in `merge` mode for just the customized days.

### 7.5 Empty / loading / error states

- **Empty (no templates):** "No schedule templates yet. [+ New template]".
- **Loading:** skeleton rows in the list, a loading state overlay on the editor.
- **Error during apply:** the dialog's confirm step shows the per-employee failures inline.

---

## 8. Performance review cycle UI

Lives inside Rules & Controls → Review Cycles.

### 8.1 Configuration screen

- Per company a card with:
  - The company name (or "Global default" when `companyId IS NULL`).
  - A list of cycles. Each cycle row: cadence pill (Annual / Semi-annual / Quarterly / 90-day) + anchor (Hire date / Calendar) + lead times ("14, 7, 0 days") + Edit / Disable.
  - A "+ Add cycle" button at the bottom.
- A "90-day new-hire review" toggle (just a shorthand for adding a `cadence='new_hire_90'` cycle).
- Edit dialog: cadence selector, anchor selector (disabled and forced to `hire_date` when cadence is `new_hire_90`), lead-times comma-separated list with validation (positive integers, sorted desc), active toggle.

### 8.2 Per-employee "Next review" indicator

In the employee drawer's Employment tab, a small read-only line: "Next review: <date> (<cycle name>) — N days away" or "—" if no active reminder. Clicking opens the History/Audit tab pre-filtered to review reminders.

### 8.3 Reminder cards on `/alerts`

Use the existing alert row layout (§1.4). The `review_due` row's action button is "Mark complete," which opens a small dialog with a Notes textarea and Confirm / Cancel.

### 8.4 Empty / loading / error states

- **Empty:** "No review cycles configured. Performance reviews won't fire reminders."
- **Loading / error:** standard patterns.

---

## 9. PTO anniversary adjustments UI

A read-only history block inside the employee's `/profile` page (under "PTO summary") and mirrored inside the admin drawer's `PTO/Leave` tab.

Table columns: Effective date | Years of service | Old tier → New tier | Hours added | Policy.

- The block is always visible to the employee themselves (read-only) and to admins.
- Empty state: "No anniversary adjustments yet — your PTO accrual rate hasn't crossed a tier boundary."
- Each row is non-clickable (no detail view); the data is purely informational.
- A small footnote: "PTO anniversary adjustments are calculated automatically based on your hire date and the active PTO policy."

This is one of two surfaces that link to it from `/alerts`? No — anniversary adjustments do not emit alerts (the tier change is silent and audit-only by design); admins discover them via the audit log if needed.

---

## 10. Empty states, loading states, and error states (consolidated)

| Surface | Empty | Loading | Error |
|---|---|---|---|
| Onboarding tab (employee with no checklist) | "No onboarding checklist. [Start onboarding now]" (admin) / tab hidden (others) | Skeleton categories with 3 rows each | Inline error card with Retry |
| Offboarding tab | "No offboarding checklist. [Initiate offboarding]" (admin) / tab hidden (others) | Same skeleton | Same |
| Certifications (profile / drawer) | "No certifications on file." | 2 skeleton rows | Inline error |
| Required Documents sub-section | "No required-document rules. New hires won't be required to submit anything." | Skeleton table rows | Inline error |
| Auto Role Assignment list | "No rules yet. [+ New rule]" | Skeleton table rows | Inline error |
| Schedule Templates list | "No templates yet. [+ New template]" | Skeleton table rows | Inline error |
| Schedule template editor | n/a (always populated to 7 days when opened) | Loading overlay | Inline error |
| Review Cycles | "No review cycles configured." | Skeleton cards | Inline error |
| Onboarding Templates / Offboarding Templates | "No templates yet. [+ New template]" | Skeleton table rows | Inline error |
| Alerts (no rows for new types) | n/a — uses existing empty state on the alerts table | n/a | n/a |
| Apply schedule template dialog | n/a | Inline spinner on Apply button | Per-employee failure list inline; Apply remains clickable for retry |
| Re-evaluate-all-roles | n/a | Inline progress chip on the page | Toast with error; chip resets |

For every form (templates, rules, certifications, cycles), use the standard shadcn `Form` + `useForm` + `zodResolver` pattern (see `fullstack-js` skill rules). Validation errors render inline via `FormMessage`; submit buttons disable while pending.

---

## 11. RBAC visibility matrix

| Surface / action | employee | manager | admin | super-admin |
|---|---|---|---|---|
| Employees list — Onboarding/Cert filters | — | view (scoped to direct reports) | full | full |
| Drawer — Onboarding tab (others) | — | view (scoped) | view + edit HR-owned tasks + cancel | same as admin |
| Drawer — Onboarding tab (own, on `/profile`) | view + edit `new_hire`-owned tasks | own + manager view | own + admin view | same |
| Drawer — Offboarding tab | — | view (scoped, read-only) | view + edit + deactivate | view + edit + deactivate + reactivate |
| Drawer — Certifications | own (read-only on `/profile`) | view (scoped, read-only) | view + add + edit + archive | same as admin |
| Drawer — PTO anniversary history | own | view (scoped) | view | view |
| Rules & Controls — Onboarding Templates | — | — | view + edit | view + edit |
| Rules & Controls — Offboarding Templates | — | — | view + edit | view + edit |
| Rules & Controls — Required Documents | — | — | view + edit | view + edit |
| Rules & Controls — Auto Role Assignment | — | — | view + edit + test + reevaluate-all | same as admin |
| Rules & Controls — Schedule Templates | — | view (read-only) | view + edit + apply | same as admin |
| Rules & Controls — Review Cycles | — | — | view + edit | view + edit |
| Alerts page (lifecycle types) | — | view (scoped) | view + acknowledge + resolve | same as admin |
| `/profile` — Onboarding banner | own (when applicable) | own | own | own |
| `/profile` — Certifications | own (read-only) | own | own | own |
| `/profile` — PTO anniversary history | own | own | own | own |
| `POST /api/users/:id/clear-role-override` | — | — | yes | yes |
| `POST /api/users/:id/reactivate` | — | — | — | yes |

"Scoped" = bound by the existing `getScopedUserIds(user)` helper in `server/storage.ts:275`.

---

## 12. Theming and component reuse

Phase 3 reuses existing shadcn primitives almost exclusively. New net-new components are only those listed below; everything else is composed from existing parts.

**Reused (no changes needed):**
- `Card`, `CardHeader`, `CardContent`, `CardTitle` — every list and editor shell.
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — Onboarding/Offboarding tabs in the employee drawer.
- `Table`, `TableRow`, `TableCell` — every list view, including the existing `/alerts` table.
- `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` — every form, with `useForm` + `zodResolver` against the new Zod schemas in `shared/schema.ts`.
- `Dialog`, `AlertDialog` — apply-template confirms, deactivate-account confirms, skip-task reason modals, cancel-onboarding modal.
- `Badge`, with existing variants (`default`, `secondary`, `destructive`, `outline`) and the same amber "warning" treatment Phase 2 introduced for the policy precedence indicator.
- `Skeleton` — every loading state.
- `Sidebar` — no changes.
- `Select`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Calendar` (date picker) — used inside the rule editor, template editor, certification dialog, etc.
- `Toaster` / `useToast` from `@/hooks/use-toast` — every success/error confirmation.
- The Phase 2 "policy precedence indicator" component pattern (a small chip showing "Resolved at: Department" with a tooltip) is reused for missing-document rules to indicate which scope the rule was matched at.
- The Phase 2 condition-row editor pattern (used in policy rules) is reused as the foundation for the role-assignment-rule condition editor.

**Net-new components (justified):**
- `<OnboardingProgressRing>` — circular SVG progress indicator. Justified because no existing component renders a single-value circular progress, and the wizard's right-column summary panel is the central visual anchor.
- `<ScheduleWeeklyGrid>` — 7-row grid for the schedule template editor and the apply-preview. Justified because the existing `EmployeeSchedule` editor is row-based; we want a wider canvas for templates that emphasizes the weekly pattern.
- `<RoleAssignmentRulePreview>` — the "Test rule" output panel (matched / would change). Small, but distinct enough from existing alert / message components to warrant its own file.
- `<DeactivateAccountButton>` — a destructive button with built-in tooltip explaining the blocking-tasks state. Wraps the existing `Button` primitive.
- `<CertificationStatusPill>` — wraps `Badge` with the four-state status logic and the relative date formatting ("Expires in 7 days" / "Expired 14 days ago"). Justified because the same pill renders in 4+ surfaces and we want one source of truth.

All new components follow the existing repo conventions: `data-testid` on every interactive element using the `{action}-{target}` and `{type}-{description}-{id}` patterns from the `fullstack-js` skill.

**Iconography (lucide-react):**
- Onboarding category icons: `User` (account), `FileText` (paperwork), `BookOpen` (training), `Package` (equipment), `Users` (introduction).
- Offboarding category icons: `Lock` (access), `Package` (equipment), `DollarSign` (pay), `FileText` (documentation), `MessageSquare` (exit interview).
- Certification status: `CheckCircle2` (valid), `Clock` (expiring), `AlertTriangle` (expired).
- Role-rule indicator: `Sparkles` (set by rule), `Hand` (manual override).
- Schedule template indicator: `Link2` (linked), `Unlink` (customized), `LinkBreak2` (mixed).

**Dark mode:** all new surfaces inherit the existing dark-mode treatment — no new color tokens are introduced. Status pills use existing `--destructive`, `--muted`, etc.

---

## 13. Cross-cutting deep-link contract

To keep the alert-page deep links and the wizard launch paths from drifting, implementers honor this URL contract on the employees page:

```
/employees                                  → list view
/employees?employeeId=<id>                  → drawer open, default tab
/employees?employeeId=<id>&tab=<tabName>    → drawer open at tab
/employees?employeeId=<id>&tab=documents&focus=<documentType>
                                            → opens upload dialog pre-filled
/employees?employeeId=<id>&tab=basic&section=certifications
                                            → opens drawer, scrolls to Certifications card
/employees?employeeId=<id>&tab=onboarding   → opens Onboarding tab
/employees?employeeId=<id>&tab=offboarding  → opens Offboarding tab
/employees?employeeId=<id>&tab=history&focus=review-<reminderId>
                                            → opens audit/history tab and highlights row
```

Likewise on `/profile`:

```
/profile                          → default
/profile?section=onboarding       → scrolls to onboarding banner / panel
/profile?section=certifications   → scrolls to certifications card
/profile?section=pto-anniversary  → scrolls to anniversary history block
```

These query-parameter contracts are how the Alerts page action links and the email/notification deep links (future) will navigate users into the right place without re-implementing routing.

---

## 14. Out of scope (UI)

- A standalone "Onboarding analytics" dashboard (counts by status, average time to complete) — interesting, but not required by Phase 3 and not surfaced on any task. Defer.
- Email or push notifications for any of the new alert types. The existing alert system is in-app only; notification channels are a separate initiative.
- Mobile-specific layouts. The new surfaces follow the existing responsive patterns; no bespoke mobile flows are designed in Phase 3.
- A drag-and-drop board for onboarding tasks. The category-grouped list is sufficient; we will revisit if user research surfaces a need.
- Changing the existing `/alerts` page layout. We extend the lookup tables and add an action cell only.
