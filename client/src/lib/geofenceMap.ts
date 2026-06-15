// Pure geometry for the manager-facing "Out of Area" exception map.
//
// Builds an OpenStreetMap embed bounding box that frames the recorded clock-in
// point alongside the allowed geofenced location (expanded by its radius). Kept
// free of React/DOM so the framing math — easy to get subtly wrong — can be
// unit-tested directly. A regression here silently mis-frames the map (or drops
// the punch off-screen) without throwing.

export type GeofenceMapData = {
  punchLatitude: number | null;
  punchLongitude: number | null;
  allowedLatitude: number | null;
  allowedLongitude: number | null;
  allowedRadiusMeters: number | null;
  allowedLabel: string | null;
  distanceMeters: number | null;
  coordsMissing: boolean;
};

export type GeofenceBbox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const METERS_PER_DEG_LAT = 111320;
// Default geofence radius (m) used when the allowed location doesn't specify one.
export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;
// Minimum visible span (m) so a tiny punch↔allowed distance still renders a
// sensible zoom instead of a maximally zoomed-in, disorienting frame.
const MIN_SPAN_METERS = 120;
// Fraction of the span added as padding on every edge.
const PADDING_FRACTION = 0.25;

// Compute the padded bounding box that should be visible on the map. Returns
// null when there are no punch coordinates to anchor the map (the caller shows
// a "no location recorded" notice instead).
export function computeGeofenceBbox(geo: GeofenceMapData): GeofenceBbox | null {
  const hasPunch = geo.punchLatitude != null && geo.punchLongitude != null;
  if (!hasPunch) {
    return null;
  }

  const punchLat = geo.punchLatitude as number;
  const punchLng = geo.punchLongitude as number;
  const hasAllowed =
    geo.allowedLatitude != null && geo.allowedLongitude != null;
  const radius = geo.allowedRadiusMeters ?? DEFAULT_GEOFENCE_RADIUS_METERS;

  const metersPerDegLat = METERS_PER_DEG_LAT;
  // Longitude degrees shrink toward the poles; guard the equator-edge 0 case.
  const metersPerDegLng =
    METERS_PER_DEG_LAT * Math.cos((punchLat * Math.PI) / 180) ||
    METERS_PER_DEG_LAT;

  const lats = [punchLat];
  const lngs = [punchLng];
  if (hasAllowed) {
    const aLat = geo.allowedLatitude as number;
    const aLng = geo.allowedLongitude as number;
    const dLat = radius / metersPerDegLat;
    const dLng = radius / metersPerDegLng;
    lats.push(aLat + dLat, aLat - dLat);
    lngs.push(aLng + dLng, aLng - dLng);
  }

  const minSpanLat = MIN_SPAN_METERS / metersPerDegLat;
  const minSpanLng = MIN_SPAN_METERS / metersPerDegLng;
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  if (maxLat - minLat < minSpanLat) {
    const mid = (maxLat + minLat) / 2;
    minLat = mid - minSpanLat / 2;
    maxLat = mid + minSpanLat / 2;
  }
  if (maxLng - minLng < minSpanLng) {
    const mid = (maxLng + minLng) / 2;
    minLng = mid - minSpanLng / 2;
    maxLng = mid + minSpanLng / 2;
  }

  const padLat = (maxLat - minLat) * PADDING_FRACTION;
  const padLng = (maxLng - minLng) * PADDING_FRACTION;
  minLat -= padLat;
  maxLat += padLat;
  minLng -= padLng;
  maxLng += padLng;

  return { minLat, maxLat, minLng, maxLng };
}
