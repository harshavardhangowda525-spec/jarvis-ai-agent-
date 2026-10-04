"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * On-device face PRESENCE for the gate's scanner (MediaPipe Face Landmarker,
 * WebAssembly). It only tells the screen where a face is so the hologram can
 * follow it — it is NOT identity verification and never decides anything.
 * Frames go from the <video> straight into the model in this tab; nothing is
 * drawn from the camera, stored, or uploaded. The runtime and model are served
 * by this app (/vision, /models).
 */

export interface FacePoint { x: number; y: number }
export interface FaceFrame { points: FacePoint[]; box: { x: number; y: number; w: number; h: number } }

export class FaceTracker {
  private constructor(private fl: FaceLandmarker, public contours: { start: number; end: number }[]) {}

  static async create(): Promise<FaceTracker> {
    const vision = await import("@mediapipe/tasks-vision");
    let fileset;
    try {
      const probe = await fetch("/vision/vision_wasm_internal.js", { method: "HEAD" });
      fileset = await vision.FilesetResolver.forVisionTasks(probe.ok ? "/vision" : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    } catch {
      fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    }
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const fl = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        return new FaceTracker(fl, vision.FaceLandmarker.FACE_LANDMARKS_CONTOURS);
      } catch (e) {
        if (delegate === "CPU") throw e;
      }
    }
    throw new Error("Face tracking couldn't start.");
  }

  /** The face in this frame (mirrored like a selfie view), or null. */
  detect(video: HTMLVideoElement, t: number): FaceFrame | null {
    const r = this.fl.detectForVideo(video, t);
    const lm = r.faceLandmarks?.[0];
    if (!lm?.length) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    const points = lm.map((p) => {
      const x = 1 - p.x, y = p.y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      return { x, y };
    });
    return { points, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }

  close() { try { this.fl.close(); } catch { /* closed */ } }
}
