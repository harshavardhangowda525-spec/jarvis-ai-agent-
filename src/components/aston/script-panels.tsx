"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fromEditText, KIND_LABEL, SCRIPT_KINDS, toEditText, type ScriptDetails, type ScriptKind, type ScriptSection } from "@/lib/aston/scripts/format";
import { api, type ListRow, type Script } from "./teleprompter-shared";

/** The teleprompter's side panels: editor, customise-and-regenerate, script library. */

/* ------------------------------------------------------------------ editor */

export function Editor({ script, busy, onCancel, onSave }: { script: Script; busy: boolean; onCancel: () => void; onSave: (s: ScriptSection[]) => void }) {
  const [text, setText] = useState(() => toEditText(script.sections));
  const parsed = useMemo(() => fromEditText(text), [text]);
  return (
    <div className="tp-panel">
      <p className="tp-hint">“## Heading” starts a section · “&gt; Client: …” is the client · a line in [brackets] is a direction (not read aloud).</p>
      <textarea className="tp-editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck aria-label="Script text" />
      <div className="tp-row tp-row-end">
        <span className="tp-label">{parsed.length} sections</span>
        <button className="tp-btn" onClick={onCancel}>Cancel</button>
        <button className="tp-btn tp-btn-primary" disabled={busy || !parsed.length} onClick={() => onSave(parsed)}>Save edits</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ customise before starting */

export function Customize({ script, onCancel, onGenerate }: { script: Script; onCancel: () => void; onGenerate: (k: ScriptKind, d: ScriptDetails) => void }) {
  const [kind, setKind] = useState<ScriptKind>(script.kind);
  const [d, setD] = useState<ScriptDetails>(script.details ?? {});
  const field = (k: keyof ScriptDetails, label: string, ph: string) => (
    <label className="tp-field"><span>{label}</span><input value={d[k] ?? ""} placeholder={ph} maxLength={k === "notes" ? 600 : 160} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></label>
  );
  return (
    <div className="tp-panel">
      <p className="tp-hint">Change the details and ASTON rewrites the script. Empty fields use your defaults; nothing is invented.</p>
      <label className="tp-field"><span>Script type</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as ScriptKind)}>{SCRIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
      </label>
      <div className="tp-grid">
        {field("businessName", "Business name", "e.g. Brew Lab")}
        {field("industry", "Industry", "e.g. Café")}
        {field("service", "Service", "e.g. Website development")}
        {field("price", "Price", "e.g. ₹4,999")}
        {field("offer", "Offer", "Only a real offer — or leave empty")}
        {field("notes", "Notes", "Anything ASTON should know")}
      </div>
      <div className="tp-row tp-row-end">
        <button className="tp-btn" onClick={onCancel}>Cancel</button>
        <button className="tp-btn tp-btn-primary" onClick={() => onGenerate(kind, d)}>Regenerate script</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ library */

export function Library({ onOpen, onClose, onNew }: { onOpen: (id: string) => void; onClose: () => void; onNew: (req: string) => void }) {
  const [scope, setScope] = useState<"saved" | "recent">("saved");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [type, setType] = useState("");
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState("");

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ scope, ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(type ? { type } : {}) });
      const r = await api<{ scripts: ListRow[]; businessTypes: string[] }>(`/api/aston/scripts?${p}`);
      setRows(r.scripts); setTypes(r.businessTypes); setErr(null);
    } catch (e: any) { setErr(e?.message ?? "Couldn't load your scripts."); setRows([]); }
  }, [scope, q, kind, type]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const rename = async (r: ListRow) => { const t = window.prompt("Script name", r.title); if (t?.trim()) { await api(`/api/aston/scripts/${r.id}`, { method: "PATCH", body: JSON.stringify({ title: t.trim() }) }).catch((e) => setErr(e.message)); load(); } };
  const dup = async (r: ListRow) => { await api(`/api/aston/scripts/${r.id}/duplicate`, { method: "POST" }).catch((e) => setErr(e.message)); setScope("saved"); load(); };
  const del = async (r: ListRow) => { if (window.confirm(`Delete “${r.title}”? This can't be undone.`)) { await api(`/api/aston/scripts/${r.id}`, { method: "DELETE" }).catch((e) => setErr(e.message)); load(); } };
  const keep = async (r: ListRow) => { await api(`/api/aston/scripts/${r.id}`, { method: "PATCH", body: JSON.stringify({ saved: true }) }).catch((e) => setErr(e.message)); load(); };

  return (
    <div className="tp-panel tp-library">
      <form className="tp-new" onSubmit={(e) => { e.preventDefault(); if (ask.trim().length >= 3) onNew(ask.trim()); }}>
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="New script — e.g. “cold call for a gym that needs a website”" maxLength={1500} />
        <button className="tp-btn tp-btn-primary" type="submit">Write</button>
      </form>
      <div className="tp-row">
        <button className={`tp-chip ${scope === "saved" ? "tp-chip-on" : ""}`} onClick={() => setScope("saved")}>Saved</button>
        <button className={`tp-chip ${scope === "recent" ? "tp-chip-on" : ""}`} onClick={() => setScope("recent")}>Recent</button>
        <input className="tp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search scripts" />
      </div>
      <div className="tp-row tp-wrap">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Pitching method">
          <option value="">All methods</option>{SCRIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Business type">
          <option value="">All businesses</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="tp-btn" onClick={onClose}>Close</button>
      </div>
      {err && <p className="tp-err">{err}</p>}
      {!rows ? <p className="tp-sub">Loading…</p> : !rows.length ? (
        <p className="tp-sub">{scope === "saved" ? "No saved scripts yet. Write one above, then press Save." : "Nothing yet."}</p>
      ) : (
        <ul className="tp-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button className="tp-open" onClick={() => onOpen(r.id)}>
                <strong>{r.title}</strong>
                <span>{r.kindLabel}{r.businessType ? ` · ${r.businessType}` : ""} · {new Date(r.updatedAt).toLocaleDateString()}{r.saved ? "" : " · draft"}</span>
              </button>
              <div className="tp-row-actions">
                {!r.saved && <button onClick={() => keep(r)}>Save</button>}
                <button onClick={() => rename(r)}>Rename</button>
                <button onClick={() => dup(r)}>Duplicate</button>
                <button onClick={() => del(r)} className="tp-danger">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

