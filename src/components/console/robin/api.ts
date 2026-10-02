"use client";

export interface ApiResult<T> { ok: boolean; data?: T; error?: string; code?: string | null; status: number }

/** Rubin's API from the browser. Errors come back as plain messages; 409 + code "needs_confirmation" = ask, then retry with confirm. */
export async function rapi<T = any>(path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`/api/robin/${path}`, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, data: j.data, error: j.error, code: j.code ?? null, status: r.status };
  } catch {
    return { ok: false, error: "Couldn't reach Rubin — check your connection.", status: 0 };
  }
}

/** "2026-10-02T16:00" for <input type="datetime-local"> in the browser's own timezone. */
export function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function when(d: string | Date | null | undefined, tz?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function ago(d: string | Date): string {
  const s = (Date.now() - +new Date(d)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
