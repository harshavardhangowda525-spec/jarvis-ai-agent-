"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client for the local EDITH runtime (real dev subagent on the user's machine).
 * Pairs over a token-protected localhost WebSocket, streams real events
 * (tools, terminal output, file changes, capability check), and relays goals +
 * control signals. URL/token persist in localStorage for one-time pairing.
 */
export type EdithMode = "autonomous" | "confirmation" | "manual";
export type EdithConn = "disconnected" | "connecting" | "connected" | "unauthorized";

export interface EdithLine { id: string; text: string; tone: "info" | "tool" | "ok" | "error" | "warn"; at: number }
export interface EdithTask { id: string; label: string; status: "running" | "ok" | "error"; at: number }
export interface FileChange { id: string; kind: string; path: string; preview?: string }
export interface TerminalEntry { id: string; command: string; exitCode: number | null; stdout?: string; stderr?: string; durationMs?: number }
export interface Capabilities { [k: string]: any }
export interface ConfirmReq { title: string; detail?: string; level?: string }

const LS_URL = "jarvis.edith.url";
const LS_TOKEN = "jarvis.edith.token";
let seq = 0;
const uid = () => `e${Date.now()}_${seq++}`;

export function useEdith() {
  const [conn, setConn] = useState<EdithConn>("disconnected");
  const [provider, setProvider] = useState<string | null>(null);
  const [mode, setModeState] = useState<EdithMode>("confirmation");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [activity, setActivity] = useState<EdithLine[]>([]);
  const [tasks, setTasks] = useState<EdithTask[]>([]);
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

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  /** Speak text in EDITH's own (British) voice via the shared TTS endpoint. */
  const speak = useCallback(async (text: string) => {
    if (mutedRef.current || !text?.trim()) return;
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 800), agent: "edith" }),
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
      setSavedUrl(localStorage.getItem(LS_URL) || "ws://127.0.0.1:7420");
      setSavedToken(localStorage.getItem(LS_TOKEN) || "");
    } catch { /* storage blocked */ }
  }, []);

  const push = useCallback((text: string, tone: EdithLine["tone"]) => {
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
    catch { setConn("disconnected"); push("Invalid EDITH URL.", "error"); return; }
    wsRef.current = ws;

    ws.onopen = () => setConn("connected");
    ws.onclose = (e) => {
      wsRef.current = null;
      if (e.code === 4001) { setConn("unauthorized"); push("Pairing rejected — check the token.", "error"); return; }
      if (!manualClose.current) { setConn("disconnected"); push("EDITH disconnected.", "warn"); }
      setWorking(false);
    };

    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
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
            const st: EdithTask["status"] = m.status === "ok" ? "ok" : "error";
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
        case "file": setFiles((f) => [{ id: uid(), kind: m.kind, path: m.path, preview: m.preview }, ...f].slice(0, 60)); break;
        case "confirm": setConfirm({ title: m.title, detail: m.detail, level: m.level }); push(`Awaiting confirmation: ${m.title}`, "warn"); break;
        case "cancelled": push(`Cancelled: ${m.label}`, "warn"); break;
        case "ask": push(`⚠ ${m.message}`, "warn"); setWorking(false); speak(m.message); break;
        case "stopped": push(m.message || "Stopped.", "warn"); setWorking(false); setConfirm(null); break;
        case "report": push(`✓ ${m.report}`, "ok"); speak(m.report); break;
        case "result": setWorking(false); setConfirm(null); push(`${m.ok ? "✓" : "✗"} ${m.message}`, m.ok ? "ok" : "error"); speak(m.message); break;
        case "preview": setPreview({ url: m.url, path: m.path }); push(`Preview ready: ${m.path}`, "ok"); break;
        case "error": push(`Error: ${m.message}`, "error"); setWorking(false); break;
        default: break;
      }
    };
  }, [push, speak]);

  /**
   * Auto-pair: ask the local EDITH for its token over the origin-locked HTTP
   * /pair endpoint and connect — no copy/paste. Returns why it failed so the UI
   * can guide the user (EDITH not running, or this origin isn't allow-listed).
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

  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !savedUrl) return;
    tried.current = true;
    // Reconnect instantly if we already paired; otherwise try a silent auto-pair.
    if (savedToken) connect(savedUrl, savedToken);
    else autoPair(savedUrl);
  }, [savedUrl, savedToken, connect, autoPair]);
  useEffect(() => () => { manualClose.current = true; wsRef.current?.close(); }, []);

  const send = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);
  const runGoal = useCallback((text: string) => { if (text.trim()) send({ op: "goal", text: text.trim() }); }, [send]);
  const setMode = useCallback((m: EdithMode) => { send({ op: "mode", mode: m }); setModeState(m); }, [send]);
  const stop = useCallback(() => send({ op: "stop" }), [send]);
  const answerConfirm = useCallback((approved: boolean) => { send({ op: "confirm", approved }); setConfirm(null); }, [send]);
  const refreshCaps = useCallback(() => send({ op: "capabilities" }), [send]);
  const requestPreview = useCallback(() => send({ op: "preview" }), [send]);
  const dismissPreview = useCallback(() => setPreview(null), []);

  return {
    conn, provider, mode, caps, workspace, activity, tasks, terminal, files, project, confirm, working, preview,
    savedUrl, savedToken, muted, setMuted, speak,
    connect, disconnect, autoPair, runGoal, setMode, stop, answerConfirm, refreshCaps, requestPreview, dismissPreview,
  };
}
