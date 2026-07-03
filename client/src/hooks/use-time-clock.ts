import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { liveElapsedSeconds } from "@/lib/utils";
import { getPunchCoords } from "@/lib/geolocation";
import { useToast } from "@/hooks/use-toast";
import type { AttendanceRecord } from "@shared/schema";

export interface TimeClockStatus {
  isClockedIn: boolean;
  currentRecord: (AttendanceRecord & { timezone?: string | null }) | null;
  onBreak: boolean;
  breakStartedAt: string | null;
  breakMinutes: number;
  todayHours: number;
  weekHours: number;
  allowedPunchSources?: string[];
  geofenceEnabled?: boolean;
  timezone?: string | null;
}

const STATUS_KEY = ["/api/attendance/status"];

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Shared time-clock state + actions used by BOTH the dashboard status card and
 * the floating widget so they behave identically. Both consumers subscribe to
 * the SAME `/api/attendance/status` query key, so React Query dedupes the
 * request and keeps them in lockstep.
 *
 * The live shift timer is seeded from the status response the moment it lands
 * and ticks every second from mount (no "few seconds late" gap). Clock-in
 * optimistically primes the status cache so the counter starts immediately.
 */
export function useTimeClock() {
  const { toast } = useToast();

  const query = useQuery<TimeClockStatus>({
    queryKey: STATUS_KEY,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
  const { data: status, dataUpdatedAt } = query;

  // A single 1s ticker drives both the shift and break live timers. It runs
  // whenever the employee is clocked in (cheap) so the counter never waits a
  // second to appear.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!status?.isClockedIn) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status?.isClockedIn, status?.currentRecord?.clockIn, status?.onBreak]);

  const clockInIso = status?.currentRecord?.clockIn ?? null;
  const elapsedSeconds = status?.isClockedIn ? liveElapsedSeconds(clockInIso, nowMs) : 0;
  const elapsedLabel = formatClock(elapsedSeconds);

  const breakElapsedSeconds = status?.onBreak
    ? liveElapsedSeconds(status?.breakStartedAt ?? null, nowMs)
    : 0;
  const breakElapsedLabel = formatClock(breakElapsedSeconds);

  const allowedSources = status?.allowedPunchSources;
  const canSelfPunch = !allowedSources || allowedSources.includes("web");

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const coords = status?.geofenceEnabled
        ? await getPunchCoords()
        : { latitude: null, longitude: null };
      const body =
        coords.latitude != null && coords.longitude != null
          ? { latitude: coords.latitude, longitude: coords.longitude }
          : undefined;
      const res = await apiRequest("POST", "/api/attendance/clock-in", body);
      return res.json() as Promise<AttendanceRecord & { scheduleWarning?: string }>;
    },
    onSuccess: (data) => {
      // Optimistically prime the status cache so the live timer starts ticking
      // the instant the punch lands, before the refetch resolves.
      queryClient.setQueryData<TimeClockStatus>(STATUS_KEY, (old) =>
        old
          ? { ...old, isClockedIn: true, currentRecord: data, onBreak: false, breakStartedAt: null, breakMinutes: 0 }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/records"] });
      toast({ title: "Clocked In", description: data?.scheduleWarning || "You have successfully clocked in." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/attendance/clock-out");
      return res.json() as Promise<AttendanceRecord & { scheduleWarning?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/records"] });
      toast({ title: "Clocked Out", description: data?.scheduleWarning || "You have successfully clocked out." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const startBreakMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/attendance/break/start");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      toast({ title: "Break Started", description: "Enjoy your break." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const endBreakMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/attendance/break/end");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/records"] });
      toast({ title: "Break Ended", description: "Welcome back." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return useMemo(
    () => ({
      status,
      query,
      dataUpdatedAt,
      nowMs,
      isClockedIn: !!status?.isClockedIn,
      onBreak: !!status?.onBreak,
      elapsedSeconds,
      elapsedLabel,
      breakElapsedSeconds,
      breakElapsedLabel,
      canSelfPunch,
      clockInMutation,
      clockOutMutation,
      startBreakMutation,
      endBreakMutation,
    }),
    [
      status,
      query,
      dataUpdatedAt,
      nowMs,
      elapsedSeconds,
      elapsedLabel,
      breakElapsedSeconds,
      breakElapsedLabel,
      canSelfPunch,
      clockInMutation,
      clockOutMutation,
      startBreakMutation,
      endBreakMutation,
    ],
  );
}
