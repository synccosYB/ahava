# Ahava Fingerprint Clock — Setup & Sync Runbook

How to install, connect, and sync a **Compumatic XLS Bio v2** fingerprint clock
with Ahava. Written for whoever installs the clocks at each location.

> **Golden settings (confirmed working):** Server Mode **ADMS** · Enable Domain
> Name **ON** · Server Address **`synccos.space`** · Enable Proxy Server **OFF** ·
> HTTPS **ON**. (No port field appears in domain mode — HTTPS uses 443 automatically.)

---

## How it works (one paragraph)

Each clock pushes punches straight to Ahava over the internet — **no middleman
computer at the location.** A punch is recorded with **Ahava's server time** (not
the clock's displayed time), so even if a clock's on-screen clock looks off, the
punch lands at the correct real time. Fingerprints live **on each clock**, but
Ahava can **Harvest** them (pull them into a central store) and **Distribute**
them (push them to other clocks), so a person enrolls once and works on any clock.

---

## Part A — Set up the physical clock

1. **Mount & power** the clock.
2. **Connect to the internet** — `M/OK → COMM → Wireless Network` (WiFi), pick the
   network, enter the password, confirm **connected**. (Ethernet works too if the
   unit has a LAN port.)
   - *Keyboard tip:* the on-screen keyboard starts in number mode. Tap the mode
     key (shows `123`) to cycle to `abc` → `ABC` → symbols. On the keypad, letters
     are on the number keys (2=ABC, etc.).
   - *Easier for a hard password:* use a phone hotspot with a simple password, or
     Ethernet (no password).
3. **Point it at Ahava** — `M/OK → COMM → Cloud Server` and set:
   | Field | Value |
   |---|---|
   | Server Mode | **ADMS** |
   | Enable Domain Name | **ON** |
   | Server Address | **`synccos.space`** (no `https://`, no `/iclock`, no slash) |
   | Enable Proxy Server | **OFF** |
   | HTTPS | **ON** |
   - Save with **`M/OK`** (not ESC — ESC discards). The clock may reboot; that's normal.
4. **Set the date/time** — `M/OK → System → Date Time`, edit with the number keys,
   **save with `M/OK`**. (Correct time keeps HTTPS valid. It does *not* affect punch
   times, which use server time; the display may sync to UTC — that's cosmetic.)
5. **Find the serial number** — `M/OK → System Info → Device Info` → `Serial Number`
   (looks like `A39Z...`). Write it down.

---

## Part B — Register the clock in Ahava

1. In Ahava (web): left menu → **Fingerprint Clocks** → **Add Clock**.
2. Enter the **serial number exactly** (no spaces), a **name**, and the **location**.
3. Save. The clock should show as **Active**.
4. Power-cycle the clock (unplug ~10s, replug), wait 1–2 minutes, and confirm
   **Last seen** turns green / updates. That proves the clock reached Ahava.

---

## Part C — Enroll fingers (first clock at a location)

On the clock, for each person:
1. `M/OK → User Mgt → New User`.
2. Note the **User ID** it assigns (1, 2, 3…).
3. Leave **User Role = Normal User** (don't pick Super Admin).
4. `Fingerprint` → press the finger **3 times** (firm, flat, centered) → **save**.

**Pro tip — zero manual mapping:** in Ahava, give each employee an **Employee
Number equal to their clock User ID**. Then punches **auto-attach** to the right
person with no linking step.

---

## Part D — Map a punch to an employee (if not using the Employee-Number shortcut)

1. Fingerprint Clocks → click the **activity icon** on the clock's row → see punches.
2. A punch from an unmapped finger shows as **pending**. Pick the employee and
   link it. Future punches from that finger then auto-attach.

---

## Part E — Cloud sync (new or replacement clocks) — "enroll once, works everywhere"

On each clock's row in Fingerprint Clocks there are two sync buttons:
- 👆 **Harvest** (fingerprint icon): pull the clock's fingerprints **UP** into Ahava.
- ☁️⬇️ **Distribute** (cloud-down icon): push everyone's stored fingerprints **DOWN**
  onto this clock.

**To stand up a new (or replacement) clock without re-enrolling anyone:**
1. Set it up (Parts A–B) so it's connected and Active.
2. Make sure the people you want are already in Ahava's store (enrolled on another
   clock, then **Harvested**).
3. Click **Distribute** on the new clock. Wait ~15–30 seconds (it applies on the
   clock's next check-in). Everyone can now punch there.

> **Compatibility:** template sync only works between clocks of the **same model**
> (same fingerprint algorithm). All Ahava clocks are Compumatic XLS Bio v2, so
> this is fine. A different model would need its own enrollment.

---

## Troubleshooting

**"Last seen: never" / clock won't connect**
1. Re-check the golden settings (Part A, step 3) — exact spelling of `synccos.space`.
2. Confirm the serial in Ahava matches the clock **exactly** and is **Active**.
3. **Server side (needs Yoily / Replit):** the env var **`ADMS_INGEST_TOKEN` must be
   empty/removed** in production — a real clock can't send the secret header, so if
   that token is set the clock is blocked (403) and shows "never." It must be blank.
4. Power-cycle and wait 1–2 minutes.
5. If still nothing, Yoily checks the server logs for an `[adms] request … sn=<serial>`
   line — present = clock is reaching us (gate/registration issue); absent = the clock
   isn't getting through (device network/HTTPS firmware).

**Punch time looks wrong on the clock display** — ignore it. Punches record at Ahava's
server time; the display may show UTC. Cosmetic only.

**Harvest/Distribute didn't take** — the exact fingerprint wire format varies by
firmware. Yoily grabs the `[adms] bio upload` log line (fingerprint data is redacted)
and sends it to the dev so the parser can be tuned.

---

## Deploying code changes

Ahava runs on Replit. After any code change is merged to `main`, someone with Replit
access clicks **Publish/Redeploy** once — it rebuilds and runs the latest, and database
migrations run automatically on boot. No environment variables are required for the
clock features (and `ADMS_INGEST_TOKEN` must stay **empty** for direct clocks).
