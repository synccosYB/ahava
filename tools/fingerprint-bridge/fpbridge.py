"""
Ahava fingerprint enrollment bridge (ZK9500 desk reader).

A browser cannot read a USB fingerprint reader directly, so this tiny local
service runs on the enrollment PC and exposes the ZK9500 over localhost. The
Ahava web app's enrollment screen (client/src/lib/fingerprintCapture.ts) calls
http://localhost:8899/capture; this reads one fingerprint and returns the vendor
template (base64) as JSON. Nothing leaves the PC except that response to the
browser on the same machine.

Setup (Windows, the manager's enrollment PC):
  1. Install the ZK9500 driver (device shows up cleanly in Device Manager).
  2. Install Python 3 from python.org  (check "Add python.exe to PATH").
  3. py -m pip install pyzkfp
  4. py tools\\fingerprint-bridge\\fpbridge.py     (leave the window open)

The ZKFinger SDK DLLs that pyzkfp needs ship with the ZK9500 driver/SDK package.
Keep this window open while enrolling; close it when done.
"""
import json
import base64
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pyzkfp import ZKFP2

PORT = 8899
CAPTURE_TIMEOUT_SEC = 20
lock = threading.Lock()

z = ZKFP2()
z.Init()
if z.GetDeviceCount() < 1:
    raise SystemExit("No reader found. Plug in the ZK9500 and retry.")
z.OpenDevice(0)
print(f"Reader ready. Bridge on http://localhost:{PORT}  (leave this window open)")


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        # Reflect the caller's origin so the Ahava web app (whatever host it is
        # served from) can read the response; the service only listens on
        # localhost. Allow-Private-Network answers Chrome's local-network check.
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return self.reply(200, {"ok": True})
        if self.path.startswith("/capture"):
            return self.capture()
        self.reply(404, {"error": "not found"})

    def capture(self):
        with lock:
            deadline = time.time() + CAPTURE_TIMEOUT_SEC
            while time.time() < deadline:
                cap = z.AcquireFingerprint()
                if cap:
                    blob = bytes(cap[0])
                    return self.reply(200, {
                        "template": base64.b64encode(blob).decode(),
                        "format": "ZKFinger10",
                        "size": len(blob),
                    })
                time.sleep(0.2)
            self.reply(408, {"error": "No finger detected, try again."})

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep the console quiet
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
