"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobView } from "@/lib/jobs/engine";

/**
 * Live view of JARVIS's delegated tasks. While anything is active it checks
 * every few seconds; it also starts tasks that are ready to run (a task runs
 * inside its own request on the server, so closing the page doesn't stop a
 * task that has started — and one interrupted by a restart is picked up again).
 */
export function useJobs(o: { status?: "active" | "finished" | "all"; enabled?: boolean } = {}) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [announce, setAnnounce] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const started = useRef(new Set<string>());
  const enabled = o.enabled ?? true;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/jobs?status=${o.status ?? "all"}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { setError(j?.error ?? `HTTP ${r.status}`); return; }
      setJobs(j.data.jobs); setAnnounce(j.data.announce); setError(null); setLoaded(true);
      // start what's ready (each runner claims its task, so a second tab can't double-run it)
      for (const id of j.data.runnable as string[]) {
        if (started.current.has(id)) continue;
        started.current.add(id);
        void fetch(`/api/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) })
          .catch(() => {}).finally(() => { started.current.delete(id); void refresh(); });
      }
    } catch { setError("Couldn't reach JARVIS."); }
  }, [o.status]);

  const active = jobs.some((j) => ["planning", "assigned", "running"].includes(j.status));
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const iv = setInterval(() => void refresh(), active ? 4000 : 30_000);
    return () => clearInterval(iv);
  }, [enabled, refresh, active]);

  const act = useCallback(async (id: string, action: "cancel" | "retry" | "approve" | "announced" | "run", note?: string) => {
    const r = await fetch(`/api/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
    const j = await r.json().catch(() => null);
    void refresh();
    return r.ok && j?.ok ? { ok: true as const } : { ok: false as const, error: j?.error ?? `HTTP ${r.status}` };
  }, [refresh]);

  return { jobs, announce, error, loaded, refresh, act };
}

/** One spoken line for a finished task — only what the task record says. */
export function announcement(j: JobView): string {
  const first = (s: string | null) => (s ?? "").replace(/[*_`]+/g, "").replace(/[#>|]+/g, " ").replace(/\s+/g, " ").trim().match(/^.{1,180}?[.!?](\s|$)/)?.[0]?.trim() ?? (s ?? "").slice(0, 160);
  const model = j.resultData?.artifacts?.find((a) => a.kind === "friday");
  if (j.status === "completed" && model) return `FRIDAY has finished ${model.title} — version ${model.version}. The model, renders and viewer are ready. Shall I open it in Friday's workspace, or would you like to change anything first?`;
  const site = j.resultData?.artifacts?.find((a) => a.kind === "aston");
  if (j.status === "completed" && site) return `ASTON has finished ${site.title}${j.payload?.siteId ? ` — version ${site.version}` : ""}. The preview is ready. Would you like me to open it in a new tab so I can walk you through the design, or would you like to change anything first?`;
  if (j.status === "completed") return `${j.agentName} finished "${j.title}". ${first(j.result)}`.trim();
  if (j.status === "waiting_approval") return `${j.agentName} needs your approval on "${j.title}". ${j.progress.at(-1)?.text.replace(/^Waiting for your approval:\s*/, "") ?? ""}`.trim();
  if (j.status === "cancelled") return `"${j.title}" was cancelled.`;
  return `${j.agentName} couldn't finish "${j.title}". ${j.error ?? ""}`.trim();
}
