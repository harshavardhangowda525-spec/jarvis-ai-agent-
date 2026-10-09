import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
const H = vi.hoisted(() => {
  process.env.ASTON_OWNER_EMAIL = "aston-owner-test@example.com";
  process.env.ASTON_GITHUB_WEBHOOK_SECRET = "gh-test-secret";
  process.env.ASTON_WEBHOOK_SECRET = "ev-test-secret";
  process.env.GROQ_API_KEY = "gsk_db_test_key_000000000000000000000";
  process.env.ASTON_NOTIFICATION_CHANNEL = "browser,email";
  process.env.CRON_SECRET = "cron-test-secret";
  class UnauthorizedError extends Error {}
  return { user: null as null | { id: string; email: string }, UnauthorizedError };
});
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: H.UnauthorizedError,
  getCurrentUser: async () => H.user,
  requireUser: async () => { if (!H.user) throw new H.UnauthorizedError("Unauthorized"); return H.user; },
}));

import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";
import { signGithub } from "@/lib/aston/signature";
import { EmailNotConnected } from "@/lib/darwin/email";
import { TestCallProvider } from "@/lib/aston/phone";
import type { IncidentSignal } from "@/lib/aston/types";

const d = isDbConfigured ? describe : describe.skip;
const OWNER = "aston-owner-test@example.com";
const db = () => getDb();
const json = (b: unknown) => JSON.stringify(b);

d("ASTON (database integration)", () => {
  let userId = "", otherId = "";
  let I: typeof import("@/lib/aston/incidents");
  let N: typeof import("@/lib/aston/notify");
  const noEmail = async () => { throw new EmailNotConnected("COMMUNICATION SERVICE NOT CONNECTED"); };
  const blockGroq = () => db().astonProviderState.upsert({ where: { provider: "groq" }, create: { provider: "groq", status: "outage", blockedUntil: new Date(Date.now() + 3_600_000) }, update: { status: "outage", blockedUntil: new Date(Date.now() + 3_600_000), lastError: null } });
  const sig = (over: Partial<IncidentSignal> = {}): IncidentSignal => ({ source: "webhook", kind: "task_blocked", key: `k-${Math.random()}`, title: "Blocked on client content", project: "Client site", ...over });

  beforeAll(async () => {
    await db().user.deleteMany({ where: { email: { in: [OWNER, "aston-other@example.com"] } } });
    userId = (await db().user.create({ data: { email: OWNER, passwordHash: "x" } })).id;
    otherId = (await db().user.create({ data: { email: "aston-other@example.com", passwordHash: "x" } })).id;
    I = await import("@/lib/aston/incidents");
    N = await import("@/lib/aston/notify");
  });
  afterAll(async () => {
    await db().user.deleteMany({ where: { id: { in: [userId, otherId] } } }).catch(() => {});
    await db().astonProviderState.deleteMany({ where: { provider: "groq" } }).catch(() => {});
  });
  beforeEach(async () => {
    await db().astonIncident.deleteMany({ where: { userId } });
    await db().integration.deleteMany({ where: { userId, provider: "aston" } });
    await blockGroq();
    H.user = { id: userId, email: OWNER };
  });

  it("failed deployment (signed GitHub webhook): verified, alerted once, duplicates counted, success resolves", async () => {
    const { POST } = await import("@/app/api/aston/github/route");
    const payload = { repository: { full_name: "infinity/client-site", default_branch: "main" }, deployment: { environment: "Production", sha: "abc1234" }, deployment_status: { state: "failure", description: "Build step failed", log_url: "https://vercel.example/log" } };
    const send = (p: unknown, secret = "gh-test-secret") => POST(new Request("http://x/api/aston/github", { method: "POST", body: json(p), headers: { "x-github-event": "deployment_status", "x-hub-signature-256": signGithub(secret, json(p)) } }));

    expect((await send(payload, "wrong")).status).toBe(401);
    expect(await db().astonIncident.count({ where: { userId } })).toBe(0);

    const r1 = await (await send(payload)).json();
    expect(r1.data).toMatchObject({ created: true });
    const inc = await db().astonIncident.findUniqueOrThrow({ where: { id: r1.data.incidentId } });
    expect(inc).toMatchObject({ kind: "deploy_failed", priority: "high", status: "open", verified: true });
    // Groq is down → the template alert text is used, and ASTON says why.
    expect(inc.summary).toContain("Deployment failed");
    expect(inc.aiNote).toMatch(/Groq/);
    const alerts = await db().astonAlert.findMany({ where: { incidentId: inc.id } });
    expect(alerts.map((a) => a.channel).sort()).toEqual(["browser", "email"]);
    // No Gmail connected → email skipped (no fake send); browser alert waits for a tab.
    expect(alerts.find((a) => a.channel === "email")).toMatchObject({ status: "skipped" });
    expect(alerts.find((a) => a.channel === "browser")).toMatchObject({ status: "pending" });

    const r2 = await (await send(payload)).json();
    expect(r2.data).toMatchObject({ duplicate: true, occurrences: 2, incidentId: inc.id, queued: 0 });
    expect(await db().astonIncident.count({ where: { userId } })).toBe(1);
    expect(await db().astonAlert.count({ where: { incidentId: inc.id } })).toBe(2);

    const ok = { ...payload, deployment_status: { state: "success" } };
    expect((await (await send(ok)).json()).data).toMatchObject({ resolved: true });
    expect(await db().astonIncident.findUniqueOrThrow({ where: { id: inc.id } })).toMatchObject({ status: "resolved", openKey: null });
    expect(await db().astonAlert.findFirst({ where: { incidentId: inc.id, channel: "browser" } })).toMatchObject({ status: "skipped" });
    // The same problem later is a NEW incident (the old one is closed).
    expect((await (await send(payload)).json()).data).toMatchObject({ created: true });
  });

  it("duplicate detection holds under concurrency", async () => {
    const s = sig({ key: "same-problem" });
    const rs = await Promise.all(Array.from({ length: 6 }, () => I.raiseIncident(userId, s)));
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(await db().astonIncident.count({ where: { userId } })).toBe(1);
    expect((await db().astonIncident.findFirstOrThrow({ where: { userId } })).occurrences).toBe(6);
    // A repeated report of the same recovery step is stored once; a new step is added.
    const step = { at: new Date().toISOString(), action: "Automatic rebuild", ok: false, note: "same error" };
    const r = sig({ key: "with-recovery", recovery: [step] });
    await I.raiseIncident(userId, r);
    await I.raiseIncident(userId, r);
    const two = await I.raiseIncident(userId, { ...r, recovery: [step, { ...step, action: "Cache purge" }] });
    expect((two.incident.recovery as unknown[]).length).toBe(2);
  });

  it("a production incident that already recovered is verified and NOT alerted", async () => {
    const up = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const a = await I.raiseIncident(userId, sig({ kind: "prod_incident", key: "site-a", title: "Site A down", evidence: { url: "https://site-a.example" } }));
    await N.dispatch(userId, { fetchImpl: up, sleep: async () => {}, sendEmail: noEmail });
    expect(await db().astonIncident.findUniqueOrThrow({ where: { id: a.incident.id } })).toMatchObject({ status: "resolved" });
    expect(await db().astonAlert.count({ where: { incidentId: a.incident.id } })).toBe(0);

    const b = await I.raiseIncident(userId, sig({ kind: "prod_incident", key: "site-b", title: "Site B down", evidence: { url: "https://site-b.example" } }));
    await N.dispatch(userId, { fetchImpl: down, sleep: async () => {}, sendEmail: noEmail });
    const row = await db().astonIncident.findUniqueOrThrow({ where: { id: b.incident.id } });
    expect(row).toMatchObject({ status: "open", priority: "critical", verified: true });
    expect((row.recovery as unknown[]).length).toBe(2);
    expect(await db().astonAlert.count({ where: { incidentId: b.incident.id } })).toBe(2);
  });

  it("uses Groq's summary when Groq is available", async () => {
    await db().astonProviderState.deleteMany({ where: { provider: "groq" } });
    const create = vi.fn(async () => ({ data: { choices: [{ message: { content: json({ summary: "Client site deploy is blocked on content.", next_action: "Email the client for the logo." }) } }] } as never, headers: {} }));
    const inc = await I.raiseIncident(userId, sig({ key: "ai-sum" }));
    await N.dispatch(userId, { sendEmail: noEmail, groq: { create, store: (await import("@/lib/aston/groq")).memoryStore() } });
    expect(await db().astonIncident.findUniqueOrThrow({ where: { id: inc.incident.id } })).toMatchObject({ summary: "Client site deploy is blocked on content.", aiNote: null });
  });

  it("phone: off by default; test mode never dials; cooldown and live-mode guard", async () => {
    const before = { en: env.astonPhoneAlertsEnabled, mode: env.astonPhoneMode, phone: env.astonOwnerPhone };
    try {
      const a = await I.raiseIncident(userId, sig({ kind: "security", key: "p1", title: "Suspicious sign-ins" }));
      await N.dispatch(userId, { sendEmail: noEmail });
      expect(await db().astonAlert.count({ where: { incidentId: a.incident.id, channel: "phone" } })).toBe(0);

      env.astonPhoneAlertsEnabled = true; env.astonOwnerPhone = "+919000000000";
      const test = new TestCallProvider();
      const b = await I.raiseIncident(userId, sig({ kind: "security", key: "p2", title: "Breach attempt" }));
      await N.dispatch(userId, { sendEmail: noEmail, phone: () => test });
      expect(test.placed).toHaveLength(1);
      expect(await db().astonAlert.findFirstOrThrow({ where: { incidentId: b.incident.id, channel: "phone" } })).toMatchObject({ status: "delivered", testMode: true, costUsd: 0 });

      const c = await I.raiseIncident(userId, sig({ kind: "security", key: "p3", title: "Another one" }));
      await N.dispatch(userId, { sendEmail: noEmail, phone: () => test });
      expect(test.placed).toHaveLength(1); // cooldown
      expect((await db().astonAlert.findFirstOrThrow({ where: { incidentId: c.incident.id, channel: "phone" } })).lastError).toMatch(/Cooling down/);

      env.astonPhoneMode = "live";
      const { phoneGuard, callProvider } = await import("@/lib/aston/phone");
      await db().astonAlert.updateMany({ where: { userId, channel: "phone" }, data: { deliveredAt: new Date(Date.now() - 2 * 3_600_000) } });
      expect((await phoneGuard(userId)).reason).toMatch(/Live calls need TWILIO_ACCOUNT_SID/);
      expect(callProvider()).toBeNull();
    } finally {
      env.astonPhoneAlertsEnabled = before.en; env.astonPhoneMode = before.mode; env.astonOwnerPhone = before.phone;
    }
  });

  it("authorization: signed-out 401, non-owner 403, owner 200; approvals need explicit confirmation", async () => {
    const state = (await import("@/app/api/aston/state/route")).GET;
    H.user = null;
    expect((await state(new Request("http://x/api/aston/state"))).status).toBe(401);
    H.user = { id: otherId, email: "aston-other@example.com" };
    expect((await state(new Request("http://x/api/aston/state"))).status).toBe(403);
    H.user = { id: userId, email: OWNER };
    expect((await state(new Request("http://x/api/aston/state"))).status).toBe(200);

    const before = env.astonRedeployHookUrl;
    env.astonRedeployHookUrl = "https://hooks.example/deploy/abc";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    try {
      const inc = await I.raiseIncident(userId, sig({ kind: "deploy_failed", key: "dep-1", title: "Deploy failed" }));
      const { proposeActions } = await import("@/lib/aston/decisions");
      await proposeActions(userId);
      const decide = (await import("@/app/api/aston/incidents/[id]/route")).POST;
      const call = (b: unknown) => decide(new Request("http://x", { method: "POST", body: json(b) }), { params: { id: inc.incident.id } });
      H.user = { id: otherId, email: "aston-other@example.com" };
      expect((await call({ action: "approve", confirm: true })).status).toBe(403);
      H.user = { id: userId, email: OWNER };
      expect((await call({ action: "approve" })).status).toBe(428);
      expect(spy).not.toHaveBeenCalled();
      const r = await (await call({ action: "approve", confirm: true })).json();
      expect(r.data.result).toMatch(/Redeploy started/);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await call({ action: "approve", confirm: true })).status).toBe(409); // nothing pending any more
      expect(await db().astonDecision.count({ where: { incidentId: inc.incident.id } })).toBe(1);
    } finally {
      spy.mockRestore();
      env.astonRedeployHookUrl = before;
    }
  });

  it("detectors: repeated agent failures open and close; sticky security waits; a broken detector resolves nothing", async () => {
    const { runDetectors } = await import("@/lib/aston/tick");
    const D = await import("@/lib/aston/detectors");
    const now = new Date();
    for (let i = 0; i < 3; i++) await db().activityEvent.create({ data: { userId, date: "2026-10-09", category: "agent", agent: "DARWIN", action: `Geoapify request failed #${i}`, status: "failed", source: "darwin" } });
    let r = await runDetectors(userId, { now }, [D.agentFailureDetector]);
    expect(r.raised).toBe(1);
    expect(await db().astonIncident.findFirstOrThrow({ where: { userId, source: "agents" } })).toMatchObject({ title: "DARWIN failed 3 times in the last hour", status: "open" });

    const broken = { source: "agents", run: async () => { throw new Error("db timeout"); } };
    r = await runDetectors(userId, { now }, [broken]);
    expect(r.errors[0]).toMatch(/agents: db timeout/);
    expect((await db().astonIncident.findFirstOrThrow({ where: { userId, source: "agents" } })).status).toBe("open");

    await db().activityEvent.deleteMany({ where: { userId, agent: "DARWIN" } });
    r = await runDetectors(userId, { now }, [D.agentFailureDetector]);
    expect(r.closed).toBe(1);
    expect((await db().astonIncident.findFirstOrThrow({ where: { userId, source: "agents" } })).resolution).toMatch(/Recovered/);

    await db().gateSecurity.create({ data: { userId, lockouts: 1, failedCount: 5, lockedUntil: new Date(Date.now() + 600_000) } });
    await runDetectors(userId, { now }, [D.gateDetector]);
    await db().gateSecurity.update({ where: { userId }, data: { lockedUntil: null } });
    await runDetectors(userId, { now }, [D.gateDetector]);
    expect((await db().astonIncident.findFirstOrThrow({ where: { userId, source: "gate" } })).status).toBe("open");
  });

  it("tick is throttled (state in the DB) and the cron needs its secret", async () => {
    const { tick } = await import("@/lib/aston/tick");
    const opts = { detectors: [], deps: { sendEmail: noEmail } };
    expect((await tick(userId, opts)).ran).toBe(true);
    expect((await tick(userId, opts)).ran).toBe(false);
    expect((await tick(userId, { ...opts, force: true })).ran).toBe(true);
    const cron = (await import("@/app/api/cron/aston/route")).GET;
    expect((await cron(new Request("http://x/api/cron/aston"))).status).toBe(401);
  });
  // These two reload modules ("restart") — keep them last.
  it("email: bounded retries with backoff, persisted across a restart, delivered later", async () => {
    let t = Date.now();
    const now = () => new Date(t);
    const failing = vi.fn(async () => { throw new Error("SMTP 451 temporary failure"); });
    const inc = await I.raiseIncident(userId, sig({ key: "retry-me" }));
    await N.dispatch(userId, { sendEmail: failing, now });
    let mail = await db().astonAlert.findFirstOrThrow({ where: { incidentId: inc.incident.id, channel: "email" } });
    expect(mail).toMatchObject({ status: "failed", attempts: 1 });
    expect(mail.nextAttemptAt!.getTime()).toBeGreaterThan(t);
    await N.dispatch(userId, { sendEmail: failing, now }); // not due yet → no new attempt
    expect(failing).toHaveBeenCalledTimes(1);

    // "Restart": fresh modules; the queued alert is still in the database.
    vi.resetModules();
    const fresh = await import("@/lib/aston/notify");
    t += N.backoffMs(1) + 1000;
    const sent = vi.fn(async () => "gmail-msg-1");
    await fresh.dispatch(userId, { sendEmail: sent, now });
    expect(sent).toHaveBeenCalledTimes(1);
    const [, , subject, body] = sent.mock.calls[0] as unknown as [string, string, string, string];
    expect(subject).toContain("[ASTON HIGH]");
    expect(body).toMatch(/Project: Client site[\s\S]*Problem:[\s\S]*Recovery attempts[\s\S]*Recommended next action/);
    mail = await db().astonAlert.findFirstOrThrow({ where: { incidentId: inc.incident.id, channel: "email" } });
    expect(mail).toMatchObject({ status: "delivered", attempts: 2, providerRef: "gmail-msg-1" });

    // Gives up after MAX_ATTEMPTS and keeps the incident for in-app display.
    const inc2 = await I.raiseIncident(userId, sig({ key: "never-works" }));
    for (let i = 0; i < 8; i++) { await N.dispatch(userId, { sendEmail: failing, now }); t += 61 * 60_000; }
    const dead = await db().astonAlert.findFirstOrThrow({ where: { incidentId: inc2.incident.id, channel: "email" } });
    expect(dead).toMatchObject({ status: "gave_up", attempts: N.MAX_ATTEMPTS.email });
    expect((await db().astonIncident.findUniqueOrThrow({ where: { id: inc2.incident.id } })).status).toBe("open");
  });

  it("Groq quota exhaustion is remembered across a restart (no request is sent)", async () => {
    await db().astonProviderState.deleteMany({ where: { provider: "groq" } });
    const G = await import("@/lib/aston/groq");
    const create = vi.fn(async () => { throw Object.assign(new Error("Rate limit reached on requests per day (RPD). Please try again in 3h"), { status: 429, headers: {} }); });
    await expect(G.groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: { create, store: G.dbStore() } })).rejects.toMatchObject({ reason: "quota_exhausted" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await db().astonProviderState.findUnique({ where: { provider: "groq" } })).toMatchObject({ status: "quota_exhausted" });

    vi.resetModules();
    const G2 = await import("@/lib/aston/groq");
    const create2 = vi.fn();
    await expect(G2.groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: { create: create2, store: G2.dbStore() } })).rejects.toMatchObject({ reason: "quota_exhausted" });
    expect(create2).not.toHaveBeenCalled();
    const status = await G2.aiStatus();
    expect(status).toMatchObject({ status: "quota_exhausted", configured: true });
    expect(JSON.stringify(status)).not.toContain("gsk_");
  });

});
