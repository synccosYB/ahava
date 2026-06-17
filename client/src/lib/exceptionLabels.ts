/**
 * Canonical attendance-exception (punch correction) type labels, shared by the
 * employee side (My Attendance correction requests) and the manager side
 * (Requests & Approvals) so both screens name correction types identically.
 *
 * Part of the Attendance Display Standard — see `client/src/lib/utils.ts`.
 */
export const EXCEPTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "missing_punch", label: "Missing Punch" },
  { value: "time_correction", label: "Time Correction" },
  { value: "punch_removal", label: "Punch Removal" },
  { value: "forgotten_clock_in", label: "Forgotten Clock In" },
  { value: "forgotten_clock_out", label: "Forgotten Clock Out" },
  { value: "geofence", label: "Out of Area" },
];

export function formatExceptionTypeLabel(type: string): string {
  const found = EXCEPTION_TYPE_OPTIONS.find((o) => o.value === type);
  if (found) return found.label;
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
