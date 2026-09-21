import "server-only";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";

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

/** Resolve Instagram credentials for a user, or null if not connected. */
export async function resolveIgCreds(userId: string): Promise<IgCreds | null> {
  try {
    const row = await getDb().integration.findUnique({
      where: { userId_provider: { userId, provider: "instagram" } },
    });
    if (row?.status === "connected" && row.accessToken) {
      const meta = (row.metadata ?? {}) as { businessId?: string; igUserId?: string };
      const businessId =
        meta.businessId || meta.igUserId || env.instagramBusinessId ||
        (isInstagramLoginToken(row.accessToken) ? "me" : "");
      if (businessId) return { accessToken: row.accessToken, businessId, source: "integration" };
    }
  } catch {
    /* fall through to env */
  }
  if (env.instagramAccessToken) {
    // The IG-Login API can use "me"; the Facebook-Graph flavor needs the id.
    const businessId =
      env.instagramBusinessId || (isInstagramLoginToken(env.instagramAccessToken) ? "me" : "");
    if (businessId) return { accessToken: env.instagramAccessToken, businessId, source: "env" };
  }
  return null;
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
    const msg = (json as any)?.error?.message || `Instagram API error (HTTP ${res.status}).`;
    throw new IgError(msg, res.status);
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
    const msg = (json as any)?.error?.message || `Instagram API error (HTTP ${res.status}).`;
    throw new IgError(msg, res.status);
  }
  return json;
}

export class IgError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "IgError";
  }
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
  const published: any = await graphPost(
    `${c.businessId}/media_publish`,
    { creation_id: creationId },
    c.accessToken,
  );
  if (!published?.id) throw new IgError("Instagram did not confirm the publish.");
  return published.id as string;
}
