"use client";

import { useEffect, useState } from "react";
import { ListTodo } from "lucide-react";

interface TaskRow {
  id: string;
  title: string;
  dueAt: string | null;
  priority: string;
}

export function TasksPreview({ refreshKey }: { refreshKey: number }) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/tasks?status=pending")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setTasks(j?.data?.tasks ?? []))
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-medium">Tasks</h3>
        {tasks && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {tasks.length} open
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {tasks == null && <p className="text-xs text-muted-foreground">Loading…</p>}
        {tasks?.length === 0 && (
          <p className="text-xs text-muted-foreground">No open tasks.</p>
        )}
        {tasks?.slice(0, 5).map((t) => (
          <div key={t.id} className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="truncate">{t.title}</span>
              {t.priority === "high" && (
                <span className="ml-auto shrink-0 rounded bg-warning/20 px-1.5 text-[10px] text-warning">
                  high
                </span>
              )}
            </div>
            {t.dueAt && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                due {new Date(t.dueAt).toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
