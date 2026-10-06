"use client";

import { STEP_PROMPT, CENTER_YAW, TURN_YAW, MIN_FACE_PX, MIN_FACE_FRAC, MIN_FACE_SCORE, type FaceProbe, type FaceStep } from "./face-match";
import type { FaceFrame } from "./face-tracker";

/**
 * JARVIS Face ID in the browser: turns the face in the camera into a
 * 128-number descriptor (face-api's recognition network, on-device). The image
 * itself never leaves this function — only the numbers go to the server, which
 * does the matching. Models are served by this app (/models/face-api).
 */

type FaceApi = typeof import("@vladmandic/face-api/dist/face-api.esm.js");
let loading: Promise<FaceApi> | null = null;

export function loadFaceId(): Promise<FaceApi> {
  loading ??= (async () => {
    const faceapi = await import("@vladmandic/face-api/dist/face-api.esm.js");
    // the typings only cover part of the bundled TensorFlow.js
    const tf = faceapi.tf as unknown as { setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void> };
    try { await tf.setBackend("webgl"); } catch { await tf.setBackend("cpu"); }
    await tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models/face-api"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models/face-api"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models/face-api"),
    ]);
    return faceapi;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

let busy = 0;
/** A capture is running: the presence tracker skips frames meanwhile so the two don't fight over the GPU/CPU. */
export const faceIdBusy = () => busy > 0;

export type Described = { descriptor: number[] } | { problem: "none" | "many" | "small" | "unclear" };

/**
 * The descriptor of the one face in view. Refuses faces too small or too
 * unclear to tell people apart: a small, soft face gives a "generic" descriptor
 * that sits close to everyone's, which is how a stranger could pass.
 */
export async function describeFace(video: HTMLVideoElement): Promise<Described> {
  const faceapi = await loadFaceId();
  busy++;
  try {
    return await describeWith(faceapi, video);
  } finally {
    busy--;
  }
}

async function describeWith(faceapi: FaceApi, video: HTMLVideoElement): Promise<Described> {
  const all = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 })).withFaceLandmarks().withFaceDescriptors();
  if (!all.length) return { problem: "none" };
  if (all.length > 1) return { problem: "many" };
  const d = all[0];
  const w = d.detection.box.width;
  if (w < MIN_FACE_PX || w < (video.videoWidth || 640) * MIN_FACE_FRAC) return { problem: "small" };
  if (d.detection.score < MIN_FACE_SCORE) return { problem: "unclear" };
  return { descriptor: Array.from(d.descriptor) };
}

const HINT: Record<Exclude<Described, { descriptor: number[] }>["problem"], string> = {
  none: "Keep your face in view",
  many: "Only one face in view, please",
  small: "Move closer to the camera",
  unclear: "More light on your face, please",
};

/** Run the networks once in the background so the first real capture is quick (shaders compile on first use). */
export async function warmUpFaceId(video: HTMLVideoElement): Promise<void> {
  try { await describeFace(video); } catch { /* best effort */ }
}

export interface ScanCallbacks {
  /** Latest tracked face (yaw/blink) from the presence tracker. */
  frame: () => FaceFrame | null;
  video: () => HTMLVideoElement | null;
  /** The instruction for the step in progress. */
  onStep: (step: FaceStep, index: number, total: number, prompt: string) => void;
  /** 0..1 */
  onProgress: (p: number) => void;
  cancelled: () => boolean;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Test builds only: a trace of the scan for automated tests (compiled out otherwise). */
const trace = (...a: unknown[]) => {
  if (process.env.NEXT_PUBLIC_GATE_TEST === "1") ((window as unknown as { __faceTrace?: string[] }).__faceTrace ??= []).push(a.map(String).join(" "));
};

/**
 * Walk through the steps (look straight / turn / blink), capturing a
 * descriptor at each one. Rejects with "timeout" if a step isn't done in time,
 * "cancelled", or "no-face".
 */
export async function runFaceSteps(steps: FaceStep[], cb: ScanCallbacks, stepTimeoutMs = 9000): Promise<FaceProbe[]> {
  const t0 = performance.now();
  const probes: FaceProbe[] = [];
  await loadFaceId();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    cb.onStep(step, i, steps.length, STEP_PROMPT[step]);
    trace("step", i, step);
    const start = performance.now();
    let blinkClosed = false, blinkDone = step !== "blink", heldSince = 0, poseYaw = 0;
    // wait until the pose is right (and, for a blink, the eyes closed and opened again)
    for (;;) {
      if (cb.cancelled()) throw new Error("cancelled");
      if (performance.now() - start > stepTimeoutMs) throw new Error("timeout");
      const f = cb.frame();
      trace("frame", f ? `yaw=${f.yaw.toFixed(2)} blink=${f.blink.toFixed(2)}` : "none");
      if (f) {
        if (step === "blink" && !blinkDone) {
          if (f.blink > 0.5) blinkClosed = true;
          else if (blinkClosed && f.blink < 0.25) blinkDone = true;
        }
        const pose = step === "left" ? f.yaw <= -TURN_YAW : step === "right" ? f.yaw >= TURN_YAW : Math.abs(f.yaw) <= CENTER_YAW;
        const ready = pose && blinkDone && (step !== "blink" || f.blink < 0.25);
        if (ready) { heldSince ||= performance.now(); if (performance.now() - heldSince > 120) { poseYaw = f.yaw; break; } }
        else heldSince = 0;
      }
      cb.onProgress((i + 0.4 * Math.min(1, (performance.now() - start) / 2500)) / steps.length);
      await wait(33);
    }
    // capture: the descriptor of the face right now — close and clear enough to tell people apart
    const v = cb.video();
    let descriptor: number[] | null = null, hinted = false, misses = 0;
    const capStart = performance.now();
    while (!descriptor) {
      if (cb.cancelled()) throw new Error("cancelled");
      if (!v) throw new Error("no-face");
      const tc = performance.now();
      const r = await describeFace(v);
      trace("capture", "problem" in r ? r.problem : "ok", Math.round(performance.now() - tc) + "ms");
      if ("descriptor" in r) { descriptor = r.descriptor; break; }
      // no face at all for a while → give up; too far / too dark → say what to do and keep waiting
      if (r.problem === "none" && ++misses >= 6) throw new Error("no-face");
      if (performance.now() - capStart > stepTimeoutMs) throw new Error(r.problem === "small" ? "too-far" : r.problem === "unclear" ? "too-dark" : "no-face");
      if (r.problem !== "none") { hinted = true; cb.onStep(step, i, steps.length, HINT[r.problem]); }
      await wait(120);
    }
    if (hinted) cb.onStep(step, i, steps.length, STEP_PROMPT[step]);
    // the head angle when the pose was confirmed and the capture began
    probes.push({ step, descriptor, yaw: poseYaw, blink: step === "blink" ? true : undefined, t: Math.round(performance.now() - t0) });
    cb.onProgress((i + 1) / steps.length);
  }
  return probes;
}

async function post<T>(url: string, body: object): Promise<{ status: number; ok: boolean; data: T & { error?: string; details?: Record<string, unknown> } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && j.ok !== false, data: { ...(j.data ?? {}), error: j.error, details: j.details } };
}

export const faceIdChallenge = (purpose: "unlock" | "enroll") => post<{ challengeId: string; steps: FaceStep[] }>("/api/gate/face-id/challenge", { purpose });
export const faceIdVerify = (challengeId: string, probes: FaceProbe[]) => post<{ signedIn: boolean }>("/api/gate/face-id/verify", { challengeId, probes });
export const faceIdEnroll = (challengeId: string, samples: FaceProbe[]) => post<{ enrolledAt: string }>("/api/gate/face-id/enroll", { challengeId, samples });
