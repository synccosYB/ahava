import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const WARNING_SECONDS = 60;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

/**
 * Global idle auto-logout. When the company's idle timeout is set (> 0) and the
 * signed-in user hasn't opted out, sign them out after that many minutes of no
 * activity — showing a 60-second "Stay signed in?" warning first. Admins can opt
 * out on their own profile; the kiosk/time-clock is unaffected (it isn't part of
 * the authenticated app shell this mounts in).
 */
export function IdleLogout() {
  const { user, logout } = useAuth();
  const { data: settings } = useQuery<{ idleLogoutMinutes: number }>({
    queryKey: ["/api/settings/session"],
    queryFn: async () => {
      const r = await fetch("/api/settings/session", { credentials: "include" });
      if (!r.ok) return { idleLogoutMinutes: 0 };
      return r.json();
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const minutes = settings?.idleLogoutMinutes ?? 0;
  const exempt = !!(user as unknown as { idleLogoutExempt?: boolean })?.idleLogoutExempt;
  const active = !!user && minutes > 0 && !exempt;

  const [warning, setWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARNING_SECONDS);
  // Actions wired up by the effect so the dialog buttons can call the latest.
  const stayRef = useRef<() => void>(() => {});
  const logoutNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active) {
      setWarning(false);
      return;
    }
    const timers: { idle?: number; warn?: number; tick?: number } = {};
    let warningOpen = false;
    const clear = () => {
      if (timers.idle) window.clearTimeout(timers.idle);
      if (timers.warn) window.clearTimeout(timers.warn);
      if (timers.tick) window.clearInterval(timers.tick);
      timers.idle = timers.warn = timers.tick = undefined;
    };
    const logoutNow = () => { clear(); warningOpen = false; setWarning(false); logout(); };
    const startWarning = () => {
      warningOpen = true;
      setWarning(true);
      setCountdown(WARNING_SECONDS);
      timers.tick = window.setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
      timers.warn = window.setTimeout(logoutNow, WARNING_SECONDS * 1000);
    };
    const arm = () => {
      clear();
      warningOpen = false;
      setWarning(false);
      timers.idle = window.setTimeout(startWarning, Math.max(0, minutes * 60 - WARNING_SECONDS) * 1000);
    };
    const onActivity = () => { if (!warningOpen) arm(); };

    stayRef.current = arm;
    logoutNowRef.current = logoutNow;
    arm();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clear();
    };
  }, [active, minutes, logout]);

  if (!active) return null;

  return (
    <Dialog open={warning} onOpenChange={(open) => { if (!open) stayRef.current(); }}>
      <DialogContent data-testid="dialog-idle-logout">
        <DialogHeader>
          <DialogTitle>Are you still there?</DialogTitle>
          <DialogDescription>
            You'll be signed out in {countdown} second{countdown === 1 ? "" : "s"} due to inactivity.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => logoutNowRef.current()} data-testid="button-idle-logout-now">
            Log out now
          </Button>
          <Button onClick={() => stayRef.current()} data-testid="button-idle-stay">
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
