"use client";

import { useEffect, useState } from "react";
import { Check, Trash2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/tasks");
    if (res.ok) setTasks((await res.json()).data.tasks);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    setTitle("");
    load();
  }

  async function toggle(t: Task) {
    await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: t.status === "done" ? "pending" : "done" }),
    });
    load();
  }

  async function del(id: string) {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader title="Tasks" subtitle="Reminders and to-dos, by voice or hand" />
      <div className="mx-auto w-full max-w-2xl flex-1 p-5">
        <form onSubmit={add} className="mb-5 flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task…"
          />
          <Button type="submit">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="glass flex items-center gap-3 rounded-xl px-4 py-3"
              >
                <button
                  onClick={() => toggle(t)}
                  aria-label={t.status === "done" ? "Mark pending" : "Complete task"}
                  className={
                    "flex h-5 w-5 items-center justify-center rounded-full border " +
                    (t.status === "done"
                      ? "border-success bg-success/20 text-success"
                      : "border-border")
                  }
                >
                  {t.status === "done" && <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      "text-sm " +
                      (t.status === "done" ? "text-muted-foreground line-through" : "")
                    }
                  >
                    {t.title}
                  </div>
                  {t.dueAt && (
                    <div className="text-[11px] text-muted-foreground">
                      due {new Date(t.dueAt).toLocaleString()}
                    </div>
                  )}
                </div>
                {t.priority === "high" && (
                  <span className="rounded bg-warning/20 px-1.5 text-[10px] text-warning">
                    high
                  </span>
                )}
                <button onClick={() => del(t.id)} aria-label="Delete task">
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
