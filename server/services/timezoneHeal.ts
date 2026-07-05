// Task #515: auto-correct any bad timezone still lurking on old records.
//
// Task #514 added save-time validation + a data-heal migration
// (0065_normalize_location_company_timezones.sql), but that migration can only
// fix the ONE known-bad value ("America/New york") because raw SQL has no Intl
// and had to match a hard-coded zone. Any location/company saved with a
// DIFFERENT malformed zone before validation existed would still be skipped at
// runtime and silently fall back to the company/default zone.
//
// This service is the general sweep. Because it runs in TypeScript it CAN use
// `normalizeTimezone` (Intl-backed), so it recovers any recoverable spelling
// (wrong case, spaces instead of underscores) rather than a single hard-coded
// zone. Anything it cannot recover is reported for admin review instead of being
// silently left to degrade.

import { storage } from "../storage";
import { isValidTimezone, normalizeTimezone } from "@shared/timezone";

export interface TimezoneAuditEntry {
  kind: "location" | "company";
  id: string;
  name: string;
  storedTimezone: string;
}

export interface TimezoneHealChange extends TimezoneAuditEntry {
  correctedTimezone: string;
}

export interface TimezoneHealResult {
  healed: TimezoneHealChange[];
  unrecoverable: TimezoneAuditEntry[];
}

/**
 * A stored timezone needs attention when it is present but not a valid IANA
 * zone the runtime can resolve. A null/blank value is intentionally left alone —
 * it's an allowed "inherit from company/default" signal, not a bad value.
 */
function needsAttention(tz: string | null | undefined): tz is string {
  return typeof tz === "string" && tz.trim() !== "" && !isValidTimezone(tz);
}

/**
 * Scan `locations.timezone` and `companies.timezone`; for every value that is
 * not a valid IANA zone, rewrite it to its canonical form when recoverable and
 * collect the rest for admin review. Never throws — a heal failure must not
 * break boot; on error the caller keeps serving with runtime fallback intact.
 */
export async function healTimezones(): Promise<TimezoneHealResult> {
  const healed: TimezoneHealChange[] = [];
  const unrecoverable: TimezoneAuditEntry[] = [];

  const locations = await storage.getAllLocations();
  for (const loc of locations) {
    if (!needsAttention(loc.timezone)) continue;
    const stored = loc.timezone;
    const corrected = normalizeTimezone(stored);
    if (corrected) {
      await storage.updateLocation(loc.id, { timezone: corrected });
      healed.push({ kind: "location", id: loc.id, name: loc.name, storedTimezone: stored, correctedTimezone: corrected });
    } else {
      unrecoverable.push({ kind: "location", id: loc.id, name: loc.name, storedTimezone: stored });
    }
  }

  const companies = await storage.getAllCompanies();
  for (const company of companies) {
    if (!needsAttention(company.timezone)) continue;
    const stored = company.timezone;
    const corrected = normalizeTimezone(stored);
    if (corrected) {
      await storage.updateCompany(company.id, { timezone: corrected });
      healed.push({ kind: "company", id: company.id, name: company.name, storedTimezone: stored, correctedTimezone: corrected });
    } else {
      unrecoverable.push({ kind: "company", id: company.id, name: company.name, storedTimezone: stored });
    }
  }

  return { healed, unrecoverable };
}

/**
 * Read-only scan for the admin review surface: returns every location/company
 * whose stored timezone is present but invalid and cannot be auto-recovered.
 * (Recoverable ones are fixed by {@link healTimezones} at boot, so under normal
 * operation only truly unrecoverable rows remain.)
 */
export async function auditUnrecoverableTimezones(): Promise<TimezoneAuditEntry[]> {
  const entries: TimezoneAuditEntry[] = [];

  const locations = await storage.getAllLocations();
  for (const loc of locations) {
    if (needsAttention(loc.timezone) && !normalizeTimezone(loc.timezone)) {
      entries.push({ kind: "location", id: loc.id, name: loc.name, storedTimezone: loc.timezone });
    }
  }

  const companies = await storage.getAllCompanies();
  for (const company of companies) {
    if (needsAttention(company.timezone) && !normalizeTimezone(company.timezone)) {
      entries.push({ kind: "company", id: company.id, name: company.name, storedTimezone: company.timezone });
    }
  }

  return entries;
}
