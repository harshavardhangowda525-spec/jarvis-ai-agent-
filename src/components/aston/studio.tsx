"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useJobs } from "@/components/jobs/use-jobs";
import { AstonViewer } from "./viewer";

type SiteRow = { id: string; name: string; kind: string; niche: string | null; version: number; approvedVersion: number | null; url: string | null; updatedAt: string; lastBuild: { n: number; status: string; at: string } | null };

/** ASTON's demos: the list, builds in progress (real task steps), and the viewer. */
export function AstonStudio() {
  const params = useSearchParams();
  const router = useRouter();
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState(false);
  const sel = params.get("site");
  const autoWalk = params.get("walk") === "1";
  const jobs = useJobs({ status: "all" });
  const astonJobs = useMemo(() => jobs.jobs.filter((j) => j.agent === "aston"), [jobs.jobs]);
  const building = astonJobs.filter((j) => ["assigned", "running"].includes(j.status));

  const load = useCallback(async () => {
    const r = await fetch("/api/aston/sites", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j?.ok) { setErr(r?.status === 423 ? "JARVIS is locked — unlock it first." : j?.error ?? "Couldn't load ASTON's demos."); return; }
    setSites(j.data.sites); setErr(null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // a build that just finished → refresh and open it
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const j of astonJobs) {
      const prev = seen.current.get(j.id);
      seen.current.set(j.id, j.status);
      if (prev && prev !== j.status && ["completed", "failed"].includes(j.status)) {
        void load();
        const art = j.resultData?.artifacts?.[0];
        if (j.status === "completed" && art) router.replace(`/dashboard/aston?site=${art.siteId}`);
      }
    }
  }, [astonJobs, load, router]);

  const open = (id: string) => { setList(false); router.replace(`/dashboard/aston?site=${id}`); };
  const current = sel ?? sites?.[0]?.id ?? null;

  return (
    <div className="as">
      <style dangerouslySetInnerHTML={{ __html: AS_CSS }} />
      <aside className={`as-side${list ? " open" : ""}`} aria-label="Demos">
        <header><strong>ASTON</strong><small>Website &amp; app demos</small></header>
        <button type="button" className="as-new" onClick={() => setCreating(true)}>+ New demo</button>
        <Link href="/dashboard/teleprompter" className="as-tp">Teleprompter · today&apos;s plan →</Link>
        {building.length > 0 && <div className="as-group">Building</div>}
        {building.map((j) => (
          <div key={j.id} className="as-job">
            <strong>{j.title}</strong>
            <small>{j.status === "assigned" ? "Waiting to start" : j.progress.at(-1)?.text ?? "Working…"}</small>
            <Link href={`/dashboard/jobs?task=${j.id}`}>Task details</Link>
          </div>
        ))}
        {astonJobs.filter((j) => j.status === "failed").slice(0, 3).map((j) => (
          <div key={j.id} className="as-job bad"><strong>{j.title}</strong><small>Failed: {j.error}</small><Link href={`/dashboard/jobs?task=${j.id}`}>Details / retry</Link></div>
        ))}
        <div className="as-group">Demos</div>
        {err && <p className="as-mute">{err}</p>}
        {sites && !sites.length && <p className="as-mute">No demos yet. Ask ASTON (or JARVIS) for one, or press “New demo”.</p>}
        <ul>{sites?.map((s) => (
          <li key={s.id}><button type="button" className={s.id === current ? "on" : ""} onClick={() => open(s.id)}>
            <strong>{s.name}</strong>
            <small>{s.kind === "app" ? "App" : "Website"} · v{s.version}{s.approvedVersion ? ` · v${s.approvedVersion} approved` : ""}{s.lastBuild?.status === "failed" ? " · last build failed" : ""}</small>
          </button></li>
        ))}</ul>
      </aside>
      <main className="as-main">
        <button type="button" className="as-listbtn" onClick={() => setList(!list)}>☰ Demos{building.length ? ` · ${building.length} building` : ""}</button>
        {current ? <AstonViewer key={current} siteId={current} autoWalk={autoWalk && current === sel} onChangesRequested={() => void jobs.refresh()} />
          : <div className="as-empty"><p>{sites ? "Nothing to show yet." : "Loading…"}</p></div>}
      </main>
      {creating && <NewDemo onClose={() => setCreating(false)} onStarted={() => { setCreating(false); void jobs.refresh(); }} />}
    </div>
  );
}

function NewDemo({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [request, setRequest] = useState("");
  const [business, setBusiness] = useState("");
  const [kind, setKind] = useState<"website" | "app">("website");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/aston/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request, kind, business: business || undefined }) });
    const j = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok || !j?.ok) { setErr(j?.error ?? `HTTP ${r.status}`); return; }
    onStarted();
  };
  return (
    <div className="as-modal" role="dialog" aria-modal="true" aria-labelledby="as-new-h">
      <form onSubmit={submit}>
        <h2 id="as-new-h">New demo</h2>
        <label htmlFor="as-b">Business name</label>
        <input id="as-b" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="e.g. Brew & Bloom Café (matches a CRM lead by name)" />
        <label htmlFor="as-r">What should ASTON build?</label>
        <textarea id="as-r" rows={5} required minLength={5} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Premium website for a specialty café in Indiranagar. Menu, gallery, table reservations. Open daily 8 am – 10 pm. Phone 98450 12345." />
        <p className="as-mute">Only details you give (or the CRM has) appear as facts; anything missing is marked as a placeholder.</p>
        <div className="as-seg" role="radiogroup" aria-label="Type">
          <label><input type="radio" name="k" checked={kind === "website"} onChange={() => setKind("website")} /> Website</label>
          <label><input type="radio" name="k" checked={kind === "app"} onChange={() => setKind("app")} /> App demo</label>
        </div>
        {err && <p className="as-err">{err}</p>}
        <div className="as-row"><button type="submit" className="pri" disabled={busy || request.trim().length < 5}>{busy ? "Starting…" : "Build it"}</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </div>
  );
}

const AS_CSS = `
.as{display:flex;height:calc(100dvh - 4rem);min-height:480px;background:#0b1020;color:#e2e8f0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;position:relative;overflow:hidden}
.as button,.as input,.as textarea{font:inherit}
.as-side{width:290px;flex:none;border-right:1px solid rgba(255,255,255,.08);padding:12px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;background:#0a0f1d}
.as-side header{display:flex;flex-direction:column}.as-side header strong{font-size:18px;letter-spacing:.08em;color:#f59e0b}.as-side header small,.as-mute{color:#94a3b8;font-size:13px;margin:0}
.as-new{min-height:42px;border-radius:12px;border:0;background:#f59e0b;color:#111;font-weight:800;cursor:pointer}
.as-tp{color:#fbbf24;font-size:13px;text-decoration:none;padding:4px 2px}
.as-group{margin-top:8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
.as-side ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.as-side li button{width:100%;text-align:left;display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#111a2e;color:#e2e8f0;cursor:pointer}
.as-side li button.on{border-color:#f59e0b;background:#1a2238}.as-side li small{color:#94a3b8}
.as-job{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;border:1px dashed rgba(56,189,248,.5);background:#0f1a2e}.as-job small{color:#94a3b8}.as-job a{color:#38bdf8;font-size:13px}.as-job.bad{border-color:rgba(248,113,113,.5)}
.as-main{flex:1;min-width:0;display:flex;flex-direction:column}
.as-listbtn{display:none}
.as-empty{flex:1;display:grid;place-items:center;color:#94a3b8}
.as-modal{position:fixed;inset:0;z-index:60;background:rgba(2,6,23,.7);display:grid;place-items:center;padding:16px}
.as-modal form{width:min(520px,100%);background:#0f172a;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:8px}
.as-modal h2{margin:0 0 4px;font-size:18px}.as-modal input,.as-modal textarea{color:#e2e8f0;background:#0b1222;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:10px}
.as-modal button{min-height:42px;padding:0 16px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#131c30;color:#e2e8f0;cursor:pointer}.as-modal button.pri{background:#f59e0b;color:#111;border-color:#f59e0b;font-weight:800}
.as-seg{display:flex;gap:16px}.as-row{display:flex;gap:8px;margin-top:6px}.as-err{color:#fca5a5;margin:0}
@media (max-width:800px){
  .as-side{position:absolute;inset:0 30% 0 0;z-index:20;transform:translateX(-105%);transition:transform .25s;box-shadow:20px 0 40px -20px rgba(0,0,0,.8);width:auto}
  .as-side.open{transform:none}
  .as-listbtn{display:block;margin:8px 10px 0;align-self:flex-start;min-height:38px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#131c30;color:#e2e8f0}
}
`;
