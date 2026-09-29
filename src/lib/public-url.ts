import "server-only";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";

/**
 * The public https address Instagram downloads EV's media from.
 *
 * Instagram fetches the image/video itself, so it needs an address on the
 * internet. On Vercel that's the app's own address. JARVIS on your PC
 * (`npm run local`) runs at localhost, which Instagram can't reach — but the
 * media lives in the shared database, so the Vercel app serves the very same
 * file. Vercel saves its address here whenever it runs EV; the PC uses it.
 */

export const isPublicUrl = (u: string) => /^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b/i.test(u);

const PROVIDER = "jarvis_public_url";

/** This server's own public address, if it has one (production domain first on Vercel). */
export function ownPublicBase(): string | null {
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  if (prod && !/^\[sensitive\]$/i.test(prod)) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const own = env.appUrl.replace(/\/$/, "");
  return isPublicUrl(own) ? own : null;
}

const remembered = new Set<string>();
/** Save this server's public address for the user (once per process), so other copies of JARVIS can use it. */
export async function rememberPublicBase(userId: string): Promise<void> {
  const base = ownPublicBase();
  if (!base || remembered.has(`${userId}:${base}`)) return;
  remembered.add(`${userId}:${base}`);
  await getDb().integration.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, status: "connected", metadata: { url: base } },
    update: { status: "connected", metadata: { url: base } },
  }).catch(() => { remembered.delete(`${userId}:${base}`); });
}

/** The address to give Instagram: this server's own, else the one the deployed app saved. */
export async function publicBase(userId: string): Promise<string | null> {
  const own = ownPublicBase();
  if (own) { void rememberPublicBase(userId); return own; }
  const row = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } }, select: { metadata: true } }).catch(() => null);
  const url = (row?.metadata as { url?: string } | null)?.url ?? "";
  return isPublicUrl(url) ? url.replace(/\/$/, "") : null;
}

/**
 * A media link Instagram can fetch: EV's own media (/api/ev/media/…) is served
 * from the public address whatever host the link was built with; any other
 * public link is kept; otherwise null.
 */
export function publicMediaUrl(url: string, base: string | null): string | null {
  const m = url.match(/\/api\/ev\/media\/[A-Za-z0-9_-]+(\?[^#]*)?/);
  if (m && base) return `${base}${m[0]}`;
  return isPublicUrl(url) ? url : null;
}

/** What to say when there's no public address at all. */
export const NO_PUBLIC_URL =
  "Instagram downloads the media from a public https address, and this copy of JARVIS (on your PC) doesn't have one. " +
  "Open EV once in your Vercel JARVIS — it saves its address and this PC uses it — or set APP_URL in .env.local to your Vercel address (https://….vercel.app).";
