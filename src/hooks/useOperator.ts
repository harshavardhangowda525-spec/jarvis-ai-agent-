"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client for the local JARVIS Operator service (visible browser control).
 *
 * The Operator runs on the user's own machine and exposes a token-protected
 * WebSocket on 127.0.0.1. This hook pairs with it, streams live activity, and
 * relays commands + control signals (stop / pause / resume / confirm / mode).
 *
 * The URL + token are stored in localStorage so pairing is a one-time step.
 */

export type OperatorMode = "autonomous" | "confirmation" | "manual";
export type ConnState = "disconnected" | "connecting" | "connected" | "unauthorized";

export interface ActivityLine {
  id: string;
  text: string;
  tone: "info" | "act" | "ok" | "error" | "warn";
}

export interface PlanView {
  application: string;
  summary: string;
  steps: string[];
}

export interface ConfirmView {
  title: string;
  detail?: string;
  risk?: string;
}

const LS_URL = "jarvis.operator.url";
const LS_TOKEN = "jarvis.operator.token";

let seq = 0;
const uid = () => `op${Date.now()}_${seq++}`;

function toneFor(kind: string, ok?: boolean): ActivityLine["tone"] {
  if (kind === "error" || kind === "actionError" || ok === false) return "error";
  if (kind === "did" || kind === "result") return "ok";
  if (kind === "acting" || kind === "command") return "act";
  if (kind === "needUser" || kind === "paused" || kind === "stopped") return "warn";
  return "info";
}

export function useOperator() {
  const [conn, setConn] = useState<ConnState>("disconnected");
  const [provider, setProvider] = useState<string | null>(null);
  const [mode, setModeState] = useState<OperatorMode>("confirmation");
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [confirm, setConfirm] = useState<ConfirmView | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const manualClose = useRef(false);

  useEffect(() => {
    try {
      setSavedUrl(localStorage.getItem(LS_URL) || "ws://127.0.0.1:7317");
      setSavedToken(localStorage.getItem(LS_TOKEN) || "");
    } catch { /* storage blocked */ }
  }, []);

  const push = useCallback((text: string, tone: ActivityLine["tone"]) => {
    setActivity((a) => [{ id: uid(), text, tone }, ...a].slice(0, 60));
  }, []);

  const disconnect = useCallback(() => {
    manualClose.current = true;
    wsRef.current?.close();
    wsRef.current = null;
    setConn("disconnected");
  }, []);

  const connect = useCallback((url: string, token: string) => {
    if (!url || !token) return;
    try {
      localStorage.setItem(LS_URL, url);
      localStorage.setItem(LS_TOKEN, token);
    } catch { /* ignore */ }
    setSavedUrl(url); setSavedToken(token);
    manualClose.current = false;
    setConn("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
    } catch {
      setConn("disconnected");
      push("Invalid Operator URL.", "error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => setConn("connected");
    ws.onclose = (e) => {
      wsRef.current = null;
      if (e.code === 4001) { setConn("unauthorized"); push("Pairing rejected — check the token.", "error"); return; }
      if (!manualClose.current) { setConn("disconnected"); push("Operator disconnected.", "warn"); }
    };
    ws.onerror = () => { if (conn === "connecting") push("Couldn't reach the Operator. Is it running?", "error"); };

    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.kind) {
        case "hello": setProvider(m.provider); if (m.mode) setModeState(m.mode); setConn("connected"); break;
        case "mode": setModeState(m.mode); break;
        case "command": push(`▸ ${m.command}`, "act"); setPlan(null); setConfirm(null); setLastResult(null); break;
        case "plan": setPlan({ application: m.application, summary: m.summary, steps: m.steps || [] }); push(`Plan: ${m.summary}`, "info"); break;
        case "observe": push(`Looking at: ${m.title || m.url}`, "info"); break;
        case "activity": push(m.label, "info"); break;
        case "acting": push(`${m.label}${m.risk === "high" ? " (high-impact)" : ""}`, "act"); break;
        case "did": push(`✓ ${m.label}`, "ok"); break;
        case "actionError": push(`✗ ${m.label}`, "error"); break;
        case "suggest": push(`Suggestion: ${m.label}`, "info"); break;
        case "confirm": setConfirm({ title: m.title, detail: m.detail, risk: m.risk }); push(`Awaiting confirmation: ${m.title}`, "warn"); break;
        case "needUser": push(`⚠ ${m.message}`, "warn"); setLastResult(m.message); break;
        case "queued": push(`Queued: ${m.command}`, "info"); break;
        case "paused": push("Paused.", "warn"); break;
        case "resumed": push("Resumed.", "info"); break;
        case "stopped": push(m.message || "Stopped.", "warn"); setConfirm(null); break;
        case "result": setConfirm(null); setLastResult(m.message); push(`${m.ok ? "✓" : "✗"} ${m.message}`, m.ok ? "ok" : "error"); break;
        case "error": push(`Error: ${m.message}`, "error"); setLastResult(m.message); break;
        default: break;
      }
    };
  }, [conn, push]);

  // Auto-connect once if we already have saved creds.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    if (savedUrl && savedToken) { tried.current = true; connect(savedUrl, savedToken); }
  }, [savedUrl, savedToken, connect]);

  useEffect(() => () => { manualClose.current = true; wsRef.current?.close(); }, []);

  const sendOp = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const runCommand = useCallback((text: string) => { if (text.trim()) sendOp({ op: "command", text: text.trim() }); }, [sendOp]);
  const setMode = useCallback((m: OperatorMode) => { sendOp({ op: "mode", mode: m }); setModeState(m); }, [sendOp]);
  const stop = useCallback(() => sendOp({ op: "stop" }), [sendOp]);
  const pause = useCallback(() => sendOp({ op: "pause" }), [sendOp]);
  const resume = useCallback(() => sendOp({ op: "resume" }), [sendOp]);
  const answerConfirm = useCallback((approved: boolean) => { sendOp({ op: "confirm", approved }); setConfirm(null); }, [sendOp]);

  return {
    conn, provider, mode, activity, plan, confirm, lastResult,
    savedUrl, savedToken,
    connect, disconnect,
    runCommand, setMode, stop, pause, resume, answerConfirm,
  };
}
