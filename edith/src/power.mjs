/**
 * Laptop power control for JARVIS ("JARVIS, shut down my laptop").
 *
 * Deliberately narrow: exactly two actions — shut down after a delay, or
 * cancel a pending shutdown. No arbitrary commands, no shell (execFile with
 * fixed arguments). The delay (default 30s, 10s–1h) always leaves time to
 * cancel: on Windows via the system's own `shutdown /a` (works even if JARVIS
 * is closed), elsewhere by cancelling the pending timer here.
 * Disable entirely with ULTRON_POWER=off.
 */
import { execFile } from "node:child_process";
import { log } from "./log.mjs";

export const DEFAULT_DELAY = 30;
let pending = null; // { timer, at } — non-Windows scheduled shutdown

export function powerEnabled(env = process.env) {
  return !/^(off|0|false|no)$/i.test(String(env.ULTRON_POWER || "").trim());
}

export function clampDelay(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(3600, Math.max(10, n)) : DEFAULT_DELAY;
}

/**
 * The exact OS command for an action (pure — used by tests too).
 * Returns { file, args, when } where `when` is "now" (run immediately, the OS
 * handles the delay) or "after" (run after the delay, cancellable here).
 */
export function powerPlan(action, delaySec, platform = process.platform) {
  const delay = clampDelay(delaySec);
  if (platform === "win32") {
    return action === "cancel"
      ? { file: "shutdown", args: ["/a"], when: "now", delay: 0 }
      : { file: "shutdown", args: ["/s", "/t", String(delay), "/c", "JARVIS is shutting down this PC. To cancel, tell JARVIS \"cancel shutdown\" or run: shutdown /a"], when: "now", delay };
  }
  if (action === "cancel") return { file: null, args: [], when: "cancel", delay: 0 };
  if (platform === "darwin") return { file: "osascript", args: ["-e", 'tell application "System Events" to shut down'], when: "after", delay };
  return { file: "systemctl", args: ["poweroff"], when: "after", delay };
}

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
    resolve({ ok: !err, output: String(stderr || stdout || (err && err.message) || "").trim() });
  });
});

/** Carry out a power action. Resolves { ok, message, at? }. */
export async function doPower(action, delaySec) {
  if (!powerEnabled()) return { ok: false, message: "Power control is turned off on this computer (ULTRON_POWER=off)." };
  if (action !== "shutdown" && action !== "cancel") return { ok: false, message: "Unknown power action." };
  const plan = powerPlan(action, delaySec);

  if (action === "cancel") {
    if (plan.when === "cancel") {
      if (!pending) return { ok: false, message: "There's no shutdown pending." };
      clearTimeout(pending.timer); pending = null;
      log.info("Shutdown cancelled.");
      return { ok: true, message: "Shutdown cancelled." };
    }
    const r = await run(plan.file, plan.args);
    // Windows answers error 1116 when nothing was scheduled.
    if (!r.ok) return { ok: false, message: /1116|no shutdown|not in progress/i.test(r.output) ? "There's no shutdown pending." : `Couldn't cancel: ${r.output || "unknown error"}.` };
    log.info("Shutdown cancelled.");
    return { ok: true, message: "Shutdown cancelled." };
  }

  const at = new Date(Date.now() + plan.delay * 1000).toISOString();
  if (plan.when === "now") {
    const r = await run(plan.file, plan.args);
    if (!r.ok) return { ok: false, message: /1190|already/i.test(r.output) ? "A shutdown is already scheduled." : `Windows refused the shutdown: ${r.output || "unknown error"}.` };
    log.warn(`Shutdown scheduled in ${plan.delay}s (requested from JARVIS).`);
    return { ok: true, message: `Shutting down in ${plan.delay} seconds.`, at };
  }
  if (pending) return { ok: false, message: "A shutdown is already scheduled." };
  pending = {
    at,
    timer: setTimeout(async () => {
      pending = null;
      const r = await run(plan.file, plan.args);
      if (!r.ok) log.error(`Shutdown failed: ${r.output}`);
    }, plan.delay * 1000),
  };
  log.warn(`Shutdown scheduled in ${plan.delay}s (requested from JARVIS).`);
  return { ok: true, message: `Shutting down in ${plan.delay} seconds.`, at };
}
