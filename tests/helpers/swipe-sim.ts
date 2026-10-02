import type { Pt } from "@/lib/gesture/classify";

/**
 * Realistic swipes for testing the gesture engine: a real hand isn't a perfect
 * open palm in every frame — it tilts, turns edge-on, curls a finger, blurs (a
 * few frames read as nothing), jitters, and after a swipe it comes back.
 */
export function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** Landmarks for a hand at (cx, cy): `ext` = extension per finger (index..pinky, 0..1), rotated by `rot` rad, `edge` 0..1 = turned side-on. */
export function handAt(cx: number, cy: number, o: { s?: number; ext?: number[]; rot?: number; edge?: number; jitter?: number; r?: () => number; thumb?: number } = {}): Pt[] {
  const s = o.s ?? 0.14, ext = o.ext ?? [1, 1, 1, 1], rot = o.rot ?? 0, edge = o.edge ?? 0, J = o.jitter ?? 0, r = o.r ?? Math.random;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const squash = 1 - 0.55 * edge; // side-on: the hand looks narrow
  const P = (x: number, y: number): Pt => {
    const X = x * squash, Y = y;
    return { x: cx + (X * cos - Y * sin) * s + (r() - 0.5) * J * s, y: cy + (X * sin + Y * cos) * s + (r() - 0.5) * J * s, z: 0 };
  };
  const lm: Pt[] = new Array(21);
  lm[0] = P(0, 0);
  const th = o.thumb ?? 1;
  [[-0.3, -0.25], [-0.55, -0.45], [-0.55 - 0.2 * th, -0.65 + 0.05 * (1 - th)], [-0.55 - 0.4 * th, -0.85 + 0.15 * (1 - th)]].forEach(([x, y], i) => { lm[1 + i] = P(x, y); });
  const mcps = [[-0.35, -0.95], [0, -1], [0.3, -0.95], [0.55, -0.85]];
  mcps.forEach(([mx, my], i) => {
    const b = 5 + i * 4, e = ext[i];
    lm[b] = P(mx, my);
    // blend between curled and straight
    const st = [[mx, my - 0.45], [mx, my - 0.75], [mx, my - 1.0]], cu = [[mx, my - 0.35], [mx, my - 0.15], [mx, my + 0.1]];
    for (let k = 0; k < 3; k++) lm[b + 1 + k] = P(cu[k][0] + (st[k][0] - cu[k][0]) * e, cu[k][1] + (st[k][1] - cu[k][1]) * e);
  });
  return lm;
}

export type Dir = "right" | "left" | "up" | "down";
/**
 * One realistic swipe, 30 fps: the hand rests a moment, sweeps (dist = fraction
 * of the frame, over `ms`), rests, and (optionally) comes back. Directions are
 * the USER's (the camera image is mirrored: the user's right = image left).
 */
export function swipe(dir: Dir, seed: number, o: { dist?: number; ms?: number; returnStroke?: boolean; style?: "open" | "two" | "chop" | "lazy"; dropout?: number } = {}): (Pt[] | null)[] {
  const r = rng(seed);
  const dist = o.dist ?? 0.32, ms = o.ms ?? 380, style = o.style ?? "open", drop = o.dropout ?? 0.12;
  const frames: (Pt[] | null)[] = [];
  const start = { x: 0.5, y: 0.6 };
  const v = { right: [-1, 0], left: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  const ext = () => style === "two" ? [0.95, 0.95, 0.1, 0.1].map((e) => Math.min(1, Math.max(0, e + (r() - 0.5) * 0.3)))
    : style === "lazy" ? [0.75, 0.8, 0.7, 0.55].map((e) => Math.min(1, Math.max(0, e + (r() - 0.5) * 0.4)))
      : [1, 1, 1, 1].map((e) => Math.min(1, e - r() * 0.35));
  const frame = (x: number, y: number, moving: boolean): Pt[] | null => {
    if (moving && r() < drop) return null; // a blurred frame the tracker loses
    return handAt(x + (r() - 0.5) * 0.006, y + (r() - 0.5) * 0.006, {
      ext: ext(), rot: (style === "chop" ? 0.9 : 0.25) * (r() - 0.3), edge: style === "chop" ? 0.7 + r() * 0.3 : r() * 0.3,
      jitter: moving ? 0.18 : 0.05, r, thumb: style === "two" ? 0.2 : 0.6 + r() * 0.4,
    });
  };
  for (let i = 0; i < 12; i++) frames.push(frame(start.x, start.y, false));
  const n = Math.max(3, Math.round(ms / 33));
  for (let i = 1; i <= n; i++) {
    const u = i / n, e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2; // ease in-out
    frames.push(frame(start.x + v[0] * dist * e, start.y + v[1] * dist * e, true));
  }
  const end = { x: start.x + v[0] * dist, y: start.y + v[1] * dist };
  for (let i = 0; i < 6; i++) frames.push(frame(end.x, end.y, false));
  if (o.returnStroke) {
    const m = Math.round((ms * 1.3) / 33);
    for (let i = 1; i <= m; i++) frames.push(frame(end.x - v[0] * dist * (i / m), end.y - v[1] * dist * (i / m), true));
    for (let i = 0; i < 20; i++) frames.push(frame(start.x, start.y, false));
  }
  for (let i = 0; i < 15; i++) frames.push(null);
  return frames;
}
