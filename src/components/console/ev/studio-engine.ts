/**
 * EV creative studio — a canvas engine for EV's own visual language: a glossy
 * glass creative canvas that is always being made. It morphs between content
 * formats (post, reel, story, ad, product, video, typography, brand), builds
 * creatives piece by piece, weighs concepts, lays out campaigns, and hands a
 * finished creative to a publishing node.
 *
 * Everything drawn here is decoration driven by EV's REAL state (idle, thinking,
 * generating, waiting for approval, publishing …). It never draws numbers: real
 * metrics live in the page's DOM, clearly apart from this motion. The audience
 * flow around the canvas is labelled as illustrative.
 * No React inside; the page feeds it state and listens for nothing.
 */
import type { CreativeFormat } from "@/lib/ev/studio";

export type StudioState =
  | "IDLE" | "LISTENING" | "THINKING" | "GENERATING"
  | "WAITING_FOR_APPROVAL" | "EXECUTING" | "SUCCESS" | "ERROR";
export type StudioMode = "none" | "image" | "video" | "caption";
export type PublishPhase = "idle" | "publishing" | "done" | "error";
export interface BrandDnaInput { key: string; label: string; value: string }

type RGB = [number, number, number];
const WHITE: RGB = [244, 246, 255];
const CYAN: RGB = [96, 228, 255];
const BLUE: RGB = [84, 132, 255];
const VIOLET: RGB = [152, 112, 255];
const MAGENTA: RGB = [255, 92, 214];
const RED: RGB = [255, 88, 120];
const PALETTE: RGB[] = [CYAN, BLUE, VIOLET, MAGENTA, WHITE];

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
const FONT = `"Barlow", system-ui, sans-serif`;

export const ASPECT: Record<CreativeFormat, number> = {
  post: 0.8, reel: 0.5625, story: 0.5625, ad: 1.91, product: 1, video: 16 / 9, campaign: 0.8, typography: 1, brand: 0.8,
};
const FORMAT_TAG: Record<CreativeFormat, string> = {
  post: "POST · 4:5", reel: "REEL · 9:16", story: "STORY · 9:16", ad: "AD · 1.91:1", product: "PRODUCT · 1:1",
  video: "VIDEO · 16:9", campaign: "CAMPAIGN · POST 4:5", typography: "TYPOGRAPHY · 1:1", brand: "BRAND CREATIVE · 4:5",
};
/** Idle morph order (post → reel → story → ad → … → back). */
const CYCLE: CreativeFormat[] = ["post", "reel", "story", "ad", "product", "video", "typography", "brand"];

// ---------------------------------------------------------------- layouts

type BlockType = "img" | "bar" | "pill" | "dot" | "play" | "seg" | "type" | "swatch" | "ring" | "pedestal" | "obj";
interface Block { t: BlockType; x: number; y: number; w: number; h: number; c?: RGB }

/** Placeholder layout of each format, in 0..1 frame coordinates. */
function layout(f: CreativeFormat): Block[] {
  switch (f) {
    case "reel": return [
      { t: "img", x: 0, y: 0, w: 1, h: 1 },
      { t: "play", x: 0.5, y: 0.44, w: 0.16, h: 0 },
      { t: "dot", x: 0.88, y: 0.56, w: 0.07, h: 0, c: MAGENTA }, { t: "dot", x: 0.88, y: 0.64, w: 0.07, h: 0 }, { t: "dot", x: 0.88, y: 0.72, w: 0.07, h: 0 },
      { t: "bar", x: 0.07, y: 0.8, w: 0.62, h: 0.028 }, { t: "bar", x: 0.07, y: 0.85, w: 0.42, h: 0.022 },
      { t: "seg", x: 0.07, y: 0.93, w: 0.86, h: 0.007 },
    ];
    case "story": return [
      { t: "img", x: 0, y: 0, w: 1, h: 1 },
      { t: "seg", x: 0.05, y: 0.025, w: 0.9, h: 0.006 },
      { t: "dot", x: 0.1, y: 0.07, w: 0.08, h: 0, c: MAGENTA },
      { t: "bar", x: 0.08, y: 0.6, w: 0.84, h: 0.05 }, { t: "bar", x: 0.08, y: 0.67, w: 0.6, h: 0.05 },
      { t: "pill", x: 0.28, y: 0.86, w: 0.44, h: 0.055, c: CYAN },
    ];
    case "ad": return [
      { t: "img", x: 0.03, y: 0.07, w: 0.5, h: 0.86 },
      { t: "bar", x: 0.58, y: 0.14, w: 0.18, h: 0.05, c: MAGENTA },
      { t: "bar", x: 0.58, y: 0.26, w: 0.36, h: 0.1 }, { t: "bar", x: 0.58, y: 0.4, w: 0.3, h: 0.07 },
      { t: "bar", x: 0.58, y: 0.52, w: 0.34, h: 0.045 },
      { t: "pill", x: 0.58, y: 0.7, w: 0.24, h: 0.14, c: CYAN },
    ];
    case "product": return [
      { t: "bar", x: 0.08, y: 0.08, w: 0.5, h: 0.05 }, { t: "bar", x: 0.08, y: 0.15, w: 0.32, h: 0.035 },
      { t: "pedestal", x: 0.5, y: 0.8, w: 0.62, h: 0.09 },
      { t: "obj", x: 0.5, y: 0.52, w: 0.36, h: 0.36 },
      { t: "pill", x: 0.66, y: 0.24, w: 0.24, h: 0.07, c: MAGENTA },
    ];
    case "video": return [
      { t: "img", x: 0, y: 0, w: 1, h: 1 },
      { t: "play", x: 0.5, y: 0.47, w: 0.1, h: 0 },
      { t: "bar", x: 0.05, y: 0.08, w: 0.36, h: 0.05 },
      { t: "seg", x: 0.05, y: 0.9, w: 0.9, h: 0.012 },
    ];
    case "typography": return [
      { t: "type", x: 0.08, y: 0.2, w: 0.84, h: 0.34 },
      { t: "bar", x: 0.08, y: 0.64, w: 0.7, h: 0.04 }, { t: "bar", x: 0.08, y: 0.71, w: 0.5, h: 0.04 },
      { t: "pill", x: 0.08, y: 0.84, w: 0.3, h: 0.07, c: CYAN },
    ];
    case "brand": return [
      { t: "ring", x: 0.5, y: 0.34, w: 0.34, h: 0 },
      { t: "bar", x: 0.22, y: 0.58, w: 0.56, h: 0.04 }, { t: "bar", x: 0.32, y: 0.65, w: 0.36, h: 0.03 },
      { t: "swatch", x: 0.16, y: 0.78, w: 0.68, h: 0.07 },
    ];
    default: return [ // post / campaign hero
      { t: "img", x: 0.06, y: 0.05, w: 0.88, h: 0.6 },
      { t: "bar", x: 0.06, y: 0.7, w: 0.72, h: 0.045 }, { t: "bar", x: 0.06, y: 0.77, w: 0.5, h: 0.035 },
      { t: "pill", x: 0.06, y: 0.86, w: 0.3, h: 0.07, c: CYAN },
      { t: "dot", x: 0.9, y: 0.895, w: 0.06, h: 0, c: MAGENTA },
    ];
  }
}

// ---------------------------------------------------------------- particles

interface Flight { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; t: number; dur: number; c: RGB; s: number; fade: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: RGB; s: number; drag: number }
interface Rect { x: number; y: number; w: number; h: number; r: number }
interface Sat { x: number; y: number; z: number; w: number; h: number; ph: number; c: RGB; kind: 0 | 1 | 2 }
interface Frag { text: string; x: number; y: number; z: number; ph: number; c: RGB }
interface Streak { x: number; y: number; len: number; a: number; v: number; life: number; max: number; c: RGB }

const SOCIAL = ["REACH", "ENGAGEMENT", "VIEWS", "SHARES", "SAVES", "PROFILE VISITS"];

export class EvStudioEngine {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 1; private H = 1; private dpr = 1;
  private raf = 0; private running = false; private last = 0; private t = 0;
  private quality = 1; private slow = 0; private fast = 0;
  private reduced = false;
  private warned = false;
  private mobile = false;

  // inputs
  private state: StudioState = "IDLE";
  private prevState: StudioState = "IDLE";
  private mode: StudioMode = "none";
  private pinned: CreativeFormat | null = null;
  private mediaAspect: number | null = null;
  private focus = false;
  private publish: PublishPhase = "idle";
  private level = 0;
  private headline = "CREATE";
  private brand: BrandDnaInput[] = [];

  // anchors (DOM elements the page wants placed on the canvas)
  private mediaEl: HTMLElement | null = null;
  private sideEl: HTMLElement | null = null;
  private lastMediaCss = ""; private lastSideCss = "";

  // format / frame
  private format: CreativeFormat = "post";
  private prevFormat: CreativeFormat = "post";
  private morph = 1; private cycleT = 0; private cycleI = 0;
  private fw = 0; private fh = 0; private fcx = 0; private fcy = 0; private fscale = 1;
  private frame: Rect = { x: 0, y: 0, w: 0, h: 0, r: 0 };
  private U = 400;

  // build
  private build = 1; private building = false; private locked = true; private readyT = -99; private flip = 0; private flipTarget = 0; private flipClock = 0;
  private stateT = 0;

  // scenes
  private concept = 0; private conceptPeak = 0; private finalT = -99;
  private strip = 0; private stripScroll = 0;
  private camp = 0; private campCompress = 0; private campSince = 0;
  private focusP = 0;
  private imageT = 0;
  private pubT = 0; private pubDoneT = -99; private pubErrT = -99;
  private celebrateT = -99; private glitchT = -99;

  // intro
  private intro = true; private introT = 0;

  // pointer
  private px = 0; private py = 0; private tpx = 0; private tpy = 0; private pointer: { x: number; y: number } | null = null;
  private hoverDna = -1;

  // particles & decor
  private flights: Flight[] = [];
  private sparks: Spark[] = [];
  private sats: Sat[] = [];
  private frags: Frag[] = [];
  private streaks: Streak[] = [];
  private emitAcc = 0; private socialAcc = 0; private dnaAcc = 0; private buildAcc = 0; private pubAcc = 0; private streakAcc = 0;
  private dnaPulses: { i: number; t: number }[] = [];
  private dnaTextW: number[] = [];

  private neb: HTMLCanvasElement | null = null; private nebFrame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("Canvas 2D is not available.");
    this.g = g;
    this.reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    this.seedDecor();
    if (this.reduced) this.skipIntro();
  }

  // ============================== public API ==============================

  start() {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.raf = requestAnimationFrame(loop);
      // One bad frame must never freeze the studio: log once, keep animating.
      try { this.adapt(dt); this.step(dt); this.draw(); }
      catch (e) { if (!this.warned) { this.warned = true; console.error("EV studio frame failed", e); } }
    };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() { this.running = false; cancelAnimationFrame(this.raf); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.W * this.H > 2_000_000 ? 1.25 : 1.5);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.mobile = this.W < 760;
    this.neb = null;
    this.measureDna();
    if (!this.fw) { const t = this.targetGeo(); this.fw = t.w; this.fh = t.h; this.fcx = t.cx; this.fcy = t.cy; }
  }

  skipIntro() { this.intro = false; this.introT = 10; }

  setState(s: StudioState) {
    if (s === this.state) return;
    this.prevState = this.state; this.state = s; this.stateT = 0;
    const busy = s === "GENERATING" || s === "EXECUTING";
    if (busy && !this.building && this.mediaAspect == null) this.startBuild();
    if (s === "SUCCESS") this.celebrate();
    if (s === "ERROR") this.glitchT = this.t;
    if (s === "THINKING") this.conceptPeak = 0;
  }
  setMode(m: StudioMode) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === "image") this.imageT = 0;
    if ((m === "image" || m === "video") && !this.building && this.mediaAspect == null) this.startBuild();
  }
  /** Lock the canvas to a format (from the command, a selected idea, …); null = keep morphing. */
  setFormat(f: CreativeFormat | null) {
    if (f === this.pinned) return;
    this.pinned = f;
    if (f) this.goFormat(f);
    if (f === "campaign") { this.campCompress = 0; this.campSince = 0; }
  }
  /** A real generated image / video is on screen with this aspect (w/h); null = none. */
  setMedia(aspect: number | null) {
    const had = this.mediaAspect != null;
    this.mediaAspect = aspect && Number.isFinite(aspect) ? clamp(aspect, 0.4, 2.2) : null;
    if (this.mediaAspect != null && !had) {
      // particles → image: the swarm converges and the creative locks
      const f = this.frame;
      for (let i = 0; i < 60 * this.quality; i++) {
        const a = rand(0, Math.PI * 2), d = rand(120, 320);
        this.fly(f.x + f.w / 2 + Math.cos(a) * d, f.y + f.h / 2 + Math.sin(a) * d, rand(f.x, f.x + f.w), rand(f.y, f.y + f.h), pick(PALETTE), rand(0.5, 0.9), 1.6);
      }
      this.finishBuild(true);
    }
  }
  setFocus(on: boolean) { this.focus = on; }
  setPublish(p: PublishPhase) {
    if (p === this.publish) return;
    this.publish = p; this.pubT = 0;
    if (p === "done") { this.pubDoneT = this.t; this.celebrate(); }
    if (p === "error") this.pubErrT = this.t;
  }
  setLevel(l: number) { this.level = clamp(l); }
  setHeadline(text: string) {
    const w = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((x) => x.length > 2 && !/^(the|and|for|with|make|create|post|reel|about|some|this|that|please|ev)$/i.test(x));
    this.headline = (w.sort((a, b) => b.length - a.length)[0] ?? "CREATE").toUpperCase().slice(0, 10);
  }
  setBrand(b: BrandDnaInput[]) { this.brand = b.slice(0, 6); this.measureDna(); }
  setAnchors(media: HTMLElement | null, side: HTMLElement | null) {
    if (media !== this.mediaEl) { this.mediaEl = media; this.lastMediaCss = ""; }
    if (side !== this.sideEl) { this.sideEl = side; this.lastSideCss = ""; }
  }
  setPointer(x: number, y: number) { this.pointer = { x, y }; this.tpx = (x / this.W) * 2 - 1; this.tpy = (y / this.H) * 2 - 1; }
  clearPointer() { this.pointer = null; this.tpx = 0; this.tpy = 0; }
  /** Circular particle celebration + a pulse from the canvas. */
  celebrate() {
    this.celebrateT = this.t;
    const f = this.frame, cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const n = Math.round(90 * this.quality);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, v = rand(140, 260);
      this.spark(cx + Math.cos(a) * f.w * 0.3, cy + Math.sin(a) * f.h * 0.3, Math.cos(a) * v, Math.sin(a) * v, rand(0.9, 1.6), PALETTE[i % 4], rand(1.2, 2.4), 2.2);
    }
  }
  /** "CREATIVE READY" without a build (e.g. a finished piece arrived). */
  ready() { this.finishBuild(true); }

  // ============================== simulation ==============================

  private adapt(dt: number) {
    if (dt > 0.028) { this.slow++; this.fast = 0; } else { this.fast++; this.slow = Math.max(0, this.slow - 1); }
    if (this.slow > 40 && this.quality > 0.45) { this.quality = Math.max(0.45, this.quality - 0.2); this.slow = 0; }
    if (this.fast > 600 && this.quality < 1) { this.quality = Math.min(1, this.quality + 0.1); this.fast = 0; }
  }

  private busy() { return this.state === "GENERATING" || this.state === "EXECUTING"; }

  private goFormat(f: CreativeFormat) {
    if (f === this.format) return;
    this.prevFormat = this.format; this.format = f; this.morph = 0;
  }

  private startBuild() {
    this.building = true; this.locked = false; this.build = 0; this.flip = 0; this.flipTarget = 0; this.flipClock = 0;
  }
  private finishBuild(banner: boolean) {
    this.build = Math.max(this.build, 0.86);
    this.building = false;
    if (!this.locked) {
      this.locked = true;
      if (banner) {
        this.readyT = this.t;
        const f = this.frame;
        for (const [x, y] of [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]]) {
          for (let i = 0; i < 10 * this.quality; i++) { const a = rand(0, Math.PI * 2), v = rand(40, 120); this.spark(x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.4, 0.9), CYAN, rand(1, 2), 3); }
        }
      }
    }
  }

  private targetGeo() {
    const W = this.W, H = this.H, m = this.mobile;
    const fmt = this.format;
    const a = this.mediaAspect ?? ASPECT[fmt];
    const fp = this.focusP;
    const U = m ? Math.min(H * (0.44 - 0.1 * fp), W * 1.15) : Math.min(H * 0.56, 660);
    this.U = U;
    let h = U, w = h * a;
    const maxW = m ? W - 40 : W * (a > 1.2 ? 0.4 : 0.34);
    if (w > maxW) { w = maxW; h = w / a; }
    // Wide formats get a little extra height so they don't read as tiny.
    let cx = W / 2, cy = m ? H * 0.37 : H * 0.46;
    if (!m) cx = lerp(W / 2, W * 0.4, fp);
    else cy = lerp(cy, H * 0.31, fp);
    return { w, h, cx, cy };
  }

  private step(dt: number) {
    this.t += dt; this.stateT += dt;
    if (this.intro) { this.introT += dt; if (this.introT > 4) this.intro = false; }
    const k = (s: number) => 1 - Math.exp(-dt * s);

    // pointer parallax
    this.px += (this.tpx - this.px) * k(3); this.py += (this.tpy - this.py) * k(3);

    // idle morph cycle (only when nothing pins the format)
    const idleish = !this.busy() && this.state !== "THINKING" && !this.focus && this.mediaAspect == null && this.publish === "idle";
    if (!this.pinned && idleish && !this.reduced && !this.intro) {
      this.cycleT += dt;
      if (this.cycleT > 6.5) { this.cycleT = 0; this.cycleI = (CYCLE.indexOf(this.format) + 1) % CYCLE.length; this.goFormat(CYCLE[this.cycleI]); }
    } else this.cycleT = 0;
    if (this.mode === "video" && this.busy() && this.format !== "reel") this.goFormat("reel");
    this.morph = Math.min(1, this.morph + dt / 1.1);

    // build progression
    if (this.building) {
      const cap = this.busy() || this.mode === "image" || this.mode === "video" ? 0.86 : 1;
      this.build = Math.min(cap, this.build + dt / 2.4);
      if (this.build >= 0.86) {
        // refining: placeholders keep rearranging until the creative is done
        this.flipClock += dt;
        if (this.flipClock > 2.6) { this.flipClock = 0; this.flipTarget = this.flipTarget ? 0 : 1; }
      }
      if (!this.busy() && this.mode !== "image" && this.mode !== "video" && this.stateT > 0.3) { this.flipTarget = 0; this.finishBuild(true); }
    } else if (!this.intro) this.build = Math.min(1, this.build + dt / 0.9);
    this.flip += (this.flipTarget - this.flip) * k(3.5);
    if (this.mode === "image") this.imageT += dt;

    // scenes
    const thinking = this.state === "THINKING" && this.mediaAspect == null && !this.focus;
    this.concept += ((thinking ? 1 : 0) - this.concept) * k(thinking ? 3 : 4);
    this.conceptPeak = Math.max(this.conceptPeak, this.concept);
    if (!thinking && this.conceptPeak > 0.8 && this.concept < 0.25) { this.finalT = this.t; this.conceptPeak = 0; }
    const wantStrip = this.mode === "video" && this.mediaAspect == null;
    this.strip += ((wantStrip ? 1 : 0) - this.strip) * k(3);
    this.stripScroll += dt * (this.busy() ? 70 : 24);
    const campaign = this.format === "campaign" && this.mediaAspect == null && !this.focus;
    this.camp += ((campaign ? 1 : 0) - this.camp) * k(2.6);
    if (campaign) { this.campSince += dt; if (!this.busy() && this.state !== "THINKING" && this.campSince > 4.5) this.campCompress += (1 - this.campCompress) * k(2); }
    else { this.campSince = 0; this.campCompress += (0 - this.campCompress) * k(3); }
    this.focusP += ((this.focus ? 1 : 0) - this.focusP) * k(3.2);
    this.pubT += dt;

    // frame geometry (critically damped toward target)
    const tg = this.targetGeo();
    const sp = k(5);
    this.fw += (tg.w - this.fw) * sp; this.fh += (tg.h - this.fh) * sp;
    this.fcx += (tg.cx - this.fcx) * k(3.4); this.fcy += (tg.cy - this.fcy) * k(3.4);
    const breathe = this.reduced ? 0 : Math.sin(this.t * 0.9) * 0.006;
    const tScale = (1 - 0.36 * this.concept) * (1 - 0.14 * this.campCompress * this.camp) * (1 + 0.06 * this.focusP) + breathe;
    this.fscale += (tScale - this.fscale) * k(4);
    const w = this.fw * this.fscale, h = this.fh * this.fscale;
    const float = this.reduced ? 0 : Math.sin(this.t * 0.7) * 4;
    const cy = this.fcy - this.campCompress * this.camp * this.H * 0.05;
    this.frame = { x: this.fcx - w / 2 + this.px * 6, y: cy - h / 2 + float + this.py * 4, w, h, r: Math.min(w, h) * 0.055 };

    this.placeAnchors();
    this.spawn(dt);
    this.stepParticles(dt);
  }

  private placeAnchors() {
    const f = this.frame;
    if (this.mediaEl) {
      const css = `${f.x.toFixed(1)}|${f.y.toFixed(1)}|${f.w.toFixed(1)}|${f.h.toFixed(1)}`;
      if (css !== this.lastMediaCss) {
        this.lastMediaCss = css;
        const s = this.mediaEl.style;
        s.left = `${f.x}px`; s.top = `${f.y}px`; s.width = `${f.w}px`; s.height = `${f.h}px`; s.borderRadius = `${f.r}px`;
      }
    }
    if (this.sideEl) {
      let css: string;
      const s = this.sideEl.style;
      if (this.mobile) {
        // below the canvas and its format label, never under the command bar
        const top = f.y + f.h + 30;
        css = `m|${top.toFixed(0)}`;
        if (css !== this.lastSideCss) {
          s.left = "16px"; s.right = "16px"; s.top = `${top}px`; s.transform = "none";
          s.maxHeight = `${Math.max(140, this.H - top - 86)}px`; s.overflowY = "auto";
        }
      } else {
        const left = Math.min(this.W - 360, f.x + f.w + 34);
        css = `d|${left.toFixed(0)}|${(f.y + f.h / 2).toFixed(0)}`;
        if (css !== this.lastSideCss) { s.left = `${left}px`; s.right = "auto"; s.top = `${f.y + f.h / 2}px`; s.transform = "translateY(-50%)"; s.maxHeight = ""; s.overflowY = ""; }
      }
      this.lastSideCss = css;
    }
  }

  private spawn(dt: number) {
    const q = this.quality, f = this.frame, intro = this.intro ? span(this.introT, 0.4, 1.1) : 1;
    // emblem emits particles (a little more with the voice)
    const E = this.emblemPos();
    this.emitAcc += dt * (5 + this.level * 30) * q * intro * (this.reduced ? 0.3 : 1);
    while (this.emitAcc > 1) {
      this.emitAcc--;
      const a = rand(-0.5, 1.1);
      const v = rand(14, 40);
      const c = pick([CYAN, VIOLET, MAGENTA, WHITE]);
      if (Math.random() < 0.18 && !this.intro) this.fly(E.x + 14, E.y, rand(f.x, f.x + f.w), rand(f.y, f.y + f.h * 0.4), c, rand(1.8, 2.8), 1.1);
      else this.spark(E.x + 16, E.y + rand(-6, 6), Math.cos(a) * v + 12, Math.sin(a) * v, rand(1.6, 3.2), c, rand(0.8, 1.6), 0.4);
    }
    // creative build: particles fly in from all sides
    if (this.building || this.mode === "image") {
      this.buildAcc += dt * 34 * q;
      while (this.buildAcc > 1) {
        this.buildAcc--;
        const side = (Math.random() * 4) | 0;
        const sx = side === 0 ? -20 : side === 1 ? this.W + 20 : rand(0, this.W);
        const sy = side === 2 ? -20 : side === 3 ? this.H + 20 : rand(0, this.H);
        this.fly(sx, sy, rand(f.x + f.w * 0.1, f.x + f.w * 0.9), rand(f.y + f.h * 0.1, f.y + f.h * 0.9), pick(PALETTE), rand(0.9, 1.6), rand(1, 1.8));
      }
    }
    // illustrative audience flow (reach / engagement …) leaves the canvas
    const flood = this.t - this.pubDoneT < 3.5 ? 26 : 0;
    this.socialAcc += dt * (1.1 + flood) * q * (this.intro ? span(this.introT, 3, 3.8) : 1) * (1 - 0.8 * this.focusP * (flood ? 0 : 1));
    while (this.socialAcc > 1) {
      this.socialAcc--;
      const i = (Math.random() * SOCIAL.length) | 0, p = this.socialPos(i);
      const ex = clamp(p.x, f.x, f.x + f.w), ey = clamp(p.y, f.y, f.y + f.h);
      this.fly(ex, ey, p.x + rand(-8, 8), p.y + rand(-6, 6), i % 2 ? CYAN : MAGENTA, rand(1.2, 2), rand(0.8, 1.4), true);
    }
    // brand DNA pulses travel to the canvas
    if (this.brand.length && !this.mobile) {
      this.dnaAcc += dt * (this.building ? 3.2 : 0.7) * intro;
      while (this.dnaAcc > 1) { this.dnaAcc--; this.dnaPulses.push({ i: (Math.random() * this.brand.length) | 0, t: 0 }); }
    }
    // publishing: particles stream from the creative to the publishing node
    if (this.publish === "publishing") {
      const N = this.pubNode();
      this.pubAcc += dt * 46 * q;
      while (this.pubAcc > 1) { this.pubAcc--; this.fly(rand(f.x, f.x + f.w), rand(f.y, f.y + f.h), N.x + rand(-4, 4), N.y + rand(-4, 4), pick([CYAN, MAGENTA, VIOLET, WHITE]), rand(0.7, 1.2), rand(1, 1.8)); }
    }
    // light streaks
    this.streakAcc += dt * 0.35 * (this.reduced ? 0 : 1);
    if (this.streakAcc > 1) {
      this.streakAcc = 0;
      this.streaks.push({ x: rand(-0.2, 0.8) * this.W, y: rand(0, this.H), len: rand(120, 320), a: -0.42, v: rand(280, 520), life: 0, max: rand(1.4, 2.4), c: pick([CYAN, VIOLET, MAGENTA]) });
    }
  }

  private fly(x0: number, y0: number, x1: number, y1: number, c: RGB, dur: number, s: number, fade = false) {
    if (this.flights.length > 520) return;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0;
    const bend = rand(-0.35, 0.35);
    this.flights.push({ x0, y0, x1, y1, cx: mx - dy * bend, cy: my + dx * bend, t: 0, dur, c, s, fade });
  }
  private spark(x: number, y: number, vx: number, vy: number, life: number, c: RGB, s: number, drag: number) {
    if (this.sparks.length > 700) return;
    this.sparks.push({ x, y, vx, vy, life, max: life, c, s, drag });
  }

  private stepParticles(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const p = this.flights[i]; p.t += dt / p.dur;
      if (p.t >= 1) {
        if (!p.fade && Math.random() < 0.3) this.spark(p.x1, p.y1, rand(-20, 20), rand(-20, 20), 0.4, p.c, p.s, 4);
        this.flights.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      const d = Math.exp(-dt * s.drag); s.vx *= d; s.vy *= d; s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (let i = this.streaks.length - 1; i >= 0; i--) { const s = this.streaks[i]; s.life += dt; if (s.life > s.max) this.streaks.splice(i, 1); }
    for (let i = this.dnaPulses.length - 1; i >= 0; i--) { const p = this.dnaPulses[i]; p.t += dt / 1.4; if (p.t >= 1) this.dnaPulses.splice(i, 1); }
  }

  private seedDecor() {
    this.sats = [];
    const spots: [number, number][] = [[0.3, 0.14], [0.7, 0.12], [0.24, 0.84], [0.78, 0.86], [0.64, 0.3], [0.36, 0.72]];
    spots.forEach(([x, y], i) => this.sats.push({ x, y, z: rand(0.3, 0.8), w: rand(26, 44), h: 0, ph: rand(0, 6.28), c: PALETTE[i % 4], kind: (i % 3) as 0 | 1 | 2 }));
    for (const s of this.sats) s.h = s.kind === 1 ? s.w * 1.7 : s.kind === 2 ? s.w * 0.6 : s.w * 1.2;
    const words = ["Aa", "#", "@", "CTA", "HOOK", "9:16", "4:5", "✦", "REEL", "1.91:1"];
    this.frags = words.map((text, i) => ({ text, x: rand(0.05, 0.95), y: rand(0.08, 0.92), z: rand(0.25, 0.7), ph: rand(0, 6.28), c: PALETTE[i % 5] }));
  }

  // ============================== positions ==============================

  private emblemPos() { return this.mobile ? { x: 34, y: 34 } : { x: 48, y: 46 }; }
  private pubNode() {
    const f = this.frame;
    return this.mobile
      ? { x: this.W - 42, y: Math.max(80, f.y - 26) }
      : { x: Math.min(this.W - 70, f.x + f.w + 90), y: Math.max(90, f.y - 24) };
  }
  private socialPos(i: number) {
    const f = this.frame, cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const left = i < 3, j = i % 3;
    const dx = f.w / 2 + (this.mobile ? 18 : 44) + (j === 1 ? 26 : 0);
    const y = cy + (j - 1) * f.h * 0.34;
    return { x: cx + (left ? -dx : dx), y, left };
  }
  private dnaPos(i: number) {
    const n = Math.max(1, this.brand.length);
    const y0 = this.H * 0.23, y1 = this.H * 0.6;
    const y = n === 1 ? (y0 + y1) / 2 : lerp(y0, y1, i / (n - 1));
    const x = this.W * 0.045 + Math.sin((i / Math.max(1, n - 1)) * Math.PI) * this.W * 0.035;
    return { x: x + this.px * -10, y: y + this.py * -6 };
  }
  private measureDna() {
    const g = this.g; g.font = `500 11px ${FONT}`;
    this.dnaTextW = this.brand.map((b) => Math.min(190, Math.max(g.measureText(trunc(b.value, 30)).width, b.label.length * 7)));
  }

  // ============================== drawing ==============================

  private draw() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    this.drawBackground();

    const it = this.intro ? this.introT : 10;
    const recede = 1 - 0.72 * this.focusP;
    const decor = span(it, 2.4, 3.4) * recede;

    this.drawStreaks(decor);
    this.drawSatellites(decor);
    if (!this.mobile) this.drawDna(span(it, 2.6, 3.6) * (1 - 0.85 * this.focusP));
    this.drawSocial(span(it, 3, 3.8) * (1 - 0.6 * this.focusP));
    if (this.camp > 0.01) this.drawCampaign();
    if (this.concept > 0.01) this.drawConcepts();

    // the creative canvas forms out of the intro sweep line
    const form = this.intro ? easeOut(span(it, 1.5, 2.4)) : 1;
    if (form > 0) this.drawFrame(form, this.intro ? span(it, 2.1, 3.3) : 1);
    if (this.strip > 0.01) this.drawStrip();
    this.drawParticles();
    this.drawEmblem(span(it, 0.35, 1.1));
    if (this.publish !== "idle" || this.t - this.pubDoneT < 4 || this.t - this.pubErrT < 3) this.drawPubNode();
    this.drawLabels(form);
    if (this.intro) this.drawIntroLine(it);
    if (this.t - this.glitchT < 0.9) this.drawGlitch(this.t - this.glitchT);
  }

  private drawBackground() {
    const g = this.g, W = this.W, H = this.H;
    // Nebula: rendered at quarter resolution and refreshed every few frames.
    if (!this.neb || ++this.nebFrame % (this.quality < 0.7 ? 10 : 6) === 0) {
      const s = 0.25, cw = Math.max(1, Math.round(W * s)), ch = Math.max(1, Math.round(H * s));
      if (!this.neb || this.neb.width !== cw || this.neb.height !== ch) { this.neb = document.createElement("canvas"); this.neb.width = cw; this.neb.height = ch; }
      const n = this.neb.getContext("2d")!;
      n.fillStyle = "#05040d"; n.fillRect(0, 0, cw, ch);
      const t = this.t * 0.05;
      const blob = (x: number, y: number, r: number, c: RGB, a: number) => {
        const gr = n.createRadialGradient(x * cw, y * ch, 0, x * cw, y * ch, r * Math.max(cw, ch));
        gr.addColorStop(0, rgba(c, a)); gr.addColorStop(1, rgba(c, 0));
        n.fillStyle = gr; n.fillRect(0, 0, cw, ch);
      };
      const pub = this.t - this.pubDoneT < 3 ? 1 - (this.t - this.pubDoneT) / 3 : 0;
      blob(0.22 + Math.sin(t) * 0.05, 0.28 + Math.cos(t * 1.3) * 0.04, 0.55, VIOLET, 0.2 + 0.05 * Math.sin(this.t * 0.4));
      blob(0.8 + Math.cos(t * 0.8) * 0.05, 0.34 + Math.sin(t) * 0.05, 0.5, BLUE, 0.16);
      blob(0.62 + Math.sin(t * 1.1) * 0.06, 0.86, 0.45, MAGENTA, 0.1 + 0.12 * pub);
      blob(0.5, 0.46, 0.32, CYAN, 0.05 + (this.busy() ? 0.05 : 0));
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.neb, 0, 0, W, H);
  }

  private drawStreaks(a: number) {
    if (a <= 0) return;
    const g = this.g; g.globalCompositeOperation = "lighter";
    for (const s of this.streaks) {
      const p = s.life / s.max, al = Math.sin(p * Math.PI) * 0.22 * a;
      const x = s.x + Math.cos(s.a) * s.v * s.life, y = s.y + Math.sin(s.a) * s.v * s.life;
      const gr = g.createLinearGradient(x, y, x - Math.cos(s.a) * s.len, y - Math.sin(s.a) * s.len);
      gr.addColorStop(0, rgba(s.c, al)); gr.addColorStop(1, rgba(s.c, 0));
      g.strokeStyle = gr; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(s.a) * s.len, y - Math.sin(s.a) * s.len); g.stroke();
    }
    g.globalCompositeOperation = "source-over";
  }

  private drawSatellites(a: number) {
    if (a <= 0) return;
    const g = this.g, W = this.W, H = this.H, t = this.t;
    for (const s of this.sats) {
      if (this.mobile && s.z < 0.5) continue;
      const x = s.x * W + Math.sin(t * 0.3 + s.ph) * 14 - this.px * s.z * 24;
      const y = s.y * H + Math.cos(t * 0.26 + s.ph) * 10 - this.py * s.z * 16;
      const al = 0.22 * s.z * a;
      g.save(); g.translate(x, y); g.rotate(Math.sin(t * 0.2 + s.ph) * 0.08);
      rr(g, -s.w / 2, -s.h / 2, s.w, s.h, 5);
      g.fillStyle = `rgba(20,22,52,${(0.5 * a).toFixed(3)})`; g.fill();
      g.strokeStyle = rgba(s.c, al * 2); g.lineWidth = 1; g.stroke();
      g.fillStyle = rgba(s.c, al * 1.4);
      if (s.kind === 2) { for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-s.w / 2 + 7 + i * (s.w - 14) / 3, 0, 3, 0, Math.PI * 2); g.fillStyle = rgba(PALETTE[i], al * 2); g.fill(); } }
      else { rr(g, -s.w / 2 + 4, -s.h / 2 + 4, s.w - 8, s.h * 0.5, 3); g.fill(); g.fillStyle = rgba(WHITE, al); g.fillRect(-s.w / 2 + 4, s.h * 0.14, (s.w - 8) * 0.7, 2); g.fillRect(-s.w / 2 + 4, s.h * 0.26, (s.w - 8) * 0.45, 2); }
      g.restore();
    }
    g.font = `600 10px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
    for (const f of this.frags) {
      if (this.mobile && f.z < 0.45) continue;
      const x = f.x * W + Math.sin(t * 0.22 + f.ph) * 18 - this.px * f.z * 30;
      const y = f.y * H + Math.cos(t * 0.19 + f.ph) * 12 - this.py * f.z * 18;
      // keep the fragments out of the canvas area
      const fr = this.frame;
      if (x > fr.x - 30 && x < fr.x + fr.w + 30 && y > fr.y - 30 && y < fr.y + fr.h + 30) continue;
      g.fillStyle = rgba(f.c, 0.18 * f.z * a);
      g.fillText(f.text, x, y);
    }
  }

  private drawDna(a: number) {
    if (a <= 0.01 || !this.brand.length) return;
    const g = this.g, f = this.frame;
    // hover detection
    this.hoverDna = -1;
    if (this.pointer) {
      this.brand.forEach((_, i) => { const p = this.dnaPos(i); if (Math.abs(this.pointer!.x - (p.x + 90)) < 110 && Math.abs(this.pointer!.y - p.y) < 20) this.hoverDna = i; });
    }
    g.globalCompositeOperation = "lighter";
    this.brand.forEach((b, i) => {
      const p = this.dnaPos(i), hot = i === this.hoverDna;
      const sx = p.x + 16 + (this.dnaTextW[i] ?? 120) + 10, sy = p.y;
      const ex = f.x - 4, ey = f.y + f.h * (0.2 + 0.6 * (i / Math.max(1, this.brand.length - 1)));
      const c1x = lerp(sx, ex, 0.5), c1y = sy, c2x = lerp(sx, ex, 0.6), c2y = ey;
      const gr = g.createLinearGradient(sx, sy, ex, ey);
      gr.addColorStop(0, rgba(i % 2 ? VIOLET : CYAN, (hot ? 0.5 : 0.16) * a)); gr.addColorStop(1, rgba(MAGENTA, (hot ? 0.35 : 0.08) * a));
      g.strokeStyle = gr; g.lineWidth = hot ? 1.3 : 0.8;
      g.beginPath(); g.moveTo(sx, sy); g.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey); g.stroke();
      for (const pl of this.dnaPulses) {
        if (pl.i !== i) continue;
        const q = easeInOut(pl.t), x = bez(sx, c1x, c2x, ex, q), y = bez(sy, c1y, c2y, ey, q);
        this.glow(x, y, 7, i % 2 ? VIOLET : CYAN, 0.8 * a);
      }
      // node
      const pulse = 0.6 + 0.4 * Math.sin(this.t * 1.6 + i);
      this.glow(p.x, p.y, hot ? 16 : 11, i % 2 ? VIOLET : CYAN, (0.5 + 0.3 * pulse) * a);
    });
    g.globalCompositeOperation = "source-over";
    g.textAlign = "left";
    this.brand.forEach((b, i) => {
      const p = this.dnaPos(i), hot = i === this.hoverDna;
      g.beginPath(); g.arc(p.x, p.y, hot ? 3.2 : 2.4, 0, Math.PI * 2); g.fillStyle = rgba(WHITE, 0.9 * a); g.fill();
      g.font = `600 9px ${FONT}`; g.textBaseline = "bottom";
      spaced(g, b.label, p.x + 14, p.y - 2, 1.6, rgba(i % 2 ? VIOLET : CYAN, (hot ? 1 : 0.75) * a));
      g.font = `500 11px ${FONT}`; g.textBaseline = "top";
      g.fillStyle = rgba(WHITE, (hot ? 0.95 : 0.55) * a);
      g.fillText(hot ? trunc(b.value, 60) : trunc(b.value, 30), p.x + 14, p.y + 2);
    });
    // caption of the whole cluster
    const p0 = this.dnaPos(0);
    g.font = `600 9px ${FONT}`; g.textBaseline = "bottom";
    spaced(g, "BRAND DNA", p0.x - 2, p0.y - 26, 2.4, rgba(WHITE, 0.4 * a));
  }

  private drawSocial(a: number) {
    if (a <= 0.01) return;
    const g = this.g;
    g.font = `600 9px ${FONT}`; g.textBaseline = "middle";
    SOCIAL.forEach((w, i) => {
      const p = this.socialPos(i);
      g.textAlign = p.left ? "right" : "left";
      const flare = this.t - this.pubDoneT < 3.5 ? 0.4 : 0;
      spacedAligned(g, w, p.x + (p.left ? -6 : 6), p.y, 1.4, rgba(i % 2 ? CYAN : MAGENTA, (0.3 + flare) * a), p.left);
    });
    // honest label for the whole audience flow
    const f = this.frame;
    g.textAlign = "center"; g.font = `500 8px ${FONT}`;
    if (!this.mobile) {
      const p = this.socialPos(5);
      g.textAlign = "left"; g.textBaseline = "top";
      spaced(g, "AUDIENCE FLOW · ILLUSTRATIVE", p.x + 6, p.y + 10, 1.2, rgba(WHITE, 0.3 * a));
    }
  }

  private drawConcepts() {
    const g = this.g, f = this.frame, c = easeInOut(this.concept);
    const gap = (this.mobile ? this.W * 0.3 : Math.max(f.w * 1.25, 200)) * c;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const hi = Math.floor(this.t / 0.85) % 3;
    const fmts: CreativeFormat[] = ["post", "reel", "ad"];
    const labels = ["CONCEPT A", "CONCEPT B", "CONCEPT C"];
    [-1, 1].forEach((side, j) => {
      const idx = j === 0 ? 0 : 2;
      const a = ASPECT[fmts[idx]];
      let h = f.h * 0.9, w = h * a; if (w > f.w * 1.3) { w = f.w * 1.3; h = w / a; }
      const x = cx + side * gap - w / 2, y = cy - h / 2 + Math.sin(this.t * 1.2 + j) * 5;
      const on = hi === idx;
      g.save(); g.globalAlpha = 0.85 * c;
      rr(g, x, y, w, h, Math.min(w, h) * 0.06);
      g.fillStyle = "rgba(14,14,40,0.6)"; g.fill();
      g.strokeStyle = rgba(on ? CYAN : VIOLET, on ? 0.9 : 0.35); g.lineWidth = on ? 1.4 : 1; g.stroke();
      g.clip();
      this.drawBlocks(layout(fmts[idx]), { x, y, w, h, r: 0 }, 1, 0.55, idx * 7 + 3);
      g.restore();
      g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
      spaced(g, labels[idx], x + w / 2, y + h + 10, 2, rgba(on ? CYAN : WHITE, (on ? 0.95 : 0.4) * c));
    });
    g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
    spaced(g, labels[1], cx, f.y + f.h + 10, 2, rgba(hi === 1 ? CYAN : WHITE, (hi === 1 ? 0.95 : 0.4) * c));
  }

  private drawCampaign() {
    const g = this.g, f = this.frame, c = easeInOut(this.camp), k = easeInOut(this.campCompress);
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const cards: { label: string; a: number; dx: number; dy: number }[] = [
      { label: "REEL", a: 0.5625, dx: -1, dy: -0.28 },
      { label: "STORY", a: 0.5625, dx: -1, dy: 0.3 },
      { label: "CAPTION", a: 0.8, dx: 1, dy: -0.28 },
      { label: "HASHTAGS", a: 0.8, dx: 1, dy: 0.3 },
    ];
    // compressed timeline: all five pieces in a row below the canvas
    const rowY = f.y + f.h + 44, rowH = 40, stepX = this.mobile ? 58 : 84;
    const order = ["REEL", "POST", "STORY", "CAPTION", "HASHTAGS"];
    if (k > 0.02) {
      const x0 = cx - stepX * 2 - 20, x1 = cx + stepX * 2 + 20;
      g.strokeStyle = rgba(CYAN, 0.35 * k * c); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, rowY + rowH / 2); g.lineTo(x1, rowY + rowH / 2); g.stroke();
      const head = x0 + ((this.t * 60) % (x1 - x0));
      this.glow(head, rowY + rowH / 2, 8, MAGENTA, 0.7 * k * c);
    }
    const pts: { x: number; y: number }[] = [];
    cards.forEach((cd, i) => {
      let h = f.h * 0.34, w = h * cd.a;
      const ax = cx + cd.dx * (f.w / 2 + w / 2 + (this.mobile ? 10 : 34)) * c, ay = cy + cd.dy * f.h;
      const ti = order.indexOf(cd.label), tx = cx + (ti - 2) * stepX, ty = rowY + rowH / 2;
      const x = lerp(ax, tx, k), y = lerp(ay, ty, k);
      const th = rowH, tw = th * Math.min(cd.a, 1.4);
      h = lerp(h, th, k); w = lerp(w, tw, k);
      pts.push({ x, y });
      g.save(); g.globalAlpha = c * 0.95;
      rr(g, x - w / 2, y - h / 2, w, h, 6);
      g.fillStyle = "rgba(16,16,44,0.72)"; g.fill();
      const col = i % 2 ? MAGENTA : CYAN;
      g.strokeStyle = rgba(col, 0.6); g.lineWidth = 1; g.stroke();
      g.clip();
      if (cd.label === "CAPTION") { g.fillStyle = rgba(WHITE, 0.4); for (let r = 0; r < 4; r++) g.fillRect(x - w / 2 + 8, y - h / 2 + 10 + r * h * 0.18, (w - 16) * (r === 3 ? 0.5 : 0.9), Math.max(1.5, h * 0.06)); }
      else if (cd.label === "HASHTAGS") { g.font = `700 ${Math.max(8, h * 0.18)}px ${FONT}`; g.fillStyle = rgba(CYAN, 0.8); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("# # #", x, y); }
      else this.drawBlocks(layout(cd.label === "REEL" ? "reel" : "story"), { x: x - w / 2, y: y - h / 2, w, h, r: 0 }, 1, 0.6, i * 5 + 1);
      g.restore();
      g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
      spaced(g, cd.label, x, y + h / 2 + 7, 1.8, rgba(WHITE, 0.6 * c));
    });
    // light connections from the hero post to every piece
    if (k < 0.98) {
      g.globalCompositeOperation = "lighter";
      pts.forEach((p, i) => {
        const al = 0.28 * c * (1 - k);
        g.strokeStyle = rgba(i % 2 ? MAGENTA : CYAN, al); g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke();
        const q = (this.t * 0.6 + i * 0.25) % 1;
        this.glow(lerp(cx, p.x, q), lerp(cy, p.y, q), 7, i % 2 ? MAGENTA : CYAN, 0.8 * c * (1 - k));
      });
      g.globalCompositeOperation = "source-over";
    }
    if (k > 0.02) {
      // the hero POST joins the timeline as a small card
      const x = cx + (order.indexOf("POST") - 2) * stepX, y = rowY + rowH / 2, h = rowH, w = h * 0.8;
      g.save(); g.globalAlpha = k * c;
      rr(g, x - w / 2, y - h / 2, w, h, 6); g.fillStyle = "rgba(16,16,44,0.72)"; g.fill(); g.strokeStyle = rgba(WHITE, 0.6); g.stroke();
      g.restore();
      g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
      spaced(g, "POST", x, y + h / 2 + 7, 1.8, rgba(WHITE, 0.6 * k * c));
    }
  }

  private drawFrame(form: number, reveal: number) {
    const g = this.g, fr = this.frame;
    const f: Rect = { x: fr.x, y: fr.y + (fr.h * (1 - form)) / 2, w: fr.w, h: fr.h * form, r: fr.r };
    if (f.h < 2) return;
    const t = this.t;
    const err = this.t - this.glitchT < 0.9;
    const dim = 1 - 0.3 * this.concept;

    // floor glow + glossy reflection under the canvas
    g.globalCompositeOperation = "lighter";
    const FR = f.w * 0.85;
    g.save(); g.translate(f.x + f.w / 2, f.y + f.h + 6); g.scale(1, 0.22);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, FR);
    sh.addColorStop(0, rgba(VIOLET, 0.3 * dim)); sh.addColorStop(1, rgba(VIOLET, 0));
    g.fillStyle = sh; g.fillRect(-FR, -FR, FR * 2, FR * 2);
    g.restore();
    g.globalCompositeOperation = "source-over";
    if (!this.mobile) {
      const rh = Math.min(f.h * 0.22, 90);
      const rg = g.createLinearGradient(0, f.y + f.h + 6, 0, f.y + f.h + 6 + rh);
      rg.addColorStop(0, `rgba(150,130,255,${(0.07 * dim).toFixed(3)})`); rg.addColorStop(1, "rgba(150,130,255,0)");
      rr(g, f.x + 6, f.y + f.h + 6, f.w - 12, rh, f.r); g.fillStyle = rg; g.fill();
    }

    // glass body
    g.save();
    rr(g, f.x, f.y, f.w, f.h, f.r);
    const body = g.createLinearGradient(f.x, f.y, f.x + f.w * 0.4, f.y + f.h);
    body.addColorStop(0, `rgba(34,30,78,${(0.78 * dim).toFixed(3)})`); body.addColorStop(1, `rgba(8,10,30,${(0.88 * dim).toFixed(3)})`);
    g.fillStyle = body; g.fill();
    g.clip();

    if (this.mediaAspect == null) {
      const L = layout(this.format), P = this.morph < 1 ? layout(this.prevFormat) : null;
      const m = easeInOut(this.morph);
      const bp = Math.min(this.build, reveal < 1 ? reveal : 1);
      if (P) this.drawBlocks(P, f, 1, (1 - m) * dim, this.seedOf(this.prevFormat));
      this.drawBlocks(L, f, bp, (P ? m : 1) * dim, this.seedOf(this.format));
      if (this.mode === "image" && this.building) this.drawImageGen(f, L);
    }
    // inner highlight + moving sheen
    const hl = g.createLinearGradient(f.x, f.y, f.x, f.y + f.h * 0.35);
    hl.addColorStop(0, "rgba(255,255,255,0.10)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl; g.fillRect(f.x, f.y, f.w, f.h * 0.35);
    const sweep = ((t * 0.18) % 1.6) - 0.3;
    if (sweep > -0.2 && sweep < 1.2) {
      const sx = f.x + f.w * sweep;
      const sg = g.createLinearGradient(sx - 60, 0, sx + 60, 0);
      sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.5, "rgba(255,255,255,0.07)"); sg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = sg; g.save(); g.transform(1, 0, -0.35, 1, f.h * 0.2, 0); g.fillRect(sx - 60, f.y, 120, f.h); g.restore();
    }
    g.restore();

    // border: rotating brand gradient, drawn on during a build / intro
    const ang = t * 0.5;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2, R = Math.hypot(f.w, f.h) / 2;
    const bg = g.createLinearGradient(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, cx - Math.cos(ang) * R, cy - Math.sin(ang) * R);
    const errC = err ? RED : null;
    bg.addColorStop(0, rgba(errC ?? CYAN, 0.9)); bg.addColorStop(0.45, rgba(errC ?? VIOLET, 0.75)); bg.addColorStop(1, rgba(errC ?? MAGENTA, 0.9));
    const perim = 2 * (f.w + f.h);
    const drawP = this.intro ? reveal : this.building ? Math.min(1, this.build / 0.2) : 1;
    g.save();
    if (drawP < 1) g.setLineDash([perim * drawP, perim]);
    rr(g, f.x, f.y, f.w, f.h, f.r);
    g.strokeStyle = bg; g.lineWidth = 1.4 + (this.state === "LISTENING" ? this.level * 2.5 : 0); g.stroke();
    g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 1.4);
    g.lineWidth = 5; g.stroke();
    g.restore();

    // lock brackets when a creative is finished
    const lockAge = this.t - this.readyT;
    if (this.locked && lockAge < 3.2) {
      const p = easeOut(span(lockAge, 0, 0.45)), off = lerp(26, 8, p), L = Math.min(f.w, f.h) * 0.12;
      g.strokeStyle = rgba(CYAN, (1 - span(lockAge, 2.4, 3.2)) * 0.95); g.lineWidth = 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = sx < 0 ? f.x - off : f.x + f.w + off, y = sy < 0 ? f.y - off : f.y + f.h + off;
        g.beginPath(); g.moveTo(x, y + (sy < 0 ? L : -L)); g.lineTo(x, y); g.lineTo(x + (sx < 0 ? L : -L), y); g.stroke();
      }
    }
    // success pulse
    const cAge = this.t - this.celebrateT;
    if (cAge < 1.4) {
      const p = easeOut(cAge / 1.4), grow = 1 + p * 0.35;
      g.strokeStyle = rgba(MAGENTA, (1 - p) * 0.8); g.lineWidth = 2;
      rr(g, cx - (f.w * grow) / 2, cy - (f.h * grow) / 2, f.w * grow, f.h * grow, f.r * grow); g.stroke();
      g.strokeStyle = rgba(CYAN, (1 - p) * 0.5);
      const g2 = 1 + p * 0.6;
      rr(g, cx - (f.w * g2) / 2, cy - (f.h * g2) / 2, f.w * g2, f.h * g2, f.r * g2); g.stroke();
    }
  }

  private seedOf(f: CreativeFormat) { return (Object.keys(ASPECT) as CreativeFormat[]).indexOf(f) * 13 + 5; }

  /** Placeholder blocks, revealed in sequence by `bp` (0..1). */
  private drawBlocks(L: Block[], f: Rect, bp: number, alpha: number, seed: number) {
    if (alpha <= 0.01) return;
    const g = this.g, t = this.t, n = L.length;
    const flip = this.flip;
    L.forEach((b, i) => {
      const r0 = 0.12 + (i / Math.max(1, n)) * 0.55;
      const rv = easeOut(span(bp, r0, r0 + 0.22));
      if (rv <= 0) return;
      // refining: vertically mirrored arrangement (placeholders rearrange)
      const by = b.t === "img" && b.h > 0.9 ? b.y : lerp(b.y, 1 - b.y - (b.h || b.w * (f.w / f.h)), flip);
      const jit = this.building && bp >= 0.85 ? Math.sin(t * 2.2 + i * 1.7) * 0.006 : 0;
      const x = f.x + (b.x + jit) * f.w, y = f.y + by * f.h, w = b.w * f.w, h = b.h * f.h;
      const a = alpha * rv;
      const col = b.c ?? WHITE;
      g.save(); g.globalAlpha = a;
      switch (b.t) {
        case "img": this.drawArt(x, y, w, h, seed, rv, b.h > 0.9); break;
        case "bar": rr(g, x, y, w * rv, h, h / 2); g.fillStyle = rgba(col, b.c ? 0.85 : 0.55); g.fill(); break;
        case "pill": {
          const s = 0.6 + 0.4 * rv; rr(g, x + (w * (1 - s)) / 2, y + (h * (1 - s)) / 2, w * s, h * s, (h * s) / 2);
          const pg = g.createLinearGradient(x, y, x + w, y); pg.addColorStop(0, rgba(col, 0.9)); pg.addColorStop(1, rgba(MAGENTA, 0.85));
          g.fillStyle = pg; g.fill(); break;
        }
        case "dot": { const d = b.w * f.w * rv; g.beginPath(); g.arc(x, y, d / 2, 0, Math.PI * 2); g.fillStyle = rgba(col, 0.75); g.fill(); break; }
        case "play": {
          const d = b.w * f.w * rv; g.beginPath(); g.arc(x, y, d / 2, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,0.16)"; g.fill();
          g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1.2; g.stroke();
          g.beginPath(); g.moveTo(x - d * 0.12, y - d * 0.18); g.lineTo(x + d * 0.2, y); g.lineTo(x - d * 0.12, y + d * 0.18); g.closePath(); g.fillStyle = "rgba(255,255,255,0.9)"; g.fill(); break;
        }
        case "seg": {
          const segs = b.y < 0.1 ? 3 : 1, gap = segs > 1 ? 4 : 0, sw = (w - gap * (segs - 1)) / segs;
          for (let s = 0; s < segs; s++) {
            rr(g, x + s * (sw + gap), y, sw, Math.max(2, h), 2); g.fillStyle = "rgba(255,255,255,0.22)"; g.fill();
            const prog = segs > 1 ? clamp(((t / 3) % segs) - s) : (t / 8) % 1;
            rr(g, x + s * (sw + gap), y, sw * prog * rv, Math.max(2, h), 2); g.fillStyle = "rgba(255,255,255,0.85)"; g.fill();
          }
          break;
        }
        case "type": {
          const size = Math.min(h * 0.9, (w / Math.max(3, this.headline.length)) * 1.6);
          g.font = `800 ${size}px ${FONT}`; g.textBaseline = "top"; g.textAlign = "left";
          const tg = g.createLinearGradient(x, y, x + w, y + h); tg.addColorStop(0, rgba(CYAN, 1)); tg.addColorStop(0.5, rgba(WHITE, 1)); tg.addColorStop(1, rgba(MAGENTA, 1));
          g.fillStyle = tg;
          const txt = this.headline.slice(0, Math.max(1, Math.round(this.headline.length * rv)));
          g.fillText(txt, x, y + (h - size) / 2);
          break;
        }
        case "ring": {
          const R = (b.w * f.w * rv) / 2;
          g.lineWidth = 2; const rg = g.createLinearGradient(x - R, y - R, x + R, y + R); rg.addColorStop(0, rgba(CYAN, 0.95)); rg.addColorStop(1, rgba(MAGENTA, 0.95));
          g.strokeStyle = rg; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
          g.beginPath(); g.arc(x, y, R * 0.62, t * 0.6, t * 0.6 + Math.PI * 1.3); g.stroke();
          g.fillStyle = rgba(WHITE, 0.9); g.beginPath(); g.arc(x, y, R * 0.16, 0, Math.PI * 2); g.fill();
          break;
        }
        case "swatch": for (let s = 0; s < 5; s++) { const sw = w / 5; rr(g, x + s * sw + 3, y, (sw - 6) * rv, h, 4); g.fillStyle = rgba(PALETTE[s], 0.85); g.fill(); } break;
        case "pedestal": {
          g.beginPath(); g.ellipse(x, y, (w / 2) * rv, h / 2, 0, 0, Math.PI * 2);
          const pg = g.createRadialGradient(x, y, 0, x, y, w / 2); pg.addColorStop(0, rgba(CYAN, 0.5)); pg.addColorStop(1, rgba(VIOLET, 0.05));
          g.fillStyle = pg; g.fill(); g.strokeStyle = rgba(CYAN, 0.6); g.lineWidth = 1; g.stroke(); break;
        }
        case "obj": {
          const s = w * rv, bob = Math.sin(t * 1.2) * 4;
          g.translate(x, y + bob); g.rotate(Math.sin(t * 0.5) * 0.12);
          rr(g, -s / 2, -s / 2, s, s * 1.15, s * 0.14);
          const og = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2); og.addColorStop(0, rgba(VIOLET, 0.95)); og.addColorStop(0.6, rgba(BLUE, 0.9)); og.addColorStop(1, rgba(CYAN, 0.9));
          g.fillStyle = og; g.fill(); g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 1; g.stroke();
          rr(g, -s * 0.36, -s * 0.36, s * 0.72, s * 0.8, s * 0.08); g.fillStyle = "rgba(6,8,24,0.55)"; g.fill();
          break;
        }
      }
      g.restore();
    });
  }

  /** Generative art inside an image placeholder: gradient mesh + shapes. */
  private drawArt(x: number, y: number, w: number, h: number, seed: number, rv: number, full: boolean) {
    const g = this.g, t = this.t;
    g.save();
    const vis = h * rv;
    rr(g, x, y + h - vis, w, vis, full ? 0 : Math.min(w, h) * 0.04); g.clip();
    const bgr = g.createLinearGradient(x, y, x + w, y + h);
    const s4 = ((seed % 4) + 4) % 4;
    const c0 = PALETTE[s4], c1 = PALETTE[(s4 + 1) % 4];
    bgr.addColorStop(0, rgba(mix(c0, [10, 10, 30], 0.45), 1)); bgr.addColorStop(1, rgba(mix(c1, [10, 10, 30], 0.55), 1));
    g.fillStyle = bgr; g.fillRect(x, y, w, h);
    const bx = x + w * (0.3 + 0.15 * Math.sin(t * 0.4 + seed)), byy = y + h * (0.35 + 0.1 * Math.cos(t * 0.33 + seed));
    const hot = g.createRadialGradient(bx, byy, 0, bx, byy, Math.max(w, h) * 0.6);
    hot.addColorStop(0, rgba(MAGENTA, 0.55)); hot.addColorStop(1, rgba(MAGENTA, 0));
    g.fillStyle = hot; g.fillRect(x, y, w, h);
    // shapes
    g.globalAlpha *= 0.85;
    g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.2;
    const R = Math.min(w, h) * 0.22;
    g.beginPath(); g.arc(x + w * 0.66, y + h * 0.42, R, 0, Math.PI * 2); g.stroke();
    g.save(); g.translate(x + w * 0.34, y + h * 0.6); g.rotate(t * 0.15 + seed);
    g.beginPath(); for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; g[k ? "lineTo" : "moveTo"](Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); } g.closePath();
    g.fillStyle = rgba(CYAN, 0.28); g.fill(); g.stroke(); g.restore();
    g.restore();
    if (rv < 1) { // bright reveal edge
      g.fillStyle = rgba(CYAN, 0.85); g.fillRect(x, y + h - vis - 1, w, 2);
    }
  }

  /** Image generation: particles → shapes → lighting inside the image area. */
  private drawImageGen(f: Rect, L: Block[]) {
    const img = L.find((b) => b.t === "img"); if (!img) return;
    const g = this.g, t = this.imageT;
    const x = f.x + img.x * f.w, y = f.y + img.y * f.h, w = img.w * f.w, h = img.h * f.h;
    g.save(); rr(g, x, y, w, h, 4); g.clip();
    g.fillStyle = "rgba(6,6,22,0.72)"; g.fillRect(x, y, w, h);
    g.globalCompositeOperation = "lighter";
    const n = Math.round(90 * this.quality), shapes = span(t, 1.6, 3.4), light = span(t, 3.2, 5);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399 + this.t * (0.3 + (i % 5) * 0.05);
      const r = (0.1 + ((i * 37) % 100) / 100 * 0.45) * (1 - 0.35 * shapes);
      const px = x + w / 2 + Math.cos(a) * r * w, py = y + h / 2 + Math.sin(a * 1.3) * r * h;
      this.glow(px, py, 5, PALETTE[i % 4], 0.55);
    }
    if (shapes > 0) {
      g.strokeStyle = rgba(WHITE, 0.6 * shapes); g.lineWidth = 1.2;
      g.beginPath(); g.arc(x + w * 0.62, y + h * 0.45, Math.min(w, h) * 0.24 * easeOut(shapes), 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.rect(x + w * 0.2, y + h * 0.5, w * 0.3 * easeOut(shapes), h * 0.28 * easeOut(shapes)); g.stroke();
    }
    if (light > 0) {
      const lx = x + ((this.t * 0.5) % 1.4 - 0.2) * w;
      const lg = g.createLinearGradient(lx - w * 0.3, y, lx + w * 0.3, y + h);
      lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, `rgba(255,220,250,${(0.22 * light).toFixed(3)})`); lg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lg; g.fillRect(x, y, w, h);
    }
    g.restore();
  }

  private drawStrip() {
    const g = this.g, f = this.frame, s = easeInOut(this.strip);
    const W = Math.min(this.W * (this.mobile ? 0.9 : 0.6), 640) * s, H = 44;
    const x = this.W / 2 - W / 2, y = f.y + f.h + (this.mobile ? 30 : 40);
    if (W < 4) return;
    g.save(); rr(g, x, y, W, H, 6); g.fillStyle = "rgba(10,10,28,0.8)"; g.fill(); g.strokeStyle = rgba(VIOLET, 0.5); g.lineWidth = 1; g.stroke(); g.clip();
    // sprockets
    g.fillStyle = "rgba(255,255,255,0.25)";
    for (let sx = x - (this.stripScroll % 14); sx < x + W; sx += 14) { g.fillRect(sx, y + 3, 6, 3); g.fillRect(sx, y + H - 6, 6, 3); }
    // frames
    const fw = 50, gap = 6;
    for (let k = -1, fx = x - (this.stripScroll % (fw + gap)); fx < x + W; fx += fw + gap, k++) {
      const idx = Math.floor((this.stripScroll + fx - x) / (fw + gap));
      const gr = g.createLinearGradient(fx, y, fx + fw, y + H);
      gr.addColorStop(0, rgba(PALETTE[Math.abs(idx) % 4], 0.55)); gr.addColorStop(1, rgba(PALETTE[(Math.abs(idx) + 1) % 4], 0.35));
      g.fillStyle = gr; g.fillRect(fx, y + 9, fw, H - 18);
    }
    g.restore();
    // playhead
    g.strokeStyle = rgba(MAGENTA, 0.95 * s); g.lineWidth = 2; g.beginPath(); g.moveTo(this.W / 2, y - 6); g.lineTo(this.W / 2, y + H + 6); g.stroke();
    g.font = `600 9px ${FONT}`; g.textAlign = "left"; g.textBaseline = "bottom";
    spaced(g, "TIMELINE", x, y - 6, 2, rgba(WHITE, 0.5 * s));
  }

  private drawParticles() {
    const g = this.g; g.globalCompositeOperation = "lighter";
    for (const p of this.flights) {
      const q = easeInOut(p.t), x = qbez(p.x0, p.cx, p.x1, q), y = qbez(p.y0, p.cy, p.y1, q);
      const a = p.fade ? Math.sin(p.t * Math.PI) * 0.8 : Math.min(1, p.t * 4) * 0.9;
      this.glow(x, y, 6 * p.s, p.c, a);
    }
    for (const s of this.sparks) this.glow(s.x, s.y, 6 * s.s, s.c, (s.life / s.max) * 0.85);
    g.globalCompositeOperation = "source-over";
  }

  private drawEmblem(a: number) {
    if (a <= 0) return;
    const g = this.g, E = this.emblemPos(), S = this.mobile ? 34 : 42, t = this.t;
    const x = E.x - S / 2, y = E.y - S / 2;
    g.save(); g.globalAlpha = a;
    g.translate(E.x, E.y); g.scale(0.7 + 0.3 * easeOut(a), 0.7 + 0.3 * easeOut(a)); g.translate(-E.x, -E.y);
    // glow
    g.globalCompositeOperation = "lighter"; this.glow(E.x, E.y, S * 1.6, VIOLET, 0.35 + this.level * 0.4); g.globalCompositeOperation = "source-over";
    // glossy squircle
    rr(g, x, y, S, S, S * 0.3);
    const body = g.createLinearGradient(x, y, x + S, y + S);
    body.addColorStop(0, "rgba(60,50,130,0.9)"); body.addColorStop(1, "rgba(12,12,36,0.95)");
    g.fillStyle = body; g.fill();
    const bd = g.createLinearGradient(x, y, x + S, y + S);
    bd.addColorStop(0, rgba(CYAN, 1)); bd.addColorStop(0.5, rgba(VIOLET, 1)); bd.addColorStop(1, rgba(MAGENTA, 1));
    g.strokeStyle = bd; g.lineWidth = 1.4; g.stroke();
    g.save(); g.clip();
    const hl = g.createLinearGradient(x, y, x, y + S * 0.5); hl.addColorStop(0, "rgba(255,255,255,0.3)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl; g.fillRect(x, y, S, S * 0.5);
    g.restore();
    // prism: a beam enters, splits into three creative rays
    const cx = E.x - S * 0.06, cy = E.y + S * 0.04, pr = S * 0.2;
    g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(cx, cy - pr); g.lineTo(cx + pr * 0.95, cy + pr * 0.7); g.lineTo(cx - pr * 0.95, cy + pr * 0.7); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(x + S * 0.12, cy + pr * 0.1); g.lineTo(cx - pr * 0.3, cy + pr * 0.05); g.strokeStyle = "rgba(255,255,255,0.8)"; g.stroke();
    [CYAN, VIOLET, MAGENTA].forEach((c, i) => {
      const flick = 0.75 + 0.25 * Math.sin(t * 3 + i);
      g.strokeStyle = rgba(c, flick); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx + pr * 0.35, cy + pr * 0.15); g.lineTo(x + S * 0.9, cy - pr * 0.5 + i * pr * 0.55); g.stroke();
    });
    g.restore();
  }

  private drawPubNode() {
    const g = this.g, N = this.pubNode(), t = this.t;
    const done = this.t - this.pubDoneT < 4, err = this.publish === "error" || this.t - this.pubErrT < 3;
    const age = this.pubT;
    const a = done ? 1 - span(this.t - this.pubDoneT, 3, 4) : err ? 1 - span(this.t - this.pubErrT, 2.2, 3) : easeOut(span(age, 0, 0.5));
    if (a <= 0) return;
    const R = 20;
    g.save(); g.globalAlpha = a;
    g.globalCompositeOperation = "lighter"; this.glow(N.x, N.y, 44, err ? RED : done ? CYAN : MAGENTA, 0.5 + 0.2 * Math.sin(t * 4)); g.globalCompositeOperation = "source-over";
    g.beginPath(); g.arc(N.x, N.y, R, 0, Math.PI * 2); g.fillStyle = "rgba(14,12,36,0.9)"; g.fill();
    const ig = g.createLinearGradient(N.x - R, N.y + R, N.x + R, N.y - R);
    ig.addColorStop(0, "#fcb045"); ig.addColorStop(0.5, "#fd1d1d"); ig.addColorStop(1, "#833ab4");
    g.strokeStyle = err ? rgba(RED, 1) : ig; g.lineWidth = 2; g.stroke();
    if (this.publish === "publishing") { g.strokeStyle = rgba(WHITE, 0.9); g.lineWidth = 2; g.beginPath(); g.arc(N.x, N.y, R + 6, t * 4, t * 4 + 1.2); g.stroke(); }
    if (done) { const p = easeOut(span(this.t - this.pubDoneT, 0, 1)); g.strokeStyle = rgba(CYAN, 1 - p); g.beginPath(); g.arc(N.x, N.y, R + p * 40, 0, Math.PI * 2); g.stroke(); }
    // camera glyph
    g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.4; rr(g, N.x - 8, N.y - 8, 16, 16, 5); g.stroke();
    g.beginPath(); g.arc(N.x, N.y, 4, 0, Math.PI * 2); g.stroke();
    g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
    spaced(g, err ? "NOT PUBLISHED" : done ? "PUBLISHED" : "PUBLISHING", N.x, N.y + R + 10, 2, rgba(err ? RED : done ? CYAN : WHITE, 0.95));
    g.restore();
  }

  private drawLabels(form: number) {
    const g = this.g, f = this.frame;
    if (form < 0.6) return;
    const a = span(form, 0.6, 1) * (1 - 0.5 * this.concept);
    g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
    const tag = this.mediaAspect != null ? (this.mediaAspect < 0.7 ? "VERTICAL PREVIEW" : "CREATIVE PREVIEW")
      : this.mode === "video" && this.strip > 0.5 ? "VERTICAL PREVIEW · 9:16"
      : this.morph < 1 && this.prevFormat !== this.format ? `${FORMAT_TAG[this.prevFormat].split(" ·")[0]} → ${FORMAT_TAG[this.format].split(" ·")[0]}`
      : FORMAT_TAG[this.format];
    if (this.concept < 0.5 && !(this.camp > 0.5 && this.campCompress > 0.3)) spaced(g, tag, f.x + f.w / 2, f.y + f.h + 12, 2.2, rgba(WHITE, 0.5 * a));

    // image generation stages
    if (this.mode === "image" && this.building) {
      const st = ["PARTICLES", "SHAPES", "LIGHTING", "IMAGE"];
      const cur = this.imageT < 1.6 ? 0 : this.imageT < 3.2 ? 1 : 2;
      g.font = `600 9px ${FONT}`; g.textBaseline = "bottom";
      const total = 300, x0 = f.x + f.w / 2 - total / 2;
      st.forEach((s, i) => spaced(g, s, x0 + (i + 0.5) * (total / 4), f.y - 12, 1.6, rgba(i === cur ? CYAN : WHITE, i === cur ? 0.95 : 0.3)));
    } else if (this.t - this.finalT < 1.6) {
      // "FINAL CONCEPT" owns the space above the canvas for a moment
    } else if (this.building && this.build >= 0.86 && this.state !== "THINKING") {
      g.font = `600 9px ${FONT}`; g.textBaseline = "bottom";
      spaced(g, "REFINING LAYOUT", f.x + f.w / 2, f.y - 12, 2.4, rgba(WHITE, 0.45 + 0.25 * Math.sin(this.t * 3)));
    } else if (this.building) {
      g.font = `600 9px ${FONT}`; g.textBaseline = "bottom";
      spaced(g, "COMPOSING", f.x + f.w / 2, f.y - 12, 2.4, rgba(WHITE, 0.55));
    }
    // CREATIVE READY banner
    const age = this.t - this.readyT;
    if (age < 2.8 && age >= 0) {
      const p = easeOut(span(age, 0, 0.5)) * (1 - span(age, 2.2, 2.8));
      g.font = `700 ${this.mobile ? 13 : 15}px ${FONT}`; g.textBaseline = "bottom";
      const gr = g.createLinearGradient(f.x, 0, f.x + f.w, 0); gr.addColorStop(0, rgba(CYAN, p)); gr.addColorStop(1, rgba(MAGENTA, p));
      spaced(g, "CREATIVE READY", f.x + f.w / 2, f.y - 14 - (1 - p) * 8, lerp(10, 5, p), gr);
    }
    const fAge = this.t - this.finalT;
    if (fAge < 1.6 && fAge >= 0) {
      const p = 1 - span(fAge, 1, 1.6);
      g.font = `700 11px ${FONT}`; g.textBaseline = "bottom";
      spaced(g, "FINAL CONCEPT", f.x + f.w / 2, f.y - 14, 4, rgba(WHITE, p));
    }
  }

  private drawIntroLine(it: number) {
    const g = this.g, p = easeInOut(span(it, 0.9, 1.7)), out = 1 - span(it, 1.9, 2.5);
    if (p <= 0 || out <= 0) return;
    const y = this.fcy, head = this.W * p;
    // after the sweep the line narrows to the canvas width, then opens into it
    const narrow = easeInOut(span(it, 1.5, 2.1));
    const x0 = lerp(0, this.frame.x, narrow), x1 = lerp(head, this.frame.x + this.frame.w, narrow);
    g.globalCompositeOperation = "lighter";
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, rgba(CYAN, 0)); gr.addColorStop(0.7, rgba(VIOLET, 0.9 * out)); gr.addColorStop(1, rgba(WHITE, out));
    g.strokeStyle = gr; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    if (narrow < 1) this.glow(x1, y, 26, CYAN, out);
    g.globalCompositeOperation = "source-over";
  }

  private drawGlitch(age: number) {
    const g = this.g, f = this.frame, k = 1 - age / 0.9;
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const y = f.y + Math.random() * f.h, h = rand(2, 8), dx = rand(-14, 14) * k;
      g.fillStyle = rgba(i % 2 ? CYAN : RED, 0.25 * k); g.fillRect(f.x + dx, y, f.w, h);
    }
    rr(g, f.x - 4 * k, f.y, f.w, f.h, f.r); g.strokeStyle = rgba(RED, 0.6 * k); g.lineWidth = 1; g.stroke();
    rr(g, f.x + 4 * k, f.y, f.w, f.h, f.r); g.strokeStyle = rgba(CYAN, 0.5 * k); g.stroke();
    g.restore();
    g.font = `700 11px ${FONT}`; g.textAlign = "center"; g.textBaseline = "bottom";
    spaced(g, "RENDER INTERRUPTED", f.x + f.w / 2, f.y - 14, 3, rgba(RED, k));
  }

  private glow(x: number, y: number, r: number, c: RGB, a: number) {
    if (a <= 0.01) return;
    const g = this.g, s = this.glowSprite(c);
    g.globalAlpha = clamp(a); g.drawImage(s, x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
  }
  private sprites = new Map<string, HTMLCanvasElement>();
  private glowSprite(c: RGB) {
    const key = c.join(",");
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement("canvas"); s.width = s.height = 32;
    const g = s.getContext("2d")!; const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.28, rgba(c, 0.7)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.sprites.set(key, s);
    return s;
  }
}

// ---------------------------------------------------------------- helpers

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
const qbez = (a: number, c: number, b: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};
function trunc(s: string, n: number) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

/** Letter-spaced text, honouring the current textAlign (left / center / right). */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number, fill: string | CanvasGradient) {
  const w = [...text].reduce((s, ch) => s + g.measureText(ch).width + sp, -sp);
  const align = g.textAlign;
  let cx = align === "center" ? x - w / 2 : align === "right" || align === "end" ? x - w : x;
  g.fillStyle = fill; g.textAlign = "left";
  for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; }
  g.textAlign = align;
}
function spacedAligned(g: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number, fill: string, right: boolean) {
  const prev = g.textAlign; g.textAlign = right ? "right" : "left"; spaced(g, text, x, y, sp, fill); g.textAlign = prev;
}
