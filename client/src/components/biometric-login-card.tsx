import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Camera, ShieldCheck, Trash2, Lock, AlertCircle } from "lucide-react";
import { FaceCapture } from "@/components/face-capture";
import { useToast } from "@/hooks/use-toast";

interface BiometricStatus {
  featureEnabled: boolean;
  profile: {
    id: string;
    name: string;
    consentText: string;
    consentVersion: number;
    isEnabled: boolean;
    retentionDays: number;
  } | null;
  hasConsent: boolean;
  consentAcceptedAt: string | null;
  enrolled: boolean;
  sampleCount: number;
  lastMatchedAt: string | null;
  legalHold: boolean;
  requiredSamples: number;
  maxSamples: number;
  livenessRequired: boolean;
}

export function BiometricLoginCard() {
  const { toast } = useToast();
  const [showConsent, setShowConsent] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [showCapture, setShowCapture] = useState(false);

  const { data, isLoading } = useQuery<BiometricStatus>({
    queryKey: ["/api/biometrics/me"],
  });

  const consentMutation = useMutation({
    mutationFn: async (consentVersion: number) => {
      const res = await apiRequest("POST", "/api/biometrics/consent", { consentVersion });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/me"] });
      setShowConsent(false);
      setShowCapture(true);
      toast({ title: "Consent recorded", description: "Now we'll capture your face samples." });
    },
    onError: (e: Error) => {
      toast({ title: "Could not save consent", description: e.message, variant: "destructive" });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async (descriptors: number[][]) => {
      const res = await apiRequest("POST", "/api/biometrics/face/enroll", { descriptors });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/me"] });
      setShowCapture(false);
      toast({ title: "Face enrolled", description: "You can now clock in with face at the kiosk." });
    },
    onError: (e: Error) => {
      toast({ title: "Enrollment failed", description: e.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/biometrics/consent");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/biometrics/me"] });
      toast({ title: "Face login revoked", description: "Your face template has been deleted." });
    },
    onError: (e: Error) => {
      toast({ title: "Revoke failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return (
      <Card data-testid="card-biometric-loading">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Biometric Login
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (!data.featureEnabled) {
    // Hide entirely when feature flag is off — no need to show "disabled" card.
    return null;
  }

  return (
    <Card data-testid="card-biometric-login">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Biometric Login
          </span>
          {data.enrolled ? (
            <Badge variant="default" data-testid="badge-biometric-enrolled">Enrolled</Badge>
          ) : (
            <Badge variant="outline" data-testid="badge-biometric-not-enrolled">Not enrolled</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.legalHold && (
          <Alert data-testid="alert-legal-hold">
            <Lock className="h-4 w-4" />
            <AlertDescription>
              Your account is on a legal hold. Biometric data cannot be modified at this time.
            </AlertDescription>
          </Alert>
        )}
        {!data.profile && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No legal profile is configured for your location. Ask an administrator to enable
              biometric login for your company.
            </AlertDescription>
          </Alert>
        )}
        {data.profile && !data.profile.isEnabled && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Biometric login is not yet enabled for your location.
            </AlertDescription>
          </Alert>
        )}
        {data.profile && data.profile.isEnabled && !data.enrolled && (
          <p className="text-sm text-muted-foreground" data-testid="text-biometric-info">
            Add face login so you can clock in/out at a kiosk just by looking at the camera. Your
            face image is never stored — only an encrypted numeric template. You can revoke at any
            time and continue using your PIN.
          </p>
        )}
        {data.enrolled && (
          <p className="text-sm text-muted-foreground" data-testid="text-biometric-enrolled-info">
            {data.sampleCount} face sample{data.sampleCount === 1 ? "" : "s"} on file
            {data.lastMatchedAt
              ? ` · last used ${formatDate(data.lastMatchedAt)}`
              : ""}
            .
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {data.profile && data.profile.isEnabled && !data.enrolled && !data.legalHold && (
            <Button
              onClick={() => {
                setConsentChecked(false);
                setShowConsent(true);
              }}
              data-testid="button-biometric-enroll"
            >
              <Camera className="h-4 w-4 mr-2" /> Set up face login
            </Button>
          )}
          {data.enrolled && !data.legalHold && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setConsentChecked(true);
                  setShowCapture(true);
                }}
                data-testid="button-biometric-recapture"
              >
                <Camera className="h-4 w-4 mr-2" /> Re-capture samples
              </Button>
              <Button
                variant="destructive"
                onClick={() => revokeMutation.mutate()}
                disabled={revokeMutation.isPending}
                data-testid="button-biometric-revoke"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Revoke & delete
              </Button>
            </>
          )}
        </div>
      </CardContent>

      {/* Consent dialog */}
      <Dialog open={showConsent} onOpenChange={setShowConsent}>
        <DialogContent className="max-w-2xl" data-testid="dialog-biometric-consent">
          <DialogHeader>
            <DialogTitle>Biometric consent — {data.profile?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-64 rounded-md border p-3">
            <pre className="whitespace-pre-wrap text-sm font-sans" data-testid="text-consent-body">
              {data.profile?.consentText}
            </pre>
          </ScrollArea>
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="biometric-consent"
              checked={consentChecked}
              onCheckedChange={(v) => setConsentChecked(v === true)}
              data-testid="checkbox-consent"
            />
            <label htmlFor="biometric-consent" className="text-sm">
              I have read and accept the consent statement above.
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConsent(false)} data-testid="button-consent-cancel">
              Not now
            </Button>
            <Button
              disabled={!consentChecked || consentMutation.isPending}
              onClick={() => data.profile && consentMutation.mutate(data.profile.consentVersion)}
              data-testid="button-consent-accept"
            >
              {consentMutation.isPending ? "Saving..." : "Accept & continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Capture dialog */}
      <Dialog open={showCapture} onOpenChange={(o) => { if (!o) setShowCapture(false); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-biometric-capture">
          <DialogHeader>
            <DialogTitle>Capture face samples</DialogTitle>
          </DialogHeader>
          {showCapture && (
            <FaceCapture
              mode="enroll"
              requiredSamples={data.requiredSamples}
              livenessRequired={data.livenessRequired}
              onComplete={(descriptors) => enrollMutation.mutate(descriptors)}
              onCancel={() => setShowCapture(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
