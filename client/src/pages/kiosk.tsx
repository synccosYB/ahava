import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
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

type KioskScreen = "home" | "identify" | "face" | "supervisor-override" | "confirm" | "success";

// Kiosks identify themselves with a stable per-device id pulled from localStorage. The
// admin pairing flow seeds this; if absent, the face flow is unavailable and the kiosk
// transparently falls back to PIN.
function getKioskDeviceId(): string | null {
  try {
    return localStorage.getItem("kioskDeviceId");
  } catch {
    return null;
  }
}

async function postFaceJson(path: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const deviceId = getKioskDeviceId();
  if (deviceId) headers["X-Kiosk-Device-Id"] = deviceId;
  return fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });
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
  const [screen, setScreen] = useState<KioskScreen>("home");
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
  const now = useCurrentTime();
  const faceAvailable = !!getKioskDeviceId();

  const resetToHome = useCallback(() => {
    setScreen("home");
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
    if (screen === "home" || screen === "success") return;
    const check = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        resetToHome();
      }
    }, 1000);
    return () => clearInterval(check);
  }, [screen, lastActivity, resetToHome]);

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

  const handlePunch = useCallback(async () => {
    if (!employee) return;
    try {
      const res = await apiRequest("POST", "/api/kiosk/punch", {
        employeeId: employee.id,
        type: punchType,
      });
      const data = await res.json();
      setPunchTime(new Date(data.record.timestamp));
      setScheduleWarning(data.scheduleWarning || null);
      setScreen("success");
    } catch {
      alert("Failed to record punch. Please try again.");
    }
  }, [employee, punchType]);

  return (
    <div
      className="kiosk-container"
      onClick={handleActivity}
      onTouchStart={handleActivity}
      data-testid="kiosk-container"
    >
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
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Face login failed");
          onFailure(data.attemptId || null);
          setBusy(false);
          return;
        }
        if (data.outcome === "auto_approved" && data.employee) {
          onEmployeeFound(data.employee, data.lastRecord || null, data.attemptId);
          return;
        }
        const friendly: Record<string, string> = {
          not_enrolled: "No face is enrolled here yet. Please use your PIN.",
          rejected: "We couldn't recognize you. Try again or use your PIN.",
          no_match: "We couldn't recognize you. Try again or use your PIN.",
          low_confidence: "Face match was uncertain. Please use your PIN.",
          review_required: "Face match was uncertain. Please use your PIN.",
          liveness_failed: "Liveness check failed. Please try again with a real face.",
          camera_error: "Could not read your face — try better lighting.",
        };
        setError(friendly[data.outcome] || "Face login failed");
        onFailure(data.attemptId || null);
        setBusy(false);
      } catch (err: any) {
        setError(err?.message || "Face login failed");
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
        const res = await fetch(`/api/kiosk/search?q=${encodeURIComponent(employeeQuery)}`);
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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Override failed");
        setBusy(false);
        return;
      }
      onEmployeeFound(data.employee, data.lastRecord || null);
    } catch (err: any) {
      setError(err?.message || "Override failed");
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
      const res = await apiRequest("POST", "/api/kiosk/lookup-pin", { pin: pinValue });
      const data = await res.json();
      onEmployeeFound(data.employee, data.lastRecord || null);
    } catch {
      setPinError("Invalid PIN. Please try again.");
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
        const res = await fetch(`/api/kiosk/search?q=${encodeURIComponent(searchQuery)}`);
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
      const res = await fetch(`/api/kiosk/employee/${emp.id}`);
      const data = await res.json();
      onEmployeeFound(data.employee, data.lastRecord || null);
    } catch {
      alert("Failed to load employee data.");
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
}: {
  employee: KioskEmployee;
  lastRecord: KioskLastRecord | null;
  punchType: "clock_in" | "clock_out";
  now: Date;
  onPunch: () => void;
  onBack: () => void;
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

      <button
        className={`kiosk-btn kiosk-btn-punch ${punchType === "clock_in" ? "punch-in" : "punch-out"}`}
        onClick={onPunch}
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
