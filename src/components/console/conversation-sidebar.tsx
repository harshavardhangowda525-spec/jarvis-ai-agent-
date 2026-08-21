"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Trash2, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";

interface Convo {
  id: string;
  title: string;
  updatedAt: string;
}

export function ConversationSidebar({
  activeId,
  onSelect,
  onNew,
  reloadKey,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  reloadKey: number;
}) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (res.ok) {
      const j = await res.json();
      setConvos(j.data.conversations);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  async function del(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex h-full flex-col">
      <button
        onClick={onNew}
        className="mb-3 flex items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20"
      >
        <Plus className="h-4 w-4" /> New conversation
      </button>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="pl-8"
        />
      </div>

      <div className="-mr-1 flex-1 space-y-1 overflow-y-auto pr-1">
        {convos.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
        )}
        {convos.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition",
              activeId === c.id
                ? "bg-accent/15 text-accent"
                : "text-foreground/80 hover:bg-muted/60",
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{c.title}</div>
              <div className="text-[10px] text-muted-foreground">{timeAgo(c.updatedAt)}</div>
            </div>
            <button
              onClick={(e) => del(c.id, e)}
              className="opacity-0 transition group-hover:opacity-100"
              aria-label="Delete conversation"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
