import { ultronCall } from "./local-ultron";

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
  if (/\b(website|web ?site|web page|webpage|in (?:the |my )?browser|on the web|online)\b|\.(com|in|org|net|io|co|app|dev)\b|https?:|www\./i.test(rest)) return null;
  rest = rest.replace(/\s+(?:on|in)\s+(?:my|the)\s+(?:pc|computer|laptop|desktop|system|machine)$/i, "")
    .replace(/\s+(?:app|application|program|software)$/i, "");
  const names = rest.split(/\s*(?:,|\band\b|&)\s*/i)
    .map((x) => x.trim().replace(/^(?:the|my)\s+/i, "").replace(/\s+(?:app|application|program)$/i, "").trim())
    .filter(Boolean);
  if (!names.length || names.length > 4) return null;
  if (names.some((n) => n.length > 40 || JARVIS_THINGS.test(n.toLowerCase()) || /\b(search|for|about)\b/i.test(n))) return null;
  return names;
}
