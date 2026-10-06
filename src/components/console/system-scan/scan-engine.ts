import type { NodeId, NodeState, StageId } from "@/lib/system/types";

/**
 * The motion graphics of JARVIS's system analysis, on one canvas: the core
 * expands into SYSTEM ANALYSIS MODE, concentric holographic rings turn, a
 * scanning beam sweeps, data streams flow, and each agent is a node around
 * the core. Purely visual — it only shows what the analysis reports: the node
 * being checked pulses and exchanges data with the core, a real warning or
 * failure flashes its node, a verified node settles into its healthy state.
 */

type RGB = [number, number, number];
const CYAN: RGB = [70, 205, 255];
const ICE: RGB = [190, 240, 255];
const AMBER: RGB = [255, 196, 84];
const GOOD: RGB = [90, 255, 190];
const WARN: RGB = [255, 184, 64];
const BAD: RGB = [255, 84, 96];

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const easeOut = (x: number) => 1 - (1 - clamp(x)) ** 3;
const approach = (cur: number, target: number, dt: number, k: number) => cur + (target - cur) * (1 - Math.exp(-dt * k));
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a)})`;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const TAU = Math.PI * 2;

const MUTED: RGB = [120, 150, 175];
const STATE_COLOR: Record<NodeState, RGB> = { idle: CYAN, scanning: ICE, healthy: GOOD, warning: WARN, error: BAD, inactive: MUTED };

interface SceneNode {
  /** index in the constellation (its place is worked out from the screen size) */
  id: Exclude<NodeId, "core">; label: string; role: string; angle: number;
  state: NodeState; color: RGB; glow: number; scale: number; flash: number; flashColor: RGB; doneAt: number;
  x: number; y: number;
}
interface Packet { node: string; t: number; v: number; out: boolean; color: RGB; size: number }
interface Dust { a: number; r: number; w: number; size: number; tw: number }
interface Wave { r: number; v: number; life: number; color: RGB; width: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: RGB }

/** Where the core and the agent nodes sit (shared with the page for the HUD). */
export function scanLayout(w: number, h: number) {
  const narrow = w < 640;
  const R = clamp(Math.min(w, h) * (narrow ? 0.12 : 0.105), 46, 118);
  const cx = w / 2, cy = h * (narrow ? 0.44 : 0.47);
  const rx = Math.min(w * (narrow ? 0.4 : 0.36), R * (narrow ? 2.9 : 4.1));
  const ry = Math.min(h * (narrow ? 0.3 : 0.29), R * 2.5);
  return { R, cx, cy, rx, ry, narrow };
}

export class ScanEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private raf = 0; private last = 0; private t = 0;
  private reduce: boolean;
  private nodes: SceneNode[];
  private focusId: NodeId | null = null;
  private stage: StageId | null = null;
  private startedAt = -1; private doneAt = -1; private doneColor: RGB = GOOD;
  private intro = 0; private activity = 0.3; private beamSpeed = 0.6; private beamA = -Math.PI / 2;
  private rings = [0, 0, 0, 0, 0];
  private cam = { x: 0, y: 0, z: 1.18, rot: 0 };
  private packets: Packet[] = []; private dust: Dust[] = []; private waves: Wave[] = []; private sparks: Spark[] = [];
  private coreFlash = 0; private coreColor: RGB = CYAN;

  constructor(private canvas: HTMLCanvasElement, nodes: { id: Exclude<NodeId, "core">; label: string; role: string }[]) {
    this.ctx = canvas.getContext("2d")!;
    this.reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // three agents on each side of the core, like a constellation
    this.nodes = nodes.map((n, i) => ({ ...n, angle: i, state: "idle", color: [...CYAN], glow: 0, scale: 0, flash: 0, flashColor: WARN, doneAt: 0, x: 0, y: 0 }));
    this.dust = Array.from({ length: this.reduce ? 40 : 110 }, () => ({ a: Math.random() * TAU, r: 1.15 + Math.random() * 1.25, w: (0.05 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1), size: 0.5 + Math.random() * 1.3, tw: Math.random() * TAU }));
    this.resize();
  }

  /* ---------------- driven by the real analysis ---------------- */

  begin() { this.startedAt = this.t; this.waves.push({ r: 0.9, v: 2.4, life: 1, color: CYAN, width: 2 }); }
  setStage(stage: StageId) {
    this.stage = stage;
    this.waves.push({ r: 1.05, v: 1.6, life: 1, color: stage === "security" ? AMBER : CYAN, width: 1.4 });
    if (stage === "connections") for (const n of this.nodes) for (let i = 0; i < 3; i++) this.packets.push({ node: n.id, t: -i * 0.22, v: 0.9, out: true, color: CYAN, size: 1.6 });
  }
  focus(node: NodeId) {
    this.focusId = node;
    const n = this.nodes.find((x) => x.id === node);
    if (n && n.state === "idle") n.state = "scanning";
  }
  /** A check's result arrived: data flows back from that node; a real problem flashes it. */
  check(node: NodeId, status: "ok" | "warn" | "fail" | "info") {
    this.activity = Math.min(1.4, this.activity + 0.35);
    const color = status === "fail" ? BAD : status === "warn" ? WARN : status === "ok" ? GOOD : ICE;
    if (node === "core") {
      this.waves.push({ r: 0.95, v: 1.3, life: 0.8, color, width: status === "fail" ? 2.2 : 1.1 });
      if (status === "warn" || status === "fail") { this.coreFlash = 1; this.coreColor = color; }
      return;
    }
    for (let i = 0; i < 4; i++) this.packets.push({ node, t: 1 + i * 0.12, v: -1.25, out: false, color, size: 1.8 });
    this.packets.push({ node, t: -0.05, v: 1.4, out: true, color: CYAN, size: 1.5 });
    const n = this.nodes.find((x) => x.id === node);
    if (n && (status === "warn" || status === "fail")) { n.flash = 1; n.flashColor = color; this.burst(n.x, n.y, color, 14); }
  }
  setNode(node: NodeId, state: Exclude<NodeState, "idle" | "scanning">) {
    if (node === "core") { this.coreColor = STATE_COLOR[state]; this.coreFlash = state === "healthy" ? 0.6 : 1; return; }
    const n = this.nodes.find((x) => x.id === node);
    if (!n) return;
    n.state = state; n.doneAt = this.t;
    this.burst(n.x, n.y, STATE_COLOR[state], state === "healthy" ? 10 : 18);
  }
  finish(verdict: "healthy" | "warning" | "error" | "inactive") {
    this.doneAt = this.t; this.focusId = null; this.doneColor = STATE_COLOR[verdict];
    this.waves.push({ r: 1, v: 3.2, life: 1, color: this.doneColor, width: 2.6 }, { r: 1, v: 2.2, life: 1, color: this.doneColor, width: 1.2 });
  }
  /** Screen position of a node (for the HUD). */
  nodeAt(id: NodeId): { x: number; y: number } | null {
    const n = this.nodes.find((x) => x.id === id);
    return n ? { x: n.x, y: n.y } : null;
  }

  /* ---------------- lifecycle ---------------- */

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }
  start() {
    const loop = (now: number) => {
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
      this.last = now;
      if (!document.hidden) { this.update(dt); this.draw(); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() { cancelAnimationFrame(this.raf); }

  /* ---------------- simulation ---------------- */

  private burst(x: number, y: number, color: RGB, n: number) {
    if (this.reduce) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 20 + Math.random() * 70;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.5 + Math.random() * 0.6, color });
    }
  }

  private update(dt: number) {
    this.t += dt;
    const running = this.startedAt >= 0 && this.doneAt < 0;
    this.intro = approach(this.intro, this.startedAt >= 0 ? 1 : 0.35, dt, 2.2);
    this.activity = approach(this.activity, running ? 0.45 : 0.18, dt, 1.4);
    this.beamSpeed = approach(this.beamSpeed, running ? (this.stage === "performance" ? 2.1 : 1.45) : 0.35, dt, 1.5);
    if (!this.reduce) this.beamA += dt * this.beamSpeed;
    const speeds = [0.22, -0.34, 0.15, -0.09, 0.5];
    for (let i = 0; i < this.rings.length; i++) this.rings[i] += dt * speeds[i] * (this.reduce ? 0.3 : 0.6 + this.activity);

    // camera: pulls back into analysis mode, then eases toward the agent being checked
    const L = scanLayout(this.w, this.h);
    const f = this.nodes.find((n) => n.id === this.focusId);
    const finished = this.doneAt >= 0;
    const tx = f ? (f.x - L.cx) * 0.13 : 0, ty = f ? (f.y - L.cy) * 0.13 : finished ? this.h * 0.17 : 0;
    this.cam.x = approach(this.cam.x, -tx, dt, 2.2); this.cam.y = approach(this.cam.y, -ty, dt, finished ? 1.4 : 2.2);
    this.cam.z = approach(this.cam.z, this.startedAt < 0 ? 1.18 : finished ? 0.84 : f ? 1.05 : 1, dt, 1.8);
    this.cam.rot = this.reduce ? 0 : Math.sin(this.t * 0.11) * 0.035;

    for (const n of this.nodes) {
      const target = n.id === this.focusId ? 1.38 : n.state === "idle" ? 0.82 : 1;
      n.scale = approach(n.scale, this.intro > 0.6 ? target : 0, dt, 5);
      n.glow = approach(n.glow, n.id === this.focusId ? 1 : n.state === "idle" ? 0.25 : 0.55, dt, 4);
      n.color = mix(n.color, n.flash > 0.05 ? n.flashColor : STATE_COLOR[n.state], 1 - Math.exp(-dt * 6));
      n.flash = Math.max(0, n.flash - dt * 0.9);
      // three agents each side; on a narrow screen they spread up and down instead
      const spread = L.narrow ? 0.29 : 0.19;
      const base = [Math.PI * (1 + spread), Math.PI, Math.PI * (1 - spread), -Math.PI * spread, 0, Math.PI * spread][n.angle % 6];
      const a = base + this.cam.rot * 2;
      n.x = L.cx + Math.cos(a) * L.rx; n.y = L.cy + Math.sin(a) * L.ry;
    }
    this.coreFlash = Math.max(0, this.coreFlash - dt * 0.8);

    // the active node streams data both ways
    if (running && f && !this.reduce && Math.random() < dt * 9) this.packets.push({ node: f.id, t: 0, v: 1.1 + Math.random() * 0.5, out: Math.random() < 0.55, color: Math.random() < 0.5 ? CYAN : ICE, size: 1 + Math.random() * 1.2 });
    for (const p of this.packets) p.t += dt * (p.out ? Math.abs(p.v) : -Math.abs(p.v));
    this.packets = this.packets.filter((p) => (p.out ? p.t < 1.05 : p.t > -0.05)).slice(-160);
    for (const d of this.dust) { d.a += dt * d.w * (0.4 + this.activity); d.tw += dt * 2; }
    for (const w of this.waves) { w.r += dt * w.v; w.life -= dt * 0.55; }
    this.waves = this.waves.filter((w) => w.life > 0);
    for (const s of this.sparks) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94; }
    this.sparks = this.sparks.filter((s) => s.life < s.max);
  }

  /* ---------------- drawing ---------------- */

  private draw() {
    const { ctx, w, h, dpr } = this;
    const L = scanLayout(w, h);
    const R = L.R * (0.72 + 0.28 * easeOut(this.intro));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // camera transform around the core
    ctx.save();
    ctx.translate(L.cx + this.cam.x, L.cy + this.cam.y);
    ctx.rotate(this.cam.rot * 0.3);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-L.cx, -L.cy);

    this.drawGrid(L.cx, L.cy, R);
    this.drawLinks(L.cx, L.cy, R);
    this.drawRings(L.cx, L.cy, R);
    this.drawBeam(L.cx, L.cy, R);
    this.drawWaveform(L.cx, L.cy, R);
    this.drawCore(L.cx, L.cy, R);
    for (const n of this.nodes) this.drawNode(n, R);
    this.drawPackets(L.cx, L.cy, R);
    this.drawSparks();
    ctx.restore();
  }

  private drawGrid(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // faint polar grid
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + i * 0.75), 0, TAU);
      ctx.strokeStyle = rgba(CYAN, 0.035 * this.intro); ctx.lineWidth = 1; ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU + this.rings[3] * 0.2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 1.9, cy + Math.sin(a) * R * 1.9); ctx.lineTo(cx + Math.cos(a) * R * 4.6, cy + Math.sin(a) * R * 4.6);
      ctx.strokeStyle = rgba(CYAN, 0.025 * this.intro); ctx.stroke();
    }
    // dust orbiting the rings
    for (const d of this.dust) {
      const x = cx + Math.cos(d.a) * R * d.r * 1.35, y = cy + Math.sin(d.a) * R * d.r;
      ctx.fillStyle = rgba(ICE, (0.15 + 0.25 * (0.5 + 0.5 * Math.sin(d.tw))) * this.intro);
      ctx.fillRect(x, y, d.size, d.size);
    }
    ctx.restore();
  }

  private drawRings(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const a = this.intro;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const ring = (r: number, rot: number, dash: number[], color: RGB, alpha: number, width: number) => {
      ctx.beginPath(); ctx.setLineDash(dash.map((d) => d * R / 100)); ctx.lineDashOffset = -rot * R;
      ctx.arc(cx, cy, r * R, 0, TAU); ctx.strokeStyle = rgba(color, alpha * a); ctx.lineWidth = width; ctx.stroke();
    };
    ring(1.18, this.rings[0], [2, 3], CYAN, 0.55, 1);
    ring(1.36, this.rings[1], [30, 8, 4, 8], CYAN, 0.45, 2);
    ring(1.62, this.rings[2], [1, 5], ICE, 0.35, 3);
    ring(1.9, this.rings[3], [60, 14], CYAN, 0.22, 1);
    ctx.setLineDash([]);
    // amber arc segments (like a HUD gauge)
    for (let i = 0; i < 3; i++) {
      const s = this.rings[4] + (i / 3) * TAU;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.48, s, s + 0.55);
      ctx.strokeStyle = rgba(AMBER, 0.6 * a); ctx.lineWidth = 2.2; ctx.stroke();
    }
    // tick marks
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * TAU + this.rings[1] * 0.5, long = i % 6 === 0;
      const r0 = R * 2.04, r1 = R * (long ? 2.16 : 2.09);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); ctx.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1);
      ctx.strokeStyle = rgba(CYAN, (long ? 0.4 : 0.18) * a); ctx.lineWidth = 1; ctx.stroke();
    }
    // expanding waves (a check landing, a stage starting, the finish)
    for (const wv of this.waves) {
      ctx.beginPath(); ctx.arc(cx, cy, R * wv.r, 0, TAU);
      ctx.strokeStyle = rgba(wv.color, wv.life * 0.55); ctx.lineWidth = wv.width; ctx.stroke();
    }
    ctx.restore();
  }

  private drawBeam(cx: number, cy: number, R: number) {
    if (this.intro < 0.2) return;
    const ctx = this.ctx;
    const a = this.beamA, span = 0.55;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createConicGradient ? ctx.createConicGradient(a - span, cx, cy) : null;
    if (g) {
      const k = span / TAU;
      g.addColorStop(0, rgba(CYAN, 0)); g.addColorStop(k * 0.85, rgba(CYAN, 0.16 * this.intro)); g.addColorStop(k, rgba(ICE, 0.38 * this.intro)); g.addColorStop(Math.min(1, k + 0.004), rgba(CYAN, 0)); g.addColorStop(1, rgba(CYAN, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * 2.3, 0, TAU); ctx.arc(cx, cy, R * 1.02, 0, TAU, true); ctx.fill("evenodd");
    }
    // the leading edge
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05); ctx.lineTo(cx + Math.cos(a) * R * 2.3, cy + Math.sin(a) * R * 2.3);
    ctx.strokeStyle = rgba(ICE, 0.6 * this.intro); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }

  private drawWaveform(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      const x0 = cx + side * R * 2.25, len = R * 1.6;
      for (let i = 0; i <= 60; i++) {
        const u = i / 60, x = x0 + side * u * len;
        const env = Math.sin(u * Math.PI);
        const y = cy + Math.sin(u * 22 - this.t * 7 * side) * Math.sin(u * 5 + this.t * 2) * R * 0.16 * env * (0.25 + this.activity);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = rgba(CYAN, 0.35 * this.intro); ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }

  private drawCore(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const tint = mix(CYAN, this.coreColor, this.coreFlash);
    const done = this.doneAt >= 0 ? clamp((this.t - this.doneAt) / 1.2) : 0;
    const c = mix(tint, this.doneColor, done * 0.6);
    ctx.save();
    // glow
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.6);
    g.addColorStop(0, rgba(c, 0.35 * this.intro)); g.addColorStop(0.6, rgba(c, 0.08 * this.intro)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.6, 0, TAU); ctx.fill();
    // glass sphere
    const s = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    s.addColorStop(0, rgba(ICE, 0.28)); s.addColorStop(0.55, rgba(c, 0.1)); s.addColorStop(1, rgba([4, 14, 28], 0.85));
    ctx.fillStyle = s; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(c, 0.7); ctx.lineWidth = 1.5; ctx.stroke();
    // turning wireframe (meridians + parallels)
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, TAU); ctx.clip();
    for (let i = 0; i < 6; i++) {
      const k = Math.cos(this.rings[0] * 3 + (i / 6) * Math.PI);
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(k) * R * 0.96, R * 0.96, 0, 0, TAU);
      ctx.strokeStyle = rgba(c, 0.18 + 0.12 * Math.abs(k)); ctx.lineWidth = 0.8; ctx.stroke();
    }
    for (let i = -2; i <= 2; i++) {
      const yy = cy + (i / 3) * R, rr = Math.sqrt(Math.max(0, R * R - (yy - cy) ** 2));
      ctx.beginPath(); ctx.ellipse(cx, yy, rr * 0.96, rr * 0.16, 0, 0, TAU);
      ctx.strokeStyle = rgba(c, 0.14); ctx.stroke();
    }
    ctx.restore();
    // inner nucleus pulse
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (2 + this.activity * 3));
    const n = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
    n.addColorStop(0, rgba(ICE, 0.5 + 0.3 * pulse)); n.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = n; ctx.beginPath(); ctx.arc(cx, cy, R * 0.45, 0, TAU); ctx.fill();
    // name
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rgba([235, 250, 255], 0.92 * this.intro);
    ctx.font = `600 ${Math.round(R * 0.24)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = rgba(c, 0.9); ctx.shadowBlur = 14;
    ctx.fillText("JARVIS", cx, cy);
    ctx.restore();
  }

  private linkEnds(n: SceneNode, cx: number, cy: number, R: number) {
    const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
    const nr = R * 0.3 * Math.max(0.5, n.scale);
    return { x0: cx + (dx / d) * R * 1.05, y0: cy + (dy / d) * R * 1.05, x1: n.x - (dx / d) * nr, y1: n.y - (dy / d) * nr };
  }

  private drawLinks(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const n of this.nodes) {
      if (n.scale < 0.05) continue;
      const e = this.linkEnds(n, cx, cy, R);
      const active = n.id === this.focusId;
      const g = ctx.createLinearGradient(e.x0, e.y0, e.x1, e.y1);
      g.addColorStop(0, rgba(CYAN, active ? 0.55 : 0.12)); g.addColorStop(1, rgba(n.color, active ? 0.8 : 0.22 + 0.2 * n.glow));
      ctx.strokeStyle = g; ctx.lineWidth = active ? 1.6 : 0.8;
      ctx.setLineDash(active ? [] : [3, 5]);
      ctx.beginPath(); ctx.moveTo(e.x0, e.y0); ctx.lineTo(e.x1, e.y1); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawPackets(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.packets) {
      const n = this.nodes.find((x) => x.id === p.node);
      if (!n || p.t < 0 || p.t > 1) continue;
      const e = this.linkEnds(n, cx, cy, R);
      const x = e.x0 + (e.x1 - e.x0) * p.t, y = e.y0 + (e.y1 - e.y0) * p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.size * 4);
      g.addColorStop(0, rgba(p.color, 0.95)); g.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, p.size * 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  private drawNode(n: SceneNode, R: number) {
    if (n.scale < 0.03) return;
    const ctx = this.ctx;
    const r = R * 0.3 * n.scale;
    const active = n.id === this.focusId;
    const pulse = active ? 0.5 + 0.5 * Math.sin(this.t * 6) : 0;
    const jitter = n.flash > 0.4 && !this.reduce ? (Math.random() - 0.5) * 3 * n.flash : 0;
    const x = n.x + jitter, y = n.y;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // halo
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * (2.6 + pulse));
    g.addColorStop(0, rgba(n.color, 0.35 * n.glow + 0.25 * n.flash)); g.addColorStop(1, rgba(n.color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * (2.6 + pulse), 0, TAU); ctx.fill();
    // rings
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = rgba(n.color, 0.85); ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 1.35, this.t * (active ? 2.4 : 0.6), this.t * (active ? 2.4 : 0.6) + 1.9); ctx.strokeStyle = rgba(n.color, 0.6); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 1.35, this.t * (active ? 2.4 : 0.6) + Math.PI, this.t * (active ? 2.4 : 0.6) + Math.PI + 0.9); ctx.stroke();
    if (active) {
      // scanning sweep inside the node
      const sa = this.t * 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r * 0.92, sa, sa + 0.8); ctx.closePath();
      ctx.fillStyle = rgba(ICE, 0.28); ctx.fill();
    }
    // nucleus — a check mark feel for healthy, a hollow ring for idle
    ctx.beginPath(); ctx.arc(x, y, r * (n.state === "idle" ? 0.22 : 0.38), 0, TAU);
    ctx.fillStyle = rgba(n.color, n.state === "idle" ? 0.5 : 0.9); ctx.fill();
    if (n.state === "healthy" && this.t - n.doneAt < 1.2) {
      ctx.beginPath(); ctx.arc(x, y, r * (1 + (this.t - n.doneAt) * 1.6), 0, TAU);
      ctx.strokeStyle = rgba(GOOD, 0.6 * (1 - (this.t - n.doneAt) / 1.2)); ctx.lineWidth = 1.5; ctx.stroke();
    }
    // label
    ctx.globalCompositeOperation = "source-over";
    const narrow = this.w < 640, left = n.x < this.w / 2;
    ctx.textAlign = narrow ? "center" : left ? "right" : "left"; ctx.textBaseline = "middle";
    const lx = narrow ? x : x + (left ? -1 : 1) * (r * 1.8 + 6);
    const ly = narrow ? y + r * 1.6 + 10 : y - 7;
    ctx.font = `600 ${Math.round(clamp(R * 0.15, 10, 14))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = rgba(mix([220, 240, 255], n.color, 0.35), active ? 1 : 0.75);
    ctx.fillText(n.label, lx, ly);
    ctx.font = `${Math.round(clamp(R * 0.11, 9, 11))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = rgba([170, 200, 220], active ? 0.85 : 0.5);
    ctx.fillText(n.state === "warning" ? "ATTENTION" : n.state === "error" ? "FAULT" : n.state === "healthy" ? "VERIFIED" : n.state === "inactive" ? "NOT IN USE" : active ? "SCANNING…" : n.role.toUpperCase(), lx, ly + 15);
    ctx.restore();
  }

  private drawSparks() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.sparks) {
      const k = 1 - s.life / s.max;
      ctx.fillStyle = rgba(s.color, k * 0.9);
      ctx.fillRect(s.x, s.y, 1.6, 1.6);
    }
    ctx.restore();
  }
}
