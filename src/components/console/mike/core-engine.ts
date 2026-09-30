/**
 * MIKE's holographic core — one full-screen canvas behind the glass panels.
 * Pure 2D canvas (GPU-composited), a single rAF loop, capped pixel ratio and a
 * bounded particle budget, paused while the tab is hidden. Every number it
 * draws is handed in from real market data; with none, it draws no numbers.
 */

export type CoreState = "idle" | "scanning" | "analyzing" | "validating" | "alert" | "no_trade" | "complete";
export type VoiceMode = "none" | "listening" | "processing" | "speaking";
export interface OrbitLabel { label: string; value?: string; up?: boolean | null }
export interface RingSpec { label: string; state: "pass" | "fail" | "neutral" | "unavailable" }
interface MiniCandle { o: number; h: number; l: number; c: number }

interface Dot { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number }
interface Token {
  label: string; t: number; speed: number;
  x0: number; y0: number; cx1: number; cy1: number;
  fate: "enter" | "drop" | "unknown"; dropAt: number; dead: boolean; hue: number;
}
interface Flyer { x0: number; y0: number; x1: number; y1: number; t: number; speed: number; bend: number; hue: number; size: number }
interface Layer { label: string; start: number; dur: number; from: number }
interface Ring { label: string; state: RingSpec["state"]; at: number }
interface Wave { t: number; hue: number; max: number }

const TAU = Math.PI * 2;
const SPEED: Record<CoreState, number> = { idle: 1, scanning: 2.3, analyzing: 1.7, validating: 1.35, alert: 2, no_trade: 0.4, complete: 1.1 };
const HUE = { cyan: 188, blue: 212, white: 200, red: 350, amber: 38, green: 160 };
const RING_HUE: Record<RingSpec["state"], number> = { pass: 176, fail: 350, neutral: 38, unavailable: 220 };

export class MikeCoreEngine {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0; private h = 0;
  private cx = 0; private cy = 0; private R = 120;
  private px = -999; private py = -999; private tpx = 0; private tpy = 0;
  private raf = 0; private last = 0; private time = 0; private rot = 0;
  private speed = 1; private targetSpeed = 1;
  state: CoreState = "idle";
  private voice: VoiceMode = "none"; private level = 0; private smoothLevel = 0;
  private field: Dot[] = [];
  private bursts: Dot[] = [];
  private orbitDots: { r: number; a: number; s: number; tilt: number; size: number }[] = [];
  private labels: OrbitLabel[] = [];
  private candles: MiniCandle[] = []; private reveal = 0;
  private tokens: Token[] = []; private scanUntil = 0; private scanPool: string[] = [];
  private flyers: Flyer[] = [];
  private layerQ: Layer[] = [];
  private rings: Ring[] = []; private ringsBorn = 0;
  private waves: Wave[] = [];
  private reduced = false;
  private hidden = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    for (let i = 0; i < (this.reduced ? 40 : 110); i++) this.field.push(this.fieldDot(true));
    for (let i = 0; i < (this.reduced ? 60 : 170); i++) {
      this.orbitDots.push({ r: 1.25 + Math.random() * 0.75, a: Math.random() * TAU, s: (0.12 + Math.random() * 0.35) * (Math.random() < 0.5 ? -1 : 1), tilt: [0.28, 0.42, -0.3, 0.6][i % 4], size: 0.5 + Math.random() * 1.3 });
    }
    document.addEventListener("visibilitychange", this.onVis);
  }

  private onVis = () => { this.hidden = document.hidden; if (!this.hidden) { this.last = performance.now(); this.loop(); } };

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
  }
  setAnchor(x: number, y: number, r: number) { this.cx = x; this.cy = y; this.R = Math.max(50, r); }
  pointer(x: number, y: number) { this.tpx = x; this.tpy = y; if (this.px < -900) { this.px = x; this.py = y; } }

  setState(s: CoreState) {
    if (s === this.state) return;
    this.state = s;
    this.targetSpeed = SPEED[s];
    if (s === "complete") this.pulse(HUE.cyan);
    if (s === "alert") { this.pulse(HUE.cyan); this.pulse(HUE.white, 250); }
    if (s === "no_trade") this.pulse(HUE.amber);
    if (s === "idle") { this.rings = []; }
  }
  setVoice(mode: VoiceMode, level: number) { this.voice = mode; this.level = Math.max(0, Math.min(1, level)); }
  setLabels(l: OrbitLabel[]) { this.labels = l.slice(0, 14); }
  setCandles(c: MiniCandle[], replay = false) { this.candles = c.slice(-42); if (replay) this.reveal = 0; }

  /** SCAN: symbols stream in through the data tunnel toward the core. */
  scanStart(symbols: string[], ms = 6000) {
    this.scanPool = symbols.length ? symbols : ["MARKET"];
    this.scanUntil = performance.now() + ms;
    this.setState("scanning");
  }
  /** FILTER: weak symbols dissolve mid-flight, candidates continue into the core. */
  scanResult(keep: string[], drop: string[]) {
    const k = new Set(keep.map((s) => s.toUpperCase())), d = new Set(drop.map((s) => s.toUpperCase()));
    for (const t of this.tokens) {
      const key = t.label.toUpperCase();
      if (d.has(key)) { t.fate = "drop"; t.dropAt = Math.min(0.85, t.t + 0.12 + Math.random() * 0.2); }
      else if (k.has(key)) t.fate = "enter";
    }
    this.scanPool = keep.length ? keep : this.scanPool;
    this.scanUntil = performance.now() + 1600;
  }
  /** ANALYZE: each analysis layer travels into the core. */
  layers(labels: string[], stepMs = 520) {
    const now = performance.now();
    this.layerQ = labels.map((label, i) => ({ label, start: now + i * stepMs, dur: 1100, from: i % 2 === 0 ? -1 : 1 }));
    this.setState("analyzing");
  }
  /** VALIDATE: verification rings activate one after another. */
  validate(specs: RingSpec[], stepMs = 420) {
    const now = performance.now();
    this.ringsBorn = now;
    this.rings = specs.map((s, i) => ({ label: s.label, state: s.state, at: now + 250 + i * stepMs }));
    this.setState("validating");
  }
  /** Data particles leave the core toward a point (the trade sheet). */
  emitTo(x: number, y: number, count = 70, hue: number = HUE.cyan) {
    for (let i = 0; i < (this.reduced ? 16 : count); i++) {
      this.flyers.push({ x0: this.cx + (Math.random() - 0.5) * this.R * 0.4, y0: this.cy + (Math.random() - 0.5) * this.R * 0.4, x1: x + (Math.random() - 0.5) * 60, y1: y + (Math.random() - 0.5) * 120, t: -Math.random() * 0.6, speed: 0.7 + Math.random() * 0.5, bend: (Math.random() - 0.5) * 260, hue, size: 0.8 + Math.random() * 1.6 });
    }
  }
  pulse(hue: number = HUE.cyan, delay = 0) { this.waves.push({ t: -delay / 1000, hue, max: 3.2 }); }

  start() { this.last = performance.now(); this.loop(); }
  destroy() { cancelAnimationFrame(this.raf); document.removeEventListener("visibilitychange", this.onVis); }

  private fieldDot(anywhere = false): Dot {
    return { x: anywhere ? Math.random() * this.w : -10, y: Math.random() * this.h, vx: 4 + Math.random() * 10, vy: (Math.random() - 0.5) * 3, life: 0, max: 1e9, size: Math.random() * 1.2 + 0.2, hue: Math.random() < 0.8 ? HUE.cyan : HUE.blue };
  }

  private loop = () => {
    if (this.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const vmul = this.voice === "processing" ? 2.6 : this.voice === "speaking" ? 1.3 : 1;
    this.speed += (this.targetSpeed * vmul - this.speed) * Math.min(1, dt * 2.2);
    this.rot += dt * 0.35 * this.speed;
    this.smoothLevel += (this.level - this.smoothLevel) * Math.min(1, dt * 12);
    this.px += (this.tpx - this.px) * Math.min(1, dt * 6); this.py += (this.tpy - this.py) * Math.min(1, dt * 6);
    this.draw(now, dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(now: number, dt: number) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    // subtle parallax: the core leans toward the cursor
    const parX = this.px > -900 ? (this.px - this.w / 2) / this.w * 14 : 0;
    const parY = this.px > -900 ? (this.py - this.h / 2) / this.h * 10 : 0;
    const cx = this.cx + parX, cy = this.cy + parY, R = this.R * (1 + Math.sin(this.time * 1.4) * 0.018 + this.smoothLevel * 0.05);

    // cursor-following glow
    if (this.px > -900) {
      const g = ctx.createRadialGradient(this.px, this.py, 0, this.px, this.py, 280);
      g.addColorStop(0, "rgba(56,189,248,0.07)"); g.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = g; ctx.fillRect(this.px - 280, this.py - 280, 560, 560);
    }
    ctx.globalCompositeOperation = "lighter";
    this.drawField(dt);
    if (this.state === "scanning" || this.tokens.length) this.drawScan(now, dt, cx, cy, R);
    this.drawOrbits(cx, cy, R);
    this.drawSphere(cx, cy, R);
    this.drawWaveform(cx, cy, R);
    this.drawLabels(cx, cy, R);
    if (this.candles.length && (this.state === "analyzing" || this.state === "validating" || this.state === "complete" || this.state === "alert" || this.state === "no_trade")) this.drawHoloChart(cx, cy, R, dt);
    this.drawLayers(now, cx, cy, R);
    this.drawRings(now, cx, cy, R);
    this.drawWaves(dt, cx, cy, R);
    this.drawFlyers(dt);
    this.drawBursts(dt);
    ctx.globalCompositeOperation = "source-over";
  }

  private drawField(dt: number) {
    const { ctx } = this;
    const sp = this.state === "scanning" ? 3.5 : this.state === "no_trade" ? 0.7 : 1;
    for (let i = 0; i < this.field.length; i++) {
      const d = this.field[i];
      d.x += d.vx * dt * sp; d.y += d.vy * dt;
      if (d.x > this.w + 10) this.field[i] = this.fieldDot();
      ctx.fillStyle = `hsla(${d.hue},90%,70%,${0.18 + d.size * 0.12})`;
      ctx.fillRect(d.x, d.y, d.size, d.size);
    }
  }

  private drawSphere(cx: number, cy: number, R: number) {
    const { ctx } = this;
    const dim = this.state === "no_trade" ? 0.55 : 1;
    // outer halo
    let g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    g.addColorStop(0, `rgba(34,211,238,${0.16 * dim})`); g.addColorStop(0.45, `rgba(14,116,144,${0.07 * dim})`); g.addColorStop(1, "rgba(8,47,73,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 2.1, 0, TAU); ctx.fill();
    // body
    g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    g.addColorStop(0, `rgba(224,251,255,${0.55 * dim})`); g.addColorStop(0.25, `rgba(103,232,249,${0.32 * dim})`); g.addColorStop(0.7, `rgba(14,165,233,${0.14 * dim})`); g.addColorStop(1, "rgba(12,74,110,0.02)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    // wireframe: meridians + parallels (a slowly turning globe)
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 7; k++) {
      const ph = this.rot * 0.9 + (k / 7) * Math.PI;
      const rx = Math.abs(Math.cos(ph)) * R;
      ctx.strokeStyle = `rgba(125,211,252,${(0.08 + 0.18 * Math.abs(Math.sin(ph))) * dim})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, R, 0, 0, TAU); ctx.stroke();
    }
    for (let k = -2; k <= 2; k++) {
      const yy = cy + (k / 3) * R, rr = Math.sqrt(Math.max(0, R * R - ((k / 3) * R) ** 2));
      ctx.strokeStyle = `rgba(125,211,252,${0.12 * dim})`;
      ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr * 0.18, 0, 0, TAU); ctx.stroke();
    }
    // energy arcs inside
    for (let k = 0; k < 4; k++) {
      const a0 = this.rot * (2.2 + k * 0.6) * (k % 2 ? -1 : 1) + k;
      ctx.strokeStyle = `rgba(165,243,252,${0.35 * dim})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.35 + k * 0.12), a0, a0 + 0.9 + k * 0.2); ctx.stroke();
    }
    // bright nucleus
    const beat = 0.7 + Math.sin(this.time * 2.2) * 0.15 + this.smoothLevel * 0.5;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.42 * beat);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * dim})`); g.addColorStop(0.3, `rgba(165,243,252,${0.55 * dim})`); g.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.42 * beat, 0, TAU); ctx.fill();
  }

  private drawOrbits(cx: number, cy: number, R: number) {
    const { ctx } = this;
    const tilts = [0.28, 0.42, -0.3, 0.6];
    ctx.lineWidth = 1;
    tilts.forEach((tilt, i) => {
      const rr = R * (1.35 + i * 0.22);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt + this.rot * (i % 2 ? -0.25 : 0.18));
      ctx.setLineDash(i % 2 ? [2, 7] : [30, 10, 4, 10]);
      ctx.lineDashOffset = -this.rot * 60 * (i + 1);
      ctx.strokeStyle = `rgba(103,232,249,${this.state === "no_trade" ? 0.1 : 0.2})`;
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.32, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    });
    ctx.setLineDash([]);
    // tick ring (technical-analysis dial)
    const tr = R * 1.18;
    ctx.strokeStyle = "rgba(186,230,253,0.28)";
    ctx.beginPath();
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * TAU + this.rot * 0.2;
      const len = k % 10 === 0 ? 9 : k % 5 === 0 ? 5 : 2.5;
      ctx.moveTo(cx + Math.cos(a) * tr, cy + Math.sin(a) * tr);
      ctx.lineTo(cx + Math.cos(a) * (tr + len), cy + Math.sin(a) * (tr + len));
    }
    ctx.stroke();
    // scanning arc
    const sa = this.rot * 2.4;
    const grad = ctx.createConicGradient ? ctx.createConicGradient(sa, cx, cy) : null;
    if (grad) {
      grad.addColorStop(0, "rgba(34,211,238,0.22)"); grad.addColorStop(0.12, "rgba(34,211,238,0)"); grad.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, tr + 12, 0, TAU); ctx.arc(cx, cy, R * 1.02, 0, TAU, true); ctx.fill();
    }
    // orbiting particles
    for (const d of this.orbitDots) {
      d.a += d.s * 0.016 * this.speed;
      const rr = R * d.r;
      const x = Math.cos(d.a) * rr, y = Math.sin(d.a) * rr * 0.32;
      const ct = Math.cos(d.tilt), st = Math.sin(d.tilt);
      const depth = Math.sin(d.a) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(165,243,252,${0.25 + depth * 0.55})`;
      ctx.fillRect(cx + x * ct - y * st, cy + x * st + y * ct, d.size * (0.6 + depth), d.size * (0.6 + depth));
    }
  }

  private drawWaveform(cx: number, cy: number, R: number) {
    const { ctx } = this;
    const base = R * 1.08;
    const amp = this.voice === "speaking" || this.voice === "listening" ? 4 + this.smoothLevel * 26 : 2.5;
    ctx.strokeStyle = this.voice === "speaking" ? "rgba(224,251,255,0.7)" : "rgba(103,232,249,0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const n = 128;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      const r = base + Math.sin(a * 6 + this.time * 5) * amp * 0.5 + Math.sin(a * 11 - this.time * 7) * amp * 0.35 + Math.sin(a * 3 + this.time * 2) * amp * 0.3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  private drawLabels(cx: number, cy: number, R: number) {
    if (!this.labels.length) return;
    const { ctx } = this;
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    const n = this.labels.length;
    this.labels.forEach((l, i) => {
      const a = (i / n) * TAU + this.rot * 0.22;
      const rx = R * 2.05, ry = R * 0.95;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      const depth = Math.sin(a) * 0.5 + 0.5;
      const alpha = 0.25 + depth * 0.6;
      ctx.fillStyle = `rgba(207,250,254,${alpha})`;
      ctx.fillText(l.label, x, y);
      if (l.value) {
        ctx.fillStyle = l.up == null ? `rgba(186,230,253,${alpha})` : l.up ? `rgba(94,234,212,${alpha})` : `rgba(251,113,133,${alpha})`;
        ctx.fillText(l.value, x, y + 12);
      }
    });
  }

  private drawHoloChart(cx: number, cy: number, R: number, dt: number) {
    const { ctx } = this;
    const c = this.candles;
    this.reveal = Math.min(c.length, this.reveal + dt * (this.state === "analyzing" ? 26 : 60));
    const shown = Math.floor(this.reveal);
    if (!shown) return;
    let lo = Infinity, hi = -Infinity;
    for (const k of c) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); }
    const W = R * 3.1, H = R * 0.95, x0 = cx - W / 2, y0 = cy - H / 2;
    const bw = W / c.length;
    const y = (p: number) => y0 + H - ((p - lo) / (hi - lo || 1)) * H;
    const fade = this.state === "complete" || this.state === "alert" ? 0.45 : this.state === "no_trade" ? 0.3 : 0.75;
    ctx.strokeStyle = `rgba(103,232,249,${0.12 * fade})`;
    ctx.strokeRect(x0, y0, W, H);
    for (let i = 0; i < shown; i++) {
      const k = c[i];
      const up = k.c >= k.o;
      const x = x0 + i * bw + bw / 2;
      const col = up ? `rgba(94,234,212,${fade})` : `rgba(251,113,133,${fade})`;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y(k.h)); ctx.lineTo(x, y(k.l)); ctx.stroke();
      const top = y(Math.max(k.o, k.c)), bot = y(Math.min(k.o, k.c));
      ctx.fillRect(x - bw * 0.3, top, bw * 0.6, Math.max(1, bot - top));
    }
  }

  private drawScan(now: number, dt: number, cx: number, cy: number, R: number) {
    const { ctx } = this;
    const active = now < this.scanUntil;
    // tunnel guides from both edges
    ctx.lineWidth = 1;
    for (let k = 0; k < 6; k++) {
      const side = k < 3 ? -1 : 1;
      const sy = this.h * (0.2 + (k % 3) * 0.3);
      ctx.strokeStyle = `rgba(56,189,248,${active ? 0.1 : 0.04})`;
      ctx.beginPath(); ctx.moveTo(side < 0 ? 0 : this.w, sy);
      ctx.quadraticCurveTo(cx + side * this.w * 0.22, sy + (cy - sy) * 0.2, cx + side * R * 0.9, cy);
      ctx.stroke();
    }
    if (active && this.tokens.length < (this.reduced ? 14 : 44) && Math.random() < dt * 22) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const sy = this.h * (0.08 + Math.random() * 0.84);
      this.tokens.push({
        label: this.scanPool[Math.floor(Math.random() * this.scanPool.length)], t: 0, speed: 0.28 + Math.random() * 0.25,
        x0: side < 0 ? -40 : this.w + 40, y0: sy, cx1: cx + side * this.w * (0.18 + Math.random() * 0.15), cy1: sy + (cy - sy) * 0.3,
        fate: "unknown", dropAt: 2, dead: false, hue: Math.random() < 0.7 ? HUE.cyan : HUE.white,
      });
    }
    // particle stream along the tunnel
    if (active && !this.reduced) for (let k = 0; k < 6; k++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.flyers.push({ x0: side < 0 ? 0 : this.w, y0: this.h * Math.random(), x1: cx, y1: cy, t: 0, speed: 0.5 + Math.random() * 0.6, bend: (Math.random() - 0.5) * 300, hue: HUE.cyan, size: 0.6 + Math.random() });
    }
    ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    for (const t of this.tokens) {
      t.t += dt * t.speed * (this.speed / 1.6);
      const u = t.t;
      const x = (1 - u) ** 2 * t.x0 + 2 * (1 - u) * u * t.cx1 + u * u * cx;
      const y = (1 - u) ** 2 * t.y0 + 2 * (1 - u) * u * t.cy1 + u * u * cy;
      if (t.fate === "drop" && u >= t.dropAt) { this.burst(x, y, HUE.amber, 14); t.dead = true; continue; }
      if (u >= 1) { t.dead = true; this.burst(cx, cy, HUE.cyan, 4); continue; }
      const a = Math.min(1, u * 4) * (1 - Math.max(0, u - 0.8) * 5);
      ctx.fillStyle = t.fate === "enter" ? `rgba(255,255,255,${a})` : `hsla(${t.hue},95%,78%,${a * 0.85})`;
      ctx.fillText(t.label, x, y);
    }
    this.tokens = this.tokens.filter((t) => !t.dead);
  }

  private drawLayers(now: number, cx: number, cy: number, R: number) {
    if (!this.layerQ.length) return;
    const { ctx } = this;
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const l of this.layerQ) {
      const u = (now - l.start) / l.dur;
      if (u < 0 || u > 1.15) continue;
      const k = Math.min(1, u);
      const sx = cx + l.from * R * 3.2, sy = cy - R * 1.6 + (this.layerQ.indexOf(l) % 3) * R * 0.5;
      const x = sx + (cx - sx) * easeInOut(k), y = sy + (cy - sy) * easeInOut(k);
      // connecting line
      ctx.strokeStyle = `rgba(103,232,249,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = `rgba(224,251,255,${u > 1 ? 0 : 1 - k * 0.6})`;
      ctx.fillText(l.label, x, y - 6);
      if (u >= 1 && u < 1.05) this.burst(cx, cy, HUE.cyan, 10);
    }
    if (now > this.layerQ[this.layerQ.length - 1].start + 1400) this.layerQ = [];
  }

  private drawRings(now: number, cx: number, cy: number, R: number) {
    if (!this.rings.length) return;
    const { ctx } = this;
    const age = (now - this.ringsBorn) / 1000;
    const fadeOut = this.state === "validating" ? 1 : Math.max(0, 1 - Math.max(0, age - 6) / 3);
    if (fadeOut <= 0) { this.rings = []; return; }
    ctx.textAlign = "left";
    ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.rings.forEach((r, i) => {
      const rr = R * (1.5 + i * 0.16);
      const p = Math.max(0, Math.min(1, (now - r.at) / 550));
      ctx.strokeStyle = `rgba(148,163,184,${0.12 * fadeOut})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      if (p <= 0) return;
      const hue = RING_HUE[r.state];
      ctx.strokeStyle = `hsla(${hue},90%,65%,${0.85 * fadeOut})`;
      ctx.lineWidth = 2;
      const a0 = -Math.PI / 2 + i * 0.25;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + TAU * p); ctx.stroke();
      if (p >= 1) {
        // a tidy verification list to the left of the core, each line tied to its ring
        const mark = r.state === "pass" ? "✓" : r.state === "fail" ? "✕" : r.state === "neutral" ? "~" : "–";
        const word = r.state === "pass" ? "VERIFIED" : r.state === "fail" ? "FAILED" : r.state === "neutral" ? "UNCONFIRMED" : "NO DATA";
        const lx = cx - R * 1.5 - this.rings.length * R * 0.16 - 14, ly = cy - (this.rings.length * 17) / 2 + i * 17;
        const ringAngle = Math.PI + Math.asin(Math.max(-0.95, Math.min(0.95, (ly - cy) / rr)));
        const ax = cx + Math.cos(ringAngle) * rr, ay = cy + Math.sin(ringAngle) * rr;
        ctx.strokeStyle = `hsla(${hue},90%,65%,${0.35 * fadeOut})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(lx + 6, ly - 3); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.fillStyle = `hsla(${hue},90%,75%,${fadeOut})`;
        ctx.textAlign = "right";
        ctx.fillText(`${mark} ${r.label} ${word}`, lx, ly);
        ctx.textAlign = "left";
      }
    });
  }

  private drawWaves(dt: number, cx: number, cy: number, R: number) {
    const { ctx } = this;
    for (const w of this.waves) {
      w.t += dt;
      if (w.t < 0) continue;
      const k = w.t / 1.6;
      ctx.strokeStyle = `hsla(${w.hue},95%,70%,${Math.max(0, 0.55 * (1 - k))})`;
      ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + k * (w.max - 1)), 0, TAU); ctx.stroke();
    }
    this.waves = this.waves.filter((w) => w.t < 1.6);
  }

  private drawFlyers(dt: number) {
    const { ctx } = this;
    for (const f of this.flyers) {
      f.t += dt * f.speed;
      if (f.t < 0 || f.t > 1) continue;
      const u = easeInOut(f.t);
      const mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2 + f.bend;
      const x = (1 - u) ** 2 * f.x0 + 2 * (1 - u) * u * mx + u * u * f.x1;
      const y = (1 - u) ** 2 * f.y0 + 2 * (1 - u) * u * my + u * u * f.y1;
      ctx.fillStyle = `hsla(${f.hue},95%,78%,${0.3 + 0.6 * Math.sin(f.t * Math.PI)})`;
      ctx.fillRect(x, y, f.size, f.size);
    }
    this.flyers = this.flyers.filter((f) => f.t <= 1);
    if (this.flyers.length > 1400) this.flyers.splice(0, this.flyers.length - 1400);
  }

  private burst(x: number, y: number, hue: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 20 + Math.random() * 70;
      this.bursts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.5 + Math.random() * 0.6, size: 0.8 + Math.random() * 1.4, hue });
    }
  }
  private drawBursts(dt: number) {
    const { ctx } = this;
    for (const b of this.bursts) {
      b.life += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.96; b.vy *= 0.96;
      ctx.fillStyle = `hsla(${b.hue},95%,72%,${Math.max(0, 1 - b.life / b.max)})`;
      ctx.fillRect(b.x, b.y, b.size, b.size);
    }
    this.bursts = this.bursts.filter((b) => b.life < b.max);
  }
}

function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }
