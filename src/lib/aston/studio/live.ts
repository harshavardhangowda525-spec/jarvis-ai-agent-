import "server-only";

/**
 * Live view of a build (in the JARVIS server process): the state, each file as
 * it's being written, and the log. The studio screen subscribes over SSE and
 * gets everything so far, then every new piece as it happens.
 */
export type LiveEvent =
  | { type: "state"; state: string; note?: string }
  | { type: "open"; path: string; version: number }
  | { type: "delta"; path: string; text: string }
  | { type: "close"; path: string }
  | { type: "log"; text: string; kind?: "info" | "ok" | "error" }
  | { type: "version"; n: number; status: string }
  | { type: "tests"; summary: { passed: number; failed: number; warnings: number } };

interface Channel { subs: Set<(e: LiveEvent) => void>; files: Map<string, { content: string; done: boolean }>; state: { state: string; note?: string } | null; log: { text: string; kind?: string; at: string }[]; version: number }
const g = globalThis as unknown as { __astonLive?: Map<string, Channel> };
const channels = (g.__astonLive ??= new Map());

const ch = (id: string): Channel => {
  let c = channels.get(id);
  if (!c) { c = { subs: new Set(), files: new Map(), state: null, log: [], version: 0 }; channels.set(id, c); }
  return c;
};

export function emit(projectId: string, e: LiveEvent) {
  const c = ch(projectId);
  if (e.type === "open") { if (e.version !== c.version) { c.files.clear(); c.version = e.version; } c.files.set(e.path, { content: "", done: false }); }
  else if (e.type === "delta") { const f = c.files.get(e.path); if (f) f.content += e.text; }
  else if (e.type === "close") { const f = c.files.get(e.path); if (f) f.done = true; }
  else if (e.type === "state") c.state = { state: e.state, note: e.note };
  else if (e.type === "log") { c.log.push({ text: e.text, kind: e.kind, at: new Date().toISOString() }); if (c.log.length > 300) c.log.shift(); }
  for (const s of c.subs) { try { s(e); } catch { /* a closed stream */ } }
}

/** Everything so far (for a screen that opens mid-build), then live events. */
export function subscribe(projectId: string, fn: (e: LiveEvent) => void) {
  const c = ch(projectId);
  c.subs.add(fn);
  return { snapshot: { state: c.state, version: c.version, files: [...c.files].map(([path, f]) => ({ path, content: f.content, done: f.done })), log: c.log.slice(-120) }, close: () => c.subs.delete(fn) };
}
