/**
 * ULTRON motion core — a canvas engine that draws the living AI core:
 * orbiting particles, particle streams, tilted orbital rings, a neural network,
 * rotating geometry, scanning arcs, HUD rings, energy waves, code fragments and
 * a volumetric energy core, all projected from 3D so every layer has depth.
 *
 * The page tells it what ULTRON is doing (setState) and it changes the motion:
 * listening (audio-reactive), thinking, coding, debugging, building, deploying,
 * success. One-off moments (a command arriving, a detected problem, a finished
 * deployment) are method calls. No React inside — it runs on requestAnimationFrame
 * and lowers its own detail if the machine can't keep up.
 */

export type CoreState =
  | "offline" | "idle" | "listening" | "thinking" | "coding"
  | "debugging" | "building" | "deploying" | "await" | "success" | "error";

export type SideNode = "NEURAL CORE" | "MEMORY" | "TERMINAL" | "REPOSITORY" | "NETWORK" | "DEPLOYMENT";

export interface CoreCallbacks {
  /** Boot moments: "ui" = show the command interface, "idle" = boot finished. */
  onPhase?: (phase: "ui" | "idle") => void;
  /** A launched command reached the core. */
  onCommandArrive?: () => void;
}

type RGB = [number, number, number];
interface Palette { a: RGB; b: RGB; hi: RGB }

const CYAN: RGB = [70, 225, 255];
const BLUE: RGB = [60, 125, 255];
const WHITE: RGB = [235, 248, 255];
const VIOLET: RGB = [150, 110, 255];

const PALETTES: Record<CoreState, Palette> = {
  offline: { a: [90, 110, 140], b: [55, 70, 100], hi: [170, 185, 210] },
  idle: { a: CYAN, b: BLUE, hi: WHITE },
  listening: { a: [90, 235, 255], b: [70, 160, 255], hi: WHITE },
  thinking: { a: [110, 170, 255], b: VIOLET, hi: WHITE },
  coding: { a: [70, 235, 235], b: [60, 150, 255], hi: [210, 255, 250] },
  debugging: { a: [120, 200, 255], b: [175, 120, 255], hi: [240, 225, 255] },
  building: { a: [95, 190, 255], b: [70, 110, 255], hi: WHITE },
  deploying: { a: [165, 140, 255], b: [70, 150, 255], hi: WHITE },
  await: { a: [170, 140, 255], b: [90, 120, 255], hi: [235, 225, 255] },
  success: { a: [190, 245, 255], b: [120, 200, 255], hi: [255, 255, 255] },
  error: { a: [255, 110, 150], b: [150, 90, 220], hi: [255, 225, 235] },
};

/** How lively each state is: energy (core brightness), speed, inflow (streams → core), zoom. */
const DYNAMICS: Record<CoreState, { energy: number; speed: number; inflow: number; zoom: number }> = {
  offline: { energy: 0.28, speed: 0.35, inflow: 0.15, zoom: 0.96 },
  idle: { energy: 0.62, speed: 1, inflow: 0.3, zoom: 1 },
  listening: { energy: 0.8, speed: 1.25, inflow: 0.35, zoom: 1.03 },
  thinking: { energy: 0.95, speed: 2.3, inflow: 1.4, zoom: 1.05 },
  coding: { energy: 0.9, speed: 1.6, inflow: 0.6, zoom: 1.05 },
  debugging: { energy: 0.85, speed: 1.3, inflow: 0.45, zoom: 1.04 },
  building: { energy: 0.95, speed: 1.7, inflow: 0.7, zoom: 1.05 },
  deploying: { energy: 1.05, speed: 2, inflow: 0.4, zoom: 1.06 },
  await: { energy: 0.7, speed: 0.8, inflow: 0.25, zoom: 1.02 },
  success: { energy: 1.2, speed: 1.4, inflow: 0.3, zoom: 1.02 },
  error: { energy: 0.5, speed: 0.7, inflow: 0.2, zoom: 1 },
};

const CODE_GLYPHS = ["{ }", "=>", "</>", "fn", "0x3F", "[ ]", "&&", "λ", "::", "()", "#!", "01", "10", "if", "++", "!=", "<T>", "$", "%", ";", "async", "npm", "git", "λx", "::1", "0b1", "∅", "≡"];
const MATH_GLYPHS = ["∑", "∫", "π", "λ", "∂", "∞", "Δ", "√", "≈", "θ", "∇", "φ", "Ω", "μ", "ƒ(x)", "∀", "∃", "⊕"];

// ---------- small math helpers ----------
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

interface V3 { x: number; y: number; z: number }

interface OrbitParticle {
  a: number; r: number; sp: number; size: number; tw: number;
  ci: number; si: number; cn: number; sn: number; // orbit plane (inclination / node)
  burst: number; bv: number; // radial offset + velocity (success burst)
  sx: number; sy: number; // boot start position (screen, relative to centre)
  delay: number; inner: boolean;
  px: number; py: number; // last drawn screen position (for cursor pull)
  pullX: number; pullY: number;
}
interface StreamParticle { a: number; r: number; tilt: number; sp: number; life: number }
interface Dust { x: number; y: number; z: number; vx: number; vy: number; tw: number }
interface Ring { r: number; tx: number; tz: number; tx0: number; tz0: number; spin: number; rot: number; dash: boolean; travelers: number[]; width: number; hl: number }
interface NNode { base: V3 }
interface Edge { a: number; b: number; ph: number; w: number }
interface Signal { e: number; p: number; dir: 1 | -1; sp: number }
interface Wave { r: number; sp: number; life: number; max: number; width: number; strong: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: 0 | 1 | 2 }
interface Frag { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; t: number; dur: number; glyph: string; swap: number; size: number; kind: "code" | "float" }
interface Diag { x: number; y: number; t: number; pts: { ox: number; oy: number }[] }
interface Structure { kind: "window" | "button" | "diagram" | "db" | "api"; cx: number; cy: number; t: number; pts: { x: number; y: number; d: number }[]; segs: [number, number, number, number][]; w: number; h: number }
interface TextPt { x: number; y: number; sx: number; sy: number; d: number }
interface Comet { x0: number; y0: number; t: number; dur: number }

const SIDE: { name: SideNode; side: -1 | 1; row: number }[] = [
  { name: "NEURAL CORE", side: -1, row: -1 },
  { name: "MEMORY", side: -1, row: 0 },
  { name: "TERMINAL", side: -1, row: 1 },
  { name: "REPOSITORY", side: 1, row: -1 },
  { name: "NETWORK", side: 1, row: 0 },
  { name: "DEPLOYMENT", side: 1, row: 1 },
];

export class UltronCoreEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: CoreCallbacks;
  private raf = 0;
  private running = false;
  private W = 0; private H = 0; private dpr = 1;
  private cx = 0; private cy = 0; private R = 100;
  private t = 0; private last = 0;
  private reduced = false;

  // state
  private state: CoreState = "idle";
  private pal: Palette = { a: [...CYAN], b: [...BLUE], hi: [...WHITE] };
  private energy = 0.6; private speed = 1; private inflow = 0.3; private zoom = 1;
  private spike = 0; // extra brightness (success / command arrival)
  private level = 0; private levelRaw = 0; private levelPeak = 0; private waveCool = 0;
  private yaw = 0; private pitch = 0.32;
  private ptr = { x: 0, y: 0, on: false, sx: 0, sy: 0 };
  private near = 0;
  private ringSync = 0; private ringPulse = -1;
  private lastIdleWave = 0; private lastSignal = 0; private lastFrag = 0; private lastStruct = 0;

  // boot
  private booting = true; private bootT = 0; private phaseUi = false; private phaseIdle = false;

  // scene
  private orbit: OrbitParticle[] = [];
  private streams: StreamParticle[] = [];
  private dust: Dust[] = [];
  private rings: Ring[] = [];
  private nodes: NNode[] = [];
  private edges: Edge[] = [];
  private signals: Signal[] = [];
  private waves: Wave[] = [];
  private sparks: Spark[] = [];
  private frags: Frag[] = [];
  private diags: Diag[] = [];
  private structs: Structure[] = [];
  private textPts: TextPt[] = [];
  private textAlpha = 0;
  private comets: Comet[] = [];
  private side = new Map<SideNode, { x: number; y: number; act: number }>();
  private deploy: { t: number; done: number } | null = null;
  private deployStream: { s: number; sp: number; off: number }[] = [];
  private sprite: HTMLCanvasElement | null = null;
  private spriteKey = "";

  // adaptive quality
  private quality = 1; private slowFrames = 0; private fastFrames = 0;

  constructor(canvas: HTMLCanvasElement, cb: CoreCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not available.");
    this.ctx = ctx;
    this.cb = cb;
    this.reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    this.build();
    if (this.reduced) this.skipBoot();
  }

  // ======================= public API =======================

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.adapt(dt);
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() { this.running = false; cancelAnimationFrame(this.raf); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.W * this.H > 2_400_000 ? 1.25 : 1.75);
    this.W = Math.max(1, rect.width); this.H = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.cx = this.W / 2; this.cy = this.H * 0.47;
    this.R = Math.min(this.W * 0.3, this.H * 0.27);
    this.layoutSide();
    if (this.textPts.length) this.buildText();
  }

  setState(s: CoreState) {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    if (s === "success") this.celebrate();
    if (s === "error") { this.spike = 0.2; this.wave(false); }
    if (s === "deploying" && !this.deploy) this.deploy = { t: 0, done: 0 };
    if (s !== "deploying" && prev === "deploying" && this.deploy && !this.deploy.done) this.deploy = null;
    if (s === "thinking") this.activate("NEURAL CORE");
  }

  /** Microphone loudness 0..1 (only used while listening). */
  setLevel(v: number) { this.levelRaw = clamp(v * 3.2); }

  setPointer(x: number, y: number) { this.ptr.x = x; this.ptr.y = y; this.ptr.on = true; }
  clearPointer() { this.ptr.on = false; }

  /** Light up one of the side systems (e.g. REPOSITORY while reading files). */
  activate(name: SideNode) { const n = this.side.get(name); if (n) n.act = 1; }

  /** A command flies from (x, y) — the command bar — into the core. */
  launchCommand(x: number, y: number) { this.comets.push({ x0: x, y0: y, t: 0, dur: this.reduced ? 0.3 : 0.75 }); }

  /** Tiny particles respond to a typed character at (x, y). */
  keystroke(x: number, y: number) {
    if (this.reduced) return;
    for (let i = 0; i < 4; i++) this.sparks.push({ x: x + rand(-4, 4), y: y + rand(-3, 3), vx: rand(-18, 18), vy: rand(-60, -20), life: 0, max: rand(0.5, 0.9), size: rand(0.6, 1.4), hue: 0 });
  }

  /** A real problem was found (failed tool / test): a diagnostic node forms, links to the core, dissolves. */
  diagnostic() {
    const ang = rand(0, Math.PI * 2);
    const d = this.R * rand(1.25, 1.6);
    const pts = Array.from({ length: 14 }, (_, i) => ({ ox: Math.cos((i / 14) * Math.PI * 2) * 9, oy: Math.sin((i / 14) * Math.PI * 2) * 9 }));
    this.diags.push({ x: Math.cos(ang) * d, y: Math.sin(ang) * d * 0.8, t: 0, pts });
  }

  /** Code was written: a burst of code fragments streams out of the core. */
  codeBurst(n = 6) { for (let i = 0; i < n; i++) this.spawnFrag("code"); }

  /** The deployment really finished: huge wave, then particles settle back. */
  deployComplete() {
    if (!this.deploy) this.deploy = { t: 0, done: 0 };
    this.deploy.done = 0.0001;
    this.waves.push({ r: this.R * 0.3, sp: Math.hypot(this.W, this.H) * 0.9, life: 0, max: 1.6, width: 3, strong: true });
    this.spike = 1;
    for (const n of this.side.values()) n.act = 1;
  }

  skipBoot() {
    this.bootT = 99; this.booting = false; this.textAlpha = 1;
    if (!this.textPts.length) this.buildText();
    if (!this.phaseUi) { this.phaseUi = true; this.cb.onPhase?.("ui"); }
    if (!this.phaseIdle) { this.phaseIdle = true; this.cb.onPhase?.("idle"); }
  }

  // ======================= scene setup =======================

  private build() {
    const small = this.W < 700;
    const nOrbit = small ? 420 : 900;
    this.orbit = Array.from({ length: nOrbit }, (_, i) => {
      const inner = i % 4 === 0;
      const inc = rand(0, Math.PI);
      const node = rand(0, Math.PI * 2);
      // Most particles gather in a shell; the rest fill the inner cloud.
      const r = inner ? Math.pow(Math.random(), 0.7) * 0.42 : 0.55 + Math.pow(Math.random(), 1.6) * 0.55;
      const ang = rand(0, Math.PI * 2);
      const far = Math.hypot(this.W, this.H) * rand(0.55, 0.8);
      return {
        a: rand(0, Math.PI * 2), r, sp: (inner ? rand(0.25, 0.7) : rand(0.05, 0.22)) * (Math.random() < 0.5 ? -1 : 1),
        size: Math.random() < 0.06 ? rand(1.6, 2.4) : rand(0.5, 1.2), tw: rand(0, Math.PI * 2),
        ci: Math.cos(inc), si: Math.sin(inc), cn: Math.cos(node), sn: Math.sin(node),
        burst: 0, bv: 0, sx: Math.cos(ang) * far, sy: Math.sin(ang) * far, delay: rand(0, 0.55), inner,
        px: 0, py: 0, pullX: 0, pullY: 0,
      };
    });
    this.streams = Array.from({ length: small ? 110 : 240 }, () => this.newStream(true));
    this.dust = Array.from({ length: small ? 70 : 150 }, () => ({ x: rand(0, 1), y: rand(0, 1), z: rand(0.2, 1), vx: rand(-0.004, 0.004), vy: rand(-0.006, 0.002), tw: rand(0, 6) }));
    const ringDefs: [number, number, number, number, boolean, number][] = [
      // radius, tiltX, tiltZ, spin, dashed, width
      [1.08, 1.2, 0.2, 0.12, false, 1.1],
      [1.2, 1.35, -0.45, -0.08, true, 0.9],
      [0.95, 0.5, 0.9, 0.18, false, 0.8],
      [1.32, 1.5, 0.1, 0.05, true, 0.7],
      [0.82, 1.0, -1.0, -0.22, false, 0.9],
    ];
    this.rings = ringDefs.map(([r, tx, tz, spin, dash, width]) => ({ r, tx, tz, tx0: tx, tz0: tz, spin, rot: rand(0, 6), dash, width, hl: 0, travelers: Array.from({ length: dash ? 2 : 3 }, () => rand(0, Math.PI * 2)) }));
    // Neural network: nodes on a Fibonacci sphere, each linked to its nearest neighbours.
    const nN = small ? 30 : 46;
    this.nodes = Array.from({ length: nN }, (_, i) => {
      const y = 1 - (i / (nN - 1)) * 2; const rr = Math.sqrt(1 - y * y); const th = i * 2.399963;
      const k = 0.78 + rand(-0.08, 0.08);
      return { base: { x: Math.cos(th) * rr * k, y: y * k, z: Math.sin(th) * rr * k } };
    });
    const seen = new Set<string>();
    this.edges = [];
    this.nodes.forEach((n, i) => {
      const near = this.nodes.map((m, j) => ({ j, d: (m.base.x - n.base.x) ** 2 + (m.base.y - n.base.y) ** 2 + (m.base.z - n.base.z) ** 2 })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 3);
      for (const o of near) { const key = i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`; if (!seen.has(key)) { seen.add(key); this.edges.push({ a: i, b: o.j, ph: rand(0, 6), w: rand(0.25, 0.9) }); } }
    });
    this.buildText();
  }

  private newStream(initial = false): StreamParticle {
    return { a: rand(0, Math.PI * 2), r: initial ? rand(0.2, 1.5) : rand(1.3, 1.6), tilt: rand(-0.6, 0.6), sp: rand(0.35, 0.8), life: 0 };
  }

  private layoutSide() {
    const small = this.W < 760;
    const dx = Math.min(this.W * 0.42, this.R * 2.25);
    for (const s of SIDE) {
      const x = small ? this.cx + s.side * this.W * 0.44 : this.cx + s.side * dx;
      const y = this.cy + s.row * this.R * 0.62;
      const prev = this.side.get(s.name);
      this.side.set(s.name, { x, y, act: prev?.act ?? 0 });
    }
  }

  /** Sample the word ULTRON into points the particles can fly to. */
  private buildText() {
    if (typeof document === "undefined") return;
    const size = Math.round(this.R * 0.36);
    const spacing = size * 0.2;
    const off = document.createElement("canvas");
    const letters = "ULTRON".split("");
    const g = off.getContext("2d");
    if (!g) return;
    g.font = `600 ${size}px "Barlow Condensed", "Barlow", sans-serif`;
    const widths = letters.map((l) => g.measureText(l).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
    off.width = Math.ceil(total + 8); off.height = Math.ceil(size * 1.3);
    g.font = `600 ${size}px "Barlow Condensed", "Barlow", sans-serif`;
    g.fillStyle = "#fff"; g.textBaseline = "middle";
    let x = 4;
    letters.forEach((l, i) => { g.fillText(l, x, off.height / 2); x += widths[i] + spacing; });
    const img = g.getImageData(0, 0, off.width, off.height).data;
    const step = Math.max(2, Math.round(size / 26));
    const pts: TextPt[] = [];
    for (let yy = 0; yy < off.height; yy += step) {
      for (let xx = 0; xx < off.width; xx += step) {
        if (img[(yy * off.width + xx) * 4 + 3] > 140) {
          const ang = rand(0, Math.PI * 2); const d = this.R * rand(0.6, 1.2);
          pts.push({ x: xx - off.width / 2, y: yy - off.height / 2, sx: Math.cos(ang) * d, sy: Math.sin(ang) * d * 0.7, d: rand(0, 0.35) });
        }
      }
    }
    this.textPts = pts.length > 900 ? pts.filter((_, i) => i % 2 === 0) : pts;
  }

  private glowSprite(): HTMLCanvasElement {
    const key = this.pal.hi.map((v) => v | 0).join(",") + "|" + this.pal.a.map((v) => (v / 16) | 0).join(",");
    if (this.sprite && this.spriteKey === key) return this.sprite;
    const s = this.sprite ?? document.createElement("canvas");
    s.width = s.height = 32;
    const g = s.getContext("2d")!;
    g.clearRect(0, 0, 32, 32);
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, rgba(this.pal.hi, 1));
    gr.addColorStop(0.25, rgba(this.pal.a, 0.8));
    gr.addColorStop(1, rgba(this.pal.a, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.sprite = s; this.spriteKey = key;
    return s;
  }

  // ======================= simulation =======================

  private adapt(dt: number) {
    // Keep the page responsive on slower machines: drop detail if frames run long.
    if (dt > 0.028) { this.slowFrames++; this.fastFrames = 0; } else { this.fastFrames++; this.slowFrames = Math.max(0, this.slowFrames - 1); }
    if (this.slowFrames > 45 && this.quality > 0.45) { this.quality = Math.max(0.45, this.quality - 0.2); this.slowFrames = 0; }
    if (this.fastFrames > 600 && this.quality < 1) { this.quality = Math.min(1, this.quality + 0.1); this.fastFrames = 0; }
  }

  private step(dt: number) {
    this.t += dt;
    if (this.booting) {
      this.bootT += dt;
      if (this.bootT > 5.2 && !this.phaseUi) { this.phaseUi = true; this.cb.onPhase?.("ui"); }
      if (this.bootT > 6.1) { this.booting = false; if (!this.phaseIdle) { this.phaseIdle = true; this.cb.onPhase?.("idle"); } }
    }
    const dyn = DYNAMICS[this.state];
    const k = 1 - Math.pow(0.04, dt); // ~frame-rate independent smoothing
    const target = PALETTES[this.state];
    this.pal = { a: mix(this.pal.a, target.a, k * 0.8), b: mix(this.pal.b, target.b, k * 0.8), hi: mix(this.pal.hi, target.hi, k * 0.8) };

    // Loudness (listening): quick attack, slower release.
    const lv = this.state === "listening" ? this.levelRaw : 0;
    this.level += (lv - this.level) * (lv > this.level ? 0.5 : 0.12);
    this.waveCool -= dt;
    if (this.state === "listening" && this.level > this.levelPeak + 0.12 && this.waveCool <= 0) { this.wave(false); this.waveCool = 0.35; }
    this.levelPeak = lerp(this.levelPeak, this.level, 0.05);

    // Cursor: the core leans toward it and gets livelier when it comes close.
    const px = this.ptr.on ? this.ptr.x - this.cx : 0; const py = this.ptr.on ? this.ptr.y - this.cy : 0;
    this.ptr.sx += (px - this.ptr.sx) * k * 0.6; this.ptr.sy += (py - this.ptr.sy) * k * 0.6;
    const dist = this.ptr.on ? Math.hypot(px, py) : 1e9;
    this.near += ((dist < this.R * 1.15 ? 1 - dist / (this.R * 1.15) : 0) - this.near) * k;

    this.spike *= Math.pow(0.25, dt);
    this.energy += (dyn.energy + this.level * 0.5 + this.near * 0.22 - this.energy) * k;
    this.speed += (dyn.speed + this.near * 0.4 - this.speed) * k * 0.7;
    this.inflow += (dyn.inflow - this.inflow) * k;
    const bootZoom = this.booting ? lerp(0.9, 1, easeOut(span(this.bootT, 1, 5))) : 1;
    this.zoom += (dyn.zoom * bootZoom - this.zoom) * k * 0.35;

    this.yaw += dt * 0.07 * this.speed;
    const pitchT = 0.32 + (this.ptr.sy / Math.max(1, this.H)) * 0.5;
    this.pitch += (pitchT - this.pitch) * k * 0.5;
    const yawOff = (this.ptr.sx / Math.max(1, this.W)) * 0.6;

    // Orbiting particles (+ success burst spring).
    for (const p of this.orbit) {
      p.a += p.sp * dt * this.speed;
      if (p.bv || p.burst) { p.burst += p.bv * dt; p.bv -= p.burst * 14 * dt; p.bv *= Math.pow(0.08, dt); if (Math.abs(p.burst) < 0.001 && Math.abs(p.bv) < 0.01) { p.burst = 0; p.bv = 0; } }
    }
    // Particle streams spiral into the core; respawn outside.
    for (const s of this.streams) {
      s.r -= dt * s.sp * (0.25 + this.inflow * 0.6);
      s.a += dt * (0.6 / Math.max(0.25, s.r)) * 0.25 * this.speed;
      s.life += dt;
      if (s.r < 0.08) Object.assign(s, this.newStream());
    }
    for (const d of this.dust) {
      d.x += d.vx * dt * (0.6 + this.speed * 0.4); d.y += d.vy * dt * (0.6 + this.speed * 0.4);
      if (d.x < -0.05) d.x = 1.05; if (d.x > 1.05) d.x = -0.05; if (d.y < -0.05) d.y = 1.05; if (d.y > 1.05) d.y = -0.05;
    }
    // Rings: spin; synchronise on success; tilt a little toward the cursor.
    this.ringSync = Math.max(0, this.ringSync - dt * 0.55);
    for (const [i, r] of this.rings.entries()) {
      r.rot += r.spin * dt * this.speed;
      const txT = lerp(r.tx0 + this.ptr.sy / Math.max(1, this.H) * 0.35, 1.3, easeInOut(this.ringSync));
      const tzT = lerp(r.tz0 + this.ptr.sx / Math.max(1, this.W) * 0.35, 0, easeInOut(this.ringSync));
      r.tx += (txT - r.tx) * k * 0.6; r.tz += (tzT - r.tz) * k * 0.6;
      for (let j = 0; j < r.travelers.length; j++) r.travelers[j] += dt * (0.5 + i * 0.12) * this.speed * (r.spin < 0 ? -1 : 1);
      r.hl = Math.max(0, r.hl - dt * 1.6);
    }
    if (this.ringPulse >= 0) {
      this.ringPulse += dt * 7;
      const idx = Math.floor(this.ringPulse);
      if (idx < this.rings.length) this.rings[idx].hl = Math.max(this.rings[idx].hl, 1); else this.ringPulse = -1;
    }
    // Neural signals.
    const sigRate = this.state === "thinking" ? 0.05 : this.state === "listening" ? 0.12 - this.level * 0.1 : this.state === "offline" ? 2.5 : 0.35;
    if (!this.booting || this.bootT > 3.3) {
      if (this.t - this.lastSignal > sigRate && this.signals.length < 60 * this.quality) {
        this.lastSignal = this.t;
        this.signals.push({ e: (Math.random() * this.edges.length) | 0, p: 0, dir: Math.random() < 0.5 ? 1 : -1, sp: rand(0.8, 1.8) * (this.state === "thinking" ? 1.8 : 1) });
      }
    }
    this.signals = this.signals.filter((s) => (s.p += dt * s.sp) < 1);
    // Idle breathing: an occasional soft wave.
    const waveEvery = this.state === "thinking" ? 1.6 : this.state === "idle" ? 4.2 : this.state === "offline" ? 9 : 3;
    if (!this.booting && this.t - this.lastIdleWave > waveEvery) { this.lastIdleWave = this.t; this.wave(false); }
    this.waves = this.waves.filter((w) => { w.life += dt; w.r += w.sp * dt; return w.life < w.max; });
    // Sparks (keystrokes, bursts, comet trails, dissolves).
    this.sparks = this.sparks.filter((s) => { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= Math.pow(0.3, dt); s.vy *= Math.pow(0.3, dt); return s.life < s.max; });
    // Code fragments.
    const fragEvery = this.state === "coding" ? 0.09 : this.state === "building" ? 0.35 : 1.8;
    if (!this.booting && this.t - this.lastFrag > fragEvery && this.frags.length < 70 * this.quality) {
      this.lastFrag = this.t;
      this.spawnFrag(this.state === "coding" || this.state === "building" ? "code" : "float");
    }
    this.frags = this.frags.filter((f) => {
      f.t += dt / f.dur;
      f.swap -= dt;
      if (f.swap <= 0 && f.kind === "code") { f.glyph = CODE_GLYPHS[(Math.random() * CODE_GLYPHS.length) | 0]; f.swap = rand(0.12, 0.3); }
      if (f.t >= 1 && f.kind === "code") {
        // Break apart into sparks at the end of its path.
        const x = this.cx + f.x1, y = this.cy + f.y1;
        for (let i = 0; i < 3; i++) this.sparks.push({ x, y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0, max: rand(0.3, 0.6), size: 0.9, hue: 0 });
      }
      return f.t < 1;
    });
    // Diagnostics.
    this.diags = this.diags.filter((d) => (d.t += dt) < 2.6);
    // Building: holographic structures assemble around the core, then dissolve.
    if (this.state === "building" && !this.booting && this.t - this.lastStruct > 1.25 && this.structs.length < 4) { this.lastStruct = this.t; this.spawnStructure(); }
    this.structs = this.structs.filter((s) => {
      s.t += dt;
      if (s.t > 3.4 && s.t - dt <= 3.4) for (const p of s.pts) if (Math.random() < 0.35) this.sparks.push({ x: this.cx + s.cx + p.x, y: this.cy + s.cy + p.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0, max: rand(0.4, 0.8), size: 0.9, hue: 0 });
      return s.t < 3.4;
    });
    // Deployment stream through REPOSITORY → NETWORK → DEPLOYMENT.
    if (this.deploy) {
      this.deploy.t += dt;
      if (this.deploy.done) { this.deploy.done += dt; if (this.deploy.done > 2.2) { this.deploy = null; this.deployStream = []; } }
      else if (this.deployStream.length < 90 * this.quality) this.deployStream.push({ s: 0, sp: rand(0.35, 0.55), off: rand(-1, 1) });
    }
    this.deployStream = this.deployStream.filter((p) => (p.s += dt * p.sp) < 1);
    for (const n of this.side.values()) n.act = Math.max(0, n.act - dt * 0.35);
    // Comets (commands flying into the core).
    this.comets = this.comets.filter((c) => {
      c.t += dt / c.dur;
      const pos = this.cometPos(c, Math.min(1, c.t));
      if (!this.reduced) for (let i = 0; i < 3; i++) this.sparks.push({ x: pos.x, y: pos.y, vx: rand(-15, 15), vy: rand(-15, 15), life: 0, max: rand(0.25, 0.5), size: rand(0.8, 1.6), hue: 2 });
      if (c.t >= 1) { this.spike = Math.max(this.spike, 0.7); this.wave(true); this.cb.onCommandArrive?.(); return false; }
      return true;
    });
    // ULTRON wordmark alpha: it steps back a little while ULTRON works.
    const busy = this.state === "thinking" || this.state === "coding" || this.state === "building" || this.state === "deploying" || this.state === "debugging";
    const textTarget = this.booting ? (this.bootT > 5 ? 1 : 0) : busy ? 0.42 : this.state === "offline" ? 0.55 : 0.95;
    this.textAlpha += (textTarget - this.textAlpha) * k * (this.booting ? 1.5 : 0.5);
  }

  private celebrate() {
    this.spike = 1.3;
    this.ringSync = 1;
    this.ringPulse = 0;
    for (const p of this.orbit) p.bv += rand(0.6, 1.4) * (p.inner ? 0.6 : 1);
    this.wave(true);
  }

  private wave(strong: boolean) {
    this.waves.push({ r: this.R * 0.25, sp: this.R * (strong ? 2.4 : 1.3), life: 0, max: strong ? 1.2 : 1.8, width: strong ? 2 : 1, strong });
  }

  private spawnFrag(kind: "code" | "float") {
    const R = this.R;
    if (kind === "float") {
      const x = rand(-this.W / 2, this.W / 2), y = rand(-this.H / 2, this.H / 2);
      this.frags.push({ x0: x, y0: y, x1: x + rand(-30, 30), y1: y - rand(20, 60), cx: x, cy: y - 20, t: 0, dur: rand(4, 7), glyph: CODE_GLYPHS[(Math.random() * CODE_GLYPHS.length) | 0], swap: 9, size: rand(8, 10), kind });
      return;
    }
    // From the core out to an orbital node (a point on one of the rings or a side system).
    const toSide = Math.random() < 0.35 && this.side.size;
    let x1: number, y1: number;
    if (toSide) {
      const arr = [...this.side.values()]; const n = arr[(Math.random() * arr.length) | 0];
      x1 = n.x - this.cx; y1 = n.y - this.cy;
    } else {
      const ang = rand(0, Math.PI * 2); const d = R * rand(1.05, 1.5);
      x1 = Math.cos(ang) * d; y1 = Math.sin(ang) * d * 0.75;
    }
    const ang0 = Math.atan2(y1, x1) + rand(-0.9, 0.9);
    const x0 = Math.cos(ang0) * R * 0.18, y0 = Math.sin(ang0) * R * 0.18;
    const nx = -(y1 - y0), ny = x1 - x0; const bend = rand(-0.35, 0.35);
    this.frags.push({ x0, y0, x1, y1, cx: (x0 + x1) / 2 + nx * bend, cy: (y0 + y1) / 2 + ny * bend, t: 0, dur: rand(0.9, 1.6), glyph: CODE_GLYPHS[(Math.random() * CODE_GLYPHS.length) | 0], swap: 0.15, size: rand(8, 11), kind });
  }

  private spawnStructure() {
    const kinds: Structure["kind"][] = ["window", "button", "diagram", "db", "api"];
    const kind = kinds[(Math.random() * kinds.length) | 0];
    const R = this.R;
    // Pick a free slot around the core.
    let ang = rand(0, Math.PI * 2);
    for (let tries = 0; tries < 8; tries++) {
      const cand = rand(0, Math.PI * 2);
      if (this.structs.every((s) => Math.abs(Math.atan2(s.cy, s.cx) - cand) > 0.9)) { ang = cand; break; }
    }
    const d = R * rand(1.45, 1.7);
    const cx = Math.cos(ang) * d, cy = Math.sin(ang) * d * 0.7;
    const segs: [number, number, number, number][] = [];
    const rect = (x: number, y: number, w: number, h: number) => { segs.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]); };
    let w = 0, h = 0;
    const s = R * 0.12;
    if (kind === "window") { w = s * 3.2; h = s * 2.2; rect(-w / 2, -h / 2, w, h); segs.push([-w / 2, -h / 2 + s * 0.45, w / 2, -h / 2 + s * 0.45]); rect(-w / 2 + s * 0.3, -h / 2 + s * 0.75, w * 0.35, h * 0.45); segs.push([s * 0.1, -h / 2 + s * 0.9, w / 2 - s * 0.3, -h / 2 + s * 0.9], [s * 0.1, -h / 2 + s * 1.2, w / 2 - s * 0.6, -h / 2 + s * 1.2]); }
    else if (kind === "button") { w = s * 2.4; h = s * 0.8; rect(-w / 2, -h / 2, w, h); segs.push([-w * 0.25, 0, w * 0.25, 0]); }
    else if (kind === "diagram") { w = s * 3.4; h = s * 2; rect(-w / 2, -h / 2, s, s * 0.7); rect(w / 2 - s, -h / 2, s, s * 0.7); rect(-s / 2, h / 2 - s * 0.7, s, s * 0.7); segs.push([-w / 2 + s, -h / 2 + s * 0.35, w / 2 - s, -h / 2 + s * 0.35], [-w / 2 + s / 2, -h / 2 + s * 0.7, 0, h / 2 - s * 0.7], [w / 2 - s / 2, -h / 2 + s * 0.7, 0, h / 2 - s * 0.7]); }
    else if (kind === "db") {
      w = s * 1.6; h = s * 2;
      for (const yy of [-h / 2, 0, h / 2]) for (let i = 0; i < 16; i++) { const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2; segs.push([Math.cos(a0) * w / 2, yy + Math.sin(a0) * s * 0.3, Math.cos(a1) * w / 2, yy + Math.sin(a1) * s * 0.3]); }
      segs.push([-w / 2, -h / 2, -w / 2, h / 2], [w / 2, -h / 2, w / 2, h / 2]);
    } else { w = s * 3; h = s * 1.6; const pts = [[-w / 2, 0], [-w / 6, -h / 2], [w / 6, h / 2], [w / 2, 0]]; for (let i = 0; i < pts.length; i++) { for (let j = i + 1; j < pts.length; j++) if (j - i < 3) segs.push([pts[i][0], pts[i][1], pts[j][0], pts[j][1]]); } }
    // Particles fly from the core to points along the outline.
    const pts: Structure["pts"] = [];
    for (const [x0, y0, x1, y1] of segs) { const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 9)); for (let i = 0; i < n; i++) pts.push({ x: lerp(x0, x1, i / n), y: lerp(y0, y1, i / n), d: rand(0, 0.45) }); }
    this.structs.push({ kind, cx, cy, t: 0, pts, segs, w, h });
  }

  private cometPos(c: Comet, t: number) {
    const e = easeInOut(t);
    const x0 = c.x0, y0 = c.y0, x2 = this.cx + this.ptr.sx * 0.03, y2 = this.cy + this.ptr.sy * 0.03;
    const x1 = (x0 + x2) / 2 + (x0 < x2 ? -1 : 1) * this.R * 0.4, y1 = Math.min(y0, y2) + (y0 - y2) * 0.2;
    return { x: (1 - e) ** 2 * x0 + 2 * (1 - e) * e * x1 + e * e * x2, y: (1 - e) ** 2 * y0 + 2 * (1 - e) * e * y1 + e * e * y2 };
  }

  // ======================= projection =======================

  private proj(v: V3, yaw: number, pitch: number) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v.x * cyw + v.z * syw; const z1 = -v.x * syw + v.z * cyw;
    const y2 = v.y * cp - z1 * sp; const z2 = v.y * sp + z1 * cp;
    const f = 3.2; const s = f / (f + z2);
    return { x: x1 * s, y: y2 * s, z: z2, s };
  }

  // ======================= drawing =======================

  private draw() {
    const g = this.ctx; const R = this.R; const q = this.quality;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#020408"; g.fillRect(0, 0, this.W, this.H);
    // Cinematic vignette-lit backdrop.
    const bg = g.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, Math.hypot(this.W, this.H) * 0.6);
    bg.addColorStop(0, rgba(mix(this.pal.b, [8, 12, 22], 0.82), 1)); bg.addColorStop(0.55, "rgba(6,9,16,1)"); bg.addColorStop(1, "rgba(1,2,4,1)");
    g.fillStyle = bg; g.globalAlpha = this.booting ? easeOut(span(this.bootT, 1.5, 4)) : 1; g.fillRect(0, 0, this.W, this.H); g.globalAlpha = 1;

    const bt = this.booting ? this.bootT : 99;
    const par = { x: this.ptr.sx, y: this.ptr.sy };
    g.globalCompositeOperation = "lighter";

    // ---- digital dust (deepest parallax layer) ----
    const dustA = easeOut(span(bt, 1.2, 3.5));
    for (let i = 0; i < this.dust.length * q; i++) {
      const d = this.dust[i];
      const x = d.x * this.W - par.x * 0.04 * d.z, y = d.y * this.H - par.y * 0.04 * d.z;
      const a = (0.12 + 0.2 * d.z) * (0.6 + 0.4 * Math.sin(this.t * 0.8 + d.tw)) * dustA;
      g.fillStyle = rgba(this.pal.a, a); g.fillRect(x, y, d.z * 1.4, d.z * 1.4);
    }
    // floating code particles (background)
    g.font = `500 9px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const f of this.frags) if (f.kind === "float") {
      const a = Math.sin(f.t * Math.PI) * 0.2 * dustA;
      g.fillStyle = rgba(this.pal.a, a); g.fillText(f.glyph, this.cx + lerp(f.x0, f.x1, f.t) - par.x * 0.03, this.cy + lerp(f.y0, f.y1, f.t) - par.y * 0.03);
    }

    // Camera: gentle push-in / pull-back and the core leaning toward the cursor.
    g.save();
    const ox = par.x * 0.025, oy = par.y * 0.025;
    g.translate(this.cx + ox, this.cy + oy); g.scale(this.zoom, this.zoom); g.translate(-(this.cx + ox), -(this.cy + oy));
    const cx = this.cx + ox, cy = this.cy + oy;
    const E = this.energy + this.spike;
    const yaw = this.yaw + (this.ptr.sx / Math.max(1, this.W)) * 0.6;
    const pitch = this.pitch;

    // ---- volumetric light ----
    const coreForm = easeOut(span(bt, 3.8, 4.6));
    const field = easeOut(span(bt, 2.3, 3.2));
    const vol = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.9);
    vol.addColorStop(0, rgba(this.pal.a, 0.16 * E * field)); vol.addColorStop(0.4, rgba(this.pal.b, 0.07 * E * field)); vol.addColorStop(1, rgba(this.pal.b, 0));
    g.fillStyle = vol; g.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);

    // ---- HUD rings (flat, slow) + scanning arc ----
    const hudA = easeOut(span(bt, 2.8, 4)) * (this.state === "offline" ? 0.5 : 1);
    if (hudA > 0) this.drawHud(cx, cy, hudA, par);

    // ---- energy field forming during boot ----
    if (this.booting && bt > 2.3 && bt < 3.6) {
      const p = span(bt, 2.3, 3.6);
      g.strokeStyle = rgba(this.pal.a, (1 - p) * 0.6); g.lineWidth = 1.5;
      g.beginPath(); g.arc(cx, cy, R * easeOut(p) * 1.05, 0, Math.PI * 2); g.stroke();
    }

    // ---- orbital rings (back halves first) ----
    const ringsA = this.state === "offline" ? 0.45 : 1;
    this.drawRings(cx, cy, yaw, pitch, bt, ringsA, true);

    // ---- neural network ----
    const netA = easeOut(span(bt, 1.9, 3.2)) * (this.state === "offline" ? 0.4 : 1);
    if (netA > 0 && q > 0.5) this.drawNetwork(cx, cy, yaw, pitch, netA, bt);
    else if (netA > 0) this.drawNetwork(cx, cy, yaw, pitch, netA * 0.7, bt);

    // ---- particle streams into the core ----
    const streamA = easeOut(span(bt, 1.2, 3));
    for (let i = 0; i < this.streams.length * q; i++) {
      const s = this.streams[i];
      const v = { x: Math.cos(s.a) * s.r * R, y: Math.sin(s.a) * s.r * R * Math.sin(s.tilt) , z: Math.sin(s.a) * s.r * R * Math.cos(s.tilt) };
      const p = this.proj({ x: v.x / R, y: v.y / R, z: v.z / R }, yaw * 1.3, pitch);
      const a = clamp(s.r) * clamp(1.5 - s.r) * (0.35 + this.inflow * 0.3) * streamA * (0.6 + 0.4 * p.s);
      g.fillStyle = rgba(this.pal.a, a); g.fillRect(cx + p.x * R, cy + p.y * R, 1.1, 1.1);
    }

    // ---- orbit particles ----
    this.drawOrbit(cx, cy, yaw, pitch, bt, q);

    // ---- rotating geometry inside the core ----
    this.drawGeometry(cx, cy, yaw, pitch, coreForm);

    // ---- energy core ----
    if (this.booting && bt > 0.35 && bt < 4) {
      // The first spark + its pulse.
      const a = easeOut(span(bt, 0.35, 0.8)) * (1 - span(bt, 3.6, 4));
      g.fillStyle = rgba(WHITE, a); g.beginPath(); g.arc(cx, cy, 1.8 + Math.sin(bt * 9) * 0.4, 0, Math.PI * 2); g.fill();
      if (bt > 0.9 && bt < 1.9) { const p = span(bt, 0.9, 1.9); g.strokeStyle = rgba(this.pal.a, (1 - p) * 0.8); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 4 + p * R * 0.5, 0, Math.PI * 2); g.stroke(); }
    }
    if (coreForm > 0) {
      const flash = this.booting ? Math.max(0, 1 - Math.abs(bt - 4.05) * 3) : 0;
      const cr = R * (0.24 + E * 0.1 + this.level * 0.08 + flash * 0.2) * coreForm;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
      gr.addColorStop(0, rgba(this.pal.hi, clamp(0.75 * E + flash))); gr.addColorStop(0.18, rgba(this.pal.hi, 0.45 * E));
      gr.addColorStop(0.45, rgba(this.pal.a, 0.22 * E)); gr.addColorStop(1, rgba(this.pal.b, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI * 2); g.fill();
      // Pulsing inner eye.
      const eye = R * (0.035 + 0.012 * Math.sin(this.t * 3) + this.level * 0.03) * coreForm;
      g.fillStyle = rgba(WHITE, clamp(0.6 + E * 0.3)); g.beginPath(); g.arc(cx, cy, eye, 0, Math.PI * 2); g.fill();
    }

    // ---- listening: circular waveform + frequency bars ----
    if (this.state === "listening" || this.level > 0.02) this.drawVoice(cx, cy);

    // ---- thinking: rotating math glyph rings ----
    if (this.state === "thinking") this.drawThinking(cx, cy);

    // ---- debugging: sweeping beam + diagnostic nodes ----
    if (this.state === "debugging") this.drawBeam(cx, cy);
    for (const d of this.diags) this.drawDiag(cx, cy, d);

    // ---- code streams ----
    this.drawCode(cx, cy);

    // ---- building structures ----
    for (const s of this.structs) this.drawStructure(cx, cy, s);

    // ---- front halves of rings over the core ----
    this.drawRings(cx, cy, yaw, pitch, bt, ringsA, false);

    // ---- energy waves ----
    for (const w of this.waves) {
      const a = (1 - w.life / w.max) * (w.strong ? 0.55 : 0.28) * Math.min(1, E);
      g.strokeStyle = rgba(w.strong ? this.pal.hi : this.pal.a, a); g.lineWidth = w.width;
      g.beginPath(); g.arc(cx, cy, w.r, 0, Math.PI * 2); g.stroke();
    }

    // ---- deployment stream + side systems ----
    this.drawSide(cx, cy, bt);
    if (this.deploy) this.drawDeploy(cx, cy);

    // ---- the ULTRON wordmark (materialises from particles during boot) ----
    this.drawText(cx, cy, bt);
    g.restore();

    // ---- sparks + comets (screen space) ----
    const sprite = this.glowSprite();
    for (const s of this.sparks) {
      const a = 1 - s.life / s.max; const c = s.hue === 2 ? this.pal.hi : s.hue === 1 ? this.pal.b : this.pal.a;
      g.fillStyle = rgba(c, a * 0.9); g.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    for (const c of this.comets) {
      const p = this.cometPos(c, Math.min(1, c.t));
      g.globalAlpha = 0.95; g.drawImage(sprite, p.x - 12, p.y - 12, 24, 24); g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
  }

  private drawHud(cx: number, cy: number, a: number, par: { x: number; y: number }) {
    const g = this.ctx; const R = this.R;
    const hx = cx - par.x * 0.012, hy = cy - par.y * 0.012; // parallax: HUD sits on its own plane
    g.lineWidth = 1;
    g.strokeStyle = rgba(this.pal.a, 0.12 * a); g.beginPath(); g.arc(hx, hy, R * 1.42, 0, Math.PI * 2); g.stroke();
    // tick ring
    const rot = this.t * 0.03 * this.speed;
    g.strokeStyle = rgba(this.pal.a, 0.22 * a); g.beginPath();
    for (let i = 0; i < 120; i++) {
      const ang = rot + (i / 120) * Math.PI * 2; const long = i % 10 === 0;
      const r0 = R * 1.3, r1 = R * (long ? 1.345 : 1.325);
      g.moveTo(hx + Math.cos(ang) * r0, hy + Math.sin(ang) * r0); g.lineTo(hx + Math.cos(ang) * r1, hy + Math.sin(ang) * r1);
    }
    g.stroke();
    // quarter brackets rotating the other way
    g.strokeStyle = rgba(this.pal.a, 0.35 * a); g.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) { const s = -this.t * 0.05 + (i * Math.PI) / 2; g.beginPath(); g.arc(hx, hy, R * 1.5, s, s + 0.35); g.stroke(); }
    // scanning arc
    const sa = this.t * (this.state === "thinking" ? 1.6 : 0.55) * (this.state === "offline" ? 0.3 : 1);
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = rgba(this.pal.hi, (0.55 - i * 0.038) * a); g.lineWidth = 1.6;
      g.beginPath(); g.arc(hx, hy, R * 1.16, sa - i * 0.05, sa - i * 0.05 - 0.05, true); g.stroke();
    }
  }

  private ringPoint(r: Ring, ang: number, yaw: number, pitch: number) {
    // Circle in the XZ plane → tilt around X then Z → global view rotation.
    const x = Math.cos(ang) * r.r, z = Math.sin(ang) * r.r;
    const cx = Math.cos(r.tx), sx = Math.sin(r.tx), cz = Math.cos(r.tz), sz = Math.sin(r.tz);
    const y1 = -z * sx, z1 = z * cx;
    const x2 = x * cz - y1 * sz, y2 = x * sz + y1 * cz;
    return this.proj({ x: x2, y: y2, z: z1 }, yaw * 0.5, pitch * 0.4);
  }

  private drawRings(cx: number, cy: number, yaw: number, pitch: number, bt: number, alpha: number, back: boolean) {
    const g = this.ctx; const R = this.R; const N = 90;
    this.rings.forEach((r, i) => {
      const assemble = easeInOut(span(bt, 2.7 + i * 0.2, 3.5 + i * 0.2));
      if (assemble <= 0) return;
      const hl = r.hl + this.ringSync * 0.5;
      const base = (back ? 0.1 : 0.3) * alpha * (0.7 + this.energy * 0.4) + hl * 0.5;
      g.strokeStyle = rgba(hl > 0.2 ? this.pal.hi : this.pal.a, base);
      g.lineWidth = r.width * (1 + hl);
      if (r.dash) { g.setLineDash([3, 7]); g.lineDashOffset = -r.rot * R * 0.6; }
      g.beginPath();
      let drawing = false;
      const limit = Math.floor(N * assemble);
      for (let k = 0; k <= limit; k++) {
        const ang = r.rot + (k / N) * Math.PI * 2;
        const p = this.ringPoint(r, ang, yaw, pitch);
        const isBack = p.z > 0;
        if (isBack !== back) { drawing = false; continue; }
        const X = cx + p.x * R, Y = cy + p.y * R;
        if (!drawing) { g.moveTo(X, Y); drawing = true; } else g.lineTo(X, Y);
      }
      g.stroke();
      g.setLineDash([]);
      // light travelling along the ring
      if (assemble >= 1) {
        for (const tr of r.travelers) {
          const p = this.ringPoint(r, tr, yaw, pitch);
          if ((p.z > 0) !== back) continue;
          const a = (back ? 0.35 : 0.9) * alpha;
          const sprite = this.glowSprite();
          g.globalAlpha = a; g.drawImage(sprite, cx + p.x * R - 5, cy + p.y * R - 5, 10, 10); g.globalAlpha = 1;
        }
      }
    });
  }

  private drawNetwork(cx: number, cy: number, yaw: number, pitch: number, a: number, bt: number) {
    const g = this.ctx; const R = this.R;
    const spin = this.t * 0.05;
    const pts = this.nodes.map((n) => {
      const c = Math.cos(spin), s = Math.sin(spin);
      const v = { x: n.base.x * c - n.base.z * s, y: n.base.y, z: n.base.x * s + n.base.z * c };
      // listening: pathways pulse with the voice
      const k = 1 + this.level * 0.12 * Math.sin(this.t * 14 + n.base.y * 6);
      return this.proj({ x: v.x * k, y: v.y * k, z: v.z * k }, yaw, pitch);
    });
    const light = easeOut(span(bt, 3.2, 4.1));
    g.lineWidth = 0.7;
    for (const e of this.edges) {
      const p = pts[e.a], q = pts[e.b];
      // edges fade in and out: connections forming and breaking
      const on = clamp(0.5 + Math.sin(this.t * 0.35 * e.w + e.ph) * 0.9);
      const depth = 0.35 + 0.65 * clamp((p.s + q.s) / 2 - 0.6, 0, 1) * 1.6;
      const alpha = on * depth * a * (0.1 + 0.12 * this.energy + this.level * 0.3);
      if (alpha < 0.01) continue;
      g.strokeStyle = rgba(this.pal.a, alpha);
      g.beginPath(); g.moveTo(cx + p.x * R, cy + p.y * R); g.lineTo(cx + q.x * R, cy + q.y * R); g.stroke();
    }
    for (const p of pts) {
      const s = 1.2 * p.s;
      g.fillStyle = rgba(this.pal.hi, (0.25 + 0.35 * (p.s - 0.7)) * a);
      g.fillRect(cx + p.x * R - s / 2, cy + p.y * R - s / 2, s, s);
    }
    if (light <= 0) return;
    const sprite = this.glowSprite();
    for (const s of this.signals) {
      const e = this.edges[s.e]; if (!e) continue;
      const p0 = pts[s.dir === 1 ? e.a : e.b], p1 = pts[s.dir === 1 ? e.b : e.a];
      const x = cx + lerp(p0.x, p1.x, s.p) * R, y = cy + lerp(p0.y, p1.y, s.p) * R;
      g.globalAlpha = Math.sin(s.p * Math.PI) * light * a; g.drawImage(sprite, x - 4, y - 4, 8, 8);
    }
    g.globalAlpha = 1;
  }

  private drawOrbit(cx: number, cy: number, yaw: number, pitch: number, bt: number, q: number) {
    const g = this.ctx; const R = this.R;
    const sprite = this.glowSprite();
    const jitter = this.level * 2.2;
    const conv = this.booting ? bt : 99;
    const ptrOn = this.ptr.on;
    const pX = this.ptr.x, pY = this.ptr.y;
    const pullR = R * 0.9;
    const n = Math.floor(this.orbit.length * q);
    for (let i = 0; i < n; i++) {
      const p = this.orbit[i];
      const r = p.r + p.burst * 0.35;
      // point on the particle's own tilted orbit
      const lx = Math.cos(p.a) * r, ly0 = Math.sin(p.a) * r;
      const ly = ly0 * p.ci, lz = ly0 * p.si;
      const v = { x: lx * p.cn + lz * p.sn, y: ly, z: -lx * p.sn + lz * p.cn };
      const pr = this.proj(v, yaw, pitch);
      let x = cx + pr.x * R, y = cy + pr.y * R;
      // boot: fly in from far away
      if (conv < 3.2) {
        const e = easeOut(span(conv, 1.1 + p.delay, 2.6 + p.delay));
        if (e <= 0) continue;
        x = lerp(cx + p.sx, x, e); y = lerp(cy + p.sy, y, e);
      }
      if (jitter) { x += (Math.random() - 0.5) * jitter; y += (Math.random() - 0.5) * jitter; }
      // cursor attraction
      if (ptrOn) {
        const dx = pX - x, dy = pY - y; const d = Math.hypot(dx, dy);
        const f = d < pullR ? (1 - d / pullR) * 0.22 : 0;
        p.pullX += (dx * f - p.pullX) * 0.1; p.pullY += (dy * f - p.pullY) * 0.1;
      } else { p.pullX *= 0.9; p.pullY *= 0.9; }
      x += p.pullX; y += p.pullY;
      const tw = 0.65 + 0.35 * Math.sin(this.t * 2 + p.tw);
      const a = clamp((0.25 + (pr.s - 0.75) * 1.6) * tw * (0.55 + this.energy * 0.5));
      if (p.size > 1.5) { g.globalAlpha = a; const s = p.size * 4 * pr.s; g.drawImage(sprite, x - s / 2, y - s / 2, s, s); g.globalAlpha = 1; }
      else { g.fillStyle = rgba(p.inner ? this.pal.hi : this.pal.a, a); const s = p.size * pr.s * 1.3; g.fillRect(x - s / 2, y - s / 2, s, s); }
    }
    // boot: thin holographic lines between converging particles
    if (this.booting && bt > 1.8 && bt < 3.6) {
      const la = Math.sin(span(bt, 1.8, 3.6) * Math.PI) * 0.35;
      g.strokeStyle = rgba(this.pal.a, la); g.lineWidth = 0.5; g.beginPath();
      for (let i = 0; i < 160; i += 2) {
        const a = this.orbit[i], b = this.orbit[i + 1];
        const e = easeOut(span(bt, 1.1 + a.delay, 2.6 + a.delay));
        const pa = this.proj({ x: Math.cos(a.a) * a.r * a.cn, y: Math.sin(a.a) * a.r * a.ci, z: -Math.cos(a.a) * a.r * a.sn }, yaw, pitch);
        const pb = this.proj({ x: Math.cos(b.a) * b.r * b.cn, y: Math.sin(b.a) * b.r * b.ci, z: -Math.cos(b.a) * b.r * b.sn }, yaw, pitch);
        g.moveTo(lerp(cx + a.sx, cx + pa.x * R, e), lerp(cy + a.sy, cy + pa.y * R, e));
        g.lineTo(lerp(cx + b.sx, cx + pb.x * R, e), lerp(cy + b.sy, cy + pb.y * R, e));
      }
      g.stroke();
    }
  }

  private drawGeometry(cx: number, cy: number, yaw: number, pitch: number, a: number) {
    if (a <= 0) return;
    const g = this.ctx; const R = this.R;
    // Wireframe icosahedron turning inside the core.
    const t = (1 + Math.sqrt(5)) / 2;
    const V: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(([x, y, z]) => ({ x, y, z }));
    const EDG = [[0, 11], [0, 5], [0, 1], [0, 7], [0, 10], [1, 5], [5, 11], [11, 10], [10, 7], [7, 1], [3, 9], [3, 4], [3, 2], [3, 6], [3, 8], [4, 9], [2, 4], [6, 2], [8, 6], [9, 8], [4, 5], [2, 11], [6, 10], [8, 7], [9, 1], [4, 11], [2, 10], [6, 7], [8, 1], [9, 5]];
    const sc = 0.2 * (1 + this.level * 0.25) / 1.9;
    const rot = this.t * 0.35 * this.speed;
    const pts = V.map((v) => {
      const c = Math.cos(rot), s = Math.sin(rot), c2 = Math.cos(rot * 0.7), s2 = Math.sin(rot * 0.7);
      const x = v.x * c - v.z * s, z = v.x * s + v.z * c; const y = v.y * c2 - z * s2, z2 = v.y * s2 + z * c2;
      return this.proj({ x: x * sc, y: y * sc, z: z2 * sc }, yaw, pitch);
    });
    g.strokeStyle = rgba(this.pal.hi, 0.22 * a * (0.6 + this.energy * 0.4)); g.lineWidth = 0.7; g.beginPath();
    for (const [i, j] of EDG) { g.moveTo(cx + pts[i].x * R, cy + pts[i].y * R); g.lineTo(cx + pts[j].x * R, cy + pts[j].y * R); }
    g.stroke();
    // Two small holographic solids drifting further out, turning slowly.
    for (const [k, dist, size] of [[0, 1.62, 0.07], [1, 1.75, 0.055]] as const) {
      const ang = this.t * 0.06 + k * Math.PI + 0.8;
      const ox = Math.cos(ang) * dist, oz = Math.sin(ang) * dist * 0.4, oy = (k ? 0.45 : -0.5);
      const cube = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
      const ce = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      const r2 = this.t * (0.4 + k * 0.2);
      const pp = cube.map(([x, y, z]) => {
        const c = Math.cos(r2), s = Math.sin(r2);
        const x1 = x * c - z * s, z1 = x * s + z * c; const y1 = y * Math.cos(r2 * 0.6) - z1 * Math.sin(r2 * 0.6);
        return this.proj({ x: ox + x1 * size, y: oy + y1 * size, z: oz + z1 * size }, yaw * 0.3, pitch * 0.3);
      });
      g.strokeStyle = rgba(this.pal.a, 0.18 * a); g.beginPath();
      for (const [i, j] of ce) { g.moveTo(cx + pp[i].x * R, cy + pp[i].y * R); g.lineTo(cx + pp[j].x * R, cy + pp[j].y * R); }
      g.stroke();
    }
  }

  private drawVoice(cx: number, cy: number) {
    const g = this.ctx; const R = this.R; const L = this.level;
    const N = 128; const base = R * 0.98;
    g.strokeStyle = rgba(this.pal.hi, 0.35 + L * 0.5); g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
      const n = Math.abs(Math.sin(i * 0.37 + this.t * 9) * 0.6 + Math.sin(i * 0.11 - this.t * 5) * 0.4);
      const len = 3 + L * R * 0.32 * n;
      g.moveTo(cx + Math.cos(ang) * base, cy + Math.sin(ang) * base);
      g.lineTo(cx + Math.cos(ang) * (base + len), cy + Math.sin(ang) * (base + len));
    }
    g.stroke();
    // smooth circular waveform just inside it
    g.strokeStyle = rgba(this.pal.a, 0.55); g.lineWidth = 1; g.beginPath();
    for (let i = 0; i <= 180; i++) {
      const ang = (i / 180) * Math.PI * 2;
      const r = R * 0.9 + Math.sin(ang * 6 + this.t * 6) * L * R * 0.06 + Math.sin(ang * 13 - this.t * 11) * L * R * 0.03;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }

  private drawThinking(cx: number, cy: number) {
    const g = this.ctx; const R = this.R;
    g.font = `500 11px "Barlow Condensed", ui-monospace, monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    [[1.05, 0.5, 10], [1.24, -0.32, 14], [0.68, 0.9, 7]].forEach(([rr, sp, n], ring) => {
      for (let i = 0; i < n; i++) {
        const ang = this.t * sp + (i / n) * Math.PI * 2;
        const glyph = MATH_GLYPHS[(i * 7 + ring * 3 + Math.floor(this.t * 1.5 + i)) % MATH_GLYPHS.length];
        const a = 0.18 + 0.22 * Math.sin(this.t * 3 + i);
        g.fillStyle = rgba(ring === 1 ? this.pal.b : this.pal.a, a);
        g.fillText(glyph, cx + Math.cos(ang) * R * rr, cy + Math.sin(ang) * R * rr * 0.82);
      }
    });
    // Information streams leaving the centre.
    g.strokeStyle = rgba(this.pal.hi, 0.18); g.lineWidth = 0.8; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = i * 0.628 + this.t * 0.4; const p = (this.t * 0.9 + i * 0.13) % 1;
      const r0 = R * (0.12 + p * 0.9), r1 = r0 + R * 0.1;
      g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    }
    g.stroke();
  }

  private drawBeam(cx: number, cy: number) {
    const g = this.ctx;
    const ang = this.t * 1.1;
    const len = Math.hypot(this.W, this.H);
    for (let i = 0; i < 10; i++) {
      const a0 = ang - i * 0.025;
      g.fillStyle = rgba(this.pal.a, 0.032 - i * 0.0028);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * len, cy + Math.sin(a0) * len); g.lineTo(cx + Math.cos(a0 - 0.025) * len, cy + Math.sin(a0 - 0.025) * len); g.closePath(); g.fill();
    }
    g.strokeStyle = rgba(this.pal.hi, 0.35); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx + Math.cos(ang) * this.R * 0.3, cy + Math.sin(ang) * this.R * 0.3); g.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); g.stroke();
  }

  private drawDiag(cx: number, cy: number, d: Diag) {
    const g = this.ctx;
    const x = cx + d.x, y = cy + d.y;
    const form = easeOut(span(d.t, 0, 0.5));
    const link = span(d.t, 0.45, 1.05);
    const dissolve = span(d.t, 1.8, 2.6);
    const col = mix(this.pal.b, [255, 190, 120], 0.45);
    // cluster → highlighted node
    for (const [i, p] of d.pts.entries()) {
      const spread = 1 + dissolve * 4;
      const px = x + lerp(p.ox * 3.2, p.ox, form) * spread + Math.sin(this.t * 4 + i) * 0.6;
      const py = y + lerp(p.oy * 3.2, p.oy, form) * spread;
      g.fillStyle = rgba(col, (0.4 + form * 0.5) * (1 - dissolve)); g.fillRect(px - 0.9, py - 0.9, 1.8, 1.8);
    }
    g.strokeStyle = rgba(col, 0.7 * form * (1 - dissolve)); g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke();
    // thin line to the core, drawn out then processed
    if (link > 0) {
      const ex = lerp(x, cx, easeOut(link)), ey = lerp(y, cy, easeOut(link));
      g.strokeStyle = rgba(col, 0.5 * (1 - dissolve)); g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
      if (link >= 1 && d.t < 1.2) this.spike = Math.max(this.spike, 0.25);
    }
  }

  private drawCode(cx: number, cy: number) {
    const g = this.ctx;
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const f of this.frags) {
      if (f.kind !== "code") continue;
      const e = easeInOut(f.t);
      const x = cx + (1 - e) ** 2 * f.x0 + 2 * (1 - e) * e * f.cx + e * e * f.x1;
      const y = cy + (1 - e) ** 2 * f.y0 + 2 * (1 - e) * e * f.cy + e * e * f.y1;
      const a = Math.sin(f.t * Math.PI) * 0.85;
      g.font = `500 ${f.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      g.fillStyle = rgba(f.t < 0.3 ? this.pal.hi : this.pal.a, a);
      g.fillText(f.glyph, x, y);
      // faint trail back toward the core
      g.strokeStyle = rgba(this.pal.a, a * 0.2); g.lineWidth = 0.6;
      const e0 = Math.max(0, e - 0.12);
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(cx + (1 - e0) ** 2 * f.x0 + 2 * (1 - e0) * e0 * f.cx + e0 * e0 * f.x1, cy + (1 - e0) ** 2 * f.y0 + 2 * (1 - e0) * e0 * f.cy + e0 * e0 * f.y1);
      g.stroke();
    }
  }

  private drawStructure(cx: number, cy: number, s: Structure) {
    const g = this.ctx;
    const ox = cx + s.cx, oy = cy + s.cy;
    const outline = easeOut(span(s.t, 0.8, 1.4)) * (1 - span(s.t, 2.8, 3.4));
    for (const p of s.pts) {
      const e = easeInOut(span(s.t, p.d, p.d + 0.9));
      if (e <= 0 || s.t > 3.4) continue;
      const fade = 1 - span(s.t, 2.9, 3.4);
      const x = lerp(cx, ox + p.x, e), y = lerp(cy, oy + p.y, e);
      g.fillStyle = rgba(e < 1 ? this.pal.a : this.pal.hi, (e < 1 ? 0.6 : 0.3) * fade);
      g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    if (outline <= 0) return;
    g.strokeStyle = rgba(this.pal.a, 0.55 * outline); g.lineWidth = 0.9; g.beginPath();
    for (const [x0, y0, x1, y1] of s.segs) { g.moveTo(ox + x0, oy + y0); g.lineTo(ox + x1, oy + y1); }
    g.stroke();
    g.fillStyle = rgba(this.pal.a, 0.05 * outline);
    g.fillRect(ox - s.w / 2, oy - s.h / 2, s.w, s.h);
    // an API link back to the core
    g.strokeStyle = rgba(this.pal.b, 0.18 * outline); g.setLineDash([2, 5]); g.lineDashOffset = -this.t * 20;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(cx, cy); g.stroke(); g.setLineDash([]);
  }

  private drawSide(cx: number, cy: number, bt: number) {
    const g = this.ctx;
    const a = easeOut(span(bt, 4.6, 5.6)) * (this.state === "offline" ? 0.5 : 1);
    if (a <= 0) return;
    const labels = this.W >= 760;
    g.font = `500 10px "Barlow Condensed", "Barlow", sans-serif`; g.textBaseline = "middle";
    for (const s of SIDE) {
      const n = this.side.get(s.name)!;
      const act = n.act;
      const x = n.x + (cx - this.cx) * 0.5, y = n.y + (cy - this.cy) * 0.5;
      // connector toward the ring when active
      if (act > 0.02) {
        const tx = cx + Math.sign(x - cx) * this.R * 1.3;
        g.strokeStyle = rgba(this.pal.a, 0.3 * act * a); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, cy + (y - cy) * 0.5); g.stroke();
      }
      g.fillStyle = rgba(act > 0.1 ? this.pal.hi : this.pal.a, (0.45 + act * 0.55) * a);
      g.beginPath(); g.arc(x, y, 2 + act * 1.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgba(this.pal.a, (0.25 + act * 0.5) * a); g.lineWidth = 0.8; g.beginPath(); g.arc(x, y, 6 + act * 3, 0, Math.PI * 2); g.stroke();
      if (!labels) continue;
      g.textAlign = s.side < 0 ? "right" : "left";
      const lx = x + (s.side < 0 ? -14 : 14);
      g.fillStyle = rgba([225, 235, 245], (0.55 + act * 0.45) * a);
      g.fillText(spaced(s.name), lx, y - 5);
      g.fillStyle = rgba(this.pal.a, (0.35 + act * 0.5) * a);
      g.font = `400 8px "Barlow Condensed", "Barlow", sans-serif`;
      g.fillText(act > 0.15 ? "ACTIVE" : this.state === "offline" ? "STANDBY" : "ONLINE", lx, y + 6);
      g.font = `500 10px "Barlow Condensed", "Barlow", sans-serif`;
    }
  }

  private drawDeploy(cx: number, cy: number) {
    const g = this.ctx; const d = this.deploy!;
    const path = [{ x: cx, y: cy }, ...(["REPOSITORY", "NETWORK", "DEPLOYMENT"] as SideNode[]).map((n) => { const s = this.side.get(n)!; return { x: s.x + (cx - this.cx) * 0.5, y: s.y + (cy - this.cy) * 0.5 }; })];
    const lens = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const at = (s: number) => {
      let dist = s * total;
      for (let i = 0; i < lens.length; i++) { if (dist <= lens[i]) { const t = dist / lens[i]; return { x: lerp(path[i].x, path[i + 1].x, t), y: lerp(path[i].y, path[i + 1].y, t), seg: i }; } dist -= lens[i]; }
      return { ...path[path.length - 1], seg: lens.length - 1 };
    };
    // nodes activate one after another as the stream's head reaches them
    const head = Math.min(1, d.t * 0.45);
    let acc = 0;
    (["REPOSITORY", "NETWORK", "DEPLOYMENT"] as SideNode[]).forEach((n, i) => { acc += lens[i] / total; if (head >= acc - 0.001) this.activate(n); });
    const fade = d.done ? 1 - span(d.done, 0.4, 2) : 1;
    g.strokeStyle = rgba(this.pal.a, 0.14 * fade); g.lineWidth = 1; g.beginPath();
    const h = at(head); g.moveTo(path[0].x, path[0].y);
    for (let i = 1; i <= h.seg; i++) g.lineTo(path[i].x, path[i].y);
    g.lineTo(h.x, h.y); g.stroke();
    const sprite = this.glowSprite();
    for (const p of this.deployStream) {
      const s = Math.min(p.s, head);
      const pos = at(s);
      g.globalAlpha = 0.8 * fade; g.drawImage(sprite, pos.x - 4 + p.off * 3, pos.y - 4 + p.off * 3, 8, 8);
    }
    g.globalAlpha = 1;
  }

  private drawText(cx: number, cy: number, bt: number) {
    const g = this.ctx; const R = this.R;
    const size = Math.round(R * 0.36);
    // Boot: particles gather into the letters, then the crisp word takes over.
    if (this.booting && bt > 4.2 && bt < 5.9 && this.textPts.length) {
      const fly = span(bt, 4.2, 5.1); const fade = 1 - span(bt, 5.2, 5.9);
      g.fillStyle = rgba(this.pal.hi, 0.85 * fade);
      for (const p of this.textPts) {
        const e = easeInOut(span(fly, p.d, p.d + 0.65));
        const x = lerp(cx + p.sx, cx + p.x, e), y = lerp(cy + p.sy, cy + p.y, e);
        g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
    }
    if (this.textAlpha < 0.01) return;
    g.globalCompositeOperation = "source-over";
    g.font = `600 ${size}px "Barlow Condensed", "Barlow", sans-serif`;
    g.textAlign = "left"; g.textBaseline = "middle";
    const letters = "ULTRON".split(""); const spacing = size * 0.2;
    const widths = letters.map((l) => g.measureText(l).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
    let x = cx - total / 2;
    g.shadowColor = rgba(this.pal.a, 0.9); g.shadowBlur = 18;
    const grad = g.createLinearGradient(cx, cy - size / 2, cx, cy + size / 2);
    grad.addColorStop(0, rgba(WHITE, this.textAlpha)); grad.addColorStop(1, rgba(mix(this.pal.a, WHITE, 0.5), this.textAlpha * 0.85));
    g.fillStyle = grad;
    letters.forEach((l, i) => { g.fillText(l, x, cy); x += widths[i] + spacing; });
    g.shadowBlur = 0;
    g.font = `500 ${Math.max(9, Math.round(size * 0.16))}px "Barlow Condensed", "Barlow", sans-serif`;
    g.textAlign = "center";
    g.fillStyle = rgba([210, 230, 245], this.textAlpha * 0.75);
    g.fillText(spaced("AUTONOMOUS DEVELOPER INTELLIGENCE"), cx, cy + size * 0.62);
    g.globalCompositeOperation = "lighter";
  }
}

/** Letter-spaced label text (canvas letterSpacing isn't everywhere yet). */
function spaced(s: string) { return s.split("").join(" "); }
