import { describe, it, expect } from "vitest";
import { readPose, type Pt } from "@/lib/gesture/classify";
import { GestureEngine, DEFAULT_SETTINGS, OneEuro, toScreen, params, type GestureEvent, type GestureSettings } from "@/lib/gesture/engine";

/** Build 21 landmarks for an upright hand (wrist at cx,cy; y grows down). */
type Thumb = "side" | "up" | "down" | "tucked";
function hand(o: { f: [boolean, boolean, boolean, boolean]; thumb: Thumb; cx?: number; cy?: number; s?: number; pinch?: boolean }): Pt[] {
  const cx = o.cx ?? 0.5, cy = o.cy ?? 0.8, s = o.s ?? 0.16;
  const P = (x: number, y: number): Pt => ({ x: cx + x * s, y: cy + y * s });
  const lm: Pt[] = new Array(21);
  lm[0] = P(0, 0);
  const thumb: Record<Thumb, [number, number][]> = {
    side: [[-0.3, -0.25], [-0.55, -0.45], [-0.75, -0.65], [-0.95, -0.85]],
    up: [[-0.3, -0.25], [-0.5, -0.55], [-0.52, -0.95], [-0.54, -1.35]],
    down: [[-0.3, -0.25], [-0.5, -0.45], [-0.55, -0.05], [-0.6, 0.35]],
    tucked: [[-0.3, -0.25], [-0.55, -0.45], [-0.35, -0.6], [-0.1, -0.7]],
  };
  thumb[o.thumb].forEach(([x, y], i) => { lm[1 + i] = P(x, y); });
  const mcps: [number, number][] = [[-0.35, -0.95], [0, -1], [0.3, -0.95], [0.55, -0.85]];
  mcps.forEach(([mx, my], i) => {
    const b = 5 + i * 4;
    lm[b] = P(mx, my);
    if (o.f[i]) { lm[b + 1] = P(mx, my - 0.45); lm[b + 2] = P(mx, my - 0.75); lm[b + 3] = P(mx, my - 1.0); }
    else { lm[b + 1] = P(mx, my - 0.35); lm[b + 2] = P(mx, my - 0.15); lm[b + 3] = P(mx, my + 0.1); }
  });
  if (o.pinch) lm[4] = { x: lm[8].x + 0.02 * s, y: lm[8].y + 0.03 * s };
  return lm;
}
const OPEN = (x = {}) => hand({ f: [true, true, true, true], thumb: "side", ...x });
const FIST = (x = {}) => hand({ f: [false, false, false, false], thumb: "tucked", ...x });
const UP = (x = {}) => hand({ f: [false, false, false, false], thumb: "up", ...x });
const DOWN = (x = {}) => hand({ f: [false, false, false, false], thumb: "down", ...x });
const POINT = (x = {}) => hand({ f: [true, false, false, false], thumb: "tucked", ...x });
const TWO = (x = {}) => hand({ f: [true, true, false, false], thumb: "tucked", ...x });
const PINCH = (x = {}) => hand({ f: [true, false, false, false], thumb: "tucked", pinch: true, ...x });

/** Run frames at 30 fps; returns all events. */
function run(e: GestureEngine, frames: (Pt[] | null)[], t0 = 0): GestureEvent[] {
  const ev: GestureEvent[] = [];
  frames.forEach((f, i) => ev.push(...e.update(f, t0 + i * 33).events));
  return ev;
}
const times = (n: number, f: () => Pt[] | null) => Array.from({ length: n }, f);

describe("pose classifier", () => {
  it("recognises each pose clearly", () => {
    const cases: [Pt[], string][] = [[OPEN(), "open_palm"], [FIST(), "fist"], [UP(), "thumbs_up"], [DOWN(), "thumbs_down"], [POINT(), "point"], [TWO(), "two"]];
    for (const [lm, pose] of cases) {
      const r = readPose(lm)!;
      expect(r.pose, pose).toBe(pose);
      expect(r.confidence, pose).toBeGreaterThan(0.75);
    }
  });
  it("measures pinch relative to hand size, independent of distance to camera", () => {
    expect(readPose(PINCH())!.pinch).toBeLessThan(0.1);
    expect(readPose(POINT())!.pinch).toBeGreaterThan(0.5);
    expect(readPose(PINCH({ s: 0.08 }))!.pinch).toBeCloseTo(readPose(PINCH({ s: 0.2 }))!.pinch, 5);
  });
  it("rejects garbage", () => {
    expect(readPose([])).toBeNull();
    expect(readPose(Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })))).toBeNull();
  });
});

describe("gesture engine", () => {
  it("a thumbs-up held for 5 s approves exactly once", () => {
    const e = new GestureEngine();
    const ev = run(e, times(150, () => UP()));
    expect(ev.map((x) => x.action)).toEqual(["approve"]);
  });
  it("flicker and dropouts during a long hold don't re-fire", () => {
    const e = new GestureEngine();
    const frames = times(150, () => UP()).map((f, i) => (i % 15 === 7 ? (i % 30 === 7 ? null : FIST()) : f));
    const ev = run(e, frames);
    expect(ev.filter((x) => x.action === "approve")).toHaveLength(1);
    expect(ev.filter((x) => x.action === "jarvis")).toHaveLength(0);
  });
  it("re-arms after the hand leaves, and respects the cooldown", () => {
    const e = new GestureEngine();
    const ev = run(e, [...times(30, () => UP()), ...times(20, () => null), ...times(40, () => UP())]);
    expect(ev.filter((x) => x.action === "approve")).toHaveLength(2);
    const e2 = new GestureEngine();
    // re-shown too soon → within the per-action cooldown → still one
    const ev2 = run(e2, [...times(25, () => UP()), ...times(10, () => null), ...times(25, () => UP())]);
    expect(ev2.filter((x) => x.action === "approve")).toHaveLength(1);
  });
  it("maps every hold pose", () => {
    const e = new GestureEngine();
    const ev = run(e, [...times(30, () => OPEN()), ...times(20, () => null), ...times(30, () => FIST()), ...times(20, () => null), ...times(30, () => DOWN())]);
    expect(ev.map((x) => x.action)).toEqual(["wake", "jarvis", "reject"]);
  });
  it("an open hand swiping right opens DARWIN — and doesn't also wake", () => {
    const e = new GestureEngine();
    const frames = times(14, () => null).concat(Array.from({ length: 12 }, (_, i) => OPEN({ cx: 0.7 - i * 0.03 }))); // image-left = user's right
    const ev = run(e, [...frames, ...times(40, () => OPEN({ cx: 0.37 }))]);
    expect(ev.map((x) => x.action)).toEqual(["darwin"]);
  });
  it("an open hand swiping left opens ULTRON", () => {
    const ev = run(new GestureEngine(), [...times(6, () => OPEN({ cx: 0.3 })), ...Array.from({ length: 12 }, (_, i) => OPEN({ cx: 0.3 + i * 0.03 }))]);
    expect(ev.map((x) => [x.id, x.action])).toEqual([["palm_left", "ultron"]]);
  });
  it("an open hand swiping up opens EV", () => {
    // hand already in view, then sweeps up (y grows down in the image)
    const ev = run(new GestureEngine(), [...times(12, () => OPEN({ cy: 0.85 })), ...Array.from({ length: 10 }, (_, i) => OPEN({ cy: 0.85 - i * 0.035 })), ...times(20, () => OPEN({ cy: 0.5 }))]);
    expect(ev.map((x) => [x.id, x.action])).toEqual([["palm_up", "ev"]]);
  });
  it("raising a hand into view is not a swipe up, and a swipe down does nothing", () => {
    // appears and rises at once — no settled hand first
    expect(run(new GestureEngine(), Array.from({ length: 10 }, (_, i) => OPEN({ cy: 0.85 - i * 0.035 }))).filter((x) => x.action === "ev")).toEqual([]);
    const down = run(new GestureEngine(), [...times(12, () => OPEN({ cy: 0.5 })), ...Array.from({ length: 10 }, (_, i) => OPEN({ cy: 0.5 + i * 0.035 }))]);
    expect(down.filter((x) => x.id === "palm_up" || x.id === "palm_left" || x.id === "palm_right")).toEqual([]);
  });
  it("a closed fist held opens JARVIS", () => {
    expect(run(new GestureEngine(), times(40, () => FIST())).map((x) => [x.id, x.action])).toEqual([["fist", "jarvis"]]);
  });
  it("two-finger swipes are previous / next", () => {
    const left = run(new GestureEngine(), Array.from({ length: 12 }, (_, i) => TWO({ cx: 0.3 + i * 0.03 })));
    expect(left.map((x) => x.id)).toEqual(["swipe_left"]);
    const right = run(new GestureEngine(), Array.from({ length: 12 }, (_, i) => TWO({ cx: 0.7 - i * 0.03 })));
    expect(right.map((x) => x.action)).toEqual(["next"]);
  });
  it("slow drift or a vertical move is not a swipe", () => {
    expect(run(new GestureEngine(), Array.from({ length: 40 }, (_, i) => TWO({ cx: 0.4 + i * 0.002 })))).toEqual([]);
    expect(run(new GestureEngine(), Array.from({ length: 12 }, (_, i) => TWO({ cy: 0.9 - i * 0.03 })))).toEqual([]);
  });
  it("pinch clicks once per press, at the pointer", () => {
    const e = new GestureEngine();
    const frames = [...times(10, () => POINT()), ...times(20, () => PINCH()), ...times(8, () => POINT()), ...times(10, () => PINCH())];
    const ev = run(e, frames);
    const clicks = ev.filter((x) => x.action === "click");
    expect(clicks).toHaveLength(2);
    expect(clicks[0].pointer!.x).toBeGreaterThan(0.3);
    expect(clicks[0].pointer!.x).toBeLessThan(0.8);
  });
  it("a fist never clicks and pointing alone never clicks", () => {
    expect(run(new GestureEngine(), times(60, () => POINT())).filter((x) => x.action === "click")).toHaveLength(0);
    expect(run(new GestureEngine(), times(60, () => FIST())).map((x) => x.action)).toEqual(["jarvis"]);
  });
  it("disabled gestures stay silent", () => {
    const s: GestureSettings = { ...DEFAULT_SETTINGS, enabled: { ...DEFAULT_SETTINGS.enabled, thumbs_up: false } };
    expect(run(new GestureEngine(s), times(60, () => UP()))).toEqual([]);
  });
  it("an ambiguous hand does nothing", () => {
    // half-curled fingers: nothing is clear enough
    const lm = OPEN();
    for (const b of [6, 10, 14, 18]) lm[b + 2] = { x: lm[b].x + 0.02, y: lm[b].y + 0.01 };
    expect(run(new GestureEngine(), times(90, () => lm))).toEqual([]);
  });
  it("sensitivity trades hold time for responsiveness", () => {
    expect(params({ ...DEFAULT_SETTINGS, sensitivity: 0 }).holdMs).toBeGreaterThan(params({ ...DEFAULT_SETTINGS, sensitivity: 1 }).holdMs);
    expect(params({ ...DEFAULT_SETTINGS, sensitivity: 1 }).minConf).toBeLessThan(params({ ...DEFAULT_SETTINGS, sensitivity: 0 }).minConf);
  });
  it("recalibration learns the pinch distance and fires nothing meanwhile", () => {
    const e = new GestureEngine();
    let learned = 0;
    e.onCalibrated = (v) => { learned = v; };
    e.startCalibration(0);
    const ev = run(e, [...times(60, () => POINT()), ...times(70, () => PINCH())]);
    expect(ev).toEqual([]);
    expect(learned).toBeGreaterThan(0.17);
    expect(learned).toBeLessThan(0.51);
  });
});

describe("pointer", () => {
  it("mirrors the selfie view and maps the comfortable zone to the screen", () => {
    expect(toScreen({ x: 0.85, y: 0.12 })).toEqual({ x: 0, y: 0 });
    expect(toScreen({ x: 0.15, y: 0.74 }).x).toBeCloseTo(1);
    expect(toScreen({ x: 0.5, y: 0.43 }).x).toBeCloseTo(0.5);
  });
  it("one-euro smooths jitter", () => {
    const f = new OneEuro();
    const out = Array.from({ length: 60 }, (_, i) => f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33));
    const spread = Math.max(...out.slice(20)) - Math.min(...out.slice(20));
    expect(spread).toBeLessThan(0.01);
  });
});

import { gestureModeCommand } from "@/lib/gesture/intent";
describe("gesture mode voice commands", () => {
  it("parses on / off", () => {
    expect(gestureModeCommand("Enable gesture mode")).toBe("on");
    expect(gestureModeCommand("Gesture mode")).toBe("on");
    expect(gestureModeCommand("jarvis, turn on gesture control")).toBe("on");
    expect(gestureModeCommand("Disable gesture mode")).toBe("off");
    expect(gestureModeCommand("turn off gestures.")).toBe("off");
    expect(gestureModeCommand("gesture mode off")).toBe("off");
    expect(gestureModeCommand("what's a gesture?")).toBeNull();
    expect(gestureModeCommand("enable dark mode")).toBeNull();
  });
});

import realHands from "./fixtures/hand-landmarks.json";
/**
 * Landmarks produced by the real MediaPipe Hand Landmarker (the same model this
 * app ships) on MediaPipe's public test photos of real hands.
 */
describe("classifier on real MediaPipe landmarks", () => {
  const cases: Record<string, string> = {
    "thumb_up.jpg": "thumbs_up", "thumb_down.jpg": "thumbs_down", "pointing_up.jpg": "point",
    "pointing_up_rotated.jpg": "point", "victory.jpg": "two", "fist.jpg": "fist",
    "open_right.jpg": "open_palm", "open_left_part.jpg": "open_palm",
  };
  for (const [img, pose] of Object.entries(cases)) {
    it(`${img} → ${pose}`, () => {
      const hands = (realHands as Record<string, { lm: Pt[] }[]>)[img];
      const r = readPose(hands[0].lm)!;
      expect(r.pose).toBe(pose);
      expect(r.confidence).toBeGreaterThan(0.8);
    });
  }
  it("a real fist never becomes a click even though thumb and index are close", () => {
    const fist = (realHands as Record<string, { lm: Pt[] }[]>)["fist.jpg"][0].lm;
    const ev = run(new GestureEngine(), times(90, () => fist));
    expect(ev.map((x) => x.action)).toEqual(["jarvis"]);
  });
});
