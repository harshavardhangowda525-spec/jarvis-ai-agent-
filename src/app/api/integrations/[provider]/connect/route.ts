import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { signSession } from "@/lib/auth/jwt";
import {
  getProvider,
  isProviderConfigured,
  callbackUrl,
} from "@/lib/integrations/providers";
import { fail, handleError } from "@/lib/api";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

/**
 * Begin the OAuth flow: redirect the user to the provider's authorize URL.
 * `state` is a short-lived signed token binding the flow to this user, so the
 * callback can't be forged (CSRF protection).
 */
export async function GET(_req: NextRequest, { params }: { params: { provider: string } }) {
  try {
    const user = await requireUser();
    const provider = getProvider(params.provider);
    if (!provider) return fail("Unknown integration.", 404);
    if (!isProviderConfigured(provider.id)) {
      return fail(
        `${provider.label} is not configured. Add its OAuth credentials to enable it.`,
        503,
      );
    }

    // Reuse the HMAC signer for a compact, verifiable state token.
    const state = await signSession({
      sub: user.id,
      email: `oauth:${provider.id}`,
      jti: randomUUID(),
    });

    const url = new URL(provider.authorizeUrl);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", callbackUrl(provider.id));
    url.searchParams.set("response_type", "code");
    if (provider.scopes.length) url.searchParams.set("scope", provider.scopes.join(" "));
    url.searchParams.set("state", state);
    for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) {
      url.searchParams.set(k, v);
    }

    return NextResponse.redirect(url.toString());
  } catch (err) {
    return handleError(err);
  }
}
