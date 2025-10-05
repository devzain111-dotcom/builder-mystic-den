import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

function getModelsBase(): string {
  const fromEnv = (import.meta as any).env?.VITE_FACE_MODELS_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
}

export async function loadFaceModels() {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;
  const base = getModelsBase();
  loadingPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
      faceapi.nets.faceExpressionNet.loadFromUri(base),
    ]);
    modelsLoaded = true;
  })();
  return loadingPromise;
}

export async function detectSingleDescriptor(video: HTMLVideoElement) {
  await loadFaceModels();
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  return { descriptor: Array.from(result.descriptor) as number[], landmarks: result.landmarks.positions };
}

// Simple passive liveness: detect blink or natural motion between frames
export async function checkLiveness(video: HTMLVideoElement, tries = 6, intervalMs = 250): Promise<boolean> {
  await loadFaceModels();
  let lastEyeRatio: number | null = null;
  let motionDetected = false;
  for (let i = 0; i < tries; i++) {
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks();
    if (!det) { await new Promise(r => setTimeout(r, intervalMs)); continue; }
    const pts = det.landmarks.positions;
    const leftEye = [36, 37, 38, 39, 40, 41].map(i => pts[i]);
    const rightEye = [42, 43, 44, 45, 46, 47].map(i => pts[i]);
    const ear = (eye: any[]) => {
      const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
      const v1 = (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / 2;
      const v2 = dist(eye[0], eye[3]);
      return v1 / (v2 || 1);
    };
    const ratio = (ear(leftEye) + ear(rightEye)) / 2;
    if (lastEyeRatio != null) {
      const delta = Math.abs(ratio - lastEyeRatio);
      if (delta > 0.08) motionDetected = true; // blink or movement
    }
    lastEyeRatio = ratio;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return motionDetected;
}

export async function checkLivenessFlexible(video: HTMLVideoElement, opts?: { tries?: number; intervalMs?: number; strict?: boolean }) {
  const tries = opts?.tries ?? 8; const intervalMs = opts?.intervalMs ?? 180; const strict = opts?.strict ?? true;
  await loadFaceModels();
  let lastEyeRatio: number | null = null; let lastNose: { x: number; y: number } | null = null; let evidence = 0; let framesWithFace = 0;
  for (let i = 0; i < tries; i++) {
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks();
    if (!det) { await new Promise(r => setTimeout(r, intervalMs)); continue; }
    framesWithFace++;
    const pts = det.landmarks.positions;
    const leftEye = [36, 37, 38, 39, 40, 41].map(i => pts[i]);
    const rightEye = [42, 43, 44, 45, 46, 47].map(i => pts[i]);
    const ear = (eye: any[]) => { const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y); const v1 = (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / 2; const v2 = dist(eye[0], eye[3]); return v1 / (v2 || 1); };
    const ratio = (ear(leftEye) + ear(rightEye)) / 2;
    if (lastEyeRatio != null && Math.abs(ratio - lastEyeRatio) > 0.06) evidence++;
    lastEyeRatio = ratio;
    const nose = pts[30];
    if (lastNose && Math.hypot(nose.x - lastNose.x, nose.y - lastNose.y) > 4) evidence++;
    lastNose = { x: nose.x, y: nose.y };
    await new Promise(r => setTimeout(r, intervalMs));
  }
  if (strict) return evidence >= 1; // at least one blink/motion
  // relaxed: accept if some motion OR at least 3 frames had a face (helps enrollment under low light)
  return evidence >= 1 || framesWithFace >= 3;
}

export async function captureSnapshot(video: HTMLVideoElement): Promise<string> {
  const canvas = document.createElement('canvas');
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const maxW = 640;
  const scale = Math.min(1, maxW / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-ctx');
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function euclidean(a: number[], b: number[]) {
  if (a.length !== b.length) return Infinity;
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
