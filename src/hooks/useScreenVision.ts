"use client";

import { useCallback, useState } from "react";

/**
 * Screen reading for JARVIS.
 *
 * Uses the browser Screen Capture API (getDisplayMedia): the user is prompted
 * to pick a screen, window, or tab; we grab a single frame, downscale it to a
 * JPEG, and send it to the /api/vision/screen endpoint (a vision-capable model)
 * to read and describe. The capture stream is stopped immediately after the
 * frame is taken — nothing keeps recording.
 *
 * This can only run in response to a user gesture (a click), and every capture
 * shows the browser's own screen-share picker — there is no silent/background
 * screen access on the web, by design.
 */
const MAX_DIM = 1600; // downscale longest edge so payloads stay small & fast

export interface ScreenVisionResult {
  answer: string;
  provider: string;
}

export function useScreenVision() {
  const [reading, setReading] = useState(false);
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function";

  /** Capture one frame and ask the model about it. Returns null if cancelled. */
  const readScreen = useCallback(
    async (prompt?: string): Promise<ScreenVisionResult | null> => {
      if (!supported) throw new Error("Screen capture isn't supported in this browser.");
      let stream: MediaStream | null = null;
      try {
        setReading(true);
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 1 },
          audio: false,
        });

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        // Give the first frame a moment to paint.
        await new Promise((r) => setTimeout(r, 250));

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not read the captured frame.");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Stop the share as soon as we have the pixels.
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;

        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);

        const res = await fetch("/api/vision/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, mimeType: "image/jpeg", prompt }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "JARVIS couldn't read the screen.");
        return { answer: j.data.answer as string, provider: j.data.provider as string };
      } catch (err: any) {
        // The user cancelling the picker throws NotAllowedError/AbortError.
        if (err?.name === "NotAllowedError" || err?.name === "AbortError") return null;
        throw err;
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
        setReading(false);
      }
    },
    [supported],
  );

  return { readScreen, reading, supported };
}
