"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mic, MicOff, Loader2, LogOut, CalendarClock, Presentation, FileText, Crown, BarChart3, Settings2, UserPlus, Send, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/activity/client";
import { useVoice, useResumeVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import type { Overview, LeadCard } from "@/lib/robin/overview";
import { CORE_LABEL, CONFIRM_STAGES, STAGE_LABEL, nodeStage, money, type CoreState, type NodeId, type Stage } from "@/lib/robin/types";
import { parseRobinCommand, parseWhen, type View, type LeadFilter } from "@/lib/robin/command";
import { RobinCoreEngine } from "./core-engine";
import { PipelineChart, type ChartMode, type PipelineHandle } from "./pipeline-chart";
import { LeadPanel } from "./lead-panel";
import { FollowUpsPanel, DemosPanel, QuotationsPanel, ClientsPanel, LeadsPanel, AnalyticsPanel, SettingsPanel, AddLeadPanel } from "./panels";
import { rapi, when } from "./api";
import { Count, Money, reducedMotion } from "./anim";

/**
 * ROBIN — the sales command center. The holographic core is Robin's brain, the
 * pipeline chart is its sales memory, and the motion between them is what
 * Robin is actually doing. Everything on screen is the real CRM (polled live);
 * with no data it shows elegant empty states, never placeholders.
 */

type Panel =
  | { kind: "followups" } | { kind: "demos" } | { kind: "quotations" } | { kind: "clients" } | { kind: "analytics" } | { kind: "settings" } | { kind: "add" }
  | { kind: "leads"; title: string; query: string };
interface Feed { id: string; at: string; text: string; fresh?: boolean }

const POLL_MS = 15_000;
const BOOT_MS = 2600;
const FILTER_QUERY: Record<string, { title: string; query: string }> = {
  hottest: { title: "HIGHEST-PRIORITY LEADS", query: "hot=1" },
  uncontacted: { title: "NOT CONTACTED YET", query: "uncontacted=1" },
  high_priority: { title: "HIGH PRIORITY", query: "priority=high" },
};

export function RobinConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const darwinRef = useRef<HTMLDivElement>(null);
  const engine = useRef<RobinCoreEngine | null>(null);
  const chart = useRef<PipelineHandle>(null);

  const [ov, setOv] = useState<Overview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mode, setMode] = useState<ChartMode>("pipeline");
  const [core, setCoreState] = useState<CoreState>("idle");
  const [highlight, setHighlight] = useState<Partial<Record<NodeId, number>>>({});
  const [expanded, setExpanded] = useState<NodeId | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadSheet, setLeadSheet] = useState<{ sheet: "followup" | "demo" | "quote" | "next" | null; at: number } | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [confirm, setConfirm] = useState<{ q: string; run: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [booted, setBooted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const prevMap = useRef<Map<string, NodeId> | null>(null);
  const names = useRef<Map<string, string>>(new Map());
  const coreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- core state: an action sets it, then it settles back to idle
  const setCore = useCallback((s: CoreState, holdMs = 2600) => {
    setCoreState(s);
    engine.current?.setState(s);
    if (coreTimer.current) clearTimeout(coreTimer.current);
    if (s !== "idle") coreTimer.current = setTimeout(() => { setCoreState("idle"); engine.current?.setState("idle"); }, holdMs);
  }, []);
  const lightUp = useCallback((ids: NodeId[]) => {
    const t = Date.now();
    setHighlight((h) => ({ ...h, ...Object.fromEntries(ids.map((i) => [i, t])) }));
    setTimeout(() => setHighlight((h) => ({ ...h })), 1900); // re-render to clear
  }, []);
  /** The signature "Sales Intelligence Pulse": core → rings → arcs to every stage → stages update → idle. */
  const signaturePulse = useCallback((targets?: NodeId[]) => {
    const e = engine.current, c = chart.current;
    if (!e || !c) return;
    const ids = targets ?? (["new", "qualified", "contacted", "interested", "follow_up", "demo", "quotation", "negotiation", "won"] as NodeId[]);
    const pts = ids.map((id) => c.nodeCenter(id)).filter(Boolean) as { x: number; y: number }[];
    setCore("analyzing", 1800);
    e.pulse(pts, (i) => lightUp([ids[i]]));
  }, [lightUp, setCore]);

  // ---- canvas
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let e: RobinCoreEngine;
    try { e = new RobinCoreEngine(c); } catch { return; }
    engine.current = e;
    const place = () => {
      e.resize();
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) e.setAnchor(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.3);
    };
    place();
    const ro = new ResizeObserver(place);
    if (anchorRef.current) ro.observe(anchorRef.current);
    window.addEventListener("resize", place);
    const move = (ev: PointerEvent) => e.pointer(ev.clientX, ev.clientY);
    window.addEventListener("pointermove", move);
    e.start();
    e.boot(BOOT_MS);
    const t = setTimeout(() => setBooted(true), reducedMotion() ? 0 : BOOT_MS - 600);
    return () => { clearTimeout(t); ro.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("pointermove", move); e.stop(); };
  }, []);

  // ---- voice + brain
  const handleRef = useRef<(t: string) => void>(() => {});
  const voice = useVoice({ onTranscript: (t) => handleRef.current(t), autoListen: true, voiceProfile: "robin" });
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const say = useCallback((text: string) => {
    setReply(text);
    const v = voiceRef.current;
    if (voiceStarted && !v.muted && v.enabled) { try { v.speak(text); } catch { /* ignore */ } }
  }, [voiceStarted]);
  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }
  useResumeVoice(enableVoice);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const agent = useAgent({
    onAssistantComplete: (text) => say(text.replace(/\*\*/g, "")),
    onNavigate: (p) => {
      const m = p.match(/^\/dashboard\/robin\?(.*)$/);
      const sp = m ? new URLSearchParams(m[1]) : null;
      if (sp?.get("lead")) { setLeadId(sp.get("lead")); return; }
      if (sp?.get("view")) { openView(sp.get("view") as View); return; }
      if (!p.startsWith("/dashboard/robin")) router.push(p);
    },
    onTool: (t) => {
      if (t.status !== "ok") return;
      if (/robin_(update_stage|schedule|log|complete|prepare|set_priority)/.test(t.name)) {
        setCore(t.name.includes("followup") ? "following_up" : t.name.includes("demo") ? "demo" : t.name.includes("quotation") ? "quotation" : "contacting");
        void refreshRef.current();
      }
    },
  });
  useEffect(() => {
    const iv = setInterval(() => {
      const v = voiceRef.current, e = engine.current;
      if (!e) return;
      if (v.status === "speaking") e.setVoice("speaking", v.getOutputLevel?.() ?? 0.4);
      else if (agent.streaming) e.setVoice("processing", 0);
      else if (v.status === "recording") e.setVoice("listening", v.level);
      else e.setVoice("none", 0);
    }, 50);
    return () => clearInterval(iv);
  }, [agent.streaming]);

  // ---- live data
  const refresh = useCallback(async (first = false) => {
    const r = await rapi<{ overview: Overview; sync: { imported: number; names: string[] } | null; reminders: { text: string }[] }>("overview");
    if (!r.ok || !r.data) { if (first) setLoadErr(r.error ?? "Couldn't load the CRM."); return; }
    setLoadErr(null);
    const o = r.data.overview;
    for (const n of o.nodes) for (const l of n.leads) names.current.set(l.id, l.name);
    // what changed since the last look → motion
    const prev = prevMap.current;
    const next = new Map(o.stageMap);
    if (prev && !first) {
      const added = o.stageMap.filter(([id]) => !prev.has(id));
      const moved = o.stageMap.filter(([id, n]) => prev.has(id) && prev.get(id) !== n);
      if (added.length) {
        setCore("qualifying", 3200);
        const d = darwinRef.current?.getBoundingClientRect();
        if (d && engine.current) engine.current.intake({ x: d.left + d.width / 2, y: d.top + d.height / 2 }, Math.min(10, 3 + added.length));
        setTimeout(() => {
          const tgt = chart.current?.nodeCenter("qualified"), e = engine.current;
          if (tgt && e) e.emit(e.center(), tgt, { done: () => lightUp(["qualified", "new"]) });
        }, 1100);
      }
      for (const [id, n] of moved.slice(0, 4)) chart.current?.travel(names.current.get(id) ?? "Lead", prev.get(id)!, n);
      if (moved.length) lightUp(moved.map(([, n]) => n));
    }
    prevMap.current = next;
    setOv(o);
    const imp = r.data.sync?.imported ?? 0;
    if (imp) setToast({ id: Date.now(), text: `${imp} new lead${imp === 1 ? "" : "s"} received from Darwin` });
    for (const rem of r.data.reminders ?? []) {
      setToast({ id: Date.now() + 1, text: rem.text });
      say(rem.text);
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("ROBIN", { body: rem.text }); } catch { /* ignore */ }
    }
  }, [lightUp, say, setCore]);
  refreshRef.current = () => refresh();
  useEffect(() => {
    void refresh(true);
    const iv = setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);
  // the live activity strip follows the CRM's real activity
  useEffect(() => {
    if (!ov) return;
    setFeed((f) => {
      const seen = new Set(f.map((x) => x.id));
      const items = ov.recent.slice(0, 10).reverse().map((r) => ({ id: r.id, at: r.at, text: r.detail, fresh: f.length > 0 && !seen.has(r.id) }));
      return items;
    });
  }, [ov]);

  // ---- boot: greeting, morning report, deep links (?cmd= ?lead= ?view=)
  const greeted = useRef(false);
  useEffect(() => {
    if (!booted || greeted.current || !ov) return;
    greeted.current = true;
    logActivity({ category: "agent", agent: "ROBIN", action: "ROBIN online", importance: 1 });
    say("Robin is online. Ready to manage your sales pipeline.");
    const cmd = params.get("cmd"), lead = params.get("lead"), view = params.get("view");
    if (lead) setLeadId(lead);
    else if (view) openView(view as View);
    setTimeout(async () => {
      signaturePulse();
      if (cmd) { handleRef.current(cmd); return; }
      const m = await rapi<{ due: boolean; text: string | null }>("briefing?morning=1");
      if (m.data?.due && m.data.text) setTimeout(() => say(m.data!.text!), 2600);
    }, 900);
    if (cmd || lead || view) router.replace("/dashboard/robin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, ov]);

  // ---- views / actions
  const openView = useCallback((v: View, filter?: LeadFilter) => {
    if (v === "pipeline" || v === "funnel" || v === "revenue") { setMode(v); setPanel(null); return; }
    setPanel({ kind: v } as Panel);
    void filter;
  }, []);
  const ask = useCallback((q: string, run: () => Promise<void>) => { setConfirm({ q, run }); say(`${q} Say yes to confirm.`); }, [say]);

  const moveLead = useCallback(async (lead: { id: string; name: string; from: NodeId }, to: NodeId, opts: { confirmed?: boolean; source?: "user" | "voice"; stage?: Stage } = {}) => {
    const stage = opts.stage ?? nodeStage(to);
    if (CONFIRM_STAGES.includes(stage) && !opts.confirmed) {
      ask(`Move ${lead.name} to ${STAGE_LABEL[stage]}?`, async () => { await moveLead(lead, to, { ...opts, confirmed: true }); });
      return;
    }
    // the card travels right away; the database is updated at the same time
    chart.current?.travel(lead.name, lead.from, to);
    prevMap.current?.set(lead.id, to);
    setCore(to === "won" ? "complete" : to === "lost" ? "idle" : "contacting", 1800);
    const r = await rapi(`leads/${lead.id}`, "PATCH", { stage, confirm: !!opts.confirmed, source: opts.source ?? "user" });
    if (!r.ok) { say(r.error ?? "That move didn't save."); prevMap.current?.set(lead.id, lead.from); setCore("error", 1500); }
    else {
      lightUp([to]);
      if (to === "won") { engine.current?.ripple(158, 3.4, 2); say(`${lead.name} is won. Convert it into a client?`); setLeadId(lead.id); setLeadSheet({ sheet: null, at: Date.now() }); }
      else say(`${lead.name} moved to ${STAGE_LABEL[stage]}.`);
    }
    await refresh();
  }, [ask, lightUp, refresh, say, setCore]);

  /** Find the lead a command is about: "this lead" = the open one; a name must match exactly one. */
  const resolve = useCallback(async (name: string | null): Promise<{ id: string; businessName: string; stage: string } | null> => {
    if (!name) {
      if (!leadId) { say("Which lead? Open one first, or say its name."); return null; }
      const r = await rapi<{ lead: { id: string; businessName: string; stage: string } }>(`leads/${leadId}`);
      return r.data?.lead ?? null;
    }
    const r = await rapi<{ leads: { id: string; businessName: string; stage: string }[] }>(`leads?resolve=${encodeURIComponent(name)}`);
    const hits = r.data?.leads ?? [];
    if (!hits.length) { say(`I couldn't find "${name}" in your CRM.`); return null; }
    if (hits.length > 1) { say(`I found ${hits.length} matches: ${hits.slice(0, 4).map((h) => h.businessName).join(", ")}. Which one?`); setPanel({ kind: "leads", title: `MATCHES FOR "${name.toUpperCase()}"`, query: `q=${encodeURIComponent(name)}` }); return null; }
    return hits[0];
  }, [leadId, say]);

  const deactivate = useCallback(() => {
    setLeaving(true);
    say("Back to JARVIS.");
    logActivity({ category: "agent", agent: "ROBIN", action: "Closed ROBIN", importance: 1 });
    setTimeout(() => router.push("/dashboard"), 900);
  }, [router, say]);

  const handle = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setReply(null);
    const cmd = parseRobinCommand(text);
    if (cmd.kind === "confirm") {
      if (confirm) { const c = confirm; setConfirm(null); if (cmd.yes) await c.run(); else say("Okay — nothing changed."); return; }
      if (!cmd.yes) { say("Okay."); return; }
    }
    switch (cmd.kind) {
      case "exit": return deactivate();
      case "briefing": {
        setCore("analyzing", 2200);
        signaturePulse();
        const r = await rapi<{ text: string }>("briefing");
        return say(r.data?.text ?? r.error ?? "I couldn't build the briefing.");
      }
      case "view": {
        signaturePulse();
        openView(cmd.view);
        if (cmd.view === "followups" && ov) return say(ov.today.followUps || ov.today.overdue ? `You have ${ov.today.followUps} follow-up${ov.today.followUps === 1 ? "" : "s"} today${ov.today.overdue ? ` and ${ov.today.overdue} overdue` : ""}.${ov.overdueAdvice ? ` ${ov.overdueAdvice}` : ""}` : "No follow-ups due today.");
        if (cmd.view === "revenue" && ov) return say(`Potential pipeline value is ${money(ov.counts.pipelineValue, ov.currency)}${ov.counts.revenueWon ? `, and ${money(ov.counts.revenueWon, ov.currency)} is won` : ""}.`);
        if (cmd.view === "pipeline" && ov) return say(ov.counts.total ? `${ov.counts.total} leads in the pipeline.` : "The pipeline is empty — Darwin's leads arrive here automatically.");
        if (cmd.view === "quotations" && ov) return say(ov.counts.quotations ? `${ov.counts.quotations} quotation${ov.counts.quotations === 1 ? " is" : "s are"} awaiting a response.` : "Here are your quotations.");
        if (cmd.view === "clients" && ov) return say(ov.counts.clients ? `You have ${ov.counts.clients} client${ov.counts.clients === 1 ? "" : "s"}.` : "No clients yet.");
        return;
      }
      case "leads": {
        signaturePulse([cmd.filter as NodeId].filter((x) => ["new", "qualified", "contacted", "interested", "negotiation", "won", "lost"].includes(x)) as NodeId[]);
        const f = FILTER_QUERY[cmd.filter] ?? { title: `${cmd.filter.toUpperCase().replace("_", " ")} LEADS`, query: `node=${cmd.filter}` };
        setPanel({ kind: "leads", ...f });
        if (cmd.filter === "hottest" && ov?.next) return say(`Here are your highest-priority leads. I'd start with ${ov.next.name} — ${ov.next.why}.`);
        return say(`Here are your ${f.title.toLowerCase()}.`);
      }
      case "stat": {
        setCore("analyzing", 1600);
        if (cmd.stat === "count" && ov) {
          const node = ov.nodes.find((n) => n.id === cmd.filter);
          if (node) return say(`${node.count} ${node.label.toLowerCase()} lead${node.count === 1 ? "" : "s"}.`);
        }
        if (cmd.stat === "won_month") {
          const d = new Date(); const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
          const r = await rapi<{ totals: { won: number; revenue: number }; currency: string }>(`analytics?range=custom&from=${from}&to=${new Date().toISOString().slice(0, 10)}`);
          if (!r.data) return say(r.error ?? "I couldn't calculate that.");
          return say(r.data.totals.won ? `You won ${r.data.totals.won} client${r.data.totals.won === 1 ? "" : "s"} this month, worth ${money(r.data.totals.revenue, r.data.currency)}.` : "No clients won this month yet.");
        }
        const r = await rapi<{ rates: { conversion: { value: number | null; num: number; den: number } } }>("analytics?range=30d");
        const c = r.data?.rates.conversion;
        return say(c?.value != null ? `Your conversion rate over the last 30 days is ${c.value}% — ${c.num} won out of ${c.den} leads.` : "There aren't enough leads in the last 30 days to calculate a conversion rate yet.");
      }
      case "open": {
        const l = await resolve(cmd.name);
        if (l) { setLeadId(l.id); say(`Opening ${l.businessName}.`); }
        return;
      }
      case "move": {
        const l = await resolve(cmd.name);
        if (!l) return;
        const from = (prevMap.current?.get(l.id) ?? "new") as NodeId;
        const nodeOfStage = (s: Stage): NodeId => (({ demo_scheduled: "demo", demo_completed: "demo", quotation_sent: "quotation", negotiating: "negotiation", not_interested: "lost", do_not_contact: "lost" } as Record<string, NodeId>)[s] ?? (s as NodeId));
        return moveLead({ id: l.id, name: l.businessName, from }, nodeOfStage(cmd.stage), { stage: cmd.stage, source: "voice" });
      }
      case "followup":
      case "demo": {
        const l = await resolve(cmd.name);
        if (!l || !ov) return;
        const at = parseWhen(cmd.when, ov.tz);
        if (!at) return say(`When should I schedule it? For example, "tomorrow at 4 PM".`);
        setCore(cmd.kind === "followup" ? "following_up" : "demo", 2600);
        const r = cmd.kind === "followup"
          ? await rapi("followups", "POST", { leadId: l.id, dueAt: at.toISOString(), source: "voice" })
          : await rapi("demos", "POST", { leadId: l.id, at: at.toISOString(), source: "voice" });
        if (!r.ok) return say(r.error ?? "Couldn't schedule that.");
        const tgt = chart.current?.nodeCenter(cmd.kind === "followup" ? "follow_up" : "demo"), e = engine.current;
        if (tgt && e) e.emit(e.center(), tgt, { hue: 214, done: () => lightUp([cmd.kind === "followup" ? "follow_up" : "demo"]) });
        await refresh();
        return say(`${cmd.kind === "followup" ? "Follow-up" : "Demo"} with ${l.businessName} scheduled for ${when(at, ov.tz)}.`);
      }
      case "complete_followup": {
        const l = await resolve(cmd.name);
        if (!l) return;
        const fu = await rapi<{ overdue: { id: string; lead: { id: string } }[]; today: { id: string; lead: { id: string } }[]; upcoming: { id: string; lead: { id: string } }[] }>("followups");
        const f = [...(fu.data?.overdue ?? []), ...(fu.data?.today ?? []), ...(fu.data?.upcoming ?? [])].find((x) => x.lead.id === l.id);
        if (!f) return say(`${l.businessName} has no pending follow-up.`);
        const r = await rapi(`followups/${f.id}`, "PATCH", { action: "complete", source: "voice" });
        if (!r.ok) return say(r.error ?? "Couldn't complete it.");
        await refresh();
        setConfirm({ q: "Schedule the next follow-up?", run: async () => { setLeadId(l.id); setLeadSheet({ sheet: "followup", at: Date.now() }); } });
        return say("Follow-up completed. Would you like to schedule the next one?");
      }
      default: {
        // Robin's AI brain (JARVIS's AI router) with what's on screen as context
        setCore("analyzing", 4000);
        const ctx = leadId && names.current.get(leadId) ? `\n\n[On screen: the lead ${names.current.get(leadId)} is open.]` : "";
        void agent.send((text + ctx).slice(0, 7800), { agent: "robin" });
      }
    }
  }, [agent, confirm, deactivate, leadId, lightUp, moveLead, openView, ov, refresh, resolve, say, setCore, signaturePulse]);
  handleRef.current = (t) => { void handle(t); };

  const topIds = useMemo(() => {
    if (!ov) return new Set<string>();
    const all = ov.nodes.filter((n) => n.id !== "won" && n.id !== "lost").flatMap((n) => n.leads);
    return new Set(all.sort((a, b) => b.attention - a.attention).slice(0, 3).filter((l) => l.attention > 60).map((l) => l.id));
  }, [ov]);
  const vState = voice.status === "speaking" ? "ROBIN SPEAKING" : agent.streaming ? "THINKING" : voice.status === "recording" ? "LISTENING" : null;
  const coreLabel = vState === "LISTENING" ? CORE_LABEL.listening : core === "idle" ? "MONITORING PIPELINE" : CORE_LABEL[core];
  const show = (d: number, from: "up" | "down" | "left" | "right" = "up"): React.CSSProperties => ({
    opacity: booted ? 1 : 0, transform: booted ? "none" : { up: "translateY(-18px)", down: "translateY(26px)", left: "translateX(-36px)", right: "translateX(36px)" }[from],
    filter: booted ? "none" : "blur(6px)", transition: "opacity .7s ease, transform .9s cubic-bezier(.2,.8,.2,1), filter .7s ease", transitionDelay: booted ? `${d}ms` : "0ms",
  });
  const c = ov?.counts;

  return (
    <div className={cn("robin-bg relative min-h-[calc(100dvh-4rem)] w-full overflow-hidden text-slate-100 transition-opacity duration-700", leaving && "opacity-0")}>
      <div className="robin-grid pointer-events-none absolute inset-0" />
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className={cn("relative z-10 flex min-h-[calc(100dvh-4rem)] flex-col lg:h-[calc(100dvh-4rem)]", (leadId || panel) && "robin-back", !(leadId || panel) && "robin-front")}>
        {/* ---- top strip */}
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:px-6" style={show(0, "up")}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-[0.35em] text-white">ROBIN</span>
            <span className="flex items-center gap-1 text-[10px] tracking-[0.18em] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" />{loadErr ? "OFFLINE" : "ONLINE"}</span>
          </div>
          <nav className="robin-scroll -mx-1 flex flex-1 items-center gap-5 overflow-x-auto px-1 text-[9.5px] tracking-[0.2em] text-slate-400 lg:justify-center">
            {([["TOTAL LEADS", c?.total], ["QUALIFIED", c?.qualified], ["FOLLOW-UPS", c?.followUpsDue], ["DEMOS", c?.demos], ["QUOTATIONS", c?.quotations], ["WON", c?.won]] as const).map(([k, v]) => (
              <span key={k} className="flex shrink-0 items-baseline gap-1.5">{k}<Count value={v ?? 0} className="text-[13px] font-semibold tracking-normal text-slate-100" /></span>
            ))}
            <span className="flex shrink-0 items-baseline gap-1.5">PIPELINE VALUE<Money value={c?.pipelineValue ?? 0} currency={ov?.currency ?? "INR"} className="text-[13px] font-semibold tracking-normal text-cyan-100" /></span>
          </nav>
          <div className="flex items-center gap-1">
            {([[CalendarClock, "Follow-ups", "followups"], [Presentation, "Demos", "demos"], [FileText, "Quotations", "quotations"], [Crown, "Clients", "clients"], [BarChart3, "Analytics", "analytics"], [UserPlus, "Add lead", "add"], [Settings2, "Settings", "settings"]] as const).map(([Icon, label, k]) => (
              <button key={k} type="button" title={label} aria-label={label} onClick={() => setPanel({ kind: k } as Panel)} className="robin-btn rounded-full border border-transparent p-2 text-slate-300 hover:text-white"><Icon className="h-4 w-4" /></button>
            ))}
            <button type="button" title="Close Robin" aria-label="Close Robin" onClick={deactivate} className="robin-btn ml-1 rounded-full border border-white/10 p-2 text-slate-300 hover:text-white"><LogOut className="h-4 w-4" /></button>
          </div>
        </header>

        {/* ---- core + side panels */}
        <div className="relative flex min-h-[230px] flex-1 items-stretch">
          {/* left: the DARWIN → ROBIN → CRM connection */}
          <div className="hidden w-32 shrink-0 flex-col justify-center pl-5 md:flex" style={show(500, "left")}>
            <div className="relative flex h-[min(40vh,300px)] flex-col justify-between">
              <div className="absolute bottom-2 left-[3px] top-2 w-px bg-gradient-to-b from-slate-400/30 via-cyan-300/50 to-cyan-300/10">
                {!reducedMotion() && [0, 1, 2].map((i) => <span key={i} className="robin-flow absolute -left-[2px] h-[5px] w-[5px] rounded-full bg-cyan-200 shadow-[0_0_8px_#a5f3fc]" style={{ animationDelay: `${i * 1.05}s` }} />)}
              </div>
              {([["DARWIN", "LEAD DISCOVERY", ov ? `${ov.darwin.total} received${ov.darwin.today ? ` · ${ov.darwin.today} today` : ""}` : ""], ["ROBIN", "QUALIFICATION", ov ? `${ov.counts.qualified} qualified` : ""], ["CRM", "SALES PIPELINE", ov ? `${ov.counts.total} in pipeline` : ""]] as const).map(([k, sub2, n], i) => (
                <div key={k} ref={i === 0 ? darwinRef : undefined} className="relative flex items-start gap-2.5">
                  <span className={cn("mt-1 h-[7px] w-[7px] shrink-0 rounded-full border", i === 1 ? "border-cyan-200 bg-cyan-300/60 shadow-[0_0_10px_#67e8f9]" : "border-slate-400/60 bg-slate-900")} />
                  <span className="leading-tight">
                    <span className={cn("block text-[10px] font-semibold tracking-[0.24em]", i === 1 ? "text-cyan-100" : "text-slate-200")}>{k}</span>
                    <span className="block text-[8.5px] tracking-[0.18em] text-slate-500">{sub2}</span>
                    <span className="block text-[9.5px] text-slate-400">{n}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* center: the holographic core */}
          <div className="relative flex flex-1 flex-col items-center justify-center">
            <div ref={anchorRef} className="relative flex h-[min(38vh,330px)] w-full max-w-[520px] flex-col items-center justify-center">
              <div className="text-center" style={show(200)}>
                <p className="text-3xl font-light tracking-[0.32em] text-white sm:text-[40px]" style={{ textShadow: "0 0 24px rgba(103,232,249,0.45)" }}>ROBIN</p>
                <p className="mt-1 text-[10px] tracking-[0.4em] text-slate-300">SALES INTELLIGENCE</p>
                <p className="mt-1.5 flex items-center justify-center gap-1 text-[10px] tracking-[0.2em] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />ONLINE</p>
              </div>
            </div>
            <p className="-mt-2 text-[10px] tracking-[0.32em] text-cyan-200/80" style={show(400)} aria-live="polite">{coreLabel}</p>
          </div>

          {/* right: ROBIN INTELLIGENCE */}
          <aside className="robin-glass robin-scroll absolute bottom-3 right-3 top-3 hidden w-60 overflow-y-auto rounded-2xl p-3.5 lg:block xl:w-64" style={show(600, "right")}>
            <p className="text-[10px] tracking-[0.28em] text-slate-200">ROBIN INTELLIGENCE</p>
            <div className="mt-3 space-y-3 text-[11px]">
              <div><p className="text-[9px] tracking-[0.22em] text-slate-500">CURRENT ACTIVITY</p><p className="mt-0.5 tracking-[0.06em] text-slate-100">{coreLabel}</p></div>
              <div>
                <p className="text-[9px] tracking-[0.22em] text-slate-500">NEXT ACTION</p>
                {ov?.next ? (
                  <button type="button" onClick={() => setLeadId(ov.next!.leadId)} className="mt-0.5 text-left hover:text-cyan-100">
                    <span className="block font-medium text-slate-100">{ov.next.name}</span>
                    <span className="block text-slate-400">{ov.next.text}</span>
                    <span className="block text-[10px] text-slate-500">because {ov.next.why}</span>
                  </button>
                ) : <p className="mt-0.5 text-slate-500">{ov?.counts.total ? "Nothing pressing." : "Waiting for Darwin's leads."}</p>}
              </div>
              <button type="button" onClick={() => setPanel({ kind: "leads", ...FILTER_QUERY.hottest })} className="flex w-full items-center justify-between border-t border-white/[0.06] pt-2.5 text-left">
                <span><span className="block text-[9px] tracking-[0.22em] text-slate-500">PRIORITY QUEUE</span><span className="text-slate-200">{ov?.attentionCount ?? 0} lead{ov?.attentionCount === 1 ? " requires" : "s require"} attention</span></span>
                <span className="text-slate-400">›</span>
              </button>
              <div className="border-t border-white/[0.06] pt-2.5">
                <p className="text-[9px] tracking-[0.22em] text-slate-500">TODAY</p>
                {([["follow-ups", ov?.today.followUps, "followups"], ["overdue", ov?.today.overdue, "followups"], ["demos", ov?.today.demos, "demos"], ["quotations awaiting", ov?.today.quotations, "quotations"], ["high-priority, not contacted", ov?.today.highPriority, null]] as const).map(([k, v, p]) => (
                  <button key={k} type="button" disabled={!p} onClick={() => p && setPanel({ kind: p } as Panel)} className="flex w-full items-center justify-between py-0.5 text-left text-slate-300 enabled:hover:text-white">
                    <span className="flex items-center gap-1.5"><span className={cn("h-1 w-1 rounded-full", k === "overdue" && v ? "bg-amber-300" : "bg-cyan-300/70")} />{k}</span>
                    <span className="rounded-full bg-white/[0.06] px-1.5 text-[10px] text-slate-200">{v ?? 0}</span>
                  </button>
                ))}
              </div>
              {!!ov?.notifications.length && (
                <div className="border-t border-white/[0.06] pt-2.5">
                  <p className="flex items-center gap-1 text-[9px] tracking-[0.22em] text-slate-500"><Bell className="h-3 w-3" />NOTIFICATIONS</p>
                  {ov.notifications.slice(0, 3).map((n) => <p key={n.id} className="mt-1 text-[10.5px] text-slate-300">{n.title}{n.body ? <span className="block truncate text-[10px] text-slate-500">{n.body}</span> : null}</p>)}
                  <button type="button" className="mt-1 text-[10px] text-slate-500 hover:text-slate-300" onClick={async () => { await rapi("notifications", "POST", {}); await refresh(); }}>Mark read</button>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* ---- the CRM pipeline chart */}
        <section className="robin-glass relative z-10 mx-2 rounded-2xl px-2 pb-2 pt-3 sm:mx-4" style={show(300, "down")}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-2">
            <p className="text-[10px] tracking-[0.28em] text-slate-300">CRM SALES PIPELINE CHART</p>
            <div className="flex rounded-full border border-white/10 p-0.5 text-[9.5px] tracking-[0.18em]" role="tablist" aria-label="Chart mode">
              {(["pipeline", "funnel", "revenue"] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded-full px-3 py-1 transition-colors", mode === m ? "bg-cyan-300/15 text-cyan-100" : "text-slate-400 hover:text-slate-200")}>{m.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {ov ? (
            <PipelineChart
              ref={chart}
              nodes={ov.nodes} funnel={ov.funnel} revenueWon={ov.counts.revenueWon} currency={ov.currency} mode={mode}
              highlight={highlight} selectedLeadId={leadId} expanded={expanded} topIds={topIds}
              onExpand={(id) => { setExpanded(id); if (id) { const t = chart.current?.nodeCenter(id), e = engine.current; if (t && e) e.emit(e.center(), t, { size: 1.8 }); } }}
              onOpenLead={(id) => setLeadId(id)}
              onMove={(lead: LeadCard, to) => void moveLead({ id: lead.id, name: lead.name, from: (prevMap.current?.get(lead.id) ?? "new") as NodeId }, to)}
              empty={ov.counts.total === 0}
              onImport={async () => { setCore("qualifying", 3000); const r = await rapi<{ imported: number }>("import", "POST", {}); await refresh(); say(r.data?.imported ? `${r.data.imported} lead${r.data.imported === 1 ? "" : "s"} received from Darwin.` : "Darwin has no new leads right now."); }}
            />
          ) : (
            <div className="flex h-[300px] items-center justify-center text-xs text-slate-400">{loadErr ?? <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}</div>
          )}
        </section>

        {/* ---- live activity + ASK ROBIN */}
        <footer className="relative z-10 grid items-center gap-2 px-4 py-3 sm:px-6 lg:grid-cols-[1fr_auto_1fr]" style={show(700, "down")}>
          <div className="robin-scroll order-2 flex min-w-0 items-center gap-5 overflow-x-auto text-[10.5px] text-slate-400 lg:order-1" aria-label="Live activity">
            {feed.length ? feed.slice(-4).map((f) => (
              <span key={f.id} className={cn("flex shrink-0 items-center gap-2", f.fresh && "robin-feed-in")}>
                <span className="text-slate-500">{new Date(f.at).toLocaleTimeString("en-IN", { timeZone: ov?.tz, hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                <span className="h-px w-4 bg-slate-600" />
                <span className="max-w-[260px] truncate text-slate-300">{f.text}</span>
              </span>
            )) : <span className="text-slate-600">Live activity appears here as it happens.</span>}
          </div>
          <form className="order-1 flex flex-col items-center gap-1.5 lg:order-2" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); void handle(t); }}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => (voiceStarted ? voice.toggleMute() : void enableVoice())} className={cn("robin-btn flex items-center gap-2 whitespace-nowrap rounded-full border px-5 py-2 text-[11px] tracking-[0.3em]", voiceStarted && !voice.muted ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-50" : "border-white/15 bg-white/[0.03] text-slate-200")} aria-label={voiceStarted && !voice.muted ? "Mute Robin's microphone" : "Ask Robin by voice"}>
                {voiceStarted && !voice.muted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                {vState === "LISTENING" ? <span className="robin-wave flex h-3 items-end gap-[2px]">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="w-[2px] bg-cyan-200" style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 0.12}s` }} />)}</span> : null}
                {vState ?? "ASK ROBIN"}
              </button>
              <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] pl-3 pr-1">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type to Robin…" className="w-40 bg-transparent py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 sm:w-56" aria-label="Message Robin" />
                <button type="submit" aria-label="Send" className="p-1.5 text-cyan-200 hover:text-white">{agent.streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</button>
              </div>
            </div>
            {(reply || voice.transcript) && <p className="max-w-[640px] text-center text-[11.5px] leading-snug text-slate-300">{voice.transcript ? <span className="text-cyan-200">“{voice.transcript}”</span> : <><span className="font-semibold tracking-[0.15em] text-cyan-300">ROBIN</span> {reply}</>}</p>}
          </form>
          <div className="order-3 hidden lg:block" />
        </footer>
      </div>

      {/* ---- overlays */}
      {toast && <div key={toast.id} className="robin-toast robin-glass fixed left-1/2 top-14 z-[90] -translate-x-1/2 rounded-full px-4 py-2 text-xs text-cyan-50">{toast.text}</div>}
      {confirm && (
        <div className="fixed inset-x-0 bottom-24 z-[95] mx-auto w-[min(92%,420px)] robin-in">
          <div className="robin-glass rounded-2xl p-4 text-center">
            <p className="text-sm text-slate-100">{confirm.q}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => { setConfirm(null); say("Okay — nothing changed."); }} className="robin-btn rounded-full border border-white/10 px-4 py-1 text-[11px] text-slate-300">No</button>
              <button type="button" onClick={async () => { const c = confirm; setConfirm(null); await c.run(); }} className="robin-btn rounded-full border border-cyan-300/50 bg-cyan-300/15 px-4 py-1 text-[11px] text-cyan-50">Yes, confirm</button>
            </div>
          </div>
        </div>
      )}
      {leadId && ov && (
        <LeadPanel
          leadId={leadId} tz={ov.tz} onClose={() => setLeadId(null)} ask={ask} say={say} externalSheet={leadSheet}
          onChanged={(e) => {
            if (e?.moved) { chart.current?.travel(e.moved.name, (prevMap.current?.get(leadId) ?? "new") as NodeId, ({ demo_scheduled: "demo", demo_completed: "demo", quotation_sent: "quotation", negotiating: "negotiation", not_interested: "lost", do_not_contact: "lost" } as Record<string, NodeId>)[e.moved.to] ?? (e.moved.to as NodeId)); }
            if (e?.kind) setCore(e.kind === "followup" ? "following_up" : e.kind === "demo" ? "demo" : e.kind === "quotation" ? "quotation" : e.kind === "won" ? "complete" : "contacting");
            if (e?.kind === "won") engine.current?.ripple(158, 3.4, 2);
            void refresh();
          }}
        />
      )}
      {panel?.kind === "followups" && ov && <FollowUpsPanel tz={ov.tz} onOpenLead={(id) => { setPanel(null); setLeadId(id); }} onChanged={() => void refresh()} say={say} onClose={() => setPanel(null)} />}
      {panel?.kind === "demos" && ov && <DemosPanel tz={ov.tz} onOpenLead={(id) => { setPanel(null); setLeadId(id); }} onChanged={() => void refresh()} say={say} onClose={() => setPanel(null)} />}
      {panel?.kind === "quotations" && <QuotationsPanel onOpenLead={(id) => { setPanel(null); setLeadId(id); }} onClose={() => setPanel(null)} />}
      {panel?.kind === "clients" && <ClientsPanel onOpenLead={(id) => { setPanel(null); setLeadId(id); }} onClose={() => setPanel(null)} say={say} />}
      {panel?.kind === "analytics" && <AnalyticsPanel onClose={() => setPanel(null)} />}
      {panel?.kind === "settings" && <SettingsPanel onClose={() => setPanel(null)} say={say} onSaved={() => void refresh()} />}
      {panel?.kind === "add" && <AddLeadPanel onClose={() => setPanel(null)} say={say} onCreated={(id, dup) => { setPanel(null); void refresh(); setLeadId(id); say(dup ? "That business is already in your CRM — opening it." : "Lead added and qualified."); }} />}
      {panel?.kind === "leads" && ov && <LeadsPanel title={panel.title} query={panel.query} currency={ov.currency} onOpenLead={(id) => { setPanel(null); setLeadId(id); }} onClose={() => setPanel(null)} />}

      {/* boot titles while the core powers up */}
      {!booted && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[18vh] z-20 text-center">
          <p className="robin-typein mx-auto w-max overflow-hidden whitespace-nowrap text-[10px] tracking-[0.5em] text-cyan-200/80">INITIALIZING SALES INTELLIGENCE · CONNECTING CRM</p>
        </div>
      )}
    </div>
  );
}
