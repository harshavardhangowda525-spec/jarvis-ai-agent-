"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Loader2, Search, ChevronLeft, ChevronRight, Radar, LogOut } from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { cn, timeAgo } from "@/lib/utils";

// Phrases that close DARWIN and return to JARVIS.
const DEACTIVATE_RE = /\b(deactivate|de-activate|shut ?down|power down|close|exit|leave|stand ?down|log ?off)\b.*\bdarwin\b|\bdarwin[,\s]+(deactivate|shut ?down|stand ?down|close|exit|off)\b|^(deactivate|shut ?down|power down|exit|close|stand ?down|back to jarvis|go to jarvis|open jarvis|return to jarvis)[\s!.,]*$/i;

// Phrases that trigger a fresh lead discovery (voice or text).
const GENERATE_LEADS_RE = /\b(generate|find|get|discover|search|pull|fetch|give me|show me|need|scan for|look for)\b.*\bleads?\b|\bnew leads?\b|\bmore leads?\b|\blead gen(eration)?\b/i;

const KNOWN_CATEGORIES = ["cafe", "coffee", "restaurant", "tech", "retail", "shop", "salon", "hair", "beauty", "gym", "fitness", "hotel", "bakery", "bar", "pub", "dentist", "clinic", "agency", "boutique", "spa"];

/** Best-effort parse of a spoken/typed lead command into a search form. */
function parseLeadCommand(text: string): { category?: string; location?: string; limit?: number } {
  const s = text.trim();
  // Location: "... in <place>" (take the tail after the last " in ").
  let location: string | undefined;
  const inMatch = s.match(/\bin\s+([A-Za-z][\w'.\- ]{1,60})$/i) || s.match(/\bin\s+([A-Za-z][\w'.\- ]{1,60})\b/i);
  if (inMatch) location = inMatch[1].replace(/\b(please|now|today|for me)\b/gi, "").trim().replace(/[.,!]+$/, "");
  // Category: a known keyword, or "<word> leads".
  let category: string | undefined;
  const low = s.toLowerCase();
  const hit = KNOWN_CATEGORIES.find((c) => new RegExp(`\\b${c}\\b`).test(low));
  if (hit) category = hit.charAt(0).toUpperCase() + hit.slice(1);
  else {
    const cm = low.match(/\b([a-z]{3,20})\s+leads?\b/);
    if (cm && !/new|more|some|the|real|good|hot|fresh|business/.test(cm[1])) category = cm[1].charAt(0).toUpperCase() + cm[1].slice(1);
  }
  // Limit: a number in the command.
  const num = s.match(/\b(\d{1,3})\b/);
  const limit = num ? Math.min(Math.max(parseInt(num[1], 10), 1), 60) : undefined;
  return { category, location, limit };
}

type DarwinState = "IDLE" | "LISTENING" | "THINKING" | "SEARCHING" | "PROCESSING" | "WAITING_FOR_APPROVAL" | "COMPLETED" | "ERROR";

const PROGRESS: Record<DarwinState, string> = {
  IDLE: "18%", LISTENING: "40%", THINKING: "55%", SEARCHING: "72%",
  PROCESSING: "72%", WAITING_FOR_APPROVAL: "60%", COMPLETED: "100%", ERROR: "30%",
};

interface LeadCard {
  businessName: string; category: string | null; location: string | null;
  website: string | null; phone: string | null; instagram: string | null; source: string;
}
interface LeadsResult {
  leads: LeadCard[]; found: number; created: number; duplicates: number; source: string | null; query: string; error?: string;
}

interface Overview {
  hasData: boolean; hasConnectedDiscovery: boolean; emailReady: boolean;
  totals: { leads: number; dueFollowUps: number; pendingApprovals: number };
  intelligence: { businessesFound: number; verifiedLeads: number; noWebsite: number; weakWebsite: number; highPotential: number; contactable: number };
  byStage: Record<string, number>; bySource: Record<string, number>;
  sources: { id: string; label: string; connected: boolean; kind: string }[];
  recentActivity: { id: string; type: string; detail: string; createdAt: string }[];
}

export function DarwinConsole() {
  const router = useRouter();
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  // Cinematic boot sequence on entry.
  const [boot, setBoot] = useState<"run" | "fade" | "done">("run");
  const [leaving, setLeaving] = useState(false);
  const [leadsPopup, setLeadsPopup] = useState<LeadsResult | null>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const deactivateRef = useRef<() => void>(() => {});
  const runSearchRef = useRef<(f: SearchForm) => void>(() => {});
  const lastFormRef = useRef<SearchForm | null>(null);

  useEffect(() => {
    const t1 = setTimeout(() => setBoot("fade"), 1900);
    const t2 = setTimeout(() => setBoot("done"), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Pull the freshly-stored leads and reveal them in the liquid-glass popup.
  const openLeadsFromApi = useCallback(async (note?: string) => {
    try {
      const lr = await fetch("/api/darwin/leads?limit=30");
      const lj = await lr.json();
      if (lr.ok && Array.isArray(lj.data?.leads) && lj.data.leads.length) {
        const leads: LeadCard[] = lj.data.leads.map((x: any) => ({
          businessName: x.businessName, category: x.category ?? null, location: x.location ?? null,
          website: x.website ?? null, phone: x.phone ?? null, instagram: x.instagram ?? null, source: x.source,
        }));
        setLeadsPopup({ leads, found: leads.length, created: 0, duplicates: 0, source: leads[0]?.source ?? null, query: note ?? "your CRM" });
      }
    } catch { /* ignore */ }
  }, []);

  const voice = useVoice({ onTranscript: (t) => sendRef.current(t), autoListen: true, voiceProfile: "darwin" });
  const agent = useAgent({
    onAssistantComplete: (text) => { if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text); loadOverview(); },
    // When the agent runs a discovery itself, reveal the results in the popup.
    onTool: (t) => { if (t.name === "darwin_search" && t.status === "ok") { loadOverview(); openLeadsFromApi("latest discovery"); } },
  });

  const loadOverview = useCallback(() => {
    fetch("/api/darwin/overview").then((r) => (r.ok ? r.json() : null)).then((j) => j?.data && setOverview(j.data)).catch(() => {});
  }, []);
  useEffect(() => { loadOverview(); const t = setInterval(loadOverview, 20000); return () => clearInterval(t); }, [loadOverview]);

  // Deactivate DARWIN and return to JARVIS: brief goodbye, release the mic, route.
  const deactivate = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const spoke = voiceStarted && !voice.muted && voice.enabled;
    // Speak the goodbye (don't stop() first — that would cut it off). Navigating
    // unmounts the console, whose cleanup releases the mic so JARVIS can take it.
    if (spoke) { try { voice.speak("Deactivating. Handing you back to JARVIS."); } catch { /* ignore */ } }
    setTimeout(() => router.push("/dashboard"), spoke ? 1100 : 300);
  }, [leaving, router, voice, voiceStarted]);
  useEffect(() => { deactivateRef.current = deactivate; }, [deactivate]);

  useEffect(() => {
    sendRef.current = (t: string) => {
      const s = t.trim();
      if (!s) return;
      // "deactivate" / "close darwin" / "back to jarvis" → return to JARVIS.
      if (DEACTIVATE_RE.test(s)) { deactivateRef.current(); return; }

      // "generate new leads" / "find cafes in London" → run a real discovery and
      // pop the results, deterministically (no dependence on the agent loop).
      if (GENERATE_LEADS_RE.test(s)) {
        const parsed = parseLeadCommand(s);
        const last = lastFormRef.current;
        const location = parsed.location || last?.location;
        if (!location) {
          setSearchMsg("Where should I look? Try “find cafes in London”.");
          if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak("Sure — where should I look? For example, say find cafes in London."); } catch { /* ignore */ } }
          return;
        }
        const form: SearchForm = {
          location,
          category: parsed.category ?? last?.category,
          radiusKm: last?.radiusKm ?? 5,
          limit: parsed.limit ?? last?.limit ?? 50,
          hasWebsite: last?.hasWebsite, noWebsite: last?.noWebsite,
          needsPhone: last?.needsPhone, needsEmail: last?.needsEmail,
        };
        if (voiceStarted && !voice.muted && voice.enabled) { try { voice.speak(`On it — pulling ${form.category ? form.category.toLowerCase() + " " : ""}leads in ${location}.`); } catch { /* ignore */ } }
        runSearchRef.current(form);
        return;
      }

      agent.send(s, { agent: "darwin" });
    };
  }, [agent, voice, voiceStarted]);

  async function enableVoice() { const ok = await voice.init(); if (ok) setVoiceStarted(true); return ok; }

  const state: DarwinState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "ERROR";
    if (searching) return "SEARCHING";
    if ((overview?.totals.pendingApprovals ?? 0) > 0 && !agent.streaming) return "WAITING_FOR_APPROVAL";
    if (agent.streaming) {
      const label = agent.activity[0]?.label ?? "";
      if (/search|find|source|discover/i.test(label)) return "SEARCHING";
      if (agent.activity[0]?.kind === "tool") return "PROCESSING";
      return "THINKING";
    }
    if (voice.status === "recording" || voice.status === "listening") return "LISTENING";
    if (voice.status === "processing") return "THINKING";
    return "IDLE";
  })();

  const runSearch = useCallback(async (form: SearchForm) => {
    lastFormRef.current = form; // remember for "generate more leads" with no params
    setSearching(true); setSearchMsg("");
    try {
      const res = await fetch("/api/darwin/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = j.error || `Search failed (HTTP ${res.status}).`;
        setSearchMsg(msg);
        // Surface the failure in the popup too, so it's never a silent no-op.
        setLeadsPopup({ leads: [], found: 0, created: 0, duplicates: 0, source: null, query: form.location, error: msg });
      } else {
        const d = j.data;
        setSearchMsg(`Found ${d.found} real business${d.found === 1 ? "" : "es"} — added ${d.created} new, ${d.duplicates} duplicate(s).`);

        // Prefer the leads the search returned; if absent (older API) or empty,
        // fall back to the freshly-stored leads so the popup always shows them.
        let leads: LeadCard[] = Array.isArray(d.leads) ? d.leads : [];
        if (!leads.length && ((d.found ?? 0) > 0 || (d.created ?? 0) > 0)) {
          try {
            const lr = await fetch("/api/darwin/leads?limit=30");
            const lj = await lr.json();
            if (lr.ok && Array.isArray(lj.data?.leads)) {
              leads = lj.data.leads.map((x: any) => ({
                businessName: x.businessName, category: x.category ?? null, location: x.location ?? null,
                website: x.website ?? null, phone: x.phone ?? null, instagram: x.instagram ?? null, source: x.source,
              }));
            }
          } catch { /* keep whatever we have */ }
        }

        // ALWAYS open the popup after a successful search — with the leads, or a
        // clear empty state when zero matched. Never a silent result.
        setLeadsPopup({ leads, found: d.found ?? leads.length, created: d.created ?? 0, duplicates: d.duplicates ?? 0, source: d.source ?? leads[0]?.source ?? null, query: d.query ?? form.location });
        if (leads.length && voiceStarted && !voice.muted && voice.enabled) {
          try { voice.speak(`Nice — found ${d.found} real ${d.found === 1 ? "business" : "businesses"}. Added ${d.created} new to the CRM. Want me to line up outreach?`); } catch { /* ignore */ }
        }
      }
      loadOverview();
    } catch {
      setSearchMsg("Network error.");
      setLeadsPopup({ leads: [], found: 0, created: 0, duplicates: 0, source: null, query: form.location, error: "Network error — couldn't reach the server." });
    }
    finally { setSearching(false); }
  }, [loadOverview, voice, voiceStarted]);
  useEffect(() => { runSearchRef.current = runSearch; }, [runSearch]);

  const intel = overview?.intelligence;

  return (
    <div className="darwin-bg relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[#04060d] px-3 pb-6 pt-4 md:px-6">
      {/* cinematic boot sequence */}
      {boot !== "done" && <DarwinBoot fading={boot === "fade"} />}

      {/* deactivation fade → JARVIS */}
      {leaving && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#04060d]/95 backdrop-blur-sm" style={{ animation: "dw-reveal .4s ease both" }}>
          <span className="hud-label text-[11px] tracking-[0.4em] text-accent/80">DEACTIVATING DARWIN</span>
          <span className="mt-2 text-xs text-muted-foreground">Returning to JARVIS…</span>
        </div>
      )}

      {/* everything reveals once the boot clears */}
      <div style={boot === "done" ? { animation: "dw-reveal .7s ease both" } : { opacity: 0 }}>
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/3 h-[60vmin] w-[60vmin] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.12),transparent_62%)] blur-3xl" />
        <Dust />
      </div>

      {/* header */}
      <header className="relative z-10 mx-auto flex max-w-6xl flex-col items-center pt-1">
        <h1 className="bg-gradient-to-r from-accent via-accent-bright to-accent bg-clip-text text-2xl font-light tracking-[0.35em] text-transparent md:text-3xl">DARWIN DASHBOARD</h1>
        <div className="mt-1 flex items-center gap-3">
          <span className="hud-label text-[10px] tracking-[0.3em] text-muted-foreground">STATUS: <span className="text-accent">{state.replace(/_/g, " ")}</span></span>
          <div className="h-px w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent" style={{ width: PROGRESS[state], transition: "width .5s ease" }} />
          </div>
          {/* voice mic */}
          <button onClick={() => (voiceStarted ? voice.toggleMute() : enableVoice())} title="Voice"
            className={cn("flex h-7 w-7 items-center justify-center rounded-full border transition", voiceStarted && !voice.muted ? "border-accent bg-accent/15 text-accent animate-hud-pulse" : "border-border text-muted-foreground hover:border-accent/50")}>
            {voiceStarted && voice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
          {/* deactivate → back to JARVIS */}
          <button onClick={deactivate} disabled={leaving} title="Deactivate DARWIN — back to JARVIS"
            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition hover:border-destructive/60 hover:text-destructive disabled:opacity-50">
            <LogOut className="h-3 w-3" /> Deactivate
          </button>
        </div>
      </header>

      {/* main grid */}
      <div className="relative z-10 mx-auto mt-4 grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_300px]">
        <LeadDiscovery onSearch={runSearch} searching={searching} msg={searchMsg} keyedSource={(overview?.sources ?? []).some((s) => s.kind === "api" && s.connected && s.id !== "openstreetmap")} />
        <div className="relative flex min-h-[320px] items-center justify-center lg:min-h-[420px]">
          <GlassCylinder state={state} level={voice.level} />
        </div>
        <Intelligence intel={intel} hasData={overview?.hasData ?? false} />
      </div>

      {/* command echo / subtitle */}
      {(agent.streaming || [...agent.messages].reverse().find((m) => m.role === "assistant")) && (
        <div className="relative z-10 mx-auto mt-3 max-w-3xl px-4 text-center text-xs text-foreground/80">
          {agent.streaming ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {agent.activity[0]?.label ?? "working…"}</span>
            : [...agent.messages].reverse().find((m) => m.role === "assistant")?.content}
        </div>
      )}

      {/* live voice caption — shows what DARWIN is hearing */}
      {voiceStarted && !voice.muted && (voice.status === "listening" || voice.status === "recording" || voice.status === "processing" || voice.transcript) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-6">
          <div className="flex max-w-xl items-center gap-2 rounded-full border border-accent/25 bg-black/50 px-4 py-1.5 backdrop-blur-md">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", voice.status === "recording" ? "bg-accent animate-hud-pulse" : voice.status === "processing" ? "bg-warning animate-hud-pulse" : "bg-accent/60 animate-hud-pulse")} />
            <span className="truncate text-sm text-foreground/90">
              {voice.transcript
                ? <>“{voice.transcript}”</>
                : voice.error && voice.status !== "recording" ? <span className="text-warning">{voice.error}</span>
                : voice.status === "processing" ? "Thinking…"
                : voice.status === "recording" ? "Listening…"
                : "Listening… say “find cafes in London”"}
            </span>
          </div>
        </div>
      )}

      {/* live activity stream */}
      <ActivityStream items={overview?.recentActivity ?? []} connected={overview?.hasConnectedDiscovery ?? false} />
      </div>

      {/* discovered leads — liquid-glass popup */}
      {leadsPopup && <LeadsPopup data={leadsPopup} onClose={() => setLeadsPopup(null)} />}
    </div>
  );
}

/* ================= LEADS POPUP (liquid glass) ================= */
const SOURCE_LABEL: Record<string, string> = {
  google_places: "Google Places", geoapify: "Geoapify", foursquare: "Foursquare", openstreetmap: "OpenStreetMap",
};

function LeadsPopup({ data, onClose }: { data: LeadsResult; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => { setClosing(true); setTimeout(onClose, 320); }, [onClose]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const src = data.source ? (SOURCE_LABEL[data.source] ?? data.source) : "—";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6"
      style={{ animation: closing ? "dw-scrim-out .3s ease forwards" : "dw-scrim-in .35s ease" }}>
      {/* scrim */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      {/* liquid-glass panel */}
      <div className="relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-[26px] border border-white/15"
        style={{
          background: "linear-gradient(150deg, hsl(0 0% 100% / 0.10), hsl(210 60% 12% / 0.34))",
          backdropFilter: "blur(22px) saturate(140%)", WebkitBackdropFilter: "blur(22px) saturate(140%)",
          boxShadow: "0 40px 120px -30px hsl(var(--accent)/0.7), inset 0 1px 0 hsl(0 0% 100% / 0.25), inset 0 0 80px -40px hsl(var(--accent)/0.6)",
          animation: closing ? "ev-dissolve .32s ease forwards" : "dw-pop-in .5s cubic-bezier(.2,.9,.25,1.15) both",
        }}>
        {/* moving sheen */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]">
          <div className="absolute -inset-y-10 -left-1/3 w-1/3 -skew-x-12 bg-white/10 blur-md" style={{ animation: "ev-sheen 2.4s ease-in-out .3s" }} />
        </div>

        {/* header */}
        <div className="relative flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-accent-bright drop-glow" />
              <h2 className="hud-label text-sm tracking-[0.28em] text-accent-bright">DISCOVERED LEADS</h2>
            </div>
            <p className="mt-1 text-[11px] text-foreground/70">
              <span className="text-foreground/90">{data.found}</span> found · <span className="text-success">{data.created}</span> new · <span className="text-muted-foreground">{data.duplicates} dup</span> · via <span className="text-accent">{src}</span>
            </p>
          </div>
          <button onClick={close} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-muted-foreground transition hover:border-destructive/60 hover:text-destructive" aria-label="Close">✕</button>
        </div>

        {/* leads list */}
        <div className="relative flex-1 space-y-2 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "thin" }}>
          {data.error ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="text-2xl">⚠️</span>
              <p className="text-sm text-warning">Search couldn&apos;t complete</p>
              <p className="max-w-sm text-[11px] leading-snug text-muted-foreground">{data.error}</p>
            </div>
          ) : data.leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Radar className="h-7 w-7 text-accent/60" />
              <p className="text-sm text-foreground/85">No real businesses matched</p>
              <p className="max-w-sm text-[11px] leading-snug text-muted-foreground">
                DARWIN found 0 for “{data.query}”. Try a broader category (Cafe, Restaurant, Salon, Gym), a bigger radius, and turn off the Has/No-website and Phone/Email filters. DARWIN never invents leads.
              </p>
            </div>
          ) : data.leads.map((l, i) => (
            <div key={`${l.businessName}-${i}`}
              className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5"
              style={{ opacity: 0, animation: `dw-card-in .5s ${Math.min(i * 0.06, 1.2)}s cubic-bezier(.2,.9,.25,1.1) both` }}>
              {/* index chip */}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-foreground/95">{l.businessName}</span>
                  {l.website
                    ? <span className="shrink-0 rounded-full bg-success/15 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-success">web</span>
                    : <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-warning">no site</span>}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {[l.category, l.location].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              {/* contact chips */}
              <div className="flex shrink-0 items-center gap-1.5">
                {l.phone && <span title={l.phone} className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] text-foreground/70">☎</span>}
                {l.website && <a href={l.website} target="_blank" rel="noopener noreferrer" title={l.website} className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] text-accent hover:bg-accent/10">↗</a>}
                {l.instagram && <a href={l.instagram} target="_blank" rel="noopener noreferrer" title="Instagram" className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] text-accent hover:bg-accent/10">IG</a>}
              </div>
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="relative border-t border-white/10 px-5 py-3 text-center">
          <p className="text-[10px] text-muted-foreground">
            {data.error
              ? "Fix the issue above and try again — DARWIN only shows real, verified businesses."
              : data.leads.length === 0
                ? "Adjust the filters on the left and run another discovery."
                : "Stored in the CRM. Ask DARWIN to qualify or draft outreach — say “qualify these” or “deactivate”."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================= BOOT SEQUENCE ================= */
function DarwinBoot({ fading }: { fading: boolean }) {
  const lines = ["INITIALIZING NEURAL CORE", "LINKING DATA SOURCES", "CALIBRATING LEAD INTELLIGENCE", "DARWIN ONLINE"];
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#04060d]"
      style={{ animation: fading ? "dw-boot-out .7s ease forwards" : undefined }}
    >
      {/* scanline sweep */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 h-24 bg-[linear-gradient(to_bottom,transparent,hsl(var(--accent)/0.18),transparent)]" style={{ animation: "dw-scan 1.9s ease-in-out" }} />
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--accent)/0.14),transparent_60%)] blur-2xl" />
      </div>

      {/* assembling rings + hex */}
      <div className="relative mb-6 h-40 w-40">
        <span className="absolute inset-0 rounded-full border border-accent/30" style={{ animation: "dw-ring-in .8s ease both" }} />
        <span className="absolute inset-3 rounded-full border border-dashed border-accent/40" style={{ animation: "edith-spin 4s linear infinite, dw-ring-in .9s ease both" }} />
        <span className="absolute inset-8 rounded-full border border-accent-bright/50" style={{ animation: "dw-ring-in 1s ease both" }} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center text-lg font-semibold text-white"
            style={{ clipPath: "polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)", background: "linear-gradient(160deg, hsl(var(--accent)/0.5), hsl(280 70% 55% / 0.5))", boxShadow: "0 0 30px hsl(var(--accent-bright))", animation: "dw-hex-pop .6s .3s ease both" }}>
            AI
          </span>
        </span>
      </div>

      <h1 className="bg-gradient-to-r from-accent via-accent-bright to-accent bg-clip-text text-3xl font-light tracking-[0.5em] text-transparent" style={{ animation: "dw-hex-pop .7s .2s ease both" }}>
        DARWIN
      </h1>
      <div className="relative mt-4 h-4 w-72 text-center">
        {lines.map((l, i) => (
          <div key={l} className="hud-label absolute inset-x-0 text-[10px] tracking-[0.3em] text-accent/80" style={{ opacity: 0, animation: `dw-line 1.9s ${i * 0.45}s ease both` }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= LEAD DISCOVERY ================= */
interface SearchForm { category?: string; location: string; radiusKm?: number; limit?: number; hasWebsite?: boolean; noWebsite?: boolean; needsPhone?: boolean; needsEmail?: boolean }

function LeadDiscovery({ onSearch, searching, msg, keyedSource }: { onSearch: (f: SearchForm) => void; searching: boolean; msg: string; keyedSource: boolean }) {
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [radius, setRadius] = useState(5);
  const [limit, setLimit] = useState(50);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [noWebsite, setNoWebsite] = useState(false);
  const [quality, setQuality] = useState("Any");
  const [needsPhone, setNeedsPhone] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);

  const submit = () => {
    if (!location.trim() || searching) return;
    onSearch({ category: category.trim() || undefined, location: location.trim(), radiusKm: radius, limit, hasWebsite: hasWebsite || quality === "High", noWebsite, needsPhone, needsEmail });
  };

  return (
    <GlassPanel title="LEAD DISCOVERY">
      <div className="space-y-2.5">
        <Row label="Business category">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Cafe | Tech | Retail" className="dw-input" />
        </Row>
        <div className="flex gap-1">
          {["Cafe", "Tech", "Retail", "Salon", "Gym"].map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cn("rounded-full border px-2 py-0.5 text-[9px] transition", category === c ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>{c}</button>
          ))}
        </div>
        <Row label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="London, UK" className="dw-input" /></Row>
        <Row label="Radius"><div className="flex items-center gap-1"><input type="number" min={1} max={50} value={radius} onChange={(e) => setRadius(+e.target.value)} className="dw-input w-16 text-right" /><span className="text-[10px] text-muted-foreground">km</span></div></Row>
        <Row label="Number of leads"><input type="number" min={1} max={60} value={limit} onChange={(e) => setLimit(+e.target.value)} className="dw-input w-20 text-right" /></Row>

        <div className="flex gap-2">
          <Toggle active={hasWebsite} onClick={() => { setHasWebsite((v) => !v); setNoWebsite(false); }} label="Has website" />
          <Toggle active={noWebsite} onClick={() => { setNoWebsite((v) => !v); setHasWebsite(false); }} label="No website" />
        </div>
        <Row label="Website quality">
          <select value={quality} onChange={(e) => setQuality(e.target.value)} className="dw-input"><option>Any</option><option>High</option><option>Weak</option></select>
        </Row>
        <div className="flex flex-wrap gap-2">
          <Toggle active={needsPhone} onClick={() => setNeedsPhone((v) => !v)} label="Phone available" />
          <Toggle active={needsEmail} onClick={() => setNeedsEmail((v) => !v)} label="Email available" />
        </div>

        <button onClick={submit} disabled={searching || !location.trim()} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/12 px-3 py-2 text-sm text-accent-bright transition hover:bg-accent/20 disabled:opacity-40">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {searching ? "Discovering…" : "Discover Leads"}
        </button>
        {!keyedSource && <p className="text-[10px] leading-snug text-muted-foreground">Using the free OpenStreetMap fallback (no key). Add GEOAPIFY_API_KEY or GOOGLE_PLACES_API_KEY for richer, faster data. Real data only — never invented.</p>}
        {msg && <p className="text-[10px] leading-snug text-muted-foreground">{msg}</p>}
      </div>
    </GlassPanel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>{children}</div>;
}
function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition", active ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent/50")}>{active ? "✓" : ""} {label}</button>;
}

/* ================= INTELLIGENCE ================= */
function Intelligence({ intel, hasData }: { intel?: Overview["intelligence"]; hasData: boolean }) {
  const rows: { label: string; value: number; tone?: string }[] = [
    { label: "Businesses Found", value: intel?.businessesFound ?? 0 },
    { label: "Verified Leads", value: intel?.verifiedLeads ?? 0, tone: "text-success" },
    { label: "No Website", value: intel?.noWebsite ?? 0 },
    { label: "Weak Website", value: intel?.weakWebsite ?? 0, tone: "text-warning" },
    { label: "High Potential", value: intel?.highPotential ?? 0, tone: "text-accent-bright" },
    { label: "Contactable Leads", value: intel?.contactable ?? 0 },
  ];
  return (
    <GlassPanel title="INTELLIGENCE">
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between border-b border-white/5 pb-2 last:border-0">
            <div>
              <div className="text-[10px] text-muted-foreground">{r.label}</div>
              <div className={cn("text-2xl font-light leading-none", r.tone ?? "text-foreground/90")}>{r.value}</div>
            </div>
            <Spark value={r.value} tone={r.tone} />
          </div>
        ))}
        {!hasData && <p className="text-[10px] leading-snug text-muted-foreground">All zero — no real leads yet. Run a discovery.</p>}
      </div>
    </GlassPanel>
  );
}

/** Small decorative trend line (not a data claim — the number is the data). */
function Spark({ value, tone }: { value: number; tone?: string }) {
  const pts = useMemo(() => {
    // Stable pseudo-shape seeded by the value; flat when value is 0.
    let seed = (value * 2654435761) % 100 || 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const n = 10, base = value === 0 ? 0.5 : 0.35;
    return Array.from({ length: n }, (_, i) => {
      const y = value === 0 ? 0.5 : Math.max(0.1, Math.min(0.9, base + rnd() * 0.5 + i * 0.02));
      return `${(i / (n - 1)) * 56},${16 - y * 14}`;
    }).join(" ");
  }, [value]);
  const stroke = tone === "text-warning" ? "hsl(var(--warning))" : tone === "text-success" ? "hsl(var(--success))" : "hsl(var(--accent-bright))";
  return (
    <svg width="60" height="18" viewBox="0 0 56 18" className="shrink-0 opacity-70">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ================= GLASS CYLINDER + NEURAL CORE ================= */
function GlassCylinder({ state, level }: { state: DarwinState; level: number }) {
  const searching = state === "SEARCHING" || state === "PROCESSING";
  return (
    <div className="relative flex flex-col items-center" style={{ animation: "ev-breathe 6s ease-in-out infinite" }}>
      {/* capsule */}
      <div className="relative h-[340px] w-[260px] overflow-hidden rounded-[42px] border border-white/15 md:h-[380px] md:w-[300px]"
        style={{ background: "linear-gradient(160deg, hsl(0 0% 100% / 0.10), hsl(210 60% 12% / 0.30))", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", boxShadow: "0 30px 90px -30px hsl(var(--accent)/0.6), inset 0 1px 0 hsl(0 0% 100% / 0.25), inset 0 0 60px -30px hsl(var(--accent)/0.6)" }}>
        {/* glass sheen */}
        <div className="pointer-events-none absolute -left-1/3 top-0 h-full w-1/3 -skew-x-12 bg-white/10 blur-md" />
        <NeuralSphere active={searching} level={level} />
      </div>
      {/* base */}
      <div className="mt-1 h-3 w-[180px] rounded-[50%] bg-[radial-gradient(ellipse,hsl(var(--accent)/0.45),transparent_70%)] blur-[2px] md:w-[210px]" />
      <div className="-mt-1 h-2 w-[150px] rounded-[50%] bg-black/50 blur-md" />
    </div>
  );
}

function NeuralSphere({ active, level }: { active: boolean; level: number }) {
  const { nodes, edges } = useMemo(() => {
    const N = 40, R = 96, cx = 130, cy = 150;
    const nodes = Array.from({ length: N }, (_, i) => {
      const a = (i * 137.5) * (Math.PI / 180);
      const rr = R * Math.sqrt((i + 0.5) / N);
      return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.92, r: 0.8 + (i % 4) * 0.5 };
    });
    const edges: [number, number][] = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      if (Math.hypot(dx, dy) < 34) edges.push([i, j]);
    }
    return { nodes, edges };
  }, []);
  const A = "hsl(var(--accent))"; const AB = "hsl(var(--accent-bright))"; const P = "hsl(280 80% 70%)";
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg viewBox="0 0 260 300" className="h-full w-full">
        {/* soft sphere glow */}
        <circle cx="130" cy="150" r="104" fill="url(#dw-glow)" />
        <defs>
          <radialGradient id="dw-glow" cx="50%" cy="45%" r="55%"><stop offset="0%" stopColor={AB} stopOpacity="0.22" /><stop offset="55%" stopColor={P} stopOpacity="0.10" /><stop offset="100%" stopColor={A} stopOpacity="0" /></radialGradient>
        </defs>
        <g style={{ transformOrigin: "130px 150px", animation: `edith-spin ${active ? 26 : 60}s linear infinite` }}>
          <g stroke={A} strokeOpacity={active ? 0.28 : 0.16} strokeWidth="0.5">
            {edges.map(([a, b], i) => <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} />)}
          </g>
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={i % 5 === 0 ? P : i % 2 ? AB : A}
              style={{ filter: `drop-shadow(0 0 3px ${i % 2 ? AB : A})` }} className={active && i % 3 === 0 ? "animate-hud-pulse" : ""} />
          ))}
        </g>
        {/* scanning ring */}
        <ellipse cx="130" cy="150" rx="100" ry="94" fill="none" stroke={AB} strokeOpacity={active ? 0.5 : 0.25} strokeWidth="1" strokeDasharray="4 10" style={{ transformOrigin: "130px 150px", animation: `edith-spin ${active ? 7 : 20}s linear infinite` }} />
      </svg>
      {/* DARWIN AI hex badge */}
      <div className="absolute flex flex-col items-center">
        <div className="relative flex h-16 w-16 items-center justify-center" style={{ clipPath: "polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)", background: "linear-gradient(160deg, hsl(var(--accent)/0.35), hsl(280 70% 55% / 0.35))", boxShadow: `0 0 24px ${AB}` }}>
          <div className="text-center">
            <div className="text-[8px] tracking-[0.3em] text-foreground/80">DARWIN</div>
            <div className="text-lg font-semibold leading-none text-white">AI</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= LIVE ACTIVITY STREAM ================= */
function ActivityStream({ items, connected }: { items: Overview["recentActivity"]; connected: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  return (
    <div className="relative z-10 mx-auto mt-4 max-w-6xl">
      <GlassPanel title="LIVE ACTIVITY STREAM">
        {items.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">{connected ? "Awaiting activity — run a discovery to see the live stream." : "No source connected — DARWIN shows only real activity, never sample data."}</p>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => scroll(-1)} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent md:flex"><ChevronLeft className="h-4 w-4" /></button>
            <div ref={ref} className="grid flex-1 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-x-8 gap-y-1 overflow-x-auto pb-1 md:grid-flow-row md:grid-cols-3 md:overflow-visible" style={{ scrollbarWidth: "none" }}>
              {items.slice(0, 9).map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-0.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: streamColor(a.type), boxShadow: `0 0 6px ${streamColor(a.type)}` }} />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-foreground/85">{a.detail}</div>
                    <div className="text-[8px] text-muted-foreground">{timeAgo(a.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => scroll(1)} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent md:flex"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
function streamColor(type: string): string {
  if (/sent|won|verified|discovered/.test(type)) return "hsl(var(--success))";
  if (/failed|lost/.test(type)) return "hsl(var(--warning))";
  return "hsl(var(--accent-bright))";
}

/* ================= shared ================= */
function GlassPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-2xl border border-accent/15 bg-white/[0.03] px-4 py-3 backdrop-blur-xl" style={{ boxShadow: "0 10px 50px -24px hsl(var(--accent)/0.5), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}>
      <div className="mb-2 flex items-center gap-1.5">
        <Radar className="h-3 w-3 text-accent/70" />
        <span className="hud-label text-[10px] tracking-[0.28em] text-accent/80">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Dust() {
  const dots = useMemo(() => Array.from({ length: 22 }, () => ({ x: Math.random() * 100, y: Math.random() * 100, d: 6 + Math.random() * 10, delay: Math.random() * 6, s: 1 + Math.random() * 2 })), []);
  return <div className="absolute inset-0">{dots.map((p, i) => <span key={i} className="absolute rounded-full bg-accent/40" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animation: `drift ${p.d}s ease-in-out ${p.delay}s infinite` }} />)}</div>;
}
