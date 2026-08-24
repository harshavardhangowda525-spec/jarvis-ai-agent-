"use client";

import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: { name: string; status: string; summary: string }[];
  links?: { url: string; label: string }[];
}

export interface ActivityItem {
  id: string;
  label: string;
  kind: "activity" | "tool" | "error";
  status?: "ok" | "error";
}

interface UseAgentOptions {
  onAssistantComplete?: (text: string) => void;
  onNavigate?: (path: string) => void;
  onOpen?: (url: string) => void;
}

let idc = 0;
const nextId = () => `m${Date.now()}_${idc++}`;

/**
 * Client for the streaming /api/agent endpoint. Parses the NDJSON event stream
 * and exposes messages, the live-activity feed, and the currently streaming
 * assistant text. Voice and text share this same flow.
 */
export function useAgent({ onAssistantComplete, onNavigate, onOpen }: UseAgentOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
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
  const appendLocalExchange = useCallback((userText: string, assistantText: string) => {
    setMessages((m) => [
      ...m,
      { id: nextId(), role: "user", content: userText },
      { id: nextId(), role: "assistant", content: assistantText },
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
    async (text: string) => {
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

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationIdRef.current,
            message: trimmed,
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
      }
    },
    [onAssistantComplete, onNavigate, onOpen, pushActivity, setConversation, streaming],
  );

  return {
    messages,
    activity,
    streaming,
    activeProvider,
    conversationId,
    send,
    reset,
    loadConversation,
    setConversation,
    appendLocalExchange,
  };
}
