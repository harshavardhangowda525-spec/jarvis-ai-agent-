"use client";

import { useCallback, useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import type { IncidentDTO } from "@/lib/aston/types";
import { englishVoices, pickVoice, preferredVoiceName, setPreferredVoiceName, voiceLabel } from "@/lib/aston/voice";
import { Empty, Row } from "./holo";
import type { WakeState, LevelSource } from "./voice-hooks";
import type { RenderInfo } from "./aston-core";

export interface AiStatus { configured: boolean; model: string; status: string; blockedUntil: string | null; requestsToday: number; dailyCap: number; lastError: string | null }
export interface Turn { role: "user" | "assistant"; content: string; at?: number }

export interface Prefs {
  voice: boolean; wake: boolean; quality: "auto" | "full" | "lite"; parallax: boolean; motion: "system" | "reduced";
  /** Who writes websites: the owner's local Claude Code (on their plan), Groq, or Claude Code when available. */
  siteEngine: "auto" | "claude-code" | "groq"; claudeModel: "opus" | "sonnet" | "haiku";
  /** Hands-free: after answering, keep listening for the next phrase (no wake word, no tap). */
  conversation: boolean;
}
export const DEFAULT_PREFS: Prefs = { voice: true, wake: false, quality: "auto", parallax: true, motion: "system", siteEngine: "auto", claudeModel: "sonnet", conversation: true };
const PREFS_KEY = "aston.core.prefs";
export function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return DEFAULT_PREFS; }
}
export function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

const time = (iso: string | number) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export const AI_LABEL: Record<string, string> = { ok: "Online", rate_limited: "Rate-limited", quota_exhausted: "Free quota used up", outage: "Unreachable", auth_error: "Key rejected" };

/* ------------------------------------------------------------------ alerts */
export function AlertsBody({ incidents, busy, onAct, perm, onEnableAlerts }: {
  incidents: IncidentDTO[] | null; busy: string | null;
  onAct: (i: IncidentDTO, action: string) => void;
  perm: NotificationPermission | "unsupported"; onEnableAlerts: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!incidents) return <Empty>Loading alerts…</Empty>;
  const rank = { critical: 0, high: 1, normal: 2 } as const;
  const list = incidents.filter((i) => i.status === "open" || i.status === "acknowledged").sort((a, b) => rank[a.priority] - rank[b.priority] || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  return (
    <>
      {perm === "default" && <button className="ax-btn ax-btn-wide" onClick={onEnableAlerts}>Enable desktop alerts</button>}
      {perm === "denied" && <p className="ax-note">Desktop alerts are blocked in this browser. ASTON still speaks and shows them here.</p>}
      {!list.length && <Empty>No open alerts. ASTON is watching your builds, deploys, sites and agents.</Empty>}
      <ul className="ax-list">
        {list.map((i) => {
          const more = openId === i.id;
          const b = busy === i.id;
          return (
            <li key={i.id} className={`ax-card ax-p-${i.priority}`}>
              <div className="ax-card-top">
                <span className="ax-pill">{i.priority}</span>
                {i.project && <span className="ax-dim">{i.project}</span>}
                <span className="ax-dim ml-auto">{ago(i.lastSeenAt)}{i.occurrences > 1 ? ` · ×${i.occurrences}` : ""}</span>
              </div>
              <p className="ax-card-title">{i.summary ?? i.title}</p>
              {more && (
                <div className="ax-card-more">
                  <p><span>Problem</span> {i.title}</p>
                  {i.detail && <p className="whitespace-pre-line"><span>Details</span> {i.detail}</p>}
                  <p><span>Tried</span> {i.recovery.length ? i.recovery.map((s) => `${s.action} (${s.ok ? "ok" : "failed"})`).join("; ") : "nothing automatic — needs you"}</p>
                  {i.recommendation && <p><span>Next</span> {i.recommendation}</p>}
                  {i.verifyNote && <p className="ax-dim">{i.verifyNote}</p>}
                </div>
              )}
              <div className="ax-actions">
                <button className="ax-link" onClick={() => setOpenId(more ? null : i.id)}>{more ? "Less" : "Details"}</button>
                {i.status === "open" && <button className="ax-link" disabled={b} onClick={() => onAct(i, "acknowledge")}>Acknowledge</button>}
                <button className="ax-link" disabled={b} onClick={() => onAct(i, "resolve")}>Resolve</button>
                {i.pendingAction && <>
                  <button className="ax-link ax-warn" disabled={b} onClick={() => onAct(i, "approve")}>Approve {i.pendingAction.type}</button>
                  <button className="ax-link" disabled={b} onClick={() => onAct(i, "reject")}>Decline</button>
                </>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ AI provider */
interface GroqCheck { ok: boolean; model: string; modelListed: boolean | null; toolCalling: boolean | null; jsonOutput: boolean | null; latencyMs: number | null; error: string | null }

export function AiBody({ ai }: { ai: AiStatus | null }) {
  const [check, setCheck] = useState<GroqCheck | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setRunning(true); setErr(null);
    try {
      const r = await fetch("/api/aston/ai/check", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setCheck(j.data);
    } catch (e: any) { setErr(e?.message ?? "The check failed."); } finally { setRunning(false); }
  };
  if (!ai) return <Empty>Loading…</Empty>;
  const tone = !ai.configured ? "bad" : ai.status === "ok" ? "ok" : "warn";
  const yn = (v: boolean | null) => (v == null ? "—" : v ? "Yes" : "No");
  return (
    <>
      <Row k="Provider" v="Groq (free tier) — no paid fallback" />
      <Row k="Status" v={ai.configured ? AI_LABEL[ai.status] ?? ai.status : "Not configured — set GROQ_API_KEY"} tone={tone} />
      <Row k="Model" v={ai.model} />
      {ai.blockedUntil && <Row k="Paused until" v={time(ai.blockedUntil)} tone="warn" />}
      <div className="ax-meter" aria-label={`${ai.requestsToday} of ${ai.dailyCap} requests used today`}>
        <span style={{ width: `${Math.min(100, (ai.requestsToday / Math.max(1, ai.dailyCap)) * 100)}%` }} />
      </div>
      <p className="ax-dim ax-small">{ai.requestsToday} of {ai.dailyCap} requests today (ASTON&apos;s own daily cap)</p>
      {ai.lastError && <p className="ax-note">Last error: {ai.lastError}</p>}
      <button className="ax-btn ax-btn-wide" onClick={run} disabled={running || !ai.configured}>{running ? "Checking with Groq…" : "Run a live check"}</button>
      {err && <p className="ax-note">{err}</p>}
      {check && (
        <div className="ax-group">
          <Row k="Model listed" v={yn(check.modelListed)} tone={check.modelListed ? "ok" : "bad"} />
          <Row k="Tool calling" v={yn(check.toolCalling)} tone={check.toolCalling ? "ok" : "bad"} />
          <Row k="JSON output" v={yn(check.jsonOutput)} tone={check.jsonOutput ? "ok" : "bad"} />
          {check.latencyMs != null && <Row k="Latency" v={`${check.latencyMs} ms`} />}
          {check.error && <p className="ax-note">{check.error}</p>}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ voice */
export function VoiceBody({ prefs, setPrefs, wake, onWakeRetry, micPerm, onPreview }: {
  prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; wake: WakeState; onWakeRetry: () => void;
  micPerm: string; onPreview: () => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chosen, setChosen] = useState("");
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(englishVoices());
    load();
    setChosen(preferredVoiceName());
    speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, []);
  const synth = typeof speechSynthesis !== "undefined";
  const current = synth ? pickVoice() : null;
  const wakeText: Record<WakeState, string> = {
    off: "Off", on: "Listening for “ASTON”", capturing: "Listening for your command", unsupported: "Not supported in this browser",
    denied: "Microphone blocked", "needs-tap": "Tap to start",
  };
  return (
    <>
      <label className="ax-toggle"><input type="checkbox" checked={prefs.voice} onChange={(e) => setPrefs({ voice: e.target.checked })} /> <span>Spoken replies</span></label>
      {synth ? (
        <>
          <label className="ax-field">
            <span>Voice</span>
            <select value={chosen} onChange={(e) => { setChosen(e.target.value); setPreferredVoiceName(e.target.value); }}>
              <option value="">Automatic — British English when available</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
            </select>
          </label>
          <Row k="Speaking with" v={current ? `${current.name} · ${voiceLabel(current)}` : "The browser's default voice"} />
          <button className="ax-btn ax-btn-wide" onClick={onPreview}><Volume2 size={15} aria-hidden /> Preview voice</button>
        </>
      ) : <p className="ax-note">This browser has no speech output — ASTON&apos;s replies appear as text.</p>}
      <div className="ax-group">
        <label className="ax-toggle"><input type="checkbox" checked={prefs.wake} onChange={(e) => setPrefs({ wake: e.target.checked })} disabled={wake === "unsupported"} /> <span>Hands-free — listen for “ASTON”</span></label>
        <label className="ax-toggle"><input type="checkbox" checked={prefs.conversation} onChange={(e) => setPrefs({ conversation: e.target.checked })} disabled={wake === "unsupported"} /> <span>Conversation mode — keep listening after each answer</span></label>
        <Row k="Wake word" v={wakeText[wake]} tone={wake === "on" || wake === "capturing" ? "ok" : wake === "denied" ? "bad" : "dim"} />
        <Row k="Microphone" v={micPerm} tone={micPerm === "Allowed" ? "ok" : micPerm === "Blocked" ? "bad" : "dim"} />
        {(wake === "denied" || wake === "needs-tap") && <button className="ax-btn" onClick={onWakeRetry}>Try the microphone again</button>}
        <p className="ax-dim ax-small">
          Say “ASTON” and then your command, or “ASTON, build a website for a café”. With conversation mode on, just keep talking after each answer —
          no need to say “ASTON” again. Say “that&apos;s all” (or stay quiet for 10 seconds) to end the conversation. It works while this tab is open in Chrome or Edge;
          browsers don&apos;t allow listening in the background or with the tab hidden. Chrome sends what it hears to its speech service to recognise it.
          On Android, Chrome may chime each time listening restarts.
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ conversation */
export function ConversationBody({ turns, onReplay, onClear }: { turns: Turn[]; onReplay: (t: string) => void; onClear: () => void }) {
  if (!turns.length) return <Empty>Nothing yet. Type below or tap the core and speak.</Empty>;
  return (
    <>
      <ul className="ax-chat">
        {turns.map((t, i) => (
          <li key={i} className={t.role === "user" ? "ax-you" : "ax-aston"}>
            <span className="ax-who">{t.role === "user" ? "You" : "ASTON"}{t.at ? ` · ${time(t.at)}` : ""}</span>
            <p>{t.content}</p>
            {t.role === "assistant" && <button className="ax-link ax-small" onClick={() => onReplay(t.content)}>Say again</button>}
          </li>
        ))}
      </ul>
      <button className="ax-btn" onClick={onClear}>Clear this conversation</button>
      <p className="ax-dim ax-small">Kept for this visit only. ASTON remembers the last 20 turns as context.</p>
    </>
  );
}

/* ------------------------------------------------------------------ activity */
interface ActivityEvent { id: string; timestamp: string; agent: string; action: string; result: string | null; status: string; category: string; project: string | null }

export function ActivityBody() {
  const [rows, setRows] = useState<ActivityEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [agent, setAgent] = useState("All");
  const load = useCallback(async () => {
    setErr(null);
    const d = (o: number) => { const x = new Date(Date.now() + o * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const r = await fetch(`/api/activity?from=${d(-1)}&to=${d(0)}&tz=${encodeURIComponent(tz)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRows([...(j.data.events as ActivityEvent[])].reverse());
    } catch (e: any) { setErr(e?.message ?? "Couldn't load activity."); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Empty>Loading activity…</Empty>;
  const agents = ["All", ...Array.from(new Set(rows.map((r) => r.agent))).sort()];
  const shown = rows.filter((r) => agent === "All" || r.agent === agent).slice(0, 60);
  return (
    <>
      {agents.length > 2 && (
        <div className="ax-chips" role="tablist" aria-label="Filter by agent">
          {agents.map((a) => <button key={a} role="tab" aria-selected={agent === a} className={agent === a ? "ax-chip ax-chip-on" : "ax-chip"} onClick={() => setAgent(a)}>{a}</button>)}
        </div>
      )}
      {err && <p className="ax-note">{err} <button className="ax-link" onClick={load}>Retry</button></p>}
      {!err && !shown.length && <Empty>No agent activity since yesterday.</Empty>}
      <ul className="ax-feed">
        {shown.map((e) => (
          <li key={e.id}>
            <span className={`ax-dot ax-dot-${e.status === "failed" ? "bad" : e.status === "success" ? "ok" : "dim"}`} aria-hidden />
            <div>
              <p>{e.action}</p>
              <span className="ax-dim ax-small">{e.agent}{e.project ? ` · ${e.project}` : ""} · {time(e.timestamp)}</span>
            </div>
          </li>
        ))}
      </ul>
      <button className="ax-btn" onClick={load}>Refresh</button>
    </>
  );
}

/* ------------------------------------------------------------------ diagnostics */
export interface Diag {
  serverOk: boolean | null; lastSync: number | null; serverError: string | null;
  ai: AiStatus | null; render: RenderInfo | null; wake: WakeState; level: LevelSource;
  micPerm: string; notif: string; recognition: boolean; synthesis: boolean; voices: number; reduced: boolean; wordSync: boolean | null;
}

export function DiagnosticsBody({ d, onRefresh }: { d: Diag; onRefresh: () => void }) {
  const yes = (b: boolean) => (b ? "Available" : "Not available");
  return (
    <>
      <div className="ax-group">
        <h3>Server</h3>
        <Row k="ASTON server" v={d.serverOk == null ? "Checking…" : d.serverOk ? "Reachable" : "Unreachable"} tone={d.serverOk ? "ok" : d.serverOk == null ? "dim" : "bad"} />
        {d.lastSync && <Row k="Last sync" v={time(d.lastSync)} />}
        {d.serverError && <p className="ax-note">{d.serverError}</p>}
        <Row k="Groq" v={!d.ai ? "—" : d.ai.configured ? AI_LABEL[d.ai.status] ?? d.ai.status : "Not configured"} tone={d.ai?.configured && d.ai.status === "ok" ? "ok" : "warn"} />
      </div>
      <div className="ax-group">
        <h3>This device</h3>
        <Row k="Core renderer" v={d.render ? (d.render.mode === "webgl" ? `WebGL · ${d.render.quality === "full" ? "full quality" : "lite"} · ${d.render.fps} fps` : "Still image (no WebGL)") : "—"} />
        <Row k="Speech recognition" v={yes(d.recognition)} tone={d.recognition ? "ok" : "warn"} />
        <Row k="Speech output" v={d.synthesis ? `${d.voices} voice${d.voices === 1 ? "" : "s"}` : "Not available"} tone={d.synthesis ? "ok" : "warn"} />
        <Row k="Microphone" v={d.micPerm} tone={d.micPerm === "Allowed" ? "ok" : d.micPerm === "Blocked" ? "bad" : "dim"} />
        <Row k="Listening level" v={d.level === "microphone" ? "Live microphone level" : d.level === "speech-events" ? "From speech events" : "Idle"} />
        <Row k="Speech sync" v={d.wordSync == null ? "Not measured yet" : d.wordSync ? "Word by word" : "Start and end only (this voice has no word timings)"} />
        <Row k="Desktop alerts" v={d.notif} />
        <Row k="Reduced motion" v={d.reduced ? "On" : "Off"} />
      </div>
      <button className="ax-btn" onClick={onRefresh}>Refresh</button>
    </>
  );
}

/* ------------------------------------------------------------------ website engine */
interface Engines { claude: { available: boolean; reason: string | null; account: string | null; defaultModel: string }; groq: { available: boolean; status: string } }

export function EngineSettings({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void }) {
  const [e, setE] = useState<Engines | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async (fresh: boolean) => {
    setChecking(true); setErr(null);
    try {
      const r = await fetch(`/api/aston/engines${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setE(j.data);
    } catch (x: any) { setErr(x?.message ?? "Couldn't check."); } finally { setChecking(false); }
  }, []);
  useEffect(() => { check(false); }, [check]);
  const c = e?.claude;
  const uses = prefs.siteEngine === "groq" ? "Groq" : c?.available ? `Claude Code (${prefs.claudeModel})` : prefs.siteEngine === "claude-code" ? "Claude Code — not available" : "Groq (Claude Code not available)";
  return (
    <div className="ax-group">
      <h3>Website builder</h3>
      <Row k="Claude Code on this PC" v={!e ? (err ? "—" : "Checking…") : c?.available ? `Ready${c.account ? ` · ${c.account}` : ""}` : "Not available"} tone={!e ? "dim" : c?.available ? "ok" : "warn"} />
      {c && !c.available && c.reason && <p className="ax-note">{c.reason}</p>}
      {err && <p className="ax-note">{err}</p>}
      <label className="ax-field">
        <span>Who writes your websites</span>
        <select value={prefs.siteEngine} onChange={(ev) => setPrefs({ siteEngine: ev.target.value as Prefs["siteEngine"] })}>
          <option value="auto">Claude Code when available, otherwise Groq</option>
          <option value="claude-code">Always Claude Code (ask me if it&apos;s not available)</option>
          <option value="groq">Always Groq (free)</option>
        </select>
      </label>
      <label className="ax-field">
        <span>Claude model</span>
        <select value={prefs.claudeModel} onChange={(ev) => setPrefs({ claudeModel: ev.target.value as Prefs["claudeModel"] })} disabled={prefs.siteEngine === "groq"}>
          <option value="sonnet">Sonnet — fast, great sites (recommended)</option>
          <option value="opus">Opus — best design, uses more of your plan</option>
          <option value="haiku">Haiku — quickest, simpler sites</option>
        </select>
      </label>
      <Row k="Next website uses" v={uses} />
      <button className="ax-btn" onClick={() => check(true)} disabled={checking}>{checking ? "Checking…" : "Check Claude Code again"}</button>
      <p className="ax-dim ax-small">
        Claude Code runs on your Claude plan — no API key and no extra charge; each website uses part of your plan&apos;s usage.
        It works when ASTON runs on this PC with Claude Code installed and signed in. If your plan&apos;s limit is reached, ASTON stops and asks before using Groq.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ preferences */
export function PrefsBody({ prefs, setPrefs, perm, onEnableAlerts }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; perm: NotificationPermission | "unsupported"; onEnableAlerts: () => void }) {
  return (
    <>
      <label className="ax-toggle"><input type="checkbox" checked={prefs.voice} onChange={(e) => setPrefs({ voice: e.target.checked })} /> <span>Spoken replies</span></label>
      <label className="ax-toggle"><input type="checkbox" checked={prefs.wake} onChange={(e) => setPrefs({ wake: e.target.checked })} /> <span>Hands-free — listen for “ASTON”</span></label>
      <label className="ax-toggle"><input type="checkbox" checked={prefs.conversation} onChange={(e) => setPrefs({ conversation: e.target.checked })} /> <span>Conversation mode — keep listening after each answer</span></label>
      <label className="ax-toggle"><input type="checkbox" checked={prefs.parallax} onChange={(e) => setPrefs({ parallax: e.target.checked })} /> <span>Parallax — the core follows your pointer</span></label>
      <label className="ax-field">
        <span>Visual quality</span>
        <select value={prefs.quality} onChange={(e) => setPrefs({ quality: e.target.value as Prefs["quality"] })}>
          <option value="auto">Automatic — lighter on slow devices</option>
          <option value="full">Full</option>
          <option value="lite">Lite (saves battery)</option>
        </select>
      </label>
      <label className="ax-field">
        <span>Motion</span>
        <select value={prefs.motion} onChange={(e) => setPrefs({ motion: e.target.value as Prefs["motion"] })}>
          <option value="system">Follow my device setting</option>
          <option value="reduced">Reduced motion</option>
        </select>
      </label>
      <EngineSettings prefs={prefs} setPrefs={setPrefs} />
      <div className="ax-group">
        <Row k="Desktop alerts" v={perm === "granted" ? "On" : perm === "denied" ? "Blocked in this browser" : perm === "unsupported" ? "Not supported" : "Off"} tone={perm === "granted" ? "ok" : "dim"} />
        {perm === "default" && <button className="ax-btn" onClick={onEnableAlerts}>Enable desktop alerts</button>}
      </div>
      <p className="ax-dim ax-small">Saved in this browser.</p>
    </>
  );
}
