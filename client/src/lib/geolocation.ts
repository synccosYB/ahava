// Task #418: best-effort device location capture for clock-in geofencing.
//
// Geofencing NEVER blocks a clock-in, so this helper never rejects — if the
// browser has no geolocation, the user denies the prompt, or it times out, we
// simply resolve with nulls and let the server raise a geofence exception.

export interface PunchCoords {
  latitude: number | null;
  longitude: number | null;
}

const NO_COORDS: PunchCoords = { latitude: null, longitude: null };

export function getPunchCoords(timeoutMs = 8000): Promise<PunchCoords> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(NO_COORDS);
  }
  return new Promise<PunchCoords>((resolve) => {
    let settled = false;
    const done = (coords: PunchCoords) => {
      if (settled) return;
      settled = true;
      resolve(coords);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          done({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => done(NO_COORDS),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
      );
    } catch {
      done(NO_COORDS);
    }
    // Hard backstop in case the browser never invokes either callback.
    setTimeout(() => done(NO_COORDS), timeoutMs + 1000);
  });
}
