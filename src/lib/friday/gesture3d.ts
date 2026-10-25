/**
 * FRIDAY's hand control for the 3D viewer (client-safe, pure — unit-tested).
 *
 *   one open palm, moving   → rotate (orbit)
 *   pinch (thumb + index) and move up/down → zoom
 *   two hands pinching, move apart/together → scale (zoom)
 *   closed fist (grab), moving → pan
 *   both palms open, held   → pause / resume hand control
 *   thumbs-up, held         → reset the view
 *
 * Reliability: poses need a minimum confidence; a gesture only starts after its
 * pose is seen for a few frames in a row and only ends after it's been missing
 * for a few (hysteresis, so one blurry frame doesn't drop or start anything);
 * pinch has separate on/off thresholds; positions go through One-Euro filters;
 * a hand that is (re)acquired starts from where it is — it never produces a
 * jump; no hands = neutral (no motion at all).
 */
import { readPose, type Pt, type PoseReading } from "@/lib/gesture/classify";
import { OneEuro } from "@/lib/gesture/engine";

export interface HandIn { landmarks: Pt[]; handedness: string; score: number }

export type Mode3D = "none" | "rotate" | "zoom" | "scale" | "pan" | "pause_hold" | "reset_hold";

export interface Actions3D {
  /** radians: yaw (+ = model turns to the user's right), pitch (+ = tilt top towards the user) */
  rotate?: [number, number];
  /** multiply the camera distance by this (< 1 = closer) */
  zoom?: number;
  /** fraction of the viewport: x right, y up */
  pan?: [number, number];
  reset?: boolean;
  /** hand control was paused (true) or resumed (false) this frame */
  paused?: boolean;
}

export interface Output3D {
  mode: Mode3D;
  /** what the camera sees, for the on-screen indicator */
  hands: { pose: string; confidence: number; pinch: boolean; x: number; y: number }[];
  actions: Actions3D;
  paused: boolean;
  /** 0..1 progress of a hold gesture (pause / reset) */
  hold: number;
  calibrating: boolean;
}

export interface Settings3D {
  minConfidence: number;   // tracker hand score + pose confidence floor
  activateFrames: number;  // frames a pose must be seen before its gesture starts
  releaseFrames: number;   // frames a pose may be missing before its gesture ends
  pinchOn: number;         // pinch ratio to start a pinch
  pinchOff: number;        // ratio to release it (> pinchOn)
  rotateGain: number;      // radians per hand-width of movement
  zoomGain: number;
  panGain: number;
  deadZone: number;        // ignore per-frame motion below this (hand-widths)
  holdMs: number;          // pause / reset hold time
}

export const DEFAULT_3D: Settings3D = {
  minConfidence: 0.55, activateFrames: 3, releaseFrames: 4, pinchOn: 0.24, pinchOff: 0.4,
  rotateGain: 1.6, zoomGain: 1.4, panGain: 0.9, deadZone: 0.004, holdMs: 900,
};

interface Hand { r: PoseReading; score: number; pinch: boolean; x: number; y: number }

const MAX_STEP = 0.25; // hand-widths per frame — anything bigger is a tracking glitch, not movement

export class Gesture3D {
  s: Settings3D;
  private mode: Mode3D = "none";
  private candidate: Mode3D = "none";
  private seen = 0;
  private missing = 0;
  private prev: { x: number; y: number; spread?: number } | null = null;
  private fx = new OneEuro(1.2, 0.03); private fy = new OneEuro(1.2, 0.03); private fs = new OneEuro(1.0, 0.02);
  private pinched: boolean[] = [false, false];
  private holdStart = 0;
  private holdDone = false;
  private _paused = false;
  /** hand size seen during calibration (normalises motion gain) */
  private refScale: number | null = null;
  private calib: { start: number; scales: number[]; pinches: number[] } | null = null;
  onCalibrated?: (r: { pinchOn: number; pinchOff: number; scale: number }) => void;

  constructor(s: Partial<Settings3D> = {}) { this.s = { ...DEFAULT_3D, ...s }; }
  get paused() { return this._paused; }
  setPaused(p: boolean) { this._paused = p; this.neutral(); }

  /** Hold an open palm, fingers spread, for ~2 s. */
  startCalibration(t: number) { this.calib = { start: t, scales: [], pinches: [] }; }

  private neutral() {
    this.mode = "none"; this.candidate = "none"; this.seen = 0; this.missing = 0; this.prev = null;
    this.fx.reset(); this.fy.reset(); this.fs.reset(); this.holdStart = 0; this.holdDone = false;
  }

  private read(hs: HandIn[]): Hand[] {
    const out: Hand[] = [];
    // left-to-right order keeps each hand in the same slot from frame to frame
    [...hs].sort((a, b) => (a.landmarks[0]?.x ?? 0) - (b.landmarks[0]?.x ?? 0)).slice(0, 2).forEach((h, i) => {
      if (h.score < this.s.minConfidence) return;
      const r = readPose(h.landmarks);
      if (!r) return;
      // pinch with hysteresis per hand slot; a curled index (fist) isn't a pinch
      const was = this.pinched[i];
      const pinch = r.fingers[1] >= 0.25 && (was ? r.pinch < this.s.pinchOff : r.pinch < this.s.pinchOn);
      this.pinched[i] = pinch;
      if (!pinch && r.confidence < this.s.minConfidence) return;
      out.push({ r, score: h.score, pinch, x: r.center.x, y: r.center.y });
    });
    for (let i = out.length; i < 2; i++) this.pinched[i] = false;
    return out;
  }

  private want(h: Hand[]): Mode3D {
    if (h.length === 2) {
      if (h[0].pinch && h[1].pinch) return "scale";
      if (h[0].r.pose === "open_palm" && h[1].r.pose === "open_palm") return "pause_hold";
    }
    if (this._paused) return "none";
    const a = h[0];
    if (!a) return "none";
    if (a.pinch) return "zoom";
    if (a.r.pose === "thumbs_up") return "reset_hold";
    if (a.r.pose === "fist") return "pan";
    if (a.r.pose === "open_palm") return "rotate";
    return "none";
  }

  update(hs: HandIn[], t: number): Output3D {
    const hands = this.read(hs);
    const actions: Actions3D = {};
    const view = hands.map((h) => ({ pose: h.pinch ? "pinch" : h.r.pose, confidence: Math.round(Math.min(h.score, h.pinch ? 1 : h.r.confidence) * 100) / 100, pinch: h.pinch, x: h.x, y: h.y }));

    if (this.calib) {
      const h = hands[0];
      if (h && h.r.pose === "open_palm") { this.calib.scales.push(h.r.scale); this.calib.pinches.push(h.r.pinch); }
      if (t - this.calib.start > 2000 && this.calib.scales.length >= 20) {
        const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
        this.refScale = med(this.calib.scales);
        const open = med(this.calib.pinches);
        // thresholds relative to this person's open hand (bounded so they stay sensible)
        this.s.pinchOn = Math.min(0.32, Math.max(0.16, open * 0.22));
        this.s.pinchOff = Math.min(0.5, Math.max(this.s.pinchOn + 0.1, open * 0.36));
        this.calib = null;
        this.onCalibrated?.({ pinchOn: this.s.pinchOn, pinchOff: this.s.pinchOff, scale: this.refScale });
      } else if (t - this.calib.start > 8000) this.calib = null; // gave up — keep the defaults
      return { mode: "none", hands: view, actions, paused: this._paused, hold: 0, calibrating: !!this.calib };
    }

    // activation / release hysteresis
    const w = this.want(hands);
    if (w === this.mode && w !== "none") { this.missing = 0; }
    else if (this.mode !== "none" && (w === "none" || w !== this.mode)) {
      if (++this.missing >= this.s.releaseFrames) this.neutral();
    }
    if (this.mode === "none" && w !== "none") {
      if (w === this.candidate) this.seen++; else { this.candidate = w; this.seen = 1; }
      if (this.seen >= this.s.activateFrames) { this.mode = w; this.missing = 0; this.prev = null; this.fx.reset(); this.fy.reset(); this.fs.reset(); this.holdStart = t; this.holdDone = false; }
    } else if (w === "none") { this.candidate = "none"; this.seen = 0; }

    let hold = 0;
    const active = this.mode !== "none" && w === this.mode;
    if (active) {
      const unit = this.refScale ?? hands[0].r.scale; // hand-widths → distance from the camera doesn't change sensitivity
      if (this.mode === "pause_hold" || this.mode === "reset_hold") {
        hold = Math.min(1, (t - this.holdStart) / this.s.holdMs);
        if (hold >= 1 && !this.holdDone) {
          this.holdDone = true;
          if (this.mode === "pause_hold") { this._paused = !this._paused; actions.paused = this._paused; }
          else actions.reset = true;
        }
      } else if (this.mode === "scale") {
        const spread = this.fs.filter(Math.hypot(hands[0].x - hands[1].x, hands[0].y - hands[1].y) / unit, t);
        if (this.prev?.spread != null && spread > 0) {
          const ratio = this.prev.spread / spread;
          if (Math.abs(1 - ratio) > this.s.deadZone && Math.abs(1 - ratio) < MAX_STEP) actions.zoom = ratio;
        }
        this.prev = { x: 0, y: 0, spread };
      } else {
        const x = this.fx.filter(hands[0].x / unit, t), y = this.fy.filter(hands[0].y / unit, t);
        if (this.prev) {
          // the camera image isn't mirrored: moving your hand to your right lowers x
          const dx = -(x - this.prev.x), dy = y - this.prev.y;
          const moved = Math.hypot(dx, dy);
          if (moved > this.s.deadZone && moved < MAX_STEP) {
            if (this.mode === "rotate") actions.rotate = [dx * this.s.rotateGain, -dy * this.s.rotateGain];
            else if (this.mode === "pan") actions.pan = [dx * this.s.panGain * 0.25, -dy * this.s.panGain * 0.25];
            else if (this.mode === "zoom") actions.zoom = Math.exp(dy * this.s.zoomGain); // hand down = zoom out, up = zoom in
          }
        }
        this.prev = { x, y };
      }
    }
    if (!hands.length && this.mode === "none") this.prev = null;
    return { mode: active ? this.mode : "none", hands: view, actions, paused: this._paused, hold, calibrating: false };
  }
}

/** Rolling FPS / latency measured from real frame timestamps (ms). */
export class FrameStats {
  private times: number[] = [];
  private lat: number[] = [];
  frame(t: number, latencyMs: number | null) {
    this.times.push(t);
    while (this.times.length && t - this.times[0] > 4000) this.times.shift();
    if (latencyMs != null && Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs < 2000) { this.lat.push(latencyMs); if (this.lat.length > 60) this.lat.shift(); }
  }
  get fps(): number | null {
    if (this.times.length < 3) return null;
    const span = this.times[this.times.length - 1] - this.times[0];
    return span > 0 ? Math.round(((this.times.length - 1) * 1000) / span) : null;
  }
  get latency(): number | null {
    if (this.lat.length < 5) return null;
    const s = [...this.lat].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)]);
  }
  reset() { this.times = []; this.lat = []; }
}
