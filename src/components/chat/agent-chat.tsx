"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_AGENTS, type ChatAgent, type ChatAgentId } from "@/lib/agents/catalog";
import { Markdown } from "./markdown";
import { VoiceMode } from "./voice-mode";
import { capturePhrase, transcribe } from "@/components/island/voice";

/**
 * The chat screen every agent except JARVIS uses (JARVIS keeps its own
 * voice-first console). It works like ChatGPT or Gemini:
 * - streaming replies, Markdown, copy / retry / stop;
 * - saved history per agent, and new chat;
 * - an optional full-screen voice mode that talks to the same conversation.
 *
 * It talks to /api/agent, the same brain, tools and permissions the agent
 * has everywhere else. Each agent's history is its own.
 */

interface ToolNote { name: string; status: "ok" | "error"; summary: string }
interface LinkNote { url: string; label: string }
interface Msg {
  id: string; role: "user" | "assistant"; content: string;
  status?: "streaming" | "done" | "error" | "stopped";
  activity?: string | null; tools?: ToolNote[]; links?: LinkNote[]; error?: string | null;
}
interface Convo { id: string; title: string; updatedAt: string }

const uid = () => Math.random().toString(36).slice(2, 10);
const AGENT_ORDER: ChatAgentId[] = ["darwin", "robin", "ev", "mike"];

export function AgentChat({ agent }: { agent: ChatAgent }) {
  const router = useRouter();
  const params = useSearchParams();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(() => params.get("prefill") ?? "");
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState(false);
  const [voice, setVoice] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null); activeRef.current = activeId;
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dictRef = useRef<ReturnType<typeof capturePhrase> | null>(null);

  // ---------- history ----------
  const loadList = useCallback(async () => {
    const r = await fetch(`/api/conversations?agent=${agent.id}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (r?.ok && j?.data) { setConvos(j.data.conversations); setLoadErr(null); }
    else setLoadErr(r?.status === 423 ? "JARVIS is locked — unlock it to see your chats." : "Couldn't load your chats.");
  }, [agent.id]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    void fetch("/api/auth/me").then((r) => r.json()).then((j) => setMe(j?.data?.displayName ?? null)).catch(() => {});
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  useEffect(() => { if (params.get("prefill")) taRef.current?.focus(); }, [params]);

  const openConvo = async (id: string) => {
    abortRef.current?.abort();
    setSide(false);
    setActiveId(id);
    setMsgs([]);
    const r = await fetch(`/api/conversations/${id}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j?.data) { setMsgs([{ id: uid(), role: "assistant", content: "", status: "error", error: j?.error || "Couldn't open that chat." }]); return; }
    setMsgs(j.data.messages.map((m: { id: string; role: "user" | "assistant"; content: string; toolResults?: ToolNote[] | null }) => ({
      id: m.id, role: m.role, content: m.content, status: "done", tools: Array.isArray(m.toolResults) ? m.toolResults : [],
    })));
  };

  const newChat = () => { abortRef.current?.abort(); setActiveId(null); setMsgs([]); setSide(false); setTimeout(() => taRef.current?.focus(), 0); };

  const deleteConvo = async (id: string) => {
    if (!window.confirm("Delete this chat? This can't be undone.")) return;
    const r = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setConvos((c) => c.filter((x) => x.id !== id)); if (activeRef.current === id) newChat(); }
  };

  // ---------- sending ----------
  const patch = (id: string, f: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === id ? f(m) : m)));

  /** Send a message to the agent; resolves with its final answer (used by voice mode too). */
  const send = useCallback(async (text: string, onDelta?: (soFar: string) => void): Promise<{ text: string; error?: string }> => {
    const t = text.trim();
    if (!t) return { text: "" };
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const aId = uid();
    setMsgs((all) => [...all, { id: uid(), role: "user", content: t, status: "done" }, { id: aId, role: "assistant", content: "", status: "streaming", activity: "Thinking…", tools: [], links: [] }]);
    setBusy(true);
    let full = "", err: string | null = null;
    try {
      const r = await fetch("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ conversationId: activeRef.current, message: t, agent: agent.id }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => null);
        throw new Error(r.status === 423 ? "JARVIS is locked — unlock it, then try again." : r.status === 429 ? "Too many messages — wait a moment." : j?.error || `The agent answered ${r.status}.`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          switch (ev.type) {
            case "meta":
              if (!activeRef.current) { setActiveId(String(ev.conversationId)); activeRef.current = String(ev.conversationId); }
              break;
            case "activity": patch(aId, (m) => ({ ...m, activity: String(ev.label) })); break;
            case "text":
              full += String(ev.delta ?? "");
              onDelta?.(full);
              patch(aId, (m) => ({ ...m, content: full, activity: null }));
              break;
            case "tool": patch(aId, (m) => ({ ...m, tools: [...(m.tools ?? []), { name: String(ev.name), status: ev.status === "error" ? "error" : "ok", summary: String(ev.summary ?? "") }] })); break;
            case "link": case "open":
              patch(aId, (m) => ({ ...m, links: [...(m.links ?? []), { url: String(ev.url), label: String(ev.label ?? ev.url) }] })); break;
            case "navigate":
              patch(aId, (m) => ({ ...m, links: [...(m.links ?? []), { url: String(ev.path), label: "Open in JARVIS" }] })); break;
            case "email":
              if (ev.phase === "sent" || ev.phase === "failed") patch(aId, (m) => ({ ...m, tools: [...(m.tools ?? []), { name: "email", status: ev.phase === "sent" ? "ok" : "error", summary: ev.phase === "sent" ? `Email sent to ${ev.to ?? "the recipient"}` : `Email not sent: ${ev.error ?? "failed"}` }] }));
              break;
            case "done": if (typeof ev.text === "string" && ev.text) { full = ev.text; onDelta?.(full); } break;
            case "error": err = String(ev.message ?? "Something went wrong."); break;
          }
        }
      }
      patch(aId, (m) => ({ ...m, content: full, status: err ? "error" : "done", error: err, activity: null }));
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        patch(aId, (m) => ({ ...m, status: "stopped", activity: null }));
        err = "stopped";
      } else {
        err = (e as Error).message || "The agent couldn't be reached.";
        patch(aId, (m) => ({ ...m, status: "error", error: err, activity: null }));
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
      void loadList();
    }
    return err && err !== "stopped" ? { text: full, error: err } : { text: full };
  }, [agent.id, loadList]);

  const sendRef = useRef(send); sendRef.current = send;
  const onAsk = useCallback((t: string, d: (s: string) => void) => sendRef.current(t, d), []);
  const stop = useCallback(() => abortRef.current?.abort(), []);

  const submit = () => {
    if (busy || !input.trim()) return;
    const t = input; setInput("");
    void send(t);
  };

  const retry = (assistantId: string) => {
    const i = msgs.findIndex((m) => m.id === assistantId);
    const userMsg = [...msgs.slice(0, i)].reverse().find((m) => m.role === "user");
    if (!userMsg || busy) return;
    setMsgs((all) => all.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
    void send(userMsg.content);
  };

  // ---------- dictation (mic → words in the box) ----------
  const dictate = async () => {
    if (dictRef.current) { dictRef.current.stop(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setInput((v) => v); window.alert("The microphone is blocked or missing. Allow it in the browser to dictate."); return; }
    setDictating(true);
    const c = capturePhrase(stream, { waitMs: 8000 });
    dictRef.current = c;
    const blob = await c.done;
    dictRef.current = null;
    stream.getTracks().forEach((tr) => tr.stop());
    if (blob) {
      const r = await transcribe(blob);
      if ("text" in r && r.text) setInput((v) => (v ? `${v} ${r.text}` : r.text));
      else if ("error" in r) window.alert(r.error);
    }
    setDictating(false);
    taRef.current?.focus();
  };

  // auto-grow the box
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(220, ta.scrollHeight)}px`;
  }, [input]);

  const handoff = (to: ChatAgentId, text: string) => {
    // a visible, user-approved handoff: the other agent's chat opens with this prefilled — you press Send
    const note = `From ${agent.name}:\n${text.slice(0, 3000)}`;
    router.push(`/dashboard/chat/${to}?prefill=${encodeURIComponent(note)}`);
  };

  const empty = msgs.length === 0;

  return (
    <div className="ac">
      <style dangerouslySetInnerHTML={{ __html: AC_CSS }} />
      {/* sidebar: agents + this agent's history */}
      <aside className={`ac-side ${side ? "open" : ""}`} aria-label="Chats">
        <button type="button" className="ac-new" onClick={newChat}>+ New chat</button>
        <div className="ac-agents" role="navigation" aria-label="Agents">
          {AGENT_ORDER.map((id) => (
            <Link key={id} href={`/dashboard/chat/${id}`} className={`ac-agent ${id === agent.id ? "on" : ""}`} onClick={() => setSide(false)}>
              <i style={{ background: CHAT_AGENTS[id].color }} />{CHAT_AGENTS[id].name}<small>{CHAT_AGENTS[id].role}</small>
            </Link>
          ))}
          <Link href="/dashboard" className="ac-agent"><i style={{ background: "#0ea5e9" }} />JARVIS<small>Voice-first assistant</small></Link>
        </div>
        <div className="ac-hist-h">Your {agent.name} chats</div>
        <ul className="ac-hist">
          {convos.map((c) => (
            <li key={c.id} className={c.id === activeId ? "on" : ""}>
              <button type="button" onClick={() => void openConvo(c.id)} title={c.title}>{c.title}</button>
              <button type="button" className="del" onClick={() => void deleteConvo(c.id)} aria-label={`Delete chat ${c.title}`}>✕</button>
            </li>
          ))}
          {!convos.length && <li className="mut">{loadErr ?? "No chats yet."}</li>}
        </ul>
      </aside>
      {side && <button type="button" className="ac-scrim" aria-label="Close menu" onClick={() => setSide(false)} />}

      <section className="ac-main">
        <header className="ac-head">
          <button type="button" className="ac-menu" onClick={() => setSide((s) => !s)} aria-label="Chats and agents" aria-expanded={side}><Burger /></button>
          <div className="ac-title"><b>{agent.name}</b><span>{agent.role}</span></div>
          {agent.console && <Link href={agent.console} className="ac-console">Open console</Link>}
          <span className="ac-avatar" style={{ background: agent.color }} aria-hidden>{agent.name[0]}</span>
        </header>

        <div className="ac-thread" aria-live="polite">
          {empty ? (
            <div className="ac-welcome">
              <div className="ac-bot" style={{ color: agent.color }}><BotIcon /></div>
              <h1>Welcome to {agent.name}</h1>
              <p>How can I help you today?</p>
              <div className="ac-sugg">
                {agent.suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)} disabled={busy}>{s}</button>)}
              </div>
            </div>
          ) : (
            <div className="ac-msgs">
              {msgs.map((m) => m.role === "user" ? (
                <div key={m.id} className="ac-u"><div className="b">{m.content}</div></div>
              ) : (
                <div key={m.id} className="ac-a">
                  <span className="ac-a-av" style={{ background: agent.color }} aria-hidden>{agent.name[0]}</span>
                  <div className="ac-a-body">
                    {(m.tools ?? []).length > 0 && (
                      <div className="ac-tools">
                        {m.tools!.map((t, i) => <span key={i} className={`ac-tool ${t.status}`} title={t.summary}>{t.status === "ok" ? "✓" : "!"} {t.summary || t.name}</span>)}
                      </div>
                    )}
                    {m.content ? <Markdown text={m.content} /> : m.status === "streaming" ? <p className="ac-act"><span className="ac-dots"><i /><i /><i /></span>{m.activity ?? "Thinking…"}</p> : null}
                    {m.status === "streaming" && m.content && m.activity && <p className="ac-act">{m.activity}</p>}
                    {(m.links ?? []).length > 0 && (
                      <div className="ac-links">{m.links!.map((l, i) => /^https?:|^\//.test(l.url) ? <a key={i} href={l.url} target={l.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer noopener">{l.label} ↗</a> : null)}</div>
                    )}
                    {m.status === "error" && <p className="ac-err" role="alert">{m.error ?? "Something went wrong."}</p>}
                    {m.status === "stopped" && <p className="ac-note">Stopped.</p>}
                    {m.status !== "streaming" && (
                      <div className="ac-ops">
                        {m.content && <CopyBtn text={m.content} />}
                        <button type="button" onClick={() => retry(m.id)} disabled={busy}>Retry</button>
                        {m.content && (
                          <select aria-label="Hand this to another agent" value="" onChange={(e) => { if (e.target.value) handoff(e.target.value as ChatAgentId, m.content); }}>
                            <option value="">Send to…</option>
                            {AGENT_ORDER.filter((id) => id !== agent.id).map((id) => <option key={id} value={id}>{CHAT_AGENTS[id].name}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form className="ac-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea ref={taRef} value={input} rows={1} placeholder={`Message ${agent.name}…`} aria-label={`Message ${agent.name}`}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <div className="ac-row">
            <span className="ac-hint">Enter to send · Shift+Enter for a new line</span>
            <button type="button" className="ac-ic" onClick={() => setVoice(true)} aria-label={`Talk to ${agent.name} (voice mode)`} title="Voice mode"><WaveIcon /></button>
            <button type="button" className={`ac-ic ${dictating ? "rec" : ""}`} onClick={() => void dictate()} aria-label={dictating ? "Stop dictating" : "Dictate"} title="Dictate"><MicIcon /></button>
            {busy
              ? <button type="button" className="ac-send stop" onClick={stop} aria-label="Stop the reply">■</button>
              : <button type="submit" className="ac-send" disabled={!input.trim()} aria-label="Send">↑</button>}
          </div>
        </form>
      </section>

      {voice && <VoiceMode agent={agent} displayName={me} onAsk={onAsk} onStop={stop} onClose={() => setVoice(false)} />}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {})}>{ok ? "Copied" : "Copy"}</button>;
}

const Burger = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
const MicIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
const WaveIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" /></svg>;
const BotIcon = () => <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="7" width="16" height="11" rx="4" /><path d="M12 3v4M8 3.5v1M16 3.5v1" /><circle cx="9.5" cy="12.5" r="1.2" fill="currentColor" /><circle cx="14.5" cy="12.5" r="1.2" fill="currentColor" /><path d="M9 21h6" /></svg>;

const AC_CSS = `
.ac { position: relative; display: flex; height: calc(100dvh - 4rem); background: #0b1324; color: #e2e8f0; font-family: "Inter", "Segoe UI", system-ui, sans-serif; letter-spacing: normal; }
.ac-side { width: 268px; flex: none; display: flex; flex-direction: column; gap: 10px; padding: 14px 12px; box-sizing: border-box; background: #0a1020; border-right: 1px solid rgba(148,163,184,.12); overflow: auto; }
.ac-new { font: inherit; font-size: 14px; font-weight: 500; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(96,165,250,.4); background: rgba(37,99,235,.15); color: #dbeafe; cursor: pointer; text-align: left; }
.ac-new:hover { background: rgba(37,99,235,.28); }
.ac-agents { display: flex; flex-direction: column; gap: 2px; }
.ac-agent { display: grid; grid-template-columns: 10px 1fr; column-gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; color: #cbd5e1; text-decoration: none; font-size: 14px; font-weight: 600; }
.ac-agent i { width: 8px; height: 8px; border-radius: 50%; grid-row: span 2; }
.ac-agent small { grid-column: 2; font-size: 11.5px; font-weight: 400; color: #64748b; }
.ac-agent:hover, .ac-agent.on { background: rgba(148,163,184,.1); color: #f8fafc; }
.ac-hist-h { margin-top: 8px; padding: 0 10px; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: #64748b; }
.ac-hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.ac-hist li { display: flex; align-items: center; border-radius: 8px; }
.ac-hist li.on, .ac-hist li:hover { background: rgba(148,163,184,.1); }
.ac-hist li button:first-child { flex: 1; min-width: 0; text-align: left; font: inherit; font-size: 13.5px; color: #cbd5e1; background: none; border: 0; padding: 8px 10px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-hist .del { opacity: 0; background: none; border: 0; color: #94a3b8; cursor: pointer; padding: 6px 8px; font-size: 11px; }
.ac-hist li:hover .del, .ac-hist .del:focus-visible { opacity: 1; }
.ac-hist .mut { padding: 8px 10px; font-size: 13px; color: #64748b; }
.ac-scrim { display: none; }
.ac-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ac-head { display: flex; align-items: center; gap: 12px; padding: 12px 18px; }
.ac-menu { display: none; background: none; border: 0; color: #e2e8f0; cursor: pointer; padding: 6px; }
.ac-title { flex: 1; display: flex; align-items: baseline; gap: 10px; min-width: 0; } .ac-title b { font-size: 16px; letter-spacing: .06em; } .ac-title span { font-size: 13px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-console { font-size: 12.5px; color: #93c5fd; text-decoration: none; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(96,165,250,.35); }
.ac-console:hover { background: rgba(37,99,235,.15); }
.ac-avatar { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; box-shadow: 0 0 0 3px rgba(37,99,235,.2); }
.ac-thread { flex: 1; overflow: auto; }
.ac-welcome { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px 20px; box-sizing: border-box; }
.ac-bot { width: 96px; height: 96px; border-radius: 28px; display: grid; place-items: center; background: rgba(15,23,42,.6); margin-bottom: 26px; }
.ac-welcome h1 { margin: 0; font-size: clamp(28px, 4.5vw, 40px); font-weight: 600; color: #f8fafc; letter-spacing: -.01em; }
.ac-welcome p { margin: 12px 0 0; font-size: 18px; color: #cbd5e1; }
.ac-sugg { margin-top: 28px; display: grid; grid-template-columns: repeat(2, minmax(0, 260px)); gap: 10px; }
.ac-sugg button { font: inherit; font-size: 13.5px; text-align: left; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(148,163,184,.18); background: rgba(30,41,59,.5); color: #cbd5e1; cursor: pointer; }
.ac-sugg button:hover:not(:disabled) { border-color: rgba(96,165,250,.5); color: #f1f5f9; }
.ac-msgs { max-width: 820px; margin: 0 auto; padding: 18px 20px 30px; display: flex; flex-direction: column; gap: 20px; }
.ac-u { display: flex; justify-content: flex-end; } .ac-u .b { max-width: 78%; padding: 10px 15px; border-radius: 18px 18px 4px 18px; background: #1e3a8a; color: #f1f5f9; font-size: 15px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.ac-a { display: flex; gap: 12px; } .ac-a-av { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #fff; margin-top: 2px; }
.ac-a-body { flex: 1; min-width: 0; font-size: 15px; line-height: 1.65; color: #e2e8f0; }
.ac-act { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 13.5px; color: #94a3b8; }
.ac-dots { display: inline-flex; gap: 4px; } .ac-dots i { width: 6px; height: 6px; border-radius: 50%; background: #60a5fa; animation: ac-b 1s infinite ease-in-out; } .ac-dots i:nth-child(2) { animation-delay: .15s; } .ac-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes ac-b { 50% { opacity: .3; transform: translateY(-3px); } }
.ac-tools { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.ac-tool { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: rgba(34,197,94,.12); color: #86efac; border: 1px solid rgba(34,197,94,.25); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-tool.error { background: rgba(239,68,68,.12); color: #fca5a5; border-color: rgba(239,68,68,.3); }
.ac-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; } .ac-links a { font-size: 13px; color: #93c5fd; text-decoration: none; padding: 4px 10px; border-radius: 8px; background: rgba(37,99,235,.12); }
.ac-err { margin: 6px 0 0; padding: 8px 12px; border-radius: 10px; background: rgba(127,29,29,.3); color: #fecaca; font-size: 13.5px; }
.ac-note { margin: 6px 0 0; font-size: 13px; color: #94a3b8; }
.ac-ops { display: flex; gap: 6px; margin-top: 8px; opacity: .75; } .ac-a:hover .ac-ops { opacity: 1; }
.ac-ops button, .ac-ops select { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,.2); background: transparent; color: #94a3b8; cursor: pointer; }
.ac-ops button:hover:not(:disabled), .ac-ops select:hover { color: #e2e8f0; border-color: rgba(148,163,184,.45); }
.ac-ops select option { background: #0f172a; color: #e2e8f0; }
.ac-compose { margin: 0 auto 18px; width: min(820px, calc(100% - 32px)); box-sizing: border-box; padding: 14px 16px 10px; border-radius: 22px; background: #1e293b; border: 1.5px solid rgba(59,130,246,.55); box-shadow: 0 0 0 4px rgba(37,99,235,.08), 0 0 22px rgba(37,99,235,.18); }
.ac-compose textarea { width: 100%; resize: none; border: 0; outline: none; background: transparent; color: #f1f5f9; font: inherit; font-size: 16px; line-height: 1.5; max-height: 220px; }
.ac-compose textarea::placeholder { color: #64748b; }
.ac-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.ac-hint { flex: 1; font-size: 11.5px; color: #475569; }
.ac-ic { width: 38px; height: 38px; border-radius: 50%; border: 0; background: transparent; color: #94a3b8; cursor: pointer; display: grid; place-items: center; }
.ac-ic:hover { color: #e2e8f0; background: rgba(148,163,184,.12); } .ac-ic.rec { color: #fff; background: #dc2626; }
.ac-send { width: 38px; height: 38px; border-radius: 50%; border: 0; background: #2563eb; color: #fff; font-size: 18px; cursor: pointer; }
.ac-send:disabled { background: #334155; color: #64748b; cursor: default; } .ac-send.stop { background: #e2e8f0; color: #0f172a; font-size: 13px; }
.md p { margin: 0 0 10px; } .md p:last-child { margin-bottom: 0; }
.md-h { margin: 14px 0 8px; font-size: 17px; color: #f8fafc; } .md-h4 { margin: 12px 0 6px; font-size: 15px; color: #f1f5f9; }
.md-ul, .md-ol { margin: 0 0 10px; padding-left: 22px; } .md-ul { list-style: disc; } .md-ol { list-style: decimal; } .md li { margin: 3px 0; } .md li::marker { color: #64748b; }
.md a { color: #93c5fd; } .md strong { color: #f8fafc; }
.md-ic { font-family: ui-monospace, Consolas, monospace; font-size: .88em; padding: 1px 6px; border-radius: 6px; background: rgba(148,163,184,.15); }
.md-code { margin: 0 0 12px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(148,163,184,.18); background: #0a0f1c; }
.md-code-h { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; font-size: 12px; color: #94a3b8; background: rgba(148,163,184,.08); }
.md-code-h button { font: inherit; font-size: 12px; background: none; border: 0; color: #93c5fd; cursor: pointer; }
.md-code pre { margin: 0; padding: 12px 14px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 1.55; color: #e2e8f0; }
.md-table { overflow: auto; margin: 0 0 12px; } .md table { border-collapse: collapse; font-size: 13.5px; min-width: 60%; }
.md th, .md td { border: 1px solid rgba(148,163,184,.2); padding: 6px 10px; text-align: left; vertical-align: top; } .md th { background: rgba(148,163,184,.08); color: #f1f5f9; }
.md-q { margin: 0 0 10px; padding: 4px 12px; border-left: 3px solid #3b82f6; color: #cbd5e1; }
@media (max-width: 820px) {
  .ac-side { position: absolute; z-index: 20; top: 0; bottom: 0; left: 0; transform: translateX(-100%); transition: transform .22s ease; box-shadow: 0 0 40px rgba(0,0,0,.5); }
  .ac-side.open { transform: none; }
  .ac-scrim { display: block; position: absolute; inset: 0; z-index: 10; background: rgba(0,0,0,.45); border: 0; }
  .ac-menu { display: block; }
  .ac-sugg { grid-template-columns: 1fr; width: 100%; max-width: 420px; }
  .ac-hint { visibility: hidden; }
  .ac-u .b { max-width: 88%; }
  .ac-compose { margin-bottom: 12px; }
}
@media (prefers-reduced-motion: reduce) { .ac-dots i { animation: none; } .ac-side { transition: none; } }
`;
