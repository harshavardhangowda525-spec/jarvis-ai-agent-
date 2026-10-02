"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mic, MicOff, Loader2, LogOut, CalendarClock, Presentation, FileText, Crown, BarChart3, Settings2, UserPlus, Send, Filter, TrendingUp, ChevronDown, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/activity/client";
import { useVoice, useResumeVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import type { Overview, LeadCard } from "@/lib/robin/overview";
import { CORE_LABEL, STAGE_LABEL, nodeOf, nodeStage, money, type CoreState, type NodeId, type Stage } from "@/lib/robin/types";
import { parseRobinCommand, parseWhen, type View, type LeadFilter } from "@/lib/robin/command";
import { followUpBreakdown, spokenLead, type FollowUpQueueLike } from "@/lib/robin/numbers";
import { RobinCoreEngine } from "./core-engine";
import { ARC, OrbitPipeline, arcLayout, type ArcGeo, type OrbitHandle } from "./orbit-pipeline";
import { StagePanel } from "./stage-panel";
import { ActivityStream, StatPanel, type FeedItem, type Stat } from "./hud";
import { InsightsOverlay, type InsightMode } from "./insights";
import { LeadPanel } from "./lead-panel";
import { FollowUpsPanel, DemosPanel, QuotationsPanel, ClientsPanel, LeadsPanel, AnalyticsPanel, SettingsPanel, AddLeadPanel } from "./panels";
import { rapi, when } from "./api";
import { reducedMotion } from "./anim";

/**
 * RUBIN — the sales command center, built around one living holographic core.
 * The CRM orbits beneath it as an arc of eight stages; small glass panels either
 * side are wired into the core; live activity streams along the bottom. The
 * motion is what Rubin is actually doing. Everything on screen is the real CRM
 * (polled live); with no data it shows elegant empty states, never placeholders.
 */

type Panel =
  | { kind: "followups" } | { kind: "demos" } | { kind: "quotations" } | { kind: "clients" } | { kind: "analytics" } | { kind: "settings" } | { kind: "add" }
  | { kind: "leads"; title: string; query: string };
type Mode = "wide" | "mid" | "compact";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const deg = (d: number) => (d * Math.PI) / 180;

/** Where the core and the arc go for a given stage size (px). */
function layoutFor(w: number, h: number, mode: Mode): { R: number; core: { x: number; y: number }; geo: ArcGeo } {
  if (mode === "compact") {
    // phones: the arc scrolls sideways in its own band under the core
    return { R: clamp(w * 0.17, 50, 78), core: { x: w / 2, y: 0 }, geo: { w: 760, h: 262, cx: 380, cy: -58, rx: 318, ry: 262, a0: deg(150), a1: deg(30), r: 21 } };
  }
  const R = clamp(Math.min(h * 0.14, w * 0.095), 52, 132);
  const cx = w / 2, cy = Math.max(R * 1.9, h * 0.37);
  const r = clamp(w * 0.017, 19, 27);
  const ry = Math.max(R * 2.1, h - r - 50 - cy);
  const rx = Math.min(w * 0.34, 600);
  return { R, core: { x: cx, y: cy }, geo: { w, h, cx, cy, rx, ry, a0: deg(150), a1: deg(30), r } };
}

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
  const stageRef = useRef<HTMLDivElement>(null);
  const coreBoxRef = useRef<HTMLDivElement>(null);
  const statRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cmdInput = useRef<HTMLInputElement>(null);
  const engine = useRef<RobinCoreEngine | null>(null);
  const chart = useRef<OrbitHandle>(null);
  const [box, setBox] = useState({ w: 1280, h: 640, vw: 1280 });
  const mode: Mode = box.vw < 768 ? "compact" : box.w >= 1100 ? "wide" : "mid";
  const lay = useMemo(() => layoutFor(box.w, box.h, mode), [box.w, box.h, mode]);
  const layRef = useRef(lay); layRef.current = lay;
  const modeRef = useRef(mode); modeRef.current = mode;
  const placeRef = useRef<() => void>(() => {});

  const [ov, setOv] = useState<Overview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [insight, setInsight] = useState<InsightMode | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState<"left" | "right" | null>(null);
  const [core, setCoreState] = useState<CoreState>("idle");
  const [highlight, setHighlight] = useState<Partial<Record<NodeId, number>>>({});
  const [expanded, setExpanded] = useState<NodeId | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadSheet, setLeadSheet] = useState<{ sheet: "followup" | "demo" | "quote" | "next" | "convert" | null; at: number } | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [confirm, setConfirm] = useState<{ q: string; run: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
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
    const ids = targets ?? ARC;
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
      const l = layRef.current;
      if (modeRef.current === "compact") {
        const r = coreBoxRef.current?.getBoundingClientRect();
        if (r) e.setAnchor(r.left + r.width / 2, r.top + r.height / 2, l.R);
      } else {
        const r = stageRef.current?.getBoundingClientRect();
        if (r) e.setAnchor(r.left + l.core.x, r.top + l.core.y, l.R);
      }
    };
    placeRef.current = place;
    place();
    const measure = () => {
      const el = stageRef.current;
      if (el) setBox({ w: el.clientWidth, h: el.clientHeight, vw: window.innerWidth });
    };
    measure();
    const ro = new ResizeObserver(() => { measure(); place(); });
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const move = (ev: PointerEvent) => e.pointer(ev.clientX, ev.clientY);
    window.addEventListener("pointermove", move);
    e.start();
    e.boot(BOOT_MS);
    const t = setTimeout(() => setBooted(true), reducedMotion() ? 0 : BOOT_MS - 600);
    return () => { clearTimeout(t); ro.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.removeEventListener("pointermove", move); e.stop(); };
  }, []);
  // the core follows the layout; the side panels are wired into it
  useEffect(() => {
    placeRef.current();
    const e = engine.current;
    if (!e) return;
    const wire = () => e.setLinks(mode === "wide" ? statRefs.current.filter(Boolean).map((el, i) => {
      const r = el!.getBoundingClientRect();
      return { x: i < 4 ? r.right + 2 : r.left - 2, y: r.top + r.height / 2 };
    }) : []);
    const t = setTimeout(wire, 60);
    window.addEventListener("scroll", wire, true);
    return () => { clearTimeout(t); window.removeEventListener("scroll", wire, true); };
  }, [lay, mode, booted]);

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
    // never go silent: if the brain couldn't answer, say why
    onError: (msg) => { setCore("error", 1800); say(`Sorry, my brain didn't answer that one — ${msg.charAt(0).toLowerCase()}${msg.slice(1).replace(/\.$/, "")}. Quick commands like "what's my day?" still work.`); },
    onNavigate: (p) => {
      const m = p.match(/^\/dashboard\/rubin\?(.*)$/);
      const sp = m ? new URLSearchParams(m[1]) : null;
      if (sp?.get("lead")) { setLeadId(sp.get("lead")); return; }
      if (sp?.get("view")) { openView(sp.get("view") as View); return; }
      if (!p.startsWith("/dashboard/rubin")) router.push(p);
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
        const d = chart.current?.intakePoint();
        if (d && engine.current) engine.current.intake(d, Math.min(10, 3 + added.length));
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
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("RUBIN", { body: rem.text }); } catch { /* ignore */ }
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
    logActivity({ category: "agent", agent: "RUBIN", action: "RUBIN online", importance: 1 });
    void rapi("voice", "POST", { action: "ensure" }); // Rubin designs its own voice once (ElevenLabs)
    say("Hey! Rubin's online — ready to manage your sales pipeline. What are we working on?");
    const cmd = params.get("cmd"), lead = params.get("lead"), view = params.get("view");
    if (lead) setLeadId(lead);
    else if (view) openView(view as View);
    setTimeout(async () => {
      signaturePulse();
      if (cmd) { handleRef.current(cmd); return; }
      const m = await rapi<{ due: boolean; text: string | null }>("briefing?morning=1");
      if (m.data?.due && m.data.text) setTimeout(() => say(m.data!.text!), 2600);
    }, 900);
    if (cmd || lead || view) router.replace("/dashboard/rubin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, ov]);

  // ---- views / actions
  const openView = useCallback((v: View, filter?: LeadFilter) => {
    if (v === "funnel" || v === "revenue") { setInsight(v); setPanel(null); return; }
    if (v === "pipeline") { setInsight(null); setPanel(null); return; }
    setPanel({ kind: v } as Panel);
    void filter;
  }, []);
  const ask = useCallback((q: string, run: () => Promise<void>) => { setConfirm({ q, run }); say(q); }, [say]);
  /** The last stage move, so "undo" can put it back. */
  const lastMove = useRef<{ id: string; name: string; fromStage: string; fromNode: NodeId; toNode: NodeId } | null>(null);
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];

  /** Lead → client. With no accepted quotation or value yet, it opens the lead and asks for the deal amount. */
  const convertLead = useCallback(async (id: string, name: string) => {
    setCore("complete", 2200);
    const r = await rapi("clients", "POST", { leadId: id, confirm: true });
    await refresh();
    if (r.ok) { engine.current?.ripple(158, 3.4, 2); say(`Done — ${name} is officially a client. Nice work!`); return; }
    if (/amount/i.test(r.error ?? "")) {
      setLeadId(id); setLeadSheet({ sheet: "convert", at: Date.now() });
      say(`Sure — what's the deal with ${name} worth? Pop the amount in and I'll make them a client.`);
      return;
    }
    say(r.error ?? "Couldn't convert them.");
  }, [refresh, say, setCore]);

  const moveLead = useCallback(async (lead: { id: string; name: string; from: NodeId }, to: NodeId, opts: { confirmed?: boolean; source?: "user" | "voice"; stage?: Stage } = {}) => {
    const stage = opts.stage ?? nodeStage(to);
    setCmdOpen(false);
    // your command is the approval — it happens straight away ("undo" puts it back)
    // the card travels right away; the database is updated at the same time
    chart.current?.travel(lead.name, lead.from, to);
    prevMap.current?.set(lead.id, to);
    setCore(to === "won" ? "complete" : to === "lost" ? "idle" : "contacting", 1800);
    const r = await rapi<{ moved: { changed: boolean; from: string } | null }>(`leads/${lead.id}`, "PATCH", { stage, confirm: true, source: opts.source ?? "user" });
    if (!r.ok) { say(r.error ?? "Hmm, that move didn't save — try again?"); prevMap.current?.set(lead.id, lead.from); setCore("error", 1500); }
    else {
      lightUp([to]);
      if (r.data?.moved?.changed) lastMove.current = { id: lead.id, name: lead.name, fromStage: r.data.moved.from, fromNode: lead.from, toNode: to };
      if (to === "won") {
        engine.current?.ripple(158, 3.4, 2);
        ask(`Nice one — ${lead.name} is won! Want me to make them a client?`, () => convertLead(lead.id, lead.name));
      } else if (to === "lost") say(`${pick(["Done", "Okay"])} — ${lead.name} moved to ${STAGE_LABEL[stage]}. Can't win them all. Say "undo" if that was a mistake.`);
      else say(`${pick(["Done", "Got it", "Sorted"])} — ${lead.name} is now ${STAGE_LABEL[stage]}.`);
    }
    await refresh();
  }, [ask, convertLead, lightUp, refresh, say, setCore]);

  /** Find the lead a command is about: "this lead" = the open one; a name must match exactly one. */
  /** The lead you talked about last ("note: …" with no lead named goes on it). */
  const lastLead = useRef<{ id: string; number: number | null; businessName: string; stage: string } | null>(null);
  const resolve = useCallback(async (name: string | null, o: { orLast?: boolean } = {}): Promise<{ id: string; number: number | null; businessName: string; stage: string } | null> => {
    type L = { id: string; number: number | null; businessName: string; stage: string };
    if (!name) {
      if (!leadId) {
        if (o.orLast && lastLead.current) return lastLead.current;
        say("Which lead do you mean? Tell me its number or name — like \"lead 7\"."); return null;
      }
      const r = await rapi<{ lead: L }>(`leads/${leadId}`);
      if (r.data?.lead) lastLead.current = r.data.lead;
      return r.data?.lead ?? null;
    }
    const r = await rapi<{ leads: L[] }>(`leads?resolve=${encodeURIComponent(name)}`);
    const hits = r.data?.leads ?? [];
    if (!hits.length) { say(/^\D*\d+\s*$/.test(name) ? `There's no ${name.replace(/^#/, "lead ")} in your CRM.` : `Hmm, I can't find "${name}" in your CRM.`); return null; }
    if (hits.length > 1) { say(`A few match that — ${hits.slice(0, 4).map((h) => spokenLead(h)).join("; ")}. Which one? You can just say the number.`); setPanel({ kind: "leads", title: `MATCHES FOR "${name.toUpperCase()}"`, query: `q=${encodeURIComponent(name)}` }); return null; }
    lastLead.current = hits[0];
    return hits[0];
  }, [leadId, say]);

  /** Rubin asked for a note ("any notes for it?") — the next thing you say that isn't a command is the note. */
  const pendingNote = useRef<{ followUpId: string; label: string; until: number; then?: () => void } | null>(null);
  const askNote = useCallback((followUpId: string, label: string, question: string, then?: () => void) => {
    pendingNote.current = { followUpId, label, until: Date.now() + 3 * 60_000, then };
    say(question);
  }, [say]);

  const importDarwin = useCallback(async () => {
    setCore("qualifying", 3000);
    const r = await rapi<{ imported: number }>("import", "POST", {});
    await refresh();
    say(r.data?.imported ? `${r.data.imported} lead${r.data.imported === 1 ? "" : "s"} received from Darwin.` : "Darwin has no new leads right now.");
  }, [refresh, say, setCore]);

  const deactivate = useCallback(() => {
    setLeaving(true);
    say("Catch you later — back to JARVIS.");
    logActivity({ category: "agent", agent: "RUBIN", action: "Closed RUBIN", importance: 1 });
    setTimeout(() => router.push("/dashboard"), 900);
  }, [router, say]);

  const handle = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setReply(null);
    const cmd = parseRobinCommand(text);
    // the note Rubin just asked for
    const pn = pendingNote.current;
    if (pn && Date.now() < pn.until && (cmd.kind === "ask" || cmd.kind === "confirm" || (cmd.kind === "note" && !cmd.name))) {
      if (cmd.kind === "confirm" && !cmd.yes) { pendingNote.current = null; say("Okay, no note."); pn.then?.(); return; }
      if (cmd.kind === "confirm") { say("Go ahead — what's the note?"); return; }
      pendingNote.current = null;
      const note = cmd.kind === "note" ? cmd.text : text.replace(/^(?:note|notes)\s*[:,-]\s*/i, "");
      const r = await rapi(`followups/${pn.followUpId}`, "PATCH", { action: "note", notes: note, source: "voice" });
      if (!r.ok) return say(r.error ?? "I couldn't save that note.");
      void refresh();
      say(`Noted for ${pn.label}: ${note.replace(/[.!\s]+$/, "")}.`);
      pn.then?.();
      return;
    }
    if (pn) pendingNote.current = null; // you moved on to something else
    if (cmd.kind === "confirm") {
      if (confirm) { const c = confirm; setConfirm(null); if (cmd.yes) await c.run(); else say("No problem."); return; }
      if (!cmd.yes) { say("Okay."); return; }
    }
    switch (cmd.kind) {
      case "exit": return deactivate();
      case "chat": {
        const nudge = !ov ? "" : ov.today.overdue ? ` You've got ${ov.today.overdue} follow-up${ov.today.overdue === 1 ? "" : "s"} overdue — want to knock those out?`
          : ov.today.followUps ? ` ${ov.today.followUps} follow-up${ov.today.followUps === 1 ? "" : "s"} on today.`
            : ov.next ? ` Next up, I'd go for ${ov.next.name}.` : " What are we working on?";
        const lines = {
          hello: [`Hey!${nudge}`, `Hi there!${nudge}`, `Hey, good to see you!${nudge}`],
          how_are_you: [`Doing great — ready to close some deals!${nudge}`, `All good here, pipeline's humming.${nudge}`],
          thanks: ["Anytime!", "Happy to help!", "That's what I'm here for."],
          who: ["I'm Rubin, your sales buddy — I take Darwin's leads and help you turn them into clients. Try \"what's my day?\", \"show my hottest leads\" or \"schedule a follow-up with ABC Café tomorrow at 4\"."],
          bye: ["Catch you later! I'll keep an eye on the pipeline.", "See you! I'll be here."],
        }[cmd.topic];
        setCore(cmd.topic === "thanks" ? "complete" : "listening", 1200);
        return say(pick(lines));
      }
      case "undo": {
        const m = lastMove.current;
        if (!m) return say("There's nothing to undo right now.");
        lastMove.current = null;
        chart.current?.travel(m.name, m.toNode, m.fromNode);
        prevMap.current?.set(m.id, m.fromNode);
        const r = await rapi(`leads/${m.id}`, "PATCH", { stage: m.fromStage, confirm: true, source: "voice", note: "Undo" });
        await refresh();
        return say(r.ok ? `No worries — ${m.name} is back in ${STAGE_LABEL[m.fromStage as Stage] ?? m.fromStage}.` : r.error ?? "Couldn't undo that.");
      }
      case "convert": {
        const l = await resolve(cmd.name);
        if (!l) return;
        return convertLead(l.id, l.businessName);
      }
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
        signaturePulse([cmd.filter as NodeId].filter((x) => (ARC as string[]).includes(x) || x === "lost") as NodeId[]);
        // a pipeline stage ("show qualified leads") → that stage opens on the chart with EVERY lead in it
        const node = ov?.nodes.find((n) => n.id === cmd.filter);
        if (node) {
          setPanel(null); setInsight(null); setExpanded(node.id);
          return say(node.count ? `Here ${node.count === 1 ? "is" : "are"} all ${node.count} ${node.label.toLowerCase()} lead${node.count === 1 ? "" : "s"} — the ones that need you most are first.` : `No ${node.label.toLowerCase()} leads right now.`);
        }
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
        if (l) { setLeadId(l.id); say(`Here's ${spokenLead(l)}.`); }
        return;
      }
      case "followups": {
        // "how many follow-ups do we have?" → every one, with the note you told me
        setCore("following_up", 2400);
        const r = await rapi<FollowUpQueueLike>("followups");
        if (!r.ok || !r.data) return say(r.error ?? "I couldn't read the follow-ups.");
        setPanel({ kind: "followups" });
        return say(followUpBreakdown(r.data, { which: cmd.which }));
      }
      case "note": {
        const l = await resolve(cmd.name, { orLast: true });
        if (!l) return;
        const r = await rapi<{ on: "followup" | "lead"; followUp: { dueAt: string } | null }>(`leads/${l.id}/notes`, "POST", { text: cmd.text, source: "voice" });
        if (!r.ok || !r.data) return say(r.error ?? "I couldn't save that note.");
        void refresh();
        return say(r.data.on === "followup" && r.data.followUp && ov
          ? `Noted on the follow-up with ${spokenLead(l)} (${when(r.data.followUp.dueAt, ov.tz)}): ${cmd.text}.`
          : `Noted on ${spokenLead(l)}: ${cmd.text}. There's no follow-up scheduled for them yet.`);
      }
      case "move": {
        const l = await resolve(cmd.name);
        if (!l) return;
        const from = (prevMap.current?.get(l.id) ?? "new") as NodeId;
        return moveLead({ id: l.id, name: l.businessName, from }, nodeOf(cmd.stage), { stage: cmd.stage, source: "voice" });
      }
      case "followup":
      case "demo": {
        const l = await resolve(cmd.name);
        if (!l || !ov) return;
        const at = parseWhen(cmd.when, ov.tz);
        if (!at) return say(`When should I schedule it? For example, "tomorrow at 4 PM".`);
        setCore(cmd.kind === "followup" ? "following_up" : "demo", 2600);
        const note = cmd.kind === "followup" ? cmd.note : undefined;
        const r = cmd.kind === "followup"
          ? await rapi<{ id: string }>("followups", "POST", { leadId: l.id, dueAt: at.toISOString(), source: "voice", ...(note ? { notes: note } : {}) })
          : await rapi<{ id: string }>("demos", "POST", { leadId: l.id, at: at.toISOString(), source: "voice" });
        if (!r.ok) return say(r.error ?? "Couldn't schedule that.");
        const tgt = chart.current?.nodeCenter("follow_up"), e = engine.current;
        if (tgt && e) e.emit(e.center(), tgt, { hue: 214, done: () => lightUp(["follow_up"]) });
        await refresh();
        const done = `${pick(["Done", "You got it", "All set"])} — ${cmd.kind === "followup" ? "follow-up" : "demo"} with ${spokenLead(l)} on ${when(at, ov.tz)}.`;
        if (cmd.kind !== "followup") return say(done);
        if (note) return say(`${done} Noted: ${note}.`);
        // every follow-up gets its note — ask for it
        if (r.data?.id) return askNote(r.data.id, spokenLead(l), `${done} Any notes for it?`);
        return say(done);
      }
      case "complete_followup": {
        const l = await resolve(cmd.name);
        if (!l) return;
        const fu = await rapi<{ overdue: { id: string; lead: { id: string } }[]; today: { id: string; lead: { id: string } }[]; upcoming: { id: string; lead: { id: string } }[] }>("followups");
        const f = [...(fu.data?.overdue ?? []), ...(fu.data?.today ?? []), ...(fu.data?.upcoming ?? [])].find((x) => x.lead.id === l.id);
        if (!f) {
          // nothing scheduled — the note still goes on the lead
          if (!cmd.note) return say(`${spokenLead(l)} has no pending follow-up.`);
          const n = await rapi(`leads/${l.id}/notes`, "POST", { text: cmd.note, source: "voice" });
          return say(n.ok ? `${spokenLead(l)} had no follow-up scheduled, so I noted it on the lead: ${cmd.note}.` : n.error ?? "I couldn't save that note.");
        }
        const r = await rapi(`followups/${f.id}`, "PATCH", { action: "complete", source: "voice", ...(cmd.note ? { notes: cmd.note } : {}) });
        if (!r.ok) return say(r.error ?? "Couldn't complete it.");
        await refresh();
        const next = () => setConfirm({ q: "Schedule the next follow-up?", run: async () => { setLeadId(l.id); setLeadSheet({ sheet: "followup", at: Date.now() }); } });
        if (cmd.note) { next(); return say(`Nice, that's done — noted: ${cmd.note}. Want me to set up the next one?`); }
        // how did it go? → noted on this follow-up, then offer the next one
        return askNote(f.id, spokenLead(l), `Nice, follow-up with ${spokenLead(l)} done. How did it go — anything to note?`, () => { next(); setTimeout(() => say("Want me to set up the next follow-up?"), 50); });
      }
      default: {
        // Rubin's AI brain (JARVIS's AI router) with what's on screen as context
        setCore("analyzing", 4000);
        const ctx = leadId && names.current.get(leadId) ? `\n\n[On screen: the lead ${names.current.get(leadId)} is open.]` : "";
        void agent.send((text + ctx).slice(0, 7800), { agent: "robin" });
      }
    }
  }, [agent, askNote, confirm, convertLead, deactivate, leadId, lightUp, moveLead, openView, ov, refresh, resolve, say, setCore, signaturePulse]);
  handleRef.current = (t) => { void handle(t); };

  // the core shows what Rubin is doing: thinking (processing) → complete → idle; listening while you talk
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (agent.streaming) { wasStreaming.current = true; setCore("processing", 60_000); }
    else if (wasStreaming.current) { wasStreaming.current = false; setCore("complete", 1400); }
  }, [agent.streaming, setCore]);
  useEffect(() => {
    if (voice.status === "recording") setCore("listening", 15_000);
    else if (engine.current?.state === "listening") setCore("idle");
  }, [voice.status, setCore]);
  // Esc closes whatever is on top
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (insight) setInsight(null); else if (expanded) setExpanded(null); else if (statsOpen) setStatsOpen(null); else if (cmdOpen) setCmdOpen(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [insight, expanded, statsOpen, cmdOpen]);

  const openCommand = useCallback(() => {
    setCmdOpen(true);
    engine.current?.ripple(190, 1.6, 1.2);
    setTimeout(() => cmdInput.current?.focus(), 30);
  }, []);
  const focusNode = useMemo<NodeId | null>(() => (ov?.next ? (ov.stageMap.find(([id]) => id === ov.next!.leadId)?.[1] ?? null) : null), [ov]);
  const vState = voice.status === "speaking" ? "RUBIN SPEAKING" : agent.streaming ? "THINKING" : voice.status === "recording" ? "LISTENING" : null;
  const coreLabel = vState === "LISTENING" ? CORE_LABEL.listening : vState === "THINKING" ? CORE_LABEL.processing : core === "idle" ? (vState ?? "MONITORING PIPELINE") : CORE_LABEL[core];
  const show = (d: number, from: "up" | "down" | "left" | "right" | "none" = "up"): React.CSSProperties => ({
    opacity: booted ? 1 : 0, transform: booted || from === "none" ? undefined : { up: "translateY(-18px)", down: "translateY(26px)", left: "translateX(-36px)", right: "translateX(36px)" }[from],
    filter: booted ? undefined : "blur(6px)", transition: "opacity .7s ease, transform .9s cubic-bezier(.2,.8,.2,1), filter .7s ease", transitionDelay: booted ? `${d}ms` : "0ms",
  });
  const c = ov?.counts;
  const d = ov?.dash;
  const expand = (id: NodeId) => { setPanel(null); setInsight(null); setStatsOpen(null); setExpanded(id); const t = chart.current?.nodeCenter(id), e = engine.current; if (t && e) e.emit(e.center(), t, { size: 1.8 }); };
  const pendingText = d ? [d.pending.overdue && `${d.pending.overdue} overdue`, d.pending.dueToday && `${d.pending.dueToday} due today`, d.pending.demosToday && `${d.pending.demosToday} demo${d.pending.demosToday === 1 ? "" : "s"}`, d.pending.drafts && `${d.pending.drafts} draft quote${d.pending.drafts === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : "";
  const left: Stat[] = [
    { key: "qualified", label: "QUALIFIED LEADS", value: c?.qualified ?? null, trend: d?.qualifiedToday ? "up" : undefined, sub: d ? (d.qualifiedToday ? `+${d.qualifiedToday} today` : "none new today") : undefined, title: "Show every qualified lead", onClick: () => expand("qualified") },
    { key: "fu", label: "FOLLOW-UPS TODAY", value: ov?.today.followUps ?? null, tone: ov?.today.overdue ? "warn" : undefined, sub: ov ? (ov.today.overdue ? `${ov.today.overdue} overdue` : "none overdue") : undefined, title: "Open today's follow-ups", onClick: () => setPanel({ kind: "followups" }) },
    { key: "proposals", label: "PROPOSALS", value: d?.proposals ?? null, sub: ov ? (c?.quotations ? `${c.quotations} awaiting a reply` : "none awaiting a reply") : undefined, title: "Show leads with a proposal out", onClick: () => expand("proposal") },
    { key: "active", label: "ACTIVE CONVERSATIONS", value: d?.activeConversations ?? null, sub: "talked to in the last 14 days", title: "Show the leads you're in conversation with", onClick: () => setPanel({ kind: "leads", title: "ACTIVE CONVERSATIONS", query: "active=1" }) },
  ];
  const right: Stat[] = [
    { key: "conv", label: "CONVERSION RATE", value: d?.conversion.value ?? null, suffix: "%", decimals: d?.conversion.value != null && d.conversion.value % 1 ? 1 : 0, sub: d ? `${d.conversion.won} won of ${d.conversion.total} lead${d.conversion.total === 1 ? "" : "s"}` : undefined, title: "Open sales analytics", onClick: () => setPanel({ kind: "analytics" }) },
    { key: "fur", label: "FOLLOW-UP RATE", value: d?.followUpRate.value ?? null, suffix: "%", sub: d ? (d.followUpRate.due ? `${d.followUpRate.done} of ${d.followUpRate.due} done · 30 days` : "no follow-ups due yet") : undefined, title: "Open follow-ups", onClick: () => setPanel({ kind: "followups" }) },
    { key: "won", label: "WON LEADS", value: c?.won ?? null, tone: "won", sub: ov ? (c?.revenueWon ? `${money(c.revenueWon, ov.currency, true)} won` : "no revenue recorded yet") : undefined, title: "Show won leads", onClick: () => expand("won") },
    { key: "pending", label: "PENDING ACTIONS", value: d?.pending.total ?? null, tone: d?.pending.total ? "accent" : undefined, sub: d ? pendingText || "all clear" : undefined, title: "Open what needs doing", onClick: () => setPanel({ kind: d?.pending.overdue || d?.pending.dueToday ? "followups" : d?.pending.demosToday ? "demos" : "quotations" }) },
  ];
  const statW = box.w >= 1400 ? 200 : 178;
  const colTop = (n: number) => Math.max(8, lay.core.y - (n * 74) / 2);

  // ---- the stage panel sits right above its stage (a sheet on phones)
  const L = useMemo(() => arcLayout(lay.geo), [lay.geo]);
  const stageNode = expanded && ov ? ov.nodes.find((n) => n.id === expanded) : null;
  const panelStyle: React.CSSProperties | undefined = stageNode && mode !== "compact" ? (() => {
    const at = L.pos[stageNode.id];
    const w = Math.min(380, box.w - 16);
    return { position: "absolute", width: w, left: clamp(at.x - w / 2, 8, box.w - w - 8), bottom: box.h - (at.y - lay.geo.r - 16), maxHeight: clamp(at.y - lay.geo.r - 28, 200, 440), zIndex: 30 };
  })() : undefined;

  const orbit = ov && (
    <OrbitPipeline
      ref={chart} geo={lay.geo} nodes={ov.nodes} currency={ov.currency} highlight={highlight}
      expanded={expanded} focus={focusNode} selectedLeadId={leadId}
      onExpand={(id) => { if (id) expand(id); else setExpanded(null); }}
      onOpenLead={(id) => setLeadId(id)}
      onMove={(lead, to) => void moveLead({ id: lead.id, name: lead.name, from: (prevMap.current?.get(lead.id) ?? nodeOf(lead.stage)) as NodeId }, to)}
    />
  );
  const commandBar = (
    <div className="flex w-full flex-col items-center gap-2">
      {cmdOpen ? (
        <form className="robin-cmd robin-cmd-open flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); void handle(t); }}>
          <button type="button" onClick={() => (voiceStarted ? voice.toggleMute() : void enableVoice())} className={cn("robin-btn flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5", voiceStarted && !voice.muted ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-50" : "border-white/10 text-slate-300")} aria-label={voiceStarted && !voice.muted ? "Mute Rubin's microphone" : "Talk to Rubin"}>
            {voiceStarted && !voice.muted ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            {vState === "LISTENING" && <span className="robin-wave flex h-3 items-end gap-[2px]">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="w-[2px] bg-cyan-200" style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 0.12}s` }} />)}</span>}
          </button>
          <input ref={cmdInput} value={input} onChange={(e) => setInput(e.target.value)} placeholder={vState === "LISTENING" ? "Listening…" : "Tell Rubin what to do…"} aria-label="Command Rubin"
            className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-slate-50 outline-none placeholder:text-slate-500" />
          <button type="submit" aria-label="Send" className="shrink-0 rounded-lg p-1.5 text-cyan-200 hover:bg-cyan-300/10 hover:text-white">{agent.streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
        </form>
      ) : (
        <button type="button" onClick={openCommand} className="robin-cmd group flex items-center gap-2 rounded-xl px-4 py-2 text-[11px] tracking-[0.14em] text-cyan-50" aria-label="Open Rubin's command interface">
          <span className="text-cyan-200">COMMAND RUBIN:</span>
          <span className="text-slate-300">{vState === "LISTENING" ? "[Listening…]" : vState === "THINKING" ? "[Thinking…]" : vState === "RUBIN SPEAKING" ? "[Speaking…]" : "[Awaiting input…]"}</span>
          <span className="robin-caret h-3 w-[1.5px] bg-cyan-200/80" />
        </button>
      )}
      {(reply || voice.transcript) && (
        <p className="robin-reply max-w-[560px] text-center text-[11.5px] leading-snug text-slate-300" key={voice.transcript || reply || ""}>
          {voice.transcript ? <span className="text-cyan-200">“{voice.transcript}”</span> : <><span className="font-semibold tracking-[0.15em] text-cyan-300">RUBIN</span> {reply}</>}
        </p>
      )}
    </div>
  );
  const coreText = (size: "lg" | "sm") => (
    <>
      <span className={cn("block font-light tracking-[0.22em] text-white", size === "lg" ? "text-[clamp(22px,2.4vw,34px)]" : "text-2xl")} style={{ textShadow: "0 0 26px rgba(103,232,249,0.55)" }}>RUBIN</span>
      <span className="mt-0.5 block text-[10px] tracking-[0.18em] text-slate-300/80">AI Core</span>
    </>
  );
  const statColumn = (stats: Stat[], side: "left" | "right", offset: number) => stats.map((s, i) => (
    <StatPanel key={s.key} ref={(el) => { statRefs.current[offset + i] = el; }} stat={s} delay={500 + i * 90} style={{ ...show(500 + i * 90, side) }} />
  ));

  return (
    <div className={cn("robin-bg relative flex h-[calc(100dvh-4rem)] w-full flex-col overflow-hidden text-slate-100 transition-opacity duration-700", mode === "compact" && "overflow-y-auto", leaving && "opacity-0")}>
      <div className="robin-grid pointer-events-none absolute inset-0" />
      <div className="robin-noise pointer-events-none absolute inset-0" />
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className={cn("relative z-10 flex min-h-0 flex-1 flex-col", (leadId || panel || insight) && "robin-back", !(leadId || panel || insight) && "robin-front")}>
        {/* ---- a quiet top line */}
        <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 sm:px-6" style={show(0, "up")}>
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] font-semibold tracking-[0.42em] text-white">RUBIN</span>
            <span className={cn("flex items-center gap-1 text-[9.5px] tracking-[0.2em]", loadErr ? "text-amber-300" : "text-emerald-300")}><span className={cn("h-1.5 w-1.5 rounded-full", loadErr ? "bg-amber-300" : "bg-emerald-300 shadow-[0_0_8px_#6ee7b7]")} />{loadErr ? "OFFLINE" : "ONLINE"}</span>
            <span className="hidden text-[9.5px] tracking-[0.2em] text-slate-500 lg:inline">· INFINITY WEB &amp; APPS · SALES</span>
          </div>
          <div className="robin-scroll flex items-center gap-0.5 overflow-x-auto">
            {([[CalendarClock, "Follow-ups", "followups"], [Presentation, "Demos", "demos"], [FileText, "Quotations", "quotations"], [Crown, "Clients", "clients"], [BarChart3, "Analytics", "analytics"]] as const).map(([Icon, label, k]) => (
              <button key={k} type="button" title={label} aria-label={label} onClick={() => setPanel({ kind: k } as Panel)} className="robin-btn shrink-0 rounded-full border border-transparent p-2 text-slate-400 hover:text-white"><Icon className="h-4 w-4" /></button>
            ))}
            <button type="button" title="Funnel" aria-label="Funnel" onClick={() => setInsight("funnel")} className="robin-btn shrink-0 rounded-full border border-transparent p-2 text-slate-400 hover:text-white"><Filter className="h-4 w-4" /></button>
            <button type="button" title="Revenue" aria-label="Revenue" onClick={() => setInsight("revenue")} className="robin-btn shrink-0 rounded-full border border-transparent p-2 text-slate-400 hover:text-white"><TrendingUp className="h-4 w-4" /></button>
            <button type="button" title="Add lead" aria-label="Add lead" onClick={() => setPanel({ kind: "add" })} className="robin-btn shrink-0 rounded-full border border-transparent p-2 text-slate-400 hover:text-white"><UserPlus className="h-4 w-4" /></button>
            <button type="button" title="Settings" aria-label="Settings" onClick={() => setPanel({ kind: "settings" })} className="robin-btn shrink-0 rounded-full border border-transparent p-2 text-slate-400 hover:text-white"><Settings2 className="h-4 w-4" /></button>
            {!!ov?.notifications.length && (
              <button type="button" title={ov.notifications.map((n) => n.title).join("\n")} aria-label={`${ov.notifications.length} notifications — mark read`} onClick={async () => { await rapi("notifications", "POST", {}); await refresh(); }} className="robin-btn relative shrink-0 rounded-full border border-transparent p-2 text-slate-300 hover:text-white">
                <Bell className="h-4 w-4" /><span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_#67e8f9]" />
              </button>
            )}
            <button type="button" title="Close Rubin" aria-label="Close Rubin" onClick={deactivate} className="robin-btn ml-1 shrink-0 rounded-full border border-white/10 p-2 text-slate-300 hover:text-white"><LogOut className="h-4 w-4" /></button>
          </div>
        </header>

        {mode !== "compact" ? (
          /* ---------- desktop / laptop: one immersive stage ---------- */
          <main ref={stageRef} className="relative min-h-0 flex-1">
            {/* the core: state, name, and a click opens the command interface */}
            <button type="button" onClick={openCommand} aria-label="Open Rubin's command interface" className="robin-core-hit absolute rounded-full"
              style={{ left: lay.core.x - lay.R * 0.8, top: lay.core.y - lay.R * 0.8, width: lay.R * 1.6, height: lay.R * 1.6, ...show(200, "none") }}>
              <span className="flex h-full flex-col items-center justify-center text-center">{coreText("lg")}</span>
            </button>
            <p className="robin-state pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[10.5px] tracking-[0.3em] text-cyan-200/90" aria-live="polite"
              style={{ left: lay.core.x, top: lay.core.y - lay.R * 1.32 - 6, ...show(400, "none") }}>{coreLabel}</p>
            <div className="absolute -translate-x-1/2" style={{ left: lay.core.x, top: lay.core.y + lay.R * 1.62, width: Math.min(460, box.w - 32), ...show(450, "down") }}>{commandBar}</div>

            {/* side panels — floating glass wired into the core */}
            {mode === "wide" ? (
              <>
                <div className="absolute left-4 space-y-2.5 sm:left-6" style={{ top: colTop(4), width: statW }}>{statColumn(left, "left", 0)}</div>
                <div className="absolute right-4 space-y-2.5 sm:right-6" style={{ top: colTop(4), width: statW }}>{statColumn(right, "right", 4)}</div>
              </>
            ) : (
              <>
                {(["left", "right"] as const).map((side) => (
                  <div key={side} className={cn("absolute top-2 z-20", side === "left" ? "left-3" : "right-3")} style={{ width: 186, ...show(500, side) }}>
                    <button type="button" onClick={() => setStatsOpen(statsOpen === side ? null : side)} aria-expanded={statsOpen === side} className="robin-cmd flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-[9.5px] tracking-[0.22em] text-slate-200">
                      {side === "left" ? "PIPELINE" : "PERFORMANCE"}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", statsOpen === side && "rotate-180")} />
                    </button>
                    {statsOpen === side && <div className="robin-expand mt-2 space-y-2">{(side === "left" ? left : right).map((s) => <StatPanel key={s.key} stat={s} />)}</div>}
                  </div>
                ))}
              </>
            )}

            {/* the CRM orbit */}
            <div className="pointer-events-none absolute inset-0" style={show(300, "none")}>{orbit}</div>
            {stageNode && ov && (
              <StagePanel node={stageNode} currency={ov.currency} tz={ov.tz} style={panelStyle}
                onClose={() => setExpanded(null)} onOpenLead={(id) => setLeadId(id)}
                onFollowUp={(id) => { setLeadId(id); setLeadSheet({ sheet: "followup", at: Date.now() }); }}
                onMove={(lead, to) => void moveLead({ id: lead.id, name: lead.name, from: nodeOf(lead.stage) }, to)}
                beginDrag={(e, lead, from) => chart.current?.beginDrag(e, lead, from)} />
            )}
            {!ov && <div className="absolute inset-x-0 bottom-[18%] flex justify-center text-xs text-slate-400">{loadErr ?? <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />}</div>}
            {ov && c?.total === 0 && <EmptyPipeline onImport={importDarwin} style={{ top: lay.geo.cy + lay.geo.ry * 0.55 }} />}
          </main>
        ) : (
          /* ---------- phones: the core stays centred; the CRM scrolls beneath it ---------- */
          <main ref={stageRef} className="relative flex flex-1 flex-col">
            <div ref={coreBoxRef} className="relative mx-auto flex w-full items-center justify-center" style={{ height: clamp(box.w * 0.92, 290, 380) }}>
              <button type="button" onClick={openCommand} aria-label="Open Rubin's command interface" className="robin-core-hit flex flex-col items-center justify-center rounded-full text-center" style={{ width: lay.R * 1.6, height: lay.R * 1.6 }}>{coreText("sm")}</button>
              <p className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap text-[10px] tracking-[0.3em] text-cyan-200/90" aria-live="polite">{coreLabel}</p>
              {(["left", "right"] as const).map((side) => (
                <button key={side} type="button" onClick={() => setStatsOpen(statsOpen === side ? null : side)} aria-expanded={statsOpen === side}
                  className={cn("robin-cmd absolute bottom-2 flex items-center gap-1 rounded-xl px-2.5 py-1 text-[9px] tracking-[0.2em] text-slate-200", side === "left" ? "left-3" : "right-3")}>
                  {side === "left" ? "PIPELINE" : "PERFORMANCE"}<ChevronDown className={cn("h-3 w-3 transition-transform", statsOpen === side && "rotate-180")} />
                </button>
              ))}
            </div>
            {statsOpen && <div className="robin-expand grid grid-cols-2 gap-2 px-3 pb-2">{(statsOpen === "left" ? left : right).map((s) => <StatPanel key={s.key} stat={s} />)}</div>}
            <div className="px-3">{commandBar}</div>
            <div className="robin-scroll relative mt-3 overflow-x-auto overflow-y-hidden" ref={(el) => { if (el && !el.dataset.centered) { el.dataset.centered = "1"; el.scrollLeft = (lay.geo.w - el.clientWidth) / 2; } }}>
              <div className="relative" style={{ width: lay.geo.w, height: lay.geo.h }}>{orbit}</div>
            </div>
            {ov && c?.total === 0 && <EmptyPipeline onImport={importDarwin} className="relative mx-auto mt-2" />}
            {stageNode && ov && (
              <div className="fixed inset-x-2 bottom-2 z-[60]">
                <StagePanel node={stageNode} currency={ov.currency} tz={ov.tz} style={{ maxHeight: "68dvh" }}
                  onClose={() => setExpanded(null)} onOpenLead={(id) => setLeadId(id)}
                  onFollowUp={(id) => { setLeadId(id); setLeadSheet({ sheet: "followup", at: Date.now() }); }}
                  onMove={(lead, to) => void moveLead({ id: lead.id, name: lead.name, from: nodeOf(lead.stage) }, to)}
                  beginDrag={(e, lead, from) => chart.current?.beginDrag(e, lead, from)} />
              </div>
            )}
          </main>
        )}

        {/* ---- live activity */}
        <footer className="relative z-10 shrink-0 px-3 pb-3 pt-2 sm:px-6" style={show(700, "down")}>
          <ActivityStream items={feed.slice(-6)} />
        </footer>
      </div>

      {/* ---- overlays */}
      {toast && <div key={toast.id} className="robin-toast robin-glass fixed left-1/2 top-14 z-[90] -translate-x-1/2 rounded-full px-4 py-2 text-xs text-cyan-50">{toast.text}</div>}
      {confirm && (
        <div className="fixed inset-x-0 bottom-24 z-[95] mx-auto w-[min(92%,420px)] robin-in">
          <div className="robin-glass rounded-2xl p-4 text-center">
            <p className="text-sm text-slate-100">{confirm.q}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => { setConfirm(null); say("No problem."); }} className="robin-btn rounded-full border border-white/10 px-4 py-1 text-[11px] text-slate-300">No</button>
              <button type="button" onClick={async () => { const cf = confirm; setConfirm(null); await cf.run(); }} className="robin-btn rounded-full border border-cyan-300/50 bg-cyan-300/15 px-4 py-1 text-[11px] text-cyan-50">Yes</button>
            </div>
          </div>
        </div>
      )}
      {insight && ov && <InsightsOverlay ov={ov} mode={insight} onMode={setInsight} onClose={() => setInsight(null)} />}
      {leadId && ov && (
        <LeadPanel
          leadId={leadId} tz={ov.tz} onClose={() => setLeadId(null)} ask={ask} say={say} externalSheet={leadSheet}
          onChanged={(e) => {
            if (e?.moved) chart.current?.travel(e.moved.name, (prevMap.current?.get(leadId) ?? "new") as NodeId, nodeOf(e.moved.to));
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
        <div className="pointer-events-none fixed inset-x-0 bottom-[14vh] z-20 text-center">
          <p className="robin-typein mx-auto w-max overflow-hidden whitespace-nowrap text-[10px] tracking-[0.5em] text-cyan-200/80">INITIALIZING RUBIN AI CORE · CONNECTING CRM</p>
        </div>
      )}
    </div>
  );
}

function EmptyPipeline({ onImport, style, className }: { onImport: () => void; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={cn("robin-glass robin-in absolute inset-x-0 z-20 mx-auto w-[min(92%,400px)] rounded-2xl p-4 text-center", className)} style={style}>
      <p className="text-sm font-medium text-slate-100">No leads in the pipeline yet</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">When DARWIN finds a cafe, restaurant or gym, it arrives here automatically and Rubin qualifies it.</p>
      <button type="button" onClick={onImport} className="robin-btn mt-3 rounded-full border border-cyan-300/30 px-4 py-1.5 text-[11px] tracking-[0.18em] text-cyan-100">CHECK DARWIN FOR LEADS</button>
    </div>
  );
}
