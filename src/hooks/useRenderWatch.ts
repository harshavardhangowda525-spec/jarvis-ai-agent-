"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps checking Magic Hour renders EV started (videos take minutes) and
 * reports each one once: ready (with EV's stored link) or failed (with Magic
 * Hour's own reason). The list survives a page reload, so a render finished
 * while the tab was closed still shows up when JARVIS opens again.
 */
export interface PendingRender { kind: "image" | "video"; projectId: string; label: string; since: number }

const KEY = "jarvis.ev.pending";
const POLL_MS = 10_000;
const GIVE_UP_MS = 30 * 60_000;

export function readPending(): PendingRender[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.projectId === "string" && (p.kind === "image" || p.kind === "video")) : [];
  } catch { return []; }
}
function writePending(list: PendingRender[]) {
  try { if (list.length) localStorage.setItem(KEY, JSON.stringify(list)); else localStorage.removeItem(KEY); } catch { /* storage off */ }
}

export function useRenderWatch(opts: {
  onReady: (r: PendingRender & { url: string }) => void;
  onFailed: (r: PendingRender & { error: string }) => void;
}) {
  const cb = useRef(opts); cb.current = opts;
  const busy = useRef(false);

  const tick = useCallback(async () => {
    if (busy.current) return;
    const list = readPending();
    if (!list.length) return;
    busy.current = true;
    try {
      for (const p of list) {
        let done = false;
        if (Date.now() - p.since > GIVE_UP_MS) {
          cb.current.onFailed({ ...p, error: "Magic Hour still hasn't finished after 30 minutes — check your Magic Hour dashboard, or ask EV to check again." });
          done = true;
        } else {
          const qs = new URLSearchParams({ kind: p.kind, projectId: p.projectId, label: p.label });
          const res = await fetch(`/api/ev/render?${qs}`, { cache: "no-store" }).catch(() => null);
          const json = res ? await res.json().catch(() => null) : null;
          const d = json?.data;
          if (d?.status === "ready" && typeof d.url === "string") { cb.current.onReady({ ...p, url: d.url }); done = true; }
          else if (d?.status === "failed") { cb.current.onFailed({ ...p, error: String(d.error ?? "Magic Hour couldn't finish it.") }); done = true; }
          else if (res && (res.status === 401 || res.status === 409)) {
            cb.current.onFailed({ ...p, error: String(json?.error ?? "Can't check the render right now.") }); done = true;
          }
        }
        if (done) writePending(readPending().filter((x) => x.projectId !== p.projectId));
      }
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    void tick();
    const t = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(t);
  }, [tick]);

  /** Start watching a render (duplicates are ignored). */
  const watch = useCallback((p: { kind: "image" | "video"; projectId: string; label: string }) => {
    const list = readPending();
    if (list.some((x) => x.projectId === p.projectId)) return;
    writePending([...list, { ...p, since: Date.now() }].slice(-6));
    setTimeout(() => { void tick(); }, POLL_MS);
  }, [tick]);

  return { watch };
}
