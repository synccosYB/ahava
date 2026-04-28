import type { BiometricSettings } from "@shared/schema";

/**
 * Tiered biometric matching.
 *
 * Scoring model:
 *   distance = euclidean distance between two L2-normalized 128-dim descriptors
 *   confidence = clamp(1 - distance / NORMALIZER, 0, 1)
 *
 * face-api.js typically returns distances in the [0, 1.2] range for 128-dim descriptors;
 * a distance of ~0.4 is a strong match, ~0.6 is a borderline match, > 0.8 is a non-match.
 * Mapping to a [0, 1] confidence keeps the configured thresholds intuitive for admins
 * (auto > review > reject, "higher is better").
 */

const NORMALIZER = 1.0;

export interface CandidateTemplate {
  userId: string;
  /** Single descriptor or array-of-descriptors (for multi-sample enrollments). */
  descriptors: number[][];
}

export interface MatchResult {
  userId: string | null;
  confidence: number;
  outcome: "auto_approved" | "low_confidence" | "rejected" | "not_enrolled";
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`descriptor length mismatch: ${a.length} vs ${b.length}`);
  }
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq);
}

export function distanceToConfidence(distance: number): number {
  const c = 1 - distance / NORMALIZER;
  if (!Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

/** Best (smallest) distance between probe and any sample of the candidate. */
function candidateDistance(probe: number[], candidate: CandidateTemplate): number {
  let best = Infinity;
  for (const sample of candidate.descriptors) {
    const d = euclideanDistance(probe, sample);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Identify a probe descriptor against the supplied candidate set. Candidates MUST already
 * be filtered by companyId at the caller — the matcher itself enforces no scoping.
 */
export function identify(
  probe: number[],
  candidates: CandidateTemplate[],
  thresholds: Pick<BiometricSettings, "thresholdAutoApprove" | "thresholdReview" | "thresholdReject">,
): MatchResult {
  if (candidates.length === 0) {
    return { userId: null, confidence: 0, outcome: "not_enrolled" };
  }
  let bestUserId: string | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = candidateDistance(probe, c);
    if (d < bestDistance) {
      bestDistance = d;
      bestUserId = c.userId;
    }
  }
  const confidence = distanceToConfidence(bestDistance);
  if (confidence >= thresholds.thresholdAutoApprove) {
    return { userId: bestUserId, confidence, outcome: "auto_approved" };
  }
  if (confidence >= thresholds.thresholdReview) {
    return { userId: bestUserId, confidence, outcome: "low_confidence" };
  }
  // Below review but above reject — still rejected for clock-in (reject threshold acts as
  // a minimum-evidence bar; below it we treat as "no candidate").
  return { userId: null, confidence, outcome: "rejected" };
}
