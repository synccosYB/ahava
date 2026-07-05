---
name: Timezone data heal sweep
description: How malformed stored timezones on locations/companies are auto-corrected and surfaced for admin review.
---

# Timezone data heal sweep

`server/services/timezoneHeal.ts` is the general runtime sweep that complements the
SQL heal migration (which can only fix one hard-coded zone because raw SQL has no Intl).

- `healTimezones()` scans `locations.timezone` + `companies.timezone`; present-but-invalid
  values are rewritten to canonical IANA via `normalizeTimezone` when recoverable
  (wrong case / spaces-for-underscores), otherwise collected as unrecoverable.
  null/blank is left alone (valid "inherit from company/default" signal). Never throws.
- Runs at boot in `server/index.ts` AFTER migrations/seed, before listen; wrapped so it
  can never break boot.
- `auditUnrecoverableTimezones()` is the read-only scan behind `GET /api/timezone-audit`.

**Why the endpoint is admin-only + read-only:** it scans ALL companies/locations (no
per-tenant scope), so gating with the per-resource `locations.view` permission would leak
other tenants' data to scoped managers. It is `requireRole("admin")` and does NOT trigger
healing (a GET must not write across tenants) — healing happens only at boot.
Frontend `TimezoneAuditCard` in `client/src/pages/rules-controls.tsx` gates its query on
`user.role === "admin"` to avoid a guaranteed 403 for non-admins.
