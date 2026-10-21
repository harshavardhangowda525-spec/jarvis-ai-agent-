import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getDb, isDbConfigured } from "@/lib/db";

const d = isDbConfigured ? describe : describe.skip;
const cafe = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/aston-cafe.json"), "utf8"));
const planJson = fs.readFileSync(path.join(__dirname, "fixtures/aston-plan.json"), "utf8");
const brief = { objective: "Build a premium website for Brew & Bloom Café in Indiranagar. Phone 98450 12345. Open Mon-Sun 8 am - 10 pm.", expectedOutcome: "A checked preview", context: [], requirements: [], constraints: [], acceptance: ["checks pass"], approvals: [] };

d("ASTON builds, versions and previews (integration)", () => {
  let userId = "";
  let B: typeof import("@/lib/aston/build");
  let S: typeof import("@/lib/aston/service");
  let P: typeof import("@/app/p/[token]/route");
  beforeAll(async () => {
    B = await import("@/lib/aston/build");
    S = await import("@/lib/aston/service");
    P = await import("@/app/p/[token]/route");
    userId = (await getDb().user.create({ data: { email: `aston-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  let siteId = "", token = "";
  it("builds v1 with only verified contact details, and serves it sandboxed", async () => {
    // the model "invents" a phone in its copy — the page's contact details still come only from the brief
    const ask = vi.fn(async () => JSON.stringify({ ...cafe, hero: { ...cafe.hero, sub: cafe.hero.sub } }));
    const r = await B.buildSite(userId, { title: "Cafe website", brief, payload: {}, ask });
    expect(r.version).toBe(1);
    expect(r.report.passed).toBe(true);
    expect(r.spec.facts.phone).toBe("98450 12345");
    expect(r.spec.facts.source).toBe("your brief");
    expect(r.placeholders).toEqual(["Email address", "Address"]);
    siteId = r.siteId; token = r.token;

    const res = await P.GET(new NextRequest(`http://x/p/${token}`), { params: { token } });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/^sandbox allow-scripts allow-forms/);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    const html = await res.text();
    expect(html).toContain('href="tel:9845012345"');
    expect(html).not.toContain("aston:goto");
    const walk = await P.GET(new NextRequest(`http://x/p/${token}?walk=1`), { params: { token } });
    expect(await walk.text()).toContain("aston:goto");
    expect((await P.GET(new NextRequest("http://x/p/not-a-real-token-123456"), { params: { token: "not-a-real-token-123456" } })).status).toBe(404);
    const dl = await P.GET(new NextRequest(`http://x/p/${token}?download=1`), { params: { token } });
    expect(dl.headers.get("content-disposition")).toBe('attachment; filename="brew-bloom-cafe-v1-index.html"');
    expect(await dl.text()).toMatch(/^<!doctype html>/);
  });

  it("a change request makes v2 and keeps v1", async () => {
    const job = await S.requestChanges(userId, siteId, "Use the midnight palette");
    expect(job.agent).toBe("aston");
    const ask = vi.fn(async (_s: string, user: string) => { expect(user).toContain("Use the midnight palette"); expect(user).toContain("Current site JSON"); return JSON.stringify({ ...cafe, palette: "midnight" }); });
    const r = await B.buildSite(userId, { title: job.title, brief: job.brief as never, payload: job.payload as never, jobId: job.id, ask });
    expect(r.version).toBe(2);
    expect(r.spec.palette).toBe("midnight");
    expect(r.spec.facts.phone).toBe("98450 12345"); // verified facts carried over
    const det = (await S.siteDetail(userId, siteId))!;
    expect(det.versions.map((v) => [v.n, v.status, v.feedback])).toEqual([[2, "ready", "Use the midnight palette"], [1, "ready", null]]);
    const v1 = await P.GET(new NextRequest(`http://x/p/${token}?v=1`), { params: { token } });
    expect(await v1.text()).toContain("#7a4b2a"); // espresso — the old version is untouched
  });

  it("approval is a record only; a new link revokes the old one", async () => {
    await S.approveVersion(userId, siteId, 2);
    expect((await S.siteDetail(userId, siteId))!.approvedVersion).toBe(2);
    const url = await S.rotateLink(userId, siteId);
    expect((await P.GET(new NextRequest(`http://x/p/${token}`), { params: { token } })).status).toBe(404);
    const t2 = url.split("/")[2].split("?")[0];
    expect((await P.GET(new NextRequest(`http://x${url}`), { params: { token: t2 } })).status).toBe(200);
  });

  it("uses the CRM lead's verified details", async () => {
    const lead = await getDb().robinLead.create({ data: { userId, businessName: "Iron Temple Gym", category: "Gym", phone: "+91 98450 77777", address: "100 Feet Rd, Indiranagar", fingerprint: `fp-${Date.now()}`, number: 7 } });
    const gym = { ...cafe, businessName: "Iron Temple Gym", niche: "gym", sections: cafe.sections.filter((s: { type: string }) => s.type !== "menu") };
    const r = await B.buildSite(userId, { title: "Gym app", brief: { ...brief, objective: "App demo for Iron Temple Gym" }, payload: { leadId: lead.id, kind: "app" }, ask: async () => JSON.stringify(gym) });
    expect(r.spec.kind).toBe("app");
    expect(r.spec.facts).toMatchObject({ phone: "+91 98450 77777", address: "100 Feet Rd, Indiranagar", source: "CRM lead #7 (Iron Temple Gym)" });
    expect(r.placeholders).toEqual(["Email address", "Opening hours"]);
  });

  it("a build that fails its checks is kept as a failed version and never offered", async () => {
    const bad = { ...cafe, businessName: "Broken Bakery", tagline: "lorem ipsum dolor" };
    await expect(B.buildSite(userId, { title: "bad", brief, payload: {}, ask: async () => JSON.stringify(bad) })).rejects.toThrow(/didn't pass its checks/);
    const site = await getDb().astonSite.findFirst({ where: { userId, name: "Broken Bakery" }, include: { versions: true } });
    expect(site!.currentVersion).toBe(0);
    expect(site!.versions[0].status).toBe("failed");
    expect((await P.GET(new NextRequest(`http://x/p/${site!.previewToken}`), { params: { token: site!.previewToken } })).status).toBe(404);
  });
});

d("daily marketing plan (integration)", () => {
  let userId = "";
  let E: typeof import("@/lib/plans/engine");
  let N: typeof import("@/lib/plans/notify");
  beforeAll(async () => {
    E = await import("@/lib/plans/engine");
    N = await import("@/lib/plans/notify");
    userId = (await getDb().user.create({ data: { email: `plan-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("one plan per day even when asked twice at once; failures retry, then stop", async () => {
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 150)); return planJson; };
    const [a, b] = await Promise.all([E.ensurePlan(userId, { date: "2026-10-16", ask: slow }), E.ensurePlan(userId, { date: "2026-10-16", ask: slow })]);
    expect(calls).toBe(1);
    expect([a.status, b.status].sort()).toEqual(["generating", "ready"]);
    expect((await getDb().marketingPlan.count({ where: { userId, date: "2026-10-16" } }))).toBe(1);

    const now = new Date("2026-10-17T01:00:00Z");
    const fail = async () => { throw new Error("Groq: rate limited"); };
    const f1 = await E.ensurePlan(userId, { date: "2026-10-17", now, ask: fail });
    expect(f1).toMatchObject({ status: "failed", attempts: 1, error: "Groq: rate limited" });
    await E.ensurePlan(userId, { date: "2026-10-17", now, ask: fail });
    const f3 = await E.ensurePlan(userId, { date: "2026-10-17", now, ask: fail });
    expect(f3.attempts).toBe(3);
    const stop = await E.ensurePlan(userId, { date: "2026-10-17", now, ask: async () => planJson });
    expect(stop.status).toBe("failed"); // 3 attempts used — no silent 4th
    const forced = await E.ensurePlan(userId, { date: "2026-10-17", now, ask: async () => planJson, force: true });
    expect(forced.status).toBe("ready");
  });

  it("the schedule makes the plan before notifying, and notifies once", async () => {
    await getDb().marketingPlanSettings.create({ data: { userId, deliveryTime: "07:00", notifyWhatsapp: true, notifyEmail: true } });
    const order: string[] = [];
    const now = new Date("2026-10-18T01:00:00Z"); // 06:30 IST
    const notify = async (p: { id: string; status: string }) => { order.push(`notify:${p.status}`); return N.notifyPlan(p as never); };
    const r1 = await E.runDuePlans({ userIds: [userId], now, ask: async () => { order.push("generate"); return planJson; }, notify });
    const mine = r1.find((x) => x.userId === userId)!;
    expect(mine.status).toBe("ready");
    expect(order).toEqual(["generate", "notify:ready"]);
    const row = await getDb().marketingPlan.findUnique({ where: { userId_date: { userId, date: "2026-10-18" } } });
    const log = row!.notifyLog as { channel: string; status: string }[];
    // nothing is configured in tests: reported as such, never as sent
    expect(log.map((l) => [l.channel, l.status])).toEqual([["whatsapp", "not_configured"], ["email", "not_configured"]]);
    expect(await N.notifyPlan(row!)).toEqual([]); // a second call never sends again
    await E.runDuePlans({ userIds: [userId], now, ask: async () => { order.push("generate"); return planJson; }, notify });
    expect(order).toEqual(["generate", "notify:ready"]);
    // not due yet at 05:30 IST for a 07:00 plan on another day
    const early = await E.runDuePlans({ userIds: [userId], now: new Date("2026-10-19T00:00:00Z"), ask: async () => planJson, notify });
    expect(early.find((x) => x.userId === userId)!.status).toBe("not_due");
  });

  it("sends WhatsApp through the Cloud API and reports 'accepted', not 'delivered'", async () => {
    const { env } = await import("@/lib/env");
    Object.assign(env, { whatsappPhoneNumberId: "123", whatsappAccessToken: "test-token", whatsappNotifyTo: "+91 98450 12345", whatsappPlanTemplate: "daily_plan_ready" });
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), { status: 200, headers: { "content-type": "application/json" }, ...(init ? {} : {}) }));
    const plan = (await getDb().marketingPlan.findUnique({ where: { userId_date: { userId, date: "2026-10-16" } } }))!;
    const log = await N.notifyPlan(plan, { fetch: fetchMock as unknown as typeof fetch });
    expect(log[0]).toMatchObject({ channel: "whatsapp", status: "sent" });
    expect(log[0].detail).toMatch(/Accepted by WhatsApp \(message wamid.TEST\) — delivery not confirmed/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/123/messages");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ to: "919845012345", type: "template", template: { name: "daily_plan_ready" } });
    expect(body.template.components[0].parameters[0].text).toBe(plan.niche);
    expect((plan.plan as { niche: string }).niche).toBe(plan.niche);
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Template not approved", code: 132001 } }), { status: 400 }));
    await getDb().marketingPlan.update({ where: { id: plan.id }, data: { notifiedAt: null } });
    const log2 = await N.notifyPlan(plan, { fetch: failing as unknown as typeof fetch });
    expect(log2[0]).toMatchObject({ channel: "whatsapp", status: "failed", detail: "Template not approved (code 132001)" });
    Object.assign(env, { whatsappPhoneNumberId: "", whatsappAccessToken: "", whatsappNotifyTo: "", whatsappPlanTemplate: "" });
  });
});
