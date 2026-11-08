/**
 * Fingerprint capture seam for the ZK9500 desk (enrollment) reader.
 *
 * A browser cannot read a USB fingerprint sensor directly. The ZK9500 is driven
 * by ZKTeco's local reader service installed on the enrollment PC, which exposes
 * capture to the page (typically a localhost WebSocket / HTTP "WebAPI"). The
 * exact endpoint and response shape are finalized once the physical reader is on
 * hand; until then this module is the single, well-defined seam the enrollment
 * UI calls, so wiring the real device later touches only this file.
 */

export interface CapturedFingerprint {
  /** Vendor template blob (base64). Opaque to us — stored and pushed verbatim. */
  template: string;
  /** Vendor template-format tag, e.g. "ZKFinger10" / "ISO". Confirmed w/ device. */
  format: string;
  /** Template size in bytes, when the reader reports it. */
  size?: number;
  /** 0–100 capture quality, when the reader reports it. */
  quality?: number;
}

/** Thrown when no local reader service is reachable (not installed / not running). */
export class FingerprintCaptureUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FingerprintCaptureUnavailable";
  }
}

const NOT_WIRED =
  "The fingerprint reader isn't connected on this computer. Start the reader bridge " +
  "(run fpbridge.py on this PC), make sure the ZK9500 is plugged in, then try again.";

// The local bridge (fpbridge.py) runs on the enrollment PC and exposes the
// ZK9500 over localhost. Overridable at build time if the port ever changes.
const BRIDGE_URL =
  (import.meta as any).env?.VITE_FINGERPRINT_BRIDGE_URL || "http://localhost:8899";

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

/**
 * Whether the local reader bridge is reachable right now. Lets the UI show a
 * "start the reader" hint instead of a dead Capture button.
 */
export async function isCaptureAvailable(): Promise<boolean> {
  try {
    const r = await fetchWithTimeout(`${BRIDGE_URL}/health`, 2000);
    const j = await r.json();
    return !!j?.ok;
  } catch {
    return false;
  }
}

/**
 * Capture ONE fingerprint from the desk reader via the local bridge. Throws
 * FingerprintCaptureUnavailable when the bridge can't be reached (not running /
 * reader unplugged), or a plain Error for a capture problem (e.g. no finger).
 */
export async function captureFingerprint(
  _opts?: { fingerIndex?: number },
): Promise<CapturedFingerprint> {
  let res: Response;
  try {
    // The bridge waits up to ~20s for a finger; allow a little more here.
    res = await fetchWithTimeout(`${BRIDGE_URL}/capture`, 30000);
  } catch {
    throw new FingerprintCaptureUnavailable(NOT_WIRED);
  }
  if (!res.ok) {
    let msg = `Capture failed (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* keep the status message */ }
    throw new Error(msg);
  }
  const j = await res.json();
  if (!j?.template) throw new Error("The reader returned no template — try again.");
  return { template: j.template, format: j.format || "ZKFinger10", size: j.size };
}
