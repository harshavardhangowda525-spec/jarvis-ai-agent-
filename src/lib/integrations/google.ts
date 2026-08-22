import "server-only";
import { getDb } from "@/lib/db";
import { getProvider } from "./providers";
import { ToolError } from "@/lib/tools/types";

/**
 * Returns a valid Google access token for the user, refreshing it via the
 * stored refresh token when it's expired. Throws a user-facing ToolError with
 * guidance when Google isn't connected — the agent relays that honestly rather
 * than pretending.
 */
export async function getGoogleAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const integ = await db.integration.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });

  if (!integ || integ.status !== "connected" || !integ.accessToken) {
    throw new ToolError(
      "Google isn't connected yet. Open Settings → Integrations and connect Google first.",
    );
  }

  const expiringSoon =
    integ.expiresAt && integ.expiresAt.getTime() < Date.now() + 60_000;

  if (!expiringSoon) return integ.accessToken;

  // Refresh the access token.
  if (!integ.refreshToken) {
    throw new ToolError(
      "Your Google session expired. Please reconnect Google in Settings → Integrations.",
    );
  }
  const provider = getProvider("google")!;
  let res: Response;
  try {
    res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: integ.refreshToken,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ToolError("Couldn't reach Google to refresh access. Try again shortly.");
  }
  if (!res.ok) {
    throw new ToolError(
      "Couldn't refresh Google access. Please reconnect Google in Settings → Integrations.",
    );
  }
  const j: any = await res.json();
  const accessToken: string = j.access_token;
  await db.integration.update({
    where: { userId_provider: { userId, provider: "google" } },
    data: {
      accessToken,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
    },
  });
  return accessToken;
}
