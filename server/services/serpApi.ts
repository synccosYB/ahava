// SerpApi-backed address autocomplete + geocoding.
//
// A single server-side key (SERPAPI_API_KEY) proxies all requests so no key is
// ever shipped to the browser. The service degrades gracefully: when the key is
// missing every call resolves to `{ available: false, predictions: [] }` and
// the client simply behaves as a plain text input.
//
// We use SerpApi's `google_maps` engine (type=search). For a specific query it
// returns a single `place_results`; for a broad query it returns a
// `local_results` array. Both carry `address` (formatted string) and
// `gps_coordinates` { latitude, longitude }, so a single round-trip yields both
// the address breakdown AND the coordinates we need for geofencing — no second
// "place details" call is required.

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

export interface PlacePrediction {
  id: string;
  description: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
  latitude: number | null;
  longitude: number | null;
}

export function isSerpApiConfigured(): boolean {
  const key = process.env.SERPAPI_API_KEY;
  return !!(key && key.trim());
}

// Parse a Google-formatted US address string into rough components.
// e.g. "646 N Michigan Ave, Chicago, IL 60611, USA" ->
//   { address: "646 N Michigan Ave", city: "Chicago", state: "IL", zip: "60611" }
export function parseFormattedAddress(formatted: string): {
  address: string;
  city: string;
  state: string;
  zip: string;
} {
  const empty = { address: "", city: "", state: "", zip: "" };
  if (!formatted || typeof formatted !== "string") return empty;

  let parts = formatted
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  // Drop a trailing country token so the last part is the "STATE ZIP" chunk.
  const last = parts[parts.length - 1];
  if (last && /^(usa|united states|us)$/i.test(last)) {
    parts = parts.slice(0, -1);
  }
  if (parts.length === 0) return empty;

  let state = "";
  let zip = "";

  // The final part is usually "ST 12345", "ST", or "12345".
  const tail = parts[parts.length - 1];
  const stateZip = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (stateZip) {
    state = stateZip[1].toUpperCase();
    zip = stateZip[2];
    parts = parts.slice(0, -1);
  } else if (/^[A-Za-z]{2}$/.test(tail)) {
    state = tail.toUpperCase();
    parts = parts.slice(0, -1);
  } else if (/^\d{5}(?:-\d{4})?$/.test(tail)) {
    zip = tail;
    parts = parts.slice(0, -1);
  }

  let city = "";
  if (parts.length >= 1) {
    city = parts[parts.length - 1];
    parts = parts.slice(0, -1);
  }
  const address = parts.join(", ");

  return { address, city, state, zip };
}

function coord(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toPrediction(raw: any, idx: number): PlacePrediction | null {
  if (!raw) return null;
  const formatted: string = raw.address || raw.title || "";
  if (!formatted) return null;
  const comps = parseFormattedAddress(formatted);
  const gps = raw.gps_coordinates || {};
  const title: string = raw.title || comps.address || formatted;
  // Build a friendly description; avoid duplicating the title inside the address.
  const description = formatted.startsWith(title)
    ? formatted
    : [title, formatted].filter(Boolean).join(" — ");
  return {
    id: raw.place_id || raw.data_id || `${idx}`,
    description,
    address: comps.address,
    city: comps.city,
    state: comps.state,
    zip: comps.zip,
    formatted,
    latitude: coord(gps.latitude),
    longitude: coord(gps.longitude),
  };
}

export interface AutocompleteResult {
  available: boolean;
  predictions: PlacePrediction[];
}

export async function autocompleteAddress(
  query: string,
  opts?: { limit?: number },
): Promise<AutocompleteResult> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key || !key.trim()) {
    return { available: false, predictions: [] };
  }
  const trimmed = (query || "").trim();
  if (trimmed.length < 3) {
    return { available: true, predictions: [] };
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", key.trim());

  let data: any;
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`SerpApi autocomplete HTTP ${res.status}`);
      return { available: true, predictions: [] };
    }
    data = await res.json();
  } catch (err) {
    console.warn("SerpApi autocomplete request failed:", (err as Error).message);
    return { available: true, predictions: [] };
  }

  if (data?.error) {
    // "no results" style errors are normal for partial input.
    return { available: true, predictions: [] };
  }

  const limit = opts?.limit ?? 6;
  const out: PlacePrediction[] = [];

  if (data?.place_results) {
    const p = toPrediction(data.place_results, 0);
    if (p) out.push(p);
  }
  if (Array.isArray(data?.local_results)) {
    data.local_results.forEach((r: any, i: number) => {
      const p = toPrediction(r, i + 1);
      if (p) out.push(p);
    });
  }

  // De-dupe by formatted address and cap.
  const seen = new Set<string>();
  const deduped = out.filter((p) => {
    const k = p.formatted.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { available: true, predictions: deduped.slice(0, limit) };
}
