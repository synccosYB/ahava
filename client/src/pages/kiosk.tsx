import { useState, useEffect, useCallback } from "react";
import { FaceCapture } from "@/components/face-capture";

interface KioskEmployee {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  employeeId: string;
}

interface KioskLastRecord {
  id: string;
  type: "clock_in" | "clock_out" | null;
  timestamp: string | null;
}

type KioskScreen = "pairing" | "home" | "identify" | "face" | "supervisor-override" | "confirm" | "success";

// Kiosks identify themselves with a stable per-device id pulled from localStorage. The
// admin pairing flow seeds this; if absent, we show the pairing screen instead of the
// punch UI.
function getKioskDeviceId(): string | null {
  try {
    return localStorage.getItem("kioskDeviceId");
  } catch {
    return null;
  }
}

function setKioskDeviceId(id: string | null) {
  try {
    if (id) localStorage.setItem("kioskDeviceId", id);
    else localStorage.removeItem("kioskDeviceId");
  } catch {}
}

async function kioskFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const deviceId = getKioskDeviceId();
  if (deviceId) headers["X-Kiosk-Device-Id"] = deviceId;
  return fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
}

// Backwards-compatible alias used by the face flow.
async function postFaceJson(path: string, body: unknown): Promise<Response> {
  return kioskFetch(path, { method: "POST", body: JSON.stringify(body) });
}

// Friendly mapping from server / network error codes to human sentences. Anything
// not in this map falls back to a generic retry message — we never surface raw
// exception text on the tablet.
const FRIENDLY_ERROR_BY_CODE: Record<string, string> = {
  invalid_request: "Please try that again.",
  invalid_code: "That pairing code didn't work. Please double-check with your admin.",
  code_expired: "That pairing code has expired. Ask your admin for a new one.",
  device_inactive: "This kiosk is turned off. Ask your admin to enable it.",
  device_unpaired: "This kiosk was unpaired. Please enter a new pairing code.",
  missing_device_id: "This tablet isn't paired yet.",
  device_not_found: "This kiosk is no longer registered.",
  employee_not_found: "We couldn't find that employee.",
  already_clocked_in: "You're already clocked in.",
  not_clocked_in: "You're not currently clocked in.",
  policy_blocked: "Clock-in isn't allowed right now. Please see your supervisor.",
  not_enrolled: "No face is enrolled here yet. Please use your PIN.",
  rejected: "We couldn't recognize you. Please try again or use your PIN.",
  no_match: "We couldn't recognize you. Please try again or use your PIN.",
  low_confidence: "Face match was uncertain. Please use your PIN.",
  review_required: "Face match was uncertain. Please use your PIN.",
  liveness_failed: "Liveness check failed. Please try again with a real face.",
  camera_error: "Couldn't read your face. Try better lighting or use your PIN.",
  internal_error: "Something went wrong. Please try again in a moment.",
  network: "We couldn't reach the server. Please try again in a moment.",
};

function friendlyError(payload: any, fallback = "Something went wrong. Please try again."): string {
  if (!payload) return fallback;
  const code = typeof payload === "object" ? payload.code : undefined;
  if (code && FRIENDLY_ERROR_BY_CODE[code]) return FRIENDLY_ERROR_BY_CODE[code];
  return fallback;
}

const INACTIVITY_TIMEOUT = 30000;
const SUCCESS_TIMEOUT = 5000;

function useCurrentTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatShortTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getInitials(firstName: string, lastName: string) {
  return `${(firstName || "?")[0]}${(lastName || "?")[0]}`.toUpperCase();
}

export default function KioskPage() {
  // If the tablet hasn't been paired yet, drop straight into the pairing screen.
  const [screen, setScreen] = useState<KioskScreen>(() =>
    getKioskDeviceId() ? "home" : "pairing",
  );
  const [employee, setEmployee] = useState<KioskEmployee | null>(null);
  const [lastRecord, setLastRecord] = useState<KioskLastRecord | null>(null);
  const [punchType, setPunchType] = useState<"clock_in" | "clock_out">("clock_in");
  const [punchTime, setPunchTime] = useState<Date | null>(null);
  const [scheduleWarning, setScheduleWarning] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  // Track failed face-recognition attempts so we can surface supervisor-override after
  // a small streak instead of looping silently.
  const [faceFailureCount, setFaceFailureCount] = useState(0);
  const [lastFaceAttemptId, setLastFaceAttemptId] = useState<string | null>(null);
  const [paired, setPaired] = useState(!!getKioskDeviceId());
  const now = useCurrentTime();
  const faceAvailable = paired;

  // Heartbeat loop — pings every 45 seconds while paired. If the server says we
  // were unpaired/inactive, drop the local device id and return to the pairing
  // screen so a fresh code can be entered.
  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    async function ping() {
      try {
        const res = await kioskFetch("/api/kiosk/heartbeat", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.code === "device_unpaired" || data?.code === "device_not_found" || data?.code === "device_inactive") {
            if (!cancelled) {
              setKioskDeviceId(null);
              setPaired(false);
              setScreen("pairing");
            }
          }
        }
      } catch {
        // Network errors are silently retried — we don't want to drop the kiosk
        // off the pairing screen just because Wi-Fi blinked.
      }
    }
    ping();
    const interval = setInterval(ping, 45 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [paired]);

  const resetToHome = useCallback(() => {
    // Critical: an unpaired tablet must never land on the punch flow. If we've
    // lost (or never had) a device id, always return to the pairing screen so
    // admins can re-pair instead of leaving the kiosk usable without trust.
    setScreen(getKioskDeviceId() ? "home" : "pairing");
    setEmployee(null);
    setLastRecord(null);
    setPunchType("clock_in");
    setPunchTime(null);
    setScheduleWarning(null);
    setFaceFailureCount(0);
    setLastFaceAttemptId(null);
    setLastActivity(Date.now());
  }, []);

  useEffect(() => {
    // Don't run the inactivity timer on the pairing or home/success screens —
    // pairing is the safe resting state for an unpaired tablet and must not be
    // bounced away from on idle.
    if (screen === "home" || screen === "success" || screen === "pairing") return;
    const check = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        resetToHome();
      }
    }, 1000);
    return () => clearInterval(check);
  }, [screen, lastActivity, resetToHome]);

  // Wake / tab-focus heartbeat: when the tablet returns from sleep or the tab
  // is re-focused, immediately ping so we discover an unpair faster than the
  // 45s interval would allow.
  useEffect(() => {
    if (!paired) return;
    async function wakePing() {
      try {
        const res = await kioskFetch("/api/kiosk/heartbeat", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.code === "device_unpaired" || data?.code === "device_not_found" || data?.code === "device_inactive") {
            setKioskDeviceId(null);
            setPaired(false);
            setScreen("pairing");
          }
        }
      } catch {
        // Network blip — ignore, the regular interval will retry.
      }
    }
    const onVisibility = () => { if (document.visibilityState === "visible") wakePing(); };
    window.addEventListener("focus", wakePing);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", wakePing);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paired]);

  useEffect(() => {
    if (screen !== "success") return;
    const timeout = setTimeout(resetToHome, SUCCESS_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [screen, resetToHome]);

  const handleActivity = useCallback(() => {
    setLastActivity(Date.now());
  }, []);

  const handleEmployeeFound = useCallback((emp: KioskEmployee, record: KioskLastRecord | null) => {
    setEmployee(emp);
    setLastRecord(record);
    const isClockedIn = record?.type === "clock_in";
    setPunchType(isClockedIn ? "clock_out" : "clock_in");
    setScreen("confirm");
    handleActivity();
  }, [handleActivity]);

  const [punchError, setPunchError] = useState<string | null>(null);

  const handlePunch = useCallback(async () => {
    if (!employee) return;
    setPunchError(null);
    try {
      const res = await kioskFetch("/api/kiosk/punch", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id, type: punchType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPunchError(friendlyError(data, "We couldn't record that punch. Please try again."));
        return;
      }
      setPunchTime(new Date(data.record.timestamp));
      setScheduleWarning(data.scheduleWarning || null);
      setScreen("success");
    } catch {
      setPunchError(FRIENDLY_ERROR_BY_CODE.network);
    }
  }, [employee, punchType]);

  return (
    <div
      className="kiosk-container"
      onClick={handleActivity}
      onTouchStart={handleActivity}
      data-testid="kiosk-container"
    >
      {screen === "pairing" && (
        <PairingScreen
          onPaired={(deviceId) => {
            setKioskDeviceId(deviceId);
            setPaired(true);
            setScreen("home");
            handleActivity();
          }}
        />
      )}
      {screen === "home" && (
        <HomeScreen
          now={now}
          onStart={() => { setScreen("identify"); handleActivity(); }}
          onFaceStart={
            faceAvailable
              ? () => { setScreen("face"); handleActivity(); }
              : undefined
          }
        />
      )}
      {screen === "identify" && (
        <IdentifyScreen
          onEmployeeFound={handleEmployeeFound}
          onCancel={resetToHome}
          onActivity={handleActivity}
          onUseFace={faceAvailable ? () => { setScreen("face"); handleActivity(); } : undefined}
        />
      )}
      {screen === "face" && (
        <FaceScreen
          onEmployeeFound={(emp, rec, attemptId) => {
            setLastFaceAttemptId(attemptId);
            handleEmployeeFound(emp, rec);
          }}
          onFailure={(attemptId) => {
            setFaceFailureCount((n) => n + 1);
            setLastFaceAttemptId(attemptId);
            handleActivity();
          }}
          onSupervisorOverride={() => { setScreen("supervisor-override"); handleActivity(); }}
          onUsePin={() => { setScreen("identify"); handleActivity(); }}
          onCancel={resetToHome}
          failureCount={faceFailureCount}
        />
      )}
      {screen === "supervisor-override" && (
        <SupervisorOverrideScreen
          attemptId={lastFaceAttemptId}
          onEmployeeFound={handleEmployeeFound}
          onCancel={() => { setScreen("identify"); handleActivity(); }}
          onActivity={handleActivity}
        />
      )}
      {screen === "confirm" && employee && (
        <ConfirmScreen
          employee={employee}
          lastRecord={lastRecord}
          punchType={punchType}
          now={now}
          onPunch={handlePunch}
          onBack={() => { setScreen("identify"); handleActivity(); }}
          error={punchError}
          onClearError={() => setPunchError(null)}
        />
      )}
      {screen === "success" && employee && (
        <SuccessScreen
          employee={employee}
          punchType={punchType}
          punchTime={punchTime}
          scheduleWarning={scheduleWarning}
        />
      )}
    </div>
  );
}

function HomeScreen({
  now,
  onStart,
  onFaceStart,
}: {
  now: Date;
  onStart: () => void;
  onFaceStart?: () => void;
}) {
  return (
    <div className="kiosk-screen kiosk-home" data-testid="kiosk-home-screen">
      <h1 className="kiosk-brand" data-testid="text-brand">Ahava Medical Center</h1>
      <p className="kiosk-subtitle">Time & Attendance</p>
      <div className="kiosk-clock" data-testid="text-current-time">{formatTime(now)}</div>
      <p className="kiosk-date" data-testid="text-current-date">{formatDate(now)}</p>
      <button
        className="kiosk-btn kiosk-btn-primary"
        onClick={onStart}
        data-testid="button-start-clock"
      >
        Tap to Clock In / Out
      </button>
      {onFaceStart && (
        <button
          className="kiosk-btn kiosk-btn-secondary"
          onClick={onFaceStart}
          data-testid="button-start-face"
        >
          Use Face
        </button>
      )}
      <p className="kiosk-hint">Touch anywhere to begin</p>
    </div>
  );
}

function FaceScreen({
  onEmployeeFound,
  onFailure,
  onSupervisorOverride,
  onUsePin,
  onCancel,
  failureCount,
}: {
  onEmployeeFound: (emp: KioskEmployee, record: KioskLastRecord | null, attemptId: string) => void;
  onFailure: (attemptId: string | null) => void;
  onSupervisorOverride: () => void;
  onUsePin: () => void;
  onCancel: () => void;
  failureCount: number;
}) {
  const [statusMsg, setStatusMsg] = useState<string>("Look at the camera");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);

  const handleComplete = useCallback(
    async (descriptors: number[][], livenessPassed: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setStatusMsg("Looking up your face...");
      try {
        const res = await postFaceJson("/api/kiosk/face/identify", {
          descriptor: descriptors[0],
          livenessPassed,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(friendlyError(data, "Face login failed. Please try again."));
          onFailure(data.attemptId || null);
          setBusy(false);
          return;
        }
        if (data.outcome === "auto_approved" && data.employee) {
          onEmployeeFound(data.employee, data.lastRecord || null, data.attemptId);
          return;
        }
        setError(FRIENDLY_ERROR_BY_CODE[data.outcome] || "Face login failed. Please try again.");
        onFailure(data.attemptId || null);
        setBusy(false);
      } catch {
        setError(FRIENDLY_ERROR_BY_CODE.network);
        onFailure(null);
        setBusy(false);
      }
    },
    [busy, onEmployeeFound, onFailure],
  );

  return (
    <div className="kiosk-screen kiosk-identify" data-testid="kiosk-face-screen">
      <h2 className="kiosk-brand-sm">Face Recognition</h2>
      <p className="kiosk-subtitle-sm" data-testid="text-face-status">{statusMsg}</p>

      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto" }}>
        <FaceCapture
          key={captureKey}
          mode="identify"
          autoStart
          livenessRequired
          onComplete={handleComplete}
          hint="Stand in front of the camera and look ahead"
        />
      </div>

      {error && (
        <p className="kiosk-error" data-testid="text-face-error">{error}</p>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {error && (
          <button
            className="kiosk-btn kiosk-btn-secondary"
            onClick={() => { setError(null); setBusy(false); setCaptureKey((k) => k + 1); }}
            data-testid="button-face-try-again"
          >
            Try again
          </button>
        )}
        {failureCount >= 2 && (
          <button
            className="kiosk-btn kiosk-btn-secondary"
            onClick={onSupervisorOverride}
            data-testid="button-supervisor-override"
          >
            Supervisor override
          </button>
        )}
        <button
          className="kiosk-btn kiosk-btn-secondary"
          onClick={onUsePin}
          data-testid="button-use-pin"
        >
          Use PIN instead
        </button>
        <button
          className="kiosk-btn kiosk-btn-cancel"
          onClick={onCancel}
          data-testid="button-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SupervisorOverrideScreen({
  attemptId,
  onEmployeeFound,
  onCancel,
  onActivity,
}: {
  attemptId: string | null;
  onEmployeeFound: (emp: KioskEmployee, record: KioskLastRecord | null) => void;
  onCancel: () => void;
  onActivity: () => void;
}) {
  const [supervisorPin, setSupervisorPin] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [results, setResults] = useState<KioskEmployee[]>([]);
  const [target, setTarget] = useState<KioskEmployee | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (employeeQuery.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await kioskFetch(`/api/kiosk/search?q=${encodeURIComponent(employeeQuery)}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [employeeQuery]);

  async function submit() {
    if (!target || supervisorPin.length < 4) {
      setError("Choose an employee and enter the supervisor's PIN");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postFaceJson("/api/kiosk/face/supervisor-override", {
        supervisorPin,
        targetEmployeeId: target.id,
        reason: reason || "supervisor_override",
        attemptId,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(friendlyError(data, "Override failed. Please try again."));
        setBusy(false);
        return;
      }
      onEmployeeFound(data.employee, data.lastRecord || null);
    } catch {
      setError(FRIENDLY_ERROR_BY_CODE.network);
      setBusy(false);
    }
  }

  return (
    <div className="kiosk-screen kiosk-identify" data-testid="kiosk-supervisor-override-screen">
      <h2 className="kiosk-brand-sm">Supervisor override</h2>
      <p className="kiosk-subtitle-sm">
        A manager or admin can authorize a punch when face recognition fails.
      </p>

      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Employee</label>
          <input
            type="text"
            className="kiosk-search-input"
            placeholder="Search employee name..."
            value={target ? `${target.firstName} ${target.lastName}` : employeeQuery}
            onChange={(e) => { setTarget(null); setEmployeeQuery(e.target.value); onActivity(); }}
            data-testid="input-override-employee"
          />
          {!target && results.length > 0 && (
            <div className="kiosk-search-results" style={{ maxHeight: 200, overflowY: "auto" }}>
              {results.map((emp) => (
                <button
                  key={emp.id}
                  className="kiosk-search-result"
                  onClick={() => { setTarget(emp); setResults([]); setEmployeeQuery(""); onActivity(); }}
                  data-testid={`button-override-employee-${emp.id}`}
                >
                  <div className="kiosk-result-avatar">{getInitials(emp.firstName, emp.lastName)}</div>
                  <div className="kiosk-result-info">
                    <span className="kiosk-result-name">{emp.firstName} {emp.lastName}</span>
                    <span className="kiosk-result-detail">{emp.department} - ID #{emp.employeeId}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Supervisor PIN</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            className="kiosk-search-input"
            placeholder="••••"
            value={supervisorPin}
            onChange={(e) => { setSupervisorPin(e.target.value.replace(/[^0-9]/g, "")); onActivity(); }}
            data-testid="input-supervisor-pin"
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Reason (optional)</label>
          <input
            type="text"
            className="kiosk-search-input"
            placeholder="e.g. camera not detecting face"
            value={reason}
            onChange={(e) => { setReason(e.target.value); onActivity(); }}
            data-testid="input-override-reason"
          />
        </div>
        {error && <p className="kiosk-error" data-testid="text-override-error">{error}</p>}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            className="kiosk-btn kiosk-btn-primary"
            disabled={busy}
            onClick={submit}
            data-testid="button-override-submit"
          >
            {busy ? "Authorizing..." : "Authorize punch"}
          </button>
          <button
            className="kiosk-btn kiosk-btn-cancel"
            onClick={onCancel}
            data-testid="button-override-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IdentifyScreen({
  onEmployeeFound,
  onCancel,
  onActivity,
  onUseFace,
}: {
  onEmployeeFound: (emp: KioskEmployee, record: KioskLastRecord | null) => void;
  onCancel: () => void;
  onActivity: () => void;
  onUseFace?: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "search">("pin");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KioskEmployee[]>([]);
  const [searching, setSearching] = useState(false);

  const handlePinKey = useCallback(
    (key: string) => {
      onActivity();
      setPinError("");
      if (key === "C") {
        setPin("");
        return;
      }
      if (key === "OK") {
        if (pin.length < 4) {
          setPinError("PIN must be 4 digits");
          return;
        }
        lookupPin(pin);
        return;
      }
      if (pin.length < 4) {
        setPin((prev) => prev + key);
      }
    },
    [pin, onActivity]
  );

  async function lookupPin(pinValue: string) {
    try {
      const res = await kioskFetch("/api/kiosk/lookup-pin", {
        method: "POST",
        body: JSON.stringify({ pin: pinValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPinError("That PIN didn't match. Please try again.");
        setPin("");
        return;
      }
      onEmployeeFound(data.employee, data.lastRecord || null);
    } catch {
      setPinError(FRIENDLY_ERROR_BY_CODE.network);
      setPin("");
    }
  }

  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await kioskFetch(`/api/kiosk/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  async function selectEmployee(emp: KioskEmployee) {
    onActivity();
    try {
      const res = await kioskFetch(`/api/kiosk/employee/${emp.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPinError(friendlyError(data, "We couldn't load that employee. Please try again."));
        return;
      }
      onEmployeeFound(data.employee, data.lastRecord || null);
    } catch {
      setPinError(FRIENDLY_ERROR_BY_CODE.network);
    }
  }

  const pinDots = Array.from({ length: 4 }, (_, i) =>
    i < pin.length ? "●" : "○"
  ).join("  ");

  return (
    <div className="kiosk-screen kiosk-identify" data-testid="kiosk-identify-screen">
      <h2 className="kiosk-brand-sm">Ahava Medical Center</h2>
      <p className="kiosk-subtitle-sm">Enter your PIN or search your name</p>

      <div className="kiosk-tabs">
        <button
          className={`kiosk-tab ${mode === "pin" ? "active" : ""}`}
          onClick={() => { setMode("pin"); onActivity(); }}
          data-testid="button-tab-pin"
        >
          Enter PIN
        </button>
        <button
          className={`kiosk-tab ${mode === "search" ? "active" : ""}`}
          onClick={() => { setMode("search"); onActivity(); }}
          data-testid="button-tab-search"
        >
          Search by Name
        </button>
      </div>

      {mode === "pin" && (
        <div className="kiosk-pin-section" data-testid="kiosk-pin-entry">
          <div className="kiosk-pin-display" data-testid="text-pin-dots">{pinDots}</div>
          {pinError && <p className="kiosk-error" data-testid="text-pin-error">{pinError}</p>}
          <div className="kiosk-pin-pad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map((key) => (
              <button
                key={key}
                className={`kiosk-pin-key ${key === "C" ? "kiosk-pin-clear" : ""} ${key === "OK" ? "kiosk-pin-ok" : ""}`}
                onClick={() => handlePinKey(key)}
                data-testid={`button-pin-${key}`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "search" && (
        <div className="kiosk-search-section" data-testid="kiosk-name-search">
          <input
            type="text"
            className="kiosk-search-input"
            placeholder="Type employee name..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); onActivity(); }}
            autoFocus
            data-testid="input-search-name"
          />
          <div className="kiosk-search-results">
            {searching && <p className="kiosk-searching">Searching...</p>}
            {!searching && searchResults.length === 0 && searchQuery.length > 0 && (
              <p className="kiosk-no-results" data-testid="text-no-results">No employees found</p>
            )}
            {searchResults.map((emp) => (
              <button
                key={emp.id}
                className="kiosk-search-result"
                onClick={() => selectEmployee(emp)}
                data-testid={`button-employee-${emp.id}`}
              >
                <div className="kiosk-result-avatar">
                  {getInitials(emp.firstName, emp.lastName)}
                </div>
                <div className="kiosk-result-info">
                  <span className="kiosk-result-name">{emp.firstName} {emp.lastName}</span>
                  <span className="kiosk-result-detail">{emp.department} - ID #{emp.employeeId}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {onUseFace && (
          <button
            className="kiosk-btn kiosk-btn-secondary"
            onClick={() => { onUseFace(); onActivity(); }}
            data-testid="button-switch-to-face"
          >
            Use Face
          </button>
        )}
        <button
          className="kiosk-btn kiosk-btn-cancel"
          onClick={onCancel}
          data-testid="button-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ConfirmScreen({
  employee,
  lastRecord,
  punchType,
  now,
  onPunch,
  onBack,
  error,
  onClearError,
}: {
  employee: KioskEmployee;
  lastRecord: KioskLastRecord | null;
  punchType: "clock_in" | "clock_out";
  now: Date;
  onPunch: () => void;
  onBack: () => void;
  error?: string | null;
  onClearError?: () => void;
}) {
  const isClockedIn = lastRecord?.type === "clock_in";
  const initials = getInitials(employee.firstName, employee.lastName);

  return (
    <div className="kiosk-screen kiosk-confirm" data-testid="kiosk-confirm-screen">
      <p className="kiosk-confirm-date" data-testid="text-confirm-datetime">
        {formatDate(now)} — {formatTime(now)}
      </p>

      <div className="kiosk-avatar" data-testid="text-employee-initials">{initials}</div>

      <h2 className="kiosk-confirm-name" data-testid="text-employee-name">
        {employee.firstName} {employee.lastName}
      </h2>
      <p className="kiosk-confirm-dept" data-testid="text-employee-department">{employee.department} Department</p>
      <p className="kiosk-confirm-id" data-testid="text-employee-id">Employee ID: #{employee.employeeId}</p>

      <div className={`kiosk-status ${isClockedIn ? "clocked-in" : "clocked-out"}`} data-testid="text-current-status">
        <p className="kiosk-status-label">
          Current Status: {isClockedIn ? "Clocked In" : "Clocked Out"}
        </p>
        {lastRecord?.timestamp && (
          <p className="kiosk-status-time" data-testid="text-last-punch">
            Last punch: {formatShortTime(lastRecord.timestamp)}
          </p>
        )}
      </div>

      {error && (
        <p className="kiosk-error" data-testid="text-punch-error">{error}</p>
      )}

      <button
        className={`kiosk-btn kiosk-btn-punch ${punchType === "clock_in" ? "punch-in" : "punch-out"}`}
        onClick={() => { onClearError?.(); onPunch(); }}
        data-testid={`button-${punchType}`}
      >
        {punchType === "clock_in" ? "CLOCK IN" : "CLOCK OUT"}
      </button>

      <button className="kiosk-btn kiosk-btn-goback" onClick={onBack} data-testid="button-go-back">
        Not me — Go Back
      </button>
    </div>
  );
}

function PairingScreen({ onPaired }: { onPaired: (deviceId: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<{ name: string; locationDescription?: string | null } | null>(null);

  const submit = useCallback(async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kiosk/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.deviceId) {
        setError(friendlyError(data, "That code didn't work. Please try again."));
        setBusy(false);
        return;
      }
      setDeviceInfo({ name: data.name, locationDescription: data.locationDescription });
      onPaired(data.deviceId);
    } catch {
      setError(FRIENDLY_ERROR_BY_CODE.network);
      setBusy(false);
    }
  }, [onPaired]);

  const onKey = useCallback((digit: string) => {
    setError(null);
    setCode((prev) => {
      if (digit === "back") return prev.slice(0, -1);
      if (digit === "clear") return "";
      if (prev.length >= 6) return prev;
      const next = prev + digit;
      if (next.length === 6) submit(next);
      return next;
    });
  }, [submit]);

  const dots = Array.from({ length: 6 }, (_, i) => (i < code.length ? "●" : "○")).join("  ");

  return (
    <div className="kiosk-screen kiosk-identify" data-testid="kiosk-pairing-screen">
      <h2 className="kiosk-brand-sm">Pair this kiosk</h2>
      <p className="kiosk-subtitle-sm">
        Ask your admin to open the Kiosks page and generate a pairing code for this tablet.
      </p>

      <div className="kiosk-pin-display" data-testid="text-pairing-dots" style={{ letterSpacing: 12, fontSize: 36, marginTop: 24 }}>
        {dots}
      </div>

      {error && (
        <p className="kiosk-error" data-testid="text-pairing-error">{error}</p>
      )}

      {deviceInfo && (
        <p className="kiosk-hint" data-testid="text-pairing-success">
          Paired with {deviceInfo.name}{deviceInfo.locationDescription ? ` — ${deviceInfo.locationDescription}` : ""}.
        </p>
      )}

      <div className="kiosk-keypad" style={{ marginTop: 24 }}>
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button
            key={d}
            className="kiosk-key"
            onClick={() => onKey(d)}
            disabled={busy}
            data-testid={`button-pair-key-${d}`}
          >
            {d}
          </button>
        ))}
        <button className="kiosk-key kiosk-key-action" onClick={() => onKey("clear")} disabled={busy} data-testid="button-pair-clear">Clear</button>
        <button className="kiosk-key" onClick={() => onKey("0")} disabled={busy} data-testid="button-pair-key-0">0</button>
        <button className="kiosk-key kiosk-key-action" onClick={() => onKey("back")} disabled={busy} data-testid="button-pair-backspace">⌫</button>
      </div>
    </div>
  );
}

function SuccessScreen({
  employee,
  punchType,
  punchTime,
  scheduleWarning,
}: {
  employee: KioskEmployee;
  punchType: "clock_in" | "clock_out";
  punchTime: Date | null;
  scheduleWarning: string | null;
}) {
  const [countdown, setCountdown] = useState(5);
  const isClockIn = punchType === "clock_in";

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`kiosk-screen kiosk-success ${isClockIn ? "success-in" : "success-out"}`}
      data-testid="kiosk-success-screen"
    >
      <div className={`kiosk-check ${isClockIn ? "check-green" : "check-red"}`} data-testid="icon-success-check">
        ✓
      </div>

      <h2 className={`kiosk-success-title ${isClockIn ? "title-green" : "title-red"}`} data-testid="text-success-type">
        {isClockIn ? "Clocked In" : "Clocked Out"}
      </h2>

      <p className="kiosk-success-name" data-testid="text-success-employee">
        {employee.firstName} {employee.lastName}
      </p>

      <p className={`kiosk-success-time ${isClockIn ? "time-green" : "time-red"}`} data-testid="text-success-time">
        {punchTime ? formatShortTime(punchTime) : ""}
      </p>
      <p className="kiosk-success-date" data-testid="text-success-date">
        {punchTime ? formatDate(punchTime) : ""}
      </p>

      {scheduleWarning && (
        <p className="kiosk-schedule-warning" data-testid="text-schedule-warning">
          {scheduleWarning}
        </p>
      )}

      <p className="kiosk-countdown" data-testid="text-countdown">
        Returning to home screen in {countdown} seconds...
      </p>
    </div>
  );
}
