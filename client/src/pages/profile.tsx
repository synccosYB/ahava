import { useState, useEffect } from "react";
import { formatHoursMinutes, formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { AlertCircle, Building2, MapPin, Layers, Briefcase, CalendarDays, Clock, Timer, CheckCircle2, Circle, Sparkles } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PtoAnniversaryAdjustment } from "@shared/schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CertificationsCard } from "@/components/certifications-card";
import { useLocation } from "wouter";
import { BiometricLoginCard } from "@/components/biometric-login-card";

interface ProfileDetails {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;

  divisionName: string;
  locationName: string;
  departmentName: string;

  employmentType: string;
  payType: string;
  hireDate: string | null;
  overtimeEligible: boolean;
}

function initials(first: string, last: string) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}

function formatLabel(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface AttendanceStatus {
  isClockedIn: boolean;
  currentRecord: { clockIn: string } | null;
  todayHours: number;
  weekHours: number;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function CurrentShiftCard() {
  const { user } = useAuth();
  const { data: status, isLoading, isError } = useQuery<AttendanceStatus>({
    queryKey: ["/api/attendance/status"],
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!status?.isClockedIn || !status.currentRecord) {
      setElapsed(0);
      return;
    }

    const clockInTime = new Date(status.currentRecord.clockIn).getTime();

    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - clockInTime) / 1000)));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status?.isClockedIn, status?.currentRecord?.clockIn]);

  if (isLoading) {
    return (
      <Card data-testid="card-current-shift">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            Current Shift
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 rounded-md" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-current-shift">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            Current Shift
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Unable to load shift status.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const isClockedIn = status?.isClockedIn ?? false;

  return (
    <Card data-testid="card-current-shift">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-4 w-4 text-muted-foreground" />
          Current Shift
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex items-center gap-3 min-w-0" data-testid="shift-status">
            <span
              className="relative flex h-3 w-3 shrink-0"
              data-testid="status-indicator"
            >
              {isClockedIn && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  isClockedIn ? "bg-green-500" : "bg-muted-foreground/40"
                }`}
              />
            </span>
            <div>
              <p className="text-sm font-medium" data-testid="text-shift-label">
                {isClockedIn ? "Clocked In" : "Not Clocked In"}
              </p>
              {isClockedIn ? (
                <p
                  className="text-3xl font-bold tabular-nums tracking-tight text-green-600 dark:text-green-400"
                  data-testid="text-live-timer"
                >
                  {formatElapsed(elapsed)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-shift-inactive">
                  No active shift
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-6 sm:ml-auto">
            <div className="text-center" data-testid="stat-today-hours">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Today
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {formatHoursMinutes(status?.todayHours ?? 0)}
              </p>
            </div>
            <div className="text-center" data-testid="stat-week-hours">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                This Week
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {formatHoursMinutes(status?.weekHours ?? 0)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FieldSkeleton() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-5 w-40" />
    </div>
  );
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {Array.from({ length: rows }).map((_, i) => (
        <FieldSkeleton key={i} />
      ))}
    </div>
  );
}

function PtoAnniversaryHistoryCard({ userId }: { userId: string | null }) {
  const { data, isLoading } = useQuery<(PtoAnniversaryAdjustment & { ptoPolicyName: string | null })[]>({
    queryKey: ["/api/users", userId, "pto-anniversary-adjustments"],
    queryFn: async () => {
      if (!userId) return [];
      const res = await fetch(`/api/users/${userId}/pto-anniversary-adjustments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load anniversary history");
      return res.json();
    },
    enabled: !!userId,
  });

  return (
    <Card data-testid="card-pto-anniversary-history" id="pto-anniversary">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          PTO Anniversary History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-pto-anniversary">
            No anniversary adjustments yet — your PTO accrual rate hasn't crossed a tier boundary.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Effective</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Years</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Old → New tier</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Hours added</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider">Source policy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id} data-testid={`row-pto-anniversary-${row.id}`}>
                  <TableCell data-testid={`text-pto-anniversary-date-${row.id}`}>{formatDate(row.effectiveDate) || "—"}</TableCell>
                  <TableCell>{row.yearsOfService}</TableCell>
                  <TableCell className="text-sm">
                    {row.oldTierLabel || "—"} → {row.newTierLabel || "—"}
                  </TableCell>
                  <TableCell data-testid={`text-pto-anniversary-hours-${row.id}`}>+{row.hoursAdded}</TableCell>
                  <TableCell className="text-sm" data-testid={`text-pto-anniversary-policy-${row.id}`}>
                    {row.ptoPolicyName || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          PTO anniversary adjustments are calculated automatically based on your hire date and the active PTO policy.
        </p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5" data-testid={`field-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}


interface MyOnboardingChecklist {
  id: string;
  status: string;
  hireDate: string | null;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    category: string;
    ownerRole: string;
    isRequired: boolean;
    documentType: string | null;
    dueDate: string | null;
    status: string;
    notes: string | null;
    skippedReason: string | null;
  }>;
  progress: { progressPct: number; completedRequired: number; totalRequired: number };
}

type OnboardingSelfTaskPatch = Partial<{
  status: "pending" | "in_progress" | "completed" | "skipped";
  notes: string | null;
  skippedReason: string | null;
}>;

function MyOnboardingCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: checklist } = useQuery<MyOnboardingChecklist | null>({
    queryKey: ["/api/onboarding-checklists/my"],
    enabled: !!user,
  });
  const [notesByTask, setNotesByTask] = useState<Record<string, string>>({});
  const [skipReasonByTask, setSkipReasonByTask] = useState<Record<string, string>>({});

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: OnboardingSelfTaskPatch }) => apiRequest("PATCH", `/api/onboarding-tasks/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/onboarding-checklists/my"] }),
    onError: (e: unknown) => toast({ title: "Failed to update task", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" }),
  });

  if (!checklist) return null;
  if (checklist.status !== "in_progress") return null;

  const employeeTasks = checklist.tasks.filter(t => t.ownerRole === "new_hire" || t.ownerRole === "system");
  if (employeeTasks.length === 0) return null;

  return (
    <Card data-testid="card-my-onboarding" className="border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Welcome — finish your onboarding
          </CardTitle>
          <Badge variant="secondary" data-testid="badge-my-onboarding-progress">{checklist.progress.progressPct}% complete</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{checklist.progress.completedRequired} of {checklist.progress.totalRequired} required tasks complete.</p>
        <div className="space-y-2">
          {employeeTasks.map(task => {
            const done = task.status === "completed" || task.status === "skipped";
            const systemTask = task.ownerRole === "system";
            return (
              <div
                key={task.id}
                className="flex items-start gap-3 border rounded-md p-3"
                data-testid={`row-my-task-${task.id}`}
              >
                <button
                  className="mt-0.5"
                  disabled={systemTask || updateMut.isPending}
                  onClick={() => updateMut.mutate({ id: task.id, patch: { status: done ? "pending" : "completed" } })}
                  data-testid={`button-toggle-my-task-${task.id}`}
                >
                  {done ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium text-sm ${done ? "line-through text-muted-foreground" : ""}`}>{task.title}</span>
                    {task.isRequired && <Badge variant="outline" className="text-xs">Required</Badge>}
                    {systemTask && <Badge variant="outline" className="text-xs">Auto</Badge>}
                  </div>
                  {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                  {task.dueDate && <p className="text-xs text-muted-foreground">Due {formatDate(task.dueDate)}</p>}
                  {task.skippedReason && <p className="text-xs italic text-muted-foreground mt-1">Reason: {task.skippedReason}</p>}
                  {!systemTask && (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        placeholder="Notes (optional)"
                        value={notesByTask[task.id] ?? task.notes ?? ""}
                        onChange={e => setNotesByTask({ ...notesByTask, [task.id]: e.target.value })}
                        onBlur={e => {
                          const next = e.target.value;
                          if ((task.notes ?? "") !== next) {
                            updateMut.mutate({ id: task.id, patch: { notes: next || null } });
                          }
                        }}
                        rows={2}
                        className="text-xs"
                        data-testid={`textarea-my-notes-${task.id}`}
                      />
                      {!done && !task.isRequired && (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Reason to skip"
                            value={skipReasonByTask[task.id] || ""}
                            onChange={e => setSkipReasonByTask({ ...skipReasonByTask, [task.id]: e.target.value })}
                            className="h-8 text-xs flex-1 rounded-md border border-input bg-background px-3 py-1"
                            data-testid={`input-my-skip-reason-${task.id}`}
                          />
                          <Button size="sm" variant="outline" onClick={() => {
                            const reason = skipReasonByTask[task.id]?.trim();
                            if (!reason) { toast({ title: "Provide a reason to skip", variant: "destructive" }); return; }
                            updateMut.mutate({ id: task.id, patch: { status: "skipped", skippedReason: reason } });
                          }} data-testid={`button-my-skip-task-${task.id}`}>Skip</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [location] = useLocation();
  const certIdFromUrl = (() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("certId");
  })();
  const sectionFromUrl = (() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("section");
  })();

  useEffect(() => {
    if (!sectionFromUrl) return;
    const id = `profile-section-${sectionFromUrl}`;
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [sectionFromUrl]);

  const {
    data: profile,
    isLoading,
    isError,
    error,
  } = useQuery<ProfileDetails>({
    queryKey: ["/api/profile/details"],
    enabled: !!user,
  });

  if (isError) {
    return (
      <div className="max-w-5xl" data-testid="profile-error">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {(error as Error)?.message ?? "Failed to load profile. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl" data-testid="profile-page">
      <PageHeader
        title="My Profile"
        subtitle="View your personal and employment information"
      />

      <Card data-testid="card-profile-header">
        <CardContent className="pt-6">
          <div className="flex items-center gap-5">
            {isLoading ? (
              <Skeleton className="h-16 w-16 rounded-full" />
            ) : (
              <Avatar className="h-16 w-16 text-lg" data-testid="avatar-profile">
                <AvatarFallback>
                  {initials(profile!.firstName, profile!.lastName)}
                </AvatarFallback>
              </Avatar>
            )}

            <div className="space-y-1 flex-1">
              {isLoading ? (
                <>
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-32" />
                </>
              ) : (
                <>
                  <h2 className="text-xl font-semibold tracking-tight" data-testid="text-profile-name">
                    {profile!.firstName} {profile!.lastName}
                  </h2>
                  <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{profile!.email}</p>
                  <Badge variant="secondary" className="mt-1 capitalize" data-testid="badge-profile-role">
                    {formatLabel(profile!.role)}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <CurrentShiftCard />

      <MyOnboardingCard />

      <Card data-testid="card-organization">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SectionSkeleton rows={3} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field
                label="Division"
                value={
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {profile!.divisionName}
                  </span>
                }
              />
              <Field
                label="Location"
                value={
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {profile!.locationName}
                  </span>
                }
              />
              <Field
                label="Department"
                value={
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    {profile!.departmentName}
                  </span>
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <BiometricLoginCard />

      <PtoAnniversaryHistoryCard userId={user?.id ?? null} />

      <Card data-testid="card-employment">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            Employment Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SectionSkeleton rows={4} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field
                label="Employment Type"
                value={formatLabel(profile!.employmentType)}
              />
              <Field
                label="Pay Type"
                value={formatLabel(profile!.payType)}
              />
              <Field
                label="Hire Date"
                value={
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    {formatDate(profile!.hireDate) || "—"}
                  </span>
                }
              />
              <Field
                label="Overtime Eligible"
                value={
                  <Badge
                    variant={profile!.overtimeEligible ? "default" : "secondary"}
                    data-testid="badge-overtime"
                  >
                    {profile!.overtimeEligible ? "Yes" : "No"}
                  </Badge>
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && profile && (
        <div id="profile-section-certifications">
          <CertificationsCard employeeId={user!.id} canEdit={false} highlightCertId={certIdFromUrl} />
        </div>
      )}

    </div>
  );
}
