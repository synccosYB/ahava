import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

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

type KioskScreen = "home" | "identify" | "confirm" | "success";

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
  const [lastActivity, setLastActivity] = useState(Date.now());
  const now = useCurrentTime();

  const resetToHome = useCallback(() => {
    setScreen("home");
    setEmployee(null);
    setLastRecord(null);
    setPunchType("clock_in");
    setPunchTime(null);
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
        <HomeScreen now={now} onStart={() => { setScreen("identify"); handleActivity(); }} />
      )}
      {screen === "identify" && (
        <IdentifyScreen
          onEmployeeFound={handleEmployeeFound}
          onCancel={resetToHome}
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
        />
      )}
    </div>
  );
}

function HomeScreen({ now, onStart }: { now: Date; onStart: () => void }) {
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
      <p className="kiosk-hint">Touch anywhere to begin</p>
    </div>
  );
}

function IdentifyScreen({
  onEmployeeFound,
  onCancel,
  onActivity,
}: {
  onEmployeeFound: (emp: KioskEmployee, record: KioskLastRecord | null) => void;
  onCancel: () => void;
  onActivity: () => void;
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

      <button
        className="kiosk-btn kiosk-btn-cancel"
        onClick={onCancel}
        data-testid="button-cancel"
      >
        Cancel
      </button>
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
}: {
  employee: KioskEmployee;
  punchType: "clock_in" | "clock_out";
  punchTime: Date | null;
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

      <p className="kiosk-countdown" data-testid="text-countdown">
        Returning to home screen in {countdown} seconds...
      </p>
    </div>
  );
}
