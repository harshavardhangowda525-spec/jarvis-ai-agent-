"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, Brain, Sparkles, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { timeAgo } from "@/lib/utils";

interface Memory {
  id: string;
  key: string | null;
  content: string;
  source: string;
  updatedAt: string;
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");
  const [learning, setLearning] = useState(false);
  const [learnMsg, setLearnMsg] = useState("");

  async function load() {
    const res = await fetch("/api/memories");
    if (res.ok) setMemories((await res.json()).data.memories);
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key || undefined, content }),
    });
    setKey("");
    setContent("");
    load();
  }

  // Read past chats and save the lasting facts/preferences as memories.
  async function learn() {
    setLearning(true);
    setLearnMsg("Reading your past chats… this can take a minute.");
    try {
      const res = await fetch("/api/memories/learn", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLearnMsg(j.error || "Couldn't learn from your chats right now."); return; }
      const d = j.data;
      setLearnMsg(d.scanned === 0
        ? "No past chats to learn from yet."
        : `Read ${d.scanned} message${d.scanned === 1 ? "" : "s"} — learned ${d.added.length} new thing${d.added.length === 1 ? "" : "s"}` +
          `${d.alreadyKnown ? ` (${d.alreadyKnown} already known)` : ""}.${d.stoppedEarly ? " Run it again to read older chats." : ""}`);
      load();
    } catch {
      setLearnMsg("Network error — try again.");
    } finally {
      setLearning(false);
    }
  }

  async function del(id: string) {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title="Memory"
        subtitle="What JARVIS, EV, DARWIN and ULTRON remember about you (never secrets)"
      />
      <div className="mx-auto w-full max-w-2xl flex-1 p-5">
        <div className="glass mb-4 flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Learn from my past chats</div>
            <div className="text-xs text-muted-foreground">
              Saves lasting facts and preferences you&apos;ve told JARVIS, so every agent — and the Ollama brain — remembers them. Secrets are never stored.
            </div>
            {learnMsg && <div className="mt-1 text-xs text-accent">{learnMsg}</div>}
          </div>
          <Button type="button" onClick={learn} disabled={learning}>
            {learning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {learning ? "Learning…" : "Learn now"}
          </Button>
        </div>

        <form onSubmit={add} className="glass mb-5 rounded-2xl p-4">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Label (optional), e.g. company"
            className="mb-3"
          />
          <div className="flex gap-2">
            <Input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Remember that…"
            />
            <Button type="submit">
              <Plus className="h-4 w-4" /> Save
            </Button>
          </div>
        </form>

        {memories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
        ) : (
          <ul className="space-y-2">
            {memories.map((m) => (
              <li key={m.id} className="glass flex items-start gap-3 rounded-xl px-4 py-3">
                <Brain className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  {m.key && <div className="text-xs font-medium text-accent">{m.key}</div>}
                  <div className="text-sm">{m.content}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {m.source === "user" ? "You" : m.source === "learned" ? "Learned from your chats" : "JARVIS"} · {timeAgo(m.updatedAt)}
                  </div>
                </div>
                <button onClick={() => del(m.id)} aria-label="Delete memory">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
