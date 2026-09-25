/**
 * DARWIN intelligence map — a canvas engine that draws a living, tilted 3D
 * holographic map: stylised dark-glass terrain (roads, building silhouettes,
 * geographic grid) around the searched location, a breathing search field with
 * a scanning sweep, and every REAL lead as an animated node placed at its real
 * distance and bearing from the centre.
 *
 * The terrain is decorative (not real streets — the page says so); business
 * positions, their analysis steps and classifications come from real data.
 * No React inside; the page feeds it leads/state and listens for events.
 */
import type { NodeKind } from "@/lib/darwin/intel";

export interface MapNodeInput {
  id: string;
  name: string;
  x: number; y: number; // metres east / north of the centre
  kind: NodeKind;
  score: number;
  checks: (number | null)[]; // WEBSITE, CONTACT, PRESENCE, QUALITY, OPPORTUNITY (0..1 or null)
  hasWebsite: boolean;
  hasPhone: boolean;
  followUpAt: number | null; // ms timestamp
}

export interface MapCallbacks {
  onIntro?: (phase: "online" | "done") => void;
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Live-feed events (all describe real facts about real leads). */
  onEvent?: (text: string, tone: "info" | "ok" | "warn" | "hot") => void;
}

type RGB = [number, number, number];
const WHITE: RGB = [236, 246, 255];
const CYAN: RGB = [120, 220, 255];
const BLUE: RGB = [70, 150, 255];
const VIOLET: RGB = [170, 140, 255];
const AMBER: RGB = [255, 168, 82];
const GOLD: RGB = [255, 206, 112];
const GREY: RGB = [120, 132, 150];

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;

/** Small seeded PRNG so a place always gets the same stylised city. */
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
function hash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

interface Road { pts: { x: number; y: number }[]; major: boolean }
interface Building { x: number; y: number; w: number; d: number; h: number; a: number }
interface Node extends MapNodeInput {
  revealAt: number; // engine time; -1 = already settled
  fresh: boolean;
  vis: number; visT: number;
  sx: number; sy: number; on: boolean;
  hot: number; // highlight
  emitted: number; // analysis events already emitted (bitmask)
}
interface Flight { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; delay: number; c: RGB; size: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: RGB }
interface Label { text: string; x: number; y: number; t: number; max: number; c: RGB }

const PITCH = 0.98;

export class DarwinMapEngine {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private cb: MapCallbacks;
  private anchor: HTMLElement | null = null;
  private raf = 0; private running = false;
  private W = 1; private H = 1; private dpr = 1;
  private t = 0; private last = 0;
  private reduced = false;
  private quality = 1; private slow = 0; private fast = 0;

  // place
  private label = "";
  private radius = 3000; // metres
  private hasCenter = false;
  private roads: Road[] = [];
  private buildings: Building[] = [];
  private geo: { x: number; y: number; tw: number }[] = [];
  private extent = 6000;

  // camera
  private cam = { x: 0, y: 0, s: 0.05 };
  private camT = { x: 0, y: 0, s: 0.05 };
  private baseS = 0.05;
  private terrain: HTMLCanvasElement | null = null;
  private terrainKey = "";
  private ptr = { x: -1, y: -1, on: false, sx: 0, sy: 0 };
  private drag: { x: number; y: number; moved: boolean; cx: number; cy: number } | null = null;

  // state
  private scanning = false;
  private scanT = 0;
  private sweep = 0;
  private waves: { r: number; life: number; max: number; strong: boolean }[] = [];
  private lastWave = 0;
  private errorT = -1;
  private completeT = -1;
  private nodes = new Map<string, Node>();
  private selected: string | null = null;
  private hover: string | null = null;
  private flights: Flight[] = [];
  private sparks: Spark[] = [];
  private labels: Label[] = [];
  private crmGlow = 0;
  private emblemGlow = 0;
  private browsersActive = 0;

  // intro
  private intro = true; private introT = 0; private introOnline = false;

  private sprite: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement, cb: MapCallbacks = {}) {
    this.canvas = canvas;
    const g = canvas.getContext("2d", { alpha: false });
    if (!g) throw new Error("Canvas 2D is not available.");
    this.g = g;
    this.cb = cb;
    this.reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    this.setPlace({ label: "", radiusM: 3000 });
    if (this.reduced) this.skipIntro();
  }

  // ============================== public API ==============================

  start() {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.adapt(dt); this.step(dt); this.draw();
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
    this.fitCamera(false);
    this.terrainKey = "";
  }

  /** Element that follows the selected node (the page's holographic info layer). */
  setAnchor(el: HTMLElement | null) { this.anchor = el; }

  /** Centre the map on a searched place (label seeds the stylised city). */
  setPlace(p: { label: string; radiusM: number; hasCenter?: boolean }) {
    const changed = p.label !== this.label || Math.abs(p.radiusM - this.radius) > 1;
    this.label = p.label; this.radius = Math.max(300, p.radiusM); this.hasCenter = !!p.hasCenter;
    if (changed || !this.roads.length) this.generateCity(hash(p.label || "darwin"));
    this.fitCamera(true);
  }

  /**
   * Show these leads. `fresh` ids were just discovered: they appear one by one
   * as the sweep passes and run their analysis sequence.
   */
  setLeads(list: MapNodeInput[], fresh: Set<string> = new Set()) {
    const keep = new Set(list.map((l) => l.id));
    for (const id of [...this.nodes.keys()]) if (!keep.has(id)) this.nodes.delete(id);
    const newFresh: Node[] = [];
    for (const l of list) {
      const cur = this.nodes.get(l.id);
      if (cur) { Object.assign(cur, l); continue; }
      const isFresh = fresh.has(l.id) && !this.reduced;
      const n: Node = { ...l, revealAt: isFresh ? Infinity : this.t - 10, fresh: isFresh, vis: this.intro ? 0 : 1, visT: 1, sx: 0, sy: 0, on: false, hot: 0, emitted: 0 };
      this.nodes.set(l.id, n);
      if (isFresh) newFresh.push(n);
    }
    // Reveal in sweep order (by bearing), spaced so the whole batch takes a few seconds.
    newFresh.sort((a, b) => this.bearing(a) - this.bearing(b));
    const gap = newFresh.length ? Math.min(0.28, 7 / newFresh.length) : 0;
    newFresh.forEach((n, i) => { n.revealAt = this.t + 0.4 + i * gap; });
  }

  setVisible(ids: Set<string> | null) {
    for (const n of this.nodes.values()) {
      const v = !ids || ids.has(n.id) ? 1 : 0;
      if (v === 0 && n.visT === 1 && n.vis > 0.5 && n.on) this.burst(n.sx, n.sy, 8, GREY, 40); // dissolves into particles
      if (v === 1 && n.visT === 0 && n.on) this.burst(n.sx, n.sy, 6, CYAN, 20);
      n.visT = v;
    }
  }

  setScanning(on: boolean) {
    if (on && !this.scanning) { this.scanT = 0; this.errorT = -1; this.completeT = -1; this.waves.push({ r: 0, life: 0, max: 2.2, strong: true }); }
    this.scanning = on;
  }

  /** Search finished: scanning slows and the camera pulls back a little. */
  searchComplete() { this.completeT = 0; this.camT.s = this.baseS * 0.86; }

  /** The data source failed: scanning pauses, an amber signal crosses the map. */
  sourceError() { this.errorT = 0; this.scanning = false; }

  select(id: string | null) {
    this.selected = id;
    const n = id ? this.nodes.get(id) : null;
    if (n) { this.camT.x = n.x; this.camT.y = n.y; this.camT.s = this.baseS * 2.6; n.hot = 1; }
    else this.fitCamera(true);
  }

  /** A lead moved in the CRM: a glowing stream travels from its node to the CRM icon. */
  crmStream(id: string) {
    const n = this.nodes.get(id); if (!n) return;
    const c = this.crmPos();
    this.crmGlow = 1;
    for (let i = 0; i < 26; i++) this.flights.push({ x0: n.sx, y0: n.sy, x1: c.x, y1: c.y, t: 0, dur: rand(0.7, 1.1), delay: i * 0.02, c: CYAN, size: 1.6 });
  }

  skipIntro() {
    this.intro = false; this.introT = 99;
    for (const n of this.nodes.values()) n.vis = Math.max(n.vis, 0.001);
    if (!this.introOnline) { this.introOnline = true; this.cb.onIntro?.("online"); }
    this.cb.onIntro?.("done");
  }

  // pointer input (canvas-local coordinates)
  pointerMove(x: number, y: number) {
    this.ptr.x = x; this.ptr.y = y; this.ptr.on = true;
    if (this.drag) {
      const dx = x - this.drag.x, dy = y - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        this.camT.x = this.drag.cx - dx / this.cam.s;
        this.camT.y = this.drag.cy + dy / (this.cam.s * Math.cos(PITCH));
        this.cam.x = this.camT.x; this.cam.y = this.camT.y;
      }
      return;
    }
    const h = this.pick(x, y);
    if (h !== this.hover) { this.hover = h; this.cb.onHover?.(h); }
  }
  pointerLeave() { this.ptr.on = false; this.drag = null; if (this.hover) { this.hover = null; this.cb.onHover?.(null); } }
  pointerDown(x: number, y: number) { this.drag = { x, y, moved: false, cx: this.cam.x, cy: this.cam.y }; }
  pointerUp(x: number, y: number) {
    const d = this.drag; this.drag = null;
    if (d && !d.moved) {
      const id = this.pick(x, y);
      if (id) { this.select(id); this.cb.onSelect?.(id); }
      else if (this.selected) { this.select(null); this.cb.onSelect?.(null); }
    }
  }
  wheel(deltaY: number) {
    this.camT.s = clamp(this.camT.s * Math.exp(-deltaY * 0.0012), this.baseS * 0.35, this.baseS * 7);
  }

  // ============================== setup ==============================

  private fitCamera(animate: boolean) {
    this.baseS = (Math.min(this.W, this.H * 1.5) * 0.33) / this.radius;
    this.camT = { x: 0, y: this.radius * 0.08, s: this.baseS };
    if (!animate) this.cam = { ...this.camT };
  }

  private generateCity(seed: number) {
    const r = prng(seed);
    const E = Math.max(this.radius * 2.6, 2600);
    this.extent = E;
    const ang = (r() - 0.5) * 0.8;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rot = (x: number, y: number) => ({ x: x * ca - y * sa, y: x * sa + y * ca });
    const roads: Road[] = [];
    const wobble = (pts: { x: number; y: number }[], amp: number) => pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: p.x + (r() - 0.5) * amp, y: p.y + (r() - 0.5) * amp }));
    const S = E / 6;
    for (let k = -6; k <= 6; k++) {
      const off = k * S + (r() - 0.5) * S * 0.3;
      const a = Array.from({ length: 14 }, (_, i) => rot(-E + (i / 13) * 2 * E, off));
      const b = Array.from({ length: 14 }, (_, i) => rot(off, -E + (i / 13) * 2 * E));
      roads.push({ pts: wobble(a, S * 0.08), major: k % 2 === 0 }, { pts: wobble(b, S * 0.08), major: k % 2 === 0 });
    }
    // minor streets inside blocks
    for (let i = 0; i < 90; i++) {
      const horiz = r() < 0.5; const c = (Math.floor(r() * 12) - 6 + 0.5) * S; const s0 = (r() - 0.5) * 2 * E; const len = S * (0.5 + r());
      const p0 = horiz ? rot(s0, c + (r() - 0.5) * S * 0.6) : rot(c + (r() - 0.5) * S * 0.6, s0);
      const p1 = horiz ? rot(s0 + len, c + (r() - 0.5) * S * 0.6) : rot(c + (r() - 0.5) * S * 0.6, s0 + len);
      roads.push({ pts: [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }].map((p) => ({ x: p.x, y: p.y })), major: false });
    }
    // radial arterials + a ring road
    for (let i = 0; i < 5; i++) {
      const a0 = r() * Math.PI * 2;
      roads.push({ pts: wobble(Array.from({ length: 12 }, (_, j) => ({ x: Math.cos(a0) * (j / 11) * E, y: Math.sin(a0) * (j / 11) * E })), S * 0.15), major: true });
    }
    const ringR = this.radius * (1.1 + r() * 0.4);
    roads.push({ pts: Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * Math.PI * 2; const rr = ringR * (1 + Math.sin(a * 3 + seed) * 0.05); return { x: Math.cos(a) * rr, y: Math.sin(a) * rr }; }), major: true });
    this.roads = roads;
    const blds: Building[] = [];
    const n = this.W < 700 ? 260 : 460;
    for (let i = 0; i < n; i++) {
      const d = Math.pow(r(), 0.8) * E * 0.95; const a = r() * Math.PI * 2;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      const core = clamp(1 - d / (this.radius * 1.6));
      const size = S * (0.08 + r() * 0.16);
      blds.push({ x, y, w: size * (0.6 + r() * 0.8), d: size * (0.6 + r() * 0.8), h: S * (0.03 + r() * 0.1 + core * r() * 0.45), a: ang });
    }
    blds.sort((p, q) => q.y - p.y); // far (north) first
    this.buildings = blds;
    this.geo = Array.from({ length: this.W < 700 ? 500 : 1100 }, () => ({ x: (r() - 0.5) * 2 * E, y: (r() - 0.5) * 2 * E, tw: r() * 6 }));
    this.terrainKey = "";
  }

  private bearing(n: { x: number; y: number }) { let a = Math.atan2(n.y, n.x) - this.sweep; while (a < 0) a += Math.PI * 2; return a % (Math.PI * 2); }

  // ============================== projection ==============================

  private focus() { return { x: this.W * 0.5, y: this.H * (this.W < 700 ? 0.5 : 0.56) }; }
  /** World metres (x east, y north, h up) → screen, with perspective. */
  private proj(wx: number, wy: number, h = 0, cam = this.cam) {
    const X = (wx - cam.x) * cam.s, Y = (wy - cam.y) * cam.s, Hh = h * cam.s;
    const F = this.H * 1.5;
    const depth = Y * Math.sin(PITCH) - Hh * Math.cos(PITCH);
    const den = F + depth;
    if (den < F * 0.15) return null;
    const f = F / den;
    const o = this.focus();
    return { x: o.x + X * f, y: o.y - (Y * Math.cos(PITCH) + Hh * Math.sin(PITCH)) * f, f };
  }

  private pick(x: number, y: number): string | null {
    let best: string | null = null, bd = 16;
    for (const n of this.nodes.values()) {
      if (!n.on || n.vis < 0.4) continue;
      const d = Math.hypot(n.sx - x, n.sy - y);
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  private emblemPos() { return this.W < 700 ? { x: this.W - 36, y: 128 } : { x: this.W - 64, y: 64 }; }
  private crmPos() { return { x: this.W - 58, y: this.H * 0.66 }; }

  // ============================== simulation ==============================

  private adapt(dt: number) {
    if (dt > 0.028) { this.slow++; this.fast = 0; } else { this.fast++; this.slow = Math.max(0, this.slow - 1); }
    if (this.slow > 45 && this.quality > 0.45) { this.quality = Math.max(0.45, this.quality - 0.2); this.slow = 0; }
    if (this.fast > 600 && this.quality < 1) { this.quality = Math.min(1, this.quality + 0.1); this.fast = 0; }
  }

  private step(dt: number) {
    this.t += dt;
    if (this.intro) {
      this.introT += dt;
      if (this.introT > 3.8 && !this.introOnline) { this.introOnline = true; this.cb.onIntro?.("online"); }
      if (this.introT > 5) { this.intro = false; this.cb.onIntro?.("done"); }
    }
    const k = 1 - Math.pow(0.02, dt);
    this.cam.x += (this.camT.x - this.cam.x) * k * 0.6;
    this.cam.y += (this.camT.y - this.cam.y) * k * 0.6;
    this.cam.s += (this.camT.s - this.cam.s) * k * 0.6;
    this.ptr.sx += ((this.ptr.on ? this.ptr.x - this.W / 2 : 0) - this.ptr.sx) * k * 0.3;
    this.ptr.sy += ((this.ptr.on ? this.ptr.y - this.H / 2 : 0) - this.ptr.sy) * k * 0.3;

    // scanning: fast sweep + frequent waves while searching; slow and quiet when idle
    const slowing = this.completeT >= 0 ? 1 - span(this.completeT, 0, 2) * 0.7 : 1;
    const paused = this.errorT >= 0 && this.errorT < 2.4;
    const sweepSpeed = paused ? 0 : (this.scanning ? 2.4 : this.anyRevealing() ? 1.6 : 0.35) * slowing;
    this.sweep = (this.sweep + dt * sweepSpeed) % (Math.PI * 2);
    if (this.scanning) this.scanT += dt;
    const waveEvery = this.scanning ? 1.4 : 5.5;
    if (!paused && !this.intro && this.t - this.lastWave > waveEvery) { this.lastWave = this.t; this.waves.push({ r: 0, life: 0, max: this.scanning ? 2 : 3.2, strong: this.scanning }); }
    this.waves = this.waves.filter((w) => (w.life += dt) < w.max);
    if (this.completeT >= 0) this.completeT += dt;
    if (this.errorT >= 0) { this.errorT += dt; if (this.errorT > 4) this.errorT = -1; }
    this.crmGlow = Math.max(0, this.crmGlow - dt * 0.6);
    this.emblemGlow += ((this.scanning || this.anyRevealing() ? 1 : 0.25) - this.emblemGlow) * k * 0.4;

    // nodes: visibility + analysis events
    this.browsersActive = 0;
    for (const n of this.nodes.values()) {
      n.vis += (n.visT * (this.intro ? span(this.introT, 2.8, 3.6) : 1) - n.vis) * k * 0.5;
      n.hot = Math.max(0, n.hot - dt * 0.4);
      if (!n.fresh) continue;
      const a = this.t - n.revealAt;
      if (a < 0) continue;
      if (a > 1.1 && a < 2.4) this.browsersActive++;
      this.analysisEvents(n, a);
      if (a > 5) n.fresh = false;
    }
    this.flights = this.flights.filter((f) => (f.t += dt) < f.delay + f.dur);
    this.sparks = this.sparks.filter((s) => { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= Math.pow(0.3, dt); s.vy *= Math.pow(0.3, dt); return s.life < s.max; });
    this.labels = this.labels.filter((l) => (l.t += dt) < l.max);
  }

  private anyRevealing() { for (const n of this.nodes.values()) if (n.fresh && this.t >= n.revealAt - 0.5) return true; return false; }

  /** Real facts, announced as the node's analysis animation reaches them. */
  private analysisEvents(n: Node, a: number) {
    const once = (bit: number, at: number, fn: () => void) => { if (a >= at && !(n.emitted & bit)) { n.emitted |= bit; fn(); } };
    once(1, 0, () => this.cb.onEvent?.(`Business discovered — ${n.name}`, "info"));
    once(2, 1.2, () => this.cb.onEvent?.(n.hasWebsite ? "Checking website…" : "Website unavailable (none listed)", n.hasWebsite ? "info" : "warn"));
    once(4, 2.0, () => this.cb.onEvent?.(n.hasPhone ? "Phone verified (listed)" : "No phone listed", n.hasPhone ? "ok" : "warn"));
    once(8, 3.0, () => {
      if (n.kind === "high_potential") {
        this.cb.onEvent?.(`Lead opportunity detected — ${n.name}`, "hot");
        this.burst(n.sx, n.sy, 26, CYAN, 90);
        const e = this.emblemPos();
        for (let i = 0; i < 18; i++) this.flights.push({ x0: n.sx, y0: n.sy, x1: e.x, y1: e.y, t: 0, dur: rand(0.6, 0.9), delay: i * 0.015, c: VIOLET, size: 1.8 });
        this.labels.push({ text: "HIGH POTENTIAL", x: n.sx, y: n.sy - 34, t: 0, max: 2.2, c: CYAN });
        n.hot = 1;
      } else if (n.kind === "no_website") this.labels.push({ text: "NO WEBSITE", x: n.sx, y: n.sy - 30, t: 0, max: 1.8, c: AMBER });
    });
    once(16, 3.4, () => {
      this.cb.onEvent?.("CRM record created", "ok");
      const c = this.crmPos(); this.crmGlow = Math.max(this.crmGlow, 0.7);
      for (let i = 0; i < 8; i++) this.flights.push({ x0: n.sx, y0: n.sy, x1: c.x, y1: c.y, t: 0, dur: rand(0.8, 1.2), delay: i * 0.03, c: CYAN, size: 1.2 });
    });
  }

  private burst(x: number, y: number, n: number, c: RGB, speed: number) {
    for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), v = rand(0.3, 1) * speed; this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(0.5, 1.1), c }); }
  }

  // ============================== drawing ==============================

  private draw() {
    const g = this.g; const W = this.W, H = this.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#03050a"; g.fillRect(0, 0, W, H);

    // intro drives the camera + reveal
    const it = this.intro ? this.introT : 99;
    const camView = this.intro ? { ...this.cam, s: this.cam.s * lerp(0.06, 1, easeInOut(span(it, 0.6, 2.8))) } : this.cam;
    const mapA = easeOut(span(it, 1.8, 3.2));

    // terrain (cached while the camera is still; parallax as a cheap offset)
    const moving = Math.abs(this.camT.s - this.cam.s) / this.cam.s > 0.002 || Math.hypot(this.camT.x - this.cam.x, this.camT.y - this.cam.y) * this.cam.s > 0.5 || this.intro || !!this.drag;
    const key = `${W}x${H}:${this.cam.x.toFixed(1)},${this.cam.y.toFixed(1)},${this.cam.s.toExponential(4)}`;
    if (moving || key !== this.terrainKey || !this.terrain) { this.renderTerrain(camView, this.intro ? mapA : 1); this.terrainKey = moving ? "" : key; }
    const px = -this.ptr.sx * 0.012, py = -this.ptr.sy * 0.012;
    g.drawImage(this.terrain!, px, py, W, H);

    // grid spark during the intro (the tiny geographic grid that expands)
    if (this.intro && it < 3) this.drawIntroGrid(it);

    g.globalCompositeOperation = "lighter";
    const ox = -this.ptr.sx * 0.02, oy = -this.ptr.sy * 0.02;
    g.save(); g.translate(ox, oy);
    this.drawGeoParticles(camView, this.intro ? easeOut(span(it, 2.6, 3.6)) : 1);
    this.drawField(camView, it);
    this.drawNodes(camView, ox, oy);
    g.restore();

    this.drawStreams();
    this.drawEmblem();
    this.drawCrm();
    for (const s of this.sparks) { g.fillStyle = rgba(s.c, 1 - s.life / s.max); g.fillRect(s.x - 1, s.y - 1, 2, 2); }
    g.globalCompositeOperation = "source-over";
    this.drawLabels();
    if (this.errorT >= 0) this.drawError();
    // horizon haze
    const hz = g.createLinearGradient(0, 0, 0, H * 0.35);
    hz.addColorStop(0, "rgba(3,5,10,0.95)"); hz.addColorStop(1, "rgba(3,5,10,0)");
    g.fillStyle = hz; g.fillRect(0, 0, W, H * 0.35);

    // selected node's info layer follows it
    if (this.anchor) {
      const n = this.selected ? this.nodes.get(this.selected) : null;
      if (n && n.on) { this.anchor.style.opacity = "1"; this.anchor.style.transform = `translate3d(${Math.round(n.sx)}px, ${Math.round(n.sy)}px, 0)`; }
      else this.anchor.style.opacity = "0";
    }
  }

  private renderTerrain(cam: { x: number; y: number; s: number }, alpha: number) {
    const W = this.W, H = this.H;
    if (!this.terrain) this.terrain = document.createElement("canvas");
    const cw = Math.round(W * this.dpr), ch = Math.round(H * this.dpr);
    if (this.terrain.width !== cw || this.terrain.height !== ch) { this.terrain.width = cw; this.terrain.height = ch; }
    const g = this.terrain.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#03050a"; g.fillRect(0, 0, W, H);
    if (alpha <= 0.01) return;
    g.globalAlpha = alpha;
    const E = this.extent;
    // dark glass ground
    const corners = [this.proj(-E, -E, 0, cam), this.proj(E, -E, 0, cam), this.proj(E, E, 0, cam), this.proj(-E, E, 0, cam)];
    const grd = g.createLinearGradient(0, H * 0.2, 0, H);
    grd.addColorStop(0, "#060b14"); grd.addColorStop(1, "#0a1424");
    g.fillStyle = grd;
    if (corners.every(Boolean)) { g.beginPath(); corners.forEach((c, i) => (i ? g.lineTo(c!.x, c!.y) : g.moveTo(c!.x, c!.y))); g.closePath(); g.fill(); }
    else g.fillRect(0, H * 0.2, W, H);
    // geographic grid (every 250 m)
    const step = this.radius > 6000 ? 1000 : 250;
    g.strokeStyle = "rgba(90,140,200,0.06)"; g.lineWidth = 1; g.beginPath();
    for (let v = -E; v <= E; v += step) {
      const a = this.proj(v, -E, 0, cam), b = this.proj(v, E, 0, cam), c = this.proj(-E, v, 0, cam), d = this.proj(E, v, 0, cam);
      if (a && b) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
      if (c && d) { g.moveTo(c.x, c.y); g.lineTo(d.x, d.y); }
    }
    g.stroke();
    // roads: thin glowing lines
    for (const pass of [0, 1]) {
      for (const r of this.roads) {
        if (pass === 0 && !r.major) continue;
        g.strokeStyle = pass === 0 ? "rgba(90,170,255,0.06)" : r.major ? "rgba(140,200,255,0.26)" : "rgba(110,160,220,0.1)";
        g.lineWidth = pass === 0 ? 5 : r.major ? 1.1 : 0.6;
        g.beginPath(); let started = false;
        for (const p of r.pts) { const q = this.proj(p.x, p.y, 0, cam); if (!q) { started = false; continue; } if (started) g.lineTo(q.x, q.y); else { g.moveTo(q.x, q.y); started = true; } }
        g.stroke();
      }
    }
    // building silhouettes (far → near)
    const ca = Math.cos(this.buildings[0]?.a ?? 0), sa = Math.sin(this.buildings[0]?.a ?? 0);
    for (const b of this.buildings) {
      const hw = b.w / 2, hd = b.d / 2;
      const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([dx, dy]) => ({ x: b.x + dx * ca - dy * sa, y: b.y + dx * sa + dy * ca }));
      const bot = c.map((p) => this.proj(p.x, p.y, 0, cam)); const top = c.map((p) => this.proj(p.x, p.y, b.h, cam));
      if (bot.some((p) => !p) || top.some((p) => !p)) continue;
      const B = bot as { x: number; y: number }[], T = top as { x: number; y: number }[];
      const minX = Math.min(...T.map((p) => p.x)), maxX = Math.max(...T.map((p) => p.x));
      if (maxX < -20 || minX > W + 20) continue;
      const tall = clamp(b.h / (this.extent * 0.05));
      // walls facing the viewer (south + the side toward the centre line)
      const faces = [[0, 1], b.x > cam.x ? [3, 0] : [1, 2]];
      for (const [i, j] of faces) {
        g.fillStyle = `rgba(14,22,36,0.92)`;
        g.beginPath(); g.moveTo(B[i].x, B[i].y); g.lineTo(B[j].x, B[j].y); g.lineTo(T[j].x, T[j].y); g.lineTo(T[i].x, T[i].y); g.closePath(); g.fill();
      }
      g.fillStyle = `rgba(24,36,56,0.95)`;
      g.beginPath(); T.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
      g.strokeStyle = `rgba(140,200,255,${(0.06 + tall * 0.2).toFixed(3)})`; g.lineWidth = 0.6; g.stroke();
      g.beginPath(); g.moveTo(B[0].x, B[0].y); g.lineTo(T[0].x, T[0].y); g.moveTo(B[1].x, B[1].y); g.lineTo(T[1].x, T[1].y); g.stroke();
    }
    g.globalAlpha = 1;
  }

  private drawIntroGrid(it: number) {
    const g = this.g; const o = this.focus();
    const a = span(it, 0.4, 0.8) * (1 - span(it, 2.2, 3));
    const sz = lerp(8, Math.min(this.W, this.H) * 0.5, easeInOut(span(it, 0.5, 2.4)));
    g.strokeStyle = rgba(CYAN, 0.35 * a); g.lineWidth = 0.7; g.beginPath();
    for (let i = -4; i <= 4; i++) {
      g.moveTo(o.x - sz, o.y + (i / 4) * sz * 0.45); g.lineTo(o.x + sz, o.y + (i / 4) * sz * 0.45);
      g.moveTo(o.x + (i / 4) * sz, o.y - sz * 0.45); g.lineTo(o.x + (i / 4) * sz * 1.2, o.y + sz * 0.45);
    }
    g.stroke();
  }

  private drawGeoParticles(cam: { x: number; y: number; s: number }, a: number) {
    if (a <= 0) return;
    const g = this.g; const n = Math.floor(this.geo.length * this.quality);
    for (let i = 0; i < n; i++) {
      const p = this.geo[i];
      const q = this.proj(p.x, p.y, 0, cam); if (!q || q.x < 0 || q.x > this.W || q.y < 0 || q.y > this.H) continue;
      let x = q.x, y = q.y;
      if (this.ptr.on) { const dx = this.ptr.x - x, dy = this.ptr.y - y, d = Math.hypot(dx, dy); if (d < 120) { x += dx * 0.15 * (1 - d / 120); y += dy * 0.15 * (1 - d / 120); } }
      const tw = 0.5 + 0.5 * Math.sin(this.t * 1.3 + p.tw);
      g.fillStyle = rgba(CYAN, (0.08 + 0.22 * tw) * a * q.f); g.fillRect(x, y, 1.1, 1.1);
    }
  }

  /** The search field: breathing rings, scanning sweep, expanding waves, centre marker. */
  private drawField(cam: { x: number; y: number; s: number }, it: number) {
    const g = this.g; const R = this.radius;
    const form = this.intro ? easeOut(span(it, 1.5, 2.6)) : 1;
    if (form <= 0) return;
    const ring = (r: number, h = 0) => { const pts: { x: number; y: number }[] = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; const p = this.proj(Math.cos(a) * r, Math.sin(a) * r, h, cam); if (p) pts.push(p); } return pts; };
    const path = (pts: { x: number; y: number }[]) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    const breathe = 1 + Math.sin(this.t * 0.8) * 0.02;
    const active = this.scanning ? 1 : 0.45;
    const warn = this.errorT >= 0 && this.errorT < 3 ? 1 - span(this.errorT, 2, 3) : 0;
    const col = warn > 0 ? AMBER : BLUE;
    // translucent field
    const edge = ring(R * breathe * form);
    path(edge); g.fillStyle = rgba(col, 0.035 + active * 0.03); g.fill();
    g.strokeStyle = rgba(CYAN, 0.35 * form + active * 0.2); g.lineWidth = 1.2; g.stroke();
    for (const [k, al] of [[0.66, 0.12], [0.33, 0.1]] as const) { path(ring(R * k * breathe * form)); g.strokeStyle = rgba(CYAN, al); g.lineWidth = 0.7; g.stroke(); }
    // rotating dashed boundary + tick ring
    g.setLineDash([3, 9]); g.lineDashOffset = -this.t * 30; path(ring(R * 1.06 * form)); g.strokeStyle = rgba(CYAN, 0.25); g.stroke(); g.setLineDash([]);
    // expanding scan waves
    for (const w of this.waves) {
      const p = w.life / w.max;
      path(ring(R * p * 1.05)); g.strokeStyle = rgba(w.strong ? WHITE : CYAN, (1 - p) * (w.strong ? 0.45 : 0.18)); g.lineWidth = w.strong ? 1.4 : 1; g.stroke();
    }
    // sweep (radar line + fading wedge)
    if (!this.intro || it > 3.2) {
      const c = this.proj(0, 0, 0, cam);
      if (c) {
        for (let i = 0; i < 16; i++) {
          const a = this.sweep - i * 0.035;
          const e = this.proj(Math.cos(a) * R, Math.sin(a) * R, 0, cam); if (!e) continue;
          g.strokeStyle = rgba(i === 0 ? WHITE : BLUE, (i === 0 ? 0.75 : 0.22 - i * 0.012) * (0.4 + active * 0.6));
          g.lineWidth = i === 0 ? 1.4 : 1;
          g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(e.x, e.y); g.stroke();
        }
      }
    }
    // centre marker: a location beam + ring
    const c0 = this.proj(0, 0, 0, cam), c1 = this.proj(0, 0, R * 0.12, cam);
    if (c0 && c1) {
      const drop = easeOut(span(it, 1.1, 1.6));
      const gr = g.createLinearGradient(c0.x, c0.y, c1.x, c1.y);
      gr.addColorStop(0, rgba(WHITE, 0.8 * drop)); gr.addColorStop(1, rgba(CYAN, 0));
      g.strokeStyle = gr; g.lineWidth = 1.2; g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, lerp(c0.y, c1.y, drop)); g.stroke();
      g.fillStyle = rgba(WHITE, 0.9 * drop); g.beginPath(); g.arc(c0.x, c0.y, 2.5, 0, Math.PI * 2); g.fill();
      path(ring(R * 0.035)); g.strokeStyle = rgba(WHITE, 0.5 * drop); g.lineWidth = 1; g.stroke();
      if (this.label && drop > 0.5) {
        g.globalCompositeOperation = "source-over";
        g.font = `500 11px "Barlow", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "top";
        g.fillStyle = rgba(WHITE, 0.8 * drop);
        g.fillText(this.label.toUpperCase().split("").join(" "), c0.x, c0.y + 10);
        g.globalCompositeOperation = "lighter";
      }
    }
  }

  private drawNodes(cam: { x: number; y: number; s: number }, ox = 0, oy = 0) {
    const g = this.g; const spr = this.glowSprite();
    const sel = this.selected;
    const list = [...this.nodes.values()];
    for (const n of list) {
      const a = this.t - n.revealAt;
      const q = this.proj(n.x, n.y, 28, cam), q0 = this.proj(n.x, n.y, 0, cam);
      n.on = !!q && !!q0 && q.x > -40 && q.x < this.W + 40 && q.y > -40 && q.y < this.H + 40;
      if (!q || !q0 || !n.on) continue;
      n.sx = q.x + ox; n.sy = q.y + oy; // screen position incl. parallax (for picking / streams)
      if (n.fresh && a < 0) { n.on = false; continue; } // not discovered yet
      const dim = sel && sel !== n.id ? 0.35 : 1;
      const al = n.vis * dim;
      if (al < 0.02) continue;
      const hover = this.hover === n.id ? 1 : 0;
      const isSel = sel === n.id;
      const c = this.kindColor(n.kind);
      const appear = n.fresh ? easeOut(span(a, 0, 0.3)) : 1;
      const expand = n.fresh ? 1 + Math.sin(span(a, 0.3, 0.6) * Math.PI) * 1.2 : 1;
      // stem to the ground
      g.strokeStyle = rgba(c, 0.25 * al); g.lineWidth = 0.7; g.beginPath(); g.moveTo(q0.x, q0.y); g.lineTo(q.x, q.y); g.stroke();
      g.fillStyle = rgba(c, 0.4 * al); g.fillRect(q0.x - 1, q0.y - 0.5, 2, 1);
      const base = (n.kind === "high_potential" ? 3.4 : n.kind === "client" ? 3.2 : 2.2) * expand * appear * (1 + hover * 0.4 + (isSel ? 0.8 : 0));
      // glow + core point
      const gl = base * (n.kind === "high_potential" || n.kind === "client" || isSel || n.hot > 0 ? 7 : 4.5);
      g.globalAlpha = al * (0.55 + hover * 0.3 + n.hot * 0.3); g.drawImage(spr, q.x - gl / 2, q.y - gl / 2, gl, gl); g.globalAlpha = 1;
      g.fillStyle = rgba(n.kind === "discovered" ? WHITE : c, al); g.beginPath(); g.arc(q.x, q.y, base * 0.55, 0, Math.PI * 2); g.fill();
      // state rings
      if (n.kind === "no_website") { g.strokeStyle = rgba(AMBER, 0.75 * al); g.lineWidth = 1.4; g.beginPath(); g.arc(q.x, q.y, 7 + Math.sin(this.t * 2 + n.x) * 0.8, 0, Math.PI * 2); g.stroke(); }
      if (n.kind === "weak_website") { const p = (this.t * 0.5 + n.y * 0.001) % 1; g.strokeStyle = rgba(AMBER, (1 - p) * 0.6 * al); g.lineWidth = 1; g.beginPath(); g.arc(q.x, q.y, 4 + p * 12, 0, Math.PI * 2); g.stroke(); }
      if (n.kind === "verified") { g.strokeStyle = rgba(CYAN, 0.45 * al); g.lineWidth = 0.8; g.beginPath(); g.arc(q.x, q.y, 5.5, 0, Math.PI * 2); g.stroke(); }
      if (n.kind === "high_potential") { g.strokeStyle = rgba(VIOLET, 0.6 * al); g.lineWidth = 1; g.beginPath(); g.ellipse(q.x, q.y, 11, 11, 0, 0, Math.PI * 2); g.stroke(); }
      if (n.kind === "contacted") {
        const cp = this.crmPos(); const ang = Math.atan2(cp.y - q.y, cp.x - q.x); const p = (this.t * 0.8 + n.x * 0.001) % 1;
        g.strokeStyle = rgba(CYAN, (1 - p) * 0.7 * al); g.lineWidth = 1; g.beginPath(); g.moveTo(q.x + Math.cos(ang) * (6 + p * 20), q.y + Math.sin(ang) * (6 + p * 20)); g.lineTo(q.x + Math.cos(ang) * (12 + p * 20), q.y + Math.sin(ang) * (12 + p * 20)); g.stroke();
      }
      if (n.kind === "follow_up" && n.followUpAt) this.drawTimeline(q.x, q.y, n.followUpAt, al);
      // analysis sequence for freshly discovered leads
      if (n.fresh) this.drawAnalysis(n, a, q.x, q.y, c, al);
      // score arc: while analysing, for high potential, or on hover/selection
      if (n.fresh || n.kind === "high_potential" || hover || isSel) {
        const build = n.fresh ? a : 99;
        this.drawArc(n, q.x, q.y, (isSel ? 16 : 12), build, al * (n.fresh || hover || isSel ? 1 : 0.55));
      }
      // hover: name + a line to the DARWIN emblem
      if (hover || isSel) {
        const e = this.emblemPos();
        g.strokeStyle = rgba(CYAN, 0.25); g.lineWidth = 0.7; g.setLineDash([2, 6]); g.lineDashOffset = -this.t * 20;
        g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(e.x, e.y); g.stroke(); g.setLineDash([]);
        if (!isSel) {
          g.globalCompositeOperation = "source-over";
          g.font = `500 11px "Barlow", system-ui, sans-serif`; g.textAlign = "left"; g.textBaseline = "middle";
          g.fillStyle = "rgba(4,8,16,0.75)"; const tw = g.measureText(n.name).width;
          g.fillRect(q.x + 12, q.y - 20, tw + 12, 18);
          g.fillStyle = rgba(WHITE, 0.95); g.fillText(n.name, q.x + 18, q.y - 11);
          g.globalCompositeOperation = "lighter";
        }
      }
    }
  }

  private drawAnalysis(n: Node, a: number, x: number, y: number, c: RGB, al: number) {
    const g = this.g;
    // scanning ring passing around the node
    if (a > 0.45 && a < 1.1) { const p = span(a, 0.45, 1.05); g.strokeStyle = rgba(WHITE, (1 - p) * 0.8 * al); g.lineWidth = 1; g.beginPath(); g.arc(x, y, 4 + p * 22, 0, Math.PI * 2); g.stroke(); }
    // data particles flowing in
    if (a > 0.7 && a < 1.5) {
      const p = span(a, 0.7, 1.5);
      for (let i = 0; i < 10; i++) { const ang = i * 0.628 + a * 3; const r = 26 * (1 - p) + 3; g.fillStyle = rgba(CYAN, 0.8 * al * (1 - p * 0.5)); g.fillRect(x + Math.cos(ang) * r - 0.8, y + Math.sin(ang) * r - 0.8, 1.6, 1.6); }
    }
    // website check: a miniature holographic browser rises, then collapses back
    if (a > 1.1 && a < 2.4 && this.browsersActive <= 3) {
      const rise = easeOut(span(a, 1.1, 1.45)), fold = easeInOut(span(a, 2.05, 2.4));
      const w = 88 * (1 - fold), h = 58 * (1 - fold);
      const bx = x - w / 2, by = y - 26 - 34 * rise * (1 - fold) - h;
      if (w > 4) {
        g.globalCompositeOperation = "source-over";
        g.fillStyle = `rgba(10,20,36,${(0.8 * rise * al).toFixed(3)})`; g.fillRect(bx, by, w, h);
        g.strokeStyle = rgba(WHITE, 0.5 * rise * al); g.lineWidth = 0.8; g.strokeRect(bx, by, w, h);
        g.globalCompositeOperation = "lighter";
        g.fillStyle = rgba(CYAN, 0.35 * rise * al); g.fillRect(bx + 2, by + 2, w - 4, 5); // tab bar
        if (n.hasWebsite) {
          // abstract page structure, a load bar and a phone outline
          const lp = span(a, 1.35, 1.95);
          g.fillStyle = rgba(CYAN, 0.25 * al); g.fillRect(bx + 5, by + 11, (w - 10) * 0.55, h * 0.3);
          for (let i = 0; i < 3; i++) g.fillRect(bx + 5, by + 11 + h * 0.36 + i * 5, (w - 10) * (0.35 + i * 0.1), 1.5);
          g.fillStyle = rgba(WHITE, 0.7 * al); g.fillRect(bx + 4, by + h - 5, (w - 8) * lp, 1.5);
          g.strokeStyle = rgba(CYAN, 0.5 * al); g.strokeRect(bx + w * 0.72, by + 11, w * 0.2, h * 0.62);
        } else {
          // nothing listed: an empty window with a little static and an ✕
          for (let i = 0; i < 18; i++) { g.fillStyle = rgba(AMBER, 0.25 * al * Math.random()); g.fillRect(bx + 4 + Math.random() * (w - 8), by + 10 + Math.random() * (h - 14), 2, 1); }
          g.strokeStyle = rgba(AMBER, 0.7 * al); g.lineWidth = 1; g.beginPath();
          g.moveTo(bx + w / 2 - 6, by + h / 2 - 2); g.lineTo(bx + w / 2 + 6, by + h / 2 + 10); g.moveTo(bx + w / 2 + 6, by + h / 2 - 2); g.lineTo(bx + w / 2 - 6, by + h / 2 + 10); g.stroke();
        }
      }
    }
    // phone check: a quick pulse
    if (a > 1.9 && a < 2.6) { const p = span(a, 1.9, 2.6); g.strokeStyle = rgba(n.hasPhone ? CYAN : GREY, (1 - p) * 0.7 * al); g.lineWidth = 1; g.beginPath(); g.arc(x, y, 6 + p * 10, 0, Math.PI * 2); g.stroke(); }
    // classification + score, briefly
    if (a > 2.9 && a < 4.2) {
      const p = span(a, 2.9, 3.2) * (1 - span(a, 3.8, 4.2));
      g.globalCompositeOperation = "source-over";
      g.font = `600 9px "Barlow", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "bottom";
      g.fillStyle = rgba(c, 0.95 * p * al);
      if (n.kind !== "high_potential" && n.kind !== "no_website") g.fillText(kindText(n.kind), x, y - 18);
      g.font = `500 10px "Barlow", system-ui, sans-serif`; g.textBaseline = "top";
      g.fillStyle = rgba(WHITE, 0.85 * p * al); g.fillText(`FIT ${n.score}`, x, y + 18);
      g.globalCompositeOperation = "lighter";
    }
  }

  /** Arc of five segments (website · contact · presence · quality · opportunity), built as DARWIN evaluates. */
  private drawArc(n: Node, x: number, y: number, r: number, build: number, al: number) {
    const g = this.g; const segs = 5; const gap = 0.14; const total = Math.PI * 1.6; const start = -Math.PI * 1.3;
    const segLen = total / segs - gap;
    for (let i = 0; i < segs; i++) {
      const fill = easeOut(span(build, 1.4 + i * 0.3, 1.7 + i * 0.3));
      const v = n.checks[i];
      const a0 = start + i * (total / segs);
      g.strokeStyle = rgba(WHITE, 0.12 * al); g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, r, a0, a0 + segLen); g.stroke();
      if (fill <= 0 || v == null) continue;
      g.strokeStyle = rgba(i === 4 ? VIOLET : v > 0.7 ? CYAN : v > 0.4 ? BLUE : GREY, 0.9 * al);
      g.beginPath(); g.arc(x, y, r, a0, a0 + segLen * fill * clamp(0.25 + v * 0.75)); g.stroke();
    }
  }

  /** A thin temporal line: the point brightens as the follow-up date approaches. */
  private drawTimeline(x: number, y: number, due: number, al: number) {
    const g = this.g; const days = (due - Date.now()) / 86_400_000; const len = 46;
    const pos = clamp(1 - days / 14); // 14 days out → bottom, due → top
    g.strokeStyle = rgba(GOLD, 0.3 * al); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + 10, y); g.lineTo(x + 10, y - len); g.stroke();
    const py = y - len * pos; const bright = days <= 0 ? 1 : 0.3 + pos * 0.7;
    g.fillStyle = rgba(days <= 0 ? AMBER : GOLD, bright * al); g.beginPath(); g.arc(x + 10, py, 2 + bright * 1.5 + (days <= 0 ? Math.sin(this.t * 5) * 0.8 : 0), 0, Math.PI * 2); g.fill();
  }

  private drawStreams() {
    const g = this.g; const spr = this.glowSprite();
    for (const f of this.flights) {
      const p = clamp((f.t - f.delay) / f.dur); if (p <= 0) continue;
      const e = easeInOut(p);
      const mx = (f.x0 + f.x1) / 2, my = Math.min(f.y0, f.y1) - 40;
      const x = (1 - e) ** 2 * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1, y = (1 - e) ** 2 * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1;
      const a = Math.sin(p * Math.PI);
      if (f.size > 1.5) { g.globalAlpha = a * 0.9; g.drawImage(spr, x - 5, y - 5, 10, 10); g.globalAlpha = 1; }
      else { g.fillStyle = rgba(f.c, a); g.fillRect(x - 1, y - 1, 2, 2); }
    }
    // DARWIN's data connections toward the map while it's working
    if (this.emblemGlow > 0.3) {
      const e = this.emblemPos(); const c = this.proj(0, 0, 0, this.cam);
      if (c) {
        g.lineWidth = 0.7;
        for (let i = 0; i < 3; i++) {
          const p = (this.t * 0.6 + i / 3) % 1;
          g.strokeStyle = rgba(CYAN, 0.12 * this.emblemGlow);
          g.beginPath(); g.moveTo(e.x, e.y); g.quadraticCurveTo(lerp(e.x, c.x, 0.5), e.y + 30 + i * 20, c.x + (i - 1) * 30, c.y); g.stroke();
          const x = lerp(e.x, c.x + (i - 1) * 30, p), y = lerp(e.y, c.y, p * p);
          g.fillStyle = rgba(WHITE, 0.7 * this.emblemGlow * Math.sin(p * Math.PI)); g.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }
  }

  /** The DARWIN intelligence emblem — a small geometric symbol, not an orb. */
  private drawEmblem() {
    const g = this.g; const e = this.emblemPos(); const r = 22; const G = this.emblemGlow;
    const spin = this.t * 0.25;
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: e.x + Math.cos(spin + (i * Math.PI) / 3) * r, y: e.y + Math.sin(spin + (i * Math.PI) / 3) * r }));
    g.strokeStyle = rgba(WHITE, 0.4 + G * 0.4); g.lineWidth = 1;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
    g.strokeStyle = rgba(CYAN, 0.25 + G * 0.35); g.beginPath();
    for (let i = 0; i < 6; i += 2) { g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[(i + 2) % 6].x, pts[(i + 2) % 6].y); g.moveTo(pts[i].x, pts[i].y); g.lineTo(e.x, e.y); }
    for (let i = 1; i < 6; i += 2) { g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[(i + 2) % 6].x, pts[(i + 2) % 6].y); }
    g.stroke();
    const spr = this.glowSprite(); const gs = 26 + G * 18;
    g.globalAlpha = 0.25 + G * 0.5; g.drawImage(spr, e.x - gs / 2, e.y - gs / 2, gs, gs); g.globalAlpha = 1;
  }

  private drawCrm() {
    const g = this.g; const c = this.crmPos(); const G = this.crmGlow;
    g.strokeStyle = rgba(WHITE, 0.35 + G * 0.6); g.lineWidth = 1;
    g.strokeRect(c.x - 18, c.y - 13, 36, 26);
    g.fillStyle = rgba(BLUE, 0.06 + G * 0.2); g.fillRect(c.x - 18, c.y - 13, 36, 26);
    g.globalCompositeOperation = "source-over";
    g.font = `600 10px "Barlow", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = rgba(WHITE, 0.75 + G * 0.25); g.fillText("CRM", c.x, c.y + 0.5);
    g.globalCompositeOperation = "lighter";
    // a dotted trail toward the edge of the screen (records flow onward)
    for (let i = 1; i < 6; i++) { const p = (this.t * 0.5 + i / 6) % 1; g.fillStyle = rgba(CYAN, 0.35 * (1 - p)); g.fillRect(c.x + 22 + p * 36, c.y - 1, 2, 2); }
  }

  private drawLabels() {
    const g = this.g;
    g.font = `600 11px "Barlow", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    for (const l of this.labels) {
      const a = span(l.t, 0, 0.25) * (1 - span(l.t, l.max - 0.5, l.max));
      g.fillStyle = rgba(l.c, a); g.fillText(l.text.split("").join(" "), l.x, l.y - l.t * 6);
    }
  }

  private drawError() {
    const g = this.g; const t = this.errorT;
    const x = lerp(-120, this.W + 120, span(t, 0.2, 1.6));
    const gr = g.createLinearGradient(x - 120, 0, x + 120, 0);
    gr.addColorStop(0, rgba(AMBER, 0)); gr.addColorStop(0.5, rgba(AMBER, 0.12 * (1 - span(t, 1.6, 2.4)))); gr.addColorStop(1, rgba(AMBER, 0));
    g.fillStyle = gr; g.fillRect(x - 120, 0, 240, this.H);
  }

  private kindColor(k: NodeKind): RGB {
    return k === "high_potential" ? CYAN : k === "no_website" || k === "weak_website" ? AMBER : k === "client" ? GOLD : k === "follow_up" ? GOLD : k === "not_interested" ? GREY : k === "contacted" ? BLUE : k === "verified" ? CYAN : WHITE;
  }

  private glowSprite() {
    if (this.sprite) return this.sprite;
    const s = document.createElement("canvas"); s.width = s.height = 32;
    const g = s.getContext("2d")!; const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(140,220,255,0.6)"); gr.addColorStop(1, "rgba(70,150,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return (this.sprite = s);
  }
}

function rand(a: number, b: number) { return a + Math.random() * (b - a); }
function kindText(k: NodeKind) {
  return ({ discovered: "DISCOVERED", verified: "VERIFIED", no_website: "NO WEBSITE", weak_website: "WEAK WEBSITE", high_potential: "HIGH POTENTIAL", contacted: "CONTACTED", follow_up: "FOLLOW-UP", client: "CLIENT", not_interested: "NOT INTERESTED" } as const)[k];
}
