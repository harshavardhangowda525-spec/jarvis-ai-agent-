/**
 * Talk to ULTRON — JARVIS's runtime on your own computer — for things a web
 * page can't do by itself (power, opening desktop apps). ULTRON only answers
 * your JARVIS app (origin allow-list) with its pairing token.
 */
export type UltronFailure = { ok: false; reason: "offline" | "origin" | "outdated" | "refused" | "not_found"; message: string; status?: number; body?: Record<string, unknown> };
export type UltronResult<T> = ({ ok: true } & T) | UltronFailure;

function ultronHttp(): string {
  let ws = "ws://127.0.0.1:7420";
  try { ws = localStorage.getItem("jarvis.ultron.url") || localStorage.getItem("jarvis.edith.url") || ws; } catch { /* default */ }
  return ws.trim().replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

const SEEN_KEY = "jarvis.ultron.seen";
function markUltronKnown() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
}
/**
 * Is ULTRON expected on this PC — JARVIS opened locally, or ULTRON has answered
 * this browser before? Only then does JARVIS contact it unasked (e.g. to list
 * your apps), so a page that has never used it doesn't poke at your network.
 */
export function ultronKnown(): boolean {
  try {
    // JARVIS itself running on this PC (npm run local) → ULTRON is right here too.
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch { return false; }
}

const OFFLINE = "My local runtime isn't running on this computer — start it with npm run local (or ULTRON), then ask again.";

export async function ultronCall<T extends Record<string, unknown>>(path: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; offline?: string } = {}): Promise<UltronResult<T>> {
  const base = ultronHttp();
  let token = "";
  try {
    const r = await fetch(`${base}/pair`, { signal: AbortSignal.timeout(4000) });
    if (r.status === 403) return { ok: false, reason: "origin", message: "ULTRON on this computer doesn't trust this page yet — add this site to ULTRON_ALLOWED_ORIGINS in edith/.env and restart it." };
    token = (await r.json())?.token ?? "";
    if (token) markUltronKnown();
  } catch {
    return { ok: false, reason: "offline", message: init.offline ?? OFFLINE };
  }
  try {
    const r = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok && j?.ok) return { ok: true, ...(j as T) };
    if (r.status === 404 && !("notFound" in j)) return { ok: false, reason: "outdated", message: "My local runtime on this computer is an older version — pull the latest JARVIS and restart npm run local, then ask again.", status: 404 };
    return { ok: false, reason: j?.notFound ? "not_found" : "refused", message: String(j?.message || `Your computer refused (HTTP ${r.status}).`), status: r.status, body: j };
  } catch {
    return { ok: false, reason: "offline", message: "Lost contact with my local runtime." };
  }
}

/** ULTRON's address + pairing token (+ what it can do), for a direct socket like the live browser. */
export async function ultronPair(): Promise<{ ok: true; base: string; token: string; features: string[] } | UltronFailure> {
  const base = ultronHttp();
  try {
    const r = await fetch(`${base}/pair`, { signal: AbortSignal.timeout(4000) });
    if (r.status === 403) return { ok: false, reason: "origin", message: "ULTRON on this computer doesn't trust this page yet — add this site to ULTRON_ALLOWED_ORIGINS in edith/.env and restart it." };
    const j = await r.json();
    if (!j?.token) return { ok: false, reason: "offline", message: OFFLINE };
    markUltronKnown();
    return { ok: true, base, token: String(j.token), features: Array.isArray(j.features) ? j.features.map(String) : [] };
  } catch {
    return { ok: false, reason: "offline", message: OFFLINE };
  }
}
