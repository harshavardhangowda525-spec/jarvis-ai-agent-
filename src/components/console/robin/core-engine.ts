/**
 * RUBIN's holographic core — one canvas behind the glass panels. Layered rings
 * that turn at different speeds, a translucent energy sphere with a latitude /
 * longitude lattice, an equator waveform, orbiting data points and an
 * atmospheric glow. The motion follows what Rubin is really doing (qualifying,
 * following up, preparing a quotation…), and data arcs reach out to the CRM
 * chart's stages. One rAF loop, capped pixel ratio, bounded particles, paused
 * while the tab is hidden, calm under prefers-reduced-motion.
 */
import type { CoreState } from "@/lib/robin/types";

export type VoiceMode = "none" | "listening" | "processing" | "speaking";
export interface Pt { x: number; y: number }

interface Orb { r: number; a: number; s: number; tilt: number; size: number; hue: number }
interface Flyer { x0: number; y0: number; x1: number; y1: number; bend: number; t: number; speed: number; hue: number; size: number; trail: Pt[]; done?: () => void; fade?: boolean }
interface Wave { t: number; hue: number; max: number; width: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number }
interface DataLine { x: number; t: number; h: number }

const TAU = Math.PI * 2;
const SPEED: Record<CoreState, number> = {
  idle: 1, listening: 1.2, analyzing: 2.6, processing: 4.2, qualifying: 1.8, contacting: 1.5, following_up: 1.4, demo: 1.2, quotation: 1.3, complete: 1.1, error: 0.6,
};
const H = { cyan: 190, blue: 214, violet: 262, white: 205, amber: 22, green: 158, gray: 220 };

export class RobinCoreEngine {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0; private h = 0;
  private cx = 0; private cy = 0; private R = 120;
  private ax = 0; private ay = 0; // anchor (before parallax)
  private ptx = 0; private pty = 0; private px = 0; private py = 0;
  private raf = 0; private last = 0; private time = 0;
  private speed = 1; private targetSpeed = 1;
  private energy = 0.75; private targetEnergy = 0.75;
  state: CoreState = "idle";
  private stateAt = 0;
  private voice: VoiceMode = "none"; private level = 0; private sLevel = 0;
  private rot = { outer: 0, seg: 0, inner: 0, scan: 0, sphere: 0, demo: 0, quote: 0 };
  private orbs: Orb[] = [];
  private flyers: Flyer[] = [];
  private waves: Wave[] = [];
  private sparks: Spark[] = [];
  private lines: DataLine[] = [];
  private card = 0; // quotation document card reveal 0..1
  private demoForm = 0; private quoteForm = 0;
  private reduced = false; private hidden = false;
  private bootStart = 0; private bootMs = 2600;
  private push = 0; // voice "push forward"
  private links: Pt[] = []; // side panels wired to the core
  private beam = 0; // radar beam strength
  private comets = [0, 2.1, 4.2];
  private notify = 0; // follow-up notification orbit 0..1

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (let i = 0; i < (this.reduced ? 30 : 84); i++) {
      this.orbs.push({ r: 1.1 + Math.random() * 0.75, a: Math.random() * TAU, s: (0.04 + Math.random() * 0.12) * (Math.random() < 0.5 ? -1 : 1), tilt: 0.28 + Math.random() * 0.5, size: 0.6 + Math.random() * 1.5, hue: Math.random() < 0.15 ? H.violet : Math.random() < 0.5 ? H.cyan : H.blue });
    }
    document.addEventListener("visibilitychange", this.onVis);
    this.resize();
  }

  private onVis = () => { this.hidden = document.hidden; if (!this.hidden) { this.last = performance.now(); this.loop(); } };

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  setAnchor(x: number, y: number, r: number) { this.ax = x; this.ay = y; this.R = Math.max(40, r); if (!this.cx) { this.cx = x; this.cy = y; } }
  center(): Pt { return { x: this.cx, y: this.cy }; }
  /** Points (screen coords) that are wired to the core with faint flowing light — the side panels. */
  setLinks(pts: Pt[]) { this.links = pts; }
  pointer(x: number, y: number) { this.ptx = (x / Math.max(this.w, 1) - 0.5) * 2; this.pty = (y / Math.max(this.h, 1) - 0.5) * 2; }

  setState(s: CoreState) {
    if (s === this.state) return;
    this.state = s; this.stateAt = this.time;
    this.targetSpeed = SPEED[s];
    this.targetEnergy = s === "idle" ? 0.75 : s === "error" ? 0.6 : 1;
    if (s === "complete") this.ripple(H.cyan, 2.6);
  }
  setVoice(mode: VoiceMode, level: number) { this.voice = mode; this.level = Math.max(0, Math.min(1, level || 0)); }
  boot(ms = 2600) { this.bootStart = this.time; this.bootMs = ms; }

  /** An expanding ring from the core (complete, won, new data). */
  ripple(hue = H.cyan, max = 2.4, width = 1.6) { this.waves.push({ t: 0, hue, max, width }); }

  /** A data particle from one point to another along an arc (core → CRM stage or back). */
  emit(from: Pt, to: Pt, o: { hue?: number; size?: number; speed?: number; bend?: number; done?: () => void; fade?: boolean } = {}) {
    if (this.flyers.length > 120) return;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.flyers.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, bend: o.bend ?? (Math.random() < 0.5 ? -1 : 1) * Math.min(160, dist * 0.28), t: 0, speed: o.speed ?? Math.max(0.55, 900 / Math.max(dist, 200) * 0.45), hue: o.hue ?? H.cyan, size: o.size ?? 2.2, trail: [], done: o.done, fade: o.fade });
  }
  /** Lead data entering the core (from DARWIN's side) — qualifying. */
  intake(from: Pt, n = 6) {
    for (let i = 0; i < n; i++) setTimeout(() => this.emit(from, this.center(), { hue: i % 3 ? H.blue : H.violet, size: 1.8, speed: 0.9, bend: (i % 2 ? 1 : -1) * 70 }), i * 110);
  }

  /**
   * The signature "Sales Intelligence Pulse": core flash → concentric rings
   * expand → data arcs reach every CRM stage → particles travel → stages update
   * (onArrive per target) → core settles back to idle.
   */
  pulse(targets: Pt[], onArrive?: (i: number) => void) {
    this.ripple(H.cyan, 2.2, 2.2);
    setTimeout(() => this.ripple(H.blue, 3.0, 1.4), 160);
    setTimeout(() => this.ripple(H.violet, 3.8, 1), 320);
    targets.forEach((t, i) => setTimeout(() => this.emit(this.center(), t, { hue: i % 2 ? H.blue : H.cyan, size: 2.4, speed: 1.1, bend: (i - targets.length / 2) * 18, done: () => onArrive?.(i) }), 260 + i * 70));
  }

  start() { this.last = performance.now(); this.loop(); }
  stop() { cancelAnimationFrame(this.raf); document.removeEventListener("visibilitychange", this.onVis); }

  private loop = () => {
    if (this.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.time += dt;
    const k = this.reduced ? 0.35 : 1;
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 2.5);
    this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt * 2);
    this.sLevel += (this.level - this.sLevel) * Math.min(1, dt * (this.voice === "speaking" ? 9 : 14));
    this.push += ((this.voice === "listening" ? 1 : this.voice === "speaking" ? 0.6 : 0) - this.push) * Math.min(1, dt * 3);
    // parallax + smooth follow of the anchor
    this.px += (this.ptx - this.px) * Math.min(1, dt * 2); this.py += (this.pty - this.py) * Math.min(1, dt * 2);
    this.cx += (this.ax + this.px * 10 - this.cx) * Math.min(1, dt * 6);
    this.cy += (this.ay + this.py * 6 - this.cy) * Math.min(1, dt * 6);
    const s = this.speed * k;
    this.rot.outer += dt * 0.05 * s;
    this.rot.seg -= dt * 0.11 * s;
    this.rot.inner += dt * 0.32 * s;
    this.rot.scan += dt * (this.state === "analyzing" ? 3.4 : 0.9) * k;
    this.rot.sphere += dt * 0.12 * s;
    this.rot.demo += dt * 0.25 * k; this.rot.quote -= dt * 0.18 * k;
    this.demoForm += ((this.state === "demo" ? 1 : 0) - this.demoForm) * Math.min(1, dt * 2.2);
    this.quoteForm += ((this.state === "quotation" ? 1 : 0) - this.quoteForm) * Math.min(1, dt * 2.2);
    this.card += ((this.state === "quotation" ? 1 : 0) - this.card) * Math.min(1, dt * 1.6);
    for (const o of this.orbs) o.a += dt * o.s * s * (this.state === "analyzing" || this.state === "processing" ? 2.4 : 1);
    const wantBeam = this.state === "analyzing" ? 1 : this.state === "processing" ? 0.7 : this.state === "qualifying" ? 0.6 : 0.22;
    this.beam += (wantBeam - this.beam) * Math.min(1, dt * 2);
    for (let i = 0; i < this.comets.length; i++) this.comets[i] += dt * (0.5 + i * 0.12) * s;
    this.notify += ((this.state === "following_up" || this.state === "contacting" ? 1 : 0) - this.notify) * Math.min(1, dt * 2.5);
    for (const f of this.flyers) {
      f.t += dt * f.speed;
      const p = this.bez(f, Math.min(1, f.t));
      f.trail.push(p); if (f.trail.length > 14) f.trail.shift();
      if (f.t >= 1 && f.done) { const d = f.done; f.done = undefined; d(); this.burst(f.x1, f.y1, f.hue, 7); }
    }
    this.flyers = this.flyers.filter((f) => f.t < 1.25);
    for (const w of this.waves) w.t += dt * 0.55;
    this.waves = this.waves.filter((w) => w.t < 1);
    for (const p of this.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life += dt; }
    this.sparks = this.sparks.filter((p) => p.life < p.max);
    // analyzing: thin vertical data lines flicker around the core
    if ((this.state === "analyzing" || this.state === "processing") && !this.reduced && Math.random() < dt * (this.state === "processing" ? 22 : 14)) this.lines.push({ x: (Math.random() - 0.5) * this.R * 3.2, t: 0, h: this.R * (0.4 + Math.random() * 1.2) });
    for (const l of this.lines) l.t += dt * 2.2;
    this.lines = this.lines.filter((l) => l.t < 1);
    // following up: communication pulses travel outward
    if (this.state === "following_up" && !this.reduced && Math.random() < dt * 1.3) this.ripple(H.blue, 2.0, 1);
    if (this.state === "contacting" && !this.reduced && Math.random() < dt * 0.9) this.ripple(H.cyan, 1.8, 0.9);
    // processing: data streams round the core
    if (this.state === "processing" && !this.reduced && Math.random() < dt * 5 && this.flyers.length < 60) {
      const a = Math.random() * TAU, b = a + (Math.random() < 0.5 ? 1 : -1) * (1 + Math.random());
      const r0 = this.R * 1.5;
      this.emit({ x: this.cx + Math.cos(a) * r0, y: this.cy + Math.sin(a) * r0 }, { x: this.cx + Math.cos(b) * r0, y: this.cy + Math.sin(b) * r0 }, { hue: Math.random() < 0.3 ? H.violet : H.cyan, size: 1.6, speed: 1.6, bend: -this.R * 0.6, fade: true });
    }
    // error: a controlled warning pulse
    if (this.state === "error" && !this.reduced && Math.random() < dt * 1.2) this.ripple(H.amber, 1.7, 1.2);
  }

  private bez(f: Flyer, t: number): Pt {
    const mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2;
    const nx = -(f.y1 - f.y0), ny = f.x1 - f.x0; const nl = Math.hypot(nx, ny) || 1;
    const cx = mx + (nx / nl) * f.bend, cy = my + (ny / nl) * f.bend;
    const u = 1 - t;
    return { x: u * u * f.x0 + 2 * u * t * cx + t * t * f.x1, y: u * u * f.y0 + 2 * u * t * cy + t * t * f.y1 };
  }
  private burst(x: number, y: number, hue: number, n: number) {
    if (this.reduced) return;
    for (let i = 0; i < n && this.sparks.length < 160; i++) {
      const a = Math.random() * TAU, v = 30 + Math.random() * 70;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.5 + Math.random() * 0.5, hue });
    }
  }

  private col(h: number, a: number, l = 72, s = 90) { return `hsla(${h}, ${s}%, ${l}%, ${Math.max(0, Math.min(1, a))})`; }

  private draw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    const boot = Math.min(1, (this.time - this.bootStart) / (this.bootMs / 1000));
    const ease = 1 - Math.pow(1 - boot, 3);
    const breathe = 1 + Math.sin(this.time * (this.state === "idle" ? 0.9 : 1.6)) * (this.reduced ? 0.004 : 0.014);
    const listening = this.voice === "listening" || this.state === "listening";
    const listen = (this.voice === "listening" ? 0.04 + this.sLevel * 0.06 : this.voice === "speaking" ? this.sLevel * 0.05 : 0) + (listening && !this.reduced ? Math.sin(this.time * 3.2) * 0.03 : 0);
    const R = this.R * breathe * (1 + listen + this.push * 0.015) * (0.6 + 0.4 * ease);
    const { cx, cy } = this;
    const E = this.energy * (0.3 + 0.7 * ease);
    const warn = this.state === "error" ? 0.5 + 0.5 * Math.sin(this.time * 7) : 0;
    const baseHue = this.state === "error" ? H.amber : H.cyan;

    c.save();
    c.globalCompositeOperation = "lighter";
    // ---- atmosphere
    const atm = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 3.2);
    atm.addColorStop(0, this.col(H.blue, 0.24 * E, 55));
    atm.addColorStop(0.45, this.col(H.violet, 0.05 * E, 50, 70));
    atm.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = atm; c.beginPath(); c.arc(cx, cy, R * 3.2, 0, TAU); c.fill();

    // ---- light lines from the side panels into the core
    for (let i = 0; i < this.links.length; i++) {
      const p = this.links[i];
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const ex = cx + Math.cos(ang) * R * 1.8, ey = cy + Math.sin(ang) * R * 1.8;
      const mx = (p.x + ex) / 2, my = p.y + (ey - p.y) * 0.15;
      const lg = c.createLinearGradient(p.x, p.y, ex, ey);
      lg.addColorStop(0, this.col(H.cyan, 0.04 * ease)); lg.addColorStop(1, this.col(H.cyan, 0.2 * E));
      c.strokeStyle = lg; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(p.x, p.y); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
      if (!this.reduced) {
        const t = (this.time * 0.22 + i * 0.37) % 1, u = 1 - t;
        const qx = u * u * p.x + 2 * u * t * mx + t * t * ex, qy = u * u * p.y + 2 * u * t * my + t * t * ey;
        this.dot(qx, qy, 1.4, this.col(H.cyan, 0.75 * Math.sin(t * Math.PI) * E, 80));
      }
    }
    // ---- side waveforms (both sides of the core)
    if (ease > 0.3) {
      const amp0 = (this.voice !== "none" ? 0.1 + this.sLevel * 0.6 : this.state === "idle" ? 0.05 : 0.12) * R * 0.45;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          c.beginPath();
          for (let i = 0; i <= 70; i++) {
            const u = i / 70, x = cx + side * (R * 1.85 + u * R * 1.6);
            const env = Math.sin(u * Math.PI) * (1 - u * 0.55);
            const y = cy + Math.sin(u * (18 + k * 5) - this.time * (3 + k * 1.4) * side + k) * amp0 * env * (1 - k * 0.28) * (0.6 + 0.4 * Math.sin(this.time * 1.3 + u * 6));
            i ? c.lineTo(x, y) : c.moveTo(x, y);
          }
          c.strokeStyle = this.col(k === 2 ? H.violet : k ? H.blue : H.cyan, (k ? 0.22 : 0.45) * E * ease); c.lineWidth = k ? 0.7 : 1; c.stroke();
        }
      }
    }
    // ---- radial scanning beam (a radar wedge — strong while analyzing)
    if (c.createConicGradient && this.beam > 0.03) {
      const a0 = this.rot.scan * (this.state === "analyzing" ? 0.42 : 0.3) - Math.PI / 2;
      const bg = c.createConicGradient(a0, cx, cy);
      bg.addColorStop(0, this.col(H.cyan, 0.32 * this.beam * E));
      bg.addColorStop(0.09, this.col(H.cyan, 0.0));
      bg.addColorStop(0.97, this.col(H.cyan, 0.0));
      bg.addColorStop(1, this.col(H.cyan, 0.32 * this.beam * E));
      c.fillStyle = bg;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R * 1.55, a0 - 0.2, a0 + 0.6); c.closePath(); c.fill();
      // the beam's leading edge
      c.strokeStyle = this.col(H.cyan, 0.5 * this.beam * E); c.lineWidth = 1;
      c.beginPath(); c.moveTo(cx + Math.cos(a0) * R * 0.8, cy + Math.sin(a0) * R * 0.8); c.lineTo(cx + Math.cos(a0) * R * 1.55, cy + Math.sin(a0) * R * 1.55); c.stroke();
    }

    // ---- outer orbital ring (thin) with orbiting markers
    c.lineWidth = 1;
    c.strokeStyle = this.col(baseHue, (0.34 + warn * 0.2) * E);
    this.arc(cx, cy, R * 1.72 * (0.85 + 0.15 * ease), this.rot.outer, this.rot.outer + TAU * ease);
    // a soft bloom ring just inside it
    c.strokeStyle = this.col(H.blue, 0.08 * E); c.lineWidth = 8;
    this.arc(cx, cy, R * 1.66, 0, TAU * ease);
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = this.rot.outer * 3 + (i * TAU) / 3;
      this.dot(cx + Math.cos(a) * R * 1.72, cy + Math.sin(a) * R * 1.72, 1.8, this.col(H.cyan, 0.8 * E));
    }
    // outer scanning sweep (bright arc that runs round the outer ring)
    const sweep = this.rot.scan * 0.6;
    const g = c.createConicGradient ? c.createConicGradient(sweep, cx, cy) : null;
    if (g) {
      g.addColorStop(0, this.col(H.cyan, 0.0)); g.addColorStop(0.08, this.col(H.cyan, 0.55 * E)); g.addColorStop(0.1, this.col(H.cyan, 0)); g.addColorStop(1, this.col(H.cyan, 0));
      c.strokeStyle = g; c.lineWidth = 2.2;
      this.arc(cx, cy, R * 1.55, 0, TAU);
    }

    // ---- segmented ring
    const segs = 64, gap = 0.35;
    c.lineWidth = 3;
    for (let i = 0; i < segs * ease; i++) {
      const a0 = this.rot.seg + (i / segs) * TAU, a1 = a0 + (TAU / segs) * (1 - gap);
      const lit = (Math.sin(this.time * 1.2 + i * 0.7) + 1) / 2;
      c.strokeStyle = this.col(i % 9 === 0 ? H.violet : H.blue, (0.12 + lit * 0.18) * E);
      this.arc(cx, cy, R * 1.36, a0, a1);
    }
    // tick ring
    c.lineWidth = 1;
    for (let i = 0; i < 120 * ease; i++) {
      const a = -this.rot.seg * 0.5 + (i / 120) * TAU, len = i % 10 === 0 ? 8 : 3;
      c.strokeStyle = this.col(H.white, (i % 10 === 0 ? 0.35 : 0.14) * E, 80, 30);
      c.beginPath(); c.moveTo(cx + Math.cos(a) * R * 1.45, cy + Math.sin(a) * R * 1.45); c.lineTo(cx + Math.cos(a) * (R * 1.45 + len), cy + Math.sin(a) * (R * 1.45 + len)); c.stroke();
    }

    // ---- data particles travelling round the circumference (with trails)
    if (!this.reduced) {
      for (let i = 0; i < this.comets.length; i++) {
        const rr = R * (i === 1 ? 1.36 : i === 2 ? 1.12 : 1.55), a = this.comets[i] * (i % 2 ? -1 : 1);
        for (let j = 0; j < 12; j++) {
          const aa = a - (i % 2 ? -1 : 1) * j * 0.035;
          this.dot(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, 1.8 * (1 - j / 12), this.col(i === 1 ? H.violet : H.cyan, 0.8 * (1 - j / 12) * E, 80));
        }
      }
    }
    // ---- follow-up: notification particles orbit the core, pinging
    if (this.notify > 0.03) {
      for (let i = 0; i < 6; i++) {
        const a = this.time * 0.7 + (i * TAU) / 6, rr = R * 1.28;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.92;
        const ph = (this.time * 1.4 + i * 0.37) % 1;
        this.dot(x, y, 2.4, this.col(H.blue, 0.85 * this.notify, 78));
        c.strokeStyle = this.col(H.cyan, (1 - ph) * 0.6 * this.notify); c.lineWidth = 1;
        this.arc(x, y, 3 + ph * 9, 0, TAU);
      }
    }

    // ---- rotating inner ring (two counter-rotating arcs + recalculating segments)
    c.lineWidth = 2;
    c.strokeStyle = this.col(H.cyan, 0.5 * E);
    this.arc(cx, cy, R * 1.12, this.rot.inner, this.rot.inner + TAU * 0.32);
    this.arc(cx, cy, R * 1.12, this.rot.inner + Math.PI, this.rot.inner + Math.PI + TAU * 0.18);
    c.lineWidth = 1;
    c.strokeStyle = this.col(H.blue, 0.3 * E);
    this.arc(cx, cy, R * 1.05, -this.rot.inner * 1.3, -this.rot.inner * 1.3 + TAU * 0.6);
    if (this.state === "analyzing") {
      for (let k = 0; k < 3; k++) {
        c.strokeStyle = this.col(k === 1 ? H.violet : H.cyan, 0.55);
        c.lineWidth = 1.5;
        const a = this.rot.scan * (1 + k * 0.35) + k * 2;
        this.arc(cx, cy, R * (1.2 + k * 0.1), a, a + 0.6);
      }
    }

    // ---- fine scanning arc
    c.lineWidth = 1.4;
    c.strokeStyle = this.col(H.cyan, 0.75 * E);
    this.arc(cx, cy, R * 0.92, this.rot.scan, this.rot.scan + 0.5);

    // ---- demo: a structured hexagonal ring forms
    if (this.demoForm > 0.02) {
      c.strokeStyle = this.col(H.green, 0.55 * this.demoForm);
      c.lineWidth = 1.4;
      this.poly(cx, cy, R * 1.25 * (0.8 + 0.2 * this.demoForm), 6, this.rot.demo, this.demoForm);
      this.poly(cx, cy, R * 1.18, 6, -this.rot.demo + 0.5, this.demoForm * 0.7);
    }
    // ---- quotation: geometric layers
    if (this.quoteForm > 0.02) {
      c.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        c.strokeStyle = this.col(k === 1 ? H.violet : H.cyan, 0.4 * this.quoteForm);
        this.poly(cx, cy, R * (0.98 + k * 0.1), k === 1 ? 3 : 4, this.rot.quote * (1 + k * 0.4) + k, this.quoteForm);
      }
    }

    // ---- energy sphere
    c.globalCompositeOperation = "source-over";
    const sR = R * 0.78;
    const body = c.createRadialGradient(cx - sR * 0.35, cy - sR * 0.4, sR * 0.05, cx, cy, sR);
    body.addColorStop(0, `rgba(226,236,248,${0.32 * E + 0.06})`);
    body.addColorStop(0.45, `rgba(120,140,170,${0.22 * E + 0.05})`);
    body.addColorStop(1, `rgba(20,30,48,${0.55 * E})`);
    c.fillStyle = body; c.beginPath(); c.arc(cx, cy, sR, 0, TAU); c.fill();
    c.globalCompositeOperation = "lighter";
    // lattice: latitudes + rotating longitudes (a holographic globe)
    c.lineWidth = 0.6;
    for (let i = 1; i < 7; i++) {
      const y = -sR + (i / 7) * 2 * sR, rr = Math.sqrt(Math.max(0, sR * sR - y * y));
      c.strokeStyle = this.col(H.white, 0.07 * E, 85, 30);
      c.beginPath(); c.ellipse(cx, cy + y, rr, rr * 0.18, 0, 0, TAU); c.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = this.rot.sphere + (i / 8) * Math.PI;
      const rx = Math.abs(Math.cos(a)) * sR;
      c.strokeStyle = this.col(H.blue, (0.05 + 0.08 * Math.abs(Math.sin(a))) * E, 80, 50);
      c.beginPath(); c.ellipse(cx, cy, Math.max(0.5, rx), sR, 0, 0, TAU); c.stroke();
    }
    // rim light + inner glow
    c.strokeStyle = this.col(H.cyan, 0.35 * E + warn * 0.3); c.lineWidth = 1.2;
    this.arc(cx, cy, sR, 0, TAU);
    const core = c.createRadialGradient(cx, cy, 0, cx, cy, sR * 0.9);
    core.addColorStop(0, this.col(H.cyan, 0.1 * E + this.sLevel * 0.15 + (this.state === "complete" ? 0.12 : 0)));
    core.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = core; c.beginPath(); c.arc(cx, cy, sR * 0.9, 0, TAU); c.fill();

    // ---- glass: a soft specular arc and lens ring (refraction)
    c.strokeStyle = "rgba(255,255,255,0.10)"; c.lineWidth = 2;
    this.arc(cx, cy, sR * 0.93, Math.PI * 1.08, Math.PI * 1.42);
    c.strokeStyle = this.col(H.white, 0.05 * E, 90, 20); c.lineWidth = 6;
    this.arc(cx, cy, sR * 1.02, 0, TAU);
    // processing: a scan line sweeps the sphere top to bottom
    if (this.state === "processing" || this.state === "analyzing") {
      const t = (this.time * (this.state === "processing" ? 1.4 : 0.7)) % 1;
      const yy = cy - sR + t * 2 * sR, half = Math.sqrt(Math.max(0, sR * sR - (yy - cy) ** 2));
      c.strokeStyle = this.col(H.cyan, 0.55 * Math.sin(t * Math.PI)); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(cx - half, yy); c.lineTo(cx + half, yy); c.stroke();
    }
    // complete: a brief confirmation tick, then back to idle
    if (this.state === "complete") {
      const t = this.time - this.stateAt;
      if (t < 1.6) {
        const draw = Math.min(1, t / 0.45), fade = t > 1.1 ? 1 - (t - 1.1) / 0.5 : 1;
        // above the RUBIN wordmark
        const ty = cy - sR * 0.52, k = 0.5;
        const pts: Pt[] = [{ x: cx - sR * 0.28 * k, y: ty + sR * 0.02 * k }, { x: cx - sR * 0.06 * k, y: ty + sR * 0.24 * k }, { x: cx + sR * 0.32 * k, y: ty - sR * 0.2 * k }];
        c.strokeStyle = this.col(H.green, 0.9 * fade, 70); c.lineWidth = 2.4; c.lineCap = "round";
        c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
        const seg1 = Math.min(1, draw * 2.2);
        c.lineTo(pts[0].x + (pts[1].x - pts[0].x) * seg1, pts[0].y + (pts[1].y - pts[0].y) * seg1);
        if (draw > 0.45) { const s2 = (draw - 0.45) / 0.55; c.lineTo(pts[1].x + (pts[2].x - pts[1].x) * s2, pts[1].y + (pts[2].y - pts[1].y) * s2); }
        c.stroke(); c.lineCap = "butt";
      }
    }

    // ---- equator waveform (reacts to the voice)
    const amp = (this.voice === "none" ? 0.04 + 0.02 * Math.sin(this.time * 0.7) : 0.08 + this.sLevel * 0.55) * R * 0.5;
    const span = R * 2.4;
    for (let k = 0; k < 2; k++) {
      c.beginPath();
      for (let i = 0; i <= 90; i++) {
        const u = i / 90, x = cx - span / 2 + u * span;
        const env = Math.sin(u * Math.PI) ** 2;
        const y = cy + Math.sin(u * 22 + this.time * (4 + k * 2.3) + k) * amp * env * (k ? 0.6 : 1) * Math.sin(u * 7 + this.time * 1.7);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.strokeStyle = this.col(k ? H.violet : H.cyan, (k ? 0.35 : 0.7) * E); c.lineWidth = k ? 0.8 : 1.3; c.stroke();
    }
    // listening: a circular waveform hugs the outer ring + a travelling indicator
    if (this.voice === "listening" || this.voice === "speaking") {
      const rr = R * 1.62;
      c.beginPath();
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * TAU;
        const d = (Math.sin(a * 9 + this.time * 7) * 0.5 + Math.sin(a * 23 - this.time * 11) * 0.5) * this.sLevel * R * (this.voice === "speaking" ? 0.08 : 0.14);
        const x = cx + Math.cos(a) * (rr + d), y = cy + Math.sin(a) * (rr + d);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.strokeStyle = this.col(this.voice === "speaking" ? H.blue : H.cyan, 0.55); c.lineWidth = 1.2; c.stroke();
      const a = this.time * 2.2;
      this.dot(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.6, this.col(H.cyan, 0.95));
    }

    // ---- orbiting data points
    for (const o of this.orbs) {
      const x = cx + Math.cos(o.a) * R * o.r, y = cy + Math.sin(o.a) * R * o.r * o.tilt;
      const front = Math.sin(o.a) > 0;
      this.dot(x, y, o.size * (front ? 1 : 0.7), this.col(o.hue, (front ? 0.75 : 0.3) * E));
    }
    // ---- data lines (analyzing)
    c.lineWidth = 1;
    for (const l of this.lines) {
      c.strokeStyle = this.col(H.cyan, 0.4 * Math.sin(l.t * Math.PI));
      c.beginPath(); c.moveTo(cx + l.x, cy - l.h / 2); c.lineTo(cx + l.x, cy + l.h / 2); c.stroke();
    }
    // ---- quotation document card emerging from the core
    if (this.card > 0.02) {
      const cw = R * 0.9, ch = R * 1.15;
      const yy = cy - R * 0.2 - this.card * R * 0.55;
      c.save();
      c.translate(cx, yy);
      c.transform(1, 0, -0.12 * (1 - this.card), 1, 0, 0);
      c.globalAlpha = Math.min(1, this.card * 1.2) * 0.9;
      c.strokeStyle = this.col(H.cyan, 0.7); c.lineWidth = 1;
      c.fillStyle = "rgba(14,30,48,0.35)";
      c.beginPath(); c.rect(-cw / 2, -ch / 2, cw, ch); c.fill(); c.stroke();
      for (let i = 0; i < 6; i++) {
        const show = Math.max(0, Math.min(1, this.card * 7 - i));
        c.fillStyle = this.col(i === 0 ? H.cyan : H.white, 0.55 * show, 80, 40);
        c.fillRect(-cw / 2 + 10, -ch / 2 + 14 + i * (ch / 8), (cw - 20) * (i === 0 ? 0.6 : i === 5 ? 0.45 : 0.85) * show, i === 0 ? 4 : 2);
      }
      c.restore();
    }
    // ---- expanding waves
    for (const w of this.waves) {
      c.strokeStyle = this.col(w.hue, (1 - w.t) * 0.55);
      c.lineWidth = w.width * (1 - w.t * 0.6);
      this.arc(cx, cy, R * (0.8 + w.t * w.max), 0, TAU);
    }
    // ---- data arcs + particles (core ↔ CRM)
    for (const f of this.flyers) {
      const t = Math.min(1, f.t);
      const alpha = f.t > 1 ? 1 - (f.t - 1) / 0.25 : 1;
      // the arc itself, drawn faintly while the particle travels
      c.beginPath();
      for (let i = 0; i <= 24; i++) { const p = this.bez(f, (i / 24) * t); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
      c.strokeStyle = this.col(f.hue, 0.16 * alpha * (f.fade ? 0.5 : 1)); c.lineWidth = 1; c.stroke();
      for (let i = 0; i < f.trail.length; i++) this.dot(f.trail[i].x, f.trail[i].y, f.size * (i / f.trail.length), this.col(f.hue, (i / f.trail.length) * 0.5 * alpha));
      const p = this.bez(f, t);
      this.dot(p.x, p.y, f.size, this.col(f.hue, 0.95 * alpha, 80));
    }
    for (const s of this.sparks) this.dot(s.x, s.y, 1.2, this.col(s.hue, 1 - s.life / s.max));
    c.restore();
  }

  private arc(x: number, y: number, r: number, a0: number, a1: number) { this.ctx.beginPath(); this.ctx.arc(x, y, Math.max(0.5, r), a0, a1); this.ctx.stroke(); }
  private dot(x: number, y: number, r: number, fill: string) { const c = this.ctx; c.fillStyle = fill; c.beginPath(); c.arc(x, y, Math.max(0.3, r), 0, TAU); c.fill(); }
  private poly(x: number, y: number, r: number, n: number, rot: number, reveal: number) {
    const c = this.ctx;
    c.beginPath();
    const steps = Math.max(1, Math.round(n * reveal));
    for (let i = 0; i <= steps; i++) { const a = rot + (i / n) * TAU; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
  }
}
