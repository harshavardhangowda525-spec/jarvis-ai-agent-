import "server-only";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";
import { rememberPublicBase } from "@/lib/public-url";

/**
 * Instagram Graph API access for EV. Credentials are resolved per-user (an
 * OAuth Integration row) first, then the server-level env token. Tokens NEVER
 * leave the server. Every publish is a real API call — EV only reports success
 * when the API confirms it.
 */

export interface IgCreds {
  accessToken: string;
  businessId: string;
  source: "integration" | "env";
}

/**
 * Two Instagram API flavors are supported transparently:
 *  - "Instagram API with Instagram Login" — tokens start with "IG", host is
 *    graph.instagram.com, and the account node can be "me".
 *  - "Instagram Graph API (via Facebook)" — host graph.facebook.com/<version>,
 *    requires the IG business account id as the node.
 */
function isInstagramLoginToken(token: string): boolean {
  return token.startsWith("IG");
}

/** Facebook-flavour tokens need the IG business account id — found once per token. */
const discovered = new Map<string, string | null>();
async function discoverBusinessId(token: string): Promise<string | null> {
  if (isInstagramLoginToken(token)) return "me";
  if (discovered.has(token)) return discovered.get(token)!;
  let id: string | null = null;
  try {
    const qs = new URLSearchParams({ fields: "instagram_business_account{id}", limit: "25", access_token: token });
    const res = await fetch(`https://graph.facebook.com/${env.instagramGraphVersion}/me/accounts?${qs}`, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json().catch(() => ({}))) as { data?: { instagram_business_account?: { id?: string } }[] };
    id = json.data?.find((p) => p.instagram_business_account?.id)?.instagram_business_account?.id ?? null;
  } catch { /* offline — try again next time */ return null; }
  discovered.set(token, id);
  return id;
}

/**
 * Save working env credentials as this user's Instagram connection, so every
 * copy of JARVIS on the same database finds it — e.g. `npm run local` on your
 * PC, where Vercel doesn't hand out INSTAGRAM_ACCESS_TOKEN (it's "Sensitive").
 * Only after Instagram confirms the token works; once per token per server.
 */
const synced = new Set<string>();
async function saveConnection(userId: string, c: IgCreds) {
  const key = `${userId}:${c.accessToken.slice(-12)}`;
  if (synced.has(key)) return;
  synced.add(key);
  try {
    await igProfile(c); // the token really works
    await getDb().integration.upsert({
      where: { userId_provider: { userId, provider: "instagram" } },
      create: { userId, provider: "instagram", status: "connected", accessToken: c.accessToken, metadata: { businessId: c.businessId, savedFrom: "server settings" } },
      update: { status: "connected", accessToken: c.accessToken, metadata: { businessId: c.businessId, savedFrom: "server settings" } },
    });
  } catch { synced.delete(key); /* bad token or offline — nothing saved */ }
}

/** Why there are no credentials (for messages that say what to do). */
export type IgMissing = "no_token" | "no_business_id";
let lastMissing: IgMissing = "no_token";
export function igMissingReason(): IgMissing { return lastMissing; }

/**
 * Resolve Instagram credentials for a user, or null if not connected: the
 * saved connection (shared by every copy of JARVIS on this database), then the
 * server's INSTAGRAM_ACCESS_TOKEN — whose business account id is looked up
 * when it isn't set, and which is then saved as the connection.
 */
export async function resolveIgCreds(userId: string): Promise<IgCreds | null> {
  void rememberPublicBase(userId); // on Vercel: save its address for JARVIS on the PC
  let rowToken = "";
  try {
    const row = await getDb().integration.findUnique({
      where: { userId_provider: { userId, provider: "instagram" } },
    });
    if (row?.status === "connected" && row.accessToken) {
      rowToken = row.accessToken;
      const meta = (row.metadata ?? {}) as { businessId?: string; igUserId?: string };
      let businessId = meta.businessId || meta.igUserId || env.instagramBusinessId || (isInstagramLoginToken(row.accessToken) ? "me" : "");
      if (!businessId) {
        businessId = (await discoverBusinessId(row.accessToken)) ?? "";
        if (businessId) await getDb().integration.update({ where: { id: row.id }, data: { metadata: { ...meta, businessId } } }).catch(() => {});
      }
      // the server's own token wins when it's different (e.g. renewed on Vercel)
      if (businessId && (!env.instagramAccessToken || env.instagramAccessToken === row.accessToken)) {
        return { accessToken: row.accessToken, businessId, source: "integration" };
      }
    }
  } catch {
    /* fall through to env */
  }
  if (env.instagramAccessToken) {
    // The IG-Login API can use "me"; the Facebook-Graph flavor needs the id (looked up if not set).
    const businessId = env.instagramBusinessId || (await discoverBusinessId(env.instagramAccessToken)) || "";
    if (businessId) {
      const c: IgCreds = { accessToken: env.instagramAccessToken, businessId, source: "env" };
      if (rowToken !== c.accessToken) void saveConnection(userId, c);
      return c;
    }
    lastMissing = "no_business_id";
    return null;
  }
  lastMissing = "no_token";
  return null;
}

/** What to tell the user when resolveIgCreds found nothing. */
export function igNotConnectedMessage(): string {
  return igMissingReason() === "no_business_id"
    ? "Instagram isn't connected: INSTAGRAM_ACCESS_TOKEN is set, but I couldn't find the Instagram business account it belongs to. Set INSTAGRAM_BUSINESS_ID, or use a token from Instagram Login (starts with IG)."
    : "Instagram isn't connected here: this copy of JARVIS has no INSTAGRAM_ACCESS_TOKEN (Vercel doesn't copy \"Sensitive\" values to your PC). Open EV once in your Vercel JARVIS — it saves the connection to your database and this PC picks it up — or paste the token into .env.local.";
}

function base(token: string): string {
  return isInstagramLoginToken(token)
    ? `https://graph.instagram.com/${env.instagramGraphVersion}`
    : `https://graph.facebook.com/${env.instagramGraphVersion}`;
}

async function graphGet(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${base(token)}/${path}?${qs.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as any)?.error ?? {};
    const msg = e.error_user_msg || e.message || `Instagram API error (HTTP ${res.status}).`;
    throw new IgError(msg, res.status, e.code, e.error_subcode);
  }
  return json;
}

async function graphPost(path: string, params: Record<string, string>, token: string) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${base(token)}/${path}`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as any)?.error ?? {};
    const msg = e.error_user_msg || e.message || `Instagram API error (HTTP ${res.status}).`;
    throw new IgError(msg, res.status, e.code, e.error_subcode);
  }
  return json;
}

export class IgError extends Error {
  constructor(message: string, public status?: number, public code?: number, public subcode?: number) {
    super(message);
    this.name = "IgError";
  }
}

/** Graph "not ready yet" errors: code 9007 / subcode 2207027 ("Media ID is not available"). */
function isNotReady(e: unknown): boolean {
  return e instanceof IgError && (e.code === 9007 || e.subcode === 2207027 || /media id is not available|not ready/i.test(e.message));
}

/** Profile: username, followers, following, media count. */
export async function igProfile(c: IgCreds) {
  return graphGet(
    c.businessId,
    { fields: "user_id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website" },
    c.accessToken,
  );
}

/** Recent media with basic engagement fields. */
export async function igMedia(c: IgCreds, limit = 12) {
  const json: any = await graphGet(
    `${c.businessId}/media`,
    { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: String(limit) },
    c.accessToken,
  );
  return json.data ?? [];
}

/** Account-level insights (reach, profile views, …) for a period. */
export async function igAccountInsights(c: IgCreds, metrics: string[], period = "day") {
  const json: any = await graphGet(
    `${c.businessId}/insights`,
    { metric: metrics.join(","), period },
    c.accessToken,
  );
  return json.data ?? [];
}

/**
 * Publish a single image post. Two-step: create a media container, then publish
 * it. Returns the real media id ONLY on confirmed publish.
 */
export async function igPublishImage(c: IgCreds, imageUrl: string, caption: string): Promise<string> {
  const container: any = await graphPost(
    `${c.businessId}/media`,
    { image_url: imageUrl, caption },
    c.accessToken,
  );
  const creationId = container?.id;
  if (!creationId) throw new IgError("Instagram did not return a media container id.");

  // Instagram downloads + processes the image asynchronously. Publishing before
  // it's FINISHED fails with "Media ID is not available" (9007) — so wait first.
  const st = await igWaitContainer(c, creationId, 30_000, 2000); // + prep + retries stays under Vercel's 60s
  if (st.error) throw new IgError(`Instagram couldn't process the image${st.detail ? `: ${st.detail}` : ""}.`);
  if (!st.ready) throw new IgError("Instagram is still processing the image — say publish again in a minute.");
  return igPublishContainer(c, creationId);
}

// --- Reels (video) -------------------------------------------------------
// Reels publishing is 3 steps: create a REELS container from a public video URL,
// wait while Instagram downloads + processes the video (can take a while), then
// publish the finished container.

/** Create a REELS container; returns the creation/container id. */
export async function igCreateReel(c: IgCreds, videoUrl: string, caption: string): Promise<string> {
  const container: any = await graphPost(
    `${c.businessId}/media`,
    { media_type: "REELS", video_url: videoUrl, caption },
    c.accessToken,
  );
  if (!container?.id) throw new IgError("Instagram did not return a reel container id.");
  return container.id as string;
}

/** Publish a finished container; returns the real media id. */
export async function igPublishContainer(c: IgCreds, creationId: string): Promise<string> {
  // Even after FINISHED, media_publish can briefly answer 9007 — retry a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      const published: any = await graphPost(
        `${c.businessId}/media_publish`,
        { creation_id: creationId },
        c.accessToken,
      );
      if (!published?.id) throw new IgError("Instagram did not confirm the publish.");
      return published.id as string;
    } catch (e) {
      if (!isNotReady(e) || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

export interface ReelStatus { ready: boolean; status: string; error: boolean; detail?: string }

/** Poll a container's processing status until FINISHED/ERROR or the budget ends. */
export async function igWaitContainer(c: IgCreds, creationId: string, budgetMs: number, intervalMs = 6000): Promise<ReelStatus> {
  const deadline = Date.now() + budgetMs;
  while (true) {
    const json: any = await graphGet(creationId, { fields: "status_code,status" }, c.accessToken);
    const code = String(json?.status_code ?? "").toUpperCase() || String(json?.status ?? "").split(":")[0].toUpperCase();
    if (code === "FINISHED" || code === "PUBLISHED") return { ready: true, status: code, error: false };
    if (code === "ERROR" || code === "EXPIRED") {
      // "status" carries Instagram's human-readable reason, e.g. "Error: ... aspect ratio".
      const detail = typeof json?.status === "string" ? json.status.replace(/^error:\s*/i, "").trim() : undefined;
      return { ready: false, status: code, error: true, detail };
    }
    if (Date.now() + intervalMs >= deadline) return { ready: false, status: code || "IN_PROGRESS", error: false };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
