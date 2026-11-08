# Fingerprint enrollment bridge (ZK9500)

A small local service that lets the Ahava web app capture fingerprints from a
**ZK9500 USB desk reader**. Browsers can't read USB fingerprint sensors
directly, so this runs on the enrollment PC and exposes the reader over
`localhost`; the web app's enrollment screen calls it.

- App side: `client/src/lib/fingerprintCapture.ts` → `http://localhost:8899`
  (override with `VITE_FINGERPRINT_BRIDGE_URL`).
- Captured templates are pushed to the wall clocks by the existing F4 auto-push
  once an employee is enrolled.

## Setup (Windows enrollment PC)

1. Install the **ZK9500 driver** — confirm the device shows in Device Manager
   with no warning.
2. Install **Python 3** from <https://www.python.org/downloads/> — tick
   **"Add python.exe to PATH"** in the installer.
3. Install the reader library:
   ```
   py -m pip install pyzkfp
   ```
   (pyzkfp uses the ZKFinger SDK DLLs that ship with the ZK9500 driver/SDK.)
4. Start the bridge and leave the window open:
   ```
   py tools\fingerprint-bridge\fpbridge.py
   ```
   It prints `Reader ready. Bridge on http://localhost:8899`.

## Quick test

Open `http://localhost:8899/capture` in a browser on that PC, touch the reader,
and you should get JSON: `{"template":"...","format":"ZKFinger10","size":2048}`.

## Run it automatically (no terminal window)

Instead of keeping a terminal open, register it as a hidden background task that
starts at login and restarts itself if it stops:

```
powershell -ExecutionPolicy Bypass -File install-bridge-task.ps1
```

This runs `fpbridge.py` with `pythonw.exe` (no console) via a Scheduled Task
named `AhavaFingerprintBridge`. The bridge logs to
`%LOCALAPPDATA%\ahava-fp\bridge.log` and waits for / reconnects to the reader,
so it survives a reboot or a cable bump. Remove it with:

```
Unregister-ScheduledTask -TaskName "AhavaFingerprintBridge" -Confirm:$false
```

## Notes

- The service binds to `127.0.0.1` only — it is not reachable from the network.
- Only one copy can use the reader at a time; stop any foreground `py fpbridge.py`
  before starting the background task.
