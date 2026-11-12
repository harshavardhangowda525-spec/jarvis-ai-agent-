import "server-only";

/**
 * What JARVIS's Calls window on the laptop is doing right now — its setup
 * checks, what it's waiting for, and the live conversation — so the dashboard
 * can show it. Kept in memory (JARVIS runs as one process on the laptop); it
 * only describes the present moment.
 */
export interface LiveLine { who: "jarvis" | "them" | "info"; text: string; at: number }
export interface CallerLive {
  at: number; running: boolean; via: string | null; wait: string | null; error: string | null;
  checks: { label: string; ok: boolean | null; detail?: string }[]; lines: LiveLine[];
}
const live = new Map<string, CallerLive>();
const STALE_MS = 90_000;

export function setLive(userId: string, s: Omit<CallerLive, "at">, now = Date.now()) {
  live.set(userId, {
    ...s, at: now,
    checks: s.checks.slice(0, 12).map((c) => ({ label: c.label.slice(0, 80), ok: c.ok, detail: c.detail?.slice(0, 240) })),
    lines: s.lines.slice(-40).map((l) => ({ who: l.who, text: l.text.slice(0, 500), at: l.at })),
  });
}

/** null when the Calls window hasn't reported in the last 90 seconds (not open / JARVIS not running on the laptop). */
export function getLive(userId: string, now = Date.now()): (CallerLive & { online: true }) | null {
  const s = live.get(userId);
  return s && now - s.at < STALE_MS ? { ...s, online: true } : null;
}
