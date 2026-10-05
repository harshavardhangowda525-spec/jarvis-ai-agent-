"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceFrame, FaceTracker } from "@/lib/gate/face-tracker";
import { faceIdChallenge, faceIdEnroll, loadFaceId, runFaceSteps, warmUpFaceId } from "@/lib/gate/face-id";
import type { GatePhase } from "@/lib/gate/machine";
import { GateScene, gateLayout } from "./gate-scene";

/**
 * Enrol your face for JARVIS Face ID, right inside JARVIS — no system settings.
 * A guided holographic scan: look straight, turn a little to each side, blink.
 * At each step the face becomes a 128-number descriptor on this device; only
 * those numbers go to your JARVIS server, where they're stored encrypted.
 * No photo or video is kept anywhere.
 */

type Stage = "starting" | "camera-error" | "waiting" | "scanning" | "saving" | "done" | "failed" | "reverify";

export function FaceEnrollment({ onClose, onReverify }: { onClose: (enrolled: boolean) => void; onReverify: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scene = useRef<GateScene | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<FaceTracker | null>(null);
  const frameRef = useRef<FaceFrame | null>(null);
  const loop = useRef(0);
  const present = useRef(false);
  const alive = useRef(true);
  const [stage, setStage] = useState<Stage>("starting");
  const [prompt, setPrompt] = useState<string>("Preparing Face ID…");
  const [stepAt, setStepAt] = useState<{ i: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false); // camera, tracker and models are up
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  const phase: GatePhase = stage === "starting" ? "initializing" : stage === "camera-error" || stage === "failed" ? "not-recognized"
    : stage === "scanning" ? "scanning" : stage === "saving" ? "verifying" : stage === "done" ? "verified" : stage === "reverify" ? "camera-error" : "camera-ready";

  useEffect(() => {
    const c = canvasRef.current!;
    const s = new GateScene(c);
    scene.current = s; s.start();
    const measure = () => { s.resize(); setSize({ w: c.clientWidth, h: c.clientHeight }); };
    measure();
    addEventListener("resize", measure);
    return () => { s.stop(); removeEventListener("resize", measure); };
  }, []);
  useEffect(() => { scene.current?.setPhase(phase); }, [phase]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(loop.current);
    scene.current?.setVideo(null);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => () => { alive.current = false; stopCamera(); tracker.current?.close(); }, [stopCamera]);

  // camera + face tracker + recognition models
  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
        if (!alive.current) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = videoRef.current!;
        v.srcObject = s;
        try { await v.play(); } catch { /* muted autoplay is allowed */ }
      } catch (e) {
        const n = (e as { name?: string })?.name;
        setError(n === "NotAllowedError" ? "Camera blocked — allow the camera for this site, then try again." : n === "NotFoundError" ? "No camera found." : "The camera is busy — close other apps using it and try again.");
        setStage("camera-error");
        return;
      }
      try {
        const { FaceTracker } = await import("@/lib/gate/face-tracker");
        const [t] = await Promise.all([FaceTracker.create(), loadFaceId()]);
        if (!alive.current) { t.close(); return; }
        tracker.current = t;
        setPrompt("Calibrating…");
        await warmUpFaceId(videoRef.current!);
      } catch {
        setError("Face recognition couldn't start in this browser. Try Chrome or Edge.");
        setStage("camera-error");
        return;
      }
      setStage("waiting");
      setPrompt("Look straight at the camera");
      setReady(true);
      scene.current?.setVideo(videoRef.current); // your live view in the scanner (on this screen only)
      const v = videoRef.current!;
      let lastRun = 0, lastSeen = 0;
      const step = (t: number) => {
        loop.current = requestAnimationFrame(step);
        if (t - lastRun < 66 || !tracker.current || v.readyState < 2) return;
        lastRun = t;
        let f: FaceFrame | null = null;
        try { f = tracker.current.detect(v, t); } catch { return; }
        if (process.env.NEXT_PUBLIC_GATE_TEST === "1" && f) Object.assign(f, (window as unknown as { __gatePose?: Partial<FaceFrame> }).__gatePose ?? {});
        frameRef.current = f;
        scene.current?.setFace(f, (v.videoWidth || 4) / (v.videoHeight || 3), tracker.current.contours);
        if (f) { lastSeen = t; present.current = true; } else if (t - lastSeen > 600) present.current = false;
      };
      loop.current = requestAnimationFrame(step);
    })();
  }, []);

  // the guided scan, once a face is in view (one run per attempt — its own stage
  // changes must not restart or cancel it)
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    const id = setInterval(async () => {
      if (!present.current || stopped) return;
      clearInterval(id);
      const ch = await faceIdChallenge("enroll");
      if (stopped || !alive.current) return;
      if (!ch.ok) {
        if (ch.data.details?.reverify) { setStage("reverify"); setError("For your security, unlock JARVIS again before enrolling a face."); return; }
        setError(ch.data.error ?? "Couldn't start the enrolment."); setStage("failed"); return;
      }
      setStage("scanning");
      try {
        const samples = await runFaceSteps(ch.data.steps, {
          frame: () => frameRef.current,
          video: () => videoRef.current,
          onStep: (step, i, n, text) => { setPrompt(`${step === "left" ? "← " : step === "right" ? "→ " : ""}${text}`); setStepAt({ i, n }); },
          onProgress: (p) => scene.current?.setProgress(p * 0.92),
          cancelled: () => stopped || !alive.current,
        }, 15_000);
        if (stopped || !alive.current) return;
        setStage("saving"); setPrompt("Encrypting and saving your Face ID…");
        const r = await faceIdEnroll(ch.data.challengeId, samples);
        if (!alive.current) return;
        if (r.ok) {
          scene.current?.setProgress(1);
          setStage("done"); setPrompt("You can now unlock JARVIS just by looking at it.");
          stopCamera();
          setTimeout(() => alive.current && onCloseRef.current(true), 3200);
          return;
        }
        if (r.data.details?.reverify) { setStage("reverify"); setError("For your security, unlock JARVIS again before enrolling a face."); return; }
        setError(r.data.error ?? "Enrolment failed — try again."); setStage("failed");
      } catch (e) {
        if (stopped || !alive.current) return;
        const why = (e as Error).message;
        setError(why === "timeout" ? "Didn't catch that step — follow each prompt slowly and try again." : why === "no-face" ? "Keep only your face in view, in good light, and try again." : "Something went wrong — try again.");
        setStage("failed");
      }
    }, 300);
    return () => { stopped = true; clearInterval(id); };
  }, [ready, attempt, stopCamera]);

  const retry = () => { setError(null); setStepAt(null); scene.current?.setProgress(0); setPrompt("Look straight at the camera"); setStage("waiting"); setAttempt((a) => a + 1); };

  const layout = gateLayout(size.w, size.h, 0);
  const title = stage === "starting" ? "PREPARING FACE ID" : stage === "waiting" ? "FACE ID ENROLLMENT" : stage === "scanning" ? "CAPTURING BIOMETRIC PROFILE"
    : stage === "saving" ? "SECURING PROFILE" : stage === "done" ? "FACE ID ENROLLED" : stage === "reverify" ? "VERIFICATION REQUIRED" : stage === "camera-error" ? "CAMERA ERROR" : "ENROLLMENT INCOMPLETE";
  const good = stage === "done", bad = stage === "failed" || stage === "camera-error" || stage === "reverify";

  return (
    <div className="fixed inset-0 z-[210] overflow-hidden bg-[#010309] text-white" data-face-enroll={stage}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <video ref={videoRef} muted playsInline aria-hidden className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0" />
      <div className="gate-in absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 text-[11px] tracking-[0.32em] text-cyan-100/70 sm:top-8">
        <span className={`h-2 w-2 rounded-full ${good ? "bg-emerald-400" : bad ? "bg-rose-400" : "animate-pulse bg-cyan-300"}`} />
        JARVIS FACE ID
      </div>
      <div className="absolute inset-x-0 flex flex-col items-center px-4 text-center" style={{ top: layout.cy + layout.R * 1.42 }} aria-live="polite">
        <h1 key={title} className={`gate-in font-heading text-[clamp(20px,4.2vw,32px)] font-semibold tracking-[0.26em] ${good ? "text-emerald-200 [text-shadow:0_0_18px_rgba(90,255,200,0.6)]" : bad ? "text-rose-300" : "text-cyan-100 [text-shadow:0_0_18px_rgba(70,205,255,0.55)]"}`}>{title}</h1>
        <p key={error ?? prompt} className={`gate-in mt-2 max-w-md tracking-wide ${error ? "text-[13px] text-rose-200/80" : stage === "scanning" || stage === "waiting" ? "text-[16px] font-medium text-cyan-50 [text-shadow:0_0_14px_rgba(70,205,255,0.6)]" : "text-[13px] text-cyan-50/60"}`} data-enroll-prompt>
          {error ?? prompt}
        </p>
        {stepAt && stage === "scanning" && (
          <div className="mt-4 flex gap-2" aria-hidden>
            {Array.from({ length: stepAt.n }, (_, i) => <span key={i} className={`h-1.5 w-6 rounded-full transition-all duration-300 ${i < stepAt.i ? "bg-cyan-300 shadow-[0_0_8px_rgba(70,205,255,0.9)]" : i === stepAt.i ? "animate-pulse bg-cyan-200/70" : "bg-cyan-200/15"}`} />)}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {(stage === "failed" || stage === "camera-error") && <EnrollButton onClick={stage === "camera-error" ? () => location.reload() : retry}>TRY AGAIN</EnrollButton>}
          {stage === "reverify" && <EnrollButton onClick={onReverify}>VERIFY NOW</EnrollButton>}
          {stage !== "done" && stage !== "saving" && <EnrollButton ghost onClick={() => { stopCamera(); onClose(false); }}>CANCEL</EnrollButton>}
        </div>
      </div>
      <p className="absolute inset-x-0 bottom-3 px-4 text-center text-[10.5px] tracking-wide text-cyan-50/35 sm:bottom-5">
        Your camera view is shown only on this screen. Your face is turned into numbers on this device and stored encrypted on your JARVIS server — no photos or video are ever saved or uploaded.
      </p>
    </div>
  );
}

function EnrollButton({ children, onClick, ghost }: { children: React.ReactNode; onClick: () => void; ghost?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-5 py-2.5 text-[11px] font-semibold tracking-[0.26em] backdrop-blur-md transition duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-0.5 ${ghost ? "border-cyan-200/15 bg-white/[0.03] text-cyan-100/70 hover:border-cyan-200/40" : "border-cyan-300/40 bg-cyan-400/10 text-cyan-50 shadow-[0_0_24px_-8px_rgba(70,205,255,0.8)] hover:border-cyan-200/70"}`}>
      {children}
    </button>
  );
}
