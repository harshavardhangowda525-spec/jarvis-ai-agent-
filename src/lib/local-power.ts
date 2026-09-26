/**
 * Ask ULTRON — JARVIS's runtime on your own computer — to shut the laptop down
 * (or cancel). A website can't power off a computer by itself; ULTRON can,
 * and it only accepts requests from your JARVIS app with its pairing token.
 */
export type PowerResult =
  | { ok: true; message: string }
  | { ok: false; reason: "offline" | "origin" | "refused"; message: string };

function ultronHttp(): string {
  let ws = "ws://127.0.0.1:7420";
  try { ws = localStorage.getItem("jarvis.ultron.url") || localStorage.getItem("jarvis.edith.url") || ws; } catch { /* default */ }
  return ws.trim().replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

export async function laptopPower(action: "shutdown" | "cancel", delaySec?: number): Promise<PowerResult> {
  const base = ultronHttp();
  let token = "";
  try {
    const r = await fetch(`${base}/pair`, { signal: AbortSignal.timeout(4000) });
    if (r.status === 403) return { ok: false, reason: "origin", message: "ULTRON on this computer doesn't trust this page yet — add this site to ULTRON_ALLOWED_ORIGINS in edith/.env and restart it." };
    token = (await r.json())?.token ?? "";
  } catch {
    return { ok: false, reason: "offline", message: "I can only switch off the laptop while my local runtime is running on it — start it with npm run local (or ULTRON), then ask again." };
  }
  try {
    const r = await fetch(`${base}/power`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, delaySec }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.ok) return { ok: true, message: String(j.message || "Done.") };
    if (r.status === 404) return { ok: false, reason: "refused", message: "My local runtime on this laptop is an older version — pull the latest JARVIS and restart npm run local, then ask again." };
    return { ok: false, reason: "refused", message: String(j?.message || `The laptop refused (HTTP ${r.status}).`) };
  } catch {
    return { ok: false, reason: "offline", message: "Lost contact with my local runtime." };
  }
}
