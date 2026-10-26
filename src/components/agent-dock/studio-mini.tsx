"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ASTON's studio inside its pop-up: the file being written (streamed from the
 * build itself) next to the live website. Same live stream and preview as the
 * full studio page.
 */
type Snapshot = { state: { state: string; note?: string } | null; version: number; files: { path: string; content: string; done: boolean }[] };
type Detail = { name: string; preview: string; currentVersion: number; stateLabel: string; state: string; tests: { passed?: number; failed?: number } | null };

export function StudioMini({ projectId, wide }: { projectId: string; wide: boolean }) {
  const [d, setD] = useState<Detail | null>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const codeRef = useRef<HTMLPreElement>(null);
  const buf = useRef<{ path: string; content: string } | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => fetch(`/api/aston/projects/${projectId}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && j?.ok) setD(j.data.project); }).catch(() => {});
    void load();
    const es = new EventSource(`/api/aston/projects/${projectId}/live`);
    es.addEventListener("snapshot", (m) => {
      const s = JSON.parse((m as MessageEvent).data) as Snapshot;
      const last = s.files.at(-1);
      if (last) buf.current = { path: last.path, content: last.content };
      if (s.state) setState(s.state.note ? `${s.state.state} — ${s.state.note}` : s.state.state);
    });
    es.addEventListener("e", (m) => {
      const e = JSON.parse((m as MessageEvent).data);
      if (e.type === "open") buf.current = { path: e.path, content: "" };
      else if (e.type === "delta" && buf.current && buf.current.path === e.path) { const b: { path: string; content: string } = buf.current; buf.current = { path: e.path, content: b.content + e.text }; }
      else if (e.type === "close" && /\.(html|css|js|svg)$/.test(e.path)) setReload((k) => k + 1);
      else if (e.type === "state") { setState(e.note ? `${e.state} — ${e.note}` : e.state); if (["review", "failed", "deployed"].includes(e.state)) void load(); }
      else if (e.type === "version" || e.type === "tests") void load();
    });
    const iv = setInterval(() => { if (buf.current) setFile({ ...buf.current }); }, 150);
    return () => { stop = true; es.close(); clearInterval(iv); };
  }, [projectId]);

  useEffect(() => { const el = codeRef.current; if (el) el.scrollTop = el.scrollHeight; }, [file]);

  const tail = file ? file.content.split("\n").slice(-400).join("\n") : "";
  return (
    <div className={`ad-studio${wide ? " wide" : ""}`}>
      <div className="ad-studio-code">
        <div className="ad-studio-h"><span>{file?.path ?? "code"}</span><em>{state ?? d?.stateLabel ?? ""}</em></div>
        <pre ref={codeRef}>{tail || (d?.currentVersion ? "The latest version is built — open the full studio to browse every file." : "Waiting for ASTON to start writing…")}</pre>
      </div>
      <div className="ad-studio-prev">
        <div className="ad-studio-h"><span>Live preview</span>{d?.tests && <em>{d.tests.passed ?? 0} passed{d.tests.failed ? ` · ${d.tests.failed} failing` : ""}</em>}</div>
        {d?.preview && (d.currentVersion || reload > 0)
          ? <iframe key={reload} src={d.preview} title={`${d.name} preview`} sandbox="allow-scripts allow-forms allow-popups allow-modals" />
          : <div className="ad-studio-wait">The preview appears once the first page is written.</div>}
      </div>
      <a className="ad-studio-full" href={`/dashboard/aston/studio?project=${projectId}`} target="_blank" rel="noreferrer">Open full studio ↗</a>
    </div>
  );
}
