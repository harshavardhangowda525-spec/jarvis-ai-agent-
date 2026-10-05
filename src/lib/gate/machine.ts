/**
 * The gate's state machine — pure, so it's unit-tested.
 *
 * INITIALIZING → CAMERA READY → FACE DETECTED → SCANNING → VERIFYING
 *   → IDENTITY VERIFIED → JARVIS UNLOCKED
 * VERIFYING → IDENTITY NOT RECOGNIZED → (retry) CAMERA READY
 * too many failures → AUTHENTICATION FAILED (locked out, counting down)
 *
 * The camera only drives the presentation (it notices a face so the scan can
 * start). The ONLY ways into "verified" are a VERIFIED event — sent after the
 * server accepted a device-biometric signature — or FALLBACK_OK after the server
 * accepted the PIN/password. Seeing a face never unlocks anything.
 */

export type GatePhase =
  | "initializing"   // opening sequence, checking what this device can do
  | "camera-permission" // CAMERA ACCESS REQUIRED
  | "camera-ready"   // looking for a face
  | "face-detected"
  | "scanning"       // ANALYZING BIOMETRIC DATA (presentation while the check starts)
  | "verifying"      // the device's biometric check + server verification
  | "verified"       // IDENTITY VERIFIED
  | "unlocked"       // WELCOME · JARVIS ONLINE → into JARVIS
  | "not-recognized" // IDENTITY NOT RECOGNIZED
  | "locked-out"     // AUTHENTICATION FAILED — too many attempts
  | "camera-error"   // no camera / blocked / busy — face unlock still works through the device
  | "unavailable";   // no face unlock here (no biometric hardware, or nothing enrolled) → PIN / password

export type Unavailable = "no-biometrics" | "not-enrolled" | "signed-out";

export interface GateState {
  phase: GatePhase;
  /** Device-biometric face unlock possible here. */
  canFace: boolean;
  unavailable: Unavailable | null;
  /** Camera state, independent of the phase (the scan can run without it). */
  camera: "off" | "prompt" | "on" | "denied" | "error";
  /** Epoch ms the lockout ends. */
  lockedUntil: number;
  attemptsLeft: number | null;
  failures: number;
  /** How it was unlocked (for the final message). */
  via: "face" | "pin" | "password" | null;
}

export type GateEvent =
  | { type: "READY"; canFace: boolean; unavailable?: Unavailable | null; lockedMs?: number }
  | { type: "CAMERA"; status: "prompt" | "on" | "denied" | "error" }
  | { type: "FACE"; present: boolean }
  | { type: "SCAN" }            // face held long enough → scanning
  | { type: "VERIFY" }          // start the device check (after the scan, or a tap)
  | { type: "SCAN_ABORT"; lockedMs?: number } // the scan stopped part-way (prompt not followed, face lost) — not a failure
  | { type: "VERIFIED" }        // the server accepted the biometric signature
  | { type: "REJECTED"; lockedMs?: number; attemptsLeft?: number }
  | { type: "CANCELLED" }       // the device dialog was dismissed — counts as a failed scan
  | { type: "ABORTED" }         // the browser refused to even show the dialog (needs a tap / tab not focused) — not a failure
  | { type: "RETRY" }
  | { type: "LOCK_OVER" }
  | { type: "FALLBACK_OK"; via: "pin" | "password" }
  | { type: "FALLBACK_REJECTED"; lockedMs?: number; attemptsLeft?: number }
  | { type: "DONE" };           // success animation finished

export const initialGate = (): GateState => ({
  phase: "initializing", canFace: false, unavailable: null, camera: "off", lockedUntil: 0, attemptsLeft: null, failures: 0, via: null,
});

/** Where to rest when nothing is happening. */
function idle(s: GateState): GatePhase {
  if (!s.canFace) return "unavailable";
  if (s.camera === "prompt") return "camera-permission";
  if (s.camera === "denied" || s.camera === "error") return "camera-error";
  return "camera-ready";
}

export function gateReducer(s: GateState, e: GateEvent, now = Date.now()): GateState {
  // once verified, nothing can take it back (and nothing else matters)
  if (s.phase === "verified" || s.phase === "unlocked") {
    return e.type === "DONE" && s.phase === "verified" ? { ...s, phase: "unlocked" } : s;
  }
  const locked = s.lockedUntil > now;
  switch (e.type) {
    case "READY": {
      const n: GateState = { ...s, canFace: e.canFace, unavailable: e.canFace ? null : (e.unavailable ?? "no-biometrics"), lockedUntil: e.lockedMs ? now + e.lockedMs : 0 };
      return { ...n, phase: n.lockedUntil > now ? "locked-out" : idle(n) };
    }
    case "CAMERA": {
      const n = { ...s, camera: e.status };
      // the camera only changes the resting screen
      return ["camera-permission", "camera-ready", "camera-error", "face-detected"].includes(s.phase) ? { ...n, phase: locked ? "locked-out" : idle(n) } : n;
    }
    case "FACE":
      if (!s.canFace || locked) return s;
      if (e.present && s.phase === "camera-ready") return { ...s, phase: "face-detected" };
      if (!e.present && s.phase === "face-detected") return { ...s, phase: "camera-ready" };
      return s;
    case "SCAN":
      return s.phase === "face-detected" && !locked ? { ...s, phase: "scanning" } : s;
    case "VERIFY":
      if (!s.canFace || locked) return s;
      return ["scanning", "camera-ready", "camera-error", "face-detected", "camera-permission", "not-recognized"].includes(s.phase) ? { ...s, phase: "verifying" } : s;
    case "VERIFIED":
      return s.phase === "verifying" ? { ...s, phase: "verified", via: "face", failures: 0 } : s;
    case "REJECTED":
    case "CANCELLED": {
      if (s.phase !== "verifying") return s;
      const lockedUntil = e.type === "REJECTED" && e.lockedMs ? now + e.lockedMs : s.lockedUntil;
      const n = { ...s, failures: s.failures + 1, lockedUntil, attemptsLeft: e.type === "REJECTED" ? (e.attemptsLeft ?? s.attemptsLeft) : s.attemptsLeft };
      return { ...n, phase: lockedUntil > now ? "locked-out" : "not-recognized" };
    }
    case "SCAN_ABORT": {
      if (s.phase !== "scanning") return s;
      const lockedUntil = e.lockedMs ? now + e.lockedMs : s.lockedUntil;
      return { ...s, lockedUntil, phase: lockedUntil > now ? "locked-out" : idle(s) };
    }
    case "ABORTED":
      return s.phase === "verifying" ? { ...s, phase: idle(s) } : s;
    case "RETRY":
      return s.phase === "not-recognized" && !locked ? { ...s, phase: idle(s) } : s;
    case "LOCK_OVER":
      return s.phase === "locked-out" && !locked ? { ...s, phase: idle(s), attemptsLeft: null } : s;
    case "FALLBACK_OK":
      return { ...s, phase: "verified", via: e.via, failures: 0 };
    case "FALLBACK_REJECTED": {
      const lockedUntil = e.lockedMs ? now + e.lockedMs : s.lockedUntil;
      const n = { ...s, lockedUntil, attemptsLeft: e.attemptsLeft ?? s.attemptsLeft, failures: s.failures + 1 };
      return lockedUntil > now ? { ...n, phase: "locked-out" } : n;
    }
    default:
      return s;
  }
}

/** The headline for each state. */
export const PHASE_TITLE: Record<GatePhase, string> = {
  "initializing": "JARVIS SYSTEM INITIALIZING",
  "camera-permission": "CAMERA ACCESS REQUIRED",
  "camera-ready": "CAMERA READY",
  "face-detected": "FACE DETECTED",
  "scanning": "ANALYZING BIOMETRIC DATA",
  "verifying": "VERIFYING IDENTITY",
  "verified": "IDENTITY VERIFIED",
  "unlocked": "JARVIS ONLINE",
  "not-recognized": "IDENTITY NOT RECOGNIZED",
  "locked-out": "AUTHENTICATION FAILED",
  "camera-error": "CAMERA ERROR",
  "unavailable": "BIOMETRIC AUTHENTICATION REQUIRED",
};
