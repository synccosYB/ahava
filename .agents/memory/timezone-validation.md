---
name: Timezone validation & normalization
description: How malformed stored IANA timezones must be handled so lateness math never inflates.
---
# Timezone validation & normalization

`shared/timezone.ts` is the single source of truth: `isValidTimezone`, `normalizeTimezone` (canonicalizes recoverable strings like "America/New york" → "America/New_York" via a case/separator-insensitive match against `Intl.supportedValuesOf('timeZone')`, returns null when unrecoverable), `resolveTimezone(...candidates)`, and `DEFAULT_TIMEZONE`.

**Rule:** any code that renders "now" in a stored timezone MUST validate it first. On an invalid/unrecognized zone, fall back company → `DEFAULT_TIMEZONE` — **never** to the server's local clock.

**Why:** the server runs in UTC in prod. `Intl.DateTimeFormat` throws on a malformed zone (e.g. a space instead of underscore); the old `localTimeParts` catch degraded to `at.getHours()` (server-local = UTC ~4-5h ahead of ET), which was added straight into the "you are X hours late" figure (2h shown as 6-8h). Only the "Main" location had the bad value, matching the "only sometimes" symptom.

**How to apply:** save paths (company/location POST/PATCH in server/routes.ts via `normalizeTimezoneField`) reject/normalize on write; `resolveEmployeeTimezone` (server/services/punchOverlap.ts) normalizes each candidate on read; `localTimeParts` (server/scheduleWarning.ts) falls back to DEFAULT_TIMEZONE, not server-local. Data heal migration matches case/space-insensitively (raw SQL has no Intl).
