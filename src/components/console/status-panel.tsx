"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusData {
  services: Record<string, boolean>;
}

const LABELS: Record<string, string> = {
  voice: "Voice",
  ai: "AI",
  database: "Database",
  search: "Search",
  weather: "Weather",
  tools: "Tools",
};

const ORDER = ["voice", "ai", "database", "search", "weather", "tools"];

export function StatusPanel() {
  const [data, setData] = useState<StatusData | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j?.data && setData(j.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <Cpu className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-medium">System status</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ORDER.map((key) => {
          const online = data?.services?.[key];
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  data == null
                    ? "bg-muted-foreground animate-pulse"
                    : online
                      ? "bg-success shadow-[0_0_8px_hsl(var(--success))]"
                      : "bg-muted-foreground",
                )}
              />
              <span className="font-medium">{LABELS[key]}</span>
              <span className="ml-auto text-muted-foreground">
                {data == null ? "…" : online ? "online" : "offline"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
