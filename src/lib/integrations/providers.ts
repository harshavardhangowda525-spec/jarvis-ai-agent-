import "server-only";
import { env } from "@/lib/env";

/**
 * Extensible OAuth provider registry. An integration is "available" only when
 * its client credentials are configured; JARVIS never fakes a connection and
 * only marks a provider connected after a successful token exchange.
 *
 * Add a provider here (+ its env vars) to make it connectable — no route
 * changes required.
 */
export interface OAuthProvider {
  id: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
  /** Extra params some providers require on the authorize request. */
  extraAuthParams?: Record<string, string>;
}

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    id: "google",
    label: "Google (Gmail, Calendar, Drive)",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/analytics.readonly",
    ],
    clientId: read("GOOGLE_CLIENT_ID"),
    clientSecret: read("GOOGLE_CLIENT_SECRET"),
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  github: {
    id: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["read:user", "repo"],
    clientId: read("GITHUB_CLIENT_ID"),
    clientSecret: read("GITHUB_CLIENT_SECRET"),
  },
  slack: {
    id: "slack",
    label: "Slack",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read"],
    clientId: read("SLACK_CLIENT_ID"),
    clientSecret: read("SLACK_CLIENT_SECRET"),
  },
  notion: {
    id: "notion",
    label: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientId: read("NOTION_CLIENT_ID"),
    clientSecret: read("NOTION_CLIENT_SECRET"),
    extraAuthParams: { owner: "user" },
  },
};

export interface DisplayIntegration {
  id: string;
  label: string;
  /** "oauth" = client id/secret + OAuth flow; "key" = a single API key in env. */
  kind: "oauth" | "key";
}

/** Providers exposed in the UI. OAuth ones connect via a flow; key ones are
 *  connected simply by having their API key set in the environment. */
export const DISPLAY_INTEGRATIONS: DisplayIntegration[] = [
  { id: "google", label: "Google Workspace", kind: "oauth" },
  { id: "github", label: "GitHub", kind: "oauth" },
  { id: "slack", label: "Slack", kind: "oauth" },
  { id: "notion", label: "Notion", kind: "oauth" },
  { id: "instagram", label: "Instagram", kind: "oauth" },
  { id: "whatsapp", label: "WhatsApp", kind: "oauth" },
  { id: "pluslide", label: "Pluslide (AI Slides)", kind: "key" },
];

/** True when a KEY-based integration has its credentials set in env. */
export function isKeyIntegrationConfigured(id: string): boolean {
  if (id === "pluslide") return env.pluslideApiKey.length > 0;
  return false;
}

export function getProvider(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS[id];
}

export function isProviderConfigured(id: string): boolean {
  const p = OAUTH_PROVIDERS[id];
  return !!p && p.clientId.length > 0 && p.clientSecret.length > 0;
}

export function callbackUrl(id: string): string {
  return `${env.appUrl}/api/integrations/${id}/callback`;
}
