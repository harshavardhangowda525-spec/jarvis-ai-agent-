"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, MessageSquare, IndianRupee, ClipboardList, RefreshCw } from "lucide-react";

type Project = { id: string; name: string; client: string; status: string; stage: string | null; progress: number; nextMilestone: string | null; nextDue: string | null; overdue: number; unread: number; balance: number };
type Overview = { projects: Project[]; unreadMessages: number; openRequests: number; pendingApprovals: number; paymentsToConfirm: number; outstanding: number; dues: { invoice: string; client: string; project: string; balance: number; due: string | null; overdue: boolean }[] };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Your Client Portal at a glance (read through JARVIS as your portal admin). */
export function PortalPanel() {
  const [data, setData] = useState<{ connected: boolean; overview?: Overview } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    const r = await fetch("/api/portal").then((x) => x.json()).catch(() => null);
    if (!r?.ok) setErr(r?.error ?? "Couldn't reach the Client Portal."); else setData(r.data);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000); return () => clearInterval(t); }, [load]);

  if (err) return <div className="p-6 text-sm text-red-400">{err}</div>;
  if (!data) return <div className="p-6 text-sm text-white/50">Loading the Client Portal…</div>;
  if (!data.connected) return (
    <div className="mx-auto max-w-xl p-6 text-sm text-white/75">
      <h1 className="mb-2 text-lg font-semibold text-white">Client Portal</h1>
      Not connected yet. Add <code className="text-cyan-300">CLIENT_PORTAL_DATABASE_URL</code> (the portal&apos;s Neon connection string) to <code>.env.local</code> and restart JARVIS.
    </div>
  );
  const o = data.overview!;
  const tile = (icon: React.ReactNode, label: string, value: string, warn = false) => (
    <div className={`rounded-xl border p-3 ${warn ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-white/[0.03]"}`}><div className="mb-1 flex items-center gap-1.5 text-xs text-white/55">{icon}{label}</div><div className="text-lg font-semibold text-white">{value}</div></div>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 text-sm text-white/80">
      <div className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-cyan-300" /><h1 className="text-lg font-semibold text-white">Client Portal</h1>
        <button type="button" onClick={() => void load()} className="ml-auto rounded-lg border border-white/15 p-1.5 hover:bg-white/5" title="Refresh"><RefreshCw className="h-4 w-4" /></button></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tile(<MessageSquare className="h-3.5 w-3.5" />, "Unread client messages", String(o.unreadMessages), o.unreadMessages > 0)}
        {tile(<ClipboardList className="h-3.5 w-3.5" />, "Open requests · approvals", `${o.openRequests} · ${o.pendingApprovals}`)}
        {tile(<IndianRupee className="h-3.5 w-3.5" />, "Outstanding", inr(o.outstanding), o.dues.some((d) => d.overdue))}
        {tile(<IndianRupee className="h-3.5 w-3.5" />, "Payments to confirm", String(o.paymentsToConfirm), o.paymentsToConfirm > 0)}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.04] text-white/50"><tr><th className="p-2">Project</th><th className="p-2">Progress</th><th className="p-2">Next</th><th className="p-2">Messages</th><th className="p-2">Due</th></tr></thead>
          <tbody>{o.projects.map((p) => (
            <tr key={p.id} className="border-t border-white/5">
              <td className="p-2"><div className="font-medium text-white">{p.name}</div><div className="text-white/45">{p.client} · {p.status.replace(/_/g, " ")}</div></td>
              <td className="p-2"><div className="h-1.5 w-24 overflow-hidden rounded bg-white/10"><div className="h-full bg-cyan-400" style={{ width: `${p.progress}%` }} /></div><span className="text-white/50">{p.progress}%</span></td>
              <td className="p-2">{p.nextMilestone ?? "—"}{p.nextDue && <span className="block text-white/45">{p.nextDue}</span>}{p.overdue > 0 && <span className="block text-amber-300">{p.overdue} overdue</span>}</td>
              <td className="p-2">{p.unread ? <span className="text-amber-300">{p.unread} unread</span> : "—"}</td>
              <td className="p-2">{p.balance ? inr(p.balance) : "—"}</td>
            </tr>))}
            {!o.projects.length && <tr><td className="p-3 text-white/45" colSpan={5}>No active projects.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-white/45">Ask JARVIS: &quot;any client messages?&quot;, &quot;how is FitZone&apos;s project?&quot;, &quot;reply to Ravi that the preview is ready&quot; — JARVIS shows you the message first and sends only after your yes.</p>
    </div>
  );
}
