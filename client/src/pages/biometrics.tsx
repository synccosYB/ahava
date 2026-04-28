import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, ShieldCheck, Trash2, Lock, RefreshCw, Plus, Save } from "lucide-react";

interface BiometricSettings {
  id: string;
  featureEnabled: boolean;
  faceEnabled: boolean;
  thresholdAutoApprove: number;
  thresholdReview: number;
  thresholdReject: number;
  livenessRequired: boolean;
  maxAttemptsBeforeLockout: number;
  lockoutDurationMinutes: number;
  supervisorOverrideRequiresPin: boolean;
  minSamplesPerEnrollment: number;
  maxSamplesPerEnrollment: number;
  matchTimeoutMs: number;
}

interface LegalProfile {
  id: string;
  name: string;
  description: string | null;
  consentText: string;
  consentVersion: number;
  retentionDays: number;
  isEnabled: boolean;
  isDefault: boolean;
}

interface ProfileScope {
  id: string;
  legalProfileId: string;
  companyId: string | null;
  locationId: string | null;
}

interface EnrollmentRow {
  userId: string;
  userName: string;
  userEmail: string;
  templateId: string | null;
  sampleCount: number;
  enrolledAt: string | null;
  lastMatchedAt: string | null;
  consentAcceptedAt: string | null;
  consentRevokedAt: string | null;
  legalHold: boolean;
}

interface AttemptRow {
  id: string;
  candidateUserId: string | null;
  candidateUserName: string | null;
  outcome: string;
  confidence: number | null;
  livenessPassed: boolean | null;
  kioskDeviceId: string | null;
  createdAt: string;
}

interface OverrideRow {
  id: string;
  supervisorUserId: string;
  supervisorName: string | null;
  targetUserId: string;
  targetName: string | null;
  reason: string | null;
  kioskDeviceId: string | null;
  createdAt: string;
}

interface MetricsResponse {
  since: string;
  days: number;
  totalAttempts: number;
  autoApproved: number;
  reviewRequired: number;
  rejected: number;
  noMatch: number;
  livenessFailed: number;
  cameraError: number;
  averageConfidence: number | null;
  uniqueUsers: number;
  byDay: { date: string; total: number; matched: number }[];
}

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleString() : "—";
}

function pct(n: number, d: number) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

export default function BiometricsPage() {
  return (
    <div className="space-y-6 max-w-7xl" data-testid="biometrics-page">
      <PageHeader
        title="Biometric Governance"
        subtitle="Settings, legal profiles, enrollments, attempts, and metrics"
      />
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="enrollments" data-testid="tab-enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="attempts" data-testid="tab-attempts">Attempts</TabsTrigger>
          <TabsTrigger value="overrides" data-testid="tab-overrides">Overrides</TabsTrigger>
          <TabsTrigger value="profiles" data-testid="tab-profiles">Legal Profiles</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardTab /></TabsContent>
        <TabsContent value="enrollments"><EnrollmentsTab /></TabsContent>
        <TabsContent value="attempts"><AttemptsTab /></TabsContent>
        <TabsContent value="overrides"><OverridesTab /></TabsContent>
        <TabsContent value="profiles"><ProfilesTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function DashboardTab() {
  const { data, isLoading } = useQuery<MetricsResponse>({
    queryKey: ["/api/biometrics/metrics"],
  });

  if (isLoading || !data) return <Skeleton className="h-64" />;

  const stats = [
    { label: "Total attempts", value: data.totalAttempts, testId: "stat-total" },
    { label: "Auto-approved", value: data.autoApproved, testId: "stat-approved" },
    { label: "Review required", value: data.reviewRequired, testId: "stat-review" },
    { label: "No match", value: data.noMatch, testId: "stat-no-match" },
    { label: "Liveness failed", value: data.livenessFailed, testId: "stat-liveness" },
    { label: "Camera errors", value: data.cameraError, testId: "stat-camera" },
  ];

  return (
    <div className="space-y-4 mt-4">
      <p className="text-sm text-muted-foreground">
        Last {data.days} days. Match rate:{" "}
        <span className="font-medium" data-testid="text-match-rate">
          {pct(data.autoApproved, data.totalAttempts)}
        </span>
        {data.averageConfidence != null && (
          <>
            {" "}· Avg confidence:{" "}
            <span className="font-medium" data-testid="text-avg-confidence">
              {data.averageConfidence.toFixed(3)}
            </span>
          </>
        )}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <Card key={s.label} data-testid={`card-${s.testId}`}>
            <CardContent className="pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-semibold tabular-nums" data-testid={`text-${s.testId}`}>
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activity by day</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-activity">
              No activity in the selected window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Matched</TableHead>
                  <TableHead className="text-right">Match rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byDay.map((d) => (
                  <TableRow key={d.date} data-testid={`row-day-${d.date}`}>
                    <TableCell>{d.date}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.matched}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(d.matched, d.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EnrollmentsTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<EnrollmentRow[]>({
    queryKey: ["/api/biometrics/enrollments"],
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/biometrics/users/${userId}/revoke`, { reason: "admin_revoke" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/enrollments"] });
      toast({ title: "Revoked", description: "Face template deleted." });
    },
    onError: (e: Error) =>
      toast({ title: "Revoke failed", description: e.message, variant: "destructive" }),
  });

  const holdMutation = useMutation({
    mutationFn: async ({ userId, hold }: { userId: string; hold: boolean }) => {
      await apiRequest("POST", `/api/biometrics/users/${userId}/legal-hold`, { hold });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/enrollments"] });
      toast({ title: "Updated", description: "Legal hold updated." });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <Skeleton className="h-64 mt-4" />;

  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-enrollments">
            No biometric enrollments yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Samples</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Hold</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.userId} data-testid={`row-enrollment-${row.userId}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium" data-testid={`text-name-${row.userId}`}>
                        {row.userName}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.userEmail}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.templateId ? (
                      <Badge variant="default">Enrolled</Badge>
                    ) : row.consentRevokedAt ? (
                      <Badge variant="outline">Revoked</Badge>
                    ) : (
                      <Badge variant="secondary">Consent only</Badge>
                    )}
                  </TableCell>
                  <TableCell>{row.sampleCount}</TableCell>
                  <TableCell className="text-xs">{fmtDate(row.enrolledAt)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(row.lastMatchedAt)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={row.legalHold}
                      onCheckedChange={(v) => holdMutation.mutate({ userId: row.userId, hold: v })}
                      data-testid={`switch-hold-${row.userId}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.templateId && !row.legalHold && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeMutation.mutate(row.userId)}
                        data-testid={`button-revoke-${row.userId}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AttemptsTab() {
  const [outcome, setOutcome] = useState<string>("");
  const { data, isLoading } = useQuery<AttemptRow[]>({
    queryKey: ["/api/biometrics/attempts", outcome],
    queryFn: async () => {
      const url = outcome
        ? `/api/biometrics/attempts?outcome=${encodeURIComponent(outcome)}`
        : "/api/biometrics/attempts";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-base">Recent attempts</CardTitle>
        <select
          className="text-sm border rounded-md px-2 py-1 bg-background"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          data-testid="select-outcome-filter"
        >
          <option value="">All outcomes</option>
          <option value="auto_approved">Auto approved</option>
          <option value="review_required">Review required</option>
          <option value="no_match">No match</option>
          <option value="rejected">Rejected</option>
          <option value="liveness_failed">Liveness failed</option>
          <option value="camera_error">Camera error</option>
        </select>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-32" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-attempts">
            No attempts in the selected window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Liveness</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id} data-testid={`row-attempt-${r.id}`}>
                  <TableCell className="text-xs">{fmtDate(r.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={r.outcome === "auto_approved" ? "default" : "secondary"}>
                      {r.outcome.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.candidateUserName ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.confidence != null ? r.confidence.toFixed(3) : "—"}
                  </TableCell>
                  <TableCell>
                    {r.livenessPassed === true ? "✓" : r.livenessPassed === false ? "✗" : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function OverridesTab() {
  const { data, isLoading } = useQuery<OverrideRow[]>({
    queryKey: ["/api/biometrics/overrides"],
  });

  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        {isLoading || !data ? (
          <Skeleton className="h-32" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-overrides">
            No supervisor overrides recorded.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Supervisor</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id} data-testid={`row-override-${r.id}`}>
                  <TableCell className="text-xs">{fmtDate(r.createdAt)}</TableCell>
                  <TableCell>{r.supervisorName ?? r.supervisorUserId}</TableCell>
                  <TableCell>{r.targetName ?? r.targetUserId}</TableCell>
                  <TableCell className="text-sm">{r.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProfilesTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ profiles: LegalProfile[]; scopes: ProfileScope[] }>({
    queryKey: ["/api/biometrics/legal-profiles"],
  });
  const [editing, setEditing] = useState<LegalProfile | null>(null);
  const [creating, setCreating] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (p: Partial<LegalProfile> & { id?: string }) => {
      if (p.id) {
        const res = await apiRequest("PATCH", `/api/biometrics/legal-profiles/${p.id}`, p);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/biometrics/legal-profiles", p);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/legal-profiles"] });
      setEditing(null);
      setCreating(false);
      toast({ title: "Saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/biometrics/legal-profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/legal-profiles"] });
      toast({ title: "Deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <Skeleton className="h-64 mt-4" />;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} data-testid="button-new-profile">
          <Plus className="h-4 w-4 mr-2" /> New profile
        </Button>
      </div>
      {data.profiles.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>No legal profiles yet — create the first one.</AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retention (days)</TableHead>
                  <TableHead>Consent v.</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.profiles.map((p) => (
                  <TableRow key={p.id} data-testid={`row-profile-${p.id}`}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{p.name}</span>
                        {p.isDefault && (
                          <Badge variant="outline" className="w-fit mt-1 text-[10px]">
                            Default
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.isEnabled ? (
                        <Badge variant="default">Enabled</Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell>{p.retentionDays}</TableCell>
                    <TableCell>v{p.consentVersion}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(p)}
                        data-testid={`button-edit-profile-${p.id}`}
                      >
                        Edit
                      </Button>
                      {!p.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(p.id)}
                          data-testid={`button-delete-profile-${p.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {(editing || creating) && (
        <ProfileEditorDialog
          profile={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={(p) => saveMutation.mutate(p)}
          isPending={saveMutation.isPending}
        />
      )}
    </div>
  );
}

function ProfileEditorDialog({
  profile,
  onClose,
  onSave,
  isPending,
}: {
  profile: LegalProfile | null;
  onClose: () => void;
  onSave: (p: Partial<LegalProfile> & { id?: string }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [consentText, setConsentText] = useState(profile?.consentText ?? "");
  const [retentionDays, setRetentionDays] = useState(profile?.retentionDays ?? 180);
  const [isEnabled, setIsEnabled] = useState(profile?.isEnabled ?? false);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl" data-testid="dialog-profile-editor">
        <DialogHeader>
          <DialogTitle>{profile ? "Edit legal profile" : "New legal profile"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Illinois BIPA"
              data-testid="input-profile-name"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-profile-description"
            />
          </div>
          <div>
            <Label>Consent text</Label>
            <Textarea
              rows={10}
              value={consentText}
              onChange={(e) => setConsentText(e.target.value)}
              placeholder="The full consent statement employees must read and accept."
              data-testid="textarea-profile-consent"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Editing the consent text will bump the version, requiring all employees to re-accept.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Retention (days)</Label>
              <Input
                type="number"
                value={retentionDays}
                min={1}
                onChange={(e) => setRetentionDays(parseInt(e.target.value, 10) || 0)}
                data-testid="input-profile-retention"
              />
            </div>
            <div className="flex items-end gap-2">
              <Switch
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
                data-testid="switch-profile-enabled"
              />
              <span className="text-sm">Enabled</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name || !consentText || isPending}
            onClick={() =>
              onSave({
                id: profile?.id,
                name,
                description: description || null,
                consentText,
                retentionDays,
                isEnabled,
              })
            }
            data-testid="button-save-profile"
          >
            <Save className="h-4 w-4 mr-2" /> {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ settings: BiometricSettings; encryptionKeyEphemeral: boolean }>({
    queryKey: ["/api/biometrics/settings"],
  });
  const [draft, setDraft] = useState<Partial<BiometricSettings>>({});

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<BiometricSettings>) => {
      const res = await apiRequest("PATCH", "/api/biometrics/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/settings"] });
      setDraft({});
      toast({ title: "Settings saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const retentionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/biometrics/retention/run", {});
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({
        title: "Retention sweep complete",
        description: `Deleted ${r.deletedTemplates} template(s), revoked ${r.revokedConsents} consent(s).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/enrollments"] });
    },
    onError: (e: Error) =>
      toast({ title: "Retention run failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <Skeleton className="h-64 mt-4" />;
  const merged: BiometricSettings = { ...data.settings, ...draft };
  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="space-y-4 mt-4">
      {data.encryptionKeyEphemeral && (
        <Alert variant="destructive" data-testid="alert-ephemeral-key">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Ephemeral encryption key in use.</strong> Set
            <code className="mx-1 px-1 bg-muted rounded">BIOMETRIC_ENCRYPTION_KEY</code>
            (32-byte hex or base64) so face templates survive restarts.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Feature flags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Biometric feature enabled"
            description="Master switch. When off, no face login is offered anywhere."
            checked={merged.featureEnabled}
            onChange={(v) => setDraft((d) => ({ ...d, featureEnabled: v }))}
            testid="switch-feature-enabled"
          />
          <ToggleRow
            label="Face recognition enabled"
            description="Allow face as a biometric type. (Other types may be added later.)"
            checked={merged.faceEnabled}
            onChange={(v) => setDraft((d) => ({ ...d, faceEnabled: v }))}
            testid="switch-face-enabled"
          />
          <ToggleRow
            label="Liveness check required"
            description="Require a passive liveness signal before accepting a face match."
            checked={merged.livenessRequired}
            onChange={(v) => setDraft((d) => ({ ...d, livenessRequired: v }))}
            testid="switch-liveness"
          />
          <ToggleRow
            label="Supervisor override requires PIN"
            description="When on, supervisor PIN is required to authorize a kiosk override."
            checked={merged.supervisorOverrideRequiresPin}
            onChange={(v) => setDraft((d) => ({ ...d, supervisorOverrideRequiresPin: v }))}
            testid="switch-override-pin"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Match thresholds (lower = stricter)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberRow
            label="Auto-approve at or below"
            value={merged.thresholdAutoApprove}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, thresholdAutoApprove: v }))}
            testid="input-threshold-auto"
          />
          <NumberRow
            label="Send to review at or below"
            value={merged.thresholdReview}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, thresholdReview: v }))}
            testid="input-threshold-review"
          />
          <NumberRow
            label="Reject above"
            value={merged.thresholdReject}
            step={0.01}
            onChange={(v) => setDraft((d) => ({ ...d, thresholdReject: v }))}
            testid="input-threshold-reject"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Capture & lockout</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberRow
            label="Min samples per enrollment"
            value={merged.minSamplesPerEnrollment}
            onChange={(v) => setDraft((d) => ({ ...d, minSamplesPerEnrollment: v }))}
            testid="input-min-samples"
          />
          <NumberRow
            label="Max samples per enrollment"
            value={merged.maxSamplesPerEnrollment}
            onChange={(v) => setDraft((d) => ({ ...d, maxSamplesPerEnrollment: v }))}
            testid="input-max-samples"
          />
          <NumberRow
            label="Failed attempts before lockout"
            value={merged.maxAttemptsBeforeLockout}
            onChange={(v) => setDraft((d) => ({ ...d, maxAttemptsBeforeLockout: v }))}
            testid="input-max-attempts"
          />
          <NumberRow
            label="Lockout duration (minutes)"
            value={merged.lockoutDurationMinutes}
            onChange={(v) => setDraft((d) => ({ ...d, lockoutDurationMinutes: v }))}
            testid="input-lockout-minutes"
          />
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          onClick={() => retentionMutation.mutate()}
          disabled={retentionMutation.isPending}
          data-testid="button-run-retention"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Run retention sweep now
        </Button>
        <Button
          onClick={() => saveMutation.mutate(draft)}
          disabled={!dirty || saveMutation.isPending}
          data-testid="button-save-settings"
        >
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  testid,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testid: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testid} />
    </div>
  );
}

function NumberRow({
  label,
  value,
  step,
  onChange,
  testid,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
  testid: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        data-testid={testid}
      />
    </div>
  );
}
