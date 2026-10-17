"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { leadDetail } from "@/lib/crm/service";
import { CRM_STATUSES, CONFIRM_STATUSES, statusLabel, type CrmStatus } from "@/lib/crm/status";
import { api, igHandle, safeHref, siteLabel, waHref } from "./net";
import { timeline } from "./timeline";

type Lead = Awaited<ReturnType<typeof leadDetail>>;
const tone = (s: CrmStatus) => CRM_STATUSES.find((x) => x.id === s)?.tone ?? "gray";
const OUTCOMES: [string, string][] = [["spoke", "Spoke"], ["interested", "Interested"], ["wants_demo", "Wants a demo"], ["wants_quotation", "Wants a quotation"], ["call_later", "Call later"], ["no_answer", "No answer"], ["busy", "Busy"], ["not_interested", "Not interested"], ["wrong_number", "Wrong number"]];
const FIELDS: [string, string][] = [["businessName", "Business name"], ["category", "Niche / category"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["website", "Website"], ["instagram", "Instagram"], ["city", "City / area"], ["address", "Address"], ["serviceInterest", "Interested in"]];

/** The lead's current value for an editable field (the name is `name` on the detail). */
const valOf = (lead: Lead, k: string) => String((k === "businessName" ? lead.name : (lead as unknown as Record<string, unknown>)[k]) ?? "");

function Unknown() { return <span className="dc-unk">Unknown</span>; }

export function LeadPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg: { ok: boolean; text: string }) => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<CrmStatus | null>(null);
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [note, setNote] = useState("");
  const [fu, setFu] = useState<{ at: string; action: string } | null>(null);
  const [call, setCall] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ lead: Lead }>(`/api/crm/${encodeURIComponent(id)}`);
    if (r.ok) { setLead(r.data.lead); setErr(null); } else setErr(r.error);
  }, [id]);
  useEffect(() => { setLead(null); setEdit(null); setConfirm(null); setFu(null); setCall(false); void load(); }, [load]);

  const done = async (ok: boolean, text: string) => { onChanged({ ok, text }); await load(); };

  const setStatus = async (s: CrmStatus, confirmed = false) => {
    if (!lead) return;
    if (!confirmed && CONFIRM_STATUSES.includes(s)) { setConfirm(s); return; }
    setConfirm(null); setBusy(true);
    const r = await api<{ moved: { changed: boolean } }>(`/api/crm/${lead.id}`, { method: "PATCH", body: { status: s, confirm: confirmed || undefined } });
    setBusy(false);
    if (!r.ok && r.code === "needs_confirmation") { setConfirm(s); return; }
    await done(r.ok, r.ok ? (r.data.moved.changed ? `Saved — ${lead.name} is now ${statusLabel(s)}.` : `${lead.name} is already ${statusLabel(s)}.`) : `Not saved: ${r.error}`);
  };

  const saveEdit = async () => {
    if (!lead || !edit) return;
    const fields: Record<string, string | null> = {};
    for (const [k] of FIELDS) {
      const now = (edit[k] ?? "").trim(), was = valOf(lead, k);
      if (now !== was) fields[k] = now || null;
    }
    if (!Object.keys(fields).length) { setEdit(null); return; }
    if (fields.businessName === null) { onChanged({ ok: false, text: "A lead needs a business name." }); return; }
    setBusy(true);
    const r = await api(`/api/crm/${lead.id}`, { method: "PATCH", body: { fields } });
    setBusy(false);
    if (r.ok) setEdit(null);
    await done(r.ok, r.ok ? `Saved ${Object.keys(fields).length} change${Object.keys(fields).length === 1 ? "" : "s"} to ${lead.name}.` : `Not saved: ${r.error}`);
  };

  const addNote = async () => {
    if (!lead || !note.trim()) return;
    setBusy(true);
    const r = await api<{ on: string }>(`/api/robin/leads/${lead.id}/notes`, { method: "POST", body: { text: note.trim(), source: "user" } });
    setBusy(false);
    if (r.ok) setNote("");
    await done(r.ok, r.ok ? "Note saved." : `Not saved: ${r.error}`);
  };

  const logCall = async (outcome: string, label: string) => {
    if (!lead) return;
    setCall(false); setBusy(true);
    const r = await api(`/api/robin/leads/${lead.id}/interactions`, { method: "POST", body: { channel: "call", direction: "outbound", outcome, source: "user" } });
    setBusy(false);
    await done(r.ok, r.ok ? `Call logged — ${label.toLowerCase()}.` : `Not logged: ${r.error}`);
  };

  const schedule = async () => {
    if (!lead || !fu?.at) return;
    const at = new Date(fu.at);
    if (Number.isNaN(+at)) { onChanged({ ok: false, text: "Pick a date and time." }); return; }
    setBusy(true);
    const r = await api(`/api/robin/followups`, { method: "POST", body: { leadId: lead.id, dueAt: at.toISOString(), action: fu.action, source: "user" } });
    setBusy(false);
    if (r.ok) setFu(null);
    await done(r.ok, r.ok ? `Follow-up scheduled for ${at.toLocaleString()}.` : `Not scheduled: ${r.error}`);
  };

  const complete = async (fid: string) => {
    setBusy(true);
    const r = await api(`/api/robin/followups/${fid}`, { method: "PATCH", body: { action: "complete", source: "user" } });
    setBusy(false);
    await done(r.ok, r.ok ? "Follow-up marked done." : `Not saved: ${r.error}`);
  };

  const events = useMemo(() => (lead ? timeline(lead) : []), [lead]);
  const pending = lead ? lead.followUpsAll.filter((f) => f.status === "pending").slice().sort((a, b) => (a.at < b.at ? -1 : 1)) : [];
  const ev = (lead?.evidence ?? null) as null | { source?: string; sourceUrl?: string | null; discoveredAt?: string; lastVerifiedAt?: string | null; verifiedFields?: string[]; website?: { status?: string | null; reasons?: string[]; checkedAt?: string | null } | null; phoneSource?: string | null; emailSource?: string | null; google?: { rating?: number | null; reviews?: number | null } | null };

  return (
    <>
      <button type="button" className="dc-scrim" aria-label="Close lead" onClick={onClose} />
      <aside className="dc-panel" role="dialog" aria-label={lead ? `Lead ${lead.name}` : "Lead"}>
        <header className="dc-ph">
          <div>
            <h2>{lead?.name ?? "Loading…"}</h2>
            {lead && <small>{[lead.number != null ? `#${lead.number}` : null, lead.category, lead.city].filter(Boolean).join(" · ") || "No niche or location on record"}</small>}
          </div>
          <button type="button" className="dc-btn sm x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {err && <p className="dc-flash bad">{err}</p>}
        {lead && (
          <div className="dc-pb">
            <section className="dc-sec">
              <h3>Status</h3>
              <div className="dc-row">
                <span className={`dc-pill t-${tone(lead.status)}`}>{statusLabel(lead.status)}</span>
                <select className="dc-sel" aria-label="Change status" value="" disabled={busy} onChange={(e) => { if (e.target.value) void setStatus(e.target.value as CrmStatus); }}>
                  <option value="">Change status…</option>
                  {CRM_STATUSES.filter((s) => s.id !== lead.status).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <span className="dc-note">since {new Date(lead.stageSince).toLocaleDateString()}</span>
              </div>
              {confirm && (
                <div className="dc-confirm" role="alertdialog" style={{ marginTop: 8 }}>
                  Mark <b>{lead.name}</b> as <b>{statusLabel(confirm)}</b>? This is a decision, so it asks first.
                  <button type="button" className="dc-btn sm pri" onClick={() => void setStatus(confirm, true)}>Yes, mark it</button>
                  <button type="button" className="dc-btn sm" onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              )}
            </section>

            <section className="dc-sec">
              <h3>Contact {!edit && <button type="button" className="dc-btn sm" onClick={() => setEdit(Object.fromEntries(FIELDS.map(([k]) => [k, valOf(lead, k)])))}>Edit</button>}</h3>
              {edit ? (
                <form className="dc-form" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
                  {FIELDS.map(([k, label]) => (
                    <label key={k} className={k === "address" ? "full" : ""}>{label}
                      <input className="dc-in" value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                    </label>
                  ))}
                  <div className="full dc-row"><button type="submit" className="dc-btn pri" disabled={busy}>Save</button><button type="button" className="dc-btn" onClick={() => setEdit(null)}>Cancel</button><span className="dc-note">Empty = unknown.</span></div>
                </form>
              ) : (
                <dl className="dc-kv">
                  <dt>Phone</dt><dd>{lead.phone ? <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a> : <Unknown />}</dd>
                  <dt>WhatsApp</dt><dd>{waHref(lead.whatsapp ?? lead.phone) ? <a href={waHref(lead.whatsapp ?? lead.phone)!} target="_blank" rel="noreferrer" title="Opens the chat — you send the message yourself">{lead.whatsapp ?? lead.phone}</a> : <Unknown />}</dd>
                  <dt>Email</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`} target="_blank" rel="noreferrer">{lead.email}</a> : <Unknown />}</dd>
                  <dt>Website</dt><dd>{lead.website && safeHref(lead.website, "web") ? <a href={safeHref(lead.website, "web")!} target="_blank" rel="noreferrer">{siteLabel(lead.website)}</a> : lead.websiteStatus === "no_website" ? "None (verified)" : <Unknown />}</dd>
                  <dt>Instagram</dt><dd>{lead.instagram && safeHref(lead.instagram, "ig") ? <a href={safeHref(lead.instagram, "ig")!} target="_blank" rel="noreferrer">@{igHandle(lead.instagram)}</a> : <Unknown />}</dd>
                  <dt>Address</dt><dd>{lead.address ?? <Unknown />}{lead.mapsUrl && safeHref(lead.mapsUrl, "web") ? <> · <a href={safeHref(lead.mapsUrl, "web")!} target="_blank" rel="noreferrer">Map</a></> : null}</dd>
                  <dt>Source</dt><dd>{lead.source.replace(/^import:/, "Imported · ")}</dd>
                  {lead.serviceInterest && <><dt>Interested in</dt><dd>{lead.serviceInterest}</dd></>}
                </dl>
              )}
            </section>

            <section className="dc-sec">
              <h3>Log & plan</h3>
              <div className="dc-row">
                <button type="button" className={`dc-btn sm ${call ? "on" : ""}`} disabled={busy} onClick={() => setCall((v) => !v)}>Log a call</button>
                <button type="button" className={`dc-btn sm ${fu ? "on" : ""}`} disabled={busy || lead.stage === "do_not_contact"} onClick={() => setFu(fu ? null : { at: "", action: "call" })}>Schedule follow-up</button>
              </div>
              {call && <div className="dc-row" style={{ marginTop: 8 }}>{OUTCOMES.map(([o, l]) => <button key={o} type="button" className="dc-btn sm" onClick={() => void logCall(o, l)}>{l}</button>)}</div>}
              {fu && (
                <form className="dc-row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void schedule(); }}>
                  <input className="dc-in" style={{ width: "auto" }} type="datetime-local" required value={fu.at} onChange={(e) => setFu({ ...fu, at: e.target.value })} aria-label="When" />
                  <select className="dc-sel" value={fu.action} onChange={(e) => setFu({ ...fu, action: e.target.value })} aria-label="How">
                    {["call", "whatsapp", "email", "instagram", "visit", "demo"].map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
                  </select>
                  <button type="submit" className="dc-btn sm pri" disabled={busy}>Save</button>
                </form>
              )}
            </section>

            <section className="dc-sec">
              <h3>Follow-ups</h3>
              {pending.length ? pending.map((f) => (
                <div key={f.id} className={`dc-task ${f.overdue ? "late" : ""}`}>
                  <span><b>{f.action.replace(/_/g, " ")}</b><small>{f.overdue ? "Overdue · " : ""}{f.when}{f.notes ? ` · ${f.notes}` : ""}</small></span>
                  <button type="button" className="dc-btn sm" disabled={busy} onClick={() => void complete(f.id)}>Done</button>
                </div>
              )) : <p className="dc-note">No follow-up scheduled.</p>}
            </section>

            <section className="dc-sec">
              <h3>Notes</h3>
              {lead.notes ? <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", userSelect: "text" }}>{lead.notes}</p> : <p className="dc-note" style={{ marginBottom: 8 }}>No notes yet.</p>}
              <form onSubmit={(e) => { e.preventDefault(); void addNote(); }} className="dc-row">
                <textarea className="dc-ta" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Add a note…" aria-label="New note" />
                <button type="submit" className="dc-btn sm pri" disabled={busy || !note.trim()}>Save note</button>
              </form>
            </section>

            <section className="dc-sec">
              <h3>Verification evidence</h3>
              {ev ? (
                <div className="dc-evi">
                  <dl className="dc-kv">
                    <dt>Found via</dt><dd>{ev.source ?? "—"}{ev.sourceUrl && safeHref(ev.sourceUrl, "web") ? <> · <a href={safeHref(ev.sourceUrl, "web")!} target="_blank" rel="noreferrer">listing</a></> : null}{ev.discoveredAt ? ` · ${new Date(ev.discoveredAt).toLocaleDateString()}` : ""}</dd>
                    <dt>Website check</dt><dd>{ev.website?.status ? <>{ev.website.status.replace(/_/g, " ")}{ev.website.checkedAt ? ` (${new Date(ev.website.checkedAt).toLocaleDateString()})` : ""}{ev.website.reasons?.length ? <><br /><small className="dc-note">{ev.website.reasons.join(" ")}</small></> : null}</> : "not checked"}</dd>
                    <dt>Phone from</dt><dd>{ev.phoneSource ?? (lead.phone ? "the listing" : "—")}</dd>
                    {ev.emailSource && <><dt>Email from</dt><dd>{ev.emailSource}</dd></>}
                    {ev.google?.rating != null && <><dt>Google</dt><dd>{ev.google.rating}★ ({ev.google.reviews ?? 0} reviews)</dd></>}
                    {ev.verifiedFields?.length ? <><dt>Verified</dt><dd>{ev.verifiedFields.join(", ")}</dd></> : null}
                  </dl>
                </div>
              ) : <p className="dc-note">No verification evidence on record — this lead was {lead.source.startsWith("import") ? "imported" : lead.source === "manual" ? "added by hand" : "added before evidence was kept"}.</p>}
            </section>

            <section className="dc-sec">
              <h3>History</h3>
              <ul className="dc-tl">
                {events.map((e) => (
                  <li key={e.id} className={`k-${e.kind}`}>
                    <span>{e.title}{e.tag && <i className="dc-tag">{e.tag}</i>}</span><em>{e.when}</em>
                    {e.body && <p>{e.body}</p>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
