import { describe, it, expect, vi } from "vitest";

// the module reads env at import, so each case imports a fresh copy
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "GOOGLE_CLIENTID", "VERCEL", "VERCEL_ENV"]) delete process.env[k];
  Object.assign(process.env, env);
  return import("@/lib/integrations/providers");
}

describe("why Google shows 'Not configured'", () => {
  it("names the missing variable and the server that was checked — never a value", async () => {
    const p = await load({ GOOGLE_CLIENT_ID: "id-123.apps.googleusercontent.com" });
    expect(p.isProviderConfigured("google")).toBe(false);
    const m = p.missingCredentials("google");
    expect(m).toMatchObject({ missing: ["GOOGLE_CLIENT_SECRET"], sensitive: [], server: "this PC" });
    expect(JSON.stringify(m)).not.toContain("id-123");
  });
  it("spots Vercel's hidden Sensitive placeholder and look-alike names", async () => {
    const p = await load({ GOOGLE_CLIENT_ID: "[sensitive]", GOOGLE_CLIENTID: "x", GOOGLE_CLIENT_SECRET: "s", VERCEL: "1", VERCEL_ENV: "preview" });
    const m = p.missingCredentials("google");
    expect(m).toMatchObject({ missing: ["GOOGLE_CLIENT_ID"], sensitive: ["GOOGLE_CLIENT_ID"], lookalikes: ["GOOGLE_CLIENTID"], server: "Vercel (preview deployment)" });
  });
  it("accepts the Auth.js spelling too", async () => {
    const p = await load({ AUTH_GOOGLE_ID: "a", AUTH_GOOGLE_SECRET: "b" });
    expect(p.isProviderConfigured("google")).toBe(true);
  });
});
