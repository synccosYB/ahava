// Task #418 / Note #2: best-effort device location capture for clock-in
// geofencing.
//
// This helper never rejects — if the browser has no geolocation, the user
// denies the prompt, or it times out, we resolve with nulls. For a self-service
// (phone/web) clock-in where the employee has a geofence, the server treats
// "no coordinates" as outside the fence and BLOCKS the punch (strict mode),
// returning a message telling them to enable location or use the wall clock.

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
