import { describe, it, expect } from "vitest";
import { Gesture3D, FrameStats, type HandIn, type Output3D } from "@/lib/friday/gesture3d";
import type { Pt } from "@/lib/gesture/classify";

type Thumb = "side" | "up" | "tucked";
function hand(o: { f: [boolean, boolean, boolean, boolean]; thumb: Thumb; cx?: number; cy?: number; s?: number; pinch?: boolean }): Pt[] {
  const cx = o.cx ?? 0.5, cy = o.cy ?? 0.8, s = o.s ?? 0.16;
  const P = (x: number, y: number): Pt => ({ x: cx + x * s, y: cy + y * s });
  const lm: Pt[] = new Array(21);
  lm[0] = P(0, 0);
  const thumb: Record<Thumb, [number, number][]> = {
    side: [[-0.3, -0.25], [-0.55, -0.45], [-0.75, -0.65], [-0.95, -0.85]],
    up: [[-0.3, -0.25], [-0.5, -0.55], [-0.52, -0.95], [-0.54, -1.35]],
    tucked: [[-0.3, -0.25], [-0.55, -0.45], [-0.35, -0.6], [-0.1, -0.7]],
  };
  thumb[o.thumb].forEach(([x, y], i) => { lm[1 + i] = P(x, y); });
  ([[-0.35, -0.95], [0, -1], [0.3, -0.95], [0.55, -0.85]] as [number, number][]).forEach(([mx, my], i) => {
    const b = 5 + i * 4;
    lm[b] = P(mx, my);
    if (o.f[i]) { lm[b + 1] = P(mx, my - 0.45); lm[b + 2] = P(mx, my - 0.75); lm[b + 3] = P(mx, my - 1.0); }
    else { lm[b + 1] = P(mx, my - 0.35); lm[b + 2] = P(mx, my - 0.15); lm[b + 3] = P(mx, my + 0.1); }
  });
  if (o.pinch) lm[4] = { x: lm[8].x + 0.02 * s, y: lm[8].y + 0.03 * s };
  return lm;
}
const H = (lm: Pt[], score = 0.95): HandIn => ({ landmarks: lm, handedness: "Right", score });
const OPEN = (cx = 0.5, cy = 0.8) => H(hand({ f: [true, true, true, true], thumb: "side", cx, cy }));
const FIST = (cx = 0.5, cy = 0.8) => H(hand({ f: [false, false, false, false], thumb: "tucked", cx, cy }));
const UP = (cx = 0.5, cy = 0.8) => H(hand({ f: [false, false, false, false], thumb: "up", cx, cy }));
const PINCH = (cx = 0.5, cy = 0.8) => H(hand({ f: [true, false, false, false], thumb: "tucked", pinch: true, cx, cy }));

/** feed frames at 30 fps */
function run(g: Gesture3D, frames: HandIn[][], t0 = 0) {
  return frames.map((f, i) => g.update(f, t0 + i * 33));
}
const sum = (outs: Output3D[], k: "rotate" | "pan") => outs.reduce((a, o) => [a[0] + (o.actions[k]?.[0] ?? 0), a[1] + (o.actions[k]?.[1] ?? 0)], [0, 0]);
const zoom = (outs: Output3D[]) => outs.reduce((a, o) => a * (o.actions.zoom ?? 1), 1);

describe("Friday's hand control", () => {
  it("an open palm moving to the user's right rotates the model right (camera image isn't mirrored)", () => {
    const g = new Gesture3D();
    const outs = run(g, Array.from({ length: 30 }, (_, i) => [OPEN(0.6 - i * 0.006)]));
    expect(outs.some((o) => o.mode === "rotate")).toBe(true);
    const [yaw, pitch] = sum(outs, "rotate");
    expect(yaw).toBeGreaterThan(0.3);
    expect(Math.abs(pitch)).toBeLessThan(0.05);
  });
  it("needs a few frames before starting — one stray frame does nothing", () => {
    const g = new Gesture3D();
    const outs = run(g, [[OPEN(0.5)], [], [], [OPEN(0.45)], [], []]);
    expect(outs.every((o) => o.mode === "none" && !o.actions.rotate)).toBe(true);
  });
  it("no jump when the hand is lost and reacquired somewhere else", () => {
    const g = new Gesture3D();
    const a = run(g, Array.from({ length: 10 }, () => [OPEN(0.5)]));
    const gap = run(g, Array.from({ length: 10 }, () => []), 400);
    const b = run(g, Array.from({ length: 10 }, () => [OPEN(0.2)]), 800); // reappears far away, held still
    expect(gap.every((o) => o.mode === "none" && !o.actions.rotate)).toBe(true);
    const [yaw] = sum([...a, ...b], "rotate");
    expect(Math.abs(yaw)).toBeLessThan(0.01);
  });
  it("a short dropout (blur) doesn't end the gesture", () => {
    const g = new Gesture3D();
    const frames = [...Array.from({ length: 6 }, (_, i) => [OPEN(0.6 - i * 0.005)]), [], [], ...Array.from({ length: 6 }, (_, i) => [OPEN(0.57 - i * 0.005)])];
    const outs = run(g, frames);
    expect(outs[outs.length - 1].mode).toBe("rotate");
  });
  it("low-confidence hands are ignored", () => {
    const g = new Gesture3D();
    const outs = run(g, Array.from({ length: 20 }, (_, i) => [{ ...OPEN(0.6 - i * 0.01), score: 0.3 }]));
    expect(outs.every((o) => o.mode === "none" && o.hands.length === 0)).toBe(true);
  });
  it("pinch and move up zooms in; down zooms out", () => {
    const up = run(new Gesture3D(), Array.from({ length: 25 }, (_, i) => [PINCH(0.5, 0.8 - i * 0.006)]));
    expect(up.some((o) => o.mode === "zoom")).toBe(true);
    expect(zoom(up)).toBeLessThan(0.95);
    const down = run(new Gesture3D(), Array.from({ length: 25 }, (_, i) => [PINCH(0.5, 0.7 + i * 0.006)]));
    expect(zoom(down)).toBeGreaterThan(1.05);
  });
  it("a fist pans; it isn't mistaken for a pinch", () => {
    const outs = run(new Gesture3D(), Array.from({ length: 25 }, (_, i) => [FIST(0.5, 0.8 - i * 0.005)]));
    expect(outs.some((o) => o.mode === "pan")).toBe(true);
    expect(outs.every((o) => o.mode !== "zoom")).toBe(true);
    expect(sum(outs, "pan")[1]).toBeGreaterThan(0);
  });
  it("two pinching hands moving apart zoom in (scale up)", () => {
    const outs = run(new Gesture3D(), Array.from({ length: 25 }, (_, i) => [PINCH(0.35 - i * 0.004), PINCH(0.65 + i * 0.004)]));
    expect(outs.some((o) => o.mode === "scale")).toBe(true);
    expect(zoom(outs)).toBeLessThan(0.9);
  });
  it("both palms held pauses; held again resumes; paused = no motion", () => {
    const g = new Gesture3D();
    const hold = () => run(g, Array.from({ length: 40 }, () => [OPEN(0.3), OPEN(0.7)]), Date.now());
    const p = hold();
    expect(p.some((o) => o.actions.paused === true)).toBe(true);
    expect(g.paused).toBe(true);
    run(g, Array.from({ length: 10 }, () => []), Date.now() + 2000);
    const moving = run(g, Array.from({ length: 30 }, (_, i) => [OPEN(0.6 - i * 0.006)]), Date.now() + 3000);
    expect(moving.every((o) => !o.actions.rotate)).toBe(true);
    run(g, Array.from({ length: 10 }, () => []), Date.now() + 5000);
    const r = run(g, Array.from({ length: 40 }, () => [OPEN(0.3), OPEN(0.7)]), Date.now() + 6000);
    expect(r.some((o) => o.actions.paused === false)).toBe(true);
  });
  it("thumbs-up held resets once", () => {
    const outs = run(new Gesture3D(), Array.from({ length: 50 }, () => [UP()]));
    expect(outs.filter((o) => o.actions.reset).length).toBe(1);
    expect(Math.max(...outs.map((o) => o.hold))).toBe(1);
  });
  it("calibration sets pinch thresholds from the person's open hand", () => {
    const g = new Gesture3D();
    let got: { pinchOn: number } | null = null;
    g.onCalibrated = (r) => { got = r; };
    g.startCalibration(0);
    run(g, Array.from({ length: 80 }, () => [OPEN()]));
    expect(got).not.toBeNull();
    expect(g.s.pinchOn).toBeGreaterThanOrEqual(0.16);
    expect(g.s.pinchOff).toBeGreaterThan(g.s.pinchOn);
  });
});

describe("frame stats", () => {
  it("measures fps and median latency from real timestamps", () => {
    const s = new FrameStats();
    expect(s.fps).toBeNull();
    for (let i = 0; i < 60; i++) s.frame(i * 33.3, 20 + (i % 3));
    expect(s.fps).toBe(30);
    expect(s.latency).toBe(21);
  });
});
