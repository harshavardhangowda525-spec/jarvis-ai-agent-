import { env } from "@/lib/env";
import { ok, fail, handleError } from "@/lib/api";
import { runDarwinDaily } from "@/lib/darwin/daily/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How many times one cron firing may hand the search on (~4 min each → ~2 h). */
const MAX_HOPS = 30;
/** Vercel fires a daily cron any time within its hour — let it start up to an hour early. */
const EARLY_MIN = 60;

/**
 * DARWIN's autonomous daily lead search (Vercel Cron + `npm run local`).
 *
 * One call works for ~4 minutes. If today's search still isn't finished, it
 * hands on to a fresh call of itself (?hop=n) and so on until the target is
 * reached or the search area runs out — so the leads are ready before you open
 * DARWIN, not only while it's open. Vercel keeps a function running after the
 * caller stops waiting, and the run's lease means two calls never work at once.
 * `npm run local` loops by itself and passes ?chain=off.
 */
export async function GET(req: Request) {
  try {
    if (!env.cronSecret) return fail("CRON_SECRET is not configured.", 503);
    if (req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return fail("Unauthorized.", 401);
    const url = new URL(req.url);
    const hop = Math.max(0, Math.min(Number(url.searchParams.get("hop")) || 0, MAX_HOPS));
    const result = await runDarwinDaily({ budgetMs: 250_000, earlyMin: EARLY_MIN });
    let continued = false;
    if (result.more && hop < MAX_HOPS && url.searchParams.get("chain") !== "off") {
      continued = await handOn(url, hop + 1);
    }
    return ok({ ...result, hop, continued });
  } catch (err) {
    return handleError(err);
  }
}

/** Start the next call and stop waiting once it's on its way. */
async function handOn(url: URL, hop: number): Promise<boolean> {
  const next = new URL(url.pathname, url.origin);
  next.searchParams.set("hop", String(hop));
  try {
    await fetch(next, { headers: { Authorization: `Bearer ${env.cronSecret}` }, signal: AbortSignal.timeout(3_000), cache: "no-store" });
  } catch {
    /* expected: we don't wait for it to finish */
  }
  return true;
}
