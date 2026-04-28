import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Camera, Loader2, CheckCircle2 } from "lucide-react";
import {
  ensureModels,
  extractDescriptor,
  passiveLivenessOk,
} from "@/lib/face-api";

interface FaceCaptureProps {
  /** When in "enroll" mode the component collects N samples and emits them all. */
  mode: "enroll" | "identify";
  requiredSamples?: number;
  /** Called once enough samples have been collected (enroll) or one ID is ready. */
  onComplete: (descriptors: number[][], livenessPassed: boolean) => void;
  onCancel?: () => void;
  livenessRequired?: boolean;
  hint?: string;
  autoStart?: boolean;
}

type Phase =
  | "idle"
  | "loading-models"
  | "starting-camera"
  | "ready"
  | "capturing"
  | "complete"
  | "error";

/**
 * Reusable webcam-driven face capture surface. Used by:
 *  - Profile enrollment wizard: mode="enroll", N samples.
 *  - Kiosk identify flow: mode="identify", 1 descriptor.
 *
 * IMPORTANT: We never persist or transmit the video frames or images. Only the
 * 128-dim numeric descriptor leaves this component.
 */
export function FaceCapture({
  mode,
  requiredSamples = 3,
  onComplete,
  onCancel,
  livenessRequired = true,
  hint,
  autoStart = true,
}: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<number[][]>([]);
  const [livenessPair, setLivenessPair] = useState<number[] | null>(null);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>("");

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setPhase("loading-models");
      setProgressMsg("Loading face recognition models...");
      await ensureModels();
      setPhase("starting-camera");
      setProgressMsg("Requesting camera...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("ready");
      setProgressMsg("Look directly at the camera");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not access camera");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (autoStart) startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const captureOne = useCallback(async (): Promise<number[] | null> => {
    if (!videoRef.current) return null;
    const result = await extractDescriptor(videoRef.current);
    if (!result) return null;
    return result.descriptor;
  }, []);

  const beginCapture = useCallback(async () => {
    setError(null);
    setPhase("capturing");
    setSamples([]);
    setLivenessPair(null);
    setLivenessPassed(false);
    try {
      const collected: number[][] = [];
      let firstDesc: number[] | null = null;
      let livenessOk = !livenessRequired;
      const target = mode === "enroll" ? requiredSamples : 1;
      const startedAt = Date.now();
      const TIMEOUT_MS = 20000;

      while (collected.length < target) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          throw new Error(
            `Couldn't get a clear look at your face. Please try again with better lighting.`,
          );
        }
        setProgressMsg(`Captured ${collected.length} of ${target}...`);
        // Small delay so each sample is from a distinct frame.
        await new Promise((r) => setTimeout(r, 350));
        const d = await captureOne();
        if (!d) continue;
        if (!firstDesc) {
          firstDesc = d;
          setLivenessPair(d);
          collected.push(d);
          continue;
        }
        // Liveness: require the second frame to differ from the first within a band.
        if (!livenessOk) {
          if (passiveLivenessOk(firstDesc, d)) {
            livenessOk = true;
            setLivenessPassed(true);
          } else {
            // Don't add this sample; ask the user to move slightly.
            setProgressMsg("Move your head slightly...");
            continue;
          }
        }
        collected.push(d);
      }
      setSamples(collected);
      setPhase("complete");
      setProgressMsg("");
      onComplete(collected, livenessOk);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Capture failed");
      setPhase("error");
    }
  }, [captureOne, livenessRequired, mode, onComplete, requiredSamples]);

  // Identify mode: as soon as the camera is ready, start capture once.
  useEffect(() => {
    if (mode === "identify" && phase === "ready") {
      beginCapture();
    }
  }, [mode, phase, beginCapture]);

  return (
    <div className="space-y-3" data-testid="face-capture">
      <div className="relative aspect-[4/3] w-full max-w-md mx-auto rounded-md overflow-hidden bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
          data-testid="video-face-capture"
        />
        {(phase === "loading-models" || phase === "starting-camera") && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span data-testid="text-face-progress">{progressMsg}</span>
          </div>
        )}
        {phase === "complete" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span data-testid="text-face-complete">Captured</span>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center" data-testid="text-face-hint">
        {hint || "Position your face inside the frame, look at the camera, and stay still."}
      </p>

      {error && (
        <Alert variant="destructive" data-testid="face-capture-error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {phase === "ready" && mode === "enroll" && (
        <div className="text-center text-sm" data-testid="text-face-progress">
          {progressMsg}
        </div>
      )}

      {phase === "capturing" && (
        <div className="text-center text-sm flex items-center justify-center gap-2" data-testid="text-face-progress">
          <Loader2 className="h-4 w-4 animate-spin" /> {progressMsg}
        </div>
      )}

      <div className="flex gap-2 justify-center pt-1">
        {phase === "ready" && mode === "enroll" && (
          <Button onClick={beginCapture} data-testid="button-start-capture">
            <Camera className="h-4 w-4 mr-2" /> Start capture
          </Button>
        )}
        {phase === "error" && (
          <Button variant="outline" onClick={startCamera} data-testid="button-retry-capture">
            Try again
          </Button>
        )}
        {onCancel && phase !== "complete" && (
          <Button variant="ghost" onClick={() => { stopCamera(); onCancel(); }} data-testid="button-cancel-capture">
            Cancel
          </Button>
        )}
      </div>

      {samples.length > 0 && phase === "complete" && (
        <p className="text-xs text-center text-muted-foreground" data-testid="text-face-summary">
          {samples.length} sample{samples.length === 1 ? "" : "s"} captured
          {livenessRequired ? ` · liveness: ${livenessPassed ? "ok" : "skipped"}` : ""}
        </p>
      )}

      {/* Suppresses an unused-var warning while still keeping the pair in memory for future debugging */}
      <span className="sr-only">{livenessPair ? "" : ""}</span>
    </div>
  );
}
