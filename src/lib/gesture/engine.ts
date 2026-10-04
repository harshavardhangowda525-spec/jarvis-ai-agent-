import { readPose, POSE_LABEL, type Pose, type PoseReading, type Pt } from "./classify";

/**
 * The gesture engine: turns a stream of per-frame hand readings into a few
 * deliberate commands. Pure and deterministic (time comes in with each frame),
 * so it's unit-tested with landmark sequences.
 *
 * Safety: a pose must be clear (confidence ≥ threshold), stable (debounced for a
 * few frames), held still for the hold time, and then it fires ONCE — holding a
 * thumbs-up for 5 s is one approval. It re-arms only after the hand changes pose
 * or leaves, and every action has its own cooldown plus a short global one.
 * Swipes need a fast, mostly-straight move of a consistent pose (a swipe up only
 * by a hand that was already in view — raising a hand into the frame isn't one).
 * Pinch-clicks need a clean press-and-release with hysteresis.
 *
 * Getting around: open hand swipe → DARWIN, ← ULTRON, ↑ EV, ↓ RUBIN; a held fist → JARVIS.
 *
 * Swipes follow the palm's MOTION; the hand's shape is judged from how extended
 * the fingers are across the sweep (a real hand blurs, tilts and turns side-on
 * while it moves, so it's rarely a textbook open palm in every frame). The
 * return stroke after a swipe is ignored, and a swipe down only counts when the
 * hand stays in view (dropping your hand out of the frame isn't one).
 */

export type GestureId =
  | "open_palm" | "fist" | "thumbs_up" | "thumbs_down" | "point" | "pinch"
  | "swipe_left" | "swipe_right" | "palm_left" | "palm_right" | "palm_up" | "palm_down";

/** jarvis/darwin/ultron/ev/rubin = go to that agent. */
export type GestureAction = "wake" | "approve" | "reject" | "select" | "click" | "prev" | "next" | "jarvis" | "darwin" | "ultron" | "ev" | "rubin";

export interface GestureDef { id: GestureId; label: string; action: GestureAction; actionLabel: string; how: string }

export const GESTURES: GestureDef[] = [
  { id: "open_palm", label: "OPEN PALM", action: "wake", actionLabel: "WAKE JARVIS", how: "Hold an open hand still for a moment" },
  { id: "fist", label: "CLOSED FIST", action: "jarvis", actionLabel: "OPEN JARVIS", how: "Close your hand and hold" },
  { id: "thumbs_up", label: "THUMBS UP", action: "approve", actionLabel: "APPROVE", how: "Thumb up, hold" },
  { id: "thumbs_down", label: "THUMBS DOWN", action: "reject", actionLabel: "REJECT", how: "Thumb down, hold" },
  { id: "point", label: "POINT", action: "select", actionLabel: "SELECT", how: "Point with your index finger to aim" },
  { id: "pinch", label: "PINCH", action: "click", actionLabel: "CLICK", how: "Touch thumb and index while pointing" },
  { id: "swipe_left", label: "TWO-FINGER SWIPE ←", action: "prev", actionLabel: "PREVIOUS", how: "Index + middle up, sweep left" },
  { id: "swipe_right", label: "TWO-FINGER SWIPE →", action: "next", actionLabel: "NEXT", how: "Index + middle up, sweep right" },
  { id: "palm_right", label: "SWIPE →", action: "darwin", actionLabel: "OPEN DARWIN", how: "Open hand, sweep right" },
  { id: "palm_left", label: "SWIPE ←", action: "ultron", actionLabel: "OPEN ULTRON", how: "Open hand, sweep left" },
  { id: "palm_up", label: "SWIPE ↑", action: "ev", actionLabel: "OPEN EV", how: "Open hand, sweep up" },
  { id: "palm_down", label: "SWIPE ↓", action: "rubin", actionLabel: "OPEN RUBIN", how: "Open hand, sweep down (keep it in view)" },
];
export const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g])) as Record<GestureId, GestureDef>;

export interface GestureSettings {
  /** 0 (strict: longer holds, higher confidence) … 1 (responsive). */
  sensitivity: number;
  enabled: Record<GestureId, boolean>;
  /** Pinch threshold (thumb–index distance / hand size) — set by recalibration. */
  pinchOn: number;
  /** Show the small camera preview behind the landmarks. */
  preview: boolean;
}

export const DEFAULT_SETTINGS: GestureSettings = {
  sensitivity: 0.5,
  enabled: Object.fromEntries(GESTURES.map((g) => [g.id, true])) as Record<GestureId, boolean>,
  pinchOn: 0.32,
  preview: true,
};

export interface GestureEvent {
  id: GestureId;
  action: GestureAction;
  confidence: number;
  at: number;
  /** Screen-normalised pointer (0..1) for click events. */
  pointer?: { x: number; y: number };
}

export interface EngineOutput {
  hand: boolean;
  reading: PoseReading | null;
  /** Debounced pose. */
  pose: Pose;
  confidence: number;
  /** Progress 0..1 towards firing a hold gesture (for the ring in the HUD). */
  hold: { id: GestureId; progress: number } | null;
  /** Smoothed, mirrored, screen-normalised pointer while pointing/pinching. */
  pointer: { x: number; y: number } | null;
  pinching: boolean;
  events: GestureEvent[];
  calibrating: number | null;
}

/** Tunables derived from sensitivity. */
export function params(s: GestureSettings) {
  const k = Math.min(1, Math.max(0, s.sensitivity));
  return {
    minConf: 0.8 - 0.25 * k,             // 0.55 … 0.80
    holdMs: Math.round(700 - 330 * k),   // 370 … 700 ms
    wakeHoldMs: Math.round(700 - 330 * k) + 700, // open palm: 1.07 … 1.4 s
    stableMs: 90,                        // pose must persist this long to count
    stillness: 0.28 + 0.14 * k,          // max palm travel during a hold, in hand-sizes
    swipeDist: 1.55 - 0.6 * k,           // horizontal travel for a swipe, in hand-sizes (1.25 at the default)
    swipeWindow: 650,
    cooldown: 1400,                      // per action
    globalCooldown: 550,                 // after any command
    swipeCooldown: 800,
    swipeUpDist: (1.55 - 0.6 * k) * 0.85, // vertical travel for a swipe up/down (the frame is shorter than it is wide)
    returnLockMs: 1000,                  // the hand coming back after a swipe isn't a swipe the other way (from when it stops)
    settledMs: 250,                      // the hand must be in view this long before a swipe starts
    pinchOn: s.pinchOn,
    pinchOff: s.pinchOn * 1.65,
    clickGap: 380,
  };
}

const HOLD_ACTIONS: Partial<Record<Pose, GestureId>> = { open_palm: "open_palm", fist: "fist", thumbs_up: "thumbs_up", thumbs_down: "thumbs_down" };

/** One-euro filter: smooth when still, responsive when moving. */
export class OneEuro {
  private x: number | null = null; private dx = 0; private t = 0;
  constructor(private minCutoff = 1.4, private beta = 0.02, private dCutoff = 1) {}
  private alpha(cut: number, dt: number) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  reset() { this.x = null; this.dx = 0; }
  filter(v: number, tMs: number): number {
    if (this.x == null) { this.x = v; this.t = tMs; return v; }
    const dt = Math.max((tMs - this.t) / 1000, 1 / 120);
    this.t = tMs;
    const dv = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cut = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cut, dt) * (v - this.x);
    return this.x;
  }
}

/** Map the comfortable middle of the camera frame to the whole screen (mirrored, selfie view). */
export function toScreen(p: Pt): { x: number; y: number } {
  const c = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return { x: c(1 - (p.x - 0.15) / 0.7), y: c((p.y - 0.12) / 0.62) };
}

interface Sample { t: number; pose: Pose; conf: number; cx: number; cy: number; scale: number }
/** The hand's rough shape from finger extension alone (robust to blur / tilt). */
type Shape = "open" | "two" | "closed";
interface Track { t: number; cx: number; cy: number; scale: number; shape: Shape }

export function shapeOf(r: PoseReading): Shape {
  const [, ix, md, rg, pk] = r.fingers;
  if (r.pose === "two" && r.confidence >= 0.5) return "two";
  if (ix > 0.5 && md > 0.5 && rg < 0.4 && pk < 0.4) return "two";
  const ext = [ix, md, rg, pk].filter((v) => v > 0.42).length;
  if (r.pose === "open_palm" || ext >= 3) return "open";
  if (ext <= 1 || r.pose === "fist" || r.pose === "point" || r.pose === "thumbs_up" || r.pose === "thumbs_down") return "closed";
  return "open"; // two fingers that aren't index+middle: a loosely open hand
}
type SwipeDir = "left" | "right" | "up" | "down";
/** How long the tracker may lose a moving hand and still count the sweep as one swipe. */
const SWIPE_GAP_MS = 600;
const OPPOSITE: Record<SwipeDir, SwipeDir> = { left: "right", right: "left", up: "down", down: "up" };

export class GestureEngine {
  private settings: GestureSettings;
  private hist: Sample[] = [];
  private stable: Pose = "none";
  private pending: { pose: Pose; since: number } | null = null;
  private holdSince = 0;
  private holdFiredFor: Pose | null = null;
  private rearmSince: number | null = null;
  private lastFire: Partial<Record<GestureAction, number>> = {};
  private lastAny = -1e9;
  private lastSwipe = -1e9;
  private track: Track[] = [];
  private lastSwipeDir: SwipeDir | null = null;
  /** When the hand last moved on in the direction of the last swipe — the "coming back" lock runs from here. */
  private swipeMoveEnd = -1e9;
  /** The hand has rested since the last swipe — anything after that is a new move, not the way back. */
  private swipeSettled = true;
  private stillSince: number | null = null;
  /** A swipe down waits to see the hand stay in view (dropping a hand out of the frame isn't a swipe). */
  private pendingDown: { at: number; conf: number; cx: number; cy: number } | null = null;
  private lastSeen = -1e9;
  private handSince = -1e9;
  private pinchDown = false;
  private lastClick = -1e9;
  private fx = new OneEuro(); private fy = new OneEuro();
  private pointerTrail: { t: number; x: number; y: number }[] = [];
  private lastPointAt = -1e9;
  private calib: { start: number; min: number; samples: number } | null = null;
  /** Camera frame width ÷ height. Landmarks are 0..1 on BOTH axes, so without this a
   *  sideways swipe on a 16:9 camera would need ~1.8× more real movement than an up/down one. */
  private aspect = 1;
  onCalibrated?: (pinchOn: number) => void;

  constructor(settings: GestureSettings = DEFAULT_SETTINGS) { this.settings = settings; }
  setSettings(s: GestureSettings) { this.settings = s; }
  setAspect(a: number) { if (Number.isFinite(a) && a > 0.3 && a < 4) this.aspect = a; }
  startCalibration(t: number) { this.calib = { start: t, min: Infinity, samples: 0 }; }
  reset() {
    this.track = [];
    this.resetPose();
  }
  /** Forget poses/holds/pinch — but not the swipe track (a blurred hand the tracker lost mid-swipe). */
  private resetPose() {
    this.hist = []; this.pendingDown = null; this.stable = "none"; this.pending = null; this.holdFiredFor = null; this.rearmSince = null; this.pinchDown = false;
    this.fx.reset(); this.fy.reset(); this.pointerTrail = [];
  }

  private can(action: GestureAction, id: GestureId, t: number, p: ReturnType<typeof params>) {
    if (!this.settings.enabled[id]) return false;
    if (t - this.lastAny < p.globalCooldown) return false;
    if (t - (this.lastFire[action] ?? -1e9) < p.cooldown) return false;
    return true;
  }
  private fire(out: EngineOutput, id: GestureId, conf: number, t: number, pointer?: { x: number; y: number }) {
    const action = GESTURE_BY_ID[id].action;
    this.lastFire[action] = t; this.lastAny = t;
    out.events.push({ id, action, confidence: Math.round(conf * 100) / 100, at: t, ...(pointer ? { pointer } : {}) });
  }

  /** Feed one frame: landmarks of the (first) detected hand, or null when no hand. */
  update(landmarks: Pt[] | null, t: number): EngineOutput {
    const p = params(this.settings);
    const out: EngineOutput = { hand: false, reading: null, pose: "none", confidence: 0, hold: null, pointer: null, pinching: false, events: [], calibrating: null };
    const r = landmarks ? readPose(landmarks) : null;

    if (!r) {
      // brief dropouts don't reset anything; a real absence re-arms everything. The
      // swipe track survives a little longer: a fast swipe blurs the hand and the
      // tracker often loses it mid-sweep, finding it again where the swipe ended.
      if (t - this.lastSeen > 280) this.resetPose();
      if (t - this.lastSeen > SWIPE_GAP_MS) this.track = [];
      this.pinchDown = false;
      if (this.calib) out.calibrating = Math.min(1, (t - this.calib.start) / 4000);
      return out;
    }
    if (t - this.lastSeen > SWIPE_GAP_MS) this.handSince = t; // the hand (re)appeared (a short loss mid-swipe doesn't count)
    this.lastSeen = t;
    out.hand = true; out.reading = r;

    // ---- calibration: learn this user's pinch distance; no commands meanwhile
    if (this.calib) {
      const c = this.calib;
      if (r.fingers[1] > 0.25) { c.min = Math.min(c.min, r.pinch); c.samples++; }
      out.calibrating = Math.min(1, (t - c.start) / 4000);
      if (t - c.start >= 4000) {
        if (c.samples > 10 && Number.isFinite(c.min)) {
          const on = Math.min(0.5, Math.max(0.18, c.min * 1.9 + 0.04));
          this.settings = { ...this.settings, pinchOn: on };
          this.onCalibrated?.(on);
        }
        this.calib = null;
        this.lastAny = t;
      }
      return out;
    }

    // ---- debounce the pose
    const raw: Pose = r.confidence >= p.minConf ? r.pose : "none";
    if (raw !== this.stable) {
      if (!this.pending || this.pending.pose !== raw) this.pending = { pose: raw, since: t };
      else if (t - this.pending.since >= p.stableMs) {
        this.stable = raw; this.pending = null; this.holdSince = t;
      }
    } else this.pending = null;
    out.pose = this.stable;
    out.confidence = r.confidence;

    this.hist.push({ t, pose: raw, conf: r.confidence, cx: r.center.x, cy: r.center.y, scale: r.scale });
    while (this.hist.length && t - this.hist[0].t > 700) this.hist.shift();

    // ---- pointer (index tip) while pointing or pinching
    const pointing = this.stable === "point" || (r.fingers[1] > 0.3 && r.pinch < p.pinchOff && this.stable !== "fist");
    if (pointing) this.lastPointAt = t;
    if (pointing || t - this.lastPointAt < 350) {
      const s = toScreen(r.indexTip);
      const ptr = { x: this.fx.filter(s.x, t), y: this.fy.filter(s.y, t) };
      out.pointer = ptr;
      this.pointerTrail.push({ t, ...ptr });
      while (this.pointerTrail.length && t - this.pointerTrail[0].t > 400) this.pointerTrail.shift();
    } else { this.fx.reset(); this.fy.reset(); this.pointerTrail = []; }

    // ---- pinch → click (press with hysteresis; click on press, re-arm on release)
    const canPinch = r.fingers[1] > 0.25 && this.stable !== "fist" && this.stable !== "thumbs_up" && this.stable !== "thumbs_down";
    if (!this.pinchDown && canPinch && r.pinch < p.pinchOn) {
      this.pinchDown = true;
      if (t - this.lastClick >= p.clickGap && this.settings.enabled.pinch && t - this.lastAny >= 250) {
        // click where you were aiming just before the fingers closed (pinching drags the tip)
        const aim = this.pointerTrail.find((q) => t - q.t <= 160) ?? this.pointerTrail[this.pointerTrail.length - 1] ?? toScreen(r.indexTip);
        this.lastClick = t; this.lastAny = t;
        out.events.push({ id: "pinch", action: "click", confidence: Math.round(Math.max(0, 1 - r.pinch / p.pinchOff) * 100) / 100, at: t, pointer: { x: aim.x, y: aim.y } });
      }
    } else if (this.pinchDown && r.pinch > p.pinchOff) this.pinchDown = false;
    out.pinching = this.pinchDown;

    // ---- swipes: fast, mostly straight travel of the palm. Open hand → agents
    // (→ DARWIN, ← ULTRON, ↑ EV, ↓ RUBIN); two fingers ← / → = previous / next.
    // measured in real (square) proportions: x stretched by the frame's aspect
    const A = this.aspect, lm0 = landmarks![0], lm9 = landmarks![9];
    const prev = this.track[this.track.length - 1];
    this.track.push({ t, cx: r.center.x * A, cy: r.center.y, scale: Math.hypot((lm0.x - lm9.x) * A, lm0.y - lm9.y) || r.scale, shape: shapeOf(r) });
    // after a swipe the hand keeps going, then comes back: the lock against the way
    // back runs from when the hand stops moving along that line
    if (prev && this.lastSwipeDir && !this.swipeSettled && t - this.lastSwipe < 2200) {
      const cur = this.track[this.track.length - 1], sc = cur.scale || 1;
      const horiz = this.lastSwipeDir === "left" || this.lastSwipeDir === "right";
      if (Math.abs(horiz ? cur.cx - prev.cx : cur.cy - prev.cy) / sc > 0.07) { this.swipeMoveEnd = t; this.stillSince = null; }
      else if ((this.stillSince ??= t) && t - this.stillSince >= 350) this.swipeSettled = true; // a real pause
    }
    while (this.track.length && t - this.track[0].t > p.swipeWindow) this.track.shift();
    // a pending swipe down counts once the hand comes to rest IN VIEW (a hand being
    // put down keeps falling and leaves the frame — that cancels it)
    if (this.pendingDown) {
      const pd = this.pendingDown;
      const recent = this.track.filter((h) => t - h.t <= 120);
      const falling = recent.length > 1 ? (recent[recent.length - 1].cy - recent[0].cy) / r.scale : 0;
      if (t - pd.at > 800) this.pendingDown = null;
      else if (t - pd.at >= 90 && recent.length > 1 && falling < 0.3) {
        this.pendingDown = null;
        if (this.settings.enabled.palm_down && t - (this.lastFire.rubin ?? -1e9) >= p.swipeCooldown) this.fire(out, "palm_down", pd.conf, t);
      }
    }
    if (t - this.lastSwipe > p.swipeCooldown && this.track.length >= 3) {
      const cur = this.track[this.track.length - 1];
      const scale = this.track.reduce((s, h) => s + h.scale, 0) / this.track.length;
      // the furthest the palm has come along each direction within the window (mirrored: user's right = image left)
      let best: { dir: SwipeDir; travel: number; from: number } | null = null;
      for (let k = 0; k < this.track.length - 1; k++) {
        const a = this.track[k];
        if (cur.t - a.t < 80) break;
        const dx = -(cur.cx - a.cx) / scale, dy = (cur.cy - a.cy) / scale;
        const horiz = Math.abs(dx) >= Math.abs(dy);
        const dir: SwipeDir = horiz ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        const travel = horiz ? Math.abs(dx) : Math.abs(dy);
        const side = horiz ? Math.abs(dy) : Math.abs(dx);
        const need = horiz ? p.swipeDist : p.swipeUpDist;
        if (travel >= need && side <= travel * 0.7 && (!best || travel > best.travel)) best = { dir, travel, from: k };
      }
      if (best) {
        const seg = this.track.slice(best.from);
        const count = (sh: Shape) => seg.filter((h) => h.shape === sh).length / seg.length;
        const shape: Shape | null = count("two") >= 0.5 ? "two" : count("closed") >= 0.5 ? "closed" : "open";
        let id: GestureId | null = null;
        if (shape === "two" && (best.dir === "left" || best.dir === "right")) id = best.dir === "left" ? "swipe_left" : "swipe_right";
        else if (shape === "open") {
          if (best.dir === "right") id = "palm_right";
          else if (best.dir === "left") id = "palm_left";
          // up/down: only a hand that was already in view before it started moving
          // (raising a hand into the frame, or lowering it out, isn't one)
          else {
            const vert = (h: Track) => Math.abs(h.cy - seg[0].cy) / scale;
            let moveStart = seg[0];
            for (const h of seg) { if (vert(h) < 0.3) moveStart = h; else break; }
            if (moveStart.t - this.handSince >= p.settledMs) id = best.dir === "up" ? "palm_up" : "palm_down";
          }
        }
        // the hand coming back after a swipe is not a swipe the other way
        const returning = this.lastSwipeDir === OPPOSITE[best.dir] && t - Math.max(this.lastSwipe, this.swipeMoveEnd) < p.returnLockMs;
        if (id && !returning) {
          const conf = Math.round(Math.min(1, 0.55 + 0.45 * Math.min(1, best.travel / ((best.dir === "left" || best.dir === "right" ? p.swipeDist : p.swipeUpDist) * 1.6))) * 100) / 100;
          const action = GESTURE_BY_ID[id].action;
          if (id === "palm_down") this.pendingDown = { at: t, conf, cx: cur.cx, cy: cur.cy };
          // (a hold that just fired — e.g. the open palm you paused with before swiping — doesn't block it)
          else if (this.settings.enabled[id] && t - (this.lastFire[action] ?? -1e9) >= p.swipeCooldown) this.fire(out, id, conf, t);
        }
        if (returning) {
          // the way back is used up — and it stays "coming back" (it never becomes a swipe the other way)
          this.swipeMoveEnd = t; this.track = []; this.hist = []; this.holdSince = t;
        } else if (id || shape === "closed") {
          // a sweep is never also a hold; this movement is used up
          this.lastSwipe = t; this.lastSwipeDir = best.dir; this.swipeMoveEnd = t; this.swipeSettled = false; this.stillSince = null; this.track = []; this.hist = []; this.holdSince = t; this.holdFiredFor = this.stable;
        }
      }
    }

    // ---- holds: still, clear, once per hold. A fired hold re-arms only after the
    // hand shows something else for a while (or leaves) — flicker doesn't count.
    if (this.holdFiredFor) {
      if (this.stable === this.holdFiredFor) this.rearmSince = null;
      else {
        this.rearmSince ??= t;
        if (t - this.rearmSince >= 400) { this.holdFiredFor = null; this.rearmSince = null; }
      }
    }
    const holdId = HOLD_ACTIONS[this.stable];
    if (holdId && this.holdFiredFor !== this.stable) {
      const recent = this.hist.filter((h) => t - h.t <= 300);
      const travel = recent.length > 1
        ? Math.hypot(recent[recent.length - 1].cx - recent[0].cx, recent[recent.length - 1].cy - recent[0].cy) / r.scale
        : 0;
      if (travel > p.stillness) this.holdSince = t; // moving — restart the hold
      // an open palm is also how every swipe starts — waking needs a longer, deliberate hold
      const progress = Math.min(1, (t - this.holdSince) / (holdId === "open_palm" ? p.wakeHoldMs : p.holdMs));
      if (this.settings.enabled[holdId]) out.hold = { id: holdId, progress };
      if (progress >= 1) {
        const action = GESTURE_BY_ID[holdId].action;
        if (this.can(action, holdId, t, p)) this.fire(out, holdId, r.confidence, t);
        this.holdFiredFor = this.stable; // latched until the pose changes or the hand leaves
        out.hold = null;
      }
    }
    return out;
  }
}

export { POSE_LABEL };
