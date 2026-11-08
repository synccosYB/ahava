"""
Ahava fingerprint enrollment bridge (ZK9500 desk reader).

A browser cannot read a USB fingerprint reader directly, so this tiny local
service runs on the enrollment PC and exposes the ZK9500 over localhost. The
Ahava web app's enrollment screen (client/src/lib/fingerprintCapture.ts) calls
http://localhost:8899/capture; this reads one fingerprint and returns the vendor
template (base64) as JSON. Nothing leaves the PC except that response to the
browser on the same machine.

Runs headless (no console) when launched with pythonw.exe — see
install-bridge-task.ps1, which registers it to auto-start hidden at login. It
logs to %LOCALAPPDATA%\\ahava-fp\\bridge.log and waits for / reconnects to the
reader, so it survives a boot before the reader is plugged in or a cable bump.

Setup (Windows, the manager's enrollment PC):
  1. Install the ZK9500 driver (device shows up cleanly in Device Manager).
  2. Install Python 3 from python.org  (check "Add python.exe to PATH").
  3. py -m pip install pyzkfp
  4. Run once in the foreground to confirm:  py fpbridge.py
  5. Auto-start it hidden:  see install-bridge-task.ps1
"""
import json
import base64
import time
import threading
import os
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pyzkfp import ZKFP2

PORT = 8899
CAPTURE_TIMEOUT_SEC = 20

# Log to a file so the service is diagnosable when run headless (no console).
LOG_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "ahava-fp")
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    filename=os.path.join(LOG_DIR, "bridge.log"),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

lock = threading.Lock()
_zk = None


def open_device():
    """Open the reader, retrying until it's available (survives boot-before-plug
    and cable bumps). Stores the handle in the module-global _zk."""
    global _zk
    while True:
        try:
            z = ZKFP2()
            z.Init()
            if z.GetDeviceCount() >= 1:
                z.OpenDevice(0)
                _zk = z
                logging.info("Reader ready on http://localhost:%d", PORT)
                return
            try:
                z.Terminate()
            except Exception:
                pass
        except Exception as e:
            logging.warning("waiting for reader: %s", e)
        time.sleep(3)


def capture_once():
    """Capture one fingerprint within the timeout; re-open the device if it has
    dropped. Returns the template bytes, or None on timeout."""
    deadline = time.time() + CAPTURE_TIMEOUT_SEC
    while time.time() < deadline:
        try:
            cap = _zk.AcquireFingerprint()
        except Exception as e:
            logging.warning("capture error, reopening reader: %s", e)
            open_device()
            continue
        if cap:
            return bytes(cap[0])
        time.sleep(0.2)
    return None


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
            blob = capture_once()
        if blob is None:
            return self.reply(408, {"error": "No finger detected, try again."})
        self.reply(200, {
            "template": base64.b64encode(blob).decode(),
            "format": "ZKFinger10",
            "size": len(blob),
        })

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep the console quiet; we log to a file
        pass


if __name__ == "__main__":
    open_device()
    logging.info("Bridge listening on http://localhost:%d", PORT)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except Exception as e:
        logging.error("bridge stopped: %s", e)
        raise
