"use client";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * FRIDAY's interactive viewer (three.js). Loads the GLB Blender exported and
 * gives the workspace everything it controls: orbit / zoom / pan, camera
 * presets, perspective ↔ orthographic, reset, part selection + highlight,
 * wireframe / solid / material shading, a material preview, the exploded view,
 * a section cut, and direct camera moves for hand gestures.
 *
 * Coordinates: Blender (x right, y back, z up) → glTF (x right, y up, z towards
 * the front camera). Part metadata comes from the GLB's extras (friday_id…).
 */

export type Preset = "front" | "rear" | "left" | "right" | "top" | "bottom" | "iso" | "iso_rear";
export type Shading = "material" | "solid" | "wireframe";
export interface PartInfo { id: string; name: string; group: string; internal: boolean; conceptual: boolean; material: string }

const DIRS: Record<Preset, [number, number, number]> = {
  front: [0, 0, 1], rear: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
  iso: [-0.75, 0.45, 1], iso_rear: [0.8, 0.5, -1],
};

interface Part { id: string; root: THREE.Object3D; meshes: THREE.Mesh[]; home: THREE.Vector3; explode: THREE.Vector3; info: PartInfo }

export class ViewerCore {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private model: THREE.Object3D | null = null;
  private parts: Part[] = [];
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private solidMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.6, metalness: 0.05 });
  private wireMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.85 });
  private clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private grid: THREE.GridHelper;
  private center = new THREE.Vector3();
  private radius = 0.1;
  private raf = 0;
  private anim: { from: THREE.Vector3; to: THREE.Vector3; t0: number; ms: number } | null = null;
  private frames: number[] = [];
  private ro: ResizeObserver;
  shading: Shading = "material";
  explodeAmount = 0;
  section: { axis: "x" | "y" | "z"; at: number } | null = null;
  selected: string | null = null;
  onSelect?: (id: string | null) => void;
  onChange?: () => void;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });

    this.scene.background = new THREE.Color(0x05080f);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(-2, 3, 2.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.8); rim.position.set(2, 1.5, -2.5); this.scene.add(rim);
    this.grid = new THREE.GridHelper(1, 20, 0x22d3ee, 0x0e3a4a);
    (this.grid.material as THREE.Material).transparent = true; (this.grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(this.grid);

    const { w, h } = this.size();
    this.persp = new THREE.PerspectiveCamera(35, w / h, 0.001, 100);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener("change", () => this.onChange?.());

    // click (not drag) selects a part
    let down: { x: number; y: number } | null = null;
    this.renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.pick(e.clientX, e.clientY);
      down = null;
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      this.step(t);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.frames.push(t);
      while (this.frames.length && t - this.frames[0] > 1000) this.frames.shift();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Frames actually drawn in the last second (measured, not estimated). */
  get fps(): number | null { return this.frames.length > 5 ? this.frames.length : null; }
  get isOrtho() { return this.camera === this.ortho; }
  get partList(): PartInfo[] { return this.parts.map((p) => p.info); }

  private size() { return { w: Math.max(1, this.host.clientWidth), h: Math.max(1, this.host.clientHeight) }; }

  private resize() {
    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.fitOrtho();
  }

  private fitOrtho() {
    const { w, h } = this.size();
    const d = this.camera === this.ortho ? this.ortho.position.distanceTo(this.controls.target) : this.persp.position.distanceTo(this.controls.target);
    const half = Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * d;
    this.ortho.left = -half * (w / h); this.ortho.right = half * (w / h); this.ortho.top = half; this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  async load(url: string): Promise<PartInfo[]> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.clear();
    const root = gltf.scene;
    this.scene.add(root);
    this.model = root;
    const box = new THREE.Box3().setFromObject(root);
    box.getCenter(this.center);
    this.radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.005);
    this.grid.scale.setScalar(this.radius * 4);
    this.grid.position.set(this.center.x, box.min.y - this.radius * 0.02, this.center.z);
    root.traverse((o) => {
      const ud = o.userData as Record<string, unknown>;
      if (typeof ud.friday_id !== "string" || this.parts.some((p) => p.id === ud.friday_id)) return;
      const meshes: THREE.Mesh[] = [];
      o.traverse((m) => { if ((m as THREE.Mesh).isMesh) meshes.push(m as THREE.Mesh); });
      if (!meshes.length) return;
      const ex = Array.isArray(ud.friday_explode) ? (ud.friday_explode as number[]) : null;
      const firstMat = (Array.isArray(meshes[0].material) ? meshes[0].material[0] : meshes[0].material) as THREE.Material;
      this.parts.push({
        id: ud.friday_id, root: o, meshes, home: o.position.clone(),
        explode: ex ? new THREE.Vector3(ex[0], ex[2], -ex[1]) : new THREE.Vector3(), // Blender → glTF axes
        info: { id: ud.friday_id, name: String(o.name || ud.friday_id).replace(/_/g, " "), group: String(ud.friday_group ?? "Model"), internal: !!ud.friday_internal, conceptual: !!ud.friday_conceptual, material: firstMat?.name ?? "" },
      });
    });
    // parts without their own explode offset move away from the centre (like the exploded render)
    for (const p of this.parts) if (p.explode.lengthSq() === 0) {
      const c = new THREE.Box3().setFromObject(p.root).getCenter(new THREE.Vector3()).sub(this.center);
      p.explode = (c.lengthSq() > 1e-10 ? c.normalize() : new THREE.Vector3(0, 1, 0)).multiplyScalar(this.radius * (p.info.internal ? 0.55 : 0.35));
    }
    for (const p of this.parts) for (const m of p.meshes) this.originals.set(m, m.material);
    this.applyShading();
    this.applyExplode();
    this.applySection();
    this.reset(false);
    return this.partList;
  }

  private clear() {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); } });
    }
    this.parts = []; this.originals.clear(); this.selected = null; this.model = null;
  }

  // —— camera ——
  private distFor() { return this.radius / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * 1.25; }

  setPreset(p: Preset, animate = true) {
    const dir = new THREE.Vector3(...DIRS[p]).normalize();
    const to = this.center.clone().add(dir.multiplyScalar(this.distFor()));
    this.controls.target.copy(this.center);
    if (animate) this.anim = { from: this.camera.position.clone(), to, t0: performance.now(), ms: 450 };
    else { this.camera.position.copy(to); this.fitOrtho(); }
    this.camera.up.set(0, 1, 0);
    this.onChange?.();
  }

  reset(animate = true) {
    this.persp.zoom = 1; this.ortho.zoom = 1; this.persp.updateProjectionMatrix(); this.ortho.updateProjectionMatrix();
    this.setPreset("iso", animate);
  }

  setOrtho(on: boolean) {
    if (on === this.isOrtho) return;
    const next = on ? this.ortho : this.persp;
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    this.camera = next;
    this.controls.object = next;
    this.fitOrtho();
    this.onChange?.();
  }

  private step(t: number) {
    if (!this.anim) return;
    const k = Math.min(1, (t - this.anim.t0) / this.anim.ms);
    const e = 1 - Math.pow(1 - k, 3);
    this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
    this.camera.lookAt(this.controls.target);
    if (this.isOrtho) this.fitOrtho();
    if (k >= 1) this.anim = null;
  }

  /** Gesture input: yaw/pitch in radians around the target. */
  rotateBy(yaw: number, pitch: number) {
    this.anim = null;
    const off = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    s.theta -= yaw;
    s.phi = THREE.MathUtils.clamp(s.phi - pitch, 0.05, Math.PI - 0.05);
    off.setFromSpherical(s);
    this.camera.position.copy(this.controls.target).add(off);
    this.camera.lookAt(this.controls.target);
    this.onChange?.();
  }

  /** factor < 1 = closer */
  zoomBy(f: number) {
    this.anim = null;
    if (this.isOrtho) { this.ortho.zoom = THREE.MathUtils.clamp(this.ortho.zoom / f, 0.1, 40); this.ortho.updateProjectionMatrix(); }
    else {
      const off = this.camera.position.clone().sub(this.controls.target);
      const d = THREE.MathUtils.clamp(off.length() * f, this.radius * 0.15, this.radius * 40);
      this.camera.position.copy(this.controls.target).add(off.setLength(d));
    }
    this.onChange?.();
  }

  /** dx, dy: fraction of the viewport (x right, y up) */
  panBy(dx: number, dy: number) {
    this.anim = null;
    const d = this.camera.position.distanceTo(this.controls.target);
    const h = this.isOrtho ? (this.ortho.top - this.ortho.bottom) / this.ortho.zoom : 2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * d;
    const { w, h: ph } = this.size();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * h * (w / ph)).add(up.multiplyScalar(-dy * h));
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.onChange?.();
  }

  setControlsEnabled(on: boolean) { this.controls.enabled = on; }

  /** The camera's rotation (for the view cube). */
  cameraQuaternion() { return this.camera.quaternion.clone(); }

  // —— display ——
  setShading(s: Shading) { this.shading = s; this.applyShading(); this.onChange?.(); }

  private applyShading() {
    for (const p of this.parts) for (const m of p.meshes) {
      m.material = this.shading === "material" ? this.originals.get(m)! : this.shading === "solid" ? this.solidMat : this.wireMat;
    }
    this.applySection();
    this.highlight();
  }

  /** 0 … 1 */
  setExplode(t: number) { this.explodeAmount = THREE.MathUtils.clamp(t, 0, 1); this.applyExplode(); this.onChange?.(); }

  private applyExplode() {
    for (const p of this.parts) {
      // offsets are in world space; convert into the part's parent space
      const parent = p.root.parent;
      const off = p.explode.clone().multiplyScalar(this.explodeAmount);
      if (parent) {
        const inv = new THREE.Matrix3().setFromMatrix4(parent.matrixWorld).invert();
        off.applyMatrix3(inv);
      }
      p.root.position.copy(p.home).add(off);
    }
  }

  /** at: −1 … 1 across the model along that axis */
  setSection(s: { axis: "x" | "y" | "z"; at: number } | null) { this.section = s; this.applySection(); this.onChange?.(); }

  private applySection() {
    const planes = this.section ? [this.clip] : [];
    if (this.section) {
      const n = this.section.axis === "x" ? new THREE.Vector3(-1, 0, 0) : this.section.axis === "y" ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
      const c = this.section.axis === "x" ? this.center.x : this.section.axis === "y" ? this.center.y : this.center.z;
      this.clip.normal.copy(n);
      this.clip.constant = c + this.section.at * this.radius;
    }
    const all = new Set<THREE.Material>([this.solidMat, this.wireMat]);
    for (const v of this.originals.values()) (Array.isArray(v) ? v : [v]).forEach((m) => all.add(m));
    for (const m of all) { m.clippingPlanes = planes; m.side = this.section ? THREE.DoubleSide : (m === this.wireMat ? THREE.FrontSide : m.side); m.needsUpdate = true; }
  }

  select(id: string | null) { this.selected = id && this.parts.some((p) => p.id === id) ? id : null; this.highlight(); this.onSelect?.(this.selected); this.onChange?.(); }

  private highlight() {
    for (const p of this.parts) for (const m of p.meshes) {
      const on = p.id === this.selected;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (on && this.shading === "material") {
        // a highlighted copy, so the original material stays untouched
        m.material = mats.map((x) => { const c = (x as THREE.MeshStandardMaterial).clone(); if ("emissive" in c) { c.emissive = new THREE.Color(0x22d3ee); c.emissiveIntensity = 0.35; } return c; }) as unknown as THREE.Material;
        if ((m.material as unknown as THREE.Material[]).length === 1) m.material = (m.material as unknown as THREE.Material[])[0];
      } else if (this.shading === "material") m.material = this.originals.get(m)!;
    }
  }

  private pick(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.parts.flatMap((p) => p.meshes), false).filter((h) => !this.section || this.clip.distanceToPoint(h.point) >= 0);
    const hit = hits[0]?.object;
    const part = hit ? this.parts.find((p) => p.meshes.includes(hit as THREE.Mesh)) : null;
    this.select(part?.id ?? null);
  }

  /** The selected part's current material (for the inspector). */
  materialOf(id: string): { name: string; color: string; metalness: number; roughness: number; opacity: number } | null {
    const p = this.parts.find((x) => x.id === id);
    const o = p && this.originals.get(p.meshes[0]);
    const m = (Array.isArray(o) ? o[0] : o) as THREE.MeshStandardMaterial | undefined;
    if (!m) return null;
    return { name: m.name, color: `#${m.color?.getHexString() ?? "888888"}`, metalness: m.metalness ?? 0, roughness: m.roughness ?? 0.5, opacity: m.opacity ?? 1 };
  }

  /** Preview a material change on one part (viewer only — not a new version). */
  previewMaterial(id: string, v: { color?: string; metalness?: number; roughness?: number }) {
    const p = this.parts.find((x) => x.id === id);
    if (!p) return;
    for (const m of p.meshes) {
      const o = this.originals.get(m);
      const base = (Array.isArray(o) ? o[0] : o) as THREE.MeshStandardMaterial;
      const c = base.clone();
      if (v.color) c.color = new THREE.Color(v.color);
      if (v.metalness != null) c.metalness = v.metalness;
      if (v.roughness != null) c.roughness = v.roughness;
      this.originals.set(m, c);
    }
    this.applyShading();
    this.onChange?.();
  }

  /** world bounding box of a part in mm (Blender axes), for the inspector */
  partBoxMm(id: string): { center: [number, number, number]; size: [number, number, number] } | null {
    const p = this.parts.find((x) => x.id === id);
    if (!p) return null;
    const b = new THREE.Box3().setFromObject(p.root);
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const mm = (n: number) => Math.round(n * 10000) / 10;
    return { center: [mm(c.x), mm(-c.z), mm(c.y)], size: [mm(s.x), mm(s.z), mm(s.y)] };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
