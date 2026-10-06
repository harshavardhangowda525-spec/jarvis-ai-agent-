/**
 * JARVIS Face ID — the rules, pure (unit-tested, shared by browser and server).
 *
 * A face is reduced, in the browser, to a 128-number descriptor (face-api's
 * recognition network). Only descriptors ever leave the camera code — never
 * images. Enrolment keeps several descriptors from different angles; an unlock
 * is a short liveness challenge (look straight → blink or turn)
 * whose descriptors must all match the enrolment.
 *
 * Thresholds were measured on real photos of 7 people rendered the way a webcam
 * sees them (small, soft, dim, noisy). A clear, close face keeps different
 * people 0.57+ apart — but a small, soft face (what a 9%-of-the-frame face
 * gave) pulls everyone's descriptor towards an "average face": strangers came
 * within 0.49 of each other, so they could pass. Now:
 * - only a close, clear face is used at all (MIN_FACE_* — "move closer" otherwise);
 * - unlock needs every look within 0.45 of the enrolment, their average within
 *   0.40, and every look within 0.42 of the enrolment's average face;
 * - an unlock takes three looks (straight, an action, straight again).
 *
 * This is camera-based recognition: it's convenient, but a determined attacker
 * with a good video of you could try to fool any webcam. The liveness challenge,
 * the strict thresholds, server-side matching and the lockout make that hard;
 * device biometrics (Windows Hello with an IR camera) remain the stronger option.
 */

export const DESCRIPTOR_LENGTH = 128;
export const MATCH_EACH = 0.45;
export const MATCH_MEAN = 0.4;
/** Every look must also be this close to the enrolment's average face. */
export const MATCH_CENTROID = 0.42;
/** A face is only described when it's at least this big (px, and share of the frame width) and this clearly detected. */
export const MIN_FACE_PX = 140;
export const MIN_FACE_FRAC = 0.18;
export const MIN_FACE_SCORE = 0.6;
/** Templates made before the stricter capture standard don't unlock (re-enrol). */
export const FACE_TEMPLATE_VERSION = 2;
/** Head turn needed for a "left"/"right" step (yaw: −1 = fully to your left … +1 = your right). */
export const TURN_YAW = 0.24;
/** "Look straight" means |yaw| below this. */
export const CENTER_YAW = 0.16;

export type FaceStep = "center" | "left" | "right" | "blink";
export interface FaceProbe {
  step: FaceStep;
  descriptor: number[];
  /** Head yaw when captured (−1 your left … +1 your right). */
  yaw: number;
  /** A blink was seen just before this capture (blink steps). */
  blink?: boolean;
  /** ms since the challenge started. */
  t: number;
}

export const STEP_PROMPT: Record<FaceStep, string> = {
  center: "Look straight at the camera",
  left: "Turn your head slightly to your left",
  right: "Turn your head slightly to your right",
  blink: "Blink once",
};

/** The enrolment plan: several straight-on samples plus both sides and a blink. */
export const ENROLL_STEPS: FaceStep[] = ["center", "center", "center", "left", "left", "right", "right", "blink"];

/** An unlock challenge: look straight, one random action (blink / turn left / turn right), straight again. */
export function unlockSteps(rand: () => number = Math.random): FaceStep[] {
  const actions: FaceStep[] = ["blink", "left", "right"];
  return ["center", actions[Math.floor(rand() * actions.length) % actions.length], "center"];
}

export function isDescriptor(x: unknown): x is number[] {
  return Array.isArray(x) && x.length === DESCRIPTOR_LENGTH && x.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 2);
}

export function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

export function centroid(ds: number[][]): number[] {
  const c = new Array(DESCRIPTOR_LENGTH).fill(0);
  for (const d of ds) for (let i = 0; i < DESCRIPTOR_LENGTH; i++) c[i] += d[i] / ds.length;
  return c;
}

/**
 * How close each look is to the enrolled face: to its nearest enrolled sample
 * AND to the enrolment's average face (one lucky near-sample isn't enough).
 */
export function matchProbes(enrolled: number[][], probes: number[][]): { ok: boolean; mean: number; max: number; each: number[]; center: number } {
  if (!enrolled.length || !probes.length) return { ok: false, mean: Infinity, max: Infinity, each: [], center: Infinity };
  const each = probes.map((p) => Math.min(...enrolled.map((e) => distance(e, p))));
  const mean = each.reduce((s, d) => s + d, 0) / each.length;
  const max = Math.max(...each);
  const avg = centroid(enrolled);
  const center = Math.max(...probes.map((p) => distance(p, avg)));
  return { ok: max < MATCH_EACH && mean < MATCH_MEAN && center < MATCH_CENTROID, mean, max, each, center };
}

/** Does this sequence of probes actually perform the steps asked (and look like a live capture)? */
export function livenessProblem(steps: FaceStep[], probes: FaceProbe[], opts: { minMs?: number; maxMs?: number } = {}): string | null {
  const minMs = opts.minMs ?? 600, maxMs = opts.maxMs ?? 90_000;
  if (!Array.isArray(probes) || probes.length !== steps.length) return "incomplete";
  let lastT = -1;
  for (let i = 0; i < steps.length; i++) {
    const p = probes[i], s = steps[i];
    if (!p || p.step !== s || !isDescriptor(p.descriptor) || typeof p.yaw !== "number" || !Number.isFinite(p.yaw) || typeof p.t !== "number") return "malformed";
    if (p.t < lastT) return "out-of-order";
    lastT = p.t;
    if (s === "center" && Math.abs(p.yaw) > CENTER_YAW + 0.06) return "not-straight";
    if (s === "left" && p.yaw > -TURN_YAW + 0.02) return "no-left-turn";
    if (s === "right" && p.yaw < TURN_YAW - 0.02) return "no-right-turn";
    if (s === "blink" && p.blink !== true) return "no-blink";
  }
  const span = probes[probes.length - 1].t - probes[0].t;
  if (span < minMs) return "too-fast";
  if (probes[probes.length - 1].t > maxMs) return "too-slow";
  // a live camera never yields bit-identical descriptors twice
  for (let i = 0; i < probes.length; i++) for (let j = i + 1; j < probes.length; j++) if (distance(probes[i].descriptor, probes[j].descriptor) < 1e-4) return "replayed";
  return null;
}

/** Enrolment samples must sit this close together (median) — a consistent, clear capture. */
export const ENROLL_SPREAD = 0.42;

/** Is this a usable enrolment — enough angles, and clearly one person throughout? */
export function enrollmentProblem(probes: FaceProbe[]): string | null {
  const d = probes.map((p) => p.descriptor);
  if (d.length < 6) return "Not enough samples — try again.";
  const n = (s: FaceStep) => probes.filter((p) => p.step === s).length;
  if (n("center") < 3 || n("left") < 1 || n("right") < 1) return "Missing angles — try again.";
  for (let i = 0; i < d.length; i++) {
    const others = d.filter((_, j) => j !== i).map((o) => distance(d[i], o)).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)];
    if (median > ENROLL_SPREAD) return "The samples don't look like one person — make sure only you are in view, in good light, and try again.";
  }
  return null;
}
