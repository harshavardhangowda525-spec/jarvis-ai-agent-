/**
 * When JARVIS runs on Vercel, its free plan only runs scheduled jobs once a day — but calls, the CRM, the
 * client-portal watch, reminders and background tasks need a tick every minute. `npm run local` does that
 * on the laptop; with JARVIS on Vercel the helper does it instead, using the same CRON_SECRET as Vercel
 * (JARVIS_CRON_SECRET in operator/.env). It never runs against a JARVIS on this laptop (that ticks itself).
 */
import { readLink } from "./maps/finder.mjs";
import { log } from "./log.mjs";

/** [path, every N minutes, timeout s] — the same jobs and pace as `npm run local`. */
export const JOBS = [
  ["/api/cron/prospects", 1, 60], ["/api/cron/phone", 1, 60], ["/api/cron/robin", 1, 60], ["/api/cron/jobs", 1, 300],
  ["/api/cron/plans", 5, 300], ["/api/cron/intel", 10, 300], ["/api/cron/trading", 10, 300], ["/api/cron/mike", 60, 300],
];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Which jobs are due on minute n. Pure (tested). */
export const dueAt = (n) => JOBS.filter(([, every]) => n % every === 0);

export class RemoteTicks {
  constructor({ env = process.env, fetchImpl = fetch, link = readLink } = {}) {
    this.env = env; this.fetch = fetchImpl; this.link = link; this.n = 0; this.busy = new Set(); this.timer = null; this.warned = false;
  }
  /** On only for a JARVIS somewhere else (Vercel) and only with the cron secret. */
  target() {
    const l = this.link(this.env), secret = (this.env.JARVIS_CRON_SECRET || "").trim();
    if (!l || LOCAL.test(l.url) || !secret) return null;
    return { url: l.url, secret };
  }
  async tick() {
    const t = this.target();
    if (!t) return [];
    const ran = [];
    for (const [p, , secs] of dueAt(this.n)) {
      if (this.busy.has(p)) continue;
      this.busy.add(p); ran.push(p);
      this.fetch(`${t.url}${p}`, { headers: { Authorization: `Bearer ${t.secret}` }, signal: AbortSignal.timeout(secs * 1000) })
        .then((r) => { if (r.status === 401 && !this.warned) { this.warned = true; log.warn("JARVIS on Vercel refused the background jobs: JARVIS_CRON_SECRET in operator/.env must equal CRON_SECRET in Vercel."); } })
        .catch(() => { /* offline — next minute */ })
        .finally(() => this.busy.delete(p));
    }
    this.n++;
    return ran;
  }
  start() {
    const t = this.target();
    if (!t) return false;
    log.info(`Running JARVIS's background jobs every minute for ${t.url}`);
    setTimeout(() => this.tick(), 20_000);
    this.timer = setInterval(() => this.tick(), 60_000);
    return true;
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
