// Shared IANA timezone validation + normalization.
//
// Root cause of the inflated "you are X hours late" bug (task #514): a location
// stored an invalid IANA timezone string ("America/New york" — lowercase
// "york", a space instead of an underscore). Downstream code tried to render
// "now" in that zone; the conversion threw and silently fell back to the
// server's local clock (UTC in prod), so the UTC→business offset (~4–5h) was
// added straight into the lateness figure.
//
// These helpers are the single source of truth for deciding whether a stored
// timezone is usable and, when it isn't, coercing it back to its canonical
// form. Kept dependency-free so both the client and server can use them.

export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * True when `tz` is a timezone the runtime's Intl can actually resolve. Note
 * that Intl treats IANA names case-insensitively but rejects malformed
 * separators (e.g. a space instead of an underscore).
 */
export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function getSupportedTimezones(): string[] {
  try {
    const supported = (Intl as any).supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length > 0) return supported;
  } catch {
    /* ignore — fall through to empty list */
  }
  return [];
}

const fuzzyKey = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "_");

/**
 * Coerce a possibly-malformed timezone string to its canonical IANA form.
 * Returns the canonical zone (e.g. "America/New_York") when the input is valid
 * or close enough to recover (wrong case, spaces instead of underscores),
 * otherwise `null`. Never throws.
 */
export function normalizeTimezone(tz: string | null | undefined): string | null {
  if (!tz || typeof tz !== "string") return null;
  const trimmed = tz.trim();
  if (!trimmed) return null;

  // Valid (or case-variant) zone — let Intl hand back the canonical spelling.
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: trimmed })
      .resolvedOptions().timeZone;
    if (canonical) return canonical;
  } catch {
    /* invalid separator/name — fall through to fuzzy matching */
  }

  // Recover from bad separators/casing (e.g. "America/New york") by matching a
  // separator- and case-insensitive key against the runtime's supported zones.
  const target = fuzzyKey(trimmed);
  for (const zone of getSupportedTimezones()) {
    if (fuzzyKey(zone) === target) return zone;
  }
  return null;
}

/**
 * Resolve the first usable timezone from an ordered list of candidates
 * (e.g. location → company), each normalized. Falls back to
 * {@link DEFAULT_TIMEZONE} when none are valid — never to the server's local
 * clock.
 */
export function resolveTimezone(
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    const normalized = normalizeTimezone(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_TIMEZONE;
}
