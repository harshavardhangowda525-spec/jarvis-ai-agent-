import "server-only";

/**
 * Friday's work, live (in the JARVIS server process): every step of a task as
 * it happens — the specs found, the plan as the brain writes it, each part
 * Blender builds, materials, lighting, cameras, the model the moment it's
 * exported, and each render as it finishes. A screen that opens mid-way gets
 * everything so far first.
 */
export type FridayStage = "specs" | "plan" | "materials" | "geometry" | "modifiers" | "validate" | "lighting" | "cameras" | "save" | "export" | "render" | "verify" | "done" | "failed";

export type FridayLiveEvent =
  | { type: "stage"; stage: FridayStage; note: string }
  | { type: "log"; text: string; kind?: "info" | "ok" | "error"; at: string }
  | { type: "plan"; text: string }
  | { type: "plan_reset" }
  | { type: "material"; id: string; name: string; color: string }
  | { type: "part"; id: string; name: string; shape: string; group: string; status: "building" | "built"; material?: string; faces?: number; cutter?: boolean; conceptual?: boolean; internal?: boolean; done?: number | null; total?: number | null }
  | { type: "model"; url: string }
  | { type: "render"; view: string; label: string; url: string; seconds: number | null; done: number | null; total: number | null; reused?: boolean }
  | { type: "result"; projectId: string; version: number; ok: boolean; text: string };

export interface FridaySnapshot {
  stage: { stage: FridayStage; note: string } | null;
  log: { text: string; kind?: string; at: string }[];
  plan: string;
  materials: { id: string; name: string; color: string }[];
  parts: Extract<FridayLiveEvent, { type: "part" }>[];
  model: string | null;
  renders: Extract<FridayLiveEvent, { type: "render" }>[];
  result: Extract<FridayLiveEvent, { type: "result" }> | null;
  stages: FridayStage[];
}

interface Channel { subs: Set<(e: FridayLiveEvent) => void>; snap: FridaySnapshot; at: number }
const g = globalThis as unknown as { __fridayLive?: Map<string, Channel> };
const channels = (g.__fridayLive ??= new Map());
const empty = (): FridaySnapshot => ({ stage: null, log: [], plan: "", materials: [], parts: [], model: null, renders: [], result: null, stages: [] });

const ch = (jobId: string): Channel => {
  let c = channels.get(jobId);
  if (!c) {
    c = { subs: new Set(), snap: empty(), at: Date.now() };
    channels.set(jobId, c);
    // forget finished tasks after a while (the files and the job record keep everything)
    for (const [k, v] of channels) if (k !== jobId && !v.subs.size && Date.now() - v.at > 6 * 3600_000) channels.delete(k);
  }
  c.at = Date.now();
  return c;
};

export function emitFriday(jobId: string, e: FridayLiveEvent) {
  const { snap, subs } = ch(jobId);
  switch (e.type) {
    case "stage": snap.stage = { stage: e.stage, note: e.note }; if (!snap.stages.includes(e.stage)) snap.stages.push(e.stage); break;
    case "log": snap.log.push({ text: e.text, kind: e.kind, at: e.at }); if (snap.log.length > 400) snap.log.shift(); break;
    case "plan": snap.plan += e.text; break;
    case "plan_reset": snap.plan = ""; break;
    case "material": if (!snap.materials.some((m) => m.id === e.id)) snap.materials.push({ id: e.id, name: e.name, color: e.color }); break;
    case "part": { const i = snap.parts.findIndex((p) => p.id === e.id); if (i >= 0) snap.parts[i] = { ...snap.parts[i], ...e }; else snap.parts.push(e); break; }
    case "model": snap.model = e.url; break;
    case "render": { const i = snap.renders.findIndex((r) => r.view === e.view); if (i >= 0) snap.renders[i] = e; else snap.renders.push(e); break; }
    case "result": snap.result = e; break;
  }
  for (const s of subs) { try { s(e); } catch { /* a closed stream */ } }
}

export function subscribeFriday(jobId: string, fn: (e: FridayLiveEvent) => void) {
  const c = ch(jobId);
  c.subs.add(fn);
  return { snapshot: JSON.parse(JSON.stringify(c.snap)) as FridaySnapshot, close: () => c.subs.delete(fn) };
}
