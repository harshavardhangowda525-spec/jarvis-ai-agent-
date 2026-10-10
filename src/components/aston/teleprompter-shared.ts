import type { ScriptDetails, ScriptKind, ScriptSection } from "@/lib/aston/scripts/format";

/** Types, API helper and reading preferences shared by the teleprompter pieces (client). */

export interface Script {
  id: string; title: string; kind: ScriptKind; kindLabel: string; businessType: string | null;
  details: ScriptDetails; sections: ScriptSection[]; request: string; saved: boolean; updatedAt: string;
}
export interface ListRow { id: string; title: string; kind: ScriptKind; kindLabel: string; businessType: string | null; saved: boolean; updatedAt: string }

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || (r.status === 401 ? "Signed out — sign in again." : `Request failed (HTTP ${r.status}).`));
  return j.data as T;
}

export type Align = "left" | "center" | "justify";
export interface Prefs {
  speed: number; font: number; align: Align; spacing: number;
  /** after you touch the script, carry on scrolling by itself after a few seconds */
  autoResume: boolean;
  /** close the pop-up by tapping outside it (off by default — a stray tap mid-call shouldn't close your script) */
  outsideCloses: boolean;
  /** live glass blur: "auto" measures the device and falls back to lite glass if scrolling would stutter */
  glass: "auto" | "full" | "lite";
}
export const DEFAULT_PREFS: Prefs = { speed: 4, font: 34, align: "left", spacing: 1.5, autoResume: false, outsideCloses: false, glass: "auto" };
const PREFS_KEY = "aston.teleprompter.prefs";

export function loadPrefs(): Prefs {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") } as Prefs;
    if (!["left", "center", "justify"].includes(p.align)) p.align = "left";
    if (!["auto", "full", "lite"].includes(p.glass)) p.glass = "auto";
    return p;
  } catch { return DEFAULT_PREFS; }
}
export function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

/** The script + reading position kept for this tab, so closing and reopening carries on where you were. */
const SESSION_KEY = "aston.teleprompter.last";
export function rememberPosition(id: string, ratio: number) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, ratio })); } catch { /* blocked */ } }
export function lastPosition(): { id: string; ratio: number } | null {
  try { const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null"); return v?.id ? v : null; } catch { return null; }
}

export const SPEED_LABEL = (level: number) => `${(level / 4).toFixed(level % 4 ? 2 : 1)}x`;
export const SIZE_LABEL = (px: number) => (px < 28 ? "Small" : px < 38 ? "Medium" : px < 52 ? "Large" : "Extra large");
export const SPACINGS: [number, string][] = [[1.3, "Compact"], [1.5, "Normal"], [1.8, "Relaxed"], [2.1, "Loose"]];

/** Did this device already prove too slow for live blur while scrolling (this tab)? */
const LITE_KEY = "aston.teleprompter.slowGlass";
export const slowGlassKnown = () => { try { return sessionStorage.getItem(LITE_KEY) === "1"; } catch { return false; } };
export const markSlowGlass = () => { try { sessionStorage.setItem(LITE_KEY, "1"); } catch { /* blocked */ } };
/** A median frame slower than this (~33 fps) while the text moves = too slow for live blur. */
export const SLOW_FRAME = 1 / 33;
