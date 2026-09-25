"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client for the local ULTRON runtime (real dev subagent on the user's machine).
 * Pairs over a token-protected localhost WebSocket, streams real events
 * (tools, terminal output, file changes, capability check), and relays goals +
 * control signals. URL/token persist in localStorage for one-time pairing.
 */
export type UltronMode = "autonomous" | "confirmation" | "manual";
export type UltronConn = "disconnected" | "connecting" | "connected" | "unauthorized";

export interface UltronLine { id: string; text: string; tone: "info" | "tool" | "ok" | "error" | "warn"; at: number }
export interface UltronTask { id: string; label: string; status: "running" | "ok" | "error"; at: number }
export interface FileChange { id: string; kind: string; path: string; preview?: string }
export interface TerminalEntry { id: string; command: string; exitCode: number | null; stdout?: string; stderr?: string; durationMs?: number }
export interface Capabilities { [k: string]: any }
export interface ConfirmReq { title: string; detail?: string; level?: string }
/** Raw runtime events, for visuals that react to each one (the motion core). */
export type UltronEvent =
  | { kind: "goal"; goal: string }
  | { kind: "tool"; name: string; label: string; status: "running" | "ok" | "error" }
  | { kind: "file"; change: string; path: string }
  | { kind: "terminal"; command: string; exitCode: number | null }
  | { kind: "result"; ok: boolean; message: string }
  | { kind: "stopped" | "error" | "ask" | "confirm" | "preview"; message?: string };

const LS_URL = "jarvis.ultron.url";
const LS_TOKEN = "jarvis.ultron.token";
// Pairing saved before the rename (EDITH → ULTRON) keeps working.
const OLD_LS_URL = "jarvis.edith.url";
const OLD_LS_TOKEN = "jarvis.edith.token";
let seq = 0;
const uid = () => `e${Date.now()}_${seq++}`;

export function useUltron() {
  const [conn, setConn] = useState<UltronConn>("disconnected");
  const [provider, setProvider] = useState<string | null>(null);
  const [mode, setModeState] = useState<UltronMode>("confirmation");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [activity, setActivity] = useState<UltronLine[]>([]);
  const [tasks, setTasks] = useState<UltronTask[]>([]);
  const [terminal, setTerminal] = useState<TerminalEntry[]>([]);
  const [files, setFiles] = useState<FileChange[]>([]);
  const [project, setProject] = useState<any>(null);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ url: string; path: string } | null>(null);
  const [savedUrl, setSavedUrl] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [muted, setMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const manualClose = useRef(false);
  const lastReportRef = useRef("");
  const listenersRef = useRef(new Set<(ev: UltronEvent) => void>());
  /** Subscribe to raw runtime events; returns an unsubscribe function. */
  const onEvent = useCallback((fn: (ev: UltronEvent) => void) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);
  const fire = useCallback((ev: UltronEvent) => { for (const fn of listenersRef.current) { try { fn(ev); } catch { /* a visual never breaks the runtime */ } } }, []);

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // When hands-free voice is on, ULTRON speaks through the shared voice engine,
  // which pauses the microphone while it talks — otherwise the mic hears
  // ULTRON's own report and sends it back as a new goal, over and over.
  const speakerRef = useRef<((text: string) => unknown) | null>(null);
  const setSpeaker = useCallback((fn: ((text: string) => unknown) | null) => { speakerRef.current = fn; }, []);
  const lastSpokenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  /** What ULTRON said in the last `withinMs` (to ignore it if the mic echoes it back). */
  const recentlySpoken = useCallback((withinMs = 20_000) => (Date.now() - lastSpokenRef.current.at < withinMs ? lastSpokenRef.current.text : ""), []);

  /** Speak text in ULTRON's own voice via the shared TTS endpoint. */
  const speak = useCallback(async (text: string) => {
    if (mutedRef.current || !text?.trim()) return;
    // ULTRON often reports and then states the same result — say it once.
    if (lastSpokenRef.current.text === text && Date.now() - lastSpokenRef.current.at < 5000) return;
    lastSpokenRef.current = { text, at: Date.now() };
    if (speakerRef.current) { speakerRef.current(text.slice(0, 800)); return; }
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 800), agent: "ultron" }),
      });
      if (!res.ok) return; // voice not configured — stay silent, no error noise
      const blob = await res.blob();
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.play().catch(() => {});
    } catch { /* ignore playback failures */ }
  }, []);

  useEffect(() => {
    try {
      setSavedUrl(localStorage.getItem(LS_URL) || localStorage.getItem(OLD_LS_URL) || "ws://127.0.0.1:7420");
      setSavedToken(localStorage.getItem(LS_TOKEN) || localStorage.getItem(OLD_LS_TOKEN) || "");
    } catch { /* storage blocked */ }
  }, []);

  const push = useCallback((text: string, tone: UltronLine["tone"]) => {
    setActivity((a) => [{ id: uid(), text, tone, at: Date.now() }, ...a].slice(0, 80));
  }, []);

  const disconnect = useCallback(() => {
    manualClose.current = true; wsRef.current?.close(); wsRef.current = null; setConn("disconnected");
  }, []);

  const connect = useCallback((url: string, token: string) => {
    if (!url || !token) return;
    try { localStorage.setItem(LS_URL, url); localStorage.setItem(LS_TOKEN, token); } catch { /* ignore */ }
    setSavedUrl(url); setSavedToken(token);
    manualClose.current = false; setConn("connecting");
    let ws: WebSocket;
    try { ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`); }
    catch { setConn("disconnected"); push("Invalid ULTRON URL.", "error"); return; }
    wsRef.current = ws;

    ws.onopen = () => setConn("connected");
    ws.onclose = (e) => {
      wsRef.current = null;
      if (e.code === 4001) { setConn("unauthorized"); push("Pairing rejected — check the token.", "error"); return; }
      if (!manualClose.current) { setConn("disconnected"); push("ULTRON disconnected.", "warn"); }
      setWorking(false);
    };

    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.kind) {
        case "goal": fire({ kind: "goal", goal: String(m.goal ?? "") }); break;
        case "tool": fire({ kind: "tool", name: String(m.name ?? ""), label: String(m.label ?? ""), status: m.status === "running" ? "running" : m.status === "ok" ? "ok" : "error" }); break;
        case "file": case "created": case "modified": case "deleted": fire({ kind: "file", change: String(m.change ?? m.kind), path: String(m.path ?? "") }); break;
        case "terminal": fire({ kind: "terminal", command: String(m.command ?? ""), exitCode: m.exitCode ?? null }); break;
        case "result": fire({ kind: "result", ok: !!m.ok, message: String(m.message ?? "") }); break;
        case "stopped": case "error": case "ask": case "confirm": case "preview": fire({ kind: m.kind, message: m.message }); break;
        default: break;
      }
      switch (m.kind) {
        case "hello": setProvider(m.provider); setModeState(m.mode); setCaps(m.capabilities); setWorkspace(m.workspace); setConn("connected"); break;
        case "capabilities": setCaps(m.capabilities); break;
        case "mode": setModeState(m.mode); break;
        case "goal": setWorking(true); setFiles([]); setTerminal([]); setTasks([]); setConfirm(null); push(`▸ ${m.goal}`, "tool"); break;
        case "project": setProject(m); push(`Project: ${m.framework} / ${m.packageManager}`, "info"); break;
        case "activity": push(m.label, "info"); break;
        case "tool":
          if (m.status === "running") {
            setTasks((t) => [{ id: uid(), label: m.label, status: "running" as const, at: Date.now() }, ...t].slice(0, 14));
            push(`${m.label}`, "tool");
          } else {
            const st: UltronTask["status"] = m.status === "ok" ? "ok" : "error";
            setTasks((t) => {
              const i = t.findIndex((x) => x.label === m.label && x.status === "running");
              if (i < 0) return [{ id: uid(), label: m.label, status: st, at: Date.now() }, ...t].slice(0, 14);
              const c = [...t]; c[i] = { ...c[i], status: st }; return c;
            });
            push(`${m.status === "ok" ? "✓" : "✗"} ${m.label} — ${m.summary ?? ""}`, m.status === "ok" ? "ok" : "error");
          }
          break;
        case "terminal":
          setTerminal((t) => [{ id: uid(), command: m.command, exitCode: m.exitCode, stdout: m.stdout, stderr: m.stderr, durationMs: m.durationMs }, ...t].slice(0, 40));
          break;
        case "file":
        // Older ULTRON runtimes sent the change type AS the message kind.
        case "created": case "modified": case "deleted":
          setFiles((f) => [{ id: uid(), kind: m.change ?? m.kind, path: m.path, preview: m.preview }, ...f].slice(0, 60));
          break;
        case "confirm": setConfirm({ title: m.title, detail: m.detail, level: m.level }); push(`Awaiting confirmation: ${m.title}`, "warn"); break;
        case "cancelled": push(`Cancelled: ${m.label}`, "warn"); break;
        case "ask": push(`⚠ ${m.message}`, "warn"); setWorking(false); speak(m.message); break;
        case "stopped": push(m.message || "Stopped.", "warn"); setWorking(false); setConfirm(null); break;
        case "report": lastReportRef.current = m.report; push(`✓ ${m.report}`, "ok"); speak(m.report); break;
        case "result":
          setWorking(false); setConfirm(null);
          // The result usually repeats the report word for word — show/say it once.
          if (m.message !== lastReportRef.current) { push(`${m.ok ? "✓" : "✗"} ${m.message}`, m.ok ? "ok" : "error"); speak(m.message); }
          lastReportRef.current = "";
          break;
        case "preview": setPreview({ url: m.url, path: m.path }); push(`Preview ready: ${m.path}`, "ok"); break;
        case "error": push(`Error: ${m.message}`, "error"); setWorking(false); break;
        default: break;
      }
    };
  }, [push, speak, fire]);

  /**
   * Auto-pair: ask the local ULTRON for its token over the origin-locked HTTP
   * /pair endpoint and connect — no copy/paste. Returns why it failed so the UI
   * can guide the user (ULTRON not running, or this origin isn't allow-listed).
   */
  const autoPair = useCallback(
    async (baseUrl?: string): Promise<{ ok: boolean; reason?: "unreachable" | "origin" | "no_token" | string }> => {
      const wsUrl = (baseUrl || savedUrl || "ws://127.0.0.1:7420").trim();
      const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://");
      try {
        const res = await fetch(`${httpUrl}/pair`, { method: "GET" });
        if (res.status === 403) return { ok: false, reason: "origin" };
        if (!res.ok) return { ok: false, reason: `http_${res.status}` };
        const j = await res.json();
        if (j?.token) { connect(j.url || wsUrl, j.token); return { ok: true }; }
        return { ok: false, reason: "no_token" };
      } catch {
        return { ok: false, reason: "unreachable" };
      }
    },
    [connect, savedUrl],
  );

  // Mirror connection state into a ref so the retry loop can read it live.
  const connRef = useRef(conn);
  connRef.current = conn;

  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const url = (savedUrl || "ws://127.0.0.1:7420").trim();
    // Reconnect instantly if we already have a token; otherwise auto-pair — and
    // keep retrying for a bit, since ULTRON may still be starting up when the
    // page loads. This makes the token auto-fill with zero clicks.
    if (savedToken) { connect(url, savedToken); return; }
    let attempts = 0;
    const tryPair = async () => {
      if (connRef.current === "connected" || connRef.current === "connecting") return;
      attempts += 1;
      const r = await autoPair(url);
      if (r.ok || r.reason === "origin") return; // paired, or blocked (needs manual)
      if (attempts < 6) setTimeout(tryPair, 2500); // ULTRON not up yet — retry
    };
    tryPair();
  }, [savedUrl, savedToken, connect, autoPair]);
  useEffect(() => () => { manualClose.current = true; wsRef.current?.close(); }, []);

  const send = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);
  // What JARVIS remembers about the user travels with every goal, so ULTRON
  // follows the same preferences (the local runtime has no database of its own).
  const prefsRef = useRef<string | null>(null);
  const loadPrefs = useCallback(async () => {
    try {
      const r = await fetch("/api/memories");
      if (!r.ok) return "";
      const mems: { key: string | null; content: string }[] = (await r.json()).data?.memories ?? [];
      prefsRef.current = mems.slice(0, 60).map((m) => `- ${m.key ? `${m.key}: ` : ""}${m.content}`).join("\n").slice(0, 4000);
    } catch { prefsRef.current = prefsRef.current ?? ""; }
    return prefsRef.current ?? "";
  }, []);
  useEffect(() => { void loadPrefs(); }, [loadPrefs]);
  const runGoal = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const context = await loadPrefs(); // fresh each time — memories can change mid-session
    send({ op: "goal", text: text.trim(), ...(context ? { context } : {}) });
  }, [send, loadPrefs]);
  const setMode = useCallback((m: UltronMode) => { send({ op: "mode", mode: m }); setModeState(m); }, [send]);
  const stop = useCallback(() => send({ op: "stop" }), [send]);
  const answerConfirm = useCallback((approved: boolean) => { send({ op: "confirm", approved }); setConfirm(null); }, [send]);
  const refreshCaps = useCallback(() => send({ op: "capabilities" }), [send]);
  const requestPreview = useCallback(() => send({ op: "preview" }), [send]);
  const dismissPreview = useCallback(() => setPreview(null), []);

  return {
    conn, provider, mode, caps, workspace, activity, tasks, terminal, files, project, confirm, working, preview,
    savedUrl, savedToken, muted, setMuted, speak, setSpeaker, recentlySpoken, onEvent,
    connect, disconnect, autoPair, runGoal, setMode, stop, answerConfirm, refreshCaps, requestPreview, dismissPreview,
  };
}
