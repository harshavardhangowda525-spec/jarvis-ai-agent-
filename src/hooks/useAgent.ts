"use client";

import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: { name: string; status: string; summary: string }[];
  links?: { url: string; label: string }[];
}

/** How long the last answer took (ms from sending the message). */
export interface AgentTiming { provider: string; model: string; setupMs: number; firstWordMs: number | null; totalMs: number; clientMs: number | null }

export interface ActivityItem {
  id: string;
  label: string;
  kind: "activity" | "tool" | "error";
  status?: "ok" | "error";
}

interface UseAgentOptions {
  onAssistantComplete?: (text: string) => void;
  /** Each piece of reply text as it streams in (e.g. to start speaking early). */
  onTextDelta?: (delta: string) => void;
  /** Always fires when a turn stops — finished, failed or aborted. */
  onTurnEnd?: () => void;
  /** An email being sent (compose popup): "sending" with the email, then "sent"/"failed". */
  onEmail?: (e: { id: string; phase: "sending" | "sent" | "failed"; to?: string; subject?: string; body?: string; label?: string; gmailId?: string | null; error?: string }) => void;
  onNavigate?: (path: string) => void;
  onOpen?: (url: string) => void;
  /** Fired for every tool result (used e.g. to drive EV's operating state). */
  onTool?: (t: { name: string; status: "ok" | "error"; summary: string }) => void;
}

/** Per-send options. `agent` routes the turn through a specific internal brain. */
export interface SendOptions {
  agent?: "jarvis" | "ev" | "darwin";
}

let idc = 0;
const nextId = () => `m${Date.now()}_${idc++}`;

/**
 * Client for the streaming /api/agent endpoint. Parses the NDJSON event stream
 * and exposes messages, the live-activity feed, and the currently streaming
 * assistant text. Voice and text share this same flow.
 */
export function useAgent({ onAssistantComplete, onTextDelta, onTurnEnd, onEmail, onNavigate, onOpen, onTool }: UseAgentOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [lastTiming, setLastTiming] = useState<AgentTiming | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setConversation = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
  }, []);

  const loadConversation = useCallback((id: string, msgs: ChatMessage[]) => {
    conversationIdRef.current = id;
    setConversationId(id);
    setMessages(msgs);
    setActivity([]);
  }, []);

  /** Add a local user/assistant pair (used by file analysis, which has its own endpoint). */
  const appendLocalExchange = useCallback((userText: string, assistantText: string, links?: { url: string; label: string }[]) => {
    setMessages((m) => [
      ...m,
      { id: nextId(), role: "user", content: userText },
      { id: nextId(), role: "assistant", content: assistantText, ...(links?.length ? { links } : {}) },
    ]);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setActivity([]);
    setStreaming(false);
  }, []);

  const pushActivity = useCallback((item: Omit<ActivityItem, "id">) => {
    setActivity((a) => [{ id: nextId(), ...item }, ...a].slice(0, 40));
  }, []);

  const send = useCallback(
    async (text: string, opts?: SendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const userMsg: ChatMessage = { id: nextId(), role: "user", content: trimmed };
      const assistantId = nextId();
      setMessages((m) => [
        ...m,
        userMsg,
        { id: assistantId, role: "assistant", content: "", tools: [] },
      ]);
      setStreaming(true);
      pushActivity({ label: "Understanding request…", kind: "activity" });

      const ac = new AbortController();
      abortRef.current = ac;
      const sentAt = performance.now();
      let firstWordAt: number | null = null;

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationIdRef.current,
            message: trimmed,
            ...(opts?.agent ? { agent: opts.agent } : {}),
          }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          const msg = j.error || "The assistant is unavailable.";
          setMessages((m) =>
            m.map((x) => (x.id === assistantId ? { ...x, content: msg } : x)),
          );
          pushActivity({ label: msg, kind: "error" });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev: any;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            switch (ev.type) {
              case "meta":
                setConversation(ev.conversationId);
                break;
              case "text":
                finalText += ev.delta;
                firstWordAt ??= performance.now();
                onTextDelta?.(ev.delta);
                setMessages((m) =>
                  m.map((x) =>
                    x.id === assistantId ? { ...x, content: x.content + ev.delta } : x,
                  ),
                );
                break;
              case "activity":
                pushActivity({ label: ev.label, kind: "activity" });
                break;
              case "tool":
                pushActivity({ label: ev.summary, kind: "tool", status: ev.status });
                onTool?.({ name: ev.name, status: ev.status, summary: ev.summary });
                setMessages((m) =>
                  m.map((x) =>
                    x.id === assistantId
                      ? {
                          ...x,
                          tools: [
                            ...(x.tools ?? []),
                            { name: ev.name, status: ev.status, summary: ev.summary },
                          ],
                        }
                      : x,
                  ),
                );
                break;
              case "provider":
                setActiveProvider(ev.name);
                break;
              case "email":
                onEmail?.(ev);
                break;
              case "timing":
                // Server-side numbers + what the user actually waited (incl. network).
                setLastTiming({
                  provider: ev.provider, model: ev.model, setupMs: ev.setupMs, firstWordMs: ev.firstWordMs, totalMs: ev.totalMs,
                  clientMs: firstWordAt != null ? Math.round(firstWordAt - sentAt) : null,
                });
                break;
              case "navigate":
                onNavigate?.(ev.path);
                break;
              case "open":
                onOpen?.(ev.url);
                setMessages((m) =>
                  m.map((x) =>
                    x.id === assistantId
                      ? { ...x, links: [...(x.links ?? []), { url: ev.url, label: ev.label }] }
                      : x,
                  ),
                );
                break;
              case "link":
                setMessages((m) =>
                  m.map((x) =>
                    x.id === assistantId
                      ? { ...x, links: [...(x.links ?? []), { url: ev.url, label: ev.label }] }
                      : x,
                  ),
                );
                break;
              case "error":
                pushActivity({ label: ev.message, kind: "error" });
                if (!finalText) {
                  setMessages((m) =>
                    m.map((x) => (x.id === assistantId ? { ...x, content: ev.message } : x)),
                  );
                }
                break;
              case "done":
                finalText = ev.text || finalText;
                break;
            }
          }
        }

        pushActivity({ label: "Completed.", kind: "activity" });
        if (finalText) onAssistantComplete?.(finalText);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setMessages((m) =>
            m.map((x) =>
              x.id === assistantId && !x.content
                ? { ...x, content: "Something went wrong. Please try again." }
                : x,
            ),
          );
          pushActivity({ label: "Connection error.", kind: "error" });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        onTurnEnd?.();
      }
    },
    [onAssistantComplete, onTextDelta, onTurnEnd, onEmail, onNavigate, onOpen, onTool, pushActivity, setConversation, streaming],
  );

  return {
    messages,
    activity,
    streaming,
    activeProvider,
    lastTiming,
    conversationId,
    send,
    reset,
    loadConversation,
    setConversation,
    appendLocalExchange,
  };
}
