"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";

/**
 * HOLOGRAPHIC GLOBAL INTELLIGENCE MAP. Land is drawn from Natural Earth
 * (world-atlas, public domain) as a dot matrix. A marker sits only where a
 * story NAMES a place (city- or country-level, never inferred); its height is
 * the number of stories. An arc to Bengaluru means a story there was rated
 * highly relevant to Infinity Web & Apps. Falls back to a flat map without
 * WebGL; still with reduced motion.
 */

export interface GlobePlace { id: string; name: string; level: string; lat: number; lng: number; count: number; items: { id: string; title: string }[]; relevant: boolean }
const HOME = { lat: 12.97, lng: 77.59 };
const R = 1;

type Ring = [number, number][];
let dotsCache: Float32Array | null = null;
let ringsCache: { ring: Ring; box: [number, number, number, number] }[] | null = null;

function rings() {
  if (ringsCache) return ringsCache;
  const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;
  const geo = feature(topo, topo.objects.land) as unknown as { features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
  const out: { ring: Ring; box: [number, number, number, number] }[] = [];
  for (const f of geo.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
    for (const poly of polys) {
      const ring = poly[0] as Ring;
      let a = 180, b = -180, c = 90, d = -90;
      for (const [x, y] of ring) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
      out.push({ ring, box: [a, b, c, d] });
    }
  }
  return (ringsCache = out);
}

function onLand(lng: number, lat: number) {
  for (const { ring, box } of rings()) {
    if (lng < box[0] || lng > box[1] || lat < box[2] || lat > box[3]) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** Land dots as [lng, lat] pairs (computed once). */
function landDots() {
  if (dotsCache) return dotsCache;
  const pts: number[] = [];
  for (let lat = -58; lat <= 80; lat += 1.9) {
    const step = 1.9 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    for (let lng = -180; lng < 180; lng += step) if (onLand(lng, lat)) pts.push(lng, lat);
  }
  return (dotsCache = new Float32Array(pts));
}

const toVec = (lat: number, lng: number, r = R) => {
  const phi = ((90 - lat) * Math.PI) / 180, th = ((lng + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};

function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export function Globe({ places, selected, onSelect }: { places: GlobePlace[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [hover, setHover] = useState<{ p: GlobePlace; x: number; y: number } | null>(null);
  const placesRef = useRef(places), selRef = useRef(selected), onSelRef = useRef(onSelect);
  placesRef.current = places; selRef.current = selected; onSelRef.current = onSelect;
  const key = useMemo(() => places.map((p) => `${p.id}:${p.count}:${p.relevant ? 1 : 0}`).join("|"), [places]);

  useEffect(() => setWebgl(hasWebGL()), []);

  useEffect(() => {
    if (!webgl || !host.current) return;
    const el = host.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.25, 3.9);
    camera.lookAt(0, 0, 0);
    const world = new THREE.Group();
    scene.add(world);
    // tilt so India faces the viewer at the start
    world.rotation.y = -((HOME.lng + 90) * Math.PI) / 180;
    world.rotation.x = 0.28;

    const disposables: { dispose: () => void }[] = [];
    const add = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = world) => { parent.add(o); return o; };

    // body + atmosphere
    const bodyGeo = new THREE.SphereGeometry(R * 0.995, 64, 48), bodyMat = new THREE.MeshBasicMaterial({ color: 0x04101f }); // solid, so the far side's dots stay hidden
    add(new THREE.Mesh(bodyGeo, bodyMat)); disposables.push(bodyGeo, bodyMat);
    const atmoGeo = new THREE.SphereGeometry(R * 1.12, 48, 32);
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.35,0.75,1.0,1.0)*i; }",
    });
    add(new THREE.Mesh(atmoGeo, atmoMat), scene); disposables.push(atmoGeo, atmoMat);

    // graticule
    const grat: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let lng = -180; lng < 180; lng += 4) { const a = toVec(lat, lng, R * 1.001), b = toVec(lat, lng + 4, R * 1.001); grat.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    for (let lng = -180; lng < 180; lng += 30) for (let lat = -80; lat < 80; lat += 4) { const a = toVec(lat, lng, R * 1.001), b = toVec(lat + 4, lng, R * 1.001); grat.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const gratGeo = new THREE.BufferGeometry(); gratGeo.setAttribute("position", new THREE.Float32BufferAttribute(grat, 3));
    const gratMat = new THREE.LineBasicMaterial({ color: 0x3b7bbf, transparent: true, opacity: 0.12 });
    add(new THREE.LineSegments(gratGeo, gratMat)); disposables.push(gratGeo, gratMat);

    // land dots
    const ll = landDots(), pos = new Float32Array((ll.length / 2) * 3);
    for (let i = 0; i < ll.length / 2; i++) { const v = toVec(ll[i * 2 + 1], ll[i * 2], R * 1.003); pos.set([v.x, v.y, v.z], i * 3); }
    const dotGeo = new THREE.BufferGeometry(); dotGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dotMat = new THREE.PointsMaterial({ color: 0x8fe3ff, size: 0.016, transparent: true, opacity: 0.8, depthWrite: false });
    add(new THREE.Points(dotGeo, dotMat)); disposables.push(dotGeo, dotMat);

    // markers, rings, arcs
    const markers = new THREE.Group(); world.add(markers);
    const hit: THREE.Mesh[] = [];
    const pulses: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
    const buildMarkers = () => {
      for (const c of [...markers.children]) { markers.remove(c); (c as THREE.Mesh).geometry?.dispose(); ((c as THREE.Mesh).material as THREE.Material)?.dispose?.(); }
      hit.length = 0; pulses.length = 0;
      const ps = placesRef.current;
      const max = Math.max(1, ...ps.map((p) => p.count));
      const home = toVec(HOME.lat, HOME.lng, R * 1.004);
      for (const p of ps) {
        const on = selRef.current === p.id;
        const base = toVec(p.lat, p.lng, R * 1.004);
        const h = 0.06 + (p.count / max) * 0.22;
        const color = new THREE.Color(on ? 0xffffff : p.level === "city" ? 0x5fe1ff : 0x9b7bff);
        // light pillar
        const pg = new THREE.CylinderGeometry(0.0045, 0.0045, h, 6); pg.translate(0, h / 2, 0);
        const pm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
        const pillar = new THREE.Mesh(pg, pm);
        pillar.position.copy(base); pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), base.clone().normalize());
        markers.add(pillar);
        // tip + click target
        const tg = new THREE.SphereGeometry(on ? 0.024 : 0.016, 12, 10), tm = new THREE.MeshBasicMaterial({ color });
        const tip = new THREE.Mesh(tg, tm); tip.position.copy(base.clone().normalize().multiplyScalar(R * 1.004 + h)); tip.userData.id = p.id;
        markers.add(tip); hit.push(tip);
        // ground ring (pulses)
        const rg = new THREE.RingGeometry(0.02, 0.026, 32), rm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
        const ring = new THREE.Mesh(rg, rm); ring.position.copy(base); ring.lookAt(base.clone().multiplyScalar(2));
        markers.add(ring); pulses.push({ mesh: ring, mat: rm, t: Math.random() });
        // arc to home when a story there was rated highly relevant
        if (p.relevant && p.id !== "bengaluru") {
          const mid = base.clone().add(home).multiplyScalar(0.5); const d = base.distanceTo(home);
          mid.normalize().multiplyScalar(R + d * 0.35);
          const curve = new THREE.QuadraticBezierCurve3(base, mid, home);
          const ag = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
          const am = new THREE.LineBasicMaterial({ color: 0x5fe1ff, transparent: true, opacity: on ? 0.9 : 0.35 });
          markers.add(new THREE.Line(ag, am));
        }
      }
    };
    buildMarkers();

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    // interaction: drag to rotate, click a marker
    let drag: { x: number; y: number; moved: boolean } | null = null, vel = 0, idleUntil = 0;
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      return ray.intersectObjects(hit, false)[0]?.object.userData.id as string | undefined;
    };
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, moved: false }; renderer.domElement.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        world.rotation.y += dx * 0.006; world.rotation.x = Math.max(-1, Math.min(1, world.rotation.x + dy * 0.004));
        vel = dx * 0.006; drag.x = e.clientX; drag.y = e.clientY; idleUntil = performance.now() + 4000;
        return;
      }
      const id = pick(e);
      const p = id ? placesRef.current.find((x) => x.id === id) : null;
      const r = renderer.domElement.getBoundingClientRect();
      setHover(p ? { p, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      renderer.domElement.style.cursor = p ? "pointer" : "grab";
    };
    const up = (e: PointerEvent) => { if (drag && !drag.moved) onSelRef.current(pick(e) ?? null); drag = null; };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointerleave", () => setHover(null));

    let raf = 0, last = performance.now(), lastKey = "";
    const loop = (now: number) => {
      const dt = Math.min(50, now - last); last = now;
      if (!drag) {
        if (Math.abs(vel) > 0.0001) { world.rotation.y += vel; vel *= 0.94; }
        else if (!reduce && now > idleUntil) world.rotation.y += dt * 0.00004;
      }
      for (const p of pulses) { p.t = (p.t + dt * 0.0006) % 1; const s = 1 + p.t * 2.2; p.mesh.scale.set(s, s, s); p.mat.opacity = 0.6 * (1 - p.t); }
      const k = placesRef.current.map((p) => `${p.id}:${p.count}`).join("|") + "#" + selRef.current;
      if (k !== lastKey) { lastKey = k; buildMarkers(); }
      renderer.render(scene, camera);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    const onVis = () => { if (!document.hidden) { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop); } };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis);
      for (const c of [...markers.children]) { (c as THREE.Mesh).geometry?.dispose(); ((c as THREE.Mesh).material as THREE.Material)?.dispose?.(); }
      for (const d of disposables) d.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [webgl]);
  // markers rebuild inside the loop when places/selection change
  void key;

  if (webgl === false) return <FlatMap places={places} selected={selected} onSelect={onSelect} />;
  return (
    <div className="cc-globe" ref={host} role="img" aria-label={`Globe with ${places.length} places named in today's stories`}>
      {hover && <div className="cc-globe-tip" style={{ left: hover.x + 12, top: hover.y - 8 }}><b>{hover.p.name}</b> · {hover.p.count} stor{hover.p.count === 1 ? "y" : "ies"}<br /><span>{hover.p.level === "city" ? "City named in the story" : "Country/region named in the story"}</span></div>}
    </div>
  );
}

/** No WebGL: the same land dots and markers on a flat map. */
function FlatMap({ places, selected, onSelect }: { places: GlobePlace[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const dots = useMemo(() => landDots(), []);
  const x = (lng: number) => ((lng + 180) / 360) * 720, y = (lat: number) => ((90 - lat) / 180) * 360;
  const pts: React.ReactNode[] = [];
  for (let i = 0; i < dots.length; i += 2) pts.push(<circle key={i} cx={x(dots[i])} cy={y(dots[i + 1])} r={0.9} fill="#5fb8e6" opacity={0.5} />);
  return (
    <svg viewBox="0 30 720 260" className="cc-globe flat" role="img" aria-label="Map of places named in today's stories">
      {pts}
      {places.map((p) => <g key={p.id} onClick={() => onSelect(selected === p.id ? null : p.id)} style={{ cursor: "pointer" }}><circle cx={x(p.lng)} cy={y(p.lat)} r={3 + Math.min(6, p.count)} fill={selected === p.id ? "#fff" : p.level === "city" ? "#5fe1ff" : "#9b7bff"} opacity={0.85}><title>{`${p.name}: ${p.count} stories`}</title></circle></g>)}
    </svg>
  );
}
