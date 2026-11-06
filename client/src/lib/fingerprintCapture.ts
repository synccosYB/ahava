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
  "The fingerprint reader isn't connected on this computer yet. Install the ZK9500 " +
  "reader software, make sure the reader is plugged in, then reload this page.";

/**
 * Whether a local reader service looks reachable. Wired against the ZK9500's
 * local service once the reader is on hand; returns false until then so the UI
 * can show the "connect the reader" state instead of a dead Capture button.
 */
export async function isCaptureAvailable(): Promise<boolean> {
  return false;
}

/**
 * Capture ONE fingerprint sample from the desk reader. Implemented against the
 * ZK9500's local service once the reader is on hand. Throws
 * FingerprintCaptureUnavailable until then so the UI shows a clear message
 * rather than silently failing.
 */
export async function captureFingerprint(
  _opts?: { fingerIndex?: number },
): Promise<CapturedFingerprint> {
  throw new FingerprintCaptureUnavailable(NOT_WIRED);
}
