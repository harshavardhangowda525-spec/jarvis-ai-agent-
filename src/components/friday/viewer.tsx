"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Quaternion } from "three";
import type { PartInfo, Preset, Shading, ViewerCore } from "@/lib/friday/viewer-core";

/**
 * The 3D viewport: the GLB Blender exported, with a view cube and the viewer
 * toolbar. Mouse/touch always work (orbit = drag, zoom = wheel/pinch,
 * pan = right-drag / two-finger drag); hands drive the same camera.
 */
export interface ViewerHandle { core: ViewerCore | null; fullscreen: () => void }

const FACES: { p: Preset; label: string; t: string }[] = [
  { p: "front", label: "FRONT", t: "translateZ(28px)" },
  { p: "rear", label: "BACK", t: "rotateY(180deg) translateZ(28px)" },
  { p: "right", label: "RIGHT", t: "rotateY(90deg) translateZ(28px)" },
  { p: "left", label: "LEFT", t: "rotateY(-90deg) translateZ(28px)" },
  { p: "top", label: "TOP", t: "rotateX(90deg) translateZ(28px)" },
  { p: "bottom", label: "BOTTOM", t: "rotateX(-90deg) translateZ(28px)" },
];

export const FridayViewer = forwardRef<ViewerHandle, {
  url: string | null;
  onParts?: (p: PartInfo[]) => void;
  onSelect?: (id: string | null) => void;
  onLog?: (s: string) => void;
}>(function FridayViewer({ url, onParts, onSelect, onLog }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const cube = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<ViewerCore | null>(null);
  const [state, setState] = useState({ ortho: false, shading: "material" as Shading, explode: 0, section: null as null | { axis: "x" | "y" | "z"; at: number }, fps: null as number | null });
  const [loading, setLoading] = useState<string | null>(null);
  const cb = useRef({ onParts, onSelect, onLog }); cb.current = { onParts, onSelect, onLog };

  useImperativeHandle(ref, () => ({ core, fullscreen: () => { const el = wrap.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); } }), [core]);

  useEffect(() => {
    let c: ViewerCore | null = null;
    let alive = true;
    void import("@/lib/friday/viewer-core").then(({ ViewerCore }) => {
      if (!alive || !host.current) return;
      try {
        c = new ViewerCore(host.current);
      } catch (e) {
        cb.current.onLog?.(`3D viewer couldn't start (WebGL): ${(e as Error).message}`);
        return;
      }
      const sync = () => {
        if (!c) return;
        setState({ ortho: c.isOrtho, shading: c.shading, explode: c.explodeAmount, section: c.section, fps: c.fps });
        const q: Quaternion = c.cameraQuaternion().invert();
        // CSS y is down → flip the rotation's x and z components for the cube
        if (cube.current) cube.current.style.transform = `translateZ(-28px) matrix3d(${cssMatrix(q)})`;
      };
      c.onChange = sync;
      c.onSelect = (id) => cb.current.onSelect?.(id);
      setCore(c);
      sync();
    });
    const iv = setInterval(() => setState((s) => ({ ...s, fps: c?.fps ?? null })), 1000);
    return () => { alive = false; clearInterval(iv); c?.dispose(); };
  }, []);

  useEffect(() => {
    if (!core || !url) return;
    let alive = true;
    setLoading("Loading the model…");
    core.load(url).then((parts) => {
      if (!alive) return;
      setLoading(null);
      cb.current.onParts?.(parts);
      cb.current.onLog?.(`Viewer: loaded ${parts.length} parts from model.glb`);
    }).catch((e) => { if (alive) { setLoading(`Couldn't load the model: ${(e as Error).message}`); cb.current.onLog?.(`Viewer error: ${(e as Error).message}`); } });
    return () => { alive = false; };
  }, [core, url]);

  const btn = (label: string, on: boolean, f: () => void, title?: string) => <button className={`fv-b${on ? " on" : ""}`} title={title ?? label} onClick={f}>{label}</button>;

  return (
    <div className="fv" ref={wrap}>
      <div className="fv-host" ref={host} />
      {!url && <div className="fv-empty">No model yet — describe an invention in the console, or open a project.</div>}
      {loading && <div className="fv-empty">{loading}</div>}
      <div className="fv-cubewrap" aria-label="View cube">
        <div className="fv-cube" ref={cube}>
          {FACES.map((f) => <button key={f.p} className="fv-face" style={{ transform: f.t }} onClick={() => core?.setPreset(f.p)}>{f.label}</button>)}
        </div>
      </div>
      <div className="fv-bar">
        {btn("Front", false, () => core?.setPreset("front"))}{btn("Back", false, () => core?.setPreset("rear"))}
        {btn("Left", false, () => core?.setPreset("left"))}{btn("Right", false, () => core?.setPreset("right"))}
        {btn("Top", false, () => core?.setPreset("top"))}{btn("Bottom", false, () => core?.setPreset("bottom"))}
        <span className="fv-sep" />
        {btn(state.ortho ? "Ortho" : "Persp", state.ortho, () => core?.setOrtho(!state.ortho), "Perspective / orthographic")}
        {btn("Material", state.shading === "material", () => core?.setShading("material"))}
        {btn("Solid", state.shading === "solid", () => core?.setShading("solid"))}
        {btn("Wire", state.shading === "wireframe", () => core?.setShading("wireframe"))}
        <span className="fv-sep" />
        <label className="fv-sl" title="Exploded view">Explode<input type="range" min={0} max={100} value={Math.round(state.explode * 100)} onChange={(e) => core?.setExplode(Number(e.target.value) / 100)} /></label>
        {btn("Section", !!state.section, () => core?.setSection(state.section ? null : { axis: "x", at: 0 }), "Section / cutaway")}
        {state.section && <>
          <select className="fv-sel" value={state.section.axis} onChange={(e) => core?.setSection({ axis: e.target.value as "x" | "y" | "z", at: state.section!.at })}><option value="x">X</option><option value="y">Z (height)</option><option value="z">Y (depth)</option></select>
          <input className="fv-range" type="range" min={-100} max={100} value={Math.round(state.section.at * 100)} onChange={(e) => core?.setSection({ axis: state.section!.axis, at: Number(e.target.value) / 100 })} />
        </>}
        <span className="fv-sep" />
        {btn("Reset", false, () => core?.reset())}
        {btn("⛶", false, () => { const el = wrap.current; if (document.fullscreenElement) void document.exitFullscreen(); else void el?.requestFullscreen?.(); }, "Full screen")}
      </div>
      <div className="fv-meter">{state.fps != null ? `${state.fps} fps (viewer, measured)` : ""}</div>
    </div>
  );
});

/** Rotation quaternion → CSS matrix3d (column-major), with y/z flipped for CSS's y-down space. */
function cssMatrix(q: Quaternion) {
  const { x, y, z, w } = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  // flip Y axis (CSS y down): S * M * S with S = diag(1,-1,1)
  const s = [1, -1, 1, 1];
  const out = m.map((v, i) => v * s[i % 4] * s[Math.floor(i / 4)]);
  return out.map((v) => v.toFixed(6)).join(",");
}
