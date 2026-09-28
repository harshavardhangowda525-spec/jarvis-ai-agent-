"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { Pt } from "./classify";

/**
 * On-device hand tracking (MediaPipe Hand Landmarker, WebAssembly + WebGL).
 * The runtime and model are served from this app (/vision, /models), so camera
 * frames are processed in the browser and never uploaded. Loaded lazily — the
 * ~10 MB runtime is only fetched when gesture mode is switched on.
 */

const VERSION = "1.0.1";
const LOCAL_WASM = "/vision";
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const LOCAL_MODEL = "/models/hand_landmarker.task";

export class TrackerError extends Error {}

export interface TrackedHand { landmarks: Pt[]; handedness: string; score: number }

export class HandTracker {
  private constructor(private lm: HandLandmarker, public delegate: "GPU" | "CPU") {}

  static async create(): Promise<HandTracker> {
    const vision = await import("@mediapipe/tasks-vision");
    // prefer our own copy of the runtime; fall back to the CDN build of the same version
    let fileset;
    try {
      const probe = await fetch(`${LOCAL_WASM}/vision_wasm_internal.js`, { method: "HEAD" });
      fileset = await vision.FilesetResolver.forVisionTasks(probe.ok ? LOCAL_WASM : CDN_WASM);
    } catch {
      fileset = await vision.FilesetResolver.forVisionTasks(CDN_WASM);
    }
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const lm = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: LOCAL_MODEL, delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        return new HandTracker(lm, delegate);
      } catch (e) {
        if (delegate === "CPU") throw new TrackerError(`Hand tracking couldn't start: ${(e as Error)?.message ?? e}`);
      }
    }
    throw new TrackerError("Hand tracking couldn't start.");
  }

  /** Landmarks of the most confident hand in this frame, or null. */
  detect(video: HTMLVideoElement, tMs: number): TrackedHand | null {
    const r = this.lm.detectForVideo(video, tMs);
    if (!r.landmarks?.length) return null;
    let best = 0;
    for (let i = 1; i < r.landmarks.length; i++) if ((r.handedness?.[i]?.[0]?.score ?? 0) > (r.handedness?.[best]?.[0]?.score ?? 0)) best = i;
    const h = r.handedness?.[best]?.[0];
    return { landmarks: r.landmarks[best].map((p) => ({ x: p.x, y: p.y, z: p.z })), handedness: h?.categoryName ?? "", score: h?.score ?? 0 };
  }

  close() { try { this.lm.close(); } catch { /* already closed */ } }
}

/** Human message for a getUserMedia failure. */
export function cameraErrorMessage(e: unknown): { message: string; denied: boolean } {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return { denied: true, message: "Camera permission was blocked. Allow the camera for this site in your browser's settings, then turn gesture mode on again." };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { denied: false, message: "No camera was found on this device." };
  if (name === "NotReadableError" || name === "AbortError") return { denied: false, message: "The camera is busy — another app may be using it." };
  return { denied: false, message: `The camera couldn't start${(e as Error)?.message ? `: ${(e as Error).message}` : "."}` };
}
