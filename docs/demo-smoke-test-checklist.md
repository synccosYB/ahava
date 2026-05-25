# Pre-Demo Admin Smoke Test Checklist

Run this checklist end-to-end against the demo environment before every client demo. Each
item should be verified once with the `BIOMETRIC_ENCRYPTION_KEY` env var set, an admin
session active, and at least one test employee + one test manager seeded.

File any newly surfaced 500s, 404s, or broken validation messages as separate bug tasks —
do NOT fix them inline during the run.

## 0. Environment sanity (do first)

- [ ] App boots without `BIOMETRIC_ENCRYPTION_KEY` warning banner in admin Settings tab.
- [ ] `/api/auth/permissions` returns at least one permission for the test admin.
- [ ] Sidebar renders every nav entry without console errors (open DevTools → Console).
- [ ] No red LSP/diagnostics on `client/src/pages/rules-controls.tsx`,
      `pto-leave.tsx`, `kiosk.tsx`, `employees.tsx`, `server/routes.ts`.

## 1. Policy create with bonus rules (Rules & Controls → Payroll Rules)

- [ ] Open Rules & Controls → Payroll Rules. Click **Add Policy** → Policy Wizard opens.
- [ ] Step 1: pick **Payroll**. Step 2: add a **Day-of-Week bonus** (e.g. Sunday +$2/hr).
- [ ] Add a second Day-of-Week bonus on the SAME day → inline overlap error appears,
      **Next** is blocked.
- [ ] Fix to a different day → error clears, **Next** enabled.
- [ ] Add an **Early-Arrival bonus** for "every day" (empty day list), then a second
      Early-Arrival also for every day → overlap error appears.
- [ ] Resolve overlap, advance to Assignments, attach to one location, Save.
- [ ] Server returns 200, policy appears in the list, summary chip shows the bonus count.

## 2. Policy assignment (Rules & Controls → Attendance Rules)

- [ ] Pick any existing attendance policy → click **Assign**.
- [ ] Try each scope in turn: Company, Location, Department, Individual Employee.
      Each save returns 200 and the badge appears under the policy row.
- [ ] Remove one assignment via the X → badge disappears, no console error.

## 3. Attendance correction submit + manager approve

- [ ] As employee: open **My Attendance**, click **Request Fix** on a past day.
      Submit a time-correction with a reason → success toast, row now shows
      "Pending" verdict badge and is locked from further submissions.
- [ ] `text-self-correction-count` reflects the new count.
- [ ] As manager/admin: open Requests & Approvals → Exceptions. The new request
      appears with `CorrectionCountBadge`. Approve it.
- [ ] Employee's My Attendance row now shows "Approved" badge; date stays locked.
- [ ] Click "Ask to reopen" once → request appears under manager's
      Reopen Requests section. Grant it → date unlocks for one new submission.
      Confirm a second reopen on the same exception is rejected.

## 4. Time-off request + auto-approve

- [ ] As employee with a PTO policy attached: PTO & Leave → New Request,
      pick a date range inside balance, submit. With auto-approve policy
      configured, status returns as **Approved** immediately.
- [ ] PTO Balances tab: vacation "pending" or "used" updated for that employee.
- [ ] Try a request that exceeds balance → server rejects 400 with a friendly
      message, no 500.
- [ ] Try a request inside a configured blackout date → blocked with the
      blackout-specific error.

## 5. Kiosk PIN + name search

- [ ] Open `/kiosk` on a paired tablet (or set `localStorage.kioskDeviceId`).
      Pairing screen does NOT appear when a valid device id is present.
- [ ] **PIN flow**: tap Start → enter test employee's PIN → Confirm screen shows
      correct name + last punch → Confirm Clock In → success screen, then auto
      reset to home within 5s.
- [ ] **Name search flow**: from Identify screen, type partial last name →
      result list filters, pick employee, Confirm Clock Out → success.
- [ ] Try wrong PIN → friendly error, no 500.
- [ ] Unpair via Admin → Kiosk & Devices → tablet returns to Pairing screen
      within 45s (heartbeat) or on tab focus.

## 6. Employee create + start onboarding

- [ ] Employees page → **Add Employee** dialog. Multi-step: fill required
      fields, pick payType=hourly with a positive rate, pick onboarding template.
- [ ] Submit → 200, new row appears in list with W-2 badge by default.
- [ ] Open new employee's profile → Onboarding tab shows materialized checklist
      from the template.
- [ ] Admin **Reset Password** for that user → choose temp password → toast
      shows the temp password once. Then choose email reset link variant →
      success toast (Resend may be inert in demo; check no 500).
- [ ] `users.delete` permission: bulk-select test user, Delete → confirmation
      modal lists name, confirm → row removed.

## 7. Workflow trigger → alert fires

- [ ] Rules & Controls → Approval Workflows or the Visual Workflow Builder:
      open an existing active workflow (or create a minimal one: Trigger
      "exception.created" → Action "Create Alert").
- [ ] Trigger the workflow by creating the matching event (e.g. submit a
      correction request from step 3).
- [ ] Alerts & Exceptions tab on PTO & Leave shows the new alert within a few
      seconds. Acknowledge → status updates, audit log row written.
- [ ] Audit Log section: filter by today, confirm the workflow execution and
      alert acknowledgement entries are present.

## 8. Cross-cutting checks (run while doing the above)

- [ ] No request in the Network tab returns 500 or 404 that wasn't expected.
- [ ] Browser console stays clean of React key warnings or unhandled promise
      rejections.
- [ ] WebSocket `/ws` connects (Network → WS tab) and live attendance updates
      appear without a manual refresh.

## Sign-off

| Run by | Date | Build / commit | Notes |
|--------|------|----------------|-------|
|        |      |                |       |
