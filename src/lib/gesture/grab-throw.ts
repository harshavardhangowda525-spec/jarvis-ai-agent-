/**
 * "Throw to trash" — the GrabAndThrow interaction controller.
 *
 * Pure and framework-free (time comes in with every input), so every safety
 * rule is unit-tested. It only decides WHAT happens; the view animates it and
 * a "surface" adapter touches the page. Gesture detection (camera → pose) stays
 * in the gesture engine; this reads its per-frame output.
 *
 * The only sequence that throws something away:
 *   OPEN HAND → move → CLOSE FIST (held, still) → a real element is grabbed →
 *   carry the fist toward the bin → into the bin's zone (and stay a moment) →
 *   OPEN the hand clearly (held) → throw.
 * Anything else — opening elsewhere, losing the hand, a flicker of "open" in the
 * tracker, carrying for ages, a grab over nothing — cancels and the element
 * springs back. Nothing is ever removed just because a fist was seen.
 */

import type { EngineOutput } from "./engine";

export type HandPose = "fist" | "open" | "other" | "none";
export type InputSource = "hand" | "pointer";

export interface GrabInput { t: number; pose: HandPose; x: number; y: number; source: InputSource }
export interface Rect { x: number; y: number; w: number; h: number }

/** Something on the page that can be picked up (screen px). */
export interface GrabTarget { id: string; rect: Rect; label?: string; /** the whole page view rather than one element */ whole?: boolean }

export type GrabPhase = "idle" | "hover" | "closing" | "picking" | "carrying" | "throwing" | "returning";
export type BinState = "idle" | "approaching" | "ready" | "receiving" | "success";
export type CancelReason = "released" | "lost" | "timeout" | "external";

export interface GrabConfig {
  /** Classifier confidence needed to count a fist / an open hand. */
  fistConfidence: number;
  openConfidence: number;
  /** A fist must be held this long (ms) — and nearly still — to grab. */
  fistHoldMs: number;
  /** Max hand travel (px) while the fist closes; more = it's a moving fist, not a grab. */
  grabStillPx: number;
  /** The hand must have been seen open this recently (ms) before the fist — "open → close". */
  armWindowMs: number;
  /** An open hand must be held this long (ms) to count as a release. */
  openHoldMs: number;
  /** The object must be carried at least this far (px) before a release can throw it. */
  releaseDistancePx: number;
  /** …and end up at least this much closer (px) to the bin than where it was grabbed. */
  towardBinPx: number;
  /** The bin starts to glow within this distance (px) of its centre. */
  approachRadiusPx: number;
  /** Extra margin (px) around the bin that still counts as "in the bin" — the hitbox. */
  hitboxPadPx: number;
  /** The fist must stay in the hitbox this long (ms) before an open hand throws. */
  binDwellMs: number;
  /** Tracking dropouts shorter than this (ms) are ignored; longer cancels the grab. */
  lostGraceMs: number;
  /** Carrying longer than this (ms) cancels. */
  maxCarryMs: number;
  /** After a throw or a cancel, wait this long (ms) before the next grab. */
  cooldownMs: number;
}

export const GRAB_DEFAULTS: GrabConfig = {
  fistConfidence: 0.6,
  openConfidence: 0.6,
  fistHoldMs: 160,
  grabStillPx: 48,
  armWindowMs: 2500,
  openHoldMs: 120,
  releaseDistancePx: 120,
  towardBinPx: 60,
  approachRadiusPx: 240,
  hitboxPadPx: 34,
  binDwellMs: 100,
  lostGraceMs: 400,
  maxCarryMs: 20_000,
  cooldownMs: 350,
};

/** Mouse / touch testing: no holds or arming — the button IS the fist. */
const POINTER_OVERRIDES: Partial<GrabConfig> = { fistHoldMs: 0, openHoldMs: 0, armWindowMs: Infinity, grabStillPx: Infinity, binDwellMs: 0, lostGraceMs: Infinity };

export interface GrabSnapshot {
  phase: GrabPhase;
  bin: BinState;
  target: GrabTarget | null;
  /** Latest hand/pointer position (screen px). */
  pos: { x: number; y: number } | null;
  /** Where the grab started (screen px). */
  grabAt: { x: number; y: number } | null;
  /** 0..1 progress of the fist closing (for a ring on the cursor). */
  closing: number;
  source: InputSource;
}

export interface GrabHooks {
  /** What's at this point that can be grabbed (null = nothing). */
  pick: (x: number, y: number) => Promise<GrabTarget | null>;
  /** The object should fly into the bin. Call `done()` when the animation ends. */
  onThrow: (target: GrabTarget) => void;
  /** The object should spring back. Call `done()` when the animation ends. */
  onCancel: (target: GrabTarget, reason: CancelReason) => void;
  /** A fist closed over nothing grabbable. */
  onMiss?: (x: number, y: number) => void;
  onChange?: (s: GrabSnapshot) => void;
  debug?: (msg: string, data?: unknown) => void;
}

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const inRect = (p: { x: number; y: number }, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export class GrabThrowController {
  private cfg: GrabConfig;
  private hooks: GrabHooks;
  private bin: Rect | null = null;

  private phase: GrabPhase = "idle";
  private source: InputSource = "hand";
  private pos: { x: number; y: number } | null = null;
  private lastSeen = -Infinity;
  private openSeenAt = -Infinity;       // last confident open hand (arming)
  private fistSince: number | null = null;
  private fistAt: { x: number; y: number } | null = null;
  private grabAt: { x: number; y: number } | null = null;
  private carryStart = 0;
  private lastFistPos: { x: number; y: number } | null = null;
  private zoneSince: number | null = null;
  private openSince: number | null = null;
  private zoneAtOpen: number | null = null;
  private target: GrabTarget | null = null;
  private pickSeq = 0;
  private releasedWhilePicking = false;
  private coolUntil = -Infinity;
  private binOverride: BinState | null = null;
  private lastSnap = "";

  constructor(hooks: GrabHooks, cfg: Partial<GrabConfig> = {}) {
    this.hooks = hooks;
    this.cfg = { ...GRAB_DEFAULTS, ...cfg };
  }

  setConfig(cfg: Partial<GrabConfig>) { this.cfg = { ...this.cfg, ...cfg }; }
  config(): GrabConfig { return { ...this.cfg }; }
  private c(): GrabConfig { return this.source === "pointer" ? { ...this.cfg, ...POINTER_OVERRIDES } : this.cfg; }

  /** The trash bin's box on screen (px). Keep it current on resize. */
  setBin(r: Rect | null) { this.bin = r; }

  get state(): GrabSnapshot {
    const c = this.c();
    return {
      phase: this.phase, bin: this.binState(), target: this.target, pos: this.pos, grabAt: this.grabAt, source: this.source,
      closing: this.phase === "closing" && this.fistSince != null && c.fistHoldMs > 0 ? Math.min(1, (this.lastSeen - this.fistSince) / c.fistHoldMs) : this.phase === "picking" ? 1 : 0,
    };
  }

  /** Is the controller busy with a grab (so other gestures should stand down)? */
  get engaged(): boolean { return this.phase === "closing" || this.phase === "picking" || this.phase === "carrying" || this.phase === "throwing" || this.phase === "returning"; }

  private binState(): BinState {
    if (this.binOverride) return this.binOverride;
    if (this.phase === "throwing") return "receiving";
    if (this.phase !== "carrying" || !this.bin || !this.pos) return "idle";
    if (inRect(this.pos, this.bin, this.c().hitboxPadPx)) return "ready";
    return dist(this.pos, centre(this.bin)) <= this.cfg.approachRadiusPx ? "approaching" : "idle";
  }

  /** The view reports the bin's own animation (success burst) so the state reads right. */
  setBinOverride(s: BinState | null) { this.binOverride = s; this.emit(); }

  private emit() {
    const s = this.state;
    const key = `${s.phase}|${s.bin}|${s.target?.id ?? ""}|${Math.round(s.closing * 10)}`;
    if (key !== this.lastSnap) { this.lastSnap = key; this.hooks.debug?.(`→ ${s.phase} · bin ${s.bin}`, { target: s.target?.label }); }
    this.hooks.onChange?.(s);
  }

  private setPhase(p: GrabPhase) { this.phase = p; }

  /** Feed one reading (a camera frame or a pointer event). */
  input(ev: GrabInput) {
    // a different input source takes over only while nothing is in progress
    if (ev.source !== this.source) {
      if (this.engaged || ev.pose === "none") return;
      this.source = ev.source; this.fistSince = null; this.openSeenAt = -Infinity;
    }
    const c = this.c();
    const t = ev.t;
    if (ev.pose !== "none") { this.lastSeen = t; this.pos = { x: ev.x, y: ev.y }; }
    if (ev.pose === "open") this.openSeenAt = t;

    switch (this.phase) {
      case "idle":
      case "hover": {
        if (ev.pose === "none") { if (t - this.lastSeen > c.lostGraceMs || ev.source === "pointer") this.setPhase("idle"); this.fistSince = null; break; }
        this.setPhase("hover");
        if (ev.pose !== "fist" || t < this.coolUntil) { this.fistSince = null; break; }
        // a fist only counts as a grab if the hand was open just before ("open → close")
        if (this.fistSince == null) {
          if (t - this.openSeenAt > c.armWindowMs) break;
          this.fistSince = t; this.fistAt = { x: ev.x, y: ev.y };
          this.setPhase(c.fistHoldMs > 0 ? "closing" : "hover");
        }
        if (c.fistHoldMs === 0) this.startPick(t);
        break;
      }
      case "closing": {
        if (ev.pose === "none") { if (t - this.lastSeen > c.lostGraceMs) this.resetToHover(); break; }
        if (ev.pose !== "fist") {
          // a brief "other" while the fingers curl is fine; an open hand aborts
          if (ev.pose === "open") this.resetToHover();
          break;
        }
        if (this.fistAt && dist(this.fistAt, ev) > c.grabStillPx) { this.fistSince = t; this.fistAt = { x: ev.x, y: ev.y }; break; } // moving fist — restart
        if (this.fistSince != null && t - this.fistSince >= c.fistHoldMs) this.startPick(t);
        break;
      }
      case "picking": {
        if (ev.pose === "open" && this.openSince == null) this.openSince = t;
        if (ev.pose === "fist") this.openSince = null;
        if (this.openSince != null && t - this.openSince >= c.openHoldMs) this.releasedWhilePicking = true;
        break;
      }
      case "carrying": {
        if (t - this.carryStart > c.maxCarryMs) { this.cancel("timeout"); break; }
        if (ev.pose === "none") { if (t - this.lastSeen > c.lostGraceMs) this.cancel("lost"); break; }
        const inZone = !!this.bin && inRect(ev, this.bin, c.hitboxPadPx);
        if (ev.pose === "open") {
          if (this.openSince == null) { this.openSince = t; this.zoneAtOpen = this.zoneSince; }
          if (t - this.openSince >= c.openHoldMs) this.release(t);
          break;
        }
        // fist (or an ambiguous in-between pose) — still carrying
        this.openSince = null;
        this.lastFistPos = { x: ev.x, y: ev.y };
        if (inZone) this.zoneSince ??= t; else this.zoneSince = null;
        break;
      }
      default: break; // throwing / returning: the animation is in charge
    }
    this.emit();
  }

  /** Call every animation frame: catches a hand that vanished without frames (camera off). */
  tick(t: number) {
    const c = this.c();
    if ((this.phase === "carrying" || this.phase === "closing") && t - this.lastSeen > c.lostGraceMs + 250) {
      if (this.phase === "carrying") this.cancel("lost"); else this.resetToHover();
      this.emit();
    }
    if (this.phase === "carrying" && t - this.carryStart > c.maxCarryMs) { this.cancel("timeout"); this.emit(); }
  }

  private resetToHover() { this.fistSince = null; this.fistAt = null; this.setPhase(this.pos ? "hover" : "idle"); }

  private startPick(t: number) {
    const at = this.fistAt ?? this.pos;
    if (!at) return;
    this.setPhase("picking");
    this.grabAt = { ...at };
    this.openSince = null;
    this.releasedWhilePicking = false;
    const my = ++this.pickSeq;
    this.hooks.pick(at.x, at.y).then((target) => {
      if (my !== this.pickSeq || this.phase !== "picking") return;
      if (!target) {
        this.hooks.onMiss?.(at.x, at.y);
        this.coolUntil = t + this.cfg.cooldownMs;
        this.fistSince = null; this.grabAt = null;
        this.setPhase("hover");
      } else if (this.releasedWhilePicking) {
        // you let go before it was even picked up — put it straight back
        this.target = target;
        this.setPhase("returning");
        this.hooks.onCancel(target, "released");
      } else {
        this.target = target;
        this.carryStart = this.lastSeen;
        this.lastFistPos = this.pos ? { ...this.pos } : { ...at };
        this.zoneSince = null; this.openSince = null;
        this.setPhase("carrying");
      }
      this.emit();
    }, () => {
      if (my !== this.pickSeq) return;
      this.coolUntil = t + this.cfg.cooldownMs;
      this.resetToHover(); this.emit();
    });
  }

  /** The hand opened (held): throw only if EVERY condition holds, else put it back. */
  private release(t: number) {
    const c = this.c();
    const target = this.target;
    const at = this.lastFistPos ?? this.pos;
    if (!target || !at || !this.grabAt || !this.bin) { this.cancel("released"); return; }
    const bc = centre(this.bin);
    const checks = {
      inZone: inRect(at, this.bin, c.hitboxPadPx),
      dwelled: this.zoneAtOpen != null && (this.openSince ?? t) - this.zoneAtOpen >= c.binDwellMs,
      carried: dist(at, this.grabAt) >= c.releaseDistancePx,
      toward: dist(this.grabAt, bc) - dist(at, bc) >= c.towardBinPx,
    };
    this.hooks.debug?.("release", checks);
    if (checks.inZone && checks.dwelled && checks.carried && checks.toward) {
      this.setPhase("throwing");
      this.hooks.onThrow(target);
    } else this.cancel("released");
  }

  /** Put the grabbed thing back (also for outside reasons: page navigated, browser closed). */
  cancel(reason: CancelReason = "external") {
    const target = this.target;
    this.pickSeq++;
    if (this.phase === "carrying" && target) {
      this.setPhase("returning");
      this.hooks.onCancel(target, reason);
    } else if (this.phase === "picking" || this.phase === "closing") {
      this.resetToHover();
    }
    this.openSince = null; this.zoneSince = null;
  }

  /** The view finished the throw / return animation. */
  done() {
    this.target = null; this.grabAt = null; this.lastFistPos = null; this.fistSince = null; this.openSince = null; this.zoneSince = null;
    this.coolUntil = this.lastSeen + this.cfg.cooldownMs;
    this.setPhase(this.pos && this.lastSeen > -Infinity ? "hover" : "idle");
    this.emit();
  }
}

/* ---------------- camera frames → controller input ---------------- */

/** One gesture-engine frame → a pose for the controller (position is mapped by the caller). */
export function handPose(out: EngineOutput | null | undefined, cfg: Pick<GrabConfig, "fistConfidence" | "openConfidence"> = GRAB_DEFAULTS): HandPose {
  const r = out?.hand ? out.reading : null;
  if (!r) return "none";
  if (r.pose === "fist" && r.confidence >= cfg.fistConfidence) return "fist";
  if (r.pose === "open_palm" && r.confidence >= cfg.openConfidence) return "open";
  return "other";
}

/* ---------------- a tiny spring for the view ---------------- */

export interface SpringState { x: number; v: number }
/** Advance a damped spring toward `to` by dt seconds (semi-implicit Euler, stable at 60 fps). */
export function springStep(s: SpringState, to: number, dt: number, stiffness = 260, damping = 24): SpringState {
  const h = Math.min(dt, 1 / 30);
  const a = -stiffness * (s.x - to) - damping * s.v;
  const v = s.v + a * h;
  return { x: s.x + v * h, v };
}
