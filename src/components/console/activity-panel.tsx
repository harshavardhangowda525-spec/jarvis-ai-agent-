"use client";

import { Activity, Check, AlertTriangle, Loader2 } from "lucide-react";
import type { ActivityItem } from "@/hooks/useAgent";
import { cn } from "@/lib/utils";

export function ActivityPanel({
  items,
  streaming,
}: {
  items: ActivityItem[];
  streaming: boolean;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-medium">Live activity</h3>
        {streaming && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-accent" />}
      </div>
      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">Idle. Waiting for your request.</p>
        )}
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs animate-fade-in"
          >
            {it.kind === "error" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : it.kind === "tool" ? (
              it.status === "error" ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              ) : (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              )
            ) : (
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            )}
            <span
              className={cn(
                it.kind === "error" ? "text-destructive" : "text-foreground/90",
              )}
            >
              {it.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
