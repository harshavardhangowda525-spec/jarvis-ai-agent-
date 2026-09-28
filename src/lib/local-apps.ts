import { ultronCall, ultronKnown } from "./local-ultron";
import { matchScore } from "../../edith/src/app-match.mjs";
import { resolveSite, type SiteTarget } from "./open-site";

/**
 * "JARVIS, open Spotify" → the real app on this PC, launched by ULTRON (only
 * apps the computer lists as installed). Client-side.
 */
export type OpenAppResult =
  | { ok: true; app: string; message: string }
  | { ok: false; reason: "offline" | "origin" | "outdated" | "refused" | "not_found"; message: string; suggestions: string[] };

export async function openLocalApp(name: string): Promise<OpenAppResult> {
  const r = await ultronCall<{ app?: string; message?: string }>("/apps/open", {
    body: { name },
    offline: "I can open apps on your PC while my local runtime is running there — start it with npm run local, then ask again.",
  });
  if ((r.ok || r.reason === "not_found") && !installed?.names.length) void refreshInstalledApps(); // learn the list for next time
  if (r.ok) return { ok: true, app: String(r.app ?? name), message: String(r.message ?? `Opening ${name}.`) };
  const suggestions = Array.isArray(r.body?.suggestions) ? (r.body!.suggestions as unknown[]).map(String).slice(0, 3) : [];
  return { ok: false, reason: r.reason, message: r.message, suggestions };
}

/** Words that name JARVIS's own screens/agents — never a desktop app. */
const JARVIS_THINGS = /^(ev|darwin|ultron|edith|jarvis|humanoid( view)?|gesture( mode| control)?|today'?s content|the briefing|briefing|dashboard|tasks?|notes?|memory|memories|operator|settings|console|crm|daily report|report)$/;

/**
 * "open spotify", "launch VS Code", "start whatsapp and spotify", "open the calculator app"
 * → the app names. Null when it isn't an app request (a website, a JARVIS screen, …).
 */
export function parseOpenApp(text: string): string[] | null {
  const s = text.trim().replace(/^(hey |ok |okay )?jarvis[,!.\s]+/i, "").replace(/[.!?]+$/, "").trim();
  const m = s.match(/^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:open(?:\s+up)?|launch|start(?:\s+up)?|run|fire up|bring up|pull up|load up)\s+(.+?)(?:\s+(?:please|for me|now))*$/i);
  if (!m) return null;
  let rest = m[1].trim();
  // explicit web → not an app
  if (/\b(website|web ?site|web page|webpage|in (?:the |my )?browser|on the web|online|link|url|(?:new|another|separate) (?:tab|window))\b|\.(com|in|org|net|io|co|app|dev)\b|https?:|www\./i.test(rest)) return null;
  rest = rest.replace(/\s+(?:on|in)\s+(?:my|the)\s+(?:pc|computer|laptop|desktop|system|machine)$/i, "")
    .replace(/\s+(?:app|application|program|software)$/i, "");
  const names = rest.split(/\s*(?:,|\band\b|&)\s*/i)
    .map((x) => x.trim().replace(/^(?:the|my)\s+/i, "").replace(/\s+(?:app|application|program)$/i, "").trim())
    .filter(Boolean);
  if (!names.length || names.length > 4) return null;
  if (names.some((n) => n.length > 40 || JARVIS_THINGS.test(n.toLowerCase()) || /\b(search|for|about)\b/i.test(n))) return null;
  return names;
}

/* ---------------- app or website? (decided instantly) ---------------- */

// The names of the apps installed on this PC, as ULTRON last listed them. Kept
// here so "open YouTube" can open its tab right away — inside the keypress that
// lets a page open a tab — instead of first asking ULTRON and getting the tab
// pop-up-blocked.
let installed: { at: number; names: string[] } | null = null;
/** Refresh the installed-app list from ULTRON (quietly). */
export async function refreshInstalledApps(): Promise<string[] | null> {
  const r = await ultronCall<{ apps?: unknown }>("/apps", { method: "GET", timeoutMs: 30_000 });
  // Offline, not trusted, or apps turned off → no apps to open right now, so
  // every known site opens as a tab straight away.
  if (!r.ok || !Array.isArray(r.apps)) { installed = { at: Date.now(), names: [] }; return null; }
  installed = { at: Date.now(), names: (r.apps as unknown[]).map(String) };
  return installed.names;
}

export { ultronKnown };

export function installedAppNames(): string[] | null {
  return installed?.names ?? null;
}

/** Is an app by this (spoken) name installed? Null when we don't know the list. */
export function isInstalledApp(name: string, names: string[] | null = installedAppNames()): boolean | null {
  if (!names) return null;
  return names.some((n) => matchScore(name, n) >= 62);
}

export type OpenPlan = { name: string; kind: "web"; site: SiteTarget } | { name: string; kind: "app"; site: SiteTarget | null };

/**
 * For each name: open the website now, or ask ULTRON for the installed app?
 * An installed app wins ("open Spotify" with Spotify installed → the app). A
 * known site that isn't installed — or when ULTRON has never been reachable
 * here, so there are no apps to open — is a new tab straight away.
 */
export function planOpen(names: string[], o: { installed: string[] | null; ultronKnown: boolean; india?: boolean }): OpenPlan[] {
  return names.map((name) => {
    const site = resolveSite(name, null, { india: o.india });
    if (!site) return { name, kind: "app", site: null };
    const app = isInstalledApp(name, o.installed);
    if (app === true) return { name, kind: "app", site };
    if (app === false || !o.ultronKnown) return { name, kind: "web", site };
    return { name, kind: "app", site }; // ULTRON known but the list isn't loaded yet
  });
}

/** Open a web link in this PC's default browser via ULTRON (when the page's own tab was blocked). */
export async function openUrlOnPc(url: string): Promise<boolean> {
  const r = await ultronCall("/open-url", { body: { url }, timeoutMs: 10_000 });
  return r.ok;
}
