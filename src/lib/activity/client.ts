/**
 * Browser-side activity logging (ULTRON's work, opening agent views). Fire and
 * forget — never blocks or breaks the UI.
 */
export interface ClientActivity {
  category: "agent" | "development" | "error" | "solution" | "business" | "communication" | "decision" | "file" | "marketing";
  agent: string;
  action: string;
  result?: string | null;
  status?: "success" | "failed" | "info";
  importance?: number;
  project?: string | null;
  metadata?: Record<string, unknown>;
}

export function logActivity(e: ClientActivity) {
  try {
    void fetch("/api/activity", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...e, action: e.action.slice(0, 300), result: e.result ? String(e.result).slice(0, 400) : null }),
    }).catch(() => {});
  } catch { /* offline */ }
}
