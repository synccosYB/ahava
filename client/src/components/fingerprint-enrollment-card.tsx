import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Fingerprint, Trash2, Plus } from "lucide-react";
import { captureFingerprint, FingerprintCaptureUnavailable } from "@/lib/fingerprintCapture";

// ZKTeco finger indices 0–9. The exact hand/finger mapping is confirmed against
// the physical reader; labels are a sensible default for the picker.
const FINGER_LABELS: Record<number, string> = {
  0: "Right thumb", 1: "Right index", 2: "Right middle", 3: "Right ring", 4: "Right little",
  5: "Left thumb", 6: "Left index", 7: "Left middle", 8: "Left ring", 9: "Left little",
};

type Finger = {
  fingerIndex: number;
  format: string | null;
  valid: boolean;
  enrolledAt: string;
  source: "station" | "clock";
};

/**
 * Fingerprint enrollment station (ZK9500 desk reader). A manager captures an
 * employee's finger at the desk; the template is stored and auto-pushed to the
 * employee's wall clock(s) so it works at the Compumatic without re-enrolling.
 *
 * Capture runs through the device seam in lib/fingerprintCapture; until the
 * reader's local service is wired, Capture shows a "connect the reader" message.
 */
export function FingerprintEnrollmentCard({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [fingerIndex, setFingerIndex] = useState(1);

  const query = useQuery<{ fingers: Finger[] }>({
    queryKey: ["/api/biometrics/users", employeeId, "fingerprints"],
    queryFn: () =>
      apiRequest("GET", `/api/biometrics/users/${employeeId}/fingerprints`).then((r) => r.json()),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/biometrics/users", employeeId, "fingerprints"] });

  const enroll = useMutation({
    mutationFn: async (idx: number) => {
      // 1) capture from the desk reader (device seam), 2) store + push server-side.
      const cap = await captureFingerprint({ fingerIndex: idx });
      return apiRequest("POST", `/api/biometrics/users/${employeeId}/enroll-fingerprint`, {
        fingerIndex: idx,
        template: cap.template,
        format: cap.format,
        size: cap.size,
      }).then((r) => r.json());
    },
    onSuccess: (data: { pushedToClocks?: number }) => {
      toast({
        title: "Fingerprint enrolled",
        description:
          (data?.pushedToClocks ?? 0) > 0
            ? `Saved and pushed to ${data.pushedToClocks} clock(s).`
            : "Saved. It will push to the employee's clock(s) automatically.",
      });
      invalidate();
    },
    onError: (err: Error) => {
      if (err instanceof FingerprintCaptureUnavailable) {
        toast({ title: "Reader not connected", description: err.message });
      } else {
        toast({ title: "Couldn't enroll", description: err.message, variant: "destructive" });
      }
    },
  });

  const remove = useMutation({
    mutationFn: (idx: number) =>
      apiRequest("DELETE", `/api/biometrics/users/${employeeId}/fingerprints/${idx}`).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Fingerprint removed" });
      invalidate();
    },
    onError: (err: Error) => toast({ title: "Couldn't remove", description: err.message, variant: "destructive" }),
  });

  const fingers = query.data?.fingers ?? [];
  const alreadyEnrolled = new Set(fingers.map((f) => f.fingerIndex));

  return (
    <Card data-testid="card-fingerprint-enrollment">
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-muted-foreground" />
          Fingerprint enrollment (desk reader)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Capture a finger at the manager's desk reader; it's stored for this employee and pushed to
          their wall clock(s) automatically. The employee must have biometric consent on file first.
        </p>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="finger-select" className="text-xs text-muted-foreground">Finger</label>
            <select
              id="finger-select"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={fingerIndex}
              onChange={(e) => setFingerIndex(Number(e.target.value))}
              data-testid="select-finger"
            >
              {Object.entries(FINGER_LABELS).map(([idx, label]) => (
                <option key={idx} value={idx}>
                  {label}{alreadyEnrolled.has(Number(idx)) ? " (enrolled)" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            onClick={() => enroll.mutate(fingerIndex)}
            disabled={enroll.isPending}
            data-testid="button-enroll-finger"
          >
            {enroll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            {alreadyEnrolled.has(fingerIndex) ? "Re-capture & enroll" : "Capture & enroll"}
          </Button>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Enrolled fingers</div>
          {query.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : fingers.length === 0 ? (
            <p className="text-muted-foreground">No fingerprints enrolled yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {fingers.map((f) => (
                <li
                  key={f.fingerIndex}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                  data-testid={`row-finger-${f.fingerIndex}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium">{FINGER_LABELS[f.fingerIndex] ?? `Finger ${f.fingerIndex}`}</span>
                    <Badge variant="outline" className="text-xs">
                      {f.source === "station" ? "Desk reader" : "Clock"}
                    </Badge>
                    {!f.valid && <Badge variant="destructive" className="text-xs">invalid</Badge>}
                  </div>
                  {f.source === "station" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(f.fingerIndex)}
                      disabled={remove.isPending}
                      data-testid={`button-remove-finger-${f.fingerIndex}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
