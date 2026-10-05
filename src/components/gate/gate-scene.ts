import type { GatePhase } from "@/lib/gate/machine";
import type { FaceFrame } from "@/lib/gate/face-tracker";

/**
 * The gate's motion graphics, drawn on one canvas so every state flows into
 * the next: the opening (a point → the AI core), the holographic scanner
 * (rings, grid, energy waves, orbiting particles), the face hologram that
 * follows a detected face (landmarks, contours, brackets, scan line), the
 * failure glitch, and the unlock (rings blast outward, flash, shockwave, the
 * scanner collapses to a point that grows into the JARVIS core).
 *
 * Purely visual. The live camera view is drawn inside the lens, framed on your
 * face, with the landmarks laid exactly over it — on this screen only; frames
 * are never kept or sent. The face points are only drawn, never measured.
 */

type RGB = [number, number, number];
const CYAN: RGB = [70, 205, 255];
const GOOD: RGB = [90, 255, 200];
const BAD: RGB = [255, 96, 64];
const LOCK: RGB = [255, 70, 80];

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: RGB }
interface Star { x: number; y: number; z: number; tw: number }
interface Flow { a: number; r: number; v: number; size: number }
interface Orbit { a: number; r: number; w: number; size: number }
interface Hex { x: number; y: number; vy: number; life: number; text: string }

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const easeOut = (x: number) => 1 - (1 - clamp(x)) ** 3;
const approach = (cur: number, target: number, dt: number, k: number) => cur + (target - cur) * (1 - Math.exp(-dt * k));
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a)})`;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// a few landmarks that read as "measured" points (nose tip, eye corners, mouth corners, chin, brow, cheeks)
const KEY_POINTS = [1, 33, 133, 362, 263, 61, 291, 199, 10, 234, 454, 168, 152, 4, 105, 334];
const KEY_LINKS: [number, number][] = [[33, 133], [362, 263], [133, 168], [168, 362], [168, 4], [4, 1], [61, 291], [1, 61], [1, 291], [291, 199], [61, 199], [199, 152], [10, 168], [234, 61], [454, 291], [105, 10], [334, 10]];
const HEX = "0123456789ABCDEF";
const hexString = (n: number) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join("");

/** Where the scanner sits (shared with the page so text and buttons line up). */
export function gateLayout(w: number, h: number, compact = 0) {
  const base = clamp(Math.min(w, h * 0.82) * 0.27, 110, 270);
  const R = base * (1 - 0.32 * compact);
  const cy = h * (w < 640 ? 0.4 : 0.45) - h * (w < 640 ? 0.1 : 0.09) * compact;
  return { R, cy, cx: w / 2 };
}

export class GateScene {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private raf = 0; private last = 0; private t0 = performance.now();
  private phase: GatePhase = "initializing"; private phaseAt = performance.now();
  private reduce: boolean;

  private face: FaceFrame | null = null; private faceAspect = 4 / 3; private contours: { start: number; end: number }[] = [];
  private faceAlpha = 0; private bracket = 1.3; private progress = 0; private progressShown = 0;
  /** The live camera view shown in the lens (never recorded). */
  private video: HTMLVideoElement | null = null; private videoAlpha = 0;
  /** How the camera frame maps into the lens (centre in frame units, scale relative to R) — smoothed. */
  private view = { bx: 2 / 3, by: 0.5, k: 0 };
  private open = 0;      // scanner opened (0 = core only)
  private core = 0;      // AI core visibility
  private speed = 0.6; private rot = [0, 0, 0, 0];
  private tint: RGB = [...CYAN];
  private pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  private stars: Star[] = []; private flows: Flow[] = []; private orbits: Orbit[] = []; private parts: P[] = []; private hexes: Hex[] = [];
  private successAt = 0; private failAt = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = this.reduce ? 0.4 : 1;
    this.stars = Array.from({ length: Math.round(150 * n) }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28 }));
    this.flows = Array.from({ length: Math.round(80 * n) }, () => this.newFlow(true));
    this.orbits = Array.from({ length: Math.round(54 * n) }, () => ({ a: Math.random() * 6.28, r: 1.02 + Math.random() * 0.3, w: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1), size: 0.6 + Math.random() * 1.4 }));
    this.resize();
  }

  /** Time since the scene started (s) — the opening sequence runs off this. */
  get elapsed() { return (performance.now() - this.t0) / 1000; }
  private cmp = 0; private cmpT = 0; // compact: the scanner makes room for the PIN / password panel
  private get R() { return gateLayout(this.w, this.h, this.cmp).R; }
  private get cx() { return this.w / 2; }
  private get cy() { return gateLayout(this.w, this.h, this.cmp).cy; }
  setCompact(on: boolean) { this.cmpT = on ? 1 : 0; }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }
  setPointer(x: number, y: number) { this.pointer.x = x / Math.max(1, this.w) - 0.5; this.pointer.y = y / Math.max(1, this.h) - 0.5; }
  setFace(f: FaceFrame | null, aspect: number, contours: { start: number; end: number }[]) {
    if (f && !this.face) this.bracket = 1.35; // lock-on
    this.face = f; this.faceAspect = aspect; if (contours.length) this.contours = contours;
  }
  setProgress(p: number) { this.progress = clamp(p); }
  /** Show this camera's live view in the lens (null hides it). */
  setVideo(v: HTMLVideoElement | null) { this.video = v; }
  getProgress() { return this.progress; }

  setPhase(p: GatePhase) {
    if (p === this.phase) return;
    const prev = this.phase;
    this.phase = p; this.phaseAt = performance.now();
    if (p === "verified" && prev !== "verified") this.burstSuccess();
    if ((p === "not-recognized" || p === "locked-out") && prev === "verifying") this.burstFail(p === "locked-out");
  }

  start() { const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.frame(now); }; this.raf = requestAnimationFrame(loop); }
  stop() { cancelAnimationFrame(this.raf); }

  /* ---------------- particles ---------------- */

  private newFlow(anywhere = false): Flow {
    return { a: Math.random() * Math.PI * 2, r: anywhere ? 0.3 + Math.random() * 0.9 : 1 + Math.random() * 0.3, v: 0.05 + Math.random() * 0.12, size: 0.5 + Math.random() * 1.3 };
  }
  private burstSuccess() {
    this.successAt = performance.now();
    const R = this.R, n = this.reduce ? 90 : 260;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * R, sp = 160 + Math.random() * 620;
      this.parts.push({ x: this.cx + Math.cos(a) * r, y: this.cy + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.8 + Math.random() * 0.9, size: 0.8 + Math.random() * 2, color: Math.random() < 0.7 ? GOOD : [210, 250, 255] });
    }
  }
  private burstFail(lock: boolean) {
    this.failAt = performance.now();
    const R = this.R, n = this.reduce ? 30 : 80;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      this.parts.push({ x: this.cx + Math.cos(a) * R, y: this.cy + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.7 + Math.random() * 0.8, size: 0.8 + Math.random() * 1.6, color: lock ? LOCK : BAD });
    }
  }

  /* ---------------- frame ---------------- */

  private frame(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    const t = (now - this.t0) / 1000;
    const ph = this.phase, since = (now - this.phaseAt) / 1000;
    const succ = this.successAt ? (now - this.successAt) / 1000 : -1;
    const fail = this.failAt ? (now - this.failAt) / 1000 : 99;
    const ctx = this.ctx, R = this.R, cx = this.cx, cy = this.cy;

    // targets
    const scanning = ph === "scanning" || ph === "verifying";
    const speedT = ph === "initializing" ? 0.6 : ph === "face-detected" ? 1.8 : ph === "scanning" ? 3.4 : ph === "verifying" ? 4.6
      : ph === "verified" || ph === "unlocked" ? 7 : ph === "not-recognized" ? (since < 0.9 ? -2.4 : 0.9) : ph === "locked-out" ? (since < 0.9 ? -2 : 0.22) : 0.9;
    this.speed = approach(this.speed, speedT, dt, ph === "not-recognized" || ph === "locked-out" ? 7 : 2.2);
    const tintT = ph === "verified" || ph === "unlocked" ? GOOD : ph === "locked-out" ? LOCK : ph === "not-recognized" && since < 2 ? BAD : CYAN;
    this.tint = mix(this.tint, tintT, 1 - Math.exp(-dt * 4));
    const openT = ph === "initializing" ? 0 : succ >= 0 ? 1 : 1;
    this.open = approach(this.open, openT, dt, ph === "initializing" ? 4 : 2.6);
    const vid = this.video, vidReady = !!vid && vid.readyState >= 2 && vid.videoWidth > 0;
    this.videoAlpha = approach(this.videoAlpha, vidReady && ph !== "initializing" && succ < 0 ? 1 : 0, dt, 4);
    // frame the lens on the face (or the whole picture when there isn't one), smoothly
    {
      const asp = vidReady ? vid!.videoWidth / vid!.videoHeight : this.faceAspect;
      const f = this.face;
      const tgt = f
        ? { bx: (f.box.x + f.box.w / 2) * asp, by: f.box.y + f.box.h / 2, k: 1.32 / Math.max(f.box.h, f.box.w * asp * 0.9, 1e-3) }
        : { bx: asp / 2, by: 0.5, k: 2.04 };
      if (!this.view.k) this.view = tgt;
      else { this.view.bx = approach(this.view.bx, tgt.bx, dt, 6); this.view.by = approach(this.view.by, tgt.by, dt, 6); this.view.k = approach(this.view.k, tgt.k, dt, 5); }
    }
    let coreT = ph === "initializing" ? 1 : (this.face && this.faceAlpha > 0.3) || this.videoAlpha > 0.3 ? 0 : 0.42;
    if (succ >= 0) coreT = succ < 1.6 ? 0 : 1;
    this.core = approach(this.core, coreT, dt, succ >= 1.6 ? 3 : 3.5);
    this.faceAlpha = approach(this.faceAlpha, this.face && succ < 0 ? 1 : 0, dt, 5);
    this.bracket = approach(this.bracket, 1, dt, 6);
    this.progressShown = approach(this.progressShown, this.progress, dt, 6);
    for (let i = 0; i < 4; i++) this.rot[i] += dt * this.speed * [0.22, -0.34, 0.12, 0.5][i];
    this.cmp = approach(this.cmp, this.cmpT, dt, 5);
    this.pointer.sx = approach(this.pointer.sx, this.pointer.x, dt, 2); this.pointer.sy = approach(this.pointer.sy, this.pointer.y, dt, 2);

    // background
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#010309"; ctx.fillRect(0, 0, this.w, this.h);
    const bootDark = ph === "initializing" ? smooth(0, 0.8, t) : 1;
    const vg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(this.w, this.h) * 0.75);
    vg.addColorStop(0, rgba(this.tint, 0.07 * bootDark)); vg.addColorStop(0.5, rgba(this.tint, 0.02 * bootDark)); vg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, this.w, this.h);

    // ---- your live camera view inside the lens
    const succBlast = succ >= 0 ? easeOut(clamp(succ / 0.9)) : 0;
    const va = this.videoAlpha * this.open * (1 - succBlast);
    if (va > 0.01 && vidReady) this.drawVideo(vid!, cx, cy, R * 0.965 * (0.3 + 0.7 * easeOut(this.open)), R, va);

    ctx.globalCompositeOperation = "lighter";
    // stars with slow parallax
    for (const s of this.stars) {
      s.y -= dt * 0.004 * s.z; if (s.y < -0.02) s.y = 1.02;
      const x = s.x * this.w + this.pointer.sx * 26 * s.z, y = s.y * this.h + this.pointer.sy * 26 * s.z;
      const a = (0.18 + 0.22 * Math.sin(t * 1.3 + s.tw)) * s.z * bootDark;
      ctx.fillStyle = rgba(this.tint, a); ctx.fillRect(x, y, s.z * 1.4, s.z * 1.4);
    }

    // particles and fragments drifting toward the core / hologram
    const flowOn = ph === "initializing" ? smooth(0.8, 1.8, t) : scanning ? 1 : 0.45;
    const D = Math.max(this.w, this.h) * 0.62;
    for (const f of this.flows) {
      f.r -= dt * f.v * (scanning ? 2.4 : 1) * (succ >= 0 ? -3 : 1);
      const inner = ph === "initializing" ? 0.06 : (R * 0.98) / D;
      if (f.r < inner || f.r > 1.6) Object.assign(f, this.newFlow());
      f.a += dt * 0.08 * this.speed;
      const r = f.r * D, x = cx + Math.cos(f.a) * r, y = cy + Math.sin(f.a) * r * 0.92;
      const a = flowOn * clamp((1.3 - f.r) * 0.8) * 0.55 * (succ >= 0 ? clamp(1 - succ) : 1);
      if (a > 0.01) { ctx.fillStyle = rgba(this.tint, a); ctx.fillRect(x, y, f.size, f.size); }
    }

    // ---- opening: a point → the AI core
    if (ph === "initializing") {
      const point = smooth(0.5, 1.1, t), grow = easeOut(smooth(1.2, 2.5, t));
      this.drawCore(cx, cy, 2 + grow * R * 0.34, point, t, smooth(1.9, 3, t));
    } else if (this.core > 0.01) {
      // between: a dim core waiting for a face; after the unlock: the JARVIS core forming
      const big = succ >= 1.6 ? easeOut((succ - 1.6) / 1.2) : 0;
      const r = succ >= 1.6 ? 2 + big * R * 0.42 : R * 0.26;
      this.drawCore(cx, cy, r, this.core, t, succ >= 1.6 ? smooth(1.9, 2.9, succ) : 0.6);
    }

    // ---- the scanner
    const collapse = succ >= 0 ? easeOut(clamp((succ - 0.9) / 0.7)) : 0; // → a point
    const blast = succ >= 0 ? easeOut(clamp(succ / 0.9)) : 0;
    const vis = this.open * (1 - collapse) * (succ >= 0 ? 1 - 0.85 * blast : 1);
    if (vis > 0.01) {
      const glitch = fail < 0.75 && !this.reduce ? (Math.random() - 0.5) * 14 * (1 - fail / 0.75) : 0;
      const scale = (0.3 + 0.7 * easeOut(this.open)) * (1 + blast * 2.6) * (1 - collapse * 0.9);
      this.drawScanner(cx + glitch, cy, R * scale, vis, t, glitch !== 0);
      if (glitch) { ctx.globalAlpha = 0.5; this.drawScanner(cx - glitch * 1.4, cy + glitch * 0.3, R * scale, vis * 0.5, t, true, BAD); ctx.globalAlpha = 1; }
    }
    // the point the scanner collapses into
    if (succ >= 0.9 && succ < 2.2) {
      const a = smooth(0.9, 1.3, succ) * (1 - smooth(1.7, 2.2, succ));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
      g.addColorStop(0, rgba([235, 255, 250], a)); g.addColorStop(0.3, rgba(GOOD, a * 0.6)); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 6.283); ctx.fill();
    }

    // ---- face hologram
    if (this.faceAlpha > 0.01 && this.face) this.drawFace(cx, cy, R, this.faceAlpha * (1 - collapse) * this.open, t, scanning);
    else if (this.open > 0.5 && succ < 0) this.drawBrackets(cx - R * 0.42, cy - R * 0.5, R * 0.84, R * 1.0, 0.35 * this.open, t);

    // ---- data fragments (decorative hex — never real measurements)
    if (scanning && this.hexes.length < 10 && Math.random() < dt * 5) {
      const a = Math.random() * Math.PI * 2, r = R * (1.2 + Math.random() * 0.35);
      this.hexes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vy: -8 - Math.random() * 14, life: 0, text: `${hexString(4)}:${hexString(6)}` });
    }
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.hexes = this.hexes.filter((hx) => {
      hx.life += dt; hx.y += hx.vy * dt;
      const a = Math.sin(clamp(hx.life / 2.2) * Math.PI) * 0.5;
      ctx.fillStyle = rgba(this.tint, a); ctx.fillText(hx.text, hx.x, hx.y);
      return hx.life < 2.2;
    });

    // ---- the unlock: flash + shockwave across the screen
    if (succ >= 0 && succ < 1.6) {
      if (succ < 0.55) {
        const a = (1 - succ / 0.55) * 0.75;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
        g.addColorStop(0, rgba([240, 255, 252], a)); g.addColorStop(0.35, rgba(GOOD, a * 0.5)); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
      }
      const diag = Math.hypot(this.w, this.h);
      const sr = R + easeOut(succ / 1.3) * diag, sa = (1 - succ / 1.4) * 0.55;
      ctx.lineWidth = 2; ctx.strokeStyle = rgba(GOOD, sa); ctx.beginPath(); ctx.arc(cx, cy, sr, 0, 6.283); ctx.stroke();
      ctx.lineWidth = 14; ctx.strokeStyle = rgba(GOOD, sa * 0.12); ctx.beginPath(); ctx.arc(cx, cy, sr - 8, 0, 6.283); ctx.stroke();
    }
    // a red warning pulse on failure
    if (fail < 1.2) {
      const fr = R * (1 + fail * 0.7), fa = (1 - fail / 1.2) * 0.5;
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(ph === "locked-out" ? LOCK : BAD, fa); ctx.beginPath(); ctx.arc(cx, cy, fr, 0, 6.283); ctx.stroke();
    }

    // burst particles
    this.parts = this.parts.filter((p) => {
      p.life += dt; const k = Math.exp(-dt * 2.2); p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = (1 - p.life / p.max) * 0.9;
      if (a > 0) { ctx.fillStyle = rgba(p.color, a); ctx.fillRect(p.x, p.y, p.size, p.size); }
      return p.life < p.max;
    });

    // orbit particles synchronise around the new core
    if (succ >= 1.8) {
      const sync = smooth(1.8, 3, succ), r0 = R * 0.62;
      for (const o of this.orbits) {
        o.w = approach(o.w, 0.6, dt, 2 * sync); o.r = approach(o.r, 1, dt, 2 * sync);
        o.a += dt * o.w;
        const x = cx + Math.cos(o.a) * r0 * o.r, y = cy + Math.sin(o.a) * r0 * o.r * 0.35;
        ctx.fillStyle = rgba(GOOD, 0.6 * sync); ctx.fillRect(x, y, o.size, o.size);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** The AI core: a glowing sphere with turning latitude rings. */
  private drawCore(cx: number, cy: number, r: number, alpha: number, t: number, rings: number) {
    const ctx = this.ctx, c = this.tint;
    if (alpha <= 0.01) return;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2 + 30);
    glow.addColorStop(0, rgba([230, 252, 255], 0.95 * alpha)); glow.addColorStop(0.12, rgba(c, 0.55 * alpha));
    glow.addColorStop(0.4, rgba(c, 0.12 * alpha)); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r * 3.2 + 30, 0, 6.283); ctx.fill();
    if (r < 6) return;
    const body = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
    body.addColorStop(0, rgba([210, 248, 255], 0.5 * alpha)); body.addColorStop(0.6, rgba(c, 0.18 * alpha)); body.addColorStop(1, rgba(c, 0.05 * alpha));
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill();
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const k = Math.cos(t * 0.6 + i * 0.63);
      ctx.strokeStyle = rgba(c, 0.32 * alpha); ctx.beginPath(); ctx.ellipse(cx, cy, r, Math.abs(r * k), 0, 0, 6.283); ctx.stroke();
    }
    // holographic rings forming around it
    if (rings > 0.01) {
      for (let i = 0; i < 3; i++) {
        const ra = r * (1.35 + i * 0.32), on = clamp(rings * 3 - i), spin = t * (0.5 - i * 0.22);
        ctx.strokeStyle = rgba(c, 0.5 * alpha * on); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(cx, cy, ra, ra * (0.28 + i * 0.06), spin * 0.2, spin, spin + 6.283 * on); ctx.stroke();
      }
    }
  }

  private drawScanner(cx: number, cy: number, R: number, a: number, t: number, glitch: boolean, color?: RGB) {
    const ctx = this.ctx, c = color ?? this.tint;
    // subtle grid inside the lens
    if (!glitch) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 0.97, 0, 6.283); ctx.clip();
      ctx.strokeStyle = rgba(c, 0.05 * a); ctx.lineWidth = 1;
      const step = R / 7;
      ctx.beginPath();
      for (let x = cx - R; x <= cx + R; x += step) { ctx.moveTo(x, cy - R); ctx.lineTo(x, cy + R); }
      for (let y = cy - R; y <= cy + R; y += step) { ctx.moveTo(cx - R, y); ctx.lineTo(cx + R, y); }
      ctx.stroke();
      // pulsing energy waves
      for (let k = 0; k < 3; k++) {
        const f = (t * 0.42 * Math.max(0.4, Math.abs(this.speed) / 2) + k / 3) % 1;
        ctx.strokeStyle = rgba(c, (1 - f) * 0.16 * a); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, R * (0.2 + 0.78 * f), 0, 6.283); ctx.stroke();
      }
      ctx.restore();
    }
    // main lens ring (double stroke = glow)
    ctx.lineWidth = 6; ctx.strokeStyle = rgba(c, 0.07 * a); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(c, 0.75 * a); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
    // segmented ring, clockwise
    ctx.lineWidth = 2.2; ctx.strokeStyle = rgba(c, 0.55 * a);
    for (let i = 0; i < 6; i++) { const s = this.rot[0] + i * 1.047; ctx.beginPath(); ctx.arc(cx, cy, R * 1.075, s, s + 0.62); ctx.stroke(); }
    // fast inner arcs, counter-clockwise
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(c, 0.6 * a);
    for (let i = 0; i < 3; i++) { const s = this.rot[1] + i * 2.094; ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, s, s + 1.1); ctx.stroke(); }
    // fine tick ring
    ctx.strokeStyle = rgba(c, 0.35 * a); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const ang = this.rot[2] + (i / 120) * 6.283, long = i % 10 === 0;
      const r1 = R * 1.14, r2 = R * (long ? 1.19 : 1.165);
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
    }
    ctx.stroke();
    // outer thin technical arc with a bright runner
    ctx.strokeStyle = rgba(c, 0.25 * a); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.27, this.rot[3], this.rot[3] + 4.2); ctx.stroke();
    const rx = cx + Math.cos(this.rot[3] + 4.2) * R * 1.27, ry = cy + Math.sin(this.rot[3] + 4.2) * R * 1.27;
    ctx.fillStyle = rgba([230, 252, 255], 0.9 * a); ctx.beginPath(); ctx.arc(rx, ry, 2.2, 0, 6.283); ctx.fill();
    // progress ring
    if (this.progressShown > 0.003) {
      const e = -Math.PI / 2 + this.progressShown * 6.283;
      ctx.lineWidth = 7; ctx.strokeStyle = rgba(c, 0.12 * a); ctx.beginPath(); ctx.arc(cx, cy, R * 1.03, -Math.PI / 2, e); ctx.stroke();
      ctx.lineWidth = 2.4; ctx.strokeStyle = rgba([220, 250, 255], 0.85 * a); ctx.beginPath(); ctx.arc(cx, cy, R * 1.03, -Math.PI / 2, e); ctx.stroke();
    }
    // orbiting particles
    for (const o of this.orbits) {
      o.a += 0.016 * o.w * this.speed;
      const x = cx + Math.cos(o.a) * R * o.r, y = cy + Math.sin(o.a) * R * o.r;
      ctx.fillStyle = rgba(c, 0.55 * a); ctx.fillRect(x, y, o.size, o.size);
    }
  }

  private drawBrackets(x: number, y: number, w: number, h: number, a: number, t: number) {
    const ctx = this.ctx, c = this.tint, L = Math.min(w, h) * 0.18;
    ctx.strokeStyle = rgba(c, a * (0.75 + 0.25 * Math.sin(t * 3))); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
    ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
    ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
    ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
    ctx.stroke();
  }

  /** The camera picture, mirrored like a selfie, framed by the same mapping as the landmarks. */
  private drawVideo(v: HTMLVideoElement, cx: number, cy: number, lens: number, R: number, a: number) {
    const ctx = this.ctx, c = this.tint;
    const asp = v.videoWidth / v.videoHeight, k = this.view.k * R;
    const w = asp * k, h = k, x0 = cx - this.view.bx * k, y0 = cy - this.view.by * k;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, lens, 0, 6.283); ctx.clip();
    ctx.globalAlpha = 0.92 * a;
    ctx.filter = "saturate(0.6) contrast(1.08) brightness(0.95)";
    ctx.translate(x0 + w, y0); ctx.scale(-1, 1);
    try { ctx.drawImage(v, 0, 0, w, h); } catch { /* frame not ready */ }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.filter = "none"; ctx.globalAlpha = 1;
    // holographic treatment: a cool tint, faint scan lines, edges fading into the lens
    ctx.fillStyle = rgba(c, 0.13 * a); ctx.fillRect(cx - lens, cy - lens, lens * 2, lens * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.12 * a})`;
    for (let y = cy - lens; y < cy + lens; y += 3) ctx.fillRect(cx - lens, y, lens * 2, 1);
    const edge = ctx.createRadialGradient(cx, cy, lens * 0.62, cx, cy, lens);
    edge.addColorStop(0, "rgba(1,3,9,0)"); edge.addColorStop(1, `rgba(1,3,9,${0.85 * a})`);
    ctx.fillStyle = edge; ctx.fillRect(cx - lens, cy - lens, lens * 2, lens * 2);
    ctx.restore();
  }

  private drawFace(cx: number, cy: number, R: number, a: number, t: number, scanning: boolean) {
    const f = this.face!, ctx = this.ctx, c = this.tint, asp = this.video?.videoWidth ? this.video.videoWidth / this.video.videoHeight : this.faceAspect;
    // the same (smoothed) framing as the camera view, so the hologram sits exactly on your face
    const bw = f.box.w * asp, bh = f.box.h, k = this.view.k * R, bx = this.view.bx, by = this.view.by;
    const P = (i: number) => { const p = f.points[i]; return { x: cx + (p.x * asp - bx) * k, y: cy + (p.y - by) * k }; };
    // with your face visible underneath, the mesh is a touch lighter
    a *= 1 - 0.3 * this.videoAlpha;
    // contours
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.5 * a);
    ctx.beginPath();
    for (const e of this.contours) { const p = P(e.start), q = P(e.end); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    ctx.stroke();
    // mesh points
    ctx.fillStyle = rgba(c, 0.38 * a);
    for (let i = 0; i < f.points.length; i += 3) { const p = P(i); ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2); }
    // a light pulse running along the face outline
    if (this.contours.length) {
      for (let n = 0; n < 2; n++) {
        const idx = Math.floor(((t * 0.35 + n * 0.5) % 1) * this.contours.length);
        const p = P(this.contours[idx].start);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 9);
        g.addColorStop(0, rgba([235, 252, 255], 0.9 * a)); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 6.283); ctx.fill();
      }
    }
    // the face box in lens coords → brackets that lock on
    const x0 = cx + (f.box.x * asp - bx) * k, y0 = cy + (f.box.y - by) * k, w = bw * k, h = bh * k;
    const bcx = x0 + w / 2, bcy = y0 + h / 2;
    const s = this.bracket, pad = 10;
    this.drawBrackets(bcx - (w / 2 + pad) * s, bcy - (h / 2 + pad) * s, (w + pad * 2) * s, (h + pad * 2) * s, (0.85 / (1 - 0.3 * this.videoAlpha)) * a, t);
    if (scanning) {
      // landmark points + the lines between them, appearing as the analysis progresses
      const shown = Math.floor(this.progressShown * 1.4 * KEY_LINKS.length);
      ctx.strokeStyle = rgba(c, 0.55 * a); ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < Math.min(shown, KEY_LINKS.length); i++) { const p = P(KEY_LINKS[i][0]), q = P(KEY_LINKS[i][1]); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
      const pts = Math.floor(this.progressShown * 1.4 * KEY_POINTS.length);
      for (let i = 0; i < Math.min(pts, KEY_POINTS.length); i++) {
        const p = P(KEY_POINTS[i]), pulse = 2.2 + Math.sin(t * 6 + i) * 0.8;
        ctx.fillStyle = rgba([225, 250, 255], 0.9 * a); ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, 6.283); ctx.fill();
        ctx.strokeStyle = rgba(c, 0.5 * a); ctx.beginPath(); ctx.arc(p.x, p.y, pulse + 3.5, 0, 6.283); ctx.stroke();
      }
      // scan line sweeping down and up the face
      const u = (Math.sin(t * 2.6) + 1) / 2, ly = y0 + u * h;
      const g = ctx.createLinearGradient(0, ly - 18, 0, ly + 18);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, rgba(c, 0.32 * a)); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(x0 - 16, ly - 18, w + 32, 36);
      ctx.strokeStyle = rgba([230, 252, 255], 0.75 * a); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x0 - 16, ly); ctx.lineTo(x0 + w + 16, ly); ctx.stroke();
    }
  }
}
