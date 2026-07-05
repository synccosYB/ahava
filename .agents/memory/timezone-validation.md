---
name: Timezone validation & normalization
description: How malformed stored IANA timezones must be handled so lateness math never inflates.
---
# Timezone validation & normalization

`shared/timezone.ts` is the single source of truth: `isValidTimezone`, `normalizeTimezone` (canonicalizes recoverable strings like "America/New york" → "America/New_York" via a case/separator-insensitive match against `Intl.supportedValuesOf('timeZone')`, returns null when unrecoverable), `resolveTimezone(...candidates)`, and `DEFAULT_TIMEZONE`.

**Rule:** any code that renders "now" in a stored timezone MUST validate it first. On an invalid/unrecognized zone, fall back company → `DEFAULT_TIMEZONE` — **never** to the server's local clock.

**Why:** the server runs in UTC in prod. `Intl.DateTimeFormat` throws on a malformed zone (e.g. a space instead of underscore); the old `localTimeParts` catch degraded to `at.getHours()` (server-local = UTC ~4-5h ahead of ET), which was added straight into the "you are X hours late" figure (2h shown as 6-8h). Only the "Main" location had the bad value, matching the "only sometimes" symptom.

**How to apply:** save paths reject/normalize on write; `resolveEmployeeTimezone` (server/services/punchOverlap.ts) normalizes each candidate on read; `localTimeParts` (server/scheduleWarning.ts) falls back to DEFAULT_TIMEZONE, not server-local. Data heal migration matches case/space-insensitively (raw SQL has no Intl).

**Write-path guard is now at the SCHEMA layer, not per-route.** `timezoneFieldSchema` (shared/models/auth.ts, re-exported from @shared/schema) wraps `normalizeTimezone` in a Zod `.transform` and is `.extend`ed onto `insertCompanySchema`/`insertLocationSchema`, so any consumer — POST, PATCH-via-`.partial()`, imports, future routes — coerces recoverable zones to canonical and REJECTS garbage at parse time (blank/null/undefined pass through). Only `companies` and `locations` have a timezone column (users/kiosk_devices/user_employment_profiles do NOT). The old per-route `normalizeTimezoneField` calls remain as harmless layered defense. **If a new table stores a timezone, reuse `timezoneFieldSchema` on its insert schema — don't hand-guard the route.**
