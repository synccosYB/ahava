import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/page-header";
import { AlertCircle, Building2, MapPin, Layers, Briefcase, CalendarDays, Clock, Umbrella, Timer } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

  vacationBalance: number;
  sickBalance: number;
  personalBalance: number;
}

function initials(first: string, last: string) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}

function formatLabel(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
                {status?.todayHours ?? 0}
                <span className="text-sm font-normal text-muted-foreground ml-1">hrs</span>
              </p>
            </div>
            <div className="text-center" data-testid="stat-week-hours">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                This Week
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {status?.weekHours ?? 0}
                <span className="text-sm font-normal text-muted-foreground ml-1">hrs</span>
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

function BalanceCard({
  label,
  days,
  icon: Icon,
  colorClass,
}: {
  label: string;
  days: number;
  icon: React.ElementType;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-md border p-4" data-testid={`card-balance-${label.toLowerCase()}`}>
      <div className={`rounded-full p-2 ${colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        <p className="text-xl font-semibold tabular-nums">
          {days}{" "}
          <span className="text-sm font-normal text-muted-foreground">days</span>
        </p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();

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
                    {formatDate(profile!.hireDate)}
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

      <Card data-testid="card-timeoff">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Umbrella className="h-4 w-4 text-muted-foreground" />
            Time-Off Balances
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <BalanceCard
                label="Vacation"
                days={profile!.vacationBalance}
                icon={Umbrella}
                colorClass="bg-blue-100 text-blue-600"
              />
              <BalanceCard
                label="Sick"
                days={profile!.sickBalance}
                icon={Clock}
                colorClass="bg-orange-100 text-orange-600"
              />
              <BalanceCard
                label="Personal"
                days={profile!.personalBalance}
                icon={CalendarDays}
                colorClass="bg-purple-100 text-purple-600"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
