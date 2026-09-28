import { ultronCall } from "./local-ultron";

/**
 * Ask ULTRON — JARVIS's runtime on your own computer — to shut the laptop down
 * (or cancel). A website can't power off a computer by itself; ULTRON can,
 * and it only accepts requests from your JARVIS app with its pairing token.
 */
export type PowerResult =
  | { ok: true; message: string }
  | { ok: false; reason: "offline" | "origin" | "refused"; message: string };

export async function laptopPower(action: "shutdown" | "cancel", delaySec?: number): Promise<PowerResult> {
  const r = await ultronCall<{ message?: string }>("/power", {
    body: { action, delaySec },
    offline: "I can only switch off the laptop while my local runtime is running on it — start it with npm run local (or ULTRON), then ask again.",
  });
  if (r.ok) return { ok: true, message: String(r.message || "Done.") };
  if (r.reason === "outdated") return { ok: false, reason: "refused", message: "My local runtime on this laptop is an older version — pull the latest JARVIS and restart npm run local, then ask again." };
  return { ok: false, reason: r.reason === "not_found" ? "refused" : r.reason, message: r.message };
}
