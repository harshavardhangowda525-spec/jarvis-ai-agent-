/**
 * JARVIS motion engine — a canvas "visual intelligence", deliberately unlike
 * ULTRON's central reactor. Its signature is a horizontal LIVING DATA RIBBON
 * across the screen that keeps morphing LINE → WAVE → PARTICLES → NETWORK → WAVE,
 * surrounded by a quiet atmosphere (fog, drifting dust, a distant moving grid,
 * slow light streaks, data fragments).
 *
 * States change how everything moves: listening (mic-reactive ribbon + a brief
 * circular audio form), thinking (the ribbon splits into streams feeding
 * UNDERSTAND / PLAN / EXECUTE / VERIFY nodes, then merges), executing (data
 * streaks), research (a knowledge network that brightens what matters, then
 * compresses), speaking (driven by JARVIS's own voice level). One-off moments —
 * intro, complete, anomaly, agent hand-offs, the website-building sequence and a
 * command turning into particles — are method calls. No React inside.
 */

export type JState = "idle" | "listening" | "thinking" | "executing" | "research" | "speaking";
export type AgentName = "ULTRON" | "DARWIN" | "EV";
export interface Pt { x: number; y: number }

export interface MotionCallbacks {
  /** Intro beats: "logo" (JARVIS compressed into its mark), "online" (type SYSTEM ONLINE), "done". */
  onIntro?: (phase: "logo" | "online" | "done") => void;
  /** Where the anomaly label should appear (stage coordinates). */
  onAnomaly?: (at: Pt) => void;
  /** Thinking: the four nodes merged — show PROCESSING. */
  onProcessing?: () => void;
  /** Build sequence finished assembling — show "ULTRON ACTIVE". */
  onBuildReady?: () => void;
  /** Positions of the hub + agent nodes (for crisp DOM labels / click targets). */
  onLayout?: (l: { hub: Pt; agents: Record<AgentName, Pt>; ribbonY: number }) => void;
}

type RGB = [number, number, number];
const CYAN: RGB = [110, 220, 255];
const BLUE: RGB = [70, 140, 255];
const WHITE: RGB = [238, 248, 255];
const VIOLET: RGB = [160, 140, 255];
const AMBER: RGB = [255, 184, 92];

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (cur: number, target: number, k: number) => cur + (target - cur) * k;

interface Flow { u: number; v: number; sp: number; size: number; tw: number; ix: number; iy: number; ivx: number; ivy: number }
interface Dust { x: number; y: number; z: number; vx: number; vy: number; tw: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: 0 | 1 | 2 | 3 }
interface Frag { x: number; y: number; vy: number; life: number; max: number; glyph: string }
interface Streak { y: number; x: number; len: number; sp: number; life: number; max: number; a: number }
interface HWave { y: number; half: number; sp: number; life: number; max: number }
interface Ripple { r: number; sp: number; life: number; max: number }
interface Node3 { x: number; y: number; z: number; rel: number; relT: number; ph: number }
interface Flight { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; delay: number; c: 0 | 1 | 2 }
interface Seg { x0: number; y0: number; x1: number; y1: number }

const GLYPHS = ["0x1F", "∑", "λ", "{ }", "01", "Δ", "⊕", "://", "10", "π", "#", "∞", "fn", "≈", "<>", "::"];
const THINK_WORDS = ["UNDERSTAND", "PLAN", "EXECUTE", "VERIFY"];
const AGENTS: AgentName[] = ["ULTRON", "DARWIN", "EV"];

export class JarvisMotionEngine {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D; // swapped briefly while painting the atmosphere layer
  private cb: MotionCallbacks;
  private cssTarget: HTMLElement | null;
  private raf = 0; private running = false;
  private W = 1; private H = 1; private dpr = 1;
  private cx = 0; private ry = 0; private x0 = 0; private x1 = 0;
  private t = 0; private last = 0; private timeScale = 1;
  private reduced = false;
  private quality = 1; private slow = 0; private fast = 0;

  // state
  private state: JState = "idle";
  private stateT = 0;
  private prevState: JState = "idle";
  private mic = 0; private micRaw = 0; private micPeak = 0;
  private voice = 0; private voiceGetter: (() => number) | null = null; private voicePeak = 0;
  private energy = 0.5; private flowSpeed = 1; private amp = 12; private spread = 4; private zoom = 1;
  private ptr = { x: -9999, y: -9999, on: false, sx: 0, sy: 0 };
  private phase = 0; // ribbon wave phase

  // intro
  private intro = true; private introT = 0; private introBeats = { logo: false, online: false, done: false };
  private introPanels: { x: number; y: number; w: number; h: number; d: number }[] = [];
  private introLines: Seg[] = [];
  private textPts: { x: number; y: number; sx: number; sy: number; d: number }[] = [];

  // scene
  private flow: Flow[] = [];
  private dust: Dust[] = [];
  private sparks: Spark[] = [];
  private frags: Frag[] = [];
  private streaks: Streak[] = [];
  private hwaves: HWave[] = [];
  private ripples: Ripple[] = [];
  private netNodes: { u: number; v: number; ph: number }[] = [];
  private lastFrag = 0; private lastStreak = 0; private lastHWave = 0;

  // thinking
  private thinkNodes: Pt[] = [];
  private thinkMerged = false;
  // research
  private research: { t: number; nodes: Node3[]; edges: [number, number][]; pulses: { e: number; p: number }[]; end: number } | null = null;
  // complete
  private complete: { t: number; pts: { x: number; y: number; sx: number; sy: number; d: number }[] } | null = null;
  // anomaly
  private anomaly: { t: number; u0: number; u1: number } | null = null;
  private amberT = 0;
  // agents
  private agentAct: Record<AgentName, number> = { ULTRON: 0, DARWIN: 0, EV: 0 };
  private flights: Flight[] = [];
  // build sequence (developer agent)
  private build: { t: number; segs: (Seg & { d: number })[]; box: { x: number; y: number; w: number; h: number }; ready: boolean } | null = null;

  private sprite: HTMLCanvasElement | null = null;
  private atmo: HTMLCanvasElement | null = null;
  private atmoAge = 99;
  private panelAct: Record<string, number> = { system: 0, ready: 0, analyze: 0, build: 0, research: 0 };
  private sinceIntro = 0;

  constructor(canvas: HTMLCanvasElement, cb: MotionCallbacks = {}, cssTarget: HTMLElement | null = null) {
    this.canvas = canvas;
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("Canvas 2D is not available.");
    this.g = g;
    this.cb = cb;
    this.cssTarget = cssTarget;
    this.reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    this.seed();
    if (this.reduced) this.skipIntro();
  }

  // ============================== public API ==============================

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
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.W * this.H > 2_000_000 ? 1.25 : 1.5);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.cx = this.W / 2; this.ry = this.H * 0.47;
    this.x0 = this.W * 0.04; this.x1 = this.W * 0.96;
    this.layoutThink();
    this.buildText();
    this.atmoAge = 99;
    this.cb.onLayout?.({ hub: this.hub(), agents: this.agentPos(), ribbonY: this.ry });
  }

  setState(s: JState) {
    if (s === this.state) return;
    this.prevState = this.state;
    this.state = s;
    this.stateT = 0;
    if (s === "thinking") this.thinkMerged = false;
    if (s === "listening") { this.ripples.push({ r: 12, sp: 180, life: 0, max: 1.1 }); }
    if (s === "research" && !this.research) this.startResearch();
    if (s !== "research" && this.research && !this.research.end) this.research.end = 0.0001;
  }
  setMicLevel(v: number) { this.micRaw = clamp(v * 3.2); }
  setVoiceLevelGetter(fn: (() => number) | null) { this.voiceGetter = fn; }
  setPointer(x: number, y: number) { this.ptr.x = x; this.ptr.y = y; this.ptr.on = true; }
  clearPointer() { this.ptr.on = false; }

  skipIntro() {
    this.intro = false; this.introT = 99;
    if (!this.introBeats.logo) { this.introBeats.logo = true; this.cb.onIntro?.("logo"); }
    if (!this.introBeats.online) { this.introBeats.online = true; this.cb.onIntro?.("online"); }
    if (!this.introBeats.done) { this.introBeats.done = true; this.cb.onIntro?.("done"); }
  }

  /** The task finished: slow down, converge, a bright line + wave, particles form COMPLETE, dissolve. */
  taskComplete() {
    if (this.reduced) { this.ripples.push({ r: 20, sp: 400, life: 0, max: 1 }); return; }
    const pts = this.sampleWord("COMPLETE", Math.min(this.W * 0.085, 88), this.cx, this.ry, 0.16, "600", "center", 26);
    this.complete = { t: 0, pts: pts.map((p) => ({ ...p, sx: rand(this.x0, this.x1), sy: this.ry + rand(-6, 6) })) };
  }

  /** Something failed: freeze, a distortion travels across, the section turns amber, ANOMALY DETECTED. */
  anomalyDetected() {
    const u0 = rand(0.45, 0.62);
    this.anomaly = { t: 0, u0, u1: u0 + 0.16 };
    this.amberT = 3.4;
  }

  /** A data stream travels from JARVIS to an agent; its node expands. */
  activateAgent(name: AgentName) {
    const a = this.agentPos()[name]; const h = this.hub();
    this.agentAct[name] = 1.6;
    for (let i = 0; i < 46; i++) this.flights.push({ x0: h.x, y0: h.y, x1: a.x, y1: a.y, t: 0, dur: rand(0.55, 0.9), delay: i * 0.012, c: 0 });
  }
  /** Results travel back from an agent to JARVIS as particles. */
  agentReturn(name: AgentName) {
    const a = this.agentPos()[name]; const h = this.hub();
    this.agentAct[name] = Math.max(this.agentAct[name], 0.8);
    for (let i = 0; i < 40; i++) this.flights.push({ x0: a.x, y0: a.y, x1: h.x, y1: h.y, t: 0, dur: rand(0.6, 1), delay: i * 0.015, c: 2 });
  }

  /** Developer agent: a holographic canvas where a website assembles itself from particles. */
  buildWebsite() {
    const w = Math.min(this.W * 0.42, 560), h = Math.min(this.H * 0.34, 300);
    const box = { x: this.cx - w / 2, y: this.ry - h - 36, w, h };
    const segs: (Seg & { d: number })[] = [];
    const rect = (x: number, y: number, rw: number, rh: number, d: number) => {
      segs.push({ x0: x, y0: y, x1: x + rw, y1: y, d }, { x0: x + rw, y0: y, x1: x + rw, y1: y + rh, d }, { x0: x + rw, y0: y + rh, x1: x, y1: y + rh, d }, { x0: x, y0: y + rh, x1: x, y1: y, d });
    };
    const X = box.x, Y = box.y;
    // layout grid
    for (let i = 1; i < 6; i++) segs.push({ x0: X + (w * i) / 6, y0: Y + 4, x1: X + (w * i) / 6, y1: Y + h - 4, d: 0.05 });
    // navigation
    rect(X + 10, Y + 10, w - 20, h * 0.1, 0.15);
    for (let i = 0; i < 4; i++) rect(X + w - 20 - (i + 1) * w * 0.09, Y + 10 + h * 0.035, w * 0.06, h * 0.03, 0.25);
    // hero section + image + button
    rect(X + 10, Y + h * 0.16, w * 0.52, h * 0.3, 0.35);
    segs.push({ x0: X + 22, y0: Y + h * 0.22, x1: X + w * 0.4, y1: Y + h * 0.22, d: 0.45 }, { x0: X + 22, y0: Y + h * 0.28, x1: X + w * 0.34, y1: Y + h * 0.28, d: 0.5 });
    rect(X + 22, Y + h * 0.35, w * 0.12, h * 0.07, 0.55);
    rect(X + w * 0.6, Y + h * 0.16, w * 0.36, h * 0.3, 0.4);
    segs.push({ x0: X + w * 0.6, y0: Y + h * 0.46, x1: X + w * 0.96, y1: Y + h * 0.16, d: 0.5 }, { x0: X + w * 0.6, y0: Y + h * 0.16, x1: X + w * 0.96, y1: Y + h * 0.46, d: 0.5 });
    // cards
    for (let i = 0; i < 3; i++) { const cw = (w - 40) / 3; rect(X + 10 + i * (cw + 10), Y + h * 0.52, cw, h * 0.3, 0.6 + i * 0.08); segs.push({ x0: X + 20 + i * (cw + 10), y0: Y + h * 0.58, x1: X + i * (cw + 10) + cw * 0.7, y1: Y + h * 0.58, d: 0.75 + i * 0.05 }); }
    // footer section
    rect(X + 10, Y + h * 0.87, w - 20, h * 0.08, 0.85);
    this.build = { t: 0, segs, box, ready: false };
    this.activateAgent("ULTRON");
  }

  /** Typed characters make tiny bursts at (x, y). */
  keystroke(x: number, y: number) {
    if (this.reduced) return;
    for (let i = 0; i < 5; i++) this.sparks.push({ x: x + rand(-3, 3), y: y + rand(-4, 4), vx: rand(-30, 30), vy: rand(-45, 10), life: 0, max: rand(0.35, 0.7), size: rand(0.6, 1.3), c: 0 });
  }

  /** A submitted command dissolves into particles that fly up into the ribbon. */
  commandToParticles(text: string, rect: { x: number; y: number; w: number; h: number }) {
    if (this.reduced || !text.trim()) return;
    const size = 14;
    const pts = this.sampleWord(text.slice(0, 60), size, 0, 0, 0, "400", "left");
    const target = { x: this.cx, y: this.ry };
    for (const p of pts.slice(0, 520)) {
      const x = rect.x + 14 + p.x, y = rect.y + rect.h / 2 + p.y;
      if (x > rect.x + rect.w - 20) continue;
      this.flights.push({ x0: x, y0: y, x1: target.x + rand(-this.W * 0.18, this.W * 0.18), y1: target.y + rand(-10, 10), t: 0, dur: rand(0.7, 1.1), delay: rand(0, 0.18), c: 1 });
    }
    this.ripples.push({ r: 8, sp: 240, life: 0, max: 0.9 });
  }

  // ============================== setup ==============================

  private seed() {
    const small = this.W < 700;
    this.flow = Array.from({ length: small ? 260 : 620 }, () => this.newFlow(true));
    this.dust = Array.from({ length: small ? 80 : 170 }, () => ({ x: rand(0, 1), y: rand(0, 1), z: rand(0.15, 1), vx: rand(-0.004, 0.006), vy: rand(-0.003, 0.003), tw: rand(0, 6) }));
    const nNet = small ? 16 : 28;
    this.netNodes = Array.from({ length: nNet }, (_, i) => ({ u: (i + 0.5) / nNet + rand(-0.012, 0.012), v: rand(-1, 1), ph: rand(0, 6) }));
    // intro architecture: glass panels + long lines that draw themselves
    const W = this.W, H = this.H;
    this.introPanels = [
      { x: W * 0.08, y: H * 0.16, w: W * 0.2, h: H * 0.16, d: 0 },
      { x: W * 0.72, y: H * 0.12, w: W * 0.2, h: H * 0.2, d: 0.12 },
      { x: W * 0.1, y: H * 0.62, w: W * 0.18, h: H * 0.13, d: 0.22 },
      { x: W * 0.7, y: H * 0.6, w: W * 0.22, h: H * 0.15, d: 0.3 },
      { x: W * 0.38, y: H * 0.14, w: W * 0.24, h: H * 0.1, d: 0.18 },
    ];
    this.introLines = [
      { x0: 0, y0: H * 0.3, x1: W, y1: H * 0.3 }, { x0: 0, y0: H * 0.66, x1: W, y1: H * 0.66 },
      { x0: W * 0.3, y0: 0, x1: W * 0.3, y1: H }, { x0: W * 0.7, y0: 0, x1: W * 0.7, y1: H },
    ];
  }

  private newFlow(initial = false): Flow {
    return { u: initial ? Math.random() : rand(-0.05, 0), v: (Math.random() - 0.5) * 2, sp: rand(0.025, 0.07), size: Math.random() < 0.08 ? rand(1.4, 2.2) : rand(0.5, 1.2), tw: rand(0, 6), ix: 0, iy: 0, ivx: rand(-40, 40), ivy: rand(-80, 80) };
  }

  private layoutThink() {
    // UNDERSTAND / PLAN / VERIFY / EXECUTE ring the centre of the ribbon.
    const r = Math.min(this.W * 0.13, 170), h = Math.min(this.H * 0.075, 52);
    this.thinkNodes = [
      { x: this.cx - r, y: this.ry - h }, { x: this.cx + r, y: this.ry - h },
      { x: this.cx + r * 1.08, y: this.ry + 4 }, { x: this.cx + r, y: this.ry + h + 6 },
    ];
  }

  /** The JARVIS node sits just below the ribbon, its agents around it. */
  private hub(): Pt { return { x: this.cx, y: this.ry + this.H * 0.2 }; }
  private agentPos(): Record<AgentName, Pt> {
    const W = this.W, H = this.H; const h = this.hub(); const k = W < 700 ? W * 2.1 : Math.min(W, 1500);
    return {
      ULTRON: { x: h.x - k * 0.075, y: h.y - H * 0.085 },
      DARWIN: { x: h.x + k * 0.1, y: h.y - H * 0.03 },
      EV: { x: h.x + k * 0.085, y: h.y + H * 0.06 },
    };
  }

  /** Floating glass panels (they form during the intro and stay, lighting up with their state). */
  private panelDefs() {
    const W = this.W, H = this.H;
    return [
      { key: "system", label: "SYSTEM ONLINE", x: W * 0.14, y: H * 0.09, w: W * 0.2, h: H * 0.22, skew: -1 },
      { key: "ready", label: "READY", x: W * 0.41, y: H * 0.12, w: W * 0.18, h: H * 0.17, skew: 0 },
      { key: "analyze", label: "ANALYZING", x: W * 0.66, y: H * 0.09, w: W * 0.2, h: H * 0.22, skew: 1 },
      { key: "build", label: "", x: W * 0.14, y: H * 0.63, w: W * 0.2, h: H * 0.22, skew: -1 },
      { key: "research", label: "RESEARCH", x: W * 0.66, y: H * 0.64, w: W * 0.2, h: H * 0.21, skew: 1 },
    ] as const;
  }

  /** Sample text into points (relative to x, y). */
  private sampleWord(word: string, size: number, x: number, y: number, spacingEm = 0.12, weight = "300", align: "center" | "left" = "center", density = 22) {
    if (typeof document === "undefined") return [] as { x: number; y: number; sx: number; sy: number; d: number }[];
    const off = document.createElement("canvas");
    const g = off.getContext("2d");
    if (!g) return [];
    const font = `${weight} ${size}px "Barlow", "Barlow Condensed", system-ui, sans-serif`;
    g.font = font;
    const letters = word.split("");
    const widths = letters.map((l) => g.measureText(l).width);
    const sp = size * spacingEm;
    const total = widths.reduce((a, b) => a + b, 0) + sp * (letters.length - 1);
    off.width = Math.ceil(total + 8); off.height = Math.ceil(size * 1.4);
    g.font = font; g.fillStyle = "#fff"; g.textBaseline = "middle";
    let cx = 4;
    letters.forEach((l, i) => { g.fillText(l, cx, off.height / 2); cx += widths[i] + sp; });
    const img = g.getImageData(0, 0, off.width, off.height).data;
    const step = Math.max(1, Math.round(size / density));
    const pts: { x: number; y: number; sx: number; sy: number; d: number }[] = [];
    const ox = align === "center" ? -off.width / 2 : 0;
    for (let yy = 0; yy < off.height; yy += step) for (let xx = 0; xx < off.width; xx += step) {
      if (img[(yy * off.width + xx) * 4 + 3] > 120) pts.push({ x: x + xx + ox, y: y + yy - off.height / 2, sx: 0, sy: 0, d: rand(0, 0.3) });
    }
    return pts.length > 2200 ? pts.filter((_, i) => i % 2 === 0) : pts;
  }

  private buildText() {
    const size = Math.min(this.W * 0.11, 150);
    this.textPts = this.sampleWord("JARVIS", size, this.cx, this.ry - size * 0.05, 0.42, "200").map((p) => ({ ...p, sx: rand(this.x0, this.x1), sy: this.ry + rand(-3, 3) }));
  }

  private glow(): HTMLCanvasElement {
    if (this.sprite) return this.sprite;
    const s = document.createElement("canvas"); s.width = s.height = 32;
    const g = s.getContext("2d")!;
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(150,225,255,0.75)"); gr.addColorStop(1, "rgba(80,160,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.sprite = s;
    return s;
  }

  private startResearch() {
    const small = this.W < 700;
    const n = small ? 70 : 150;
    const nodes: Node3[] = Array.from({ length: n }, () => {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random());
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: rand(0.3, 1), rel: 0.5, relT: Math.random() < 0.18 ? 1 : 0.12, ph: rand(0, 6) };
    });
    const edges: [number, number][] = [];
    nodes.forEach((p, i) => {
      const near = nodes.map((q, j) => ({ j, d: (q.x - p.x) ** 2 + (q.y - p.y) ** 2 })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
      for (const o of near) if (i < o.j) edges.push([i, o.j]);
    });
    this.research = { t: 0, nodes, edges, pulses: [], end: 0 };
  }

  // ============================== simulation ==============================

  private adapt(dt: number) {
    if (dt > 0.028) { this.slow++; this.fast = 0; } else { this.fast++; this.slow = Math.max(0, this.slow - 1); }
    if (this.slow > 45 && this.quality > 0.45) { this.quality = Math.max(0.45, this.quality - 0.2); this.slow = 0; }
    if (this.fast > 600 && this.quality < 1) { this.quality = Math.min(1, this.quality + 0.1); this.fast = 0; }
  }

  /** The ribbon's centre line at u (0..1) — shared by every layer. */
  private ribbonY(u: number, strand = 0) {
    const env = Math.pow(Math.sin(Math.PI * clamp(u)), 0.8);
    const p = this.phase + strand * 0.35;
    let y = (Math.sin(u * Math.PI * 2 * 1.3 - p * 1.1) * 0.6 + Math.sin(u * Math.PI * 2 * 2.7 + p * 0.7) * 0.28 + Math.sin(u * Math.PI * 2 * 6.1 - p * 1.9) * 0.12) * this.amp * env * (1 - strand * 0.1);
    const x = lerp(this.x0, this.x1, u);
    // cursor bends the light
    if (this.ptr.on) {
      const dy = this.ptr.y - this.ry;
      if (Math.abs(dy) < 220) y += dy * 0.18 * Math.exp(-(((x - this.ptr.x) / 140) ** 2)) * (1 - Math.abs(dy) / 220);
    }
    // anomaly distortion band
    if (this.anomaly) {
      const a = this.anomaly; const bx = lerp(this.x0 - 80, this.x1 + 80, span(a.t, 0.25, 1.2));
      if (a.t > 0.25 && a.t < 1.25) y += Math.sin(x * 0.35 + this.t * 60) * 9 * Math.exp(-(((x - bx) / 50) ** 2));
    }
    // completion wave riding the bright line
    if (this.complete) {
      const c = this.complete.t; const lx = lerp(this.x0 - 60, this.x1 + 60, span(c, 0.35, 0.95));
      if (c > 0.3 && c < 1.3) y += Math.sin((x - lx) * 0.05) * 34 * Math.exp(-(((x - lx) / 90) ** 2)) * (1 - span(c, 0.95, 1.3));
    }
    return this.ry + y;
  }

  private step(rawDt: number) {
    // brief freeze when an anomaly hits
    this.timeScale = this.anomaly && this.anomaly.t < 0.25 ? 0.02 : this.complete && this.complete.t < 0.4 ? lerp(1, 0.3, span(this.complete.t, 0, 0.4)) : 1;
    const dt = rawDt * this.timeScale;
    this.t += dt; this.stateT += rawDt;
    const k = 1 - Math.pow(0.03, rawDt);
    if (this.intro) this.stepIntro(rawDt);

    // levels
    const listening = this.state === "listening";
    this.mic = smooth(this.mic, listening ? this.micRaw : 0, this.micRaw > this.mic ? 0.45 : 0.1);
    const vRaw = this.state === "speaking" && this.voiceGetter ? clamp(this.voiceGetter()) : 0;
    this.voice = smooth(this.voice, vRaw, vRaw > this.voice ? 0.55 : 0.18);
    if (listening && this.mic > this.micPeak + 0.14) this.ripples.push({ r: 30 + this.mic * 40, sp: 160 + this.mic * 300, life: 0, max: 1 });
    this.micPeak = smooth(this.micPeak, this.mic, 0.04);
    if (this.state === "speaking" && this.voice > this.voicePeak + 0.18 && this.t - this.lastHWave > 0.18) {
      this.lastHWave = this.t;
      this.hwaves.push({ y: this.ry + rand(-4, 4), half: 10, sp: 500 + this.voice * 900, life: 0, max: 0.9 });
    }
    this.voicePeak = smooth(this.voicePeak, this.voice, 0.06);
    if (this.cssTarget) this.cssTarget.style.setProperty("--jv-level", (Math.max(this.voice, this.mic)).toFixed(3));

    // idle morph cycle: LINE → WAVE → PARTICLES → NETWORK → WAVE (30s)
    const w = this.morphWeights();
    const s = this.state;
    const ampT =
      s === "listening" ? 20 + this.mic * 90
      : s === "speaking" ? 12 + this.voice * 80
      : s === "thinking" ? (this.thinkMerged ? 6 : 10)
      : s === "executing" ? 9
      : s === "research" ? 7
      : lerp(4, 26, w.wave + w.network * 0.5);
    this.amp = smooth(this.amp, ampT, k * 0.9);
    const spreadT = s === "listening" ? 6 + this.mic * 40 : s === "speaking" ? 5 + this.voice * 30 : 3 + w.particles * 16;
    this.spread = smooth(this.spread, spreadT, k);
    const speedT = s === "executing" ? 3.4 : s === "thinking" ? (this.thinkMerged ? 2.6 : 1.4) : s === "research" ? 1.6 : s === "speaking" ? 1.2 + this.voice * 1.5 : s === "listening" ? 1.1 + this.mic : 1;
    this.flowSpeed = smooth(this.flowSpeed, speedT, k * 0.6);
    const eT = s === "idle" ? 0.72 : s === "speaking" ? 0.7 + this.voice * 0.4 : s === "listening" ? 0.75 + this.mic * 0.5 : 0.85;
    this.energy = smooth(this.energy, eT + (this.complete ? 0.4 : 0), k);
    const zT = s === "idle" ? 1 : 1.035;
    this.zoom = smooth(this.zoom, zT, k * 0.25);
    this.phase += dt * (0.55 + this.flowSpeed * 0.25);
    this.ptr.sx = smooth(this.ptr.sx, this.ptr.on ? this.ptr.x - this.cx : 0, k * 0.4);
    this.ptr.sy = smooth(this.ptr.sy, this.ptr.on ? this.ptr.y - this.ry : 0, k * 0.4);

    // thinking: merge after the four nodes have been shown
    if (s === "thinking" && !this.thinkMerged && this.stateT > 2.6) { this.thinkMerged = true; this.cb.onProcessing?.(); }

    // flow particles
    for (const f of this.flow) {
      f.u += f.sp * dt * this.flowSpeed * 0.35;
      if (f.u > 1.05) Object.assign(f, this.newFlow());
    }
    // detaching fragments + drifting data fragments
    if (!this.intro && this.t - this.lastFrag > (s === "idle" ? 0.9 : 0.4) && this.frags.length < 26) {
      this.lastFrag = this.t;
      const u = rand(0.1, 0.9);
      this.frags.push({ x: lerp(this.x0, this.x1, u), y: this.ribbonY(u), vy: rand(-22, -8) * (Math.random() < 0.5 ? 1 : -1), life: 0, max: rand(2.2, 4), glyph: Math.random() < 0.55 ? "" : GLYPHS[(Math.random() * GLYPHS.length) | 0] });
    }
    this.frags = this.frags.filter((f) => { f.life += dt; f.y += f.vy * dt; f.x += Math.sin(f.life * 2 + f.y) * 6 * dt; return f.life < f.max; });
    // slow light streaks across the background (+ quicker ones while speaking)
    const streakEvery = s === "speaking" ? 0.35 : 6;
    if (!this.intro && this.t - this.lastStreak > streakEvery && this.streaks.length < 8) {
      this.lastStreak = this.t;
      const fast = s === "speaking";
      this.streaks.push({ y: fast ? this.ry + rand(-60, 60) : rand(this.H * 0.1, this.H * 0.9), x: -0.2, len: fast ? rand(0.08, 0.2) : rand(0.2, 0.4), sp: fast ? rand(0.9, 1.6) : rand(0.05, 0.09), life: 0, max: 20, a: fast ? 0.25 + this.voice * 0.4 : rand(0.05, 0.1) });
    }
    this.streaks = this.streaks.filter((st) => { st.x += st.sp * dt; st.life += dt; return st.x - st.len < 1.1; });
    this.hwaves = this.hwaves.filter((h) => { h.life += dt; h.half += h.sp * dt; return h.life < h.max; });
    this.ripples = this.ripples.filter((r) => { r.life += dt; r.r += r.sp * dt; return r.life < r.max; });
    this.sparks = this.sparks.filter((p) => { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.35, dt); p.vy *= Math.pow(0.35, dt); return p.life < p.max; });
    for (const d of this.dust) { d.x += d.vx * dt; d.y += d.vy * dt; if (d.x < -0.05) d.x = 1.05; if (d.x > 1.05) d.x = -0.05; if (d.y < -0.05) d.y = 1.05; if (d.y > 1.05) d.y = -0.05; }
    // flights (agent streams, command particles)
    this.flights = this.flights.filter((f) => (f.t += rawDt) < f.delay + f.dur);
    for (const a of AGENTS) this.agentAct[a] = Math.max(0, this.agentAct[a] - rawDt * 0.45);
    this.amberT = Math.max(0, this.amberT - rawDt);

    // research network
    if (this.research) {
      const r = this.research; r.t += rawDt;
      if (r.end) { r.end += rawDt; if (r.end > 1.6) this.research = null; }
      else {
        for (const n of r.nodes) n.rel = smooth(n.rel, r.t > 1.2 ? n.relT : 0.5, k * 0.5);
        if (r.pulses.length < 40 && Math.random() < 0.6) r.pulses.push({ e: (Math.random() * r.edges.length) | 0, p: 0 });
      }
      r.pulses = r.pulses.filter((p) => (p.p += rawDt * 1.6) < 1);
    }
    if (this.complete) { this.complete.t += rawDt; if (this.complete.t > 3.0) this.complete = null; }
    if (this.anomaly) {
      this.anomaly.t += rawDt;
      if (this.anomaly.t > 0.3 && this.anomaly.t - rawDt <= 0.3) {
        const u = (this.anomaly.u0 + this.anomaly.u1) / 2;
        this.cb.onAnomaly?.({ x: lerp(this.x0, this.x1, u), y: this.ribbonY(u) });
      }
      if (this.anomaly.t > 2.4) this.anomaly = null;
    }
    // Panels glow when their state is live, and rest as faint glass otherwise.
    if (!this.intro) this.sinceIntro += rawDt;
    const want: Record<string, number> = {
      system: this.sinceIntro < 4.5 ? 1 : 0.18,
      ready: s === "idle" ? 0.75 : 0.2,
      analyze: s === "thinking" || s === "research" ? 1 : 0.18,
      build: this.build || s === "executing" ? 1 : 0.16,
      research: s === "research" || this.research ? 1 : 0.16,
    };
    for (const key of Object.keys(want)) this.panelAct[key] = smooth(this.panelAct[key], want[key], k * 0.5);
    if (this.build) {
      this.build.t += rawDt;
      if (!this.build.ready && this.build.t > 1.9) { this.build.ready = true; this.cb.onBuildReady?.(); }
      if (this.build.t > 4.2) this.build = null;
    }
  }

  private stepIntro(dt: number) {
    this.introT += dt;
    const t = this.introT;
    if (t > 5.0 && !this.introBeats.logo) { this.introBeats.logo = true; this.cb.onIntro?.("logo"); }
    if (t > 5.5 && !this.introBeats.online) { this.introBeats.online = true; this.cb.onIntro?.("online"); }
    if (t > 6.6) { this.intro = false; if (!this.introBeats.done) { this.introBeats.done = true; this.cb.onIntro?.("done"); } }
  }

  private morphWeights() {
    const cycle = 30, seg = 6, fade = 2.2;
    const order = ["line", "wave", "particles", "network", "wave"] as const;
    const tt = (this.t % cycle);
    const i = Math.floor(tt / seg); const local = tt - i * seg;
    const cur = order[i], next = order[(i + 1) % order.length];
    const x = easeInOut(span(local, seg - fade, seg));
    const w = { line: 0, wave: 0, particles: 0, network: 0 };
    w[cur] += 1 - x; w[next] += x;
    return w;
  }

  // ============================== drawing ==============================

  private draw() {
    const g = this.g; const W = this.W, H = this.H, q = this.quality;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#020306"; g.fillRect(0, 0, W, H);
    const it = this.intro ? this.introT : 99;
    const world = easeOut(span(it, 1.4, 4.5));

    // The slow atmosphere (fog, volumetric band, distant grid, dome, rays) moves
    // so gently that it's rendered at half resolution a few times a second and
    // blitted — soft layers stay soft, and the page stays light on the CPU.
    this.atmoAge++;
    if (!this.atmo || this.atmoAge >= 6 || this.intro) { this.renderAtmosphere(world); this.atmoAge = 0; }
    g.drawImage(this.atmo!, 0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    this.drawDust(world, q);
    for (const st of this.streaks) {
      const x1 = st.x * W, x0 = (st.x - st.len) * W;
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, rgba(WHITE, st.a * world));
      g.strokeStyle = gr; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, st.y); g.lineTo(x1, st.y); g.stroke();
    }

    // camera: gentle push-in when active, pull-back at rest
    g.save();
    g.translate(this.cx, this.ry); g.scale(this.zoom, this.zoom); g.translate(-this.cx - this.ptr.sx * 0.012, -this.ry - this.ptr.sy * 0.012);

    if (this.intro) this.drawIntro();
    else {
      if (this.W >= 760) this.drawPanels(1);
      this.drawCenterRing();
      this.drawConstellation();
      if (this.research) this.drawResearch();
      if (this.state === "thinking" || (this.prevState === "thinking" && this.stateT < 0.8)) this.drawThinking();
      this.drawRibbon(q);
      if (this.state === "listening" || this.mic > 0.02) this.drawListening();
      this.drawVoice();
      if (this.build) this.drawBuild();
      if (this.anomaly) this.drawAnomaly();
      if (this.complete) this.drawComplete();
    }
    for (const r of this.ripples) {
      g.strokeStyle = rgba(WHITE, (1 - r.life / r.max) * 0.35); g.lineWidth = 1;
      g.beginPath(); g.ellipse(this.cx, this.ry, r.r, r.r * 0.55, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();

    // screen-space: flights + sparks
    const spr = this.glow();
    for (const f of this.flights) {
      const p = clamp((f.t - f.delay) / f.dur); if (p <= 0) continue;
      const e = easeInOut(p);
      const mx = (f.x0 + f.x1) / 2, my = Math.min(f.y0, f.y1) - Math.abs(f.x1 - f.x0) * 0.12 - 30;
      const x = (1 - e) ** 2 * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1;
      const y = (1 - e) ** 2 * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1;
      const a = Math.sin(p * Math.PI) * 0.9;
      if (f.c === 1) { g.fillStyle = rgba(WHITE, a); g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); }
      else { g.globalAlpha = a; g.drawImage(spr, x - 5, y - 5, 10, 10); g.globalAlpha = 1; }
    }
    for (const s of this.sparks) {
      const a = 1 - s.life / s.max;
      g.fillStyle = rgba(s.c === 3 ? AMBER : s.c === 2 ? VIOLET : s.c === 1 ? WHITE : CYAN, a);
      g.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    g.globalCompositeOperation = "source-over";
  }

  private renderAtmosphere(world: number) {
    const W = this.W, H = this.H;
    const sc = 0.5;
    if (!this.atmo) this.atmo = document.createElement("canvas");
    const cw = Math.max(1, Math.round(W * sc)), ch = Math.max(1, Math.round(H * sc));
    if (this.atmo.width !== cw || this.atmo.height !== ch) { this.atmo.width = cw; this.atmo.height = ch; }
    const g = this.atmo.getContext("2d")!;
    g.setTransform(sc, 0, 0, sc, 0, 0);
    g.globalCompositeOperation = "source-over";
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#04070d"); bg.addColorStop(0.5, "#060b14"); bg.addColorStop(1, "#020306");
    g.fillStyle = "#020306"; g.fillRect(0, 0, W, H);
    g.globalAlpha = world; g.fillStyle = bg; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const fx = W * (0.25 + 0.5 * ((Math.sin(this.t * 0.013 + i * 2.1) + 1) / 2)) - this.ptr.sx * 0.02 * (i + 1);
      const fy = this.ry + H * 0.18 * Math.sin(this.t * 0.017 + i * 1.3) - this.ptr.sy * 0.02 * (i + 1);
      const fr = Math.max(W, H) * (0.35 + i * 0.08);
      const fog = g.createRadialGradient(fx, fy, 0, fx, fy, fr);
      const c = i === 1 ? VIOLET : i === 2 ? BLUE : CYAN;
      fog.addColorStop(0, rgba(c, (i === 1 ? 0.035 : 0.05) * world * (0.8 + this.energy * 0.4))); fog.addColorStop(1, rgba(c, 0));
      g.fillStyle = fog; g.fillRect(0, 0, W, H);
    }
    const band = g.createLinearGradient(0, this.ry - H * 0.25, 0, this.ry + H * 0.25);
    band.addColorStop(0, "rgba(0,0,0,0)"); band.addColorStop(0.5, rgba(BLUE, 0.08 * world * (0.7 + this.energy))); band.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = band; g.fillRect(0, this.ry - H * 0.25, W, H * 0.5);
    const main = this.g;
    this.g = g; // reuse the grid/dome painters on the atmosphere layer
    this.drawGrid(world);
    this.drawDome(world);
    this.g = main;
  }

  /** A vast faint dome (arcs) and light rays radiating from the centre — depth behind everything. */
  private drawDome(a: number) {
    const g = this.g; const W = this.W, H = this.H;
    const cx = this.cx - this.ptr.sx * 0.01, cy = this.ry - this.ptr.sy * 0.01;
    g.lineWidth = 1;
    for (const [rx, ry, al] of [[W * 0.46, H * 0.62, 0.07], [W * 0.5, H * 0.7, 0.04]] as const) {
      g.strokeStyle = rgba(CYAN, al * a); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.08, Math.PI * 0.92); g.stroke();
    }
    const n = 22;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.t * 0.006;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.4 + i * 1.9);
      const r0 = Math.min(W, H) * 0.34, r1 = Math.max(W, H) * 0.75;
      const x0 = cx + Math.cos(ang) * r0, y0 = cy + Math.sin(ang) * r0 * 0.6;
      const x1 = cx + Math.cos(ang) * r1, y1 = cy + Math.sin(ang) * r1 * 0.6;
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, rgba(WHITE, 0)); gr.addColorStop(0.3, rgba(WHITE, 0.05 * pulse * a)); gr.addColorStop(1, rgba(WHITE, 0));
      g.strokeStyle = gr; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  }

  /** Floating liquid-glass panels in perspective; each lights up with its state. */
  private drawPanels(appear: number, intro = false) {
    const g = this.g;
    const spr = this.glow();
    for (const [i, p] of this.panelDefs().entries()) {
      const a = intro ? easeOut(span(appear * 1.6 - i * 0.12, 0, 1)) : 1;
      if (a <= 0) continue;
      const act = intro ? 0.35 : this.panelAct[p.key];
      const depth = 0.03 + (i % 2) * 0.015;
      const x = p.x - this.ptr.sx * depth, y = p.y - this.ptr.sy * depth;
      const hh = p.h * a;
      const top = y + (p.h - hh) / 2;
      // perspective: the edge facing the centre is slightly shorter
      const inset = hh * 0.08 * Math.abs(p.skew);
      const L = p.skew > 0 ? inset : 0, R = p.skew < 0 ? inset : 0;
      g.beginPath();
      g.moveTo(x, top + L); g.lineTo(x + p.w, top + R); g.lineTo(x + p.w, top + hh - R); g.lineTo(x, top + hh - L); g.closePath();
      const fill = g.createLinearGradient(x, top, x + p.w, top + hh);
      fill.addColorStop(0, rgba(WHITE, (0.035 + act * 0.04) * a)); fill.addColorStop(1, rgba(BLUE, (0.02 + act * 0.05) * a));
      g.fillStyle = fill; g.fill();
      g.strokeStyle = rgba(WHITE, (0.12 + act * 0.3) * a); g.lineWidth = 0.8; g.stroke();
      // top highlight + glass reflection sweep
      g.strokeStyle = rgba(WHITE, (0.2 + act * 0.4) * a); g.beginPath(); g.moveTo(x + 8, top + L + 0.5); g.lineTo(x + p.w * 0.4, top + (L + R) * 0.2 + 0.5); g.stroke();
      // content rows (text-like lines)
      g.fillStyle = rgba(CYAN, (0.12 + act * 0.25) * a);
      const rows = p.key === "ready" ? 3 : 6;
      for (let r = 0; r < rows; r++) {
        const ry = top + 14 + r * (hh - 24) / rows;
        if (p.key === "system" || p.key === "ready" || r % 2 === 0) g.fillRect(x + 12, ry, p.w * (0.25 + ((r * 41 + i * 17) % 50) / 100) * a, 1);
      }
      if (p.key === "analyze" || p.key === "research") {
        // small knowledge graph inside the panel
        const cx = x + p.w * 0.72, cy = top + hh * 0.55, rr = Math.min(p.w, hh) * 0.28;
        const pts = Array.from({ length: 7 }, (_, j) => ({ x: cx + Math.cos(j * 2.4 + this.t * 0.2 * act) * rr * (0.4 + (j % 3) * 0.3), y: cy + Math.sin(j * 2.4 + this.t * 0.2 * act) * rr * (0.4 + (j % 3) * 0.3) }));
        g.strokeStyle = rgba(CYAN, (0.15 + act * 0.4) * a); g.beginPath();
        pts.forEach((q, j) => { const o = pts[(j + 2) % pts.length]; g.moveTo(q.x, q.y); g.lineTo(o.x, o.y); });
        g.stroke();
        for (const q of pts) { g.globalAlpha = (0.3 + act * 0.6) * a; g.drawImage(spr, q.x - 4, q.y - 4, 8, 8); }
        g.globalAlpha = 1;
      }
      if (p.key === "build") {
        // a website wireframe (the developer agent's canvas)
        g.strokeStyle = rgba(CYAN, (0.12 + act * 0.45) * a); g.lineWidth = 0.7;
        const bx = x + 12, by = top + 12, bw = p.w - 24, bh = hh - 24;
        g.strokeRect(bx, by, bw, bh * 0.14);
        g.strokeRect(bx, by + bh * 0.2, bw * 0.55, bh * 0.4); g.strokeRect(bx + bw * 0.6, by + bh * 0.2, bw * 0.4, bh * 0.4);
        for (let c = 0; c < 3; c++) g.strokeRect(bx + c * (bw / 3) + 2, by + bh * 0.66, bw / 3 - 4, bh * 0.3);
      }
      if (p.label) {
        const size = Math.max(12, Math.min(28, p.w * 0.11));
        g.font = `300 ${size}px "Barlow", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = rgba(WHITE, (0.18 + act * 0.75) * a);
        const lx = p.key === "analyze" || p.key === "research" ? x + p.w * 0.42 : x + p.w / 2;
        g.fillText(p.label.split("").join("\u200a"), lx, top + hh / 2);
      }
    }
  }

  /** A thin ring where the ribbon's centre is — it comes alive when JARVIS listens. */
  private drawCenterRing() {
    const g = this.g; const cx = this.cx, cy = this.ry;
    const live = this.state === "listening" ? 1 : this.state === "speaking" ? 0.5 : 0.2;
    const r = Math.min(this.W * 0.05, 62);
    g.lineWidth = 1;
    g.strokeStyle = rgba(WHITE, 0.18 + live * 0.35); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = rgba(CYAN, 0.25 + live * 0.4); g.setLineDash([2, 6]); g.lineDashOffset = -this.t * 12;
    g.beginPath(); g.arc(cx, cy, r + 9, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.strokeStyle = rgba(VIOLET, 0.25 + live * 0.5); g.lineWidth = 1.6;
    const a0 = this.t * 0.6;
    g.beginPath(); g.arc(cx, cy, r + 17, a0, a0 + 0.9); g.stroke();
    g.beginPath(); g.arc(cx, cy, r + 17, a0 + Math.PI, a0 + Math.PI + 0.5); g.stroke();
  }

  private drawGrid(a: number) {
    // Distant perspective grid on the floor, drifting toward the viewer very slowly.
    const g = this.g; const W = this.W, H = this.H;
    const hy = this.ry + H * 0.12; const vx = this.cx - this.ptr.sx * 0.03;
    g.strokeStyle = rgba(BLUE, 0.05 * a); g.lineWidth = 1; g.beginPath();
    for (let i = -12; i <= 12; i++) { g.moveTo(vx + i * 20, hy); g.lineTo(vx + i * W * 0.16, H); }
    const off = (this.t * 0.04) % 1;
    for (let i = 0; i < 9; i++) { const p = Math.pow((i + off) / 9, 2.2); const y = hy + (H - hy) * p; g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
  }

  private drawDust(a: number, q: number) {
    const g = this.g;
    const n = Math.floor(this.dust.length * q);
    const pull = this.ptr.on;
    for (let i = 0; i < n; i++) {
      const d = this.dust[i];
      let x = d.x * this.W - this.ptr.sx * 0.05 * d.z, y = d.y * this.H - this.ptr.sy * 0.05 * d.z;
      if (pull) { const dx = this.ptr.x - x, dy = this.ptr.y - y, dist = Math.hypot(dx, dy); if (dist < 160) { x += dx * 0.18 * (1 - dist / 160); y += dy * 0.18 * (1 - dist / 160); } }
      const al = (0.1 + 0.25 * d.z) * (0.6 + 0.4 * Math.sin(this.t * 0.7 + d.tw)) * a;
      g.fillStyle = rgba(d.z > 0.8 ? WHITE : CYAN, al); g.fillRect(x, y, d.z * 1.3, d.z * 1.3);
    }
    // tiny floating data fragments
    g.font = `400 9px ui-monospace, SFMono-Regular, Menlo, monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    for (const f of this.frags) {
      const al = Math.sin((f.life / f.max) * Math.PI);
      if (f.glyph) { g.fillStyle = rgba(CYAN, 0.28 * al * a); g.fillText(f.glyph, f.x, f.y); }
      else { g.fillStyle = rgba(WHITE, 0.6 * al * a); g.fillRect(f.x - 0.8, f.y - 0.8, 1.6, 1.6); }
    }
  }

  /** The signature: a living ribbon of fluid light, particles, network and geometry. */
  private drawRibbon(q: number) {
    const g = this.g; const s = this.state;
    const w = s === "idle" ? this.morphWeights() : { line: 0.2, wave: 0.6, particles: 0.5, network: s === "research" || s === "thinking" ? 0.6 : 0.25 };
    const E = this.energy;
    const think = s === "thinking" && !this.thinkMerged ? 0.45 : 1;
    const N = Math.max(60, Math.floor(150 * q));
    const amberOn = this.amberT > 0 && this.anomaly ? clamp(this.amberT / 0.8) : this.amberT > 0 ? clamp(this.amberT / 0.8) : 0;
    const au0 = this.anomaly?.u0 ?? 0.5, au1 = this.anomaly?.u1 ?? 0.6;

    // fluid light strands
    const strands = s === "idle" ? 5 : 7;
    for (let k = 0; k < strands; k++) {
      const grad = g.createLinearGradient(this.x0, 0, this.x1, 0);
      const a = (k === 0 ? 0.75 : 0.22 - k * 0.015) * (0.35 + 0.65 * (w.line + w.wave + w.network * 0.5 + 0.25)) * E * think;
      grad.addColorStop(0, rgba(BLUE, 0)); grad.addColorStop(0.2, rgba(k % 3 === 2 ? VIOLET : CYAN, a * 0.8));
      grad.addColorStop(0.5, rgba(k === 0 ? WHITE : CYAN, a)); grad.addColorStop(0.8, rgba(CYAN, a * 0.8)); grad.addColorStop(1, rgba(BLUE, 0));
      if (amberOn > 0) { grad.addColorStop(clamp(au0), rgba(mix(CYAN, AMBER, amberOn), a)); grad.addColorStop(clamp(au1), rgba(mix(CYAN, AMBER, amberOn), a)); }
      g.strokeStyle = grad; g.lineWidth = k === 0 ? 1.4 : 0.7;
      const off = (k - (strands - 1) / 2) * (1.2 + this.spread * 0.18);
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N; const x = lerp(this.x0, this.x1, u);
        const y = this.ribbonY(u, k) + off * Math.pow(Math.sin(Math.PI * u), 0.6);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      if (k === 0) {
        // bloom around the core strand
        g.strokeStyle = grad;
        g.lineWidth = 5; g.globalAlpha = 0.18; g.stroke();
        g.lineWidth = 14; g.globalAlpha = 0.06; g.stroke();
        g.globalAlpha = 1;
      }
    }

    // particles flowing along it (streaks when executing / speaking fast)
    const nF = Math.floor(this.flow.length * q);
    const streak = s === "executing" ? 16 : s === "speaking" ? 4 + this.voice * 14 : 0;
    const toCenter = s === "listening" ? 0.25 + this.mic * 0.35 : 0;
    const spr = this.glow();
    for (let i = 0; i < nF; i++) {
      const f = this.flow[i]; if (f.u < 0 || f.u > 1) continue;
      let x = lerp(this.x0, this.x1, f.u);
      const env = Math.sin(Math.PI * f.u);
      let y = this.ribbonY(f.u) + f.v * this.spread * env * (1 + (s === "speaking" ? this.voice * 2 : 0));
      if (toCenter) x = this.cx + (x - this.cx) * (1 - toCenter * 0.6);
      if (this.ptr.on) {
        const dx = this.ptr.x - x, dy = this.ptr.y - y, d = Math.hypot(dx, dy);
        if (d < 130) { x += dx * 0.22 * (1 - d / 130); y += dy * 0.22 * (1 - d / 130); }
      }
      const amber = amberOn > 0 && f.u > au0 && f.u < au1 ? amberOn : 0;
      const tw = 0.6 + 0.4 * Math.sin(this.t * 3 + f.tw);
      const a = env * tw * (0.25 + 0.6 * (w.particles + 0.3)) * E * think;
      if (streak) {
        g.strokeStyle = rgba(amber ? AMBER : WHITE, a * 0.8); g.lineWidth = f.size * 0.8;
        g.beginPath(); g.moveTo(x - streak * f.sp * 14, y); g.lineTo(x, y); g.stroke();
      } else if (f.size > 1.3) {
        g.globalAlpha = a; g.drawImage(spr, x - 4, y - 4, 8, 8); g.globalAlpha = 1;
      } else {
        g.fillStyle = rgba(amber ? AMBER : f.v > 0.6 ? VIOLET : CYAN, a); g.fillRect(x - f.size / 2, y - f.size / 2, f.size, f.size);
      }
    }

    // network: nodes riding the ribbon, linked by thin lines
    const netA = (w.network * 0.9 + 0.08) * E;
    if (netA > 0.03) {
      const pts = this.netNodes.map((n) => { const x = lerp(this.x0, this.x1, n.u); return { x, y: this.ribbonY(n.u) + n.v * (10 + this.spread * 1.2) * Math.sin(Math.PI * n.u), ph: n.ph }; });
      g.lineWidth = 0.6;
      for (let i = 0; i < pts.length; i++) for (const j of [i + 1, i + 2]) {
        if (j >= pts.length) continue;
        const on = clamp(0.5 + Math.sin(this.t * 0.5 + pts[i].ph + j) * 0.9);
        if (on < 0.05) continue;
        g.strokeStyle = rgba(CYAN, netA * on * 0.5);
        g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.stroke();
      }
      for (const p of pts) { g.fillStyle = rgba(WHITE, netA * 0.9); g.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4); }
    }

    // thin geometric lines appearing / disappearing along the ribbon
    g.lineWidth = 0.7;
    for (let i = 1; i < 12; i++) {
      const u = i / 12; const a = clamp(Math.sin(this.t * 0.4 + i * 1.7)) * 0.35 * E;
      if (a < 0.03) continue;
      const x = lerp(this.x0, this.x1, u), y = this.ribbonY(u);
      g.strokeStyle = rgba(CYAN, a);
      g.beginPath(); g.moveTo(x, y - 26); g.lineTo(x, y - 18); g.moveTo(x, y + 18); g.lineTo(x, y + 26); g.stroke();
    }
    // end brackets
    g.strokeStyle = rgba(CYAN, 0.35 * E); g.lineWidth = 1; g.beginPath();
    for (const [x, d] of [[this.x0, 1], [this.x1, -1]] as const) { g.moveTo(x + d * 8, this.ry - 14); g.lineTo(x, this.ry - 14); g.lineTo(x, this.ry + 14); g.lineTo(x + d * 8, this.ry + 14); }
    g.stroke();
  }

  private drawListening() {
    const g = this.g; const L = this.mic;
    // A circular audio form gathers at the centre as listening begins, then relaxes.
    const form = easeOut(span(this.stateT, 0, 0.6)) * (this.state === "listening" ? 1 - 0.55 * span(this.stateT, 2.2, 3.2) : 0.3);
    if (form <= 0.01) return;
    const r0 = 34 + L * 46;
    g.strokeStyle = rgba(WHITE, 0.35 * form + L * 0.4); g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const n = Math.abs(Math.sin(i * 0.41 + this.t * 8) * 0.6 + Math.sin(i * 0.13 - this.t * 5) * 0.4);
      const len = 3 + L * 60 * n;
      g.moveTo(this.cx + Math.cos(a) * r0, this.ry + Math.sin(a) * r0);
      g.lineTo(this.cx + Math.cos(a) * (r0 + len * form), this.ry + Math.sin(a) * (r0 + len * form));
    }
    g.stroke();
    g.strokeStyle = rgba(CYAN, 0.5 * form); g.beginPath(); g.arc(this.cx, this.ry, r0 - 5, 0, Math.PI * 2); g.stroke();
  }

  private drawVoice() {
    const g = this.g; const V = this.voice;
    // expanding horizontal waves from the centre
    for (const h of this.hwaves) {
      const a = (1 - h.life / h.max) * 0.5;
      const gr = g.createLinearGradient(this.cx - h.half, 0, this.cx + h.half, 0);
      gr.addColorStop(0, rgba(CYAN, 0)); gr.addColorStop(0.5, rgba(WHITE, a)); gr.addColorStop(1, rgba(CYAN, 0));
      g.strokeStyle = gr; g.lineWidth = 1;
      for (const dy of [-10 - h.life * 30, 10 + h.life * 30]) { g.beginPath(); g.moveTo(this.cx - h.half, h.y + dy); g.lineTo(this.cx + h.half, h.y + dy); g.stroke(); }
    }
    if (this.state !== "speaking" || V < 0.02) return;
    // vertical light particles rising and falling with the voice
    g.lineWidth = 1;
    for (let i = 0; i < 70 * this.quality; i++) {
      const u = (i * 0.618034) % 1;
      if (u < 0.08 || u > 0.92) continue;
      const x = lerp(this.x0, this.x1, u); const y = this.ribbonY(u);
      const h = V * 70 * Math.abs(Math.sin(i * 1.7 + this.t * 6)) * Math.sin(Math.PI * u);
      const gr = g.createLinearGradient(0, y - h, 0, y + h);
      gr.addColorStop(0, rgba(CYAN, 0)); gr.addColorStop(0.5, rgba(WHITE, 0.25 + V * 0.4)); gr.addColorStop(1, rgba(CYAN, 0));
      g.strokeStyle = gr; g.beginPath(); g.moveTo(x, y - h); g.lineTo(x, y + h); g.stroke();
    }
  }

  private drawThinking() {
    const g = this.g;
    const merging = this.thinkMerged ? easeInOut(span(this.stateT, 2.6, 3.4)) : 0;
    const out = this.state !== "thinking" ? 1 - easeOut(span(this.stateT, 0, 0.8)) : 1;
    const target = { x: this.cx, y: this.ry - this.H * 0.16 };
    const spr = this.glow();
    this.thinkNodes.forEach((n0, i) => {
      const appear = easeOut(span(this.stateT, 0.25 + i * 0.35, 0.85 + i * 0.35));
      if (appear <= 0) return;
      const n = { x: lerp(n0.x, target.x, merging), y: lerp(n0.y, target.y, merging) };
      const a = appear * (1 - merging * 0.9) * out;
      // stream from the ribbon to the node
      const u = 0.2 + i * 0.2; const sx = lerp(this.x0, this.x1, u), sy = this.ribbonY(u);
      const cx = (sx + n.x) / 2, cy = Math.min(sy, n.y) + (sy - n.y) * 0.25;
      g.strokeStyle = rgba(i % 2 ? VIOLET : CYAN, 0.3 * a); g.lineWidth = 1;
      g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(cx, cy, n.x, n.y); g.stroke();
      for (let k = 0; k < 7; k++) {
        const p = ((this.t * 0.9 + k / 7 + i * 0.13) % 1);
        const x = (1 - p) ** 2 * sx + 2 * (1 - p) * p * cx + p * p * n.x, y = (1 - p) ** 2 * sy + 2 * (1 - p) * p * cy + p * p * n.y;
        g.globalAlpha = a * Math.sin(p * Math.PI); g.drawImage(spr, x - 4, y - 4, 8, 8);
      }
      g.globalAlpha = 1;
      // node: a thin glass diamond + label letters arriving one by one
      const s = 9 + 3 * Math.sin(this.t * 3 + i);
      g.strokeStyle = rgba(WHITE, 0.7 * a); g.lineWidth = 1;
      g.beginPath(); g.moveTo(n.x, n.y - s); g.lineTo(n.x + s, n.y); g.lineTo(n.x, n.y + s); g.lineTo(n.x - s, n.y); g.closePath(); g.stroke();
      g.fillStyle = rgba(CYAN, 0.12 * a); g.fill();
      const word = THINK_WORDS[i];
      g.font = `300 ${Math.max(10, Math.min(13, this.W / 110))}px "Barlow", system-ui, sans-serif`; g.textAlign = "left"; g.textBaseline = "middle";
      const letters = word.split(""); const lw = letters.map((l) => g.measureText(l).width + 3.5);
      let x = n.x - lw.reduce((p, c) => p + c, 0) / 2;
      letters.forEach((l, j) => {
        const la = easeOut(span(this.stateT, 0.45 + i * 0.35 + j * 0.035, 0.75 + i * 0.35 + j * 0.035));
        g.fillStyle = rgba(WHITE, la * a * 0.9);
        g.fillText(l, x + (1 - la) * 14, n.y - 22);
        x += lw[j];
      });
    });
  }

  private drawResearch() {
    const g = this.g; const r = this.research!;
    const appear = easeOut(span(r.t, 0, 0.9));
    const collapse = r.end ? easeInOut(span(r.end, 0, 0.9)) : 0;
    const fade = r.end ? 1 - span(r.end, 0.9, 1.6) : 1;
    const c = { x: this.cx, y: this.ry - this.H * 0.2 };
    const rx = Math.min(this.W * 0.36, 520) * (1 - collapse * 0.92), ry = this.H * 0.16 * (1 - collapse * 0.92);
    const P = r.nodes.map((n) => {
      const wob = Math.sin(this.t * 0.6 + n.ph) * 0.03;
      return { x: c.x + (n.x + wob) * rx * appear - this.ptr.sx * 0.02 * n.z, y: c.y + (n.y - wob) * ry * appear - this.ptr.sy * 0.02 * n.z, n };
    });
    g.lineWidth = 0.5;
    for (const [i, j] of r.edges) {
      const a = Math.min(P[i].n.rel, P[j].n.rel) * 0.4 * appear * fade;
      if (a < 0.02) continue;
      g.strokeStyle = rgba(CYAN, a); g.beginPath(); g.moveTo(P[i].x, P[i].y); g.lineTo(P[j].x, P[j].y); g.stroke();
    }
    const spr = this.glow();
    for (const p of P) {
      const s = 1 + p.n.rel * 2.2 * p.n.z;
      if (p.n.rel > 0.7) { g.globalAlpha = p.n.rel * fade * appear; g.drawImage(spr, p.x - s * 2.5, p.y - s * 2.5, s * 5, s * 5); g.globalAlpha = 1; }
      else { g.fillStyle = rgba(CYAN, (0.15 + p.n.rel * 0.6) * fade * appear); g.fillRect(p.x - s / 2, p.y - s / 2, s, s); }
    }
    for (const pu of r.pulses) {
      const e = r.edges[pu.e]; if (!e) continue;
      const x = lerp(P[e[0]].x, P[e[1]].x, pu.p), y = lerp(P[e[0]].y, P[e[1]].y, pu.p);
      g.fillStyle = rgba(WHITE, Math.sin(pu.p * Math.PI) * 0.9 * fade); g.fillRect(x - 1, y - 1, 2, 2);
    }
    if (collapse > 0.6) {
      const f = (collapse - 0.6) / 0.4;
      g.strokeStyle = rgba(WHITE, 0.5 * f * fade); g.beginPath(); g.moveTo(c.x - 60 * f, c.y); g.lineTo(c.x + 60 * f, c.y); g.stroke();
    }
  }

  private drawConstellation() {
    const g = this.g; const hub = this.hub(); const ag = this.agentPos();
    const spr = this.glow();
    for (const name of AGENTS) {
      const p = ag[name]; const act = clamp(this.agentAct[name]);
      const px = p.x - this.ptr.sx * 0.03, py = p.y - this.ptr.sy * 0.03;
      // flowing light link (a dashed curve that moves)
      const mx = (hub.x + px) / 2, my = (hub.y + py) / 2 - (py < hub.y ? 40 : -40);
      g.strokeStyle = rgba(name === "EV" ? VIOLET : CYAN, 0.06 + act * 0.45); g.lineWidth = 0.8 + act;
      g.setLineDash([2, 9]); g.lineDashOffset = -this.t * 18;
      g.beginPath(); g.moveTo(hub.x, hub.y); g.quadraticCurveTo(mx, my, px, py); g.stroke(); g.setLineDash([]);
      // node
      const r = 3 + act * 7;
      g.globalAlpha = 0.55 + act * 0.45; g.drawImage(spr, px - r * 2, py - r * 2, r * 4, r * 4); g.globalAlpha = 1;
      g.strokeStyle = rgba(WHITE, 0.25 + act * 0.5); g.lineWidth = 0.8;
      g.beginPath(); g.arc(px, py, 10 + act * 14 + Math.sin(this.t * 2) * 1.5, 0, Math.PI * 2); g.stroke();
    }
    // link from the ribbon down to JARVIS
    g.strokeStyle = rgba(CYAN, 0.18); g.lineWidth = 1; g.setLineDash([2, 7]); g.lineDashOffset = this.t * 14;
    g.beginPath(); g.moveTo(this.cx, this.ry + Math.min(this.W * 0.05, 62) + 20); g.lineTo(hub.x, hub.y - 30); g.stroke(); g.setLineDash([]);
    // the JARVIS node — a small glass ring (its name sits inside, in the page)
    const hr = 28;
    const hg = g.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, hr * 1.8);
    hg.addColorStop(0, rgba(CYAN, 0.12)); hg.addColorStop(1, rgba(CYAN, 0));
    g.fillStyle = hg; g.beginPath(); g.arc(hub.x, hub.y, hr * 1.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = rgba(WHITE, 0.55); g.lineWidth = 1; g.beginPath(); g.arc(hub.x, hub.y, hr, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = rgba(CYAN, 0.35); g.beginPath(); g.arc(hub.x, hub.y, hr + 5, this.t * 0.8, this.t * 0.8 + 1.4); g.stroke();
  }

  private drawBuild() {
    const g = this.g; const b = this.build!;
    const open = easeOut(span(b.t, 0, 0.45)); const close = easeInOut(span(b.t, 3.4, 4.2));
    const { x, y, w, h } = b.box;
    // blank holographic canvas opening from a streak
    const hh = h * open * (1 - close);
    g.fillStyle = rgba(BLUE, 0.05 * (1 - close)); g.fillRect(x, y + h / 2 - hh / 2, w, hh);
    g.strokeStyle = rgba(WHITE, 0.45 * (1 - close)); g.lineWidth = 1; g.strokeRect(x, y + h / 2 - hh / 2, w, hh);
    // particles construct the site, element by element
    for (const sgm of b.segs) {
      const p = easeOut(span(b.t, 0.4 + sgm.d * 1.3, 0.8 + sgm.d * 1.3));
      if (p <= 0) continue;
      const a = (sgm.d < 0.1 ? 0.12 : 0.6) * (1 - close);
      g.strokeStyle = rgba(sgm.d > 0.55 ? VIOLET : CYAN, a); g.lineWidth = 0.9;
      const ex = lerp(sgm.x0, sgm.x1, p), ey = lerp(sgm.y0, sgm.y1, p);
      const cy = lerp(this.ry, y + h / 2, close); // flows back into JARVIS when done
      g.beginPath(); g.moveTo(sgm.x0, lerp(sgm.y0, cy, close)); g.lineTo(ex, lerp(ey, cy, close)); g.stroke();
      if (p < 1) { g.fillStyle = rgba(WHITE, 0.9); g.fillRect(ex - 1, ey - 1, 2, 2); }
    }
  }

  private drawAnomaly() {
    const g = this.g; const a = this.anomaly!;
    const x0 = lerp(this.x0, this.x1, a.u0), x1 = lerp(this.x0, this.x1, a.u1);
    // distortion band crossing the interface
    if (a.t > 0.25 && a.t < 1.25) {
      const bx = lerp(this.x0 - 80, this.x1 + 80, span(a.t, 0.25, 1.2));
      const gr = g.createLinearGradient(bx - 60, 0, bx + 60, 0);
      gr.addColorStop(0, rgba(AMBER, 0)); gr.addColorStop(0.5, rgba(AMBER, 0.08)); gr.addColorStop(1, rgba(AMBER, 0));
      g.fillStyle = gr; g.fillRect(bx - 60, 0, 120, this.H);
    }
    // the system scans the affected area
    if (a.t > 1.1 && a.t < 2.3) {
      const sx = lerp(x0, x1, span(a.t, 1.1, 2.1));
      g.strokeStyle = rgba(AMBER, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(sx, this.ry - 36); g.lineTo(sx, this.ry + 36); g.stroke();
      g.strokeStyle = rgba(AMBER, 0.25); g.strokeRect(x0, this.ry - 36, x1 - x0, 72);
    }
  }

  private drawComplete() {
    const g = this.g; const c = this.complete!; const t = c.t;
    // the bright line sweeping across
    if (t > 0.3 && t < 1.2) {
      const lx = lerp(this.x0 - 60, this.x1 + 60, span(t, 0.35, 0.95));
      const gr = g.createLinearGradient(lx - 240, 0, lx, 0);
      gr.addColorStop(0, rgba(WHITE, 0)); gr.addColorStop(1, rgba(WHITE, 0.9 * (1 - span(t, 0.95, 1.2))));
      g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(lx - 240, this.ry); g.lineTo(lx, this.ry); g.stroke();
      const spr = this.glow(); g.drawImage(spr, lx - 14, this.ry - 14, 28, 28);
    }
    // wave → particles → COMPLETE → dissolve
    if (t > 1.0) {
      const fly = span(t, 1.0, 1.6); const dis = span(t, 2.3, 2.95);
      for (const p of c.pts) {
        const e = easeInOut(span(fly, p.d, p.d + 0.7));
        let x = lerp(p.sx, p.x, e), y = lerp(p.sy, p.y, e);
        if (dis > 0) { x += (p.x - this.cx) * dis * 0.25 + Math.sin(p.d * 50) * dis * 30; y += Math.cos(p.d * 70) * dis * 26 - dis * 12; }
        g.fillStyle = rgba(e > 0.95 ? WHITE : CYAN, (0.5 + e * 0.5) * (1 - dis));
        g.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  private drawIntro() {
    const g = this.g; const t = this.introT; const W = this.W;
    const cx = this.cx, cy = this.ry;
    // PHASE 1–2: a tiny horizontal light, then a streak racing across, leaving a trail
    if (t > 0.5) {
      const grow = easeOut(span(t, 0.5, 0.95));
      const race = easeInOut(span(t, 0.95, 1.55));
      const half = lerp(4 + grow * 16, W * 0.52, race);
      const fade = 1 - span(t, 3.8, 4.8) * 0.6;
      const gr = g.createLinearGradient(cx - half, 0, cx + half, 0);
      gr.addColorStop(0, rgba(CYAN, 0)); gr.addColorStop(0.5, rgba(WHITE, 0.95 * fade)); gr.addColorStop(1, rgba(CYAN, 0));
      g.strokeStyle = gr; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx - half, cy); g.lineTo(cx + half, cy); g.stroke();
      const spr = this.glow();
      if (race > 0 && race < 1) { g.drawImage(spr, cx + half - 12, cy - 12, 24, 24); g.drawImage(spr, cx - half - 12, cy - 12, 24, 24); }
      else if (race === 0) { g.globalAlpha = grow; g.drawImage(spr, cx - 10, cy - 10, 20, 20); g.globalAlpha = 1; }
    }
    // PHASE 3: particles emerge from the trail, moving horizontally and vertically; some link up
    if (t > 1.4) {
      const e = span(t, 1.4, 3.6); const leave = span(t, 3.8, 4.6);
      const n = Math.floor(this.flow.length * this.quality);
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const f = this.flow[i];
        const x = lerp(this.x0, this.x1, (i * 0.618034) % 1) + f.ivx * e;
        const y = cy + f.ivy * easeOut(e) * (1 - leave);
        const a = Math.min(1, e * 3) * (1 - leave * 0.8) * 0.8;
        g.fillStyle = rgba(i % 7 === 0 ? WHITE : CYAN, a); g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
        if (i % 9 === 0) pts.push({ x, y });
      }
      g.strokeStyle = rgba(CYAN, 0.18 * Math.sin(span(t, 1.8, 4.2) * Math.PI)); g.lineWidth = 0.5; g.beginPath();
      for (let i = 0; i + 1 < pts.length; i++) if (Math.abs(pts[i].x - pts[i + 1].x) < 90) { g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[i + 1].x, pts[i + 1].y); }
      g.stroke();
    }
    // PHASE 4: holographic architecture — glass panels materialise, lines draw themselves
    if (t > 2.5) {
      const out = 1 - span(t, 4.2, 4.9);
      for (const l of this.introLines) {
        const p = easeInOut(span(t, 2.5, 3.5));
        g.strokeStyle = rgba(CYAN, 0.12 * out); g.lineWidth = 0.6; g.beginPath();
        g.moveTo(l.x0, l.y0); g.lineTo(lerp(l.x0, l.x1, p), lerp(l.y0, l.y1, p)); g.stroke();
      }
      if (this.W >= 760) this.drawPanels(easeOut(span(t, 2.7, 3.6)), true);
    }
    // PHASE 5: J A R V I S assembles from particles and light streaks, then compresses into its mark
    if (t > 3.6) {
      const fly = span(t, 3.6, 4.6);
      const compress = easeInOut(span(t, 4.95, 5.6));
      const crisp = span(t, 4.4, 4.8) * (1 - compress);
      const hub = this.hub();
      const tx = hub.x, ty = hub.y; // compresses into the JARVIS node below the ribbon
      const scale = lerp(1, 0.085, compress);
      g.save();
      g.translate(lerp(cx, tx, compress), lerp(cy, ty, compress)); g.scale(scale, scale); g.translate(-cx, -cy);
      for (const p of this.textPts) {
        const e = easeInOut(span(fly, p.d, p.d + 0.65));
        const x = lerp(p.sx, p.x, e), y = lerp(p.sy, p.y, e);
        g.fillStyle = rgba(e > 0.95 ? WHITE : CYAN, (0.4 + 0.6 * e) * (1 - crisp * 0.6) * (1 - compress * 0.3));
        g.fillRect(x - 1, y - 1, 2, 2);
      }
      // a light streak sweeps each letter as it locks
      const sweep = span(t, 4.2, 4.9);
      if (sweep > 0 && sweep < 1) {
        const size = Math.min(W * 0.11, 150);
        const sx = lerp(cx - size * 3.4, cx + size * 3.4, sweep);
        const gr = g.createLinearGradient(sx - 80, 0, sx + 10, 0);
        gr.addColorStop(0, rgba(WHITE, 0)); gr.addColorStop(1, rgba(WHITE, 0.8));
        g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(sx - 80, cy); g.lineTo(sx + 10, cy); g.stroke();
      }
      if (crisp > 0) {
        const size = Math.min(W * 0.11, 150);
        g.font = `200 ${size}px "Barlow", "Barlow Condensed", system-ui, sans-serif`; g.textBaseline = "middle"; g.textAlign = "left";
        const letters = "JARVIS".split(""); const sp = size * 0.42;
        const widths = letters.map((l) => g.measureText(l).width);
        let x = cx - (widths.reduce((a, b) => a + b, 0) + sp * 5) / 2;
        g.fillStyle = rgba(WHITE, crisp);
        letters.forEach((l, i) => { g.fillText(l, x, cy - size * 0.05); x += widths[i] + sp; });
      }
      g.restore();
    }
    // settle: the ribbon fades in beneath
    if (t > 5.2) { g.globalAlpha = span(t, 5.2, 6.4); this.drawRibbon(this.quality); this.drawCenterRing(); this.drawConstellation(); g.globalAlpha = 1; }
  }
}
