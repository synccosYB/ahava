/**
 * Lazy-loaded face-api.js wrapper.
 *
 * face-api.js is large (~1MB) and the model files are larger still, so we never bundle
 * them. Instead we import the library on first use and load model weights from a CDN
 * (overridable via VITE_FACE_MODELS_URL). The browser caches both — subsequent uses
 * are essentially free.
 *
 * The module exports two operations the UI needs:
 *  - ensureModels(): preload models, returns a Promise that resolves once ready.
 *  - extractDescriptor(video): grabs the most prominent face in the frame and returns
 *    a 128-dim Float32 descriptor as a plain number[] (so it can be JSON-encoded).
 *
 * We intentionally keep this module thin so the kiosk and profile pages can share it.
 */

const DEFAULT_MODEL_URL =
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";

const MODEL_URL =
  (import.meta as any).env?.VITE_FACE_MODELS_URL || DEFAULT_MODEL_URL;

type FaceApiModule = typeof import("@vladmandic/face-api");

let moduleP: Promise<FaceApiModule> | null = null;
let modelsP: Promise<void> | null = null;

async function loadModule(): Promise<FaceApiModule> {
  if (!moduleP) {
    moduleP = import("@vladmandic/face-api").then((m) => {
      // The default export and namespace exports both work; favour the namespace shape.
      return (m as any).default ?? m;
    });
  }
  return moduleP;
}

export async function ensureModels(): Promise<void> {
  if (modelsP) return modelsP;
  modelsP = (async () => {
    const faceapi = await loadModule();
    // We use TinyFaceDetector (small + fast) + the 128-dim recognition net.
    // The 68-point landmarks net is required by the recognition pipeline.
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })().catch((err) => {
    // Reset so a retry can attempt again.
    modelsP = null;
    throw err;
  });
  return modelsP;
}

export interface DescriptorWithBox {
  descriptor: number[];
  box: { x: number; y: number; width: number; height: number };
  landmarksOk: boolean;
}

export async function extractDescriptor(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<DescriptorWithBox | null> {
  const faceapi = await loadModule();
  await ensureModels();
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.5,
  });
  const result = await faceapi
    .detectSingleFace(source as any, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  const box = result.detection.box;
  return {
    descriptor: Array.from(result.descriptor),
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    landmarksOk: !!result.landmarks,
  };
}

/**
 * Best-effort liveness signal: compares two descriptors taken a few hundred ms apart,
 * checking that the face moved/blinked just enough to differ but not so much that it
 * looks like a different person. This is NOT a strong anti-spoofing signal (a still
 * photo on a phone would still pass with motion); it's the lightest-weight check we can
 * ship without paid services and is deliberately documented as such for admins.
 */
export function passiveLivenessOk(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sumSq += d * d;
  }
  const dist = Math.sqrt(sumSq);
  // A perfect still image yields ~0; a different person ~> 0.6. We accept the middle.
  return dist > 0.005 && dist < 0.4;
}
