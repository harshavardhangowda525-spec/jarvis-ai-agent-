import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveIgCreds, igNotConnectedMessage } from "@/lib/ev/instagram";

const d = isDbConfigured ? describe : describe.skip;

/**
 * Vercel has INSTAGRAM_ACCESS_TOKEN; `npm run local` on the PC doesn't (Vercel
 * won't hand out "Sensitive" values). The connection is saved to the shared
 * database once the token proves it works, so the PC finds it there.
 */
d("EV's Instagram connection works on Vercel and on the PC", () => {
  const e = env as unknown as Record<string, string>;
  const saved = { t: e.instagramAccessToken, b: e.instagramBusinessId };
  const realFetch = globalThis.fetch;
  let userId = "";
  let calls: string[] = [];
  let profileOk = true;
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `ig-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  beforeEach(async () => {
    calls = []; profileOk = true;
    await getDb().integration.deleteMany({ where: { userId, provider: "instagram" } });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      calls.push(`${u.host}${u.pathname}`);
      if (u.pathname.endsWith("/me/accounts")) return Response.json({ data: [{ id: "page1" }, { id: "page2", instagram_business_account: { id: "17841400000000001" } }] });
      if (!profileOk) return Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 400 });
      return Response.json({ username: "infinitywebapps", followers_count: 120 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; e.instagramAccessToken = saved.t; e.instagramBusinessId = saved.b; });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("on Vercel: the server's token works and is saved as the connection (only after Instagram confirms it)", async () => {
    e.instagramAccessToken = "IGQtoken-vercel-1"; e.instagramBusinessId = "";
    const c = await resolveIgCreds(userId);
    expect(c).toMatchObject({ source: "env", businessId: "me" });
    await settle();
    const row = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: "instagram" } } });
    expect(row).toMatchObject({ status: "connected", accessToken: "IGQtoken-vercel-1", metadata: { businessId: "me" } });
  });

  it("on the PC (no token in its settings): the saved connection is used", async () => {
    await getDb().integration.create({ data: { userId, provider: "instagram", status: "connected", accessToken: "IGQtoken-vercel-1", metadata: { businessId: "me" } } });
    e.instagramAccessToken = ""; e.instagramBusinessId = "";
    expect(await resolveIgCreds(userId)).toMatchObject({ source: "integration", accessToken: "IGQtoken-vercel-1" });
  });

  it("a Facebook-style token without INSTAGRAM_BUSINESS_ID finds its business account itself", async () => {
    e.instagramAccessToken = "EAAtoken-fb-1"; e.instagramBusinessId = "";
    expect(await resolveIgCreds(userId)).toMatchObject({ source: "env", businessId: "17841400000000001" });
    expect(calls.some((c) => c.endsWith("/me/accounts"))).toBe(true);
  });

  it("a token Instagram rejects is never saved", async () => {
    e.instagramAccessToken = "IGQtoken-bad-2"; profileOk = false;
    await resolveIgCreds(userId);
    await settle();
    expect(await getDb().integration.count({ where: { userId, provider: "instagram" } })).toBe(0);
  });

  it("says exactly why when there's nothing", async () => {
    e.instagramAccessToken = ""; e.instagramBusinessId = "";
    expect(await resolveIgCreds(userId)).toBeNull();
    expect(igNotConnectedMessage()).toMatch(/no INSTAGRAM_ACCESS_TOKEN.*Vercel.*Open EV once in your Vercel JARVIS/);
    globalThis.fetch = (async () => Response.json({ data: [] })) as typeof fetch;
    e.instagramAccessToken = "EAAtoken-no-ig-3";
    expect(await resolveIgCreds(userId)).toBeNull();
    expect(igNotConnectedMessage()).toMatch(/couldn't find the Instagram business account/);
  });
});
