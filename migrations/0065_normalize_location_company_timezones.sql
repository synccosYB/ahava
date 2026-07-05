-- Task #514: heal malformed stored IANA timezone strings on locations/companies.
--
-- In production the "Main" location had its timezone stored as "America/New york"
-- (lowercase "york", a space instead of an underscore) — an invalid IANA string.
-- Timezone resolution checks the location first, so employees tied to "Main" got
-- this broken value; rendering "now" in it failed and silently fell back to the
-- server's local (UTC) clock, inflating the "you are X hours late" figure by the
-- UTC→business offset (~4–5h).
--
-- Code hardening (validate-on-save + validate-on-resolve) prevents this going
-- forward, but existing rows still need correcting. Raw SQL has no Intl, so we
-- match case- and separator-insensitively against the one known-affected zone
-- (America/New_York) and rewrite it to the canonical spelling. Additive and
-- idempotent (replay-safe): once normalized, re-running changes nothing.

UPDATE locations
SET timezone = 'America/New_York'
WHERE timezone IS NOT NULL
  AND lower(replace(timezone, ' ', '_')) = 'america/new_york'
  AND timezone <> 'America/New_York';
--> statement-breakpoint

UPDATE companies
SET timezone = 'America/New_York'
WHERE timezone IS NOT NULL
  AND lower(replace(timezone, ' ', '_')) = 'america/new_york'
  AND timezone <> 'America/New_York';
