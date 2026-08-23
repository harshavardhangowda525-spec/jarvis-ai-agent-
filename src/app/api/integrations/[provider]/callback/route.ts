import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { getProvider, isProviderConfigured, callbackUrl } from "@/lib/integrations/providers";

export const runtime = "nodejs";

/**
 * OAuth callback: verify state, exchange the authorization code for tokens,
 * and store them against the user. Only after a successful exchange is the
 * integration marked "connected".
 */
export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  // Query params must come BEFORE the hash, or the browser treats them as part
  // of the fragment and the page can't read them.
  const base = `${env.appUrl}/dashboard/settings`;
  const provider = getProvider(params.provider);

  const fail = (reason: string) =>
    NextResponse.redirect(`${base}?integration=${params.provider}&error=${encodeURIComponent(reason)}#integrations`);

  if (!provider || !isProviderConfigured(provider.id)) return fail("unavailable");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (req.nextUrl.searchParams.get("error")) return fail("denied");
  if (!code || !state) return fail("missing_code");

  const claims = await verifySession(state);
  if (!claims || claims.email !== `oauth:${provider.id}`) return fail("bad_state");
  const userId = claims.sub;

  // Exchange the code for tokens.
  let tokenRes: Response;
  try {
    tokenRes = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        redirect_uri: callbackUrl(provider.id),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("token_unreachable");
  }
  if (!tokenRes.ok) return fail("token_exchange_failed");

  const token: any = await tokenRes.json();
  const accessToken = token.access_token ?? token.authed_user?.access_token;
  if (!accessToken) return fail("no_token");

  try {
    await getDb().integration.upsert({
      where: { userId_provider: { userId, provider: provider.id } },
      update: {
        status: "connected",
        accessToken,
        refreshToken: token.refresh_token ?? null,
        scope: token.scope ?? null,
        expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      },
      create: {
        userId,
        provider: provider.id,
        status: "connected",
        accessToken,
        refreshToken: token.refresh_token ?? null,
        scope: token.scope ?? null,
        expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      },
    });
  } catch {
    return fail("store_failed");
  }

  return NextResponse.redirect(`${base}?integration=${provider.id}&connected=1#integrations`);
}
