"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CRM_STATUSES, type CrmStatus } from "@/lib/crm/status";
import { api } from "./net";

type Flash = (m: { ok: boolean; text: string }) => void;

function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="dc-dlg" role="dialog" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="dc-box">
        <header><h2>{title}</h2><button type="button" className="dc-btn sm x" onClick={onClose} aria-label="Close">✕</button></header>
        <div>{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

const Stat = ({ k, v }: { k: string; v: ReactNode }) => <div className="dc-stat"><span>{k}</span><b>{v}</b></div>;

// ---------------- Generate leads ----------------

interface GenReport { discovered: number; saved: number; addedToCrm: number; alreadyInCrm: number; duplicatesSkipped: number; filteredOut: number; providerErrors: string[]; runtimeMs: number; requests: number; stoppedReason: string; area: string; message: string }
type GenAnswer = { ok: true; report: GenReport; names: string[] } | { ok: false; error: string; state: string };

export function GenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [opts, setOpts] = useState<{ niches: string[] | null; configured: boolean } | null>(null);
  const [f, setF] = useState({ category: "", location: "", count: 20, filter: "all" });
  const [busy, setBusy] = useState(false);
  const [t0, setT0] = useState(0);
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState<GenAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api<{ niches: string[] | null; configured: boolean }>("/api/crm/generate").then((r) => { if (r.ok) { setOpts(r.data); setF((x) => ({ ...x, category: r.data.niches?.[0] ?? "" })); } else setErr(r.error); }); }, []);
  useEffect(() => { if (!busy) return; const iv = setInterval(() => setTick((n) => n + 1), 500); return () => clearInterval(iv); }, [busy]);
  const run = async () => {
    setBusy(true); setRes(null); setErr(null); setT0(Date.now());
    const r = await api<GenAnswer>("/api/crm/generate", { method: "POST", body: { category: f.category, location: f.location, count: f.count, filter: f.filter } });
    setBusy(false);
    if (r.ok) { setRes(r.data); if (r.data.ok && r.data.report.addedToCrm) onDone(); } else setErr(r.error);
  };
  return (
    <Dialog title="Generate leads" onClose={onClose} footer={<>
      <button type="button" className="dc-btn" onClick={onClose}>Close</button>
      <button type="button" className="dc-btn pri" disabled={busy || !f.category.trim() || f.location.trim().length < 2 || opts?.configured === false} onClick={() => void run()}>{busy ? <><i className="dc-spin" /> Searching…</> : res ? "Search again" : "Find leads"}</button>
    </>}>
      <p className="dc-note">DARWIN searches real business listings (Geoapify), skips businesses already in your CRM, and saves only new ones. Missing phones and websites are saved as unknown.</p>
      {opts?.configured === false && <p className="dc-flash bad">No discovery source is set up: GEOAPIFY_API_KEY isn&apos;t configured. Run <code>npm run darwin:check</code> on this PC for what to do.</p>}
      <div className="dc-form">
        <label>Niche
          {opts?.niches ? (
            <select className="dc-sel" style={{ maxWidth: "none" }} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{opts.niches.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          ) : <input className="dc-in" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="gyms, cafes, clinics…" />}
        </label>
        <label>Location<input className="dc-in" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Indiranagar, Bengaluru" /></label>
        <label>How many<select className="dc-sel" style={{ maxWidth: "none" }} value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })}>{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Only<select className="dc-sel" style={{ maxWidth: "none" }} value={f.filter} onChange={(e) => setF({ ...f, filter: e.target.value })}>
          <option value="all">All businesses</option><option value="no_website">No website listed</option><option value="phone">With a phone</option><option value="no_website_phone">No website + phone</option>
        </select></label>
      </div>
      {busy && <p className="dc-flash info"><i className="dc-spin" /> Searching listings near {f.location || "…"} — {Math.round((Date.now() - t0) / 1000)} s{tick < 0 ? "" : ""}</p>}
      {err && <p className="dc-flash bad">{err}</p>}
      {res && !res.ok && <p className="dc-flash bad">{res.error}</p>}
      {res?.ok && (
        <>
          <p className={`dc-flash ${res.report.addedToCrm ? "ok" : "info"}`}>{res.report.message}</p>
          <div className="dc-stats">
            <Stat k="Discovered" v={res.report.discovered} /><Stat k="Added to CRM" v={res.report.addedToCrm} />
            <Stat k="Duplicates skipped" v={res.report.duplicatesSkipped + res.report.alreadyInCrm} /><Stat k="Filtered out" v={res.report.filteredOut} />
            <Stat k="Provider errors" v={res.report.providerErrors.length} /><Stat k="Runtime" v={`${(res.report.runtimeMs / 1000).toFixed(1)} s`} />
          </div>
          {res.report.providerErrors.map((e) => <p key={e} className="dc-flash bad">{e}</p>)}
          {res.names.length > 0 && <p className="dc-note">New: {res.names.join(", ")}{res.report.addedToCrm > res.names.length ? " …" : ""}</p>}
        </>
      )}
    </Dialog>
  );
}

// ---------------- Add a lead ----------------

export function AddLeadDialog({ onClose, onDone, flash }: { onClose: () => void; onDone: (id: string) => void; flash: Flash }) {
  const [f, setF] = useState<Record<string, string>>({ businessName: "", category: "", phone: "", email: "", website: "", instagram: "", city: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
    const r = await api<{ id: string; duplicate: boolean; name: string }>("/api/crm", { method: "POST", body });
    setBusy(false);
    if (!r.ok) { flash({ ok: false, text: `Not saved: ${r.error}` }); return; }
    flash({ ok: true, text: r.data.duplicate ? `${r.data.name} was already in the CRM — opened it (missing details were added).` : `${r.data.name} added.` });
    onDone(r.data.id);
  };
  const L = (k: string, label: string, full = false) => <label className={full ? "full" : ""}>{label}<input className="dc-in" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Dialog title="Add a lead" onClose={onClose} footer={<><button type="button" className="dc-btn" onClick={onClose}>Cancel</button><button type="button" className="dc-btn pri" disabled={busy || !f.businessName.trim()} onClick={() => void save()}>Add lead</button></>}>
      <div className="dc-form">
        {L("businessName", "Business name *", true)}{L("category", "Niche / category")}{L("city", "City / area")}
        {L("phone", "Phone")}{L("email", "Email")}{L("website", "Website")}{L("instagram", "Instagram")}
        <label className="full">Notes<textarea className="dc-ta" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <p className="dc-note">Leave anything you don&apos;t know empty — it&apos;s shown as unknown. If the business is already in the CRM, the existing lead opens instead.</p>
    </Dialog>
  );
}

// ---------------- Import (Lovable / Supabase / Sheets / Excel → CSV) ----------------

interface Preview {
  rows: number; headers: string[]; mapping: Record<string, { column: number; header: string }>; fields: { id: string; label: string }[];
  statuses: { value: string; count: number; guess: CrmStatus | null; mappedTo: CrmStatus | null }[]; unresolvedStatuses: string[];
  sample: Record<string, string | null>[]; missingName: number[]; duplicates: { row: number; name: string; existingName: string }[]; alreadyImported: number; ready: number;
}
interface ImportResult { created: number; duplicates: { row: number; name: string; existing: string }[]; alreadyImported: number; missingName: number; errors: { row: number; name: string; error: string }[]; remaining: number; backupId: string }

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [label, setLabel] = useState("Lovable");
  const [mapping, setMapping] = useState<Record<string, number> | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, CrmStatus>>({});
  const [def, setDef] = useState<CrmStatus>("contacted");
  const [pv, setPv] = useState<Preview | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = async (text = csv, m = mapping) => {
    if (!text) return;
    setBusy(true); setErr(null);
    const r = await api<Preview>("/api/crm/import", { method: "POST", body: { action: "preview", csv: text, mapping: m ?? undefined, statusMap, defaultStatus: def, sourceLabel: label } });
    setBusy(false);
    if (r.ok) { setPv(r.data); if (!m) setMapping(Object.fromEntries(Object.entries(r.data.mapping).map(([k, v]) => [k, v.column]))); } else setErr(r.error);
  };
  const run = async (limit?: number) => {
    if (!csv || !pv) return;
    const unresolved = pv.unresolvedStatuses.filter((s) => !statusMap[s]);
    if (unresolved.length) { setErr(`Choose what these statuses mean first: ${unresolved.join(", ")}`); return; }
    setBusy(true); setErr(null);
    const r = await api<ImportResult>("/api/crm/import", { method: "POST", body: { action: "import", csv, mapping: mapping ?? undefined, statusMap, defaultStatus: def, sourceLabel: label, limit } });
    setBusy(false);
    if (r.ok) { setRes(r.data); onDone(); void preview(); } else setErr(r.error);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) { setErr("That file is over 5 MB — export fewer rows at a time."); return; }
    const text = await file.text();
    setCsv(text); setFileName(file.name); setMapping(null); setPv(null); setRes(null);
    void preview(text, null);
  };
  const statusOpts = CRM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>);

  return (
    <Dialog title="Import leads" onClose={onClose} footer={pv ? <>
      <button type="button" className="dc-btn" onClick={onClose}>Close</button>
      <button type="button" className="dc-btn" disabled={busy || !pv.ready} onClick={() => void run(5)}>Import 5 as a test</button>
      <button type="button" className="dc-btn pri" disabled={busy || !pv.ready} onClick={() => void run()}>{busy ? <><i className="dc-spin" /> Working…</> : `Import ${pv.ready} lead${pv.ready === 1 ? "" : "s"}`}</button>
    </> : undefined}>
      {!pv && (
        <>
          <p className="dc-note"><b>From your Lovable app:</b> Lovable keeps its data in Supabase. Open your project&apos;s Supabase dashboard → <b>Table Editor</b> → your leads table → <b>Export → CSV</b>, then choose that file here. (Google Sheets: File → Download → CSV. Excel: Save As → CSV.)</p>
          <p className="dc-note">Nothing is imported until you confirm. Leads you&apos;ve contacted stay contacted, nothing is sent to anyone, and existing leads are never overwritten. A backup is taken before every import.</p>
          <div className="dc-form">
            <label>CSV file<input className="dc-in" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
            <label>Where it&apos;s from<input className="dc-in" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Lovable" /></label>
          </div>
        </>
      )}
      {busy && !pv && <p className="dc-flash info"><i className="dc-spin" /> Reading {fileName}…</p>}
      {err && <p className="dc-flash bad">{err}</p>}
      {pv && (
        <>
          <div className="dc-stats">
            <div className="dc-stat"><span>Rows in {fileName}</span><b>{pv.rows}</b></div>
            <div className="dc-stat"><span>Ready to import</span><b>{pv.ready}</b></div>
            <div className="dc-stat"><span>Already in CRM</span><b>{pv.duplicates.length}</b></div>
            <div className="dc-stat"><span>Imported before</span><b>{pv.alreadyImported}</b></div>
            <div className="dc-stat"><span>No business name</span><b>{pv.missingName.length}</b></div>
          </div>
          <h3 className="dc-note" style={{ fontWeight: 600 }}>Columns</h3>
          <table className="dc-mini"><tbody>
            {pv.fields.map((fld) => (
              <tr key={fld.id}><th style={{ width: 160 }}>{fld.label}</th><td>
                <select className="dc-sel" style={{ maxWidth: "none", width: "100%" }} value={mapping?.[fld.id] ?? ""} onChange={(e) => { const m = { ...(mapping ?? {}) }; if (e.target.value === "") delete m[fld.id]; else m[fld.id] = Number(e.target.value); setMapping(m); void preview(csv, m); }}>
                  <option value="">— not in the file —</option>
                  {pv.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </td></tr>
            ))}
          </tbody></table>
          {pv.statuses.some((s) => s.value) && (
            <>
              <h3 className="dc-note" style={{ fontWeight: 600 }}>Statuses</h3>
              <table className="dc-mini"><thead><tr><th>In the file</th><th>Leads</th><th>Becomes</th></tr></thead><tbody>
                {pv.statuses.filter((s) => s.value).map((s) => (
                  <tr key={s.value}><td>{s.value}</td><td>{s.count}</td><td>
                    <select className="dc-sel" value={statusMap[s.value] ?? s.guess ?? ""} onChange={(e) => setStatusMap({ ...statusMap, [s.value]: e.target.value as CrmStatus })} style={!statusMap[s.value] && !s.guess ? { borderColor: "#F79009" } : undefined}>
                      {!s.guess && <option value="">Choose…</option>}{statusOpts}
                    </select>
                  </td></tr>
                ))}
              </tbody></table>
            </>
          )}
          <label className="dc-note">Rows without a status become
            <select className="dc-sel" style={{ marginLeft: 6 }} value={def} onChange={(e) => setDef(e.target.value as CrmStatus)}>{statusOpts}</select>
            {" "}(you&apos;ve contacted these leads, so the default is Contacted)
          </label>
          {pv.duplicates.length > 0 && <details><summary className="dc-note">{pv.duplicates.length} already in the CRM (skipped, not overwritten)</summary><ul className="dc-note">{pv.duplicates.slice(0, 50).map((d) => <li key={d.row}>Row {d.row}: {d.name} = {d.existingName}</li>)}</ul></details>}
          <details><summary className="dc-note">First rows as they&apos;ll be read</summary>
            <table className="dc-mini"><tbody>{pv.sample.map((r, i) => <tr key={i}><td>{r.businessName ?? <i>no name</i>}</td><td>{r.phone ?? "—"}</td><td>{r.status ?? "—"}</td><td>{r.followUp ?? ""}</td></tr>)}</tbody></table>
          </details>
          {res && (
            <p className={`dc-flash ${res.errors.length ? "bad" : "ok"}`}>
              Imported {res.created} lead{res.created === 1 ? "" : "s"}{res.duplicates.length ? ` · ${res.duplicates.length} already in the CRM (skipped)` : ""}{res.alreadyImported ? ` · ${res.alreadyImported} imported before` : ""}{res.errors.length ? ` · ${res.errors.length} failed: ${res.errors.slice(0, 3).map((e) => `row ${e.row} ${e.error}`).join("; ")}` : ""}. {res.remaining ? `${res.remaining} still to import.` : "Done."}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

// ---------------- Backups & clearing DARWIN's leads ----------------

interface Backup { id: string; createdAt: string; reason: string; counts: Record<string, number>; bytes: number }
interface ClearPreview { darwinLeads: number; darwinFollowUps: number; darwinMessages: number; untouchedCrmLeads: number; protectedCrmLeads: number; examples: string[] }

export function DataDialog({ onClose, onDone, flash }: { onClose: () => void; onDone: () => void; flash: Flash }) {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [cp, setCp] = useState<ClearPreview | null>(null);
  const [withCrm, setWithCrm] = useState(false);
  const [ask, setAsk] = useState<null | "clear" | { restore: Backup }>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [b, c] = await Promise.all([api<{ backups: Backup[] }>("/api/crm/backups"), api<ClearPreview>("/api/crm/clear")]);
    if (b.ok) setBackups(b.data.backups);
    if (c.ok) setCp(c.data);
  };
  useEffect(() => { void load(); }, []);
  const backupNow = async () => {
    setBusy(true);
    const r = await api<{ backup: Backup }>("/api/crm/backups", { method: "POST" });
    setBusy(false);
    flash(r.ok ? { ok: true, text: `Backup saved (${r.data.backup.counts.robinLead ?? 0} CRM leads, ${r.data.backup.counts.darwinLead ?? 0} DARWIN records).` } : { ok: false, text: `Backup failed: ${r.error}` });
    void load();
  };
  const download = async (b: Backup) => {
    const r = await fetch(`/api/crm/backups/${b.id}`, { cache: "no-store" });
    if (!r.ok) { flash({ ok: false, text: "Couldn't download that backup." }); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = `jarvis-crm-backup-${b.createdAt.slice(0, 16).replace(/[:T]/g, "-")}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const restore = async (b: Backup) => {
    setAsk(null); setBusy(true);
    const r = await api<{ restored: Record<string, number>; safetyBackupId: string }>(`/api/crm/backups/${b.id}`, { method: "POST", body: { confirm: true } });
    setBusy(false);
    flash(r.ok ? { ok: true, text: `Restored: ${r.data.restored.robinLead ?? 0} CRM leads and ${r.data.restored.darwinLead ?? 0} DARWIN records that were missing. Nothing existing was changed.` } : { ok: false, text: `Restore failed: ${r.error}` });
    onDone(); void load();
  };
  const clear = async () => {
    if (!cp) return;
    setAsk(null); setBusy(true);
    const r = await api<{ cleared: boolean; reason?: string; removed?: { darwinLeads: number; crmLeads: number } }>("/api/crm/clear", { method: "POST", body: { confirm: true, includeUntouchedCrm: withCrm, expect: { darwinLeads: cp.darwinLeads, untouchedCrmLeads: cp.untouchedCrmLeads } } });
    setBusy(false);
    if (r.ok && r.data.cleared) flash({ ok: true, text: `Cleared ${r.data.removed!.darwinLeads} DARWIN records${r.data.removed!.crmLeads ? ` and ${r.data.removed!.crmLeads} untouched CRM leads` : ""}. A backup was saved first — restore it here any time.` });
    else flash({ ok: false, text: r.ok ? r.data.reason ?? "Nothing was cleared." : `Nothing was cleared: ${r.error}` });
    onDone(); void load();
  };
  return (
    <Dialog title="Backups & clearing" onClose={onClose}>
      <section>
        <div className="dc-row" style={{ justifyContent: "space-between" }}><b>Backups</b><button type="button" className="dc-btn sm" disabled={busy} onClick={() => void backupNow()}>Back up now</button></div>
        <p className="dc-note">Every lead, its history, follow-ups, demos and quotes, plus DARWIN&apos;s records. One is taken automatically before every import and clear; the 20 newest are kept.</p>
        <table className="dc-mini"><thead><tr><th>When</th><th>Why</th><th>CRM leads</th><th>DARWIN</th><th /></tr></thead><tbody>
          {(backups ?? []).map((b) => (
            <tr key={b.id}><td>{new Date(b.createdAt).toLocaleString()}</td><td>{b.reason.replace(/_/g, " ")}</td><td>{b.counts.robinLead ?? 0}</td><td>{b.counts.darwinLead ?? 0}</td>
              <td className="dc-row"><button type="button" className="dc-btn sm" onClick={() => void download(b)}>Download</button><button type="button" className="dc-btn sm" disabled={busy} onClick={() => setAsk({ restore: b })}>Restore</button></td></tr>
          ))}
          {backups && !backups.length && <tr><td colSpan={5} className="dc-note">No backups yet.</td></tr>}
        </tbody></table>
        {ask && typeof ask === "object" && (
          <div className="dc-confirm" style={{ marginTop: 8 }}>Restore the backup from {new Date(ask.restore.createdAt).toLocaleString()}? Records missing now are brought back; existing ones are left as they are. A safety backup is taken first.
            <button type="button" className="dc-btn sm pri" onClick={() => void restore(ask.restore)}>Restore</button><button type="button" className="dc-btn sm" onClick={() => setAsk(null)}>Cancel</button></div>
        )}
      </section>
      <section>
        <b>Clear DARWIN&apos;s discovered leads</b>
        {cp ? (
          <>
            <p className="dc-note">This removes {cp.darwinLeads} DARWIN search record{cp.darwinLeads === 1 ? "" : "s"}{cp.darwinFollowUps ? `, ${cp.darwinFollowUps} of its follow-ups` : ""}{cp.darwinMessages ? ` and ${cp.darwinMessages} message drafts/records` : ""}{cp.examples.length ? ` (e.g. ${cp.examples.join(", ")})` : ""}. DARWIN still remembers these businesses, so they won&apos;t come back as new. Their verification evidence stays on the CRM leads.</p>
            <label className="dc-note"><input type="checkbox" checked={withCrm} onChange={(e) => setWithCrm(e.target.checked)} /> Also remove the {cp.untouchedCrmLeads} CRM lead{cp.untouchedCrmLeads === 1 ? "" : "s"} DARWIN added that you never touched (no calls, notes, follow-ups, demos or quotes). The {cp.protectedCrmLeads} with any history are always kept.</label>
            {ask === "clear" ? (
              <div className="dc-confirm">Remove <b>{cp.darwinLeads}</b> DARWIN record{cp.darwinLeads === 1 ? "" : "s"}{withCrm ? <> and <b>{cp.untouchedCrmLeads}</b> untouched CRM lead{cp.untouchedCrmLeads === 1 ? "" : "s"}</> : null}? A backup is saved first.
                <button type="button" className="dc-btn sm danger pri" onClick={() => void clear()}>Yes, clear them</button><button type="button" className="dc-btn sm" onClick={() => setAsk(null)}>Cancel</button></div>
            ) : <div className="dc-row"><button type="button" className="dc-btn danger" disabled={busy || (!cp.darwinLeads && !(withCrm && cp.untouchedCrmLeads))} onClick={() => setAsk("clear")}>Clear…</button></div>}
          </>
        ) : <p className="dc-note">Loading…</p>}
      </section>
    </Dialog>
  );
}
