"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  Send,
  Paperclip,
  Volume2,
  VolumeX,
  Loader2,
  X,
} from "lucide-react";
import { Orb, type OrbState, orbStateLabel } from "@/components/orb";
import { Button } from "@/components/ui/button";
import { useVoice } from "@/hooks/useVoice";
import { useAgent } from "@/hooks/useAgent";
import { ActivityPanel } from "./activity-panel";
import { StatusPanel } from "./status-panel";
import { TasksPreview } from "./tasks-preview";
import { ConversationSidebar } from "./conversation-sidebar";
import { cn } from "@/lib/utils";

interface VoiceConfig {
  configured: boolean;
  preferences: { voiceEnabled: boolean; autoListen: boolean };
}

export function JarvisConsole({ assistantName }: { assistantName: string }) {
  const router = useRouter();
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [input, setInput] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [reloadConvos, setReloadConvos] = useState(0);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<(t: string) => void>(() => {});

  const onNavigate = useCallback(
    (path: string) => {
      if (path.startsWith("/dashboard") && path !== "/dashboard") router.push(path);
    },
    [router],
  );

  const voice = useVoice({
    onTranscript: (t) => sendRef.current(t),
    autoListen: true,
  });

  const agent = useAgent({
    onAssistantComplete: (text) => {
      if (voiceStarted && !voice.muted && voice.enabled) voice.speak(text);
    },
    onNavigate,
  });

  useEffect(() => {
    sendRef.current = agent.send;
  }, [agent.send]);

  // Load voice configuration.
  useEffect(() => {
    fetch("/api/voice/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setVoiceConfig(j.data))
      .catch(() => setVoiceConfig({ configured: false, preferences: { voiceEnabled: false, autoListen: false } }));
  }, []);

  // Auto-scroll chat.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [agent.messages]);

  // Refresh side panels when a turn completes (tasks/notes may have changed).
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !agent.streaming) {
      setRefreshKey((k) => k + 1);
      setReloadConvos((k) => k + 1);
    }
    wasStreaming.current = agent.streaming;
  }, [agent.streaming]);

  // Derive orb state from voice + agent activity.
  const orbState: OrbState = (() => {
    if (voice.status === "denied" || voice.status === "error") return "error";
    if (voice.status === "speaking") return "speaking";
    if (agent.streaming) {
      const top = agent.activity[0];
      return top && top.kind === "tool" ? "executing" : "thinking";
    }
    if (voice.status === "recording") return "listening";
    if (voice.status === "processing") return "thinking";
    if (voice.status === "listening") return "listening";
    if (!voiceStarted) return "idle";
    return "idle";
  })();

  const statusLabel = agent.streaming
    ? orbState === "executing"
      ? "Executing"
      : "Thinking"
    : orbStateLabel(orbState);

  async function enableVoice() {
    const ok = await voice.init();
    if (ok) setVoiceStarted(true);
  }

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput("");
    agent.send(t);
  }

  function newConversation() {
    agent.reset();
  }

  async function selectConversation(id: string) {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const j = await res.json();
    agent.loadConversation(
      id,
      j.data.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tools: Array.isArray(m.toolResults) ? m.toolResults : [],
      })),
    );
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("prompt", input.trim() || "Analyze this file and summarize it.");
      setInput("");
      const res = await fetch("/api/files/analyze", { method: "POST", body: form });
      const j = await res.json();
      const answer = res.ok ? j.data.answer : j.error || "Could not analyze the file.";
      agent.appendLocalExchange?.(`📎 Uploaded ${file.name}`, answer);
      if (voiceStarted && !voice.muted && res.ok) voice.speak(answer);
    } catch {
      /* surfaced below */
    } finally {
      setUploading(false);
    }
  }

  const voiceUnconfigured = voiceConfig && !voiceConfig.configured;

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      {/* LEFT: conversation history */}
      <aside className="hidden border-r border-border/60 bg-panel/30 p-4 lg:block">
        <ConversationSidebar
          activeId={agent.conversationId}
          onSelect={selectConversation}
          onNew={newConversation}
          reloadKey={reloadConvos}
        />
      </aside>

      {/* CENTER */}
      <section className="flex min-w-0 flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {assistantName}
              <span className="ml-2 text-xs font-normal text-success">● ONLINE</span>
            </h1>
            <p className="text-xs text-muted-foreground">{statusLabel}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {voiceStarted && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={voice.toggleMute}
                  aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
                  title={voice.muted ? "Unmute" : "Mute"}
                >
                  {voice.muted ? <MicOff className="h-5 w-5 text-destructive" /> : <Mic className="h-5 w-5 text-accent" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => voice.setEnabled(!voice.enabled)}
                  aria-label={voice.enabled ? "Disable voice output" : "Enable voice output"}
                  title={voice.enabled ? "Voice on" : "Voice off"}
                >
                  {voice.enabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 text-muted-foreground" />}
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Orb + status */}
        <div className="relative flex flex-col items-center gap-2 py-6">
          <Orb state={orbState} level={voice.level} size={190} />
          <div className="text-center">
            <div className="text-sm font-medium">{statusLabel}</div>
            {voice.error && <div className="mt-1 text-xs text-destructive">{voice.error}</div>}
          </div>

          {/* Voice enable overlay */}
          {!voiceStarted && (
            <div className="mt-2 flex flex-col items-center gap-2">
              {voiceConfig == null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Initializing voice…
                </p>
              ) : voiceUnconfigured ? (
                <p className="max-w-xs text-center text-xs text-muted-foreground">
                  JARVIS voice is not configured. You can still chat by text. Add an
                  ElevenLabs key to enable speech.
                </p>
              ) : (
                <Button onClick={enableVoice} size="lg" className="mt-1">
                  <Mic className="h-4 w-4" /> Enable JARVIS Voice
                </Button>
              )}
              {voice.status === "denied" && (
                <button onClick={enableVoice} className="text-xs text-accent hover:underline">
                  Microphone blocked — grant permission and retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* Chat */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          {agent.messages.length === 0 && (
            <div className="mx-auto mt-6 max-w-md text-center text-sm text-muted-foreground">
              <p className="mb-2 font-medium text-foreground">How can I help?</p>
              <p>
                Try: “Search the latest AI news”, “Remember that my company is Infinity
                Web and Apps”, “Create a task for tomorrow”, or “Calculate 55000 + 18000”.
              </p>
            </div>
          )}
          {agent.messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm animate-fade-in",
                  m.role === "user"
                    ? "bg-accent/15 text-foreground"
                    : "glass",
                )}
              >
                {m.content ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                ) : (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
                  </span>
                )}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.tools.map((t, i) => (
                      <span
                        key={i}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px]",
                          t.status === "error"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="border-t border-border/60 p-3"
        >
          <div className="glass flex items-end gap-2 rounded-2xl p-2">
            <input ref={fileRef} type="file" hidden onChange={onFile} accept="image/*,.pdf,.txt,.md,.json,.csv" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Upload a file"
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
            </Button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder={voiceStarted ? "Speak or type…" : "Type a message…"}
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || agent.streaming}
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </form>
      </section>

      {/* RIGHT: live panels */}
      <aside className="hidden space-y-4 overflow-y-auto border-l border-border/60 bg-panel/30 p-4 lg:block">
        <ActivityPanel items={agent.activity} streaming={agent.streaming} />
        <TasksPreview refreshKey={refreshKey} />
        <StatusPanel />
      </aside>
    </div>
  );
}
