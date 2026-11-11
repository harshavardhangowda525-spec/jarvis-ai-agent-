"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Blank { line: number; section: string; text: string }
interface Op { content: string; enabled: boolean; saved: boolean; updatedAt: string | null; chars: number; max: number; blanks: Blank[]; isTemplate: boolean }

/**
 * Settings → Operating manual. The long prompt JARVIS and every agent follow
 * (tone, catalogue, approvals, routines). Blanks are listed so you can fill
 * them; until then JARVIS asks instead of guessing.
 */
export function OperatorSettings() {
  const [op, setOp] = useState<Op | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (o: Op) => { setOp(o); setText(o.content); };
  useEffect(() => { fetch("/api/operator").then((r) => r.json()).then((j) => j?.ok && apply(j.data)).catch(() => {}); }, []);

  const put = useCallback(async (body: object, done: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/operator", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Couldn't save.");
      apply(j.data); setMsg({ ok: true, text: done });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }, []);

  const dirty = op != null && text !== op.content;
  const jump = (line: number) => {
    const ta = document.getElementById("operator-text") as HTMLTextAreaElement | null;
    if (!ta) return;
    const at = text.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    ta.focus(); ta.setSelectionRange(at, at + (text.split("\n")[line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (line - 4) * 18);
  };

  return (
    <section className="glass rounded-2xl p-5" id="operator">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><BookOpen className="h-4 w-4" /> Operating manual</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        JARVIS and every agent follow this on every message: tone, your business and prices, routines, approvals. JARVIS&apos;s built-in safety rules still come first, and it only does what it&apos;s really connected to. A <code className="text-accent">[FILL …]</code> blank is treated as unknown, so JARVIS asks you instead of guessing.
      </p>
      {!op ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={op.enabled} disabled={busy} onChange={(e) => put({ enabled: e.target.checked }, e.target.checked ? "The manual is on." : "The manual is off — agents use only their built-in prompts.")} />
              In use
            </label>
            <span className="text-muted-foreground">{text.length.toLocaleString()} / {op.max.toLocaleString()} characters{op.isTemplate ? " · your original document" : " · edited"}{op.updatedAt ? ` · saved ${new Date(op.updatedAt).toLocaleString()}` : ""}</span>
          </div>

          {op.blanks.length > 0 ? (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="mb-2 text-sm font-medium text-amber-300">{op.blanks.length} blank{op.blanks.length === 1 ? "" : "s"} left to fill. Click one to jump to it.</p>
              <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                {op.blanks.map((b) => (
                  <li key={b.line}>
                    <button type="button" className="text-left hover:text-foreground text-muted-foreground" onClick={() => jump(b.line)}>
                      <span className="text-accent">L{b.line}</span>{b.section ? <span className="text-foreground/70"> · {b.section}</span> : null} — {b.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="mb-3 text-sm text-emerald-400">Every blank is filled.</p>}

          <textarea id="operator-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            className="h-96 w-full resize-y rounded-xl border border-border bg-background/60 p-3 font-mono text-xs leading-[18px] outline-none focus:border-accent" />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy || !dirty || text.length > op.max} onClick={() => put({ content: text }, "Saved — agents use it from their next message.")}>Save manual</Button>
            <Button variant="outline" disabled={busy || !dirty} onClick={() => setText(op.content)}>Discard changes</Button>
            <Button variant="outline" disabled={busy || op.isTemplate} onClick={() => { if (confirm("Go back to your original document? Your edits will be replaced.")) void put({ reset: true }, "Back to your original document."); }}>Restore original</Button>
            {msg && <span className={cn("text-sm", msg.ok ? "text-emerald-400" : "text-red-400")}>{msg.text}</span>}
          </div>
        </>
      )}
    </section>
  );
}
