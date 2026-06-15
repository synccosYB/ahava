---
name: Clock-in geofencing
description: Durable behavioral rules/decisions for clock-in geofencing.
---
Clock-in geofencing NEVER blocks a punch. When a punch is outside the allowed
radius of any of the employee's geofenced location addresses (or geofencing is
required but the device shared no coordinates), the clock-in still succeeds and
a pending `attendance_exceptions` row of type `"geofence"` is raised for a
manager.

**Why:** product requirement — staff must always be able to clock in; geofence
is an oversight signal, not access control. Hard-blocking, clock-out/break
geofence, map UI, and anti-spoof are explicitly out of scope.

**Rules to keep:**
- Geofence flagging must never throw — a geofence failure cannot break a punch.
- "No location" (denied/unavailable GPS) must stay null end-to-end. Do NOT
  coerce coords with `Number()` server-side: `Number(null) === 0` would turn a
  missing location into a valid `(0,0)` punch and break the required-but-missing
  case. Accept only real numbers; clients omit lat/lng when unavailable.
- Geofence is evaluated only on the clock-in branch (web + kiosk), never on
  clock-out/break.
- `attendance_exceptions.type` is free-form varchar, so new exception types need
  no schema change — but they MUST be added to the manager exception type list
  to be filterable/labelled.
- Addresses autocomplete via a SerpApi server-side proxy (single server key,
  lat/lng captured inline), not the Google JS SDK.
