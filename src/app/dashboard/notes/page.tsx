"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, Save } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/notes");
    if (res.ok) setNotes((await res.json()).data.notes);
  }
  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    if (editing) {
      await fetch(`/api/notes/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
    } else {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
    }
    setTitle("");
    setContent("");
    setEditing(null);
    load();
  }

  async function del(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (editing === id) {
      setEditing(null);
      setTitle("");
      setContent("");
    }
    load();
  }

  function edit(n: Note) {
    setEditing(n.id);
    setTitle(n.title);
    setContent(n.content);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader title="Notes" subtitle="Ideas and snippets JARVIS can save for you" />
      <div className="grid flex-1 gap-5 p-5 lg:grid-cols-2">
        <form onSubmit={save} className="glass h-fit rounded-2xl p-4">
          <h2 className="mb-3 text-sm font-medium">
            {editing ? "Edit note" : "New note"}
          </h2>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="mb-3"
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write something…"
            className="mb-3 min-h-[160px]"
          />
          <div className="flex gap-2">
            <Button type="submit">
              {editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editing ? "Save" : "Add note"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setTitle("");
                  setContent("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>

        <div className="space-y-2">
          {notes.length === 0 && (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
          {notes.map((n) => (
            <div key={n.id} className="glass rounded-xl p-4">
              <div className="flex items-start gap-2">
                <button
                  onClick={() => edit(n)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">{n.title}</div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                    {n.content}
                  </p>
                </button>
                <button onClick={() => del(n.id)} aria-label="Delete note">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
