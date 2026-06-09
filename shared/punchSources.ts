// Canonical set of punch-method identifiers shared by the server (enforcement)
// and the client (admin policy UI + hiding disallowed clock actions). Keeping
// the list in one place means both sides agree on what "kiosk", "manager", etc.
// mean and which methods are allowed by default.

export const PUNCH_SOURCES = ["web", "mobile", "kiosk", "qr", "manager"] as const;

export type PunchSource = (typeof PUNCH_SOURCES)[number];

export const PUNCH_SOURCE_LABELS: Record<PunchSource, string> = {
  web: "Web",
  mobile: "Mobile",
  kiosk: "Kiosk",
  qr: "QR Code",
  manager: "Manager Entry",
};

// Default allowed methods when a policy doesn't explicitly configure
// `allowedPunchSources`. Includes "manager" so that manager/admin corrections
// (which create/modify punches) keep working exactly as before for employees
// and locations without an explicit policy. QR is off by default because the
// capture experience isn't built yet.
export const DEFAULT_ALLOWED_PUNCH_SOURCES: PunchSource[] = [
  "web",
  "mobile",
  "kiosk",
  "manager",
];

export function isKnownPunchSource(value: unknown): value is PunchSource {
  return typeof value === "string" && (PUNCH_SOURCES as readonly string[]).includes(value);
}

// Resolve the effective allowed-source list from a set of attendance rules.
//
// Semantics matter here: an admin who unchecks every method in the wizard
// persists an explicit empty array, which MUST mean "deny all" — never silently
// fall back to defaults (that would re-enable methods the admin turned off).
// We only fall back to the default set when the policy doesn't specify a list at
// all (undefined/null/not-an-array), or when an array contains ONLY unknown
// values (corrupt config — fail open rather than lock everyone out).
export function getAllowedPunchSources(
  rules?: { allowedPunchSources?: unknown } | null,
): PunchSource[] {
  const raw = rules?.allowedPunchSources;
  if (Array.isArray(raw)) {
    // Explicit empty list = deliberate deny-all.
    if (raw.length === 0) return [];
    const cleaned = raw.filter(isKnownPunchSource);
    // Some valid entries → honor exactly what was configured.
    if (cleaned.length > 0) return cleaned;
    // Array had only unknown values: treat as corrupt and fall back to default.
  }
  return [...DEFAULT_ALLOWED_PUNCH_SOURCES];
}

export function isPunchSourceAllowed(
  rules: { allowedPunchSources?: unknown } | null | undefined,
  source: string,
): boolean {
  return getAllowedPunchSources(rules).includes(source as PunchSource);
}

export function punchSourceLabel(source: string): string {
  return isKnownPunchSource(source) ? PUNCH_SOURCE_LABELS[source] : source;
}

// User-facing rejection message when a method is blocked. Used by every punch
// entry point so the wording is consistent.
export function punchSourceBlockedMessage(source: string): string {
  return `${punchSourceLabel(source)} clock-in/out isn't allowed for this employee. Please use an allowed method or contact your administrator.`;
}
