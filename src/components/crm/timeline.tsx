"use client";

import type { ReactNode } from "react";
import type { IslandLeadFull } from "@/lib/robin/island-types";

export const chan = (c: string) => ({ call: "Call", email: "Email", whatsapp: "WhatsApp", instagram: "Instagram DM" } as Record<string, string>)[c] ?? c;
export const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };

/** One entry on the lead's timeline, built only from what the CRM recorded. */
export interface Ev { id: string; at: string; when: string; kind: "call" | "message" | "stage" | "task" | "note" | "deal"; title: ReactNode; /** plain text for the activity search */ s: string; body?: string | null; tag?: string | null; late?: boolean }

export function timeline(l: IslandLeadFull): Ev[] {
  const ev: Ev[] = [];
  for (const i of l.interactions) {
    ev.push({ id: `i${i.id}`, at: i.at, when: i.when, kind: i.channel === "call" ? "call" : "message", s: `${i.direction} ${chan(i.channel)}`,
      title: <>{i.direction === "inbound" ? "Inbound" : "Outbound"} {chan(i.channel).toLowerCase()}</>, tag: i.outcome?.replace(/_/g, " ") ?? null, body: i.notes });
  }
  for (const m of l.stageHistory) ev.push({ id: `s${m.at}${m.to}`, at: m.at, when: m.when, kind: "stage", s: `status changed ${m.from ?? ""} ${m.to}`, title: <>Status changed {m.from ? <><b>{m.from}</b> → </> : "to "}<b>{m.to}</b></> });
  for (const f of l.followUpsAll) {
    if (f.status === "completed") ev.push({ id: `f${f.id}`, at: f.doneAt ?? f.at, when: f.doneAt ? day(f.doneAt) : f.when, kind: "task", s: `task completed ${f.action}`, title: <>Task completed: {f.action}</>, body: f.notes });
    else if (f.status === "pending") ev.push({ id: `f${f.id}`, at: f.at, when: f.when, kind: "task", s: `follow-up due ${f.action}`, title: <>Follow-up due: {f.action}</>, body: f.notes, late: f.overdue, tag: f.overdue ? "overdue" : "pending" });
    else ev.push({ id: `f${f.id}`, at: f.at, when: f.when, kind: "task", s: `follow-up ${f.status} ${f.action}`, title: <>Follow-up {f.status}: {f.action}</>, body: f.notes });
  }
  for (const d of l.demos) ev.push({ id: `d${d.id}`, at: d.at, when: d.when, kind: "deal", s: `demo ${d.type}`, title: <>Demo ({d.type})</>, tag: d.status });
  for (const x of l.quotations) ev.push({ id: `q${x.id}`, at: x.at, when: x.when, kind: "deal", s: `quotation ${x.number} ${x.currency} ${x.total}`, title: <>Quotation {x.number} · {x.currency} {x.total.toLocaleString()}</>, tag: x.status });
  // notes saved on the lead are stamped "YYYY-MM-DD: text"
  (l.notes ?? "").split("\n").map((s) => s.trim()).filter(Boolean).forEach((line, k) => {
    const m = /^(\d{4}-\d{2}-\d{2}):\s*(.*)$/.exec(line);
    const at = m ? `${m[1]}T12:00:00.000Z` : l.createdAt;
    ev.push({ id: `n${k}`, at, when: day(at), kind: "note", s: "note", title: "Note", body: m ? m[2] : line });
  });
  ev.push({ id: "created", at: l.createdAt, when: day(l.createdAt), kind: "stage", s: "lead added", title: "Lead added to the CRM" });
  return ev.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
