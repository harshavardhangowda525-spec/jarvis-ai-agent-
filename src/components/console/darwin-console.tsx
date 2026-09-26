"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Loader2, LogOut, MapPin, X, Radar, Instagram, Globe, ExternalLink, Database, RotateCw } from "lucide-react";
import { useVoice, useResumeVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { cn } from "@/lib/utils";
import { GENERATE_LEADS_RE, MAP_REQUEST_RE, parseLeadCommand } from "@/lib/darwin/command";
import { LEAD_FILTERS, type FindLeadsResult, type LeadDTO, type LeadFilter } from "@/lib/darwin/types";
import {
  leadIntel, pipelineCounts, pipelineStageOf, matchesFilters, toLocalMeters,
  DEFAULT_FILTERS, KIND_LABEL, PIPELINE, type MapFilters, type PipelineStage,
} from "@/lib/darwin/intel";
import { type SearchForm, FollowUpsPanel } from "./darwin/panels";
import { LeadTable, patchLead, type TableRequest } from "./darwin/lead-table";
import { PhoneActions, STATUS_OPTIONS, normStage, statusTone, websiteHost, fmtDistance } from "./darwin/ui";
import { DarwinMap, type DarwinMapHandle, type MapNodeInput } from "./darwin/darwin-map";
import { EmailComposePopup, useEmailPopups } from "./email-popup";

/**
 * DARWIN — a living geographic intelligence map. Every node is a REAL business
 * DARWIN discovered (placed at its real distance and bearing from the searched
 * point); every analysis step and classification shows real listed data. The
 * terrain around them is stylised, and the page says so.
 */

// Phrases that close DARWIN and return to JARVIS.
const DEACTIVATE_RE = /\b(deactivate|de-activate|shut ?down|power down|close|exit|leave|stand ?down|log ?off)\b.*\bdarwin\b|\bdarwin[,\s]+(deactivate|shut ?down|stand ?down|close|exit|off)\b|^(deactivate|shut ?down|power down|exit|close|stand ?down|back to jarvis|go to jarvis|open jarvis|return to jarvis)[\s!.,]*$/i;

interface Overview {
  geoapifyReady: boolean;
  crm: { followUpsDue: number };
  totals: { leads: number; dueFollowUps: number; pendingApprovals: number };
  recentActivity: { id: string; type: string; detail: string; createdAt: string }[];
}
interface Place { lat: number; lon: number; label: string; radiusKm: number }
interface FeedItem { id: number; text: string; tone: "info" | "ok" | "warn" | "hot" }

const DEFAULT_FORM: SearchForm = { category: "", location: "", limit: 20, filter: "all", radiusKm: 5 };
const FORM_KEY = "darwin.searchForm";
const PLACE_KEY = "darwin.place";

// Per-viewer conveniences only — the lead history itself lives in the database.
function readStore<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function writeStore(key: string, v: unknown) { try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } }

const CYCLE3 = { any: "has", has: "none", none: "any" } as const;
const FILTER_TEXT: Record<string, Record<string, string>> = {
  website: { any: "Any", has: "Has website", none: "No website" },
  phone: { any: "Any", has: "Has phone", none: "No phone" },
  instagram: { any: "Any", has: "On Instagram", none: "No Instagram" },
  quality: { any: "Any", weak: "Weak website (AI)" },
  potential: { any: "Any", high: "High potential" },
};

export function DarwinConsole() {
  const router = useRouter();
  const map = useRef<DarwinMapHandle>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [followUps, setFollowUps] = useState<LeadDTO[]>([]);
  const [searching, setSearching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [intro, setIntro] = useState<{ online: boolean; done: boolean }>({ online: false, done: false });
  const [onlineDone, setOnlineDone] = useState(false);

  const [form, setForm] = useState<SearchForm>(DEFAULT_FORM);
  const [lastForm, setLastForm] = useState<SearchForm | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{ found: number; verified: number; noSite: number; hot: number; skipped: number; message: string } | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [crmOpen, setCrmOpen] = useState(false);
  const [tableRequest, setTableRequest] = useState<TableRequest | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [flows, setFlows] = useState<{ key: number; from: number; to: number }[]>([]);
  const categoryRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const feedSeq = useRef(0);
  const prevStages = useRef(new Map<string, PipelineStage>());

  const sendRef = useRef<(t: string) => void>(() => {});
  const deactivateRef = useRef<() => void>(() => {});
  const runSearchRef = useRef<(f: SearchForm) => void>(() => {});

  const pushFeed = useCallback((text: string, tone: FeedItem["tone"] = "info") => {
    setFeed((f) => [...f.slice(-11), { id: ++feedSeq.current, text, tone }]);
  }, []);

  // Restore the last form + place (this browser).
  useEffect(() => {
    const f = readStore<SearchForm>(FORM_KEY, DEFAULT_FORM);
    setForm(f);
    if (f.category && f.location) setLastForm(f);
    const p = readStore<Place | null>(PLACE_KEY, null as unknown as Place);
    if (p && typeof p.lat === "number") setPlace(p);
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      const r = await fetch("/api/darwin/leads?limit=500");
      const j = r.ok ? await r.json() : null;
      if (j?.data?.leads) setLeads(j.data.leads);
      return (j?.data?.leads ?? []) as LeadDTO[];
    } catch { return [] as LeadDTO[]; }
  }, []);
  const loadOverview = useCallback(() => {
    fetch("/api/darwin/overview").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setOverview(j.data)).catch(() => {});
    fetch("/api/darwin/leads?followups=1&limit=6").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setFollowUps(j.data.leads)).catch(() => {});
  }, []);
  useEffect(() => { loadOverview(); loadLeads(); const t = setInterval(loadOverview, 30000); return () => clearInterval(t); }, [loadOverview, loadLeads]);
  // Seed the live feed with DARWIN's real recent activity.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !overview) return;
    seeded.current = true;
    overview.recentActivity.slice(0, 5).reverse().forEach((a) => pushFeed(a.detail, /fail|lost/.test(a.type) ? "warn" : "info"));
  }, [overview, pushFeed]);

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true, voiceProfile: "darwin" });
  const speak = useCallback((text: string) => {
    if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(text); } catch { /* ignore */ } }
  }, [voice, voiceStarted]);

  // The place the map is centred on: the last search, else where your leads are.
  const center: Place | null = useMemo(() => {
    if (place) return place;
    const withCoords = leads.filter((l) => l.latitude != null && l.longitude != null).slice(0, 80);
    if (!withCoords.length) return null;
    const lat = withCoords.reduce((s, l) => s + (l.latitude as number), 0) / withCoords.length;
    const lon = withCoords.reduce((s, l) => s + (l.longitude as number), 0) / withCoords.length;
    return { lat, lon, label: "Your leads", radiusKm: 5 };
  }, [place, leads]);

  const nodes: MapNodeInput[] = useMemo(() => {
    if (!center) return [];
    const maxM = center.radiusKm * 1000 * 3.5;
    const out: MapNodeInput[] = [];
    for (const l of leads) {
      if (l.latitude == null || l.longitude == null) continue;
      const m = toLocalMeters(l.latitude, l.longitude, center);
      if (Math.hypot(m.x, m.y) > maxM) continue;
      const i = leadIntel(l);
      out.push({ id: l.id, name: l.businessName, x: m.x, y: m.y, kind: i.kind, score: i.score, checks: i.checks.map((c) => c.value), hasWebsite: !!l.website, hasPhone: !!l.phone, followUpAt: l.nextFollowUpAt ? new Date(l.nextFollowUpAt).getTime() : null });
    }
    return out;
  }, [leads, center]);

  useEffect(() => { if (center) map.current?.setPlace({ label: center.label, radiusM: center.radiusKm * 1000, hasCenter: true }); }, [center]);
  useEffect(() => { map.current?.setLeads(nodes, fresh); }, [nodes, fresh]);
  useEffect(() => {
    const vis = new Set(leads.filter((l) => matchesFilters(l, filters)).map((l) => l.id));
    map.current?.setVisible(Object.values(filters).every((v) => v === "any") ? null : vis);
  }, [filters, leads]);

  // Pipeline: when a lead's stage changes, a particle travels between stages.
  const counts = useMemo(() => pipelineCounts(leads), [leads]);
  useEffect(() => {
    const prev = prevStages.current;
    const moves: { from: number; to: number }[] = [];
    for (const l of leads) {
      const now = pipelineStageOf(l); const was = prev.get(l.id);
      if (was && was !== now) moves.push({ from: PIPELINE.indexOf(was), to: PIPELINE.indexOf(now) });
      prev.set(l.id, now);
    }
    if (moves.length) setFlows((f) => [...f, ...moves.slice(0, 6).map((m, i) => ({ key: Date.now() + i, ...m }))]);
  }, [leads]);
  useEffect(() => { if (!flows.length) return; const t = setTimeout(() => setFlows((f) => f.slice(1)), 1600); return () => clearTimeout(t); }, [flows]);

  // Outreach emails open in the liquid-glass compose popup and type out live.
  const emails = useEmailPopups();
  const agent = useAgent({
    onEmail: emails.push,
    onOpen: (url) => { try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* blocked — use the links */ } },
    onAssistantComplete: (text) => { speak(text); loadOverview(); loadLeads(); },
    // The agent ran a discovery itself → show the new businesses arriving on the map.
    onTool: (t) => {
      if (t.name === "darwin_search" && t.status === "ok") {
        loadOverview();
        loadLeads().then((all) => {
          const recent = all.filter((l) => Date.now() - new Date(l.discoveredAt).getTime() < 120_000).map((l) => l.id);
          setFresh(new Set(recent));
        });
      }
      if (/^darwin_(stage|followup|message|outreach)$/.test(t.name) && t.status === "ok") loadLeads();
    },
  });

  // ---- FIND NEW LEADS (real discovery) ----------------------------------------
  const runSearch = useCallback(async (f: SearchForm) => {
    if (searching) return;
    const clean = { ...f, category: f.category.trim(), location: f.location.trim() };
    setForm(clean); setLastForm(clean); writeStore(FORM_KEY, clean);
    setSearching(true); setSourceError(null); setSummary(null); setSelectedId(null); map.current?.select(null);
    map.current?.setScanning(true);
    pushFeed(`Scanning ${clean.location} for ${clean.category}…`);
    try {
      const res = await fetch("/api/darwin/find-new-leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: clean.category, location: clean.location, limit: clean.limit, filter: clean.filter, radiusKm: clean.radiusKm }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = j.error === "Invalid request." ? "Enter a category and a location (at least 2 characters each)." : j.error || `Search failed (HTTP ${res.status}).`;
        // Input problems are just messages; a failing source gets the amber signal + retry.
        if (res.status >= 500 || /geoapify|source|unavailable|rate|quota|network/i.test(message)) { map.current?.sourceError(); setSourceError(message); }
        pushFeed(message, "warn"); speak(message);
        return;
      }
      const r = j.data as FindLeadsResult;
      const p: Place = { lat: r.center.lat, lon: r.center.lon, label: r.center.label || clean.location, radiusKm: r.radiusKm || clean.radiusKm };
      setPlace(p); writeStore(PLACE_KEY, p);
      await loadLeads();
      setFresh(new Set(r.leads.map((l) => l.id)));
      loadOverview(); setRefreshKey((k) => k + 1);
      const s = {
        found: r.newCount,
        verified: r.leads.filter((l) => l.phone || l.email || l.website).length,
        noSite: r.leads.filter((l) => !l.website).length,
        hot: r.leads.filter((l) => leadIntel(l).kind === "high_potential").length,
        skipped: r.skippedDuplicates,
        message: r.message,
      };
      // The summary appears once the map has revealed and analysed every business.
      setTimeout(() => { map.current?.searchComplete(); setSummary(s); }, Math.min(9000, 1500 + r.leads.length * 250 + 3500));
      if (!r.newCount) pushFeed(r.message, "warn");
      const withPhone = r.leads.filter((l) => l.phone).length;
      speak(r.newCount ? `${r.message.replace(/ · /g, ", ")} ${withPhone} of them ${withPhone === 1 ? "has" : "have"} a phone number.` : r.message);
    } catch {
      map.current?.sourceError(); setSourceError("Network error — couldn't reach the server.");
    } finally { setSearching(false); map.current?.setScanning(false); }
  }, [searching, loadOverview, loadLeads, speak, pushFeed]);
  useEffect(() => { runSearchRef.current = runSearch; }, [runSearch]);
  useEffect(() => { if (!summary) return; const t = setTimeout(() => setSummary(null), 9000); return () => clearTimeout(t); }, [summary]);

  // ---- deactivate → JARVIS ---------------------------------------------------
  const deactivate = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const spoke = voiceStarted && !voice.muted && voice.enabled;
    if (spoke) { try { voice.speak("Deactivating. Handing you back to JARVIS."); } catch { /* ignore */ } }
    setTimeout(() => router.push("/dashboard"), spoke ? 1100 : 300);
  }, [leaving, router, voice, voiceStarted]);
  useEffect(() => { deactivateRef.current = deactivate; }, [deactivate]);

  // ---- voice / typed commands -------------------------------------------------
  useEffect(() => {
    sendRef.current = (t: string) => {
      const s = t.trim();
      if (!s) return;
      if (DEACTIVATE_RE.test(s)) { deactivateRef.current(); return; }
      // "find 20 gyms in Bangalore without a website" → run the real discovery directly.
      // "Show me the leads on Google Maps" goes to the agent (darwin_map) instead.
      if (GENERATE_LEADS_RE.test(s) && !MAP_REQUEST_RE.test(s)) {
        const p = parseLeadCommand(s);
        const base = lastForm ?? form;
        const next: SearchForm = {
          category: p.category ?? base.category,
          location: p.location ?? base.location,
          limit: p.limit ?? base.limit ?? 20,
          filter: p.filter ?? (p.category || p.location ? "all" : base.filter),
          radiusKm: base.radiusKm || 5,
        };
        if (!next.category || !next.location) {
          setForm(next);
          const ask = !next.category && !next.location ? "Sure — what kind of businesses, and where? For example: find 20 gyms in Bangalore."
            : !next.location ? `Got it, ${next.category}. Which city or area should I search?` : "What kind of businesses should I look for?";
          pushFeed(ask, "warn"); speak(ask);
          return;
        }
        speak(`On it — scanning for new ${next.category} in ${next.location}.`);
        runSearchRef.current(next);
        return;
      }
      agent.send(s, { agent: "darwin" });
    };
  }, [agent, form, lastForm, speak, pushFeed]);

  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }
  useResumeVoice(enableVoice);

  // ---- selected lead ------------------------------------------------------------
  const selected = selectedId ? leads.find((l) => l.id === selectedId) ?? null : null;
  const selectLead = useCallback((id: string | null) => { setSelectedId(id); map.current?.select(id); }, []);
  const updateLead = useCallback(async (l: LeadDTO, body: Record<string, unknown>) => {
    try {
      const updated = await patchLead(l.id, body);
      setLeads((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      if (body.stage) { map.current?.crmStream(updated.id); pushFeed(`${updated.businessName} → ${String(body.stage).replace(/_/g, " ")}`, "ok"); }
      if ("nextFollowUpAt" in body) pushFeed(body.nextFollowUpAt ? `Follow-up scheduled — ${updated.businessName}` : `Follow-up cleared — ${updated.businessName}`, "ok");
      loadOverview();
    } catch (e) { pushFeed(e instanceof Error ? e.message : "Update failed.", "warn"); }
  }, [loadOverview, pushFeed]);

  const state = searching ? `SCANNING ${(form.location || "").toUpperCase()}` : sourceError ? "DATA SOURCE UNAVAILABLE"
    : agent.streaming ? (agent.activity[0]?.label ?? "THINKING").toUpperCase()
    : voice.status === "recording" ? "LISTENING" : "MONITORING";
  const lastAssistant = useMemo(() => [...agent.messages].reverse().find((m) => m.role === "assistant"), [agent.messages]);
  const canSearch = form.category.trim().length >= 2 && form.location.trim().length >= 2 && !searching;
  const setF = <K extends keyof MapFilters>(k: K, v: MapFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="relative h-[calc(100dvh-4rem)] select-none overflow-hidden bg-[#03050a] text-white">
      <DarwinMap ref={map} anchorRef={anchorRef} className="absolute inset-0"
        paused={crmOpen}
        onIntro={(p) => setIntro((s) => ({ ...s, [p]: true }))}
        onSelect={selectLead}
        onEvent={(t, tone) => pushFeed(t, tone)} />

      {/* vignette (composited, not repainted) */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 55%, transparent 50%, rgba(0,0,0,.55) 100%)" }} />

      {!intro.done && (
        <button onClick={() => map.current?.skipIntro()} className="absolute bottom-5 right-5 z-30 text-[10px] uppercase tracking-[0.35em] text-white/25 hover:text-white/60">Skip</button>
      )}
      {intro.online && !onlineDone && <OnlineTitle onDone={() => setOnlineDone(true)} />}

      {leaving && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#03050a]/95 backdrop-blur-sm" style={{ animation: "dw-reveal .4s ease both" }}>
          <span className="text-[11px] tracking-[0.4em] text-cyan-100/80">DEACTIVATING DARWIN</span>
          <span className="mt-2 text-xs text-white/50">Returning to JARVIS…</span>
        </div>
      )}

      {intro.done && (
        <>
          {/* ===== top-left: identity + live activity stream ===== */}
          <div className="pointer-events-none absolute left-4 top-4 z-20 sm:left-6" style={{ animation: "ultron-emerge .8s ease both" }}>
            <div className="text-[11px] tracking-[0.45em] text-white/80">DARWIN</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] tracking-[0.25em] text-cyan-100/55">
              <span className={cn("h-1.5 w-1.5 rounded-full", searching ? "animate-pulse bg-sky-400" : sourceError ? "bg-amber-400" : "bg-cyan-300/70")} />
              <span className="max-w-[60vw] truncate">{state}</span>
            </div>
          </div>
          <ActivityFeed items={feed} />

          {/* ===== top-center: search ===== */}
          <div className="absolute inset-x-0 top-14 z-30 flex flex-col items-center px-3 sm:top-4" style={{ animation: "ultron-emerge .8s ease .1s both" }}>
            <form onSubmit={(e) => { e.preventDefault(); if (canSearch) runSearch(form); }}
              className="dw-glass flex w-full max-w-2xl items-center gap-1 rounded-full py-1 pl-4 pr-1">
              <Radar className="h-3.5 w-3.5 shrink-0 text-cyan-200/60" />
              <input ref={categoryRef} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={80}
                placeholder="gyms, cafes, dentists…" className="dw-bare min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[13px] text-white outline-none placeholder:text-white/30" />
              <span className="h-4 w-px bg-white/10" />
              <input ref={locationRef} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={120}
                placeholder="Bengaluru · Indiranagar · 560038" className="dw-bare min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[13px] text-white outline-none placeholder:text-white/30" />
              <span className="hidden h-4 w-px bg-white/10 sm:block" />
              <label className="hidden items-center gap-1 px-1 text-[10px] text-white/45 sm:flex">
                <input type="number" min={1} max={50} value={form.limit} onChange={(e) => setForm({ ...form, limit: Math.min(Math.max(+e.target.value || 1, 1), 50) })}
                  className="dw-bare w-9 bg-transparent text-right text-[12px] text-white outline-none" /> leads
              </label>
              <span className="hidden h-4 w-px bg-white/10 sm:block" />
              <select value={form.filter} onChange={(e) => setForm({ ...form, filter: e.target.value as LeadFilter })} title="Which businesses to find" aria-label="Filter"
                className="dw-bare max-w-[6.5rem] shrink-0 cursor-pointer bg-transparent px-1 text-[11px] text-white/70 outline-none sm:max-w-none">
                {LEAD_FILTERS.map((f) => <option key={f.id} value={f.id} className="bg-[#07121c] text-white">{f.label}</option>)}
              </select>
              <button type="button" onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())} title="Voice" aria-label="Voice"
                className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition", voiceStarted && !voice.muted ? "text-cyan-200" : "text-white/40 hover:text-white/80")}>
                {voiceStarted && voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button type="submit" disabled={!canSearch}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-cyan-200/25 bg-cyan-200/10 px-4 text-[12px] text-cyan-50 transition hover:bg-cyan-200/20 disabled:opacity-40">
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Scan
              </button>
            </form>
            {overview && !overview.geoapifyReady && (
              <p className="mt-1.5 text-[10px] text-amber-200/70">Geoapify isn’t configured — DARWIN shows only real data, so discovery is off until GEOAPIFY_API_KEY is set.</p>
            )}
            {/* agent reply */}
            {(agent.streaming || lastAssistant?.content) && (
              <div className="mt-2 max-w-2xl px-4 text-center text-[12px] text-white/75" style={{ animation: "ultron-word .4s ease both" }}>
                {agent.streaming ? <span className="inline-flex items-center gap-2 text-white/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {agent.activity[0]?.label ?? "working…"}</span> : lastAssistant?.content}
                {!agent.streaming && !!lastAssistant?.links?.length && (
                  <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                    {lastAssistant.links.slice(0, 12).map((l, i) => (
                      <a key={`${l.url}-${i}`} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 hover:text-cyan-100">
                        <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{l.label}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* search complete: floating typography integrated into the map */}
            {summary && (
              <div className="pointer-events-none mt-3 flex flex-wrap justify-center gap-x-6 gap-y-1" style={{ animation: "ultron-word .8s ease both" }}>
                {([["LEADS DISCOVERED", summary.found], ["VERIFIED", summary.verified], ["NO WEBSITE", summary.noSite], ["HIGH POTENTIAL", summary.hot]] as const).map(([k, v], i) => (
                  <span key={k} className="text-center" style={{ animation: `ultron-word .7s ease ${i * 0.12}s both` }}>
                    <span className={cn("block text-2xl font-extralight", k === "HIGH POTENTIAL" ? "text-cyan-200" : k === "NO WEBSITE" ? "text-amber-200/90" : "text-white/90")}>{v}</span>
                    <span className="block text-[8px] tracking-[0.3em] text-white/45">{k}</span>
                  </span>
                ))}
                {summary.skipped > 0 && <span className="w-full text-center text-[10px] text-white/35">{summary.skipped} previously discovered skipped</span>}
              </div>
            )}
          </div>

          {/* ===== top-right: deactivate (the emblem is drawn on the map) ===== */}
          <button onClick={deactivate} disabled={leaving} title="Deactivate DARWIN — back to JARVIS"
            className="absolute right-[6.5rem] top-5 z-30 hidden items-center gap-1 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/40 transition hover:text-white/80 sm:flex">
            <LogOut className="h-3 w-3" /> Exit
          </button>
          <button onClick={deactivate} aria-label="Deactivate DARWIN" className="absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full text-white/40 sm:hidden"><LogOut className="h-4 w-4" /></button>

          {/* CRM icon on the map → the full CRM */}
          <button onClick={() => setCrmOpen(true)} title="Open the CRM" aria-label="Open the CRM"
            className="absolute right-[1.2rem] z-30 h-10 w-14 rounded-md" style={{ top: "calc(66% - 20px)" }} />
          {(overview?.crm.followUpsDue ?? 0) > 0 && (
            <button onClick={() => setCrmOpen(true)} className="absolute right-4 z-30 text-[9px] tracking-[0.2em] text-amber-200/80" style={{ top: "calc(66% + 22px)" }}>
              {overview!.crm.followUpsDue} DUE
            </button>
          )}

          {/* ===== source error ===== */}
          {sourceError && (
            <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 text-center" style={{ animation: "ultron-word .6s ease both" }}>
              <div className="text-[13px] tracking-[0.4em] text-amber-200">DATA SOURCE UNAVAILABLE</div>
              <p className="mx-auto mt-1 max-w-sm text-[11px] text-white/55">{sourceError}</p>
              <button onClick={() => { const f = lastForm ?? form; setSourceError(null); if (f.category && f.location) runSearch(f); }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-1.5 text-[11px] text-amber-100 hover:bg-amber-200/20">
                <RotateCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          )}

          {/* ===== empty state ===== */}
          {!center && !searching && (
            <div className="pointer-events-none absolute inset-x-0 top-[42%] z-10 text-center">
              <p className="text-[12px] tracking-[0.3em] text-white/50">NO TERRITORY SCANNED YET</p>
              <p className="mt-1 text-[11px] text-white/35">Type a category and a place above — or say “find 20 gyms in Bengaluru”.</p>
            </div>
          )}

          {/* ===== selected business: a holographic layer beside its node ===== */}
          <div ref={(el) => { anchorRef.current = el; map.current?.setAnchor(el); }} className="pointer-events-none absolute left-0 top-0 z-20 hidden md:block" style={{ opacity: 0, transition: "opacity .3s" }}>
            {selected && (
              <div className="pointer-events-auto absolute left-8 top-0 w-80 -translate-y-1/2" key={selected.id}>
                <LeadLayer lead={selected} onClose={() => selectLead(null)} onUpdate={updateLead} onCrm={() => { setTableRequest({ tab: "all", q: selected.businessName, nonce: Date.now() }); setCrmOpen(true); }} />
              </div>
            )}
          </div>
          {selected && (
            <div className="absolute inset-x-2 bottom-2 z-40 md:hidden" key={`m-${selected.id}`}>
              <LeadLayer lead={selected} onClose={() => selectLead(null)} onUpdate={updateLead} onCrm={() => { setTableRequest({ tab: "all", q: selected.businessName, nonce: Date.now() }); setCrmOpen(true); }} />
            </div>
          )}

          {/* ===== bottom: filters + lead flow ===== */}
          <div className="absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-3 px-2 sm:bottom-4" style={{ animation: "ultron-emerge .9s ease .2s both" }}>
            <div className="dw-glass flex max-w-full gap-1 overflow-x-auto rounded-full p-1 text-[10px] tracking-[0.12em]" style={{ scrollbarWidth: "none" }}>
              <Chip label="CATEGORY" value={form.category || "—"} onClick={() => categoryRef.current?.focus()} />
              <Chip label="LOCATION" value={form.location || "—"} onClick={() => locationRef.current?.focus()} />
              <Chip label="RADIUS" value={`${form.radiusKm} km`} onClick={() => setForm({ ...form, radiusKm: form.radiusKm >= 20 ? 2 : form.radiusKm >= 10 ? 20 : form.radiusKm >= 5 ? 10 : 5 })} />
              <Chip label="WEBSITE" value={FILTER_TEXT.website[filters.website]} active={filters.website !== "any"} onClick={() => setF("website", CYCLE3[filters.website])} />
              <Chip label="PHONE" value={FILTER_TEXT.phone[filters.phone]} active={filters.phone !== "any"} onClick={() => setF("phone", CYCLE3[filters.phone])} />
              <Chip label="INSTAGRAM" value={FILTER_TEXT.instagram[filters.instagram]} active={filters.instagram !== "any"} onClick={() => setF("instagram", CYCLE3[filters.instagram])} />
              <Chip label="QUALITY" value={FILTER_TEXT.quality[filters.quality]} active={filters.quality !== "any"} onClick={() => setF("quality", filters.quality === "any" ? "weak" : "any")} />
              <Chip label="POTENTIAL" value={FILTER_TEXT.potential[filters.potential]} active={filters.potential !== "any"} onClick={() => setF("potential", filters.potential === "any" ? "high" : "any")} />
            </div>
            <LeadFlow counts={counts} flows={flows} />
          </div>

          <span className="pointer-events-none absolute bottom-1 right-3 z-10 hidden text-[8px] tracking-[0.2em] text-white/20 md:block">STYLISED TERRAIN · BUSINESS POSITIONS TO SCALE</span>

          {/* live voice caption */}
          {voiceStarted && !voice.muted && voice.transcript && (
            <div className="pointer-events-none absolute inset-x-0 bottom-32 z-30 flex justify-center px-6">
              <span className="max-w-xl truncate text-[13px] text-white/80">“{voice.transcript}”</span>
            </div>
          )}
        </>
      )}

      {/* ===== the full CRM (records, follow-ups, notes) ===== */}
      {crmOpen && (
        <div className="absolute inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={() => setCrmOpen(false)}>
          <div className="dw-glass h-full w-full max-w-5xl overflow-y-auto p-3 sm:p-5" onClick={(e) => e.stopPropagation()} style={{ animation: "ultron-drawer .45s cubic-bezier(.2,.9,.25,1) both", scrollbarWidth: "thin" }}>
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-200/70" />
              <span className="text-[11px] tracking-[0.35em] text-white/70">CRM</span>
              <button onClick={() => setCrmOpen(false)} aria-label="Close" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {followUps.length > 0 && <FollowUpsPanel items={followUps} dueCount={overview?.crm.followUpsDue ?? 0} onOpen={(l) => setTableRequest({ tab: "all", q: l.businessName, nonce: Date.now() })} />}
              <LeadTable searchLeads={leads.filter((l) => fresh.has(l.id))} freshIds={fresh} request={tableRequest} refreshKey={refreshKey}
                onLeadUpdated={(l) => { setLeads((prev) => prev.map((x) => (x.id === l.id ? l : x))); loadOverview(); }} />
            </div>
          </div>
        </div>
      )}

      {emails.current && <EmailComposePopup key={emails.current.id} email={emails.current} waiting={emails.waiting} onClose={emails.close} />}
    </div>
  );
}

/* ---------------- pieces ---------------- */

function OnlineTitle({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[34%] z-30 text-center" style={{ animation: "jv-dissolve .6s ease 2s forwards" }}>
      <div className="text-3xl font-extralight tracking-[0.6em] text-white" style={{ animation: "ultron-word 1s ease both", textShadow: "0 0 24px rgba(120,200,255,.7)" }}>DARWIN</div>
      <div className="mt-2 text-[10px] tracking-[0.5em] text-cyan-100/70" style={{ animation: "ultron-word 1s ease .35s both" }}>LEAD INTELLIGENCE ONLINE</div>
    </div>
  );
}

/** A thin vertical live feed: events slide up, older ones dissolve. */
function ActivityFeed({ items }: { items: FeedItem[] }) {
  const shown = items.slice(-8);
  return (
    <div className="pointer-events-none absolute left-4 top-20 z-10 hidden w-56 flex-col gap-2 md:flex sm:left-6">
      {shown.map((it, i) => {
        const age = shown.length - 1 - i;
        return (
          <div key={it.id} className="flex items-start gap-2 text-[11px] leading-snug transition-opacity duration-700"
            style={{ opacity: Math.max(0.12, 1 - age * 0.13), animation: "dw-feed-in .5s ease both" }}>
            <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", it.tone === "hot" ? "bg-cyan-300 shadow-[0_0_6px_rgba(120,220,255,.9)]" : it.tone === "warn" ? "bg-amber-300/80" : it.tone === "ok" ? "bg-sky-300/80" : "bg-white/40")} />
            <span className={cn("truncate", it.tone === "hot" ? "text-cyan-100" : it.tone === "warn" ? "text-amber-100/70" : "text-white/65")}>{it.text}</span>
          </div>
        );
      })}
      <span aria-hidden className="absolute -left-2 top-0 h-full w-px bg-gradient-to-b from-transparent via-white/15 to-transparent" />
    </div>
  );
}

function Chip({ label, value, active, onClick }: { label: string; value: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition", active ? "bg-cyan-200/15 text-cyan-50" : "text-white/55 hover:bg-white/[0.06] hover:text-white/85")}>
      <span>{label}</span>
      {value !== "Any" && <span className={cn("max-w-[9rem] truncate normal-case tracking-normal", active ? "text-cyan-100" : "text-white/35")}>{value}</span>}
    </button>
  );
}

/** DISCOVERED → … → CLIENT as floating nodes joined by flowing light (real counts). */
function LeadFlow({ counts, flows }: { counts: Record<PipelineStage, number>; flows: { key: number; from: number; to: number }[] }) {
  const n = PIPELINE.length;
  const pct = (i: number) => `${(i / (n - 1)) * 100}%`;
  return (
    <div className="relative hidden w-full max-w-4xl px-6 sm:block">
      <div className="relative h-10">
        <span aria-hidden className="dw-flow-line absolute left-0 right-0 top-[11px] h-px" />
        {PIPELINE.map((s, i) => (
          <div key={s} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: pct(i) }}>
            <span className={cn("flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[9px]",
              s === "HIGH POTENTIAL" ? "border-cyan-200/70 bg-cyan-200/15 text-cyan-50 shadow-[0_0_16px_rgba(120,220,255,.5)]" : s === "CLIENT" ? "border-amber-200/60 bg-amber-200/10 text-amber-100" : "border-white/25 bg-black/40 text-white/80")}>
              {counts[s]}
            </span>
            <span className="mt-1 whitespace-nowrap text-[8px] tracking-[0.2em] text-white/45">{s}</span>
          </div>
        ))}
        {flows.map((f) => (
          <span key={f.key} aria-hidden className="dw-flow-dot absolute top-[8px] h-1.5 w-1.5 rounded-full bg-cyan-100 shadow-[0_0_10px_rgba(160,230,255,1)]"
            style={{ ["--from" as string]: pct(f.from), ["--to" as string]: pct(f.to) }} />
        ))}
      </div>
    </div>
  );
}

/** The holographic information layer for one business — real data + CRM actions. */
function LeadLayer({ lead, onClose, onUpdate, onCrm }: { lead: LeadDTO; onClose: () => void; onUpdate: (l: LeadDTO, body: Record<string, unknown>) => void; onCrm: () => void }) {
  const intel = leadIntel(lead);
  const [date, setDate] = useState(lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 10) : "");
  const website = lead.website ? (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`) : null;
  return (
    <div className="dw-glass rounded-2xl p-4 text-white" style={{ animation: "dw-layer-in .45s cubic-bezier(.2,.9,.25,1) both" }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium leading-tight">{lead.businessName}</div>
          <div className="mt-0.5 truncate text-[10px] text-white/45">{[lead.category, fmtDistance(lead.distanceM)].filter(Boolean).join(" · ")}</div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[8px] tracking-[0.18em]", intel.kind === "high_potential" ? "bg-cyan-200/15 text-cyan-100" : intel.kind === "no_website" || intel.kind === "weak_website" ? "bg-amber-200/10 text-amber-100" : "bg-white/10 text-white/70")}>
          {KIND_LABEL[intel.kind]}
        </span>
        <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
      </div>
      {lead.address && <p className="mt-2 text-[11px] text-white/55">{lead.address}</p>}

      {/* what DARWIN checked — real listed data */}
      <div className="mt-3 space-y-1.5">
        {intel.checks.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-[10px]">
            <span className="w-20 shrink-0 tracking-[0.15em] text-white/40">{c.label}</span>
            <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
              {c.value != null && <span className={cn("absolute inset-y-0 left-0 rounded-full", c.key === "opportunity" ? "bg-violet-300" : "bg-cyan-300/80")} style={{ width: `${Math.round(c.value * 100)}%`, animation: "dw-bar-in .8s ease both" }} />}
            </span>
            <span className="w-28 shrink-0 truncate text-right text-white/55" title={c.note}>{c.note}</span>
          </div>
        ))}
        <p className="text-[9px] text-white/30">Fit score {intel.score}/100 — worked out from what the source lists, not a guess.{typeof lead.leadScore === "number" ? ` AI analysis score: ${lead.leadScore}.` : ""}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <PhoneActions lead={lead} compact />
        {website && <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:underline"><Globe className="h-3 w-3" />{websiteHost(lead.website!)}</a>}
        {lead.instagram && <a href={lead.instagram.startsWith("http") ? lead.instagram : `https://instagram.com/${lead.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:underline"><Instagram className="h-3 w-3" />Instagram</a>}
        {lead.mapsUrl && <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:underline"><ExternalLink className="h-3 w-3" />Maps</a>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <select value={normStage(lead.stage)} onChange={(e) => onUpdate(lead, { stage: e.target.value })}
          className={cn("cursor-pointer rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wider outline-none", statusTone(lead.stage))}>
          {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id} className="bg-[#0b1020] text-white">{s.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-white/45">
          Follow-up
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); onUpdate(lead, { nextFollowUpAt: e.target.value || null }); }}
            className="rounded-md border border-white/10 bg-transparent px-1.5 py-0.5 text-[10px] text-white outline-none [color-scheme:dark]" />
        </label>
        <button onClick={onCrm} className="ml-auto text-[10px] tracking-[0.15em] text-white/45 hover:text-white">NOTES · CRM →</button>
      </div>
    </div>
  );
}
