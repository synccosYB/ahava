---
name: Punch source enforcement
description: Durable decisions for per-employee/location punch-method on/off control.
---

Punch methods are an admin-toggleable allow-list resolved from attendance policy rules. Five canonical methods exist: web, mobile, kiosk, qr, manager.

**Decision — default allow-list = web/mobile/kiosk/manager (qr off).**
**Why:** an absent policy must preserve prior behavior. Manager/admin corrections create punches and would 403 if `manager` weren't default-on; QR has no capture UX yet so it stays off.
**How to apply:** treat a missing/non-array list as "use default"; never invent a new default elsewhere.

**Decision — an explicit empty list means deny-all, NOT fall back to default.**
**Why:** an admin who unchecks every method is expressing intent; silently re-enabling defaults would create a config illusion (UI shows disabled, server still allows). An array of ONLY unknown values is the one exception — treat as corrupt and fail open to default rather than lock everyone out.
**How to apply:** distinguish three cases — undefined/null/not-array → default; `[]` → deny-all; array with ≥1 known value → honor exactly (filter unknowns).

**Decision — enforce per punch entry point, not via one middleware.**
**Why:** punches enter through several routes (web clock-in/out, kiosk, manager exception-resolve) each with a different inherent source; a single choke point doesn't exist. Face punches route through the kiosk punch path, so gating kiosk covers them. Exception "punch_removal" deletes rather than punches, so it's exempt from the manager gate.

**UI rule:** hide a clock action only for the source it actually submits (dashboard submits "web", so gate on "web"; kiosk gates on "kiosk"). Gating on a source the client can't actually send leads to server rejections instead of prevention.
