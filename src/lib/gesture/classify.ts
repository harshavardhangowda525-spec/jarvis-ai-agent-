/**
 * Hand-pose classification from MediaPipe's 21 hand landmarks (normalised image
 * coordinates, x → right, y → down, as the camera sees it). Pure geometry — no
 * learned thresholds hidden anywhere — so it runs in microseconds per frame and
 * is unit-testable. Each finger gets a continuous "extension" score; poses are
 * scored from those, and the best pose wins only if it clears its margin.
 *
 * Landmarks: 0 wrist · thumb 1–4 · index 5–8 · middle 9–12 · ring 13–16 · pinky 17–20.
 */

export interface Pt { x: number; y: number; z?: number }

export type Pose = "open_palm" | "fist" | "thumbs_up" | "thumbs_down" | "point" | "two" | "none";

export const POSE_LABEL: Record<Pose, string> = {
  open_palm: "OPEN PALM",
  fist: "CLOSED FIST",
  thumbs_up: "THUMBS UP",
  thumbs_down: "THUMBS DOWN",
  point: "POINT",
  two: "TWO FINGERS",
  none: "HAND",
};

export interface PoseReading {
  pose: Pose;
  /** 0..1 — how clearly the hand matches the pose. */
  confidence: number;
  /** Extension per finger, 0 (curled) … 1 (straight): thumb, index, middle, ring, pinky. */
  fingers: [number, number, number, number, number];
  /** Thumb-tip ↔ index-tip distance relative to hand size (≈0 touching, ≈1+ apart). */
  pinch: number;
  /** Palm centre (image coords). */
  center: Pt;
  /** Wrist → middle-knuckle length (image units) — the hand's scale. */
  scale: number;
  /** Index fingertip (image coords). */
  indexTip: Pt;
}

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * 0.5);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Map v from [lo, hi] to [0, 1]. */
const ramp = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

function cosAt(a: Pt, b: Pt, c: Pt): number {
  // angle at b between b→a and b→c; straight finger ≈ -1 (180°)
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return n ? (ux * vx + uy * vy) / n : 0;
}

/** Straightness 0..1 of a finger chain (mcp, pip, dip, tip). */
function fingerExtension(lm: Pt[], mcp: number, pip: number, dip: number, tip: number): number {
  const wrist = lm[0];
  // straight: joints nearly collinear; extended: tip farther from the wrist than the pip
  const pipStraight = ramp(-cosAt(lm[mcp], lm[pip], lm[dip]), 0.35, 0.9);
  const dipStraight = ramp(-cosAt(lm[pip], lm[dip], lm[tip]), 0.35, 0.9);
  const reach = ramp(d(wrist, lm[tip]) / Math.max(d(wrist, lm[pip]), 1e-6), 1.0, 1.35);
  return clamp01(reach * 0.6 + pipStraight * 0.3 + dipStraight * 0.1);
}

function thumbExtension(lm: Pt[], scale: number, center: Pt): number {
  const straight = ramp(-cosAt(lm[2], lm[3], lm[4]), 0.5, 0.92);
  // an extended thumb reaches well away from the palm; a tucked one lies across it
  const away = ramp(d(lm[4], center) / scale, 0.5, 0.85);
  return clamp01(straight * 0.25 + away * 0.75);
}

export function readPose(lm: Pt[]): PoseReading | null {
  if (!lm || lm.length < 21) return null;
  const scale = d(lm[0], lm[9]);
  if (!(scale > 1e-4)) return null;
  const center = {
    x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
    y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5,
  };
  const fingers: PoseReading["fingers"] = [
    thumbExtension(lm, scale, center),
    fingerExtension(lm, 5, 6, 7, 8),
    fingerExtension(lm, 9, 10, 11, 12),
    fingerExtension(lm, 13, 14, 15, 16),
    fingerExtension(lm, 17, 18, 19, 20),
  ];
  const [th, ix, md, rg, pk] = fingers;
  const up = (v: number) => v;
  const dn = (v: number) => 1 - v;

  // thumb direction (image y grows downward), relative to the hand's own up
  const tvx = lm[4].x - lm[2].x, tvy = lm[4].y - lm[2].y;
  const tlen = Math.hypot(tvx, tvy) || 1;
  const thumbUp = ramp(-tvy / tlen, 0.35, 0.8);
  const thumbDown = ramp(tvy / tlen, 0.35, 0.8);
  // thumb tip clearly above / below the rest of the curled hand
  const knuckleYs = [lm[5].y, lm[9].y, lm[13].y, lm[17].y];
  const aboveAll = ramp((Math.min(...knuckleYs) - lm[4].y) / scale, 0.05, 0.4);
  const belowAll = ramp((lm[4].y - Math.max(...knuckleYs)) / scale, 0.05, 0.4);

  const curled4 = Math.min(dn(ix), dn(md), dn(rg), dn(pk));
  const scores: Record<Exclude<Pose, "none">, number> = {
    open_palm: Math.min(up(ix), up(md), up(rg), up(pk)) * (0.75 + 0.25 * th),
    fist: curled4 * dn(Math.max(thumbUp * th, thumbDown * th)) * (1 - 0.3 * th),
    thumbs_up: curled4 * th * Math.max(thumbUp, 0) * (0.6 + 0.4 * aboveAll),
    thumbs_down: curled4 * th * Math.max(thumbDown, 0) * (0.6 + 0.4 * belowAll),
    point: up(ix) * Math.min(dn(md), dn(rg), dn(pk)),
    two: Math.min(up(ix), up(md)) * Math.min(dn(rg), dn(pk)),
  };
  let best: Pose = "none", conf = 0, second = 0;
  for (const [k, v] of Object.entries(scores) as [Exclude<Pose, "none">, number][]) {
    if (v > conf) { second = conf; conf = v; best = k; } else if (v > second) second = v;
  }
  // a pose must be clear on its own and clearly ahead of the runner-up
  const margin = conf - second;
  const confidence = clamp01(conf * (0.7 + 0.3 * ramp(margin, 0.05, 0.4)));
  return {
    pose: confidence >= 0.35 ? best : "none",
    confidence,
    fingers,
    pinch: d(lm[4], lm[8]) / scale,
    center,
    scale,
    indexTip: { x: lm[8].x, y: lm[8].y },
  };
}
