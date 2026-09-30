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

/** Google Workspace areas and the permission each needs. */
export const WORKSPACE_SCOPES = {
  drive: "https://www.googleapis.com/auth/drive",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
} as const;

export const RECONNECT_FOR_WORKSPACE =
  "Google is connected, but without access to Drive, Docs, Sheets and Contacts yet. Open Settings → Integrations, disconnect Google and connect it again, and allow the new permissions.";

/** Whether the user's Google connection granted this permission (older connections didn't). */
export async function hasGoogleScope(userId: string, scope: string): Promise<boolean> {
  const row = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: "google" } }, select: { status: true, scope: true } }).catch(() => null);
  if (row?.status !== "connected") return false;
  return (row.scope ?? "").split(/\s+/).includes(scope) || (scope === WORKSPACE_SCOPES.sheets && (row.scope ?? "").includes(WORKSPACE_SCOPES.drive));
}

/**
 * A Google API request as the user. A missing permission becomes a clear
 * "reconnect Google" message; other errors carry Google's own reason.
 */
export async function googleFetch(userId: string, url: string, init: RequestInit = {}): Promise<any> {
  const token = await getGoogleAccessToken(userId);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(20_000) });
  } catch {
    throw new ToolError("Couldn't reach Google right now. Try again shortly.");
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON (e.g. an exported file) */ }
  if (!res.ok) {
    const msg = String(json?.error?.message ?? json?.error ?? text ?? "").slice(0, 300);
    if (res.status === 403 && /insufficient|scope|permission/i.test(msg)) throw new ToolError(RECONNECT_FOR_WORKSPACE);
    if (res.status === 401) throw new ToolError("Your Google session expired. Please reconnect Google in Settings → Integrations.");
    if (res.status === 404) throw new ToolError("Google couldn't find that file (or it isn't shared with this account).");
    throw new ToolError(`Google: ${msg || `HTTP ${res.status}`}`);
  }
  return json ?? text;
}
