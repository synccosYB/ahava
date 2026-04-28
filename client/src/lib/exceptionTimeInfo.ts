const TIME_INFO_RE = /\s*\[(?:Original In:\s*([^,\]]+))?(?:,\s*)?(?:Original Out:\s*([^,\]]+))?(?:,\s*)?(?:Corrected In:\s*([^,\]]+))?(?:,\s*)?(?:Corrected Out:\s*([^,\]]+))?\]\s*$/;

export interface ParsedExceptionTimeInfo {
  cleanReason: string;
  origIn: string;
  origOut: string;
  reqIn: string;
  reqOut: string;
}

export function parseExceptionTimeInfo(reason: string | null | undefined): ParsedExceptionTimeInfo {
  const text = reason || "";
  const m = text.match(TIME_INFO_RE);
  if (!m) {
    return { cleanReason: text.trim(), origIn: "", origOut: "", reqIn: "", reqOut: "" };
  }
  return {
    cleanReason: text.slice(0, m.index ?? 0).trim(),
    origIn: (m[1] || "").trim(),
    origOut: (m[2] || "").trim(),
    reqIn: (m[3] || "").trim(),
    reqOut: (m[4] || "").trim(),
  };
}

export function timeOnDateToISO(date: string, hhmm: string): string | null {
  if (!date || !hhmm) return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, d] = parts;
  const dt = new Date(y, mo - 1, d, hours, minutes, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export interface TimeCorrectionApprovalPayload {
  correctedClockIn?: string;
  correctedClockOut?: string;
}

export function buildTimeCorrectionPayload(
  exceptionDate: string,
  reqIn: string,
  reqOut: string,
): TimeCorrectionApprovalPayload {
  const payload: TimeCorrectionApprovalPayload = {};
  const inIso = timeOnDateToISO(exceptionDate, reqIn);
  const outIso = timeOnDateToISO(exceptionDate, reqOut);
  if (inIso) payload.correctedClockIn = inIso;
  if (outIso) payload.correctedClockOut = outIso;
  return payload;
}
