import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDb, isDbConfigured } from "@/lib/db";
import { spokenUpdate, ownerOpener, saidYes, saidNo } from "@/lib/calls/owner";

describe("JARVIS calling you (pure)", () => {
  it("turns updates into something to say", () => {
    expect(spokenUpdate({ kind: "completed", text: "Done - ASTON: Build the Bliss bakehouse demo" })).toBe("ASTON finished: Build the Bliss bakehouse demo.");
    expect(spokenUpdate({ kind: "failed", text: "Failed - EV: Post the reel (Instagram offline)" })).toBe("EV couldn't finish: Post the reel (Instagram offline).");
    expect(spokenUpdate({ kind: "approval", text: "Needs your approval - EV: Publish today's post" })).toBe("EV needs your approval: Publish today's post.");
    expect(ownerOpener([{ kind: "approval", text: "Needs your approval - EV: Publish today's post" }])).toBe("Hi, it's JARVIS with an update. EV needs your approval: Publish today's post. Do you want me to approve it, or hold off?");
    expect(ownerOpener([{ kind: "test", text: "Test call - JARVIS can reach you." }])).toBe("Hi, it's JARVIS with an update. This is a test call — I can reach you through the laptop.");
  });
  it("only a clear yes approves; a clear no rejects", () => {
    expect(saidYes("yes, approve it")).toBe(true);
    expect(saidYes("haan, kar do")).toBe(true);
    expect(saidYes("ಹೌದು ಮಾಡಿ")).toBe(true);
    expect(saidYes("hmm, what's in it?")).toBe(false);
    expect(saidYes("no, don't approve it")).toBe(false);
    expect(saidNo("no, reject it")).toBe(true);
    expect(saidNo("नहीं, अभी मत करो")).toBe(true);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("JARVIS calling you through the laptop (integration)", () => {
  let userId = "";
  const brief = { objective: "o", expectedOutcome: "e", context: [], requirements: [], constraints: [], acceptance: ["a"], approvals: [] };
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `owner-call-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("rings you first (even with lead calling off), talks, and rejects waiting work only on a clear no", async () => {
    const P = await import("@/lib/phone/service");
    const C = await import("@/lib/calls/service");
    const O = await import("@/lib/calls/owner");
    const db = getDb();
    await P.saveSettings(userId, { enabled: true, mode: "laptop", toNumber: "+91 99808 01231" });
    await P.queueTest(userId); // no spare phone needed in laptop mode
    await db.callSettings.create({ data: { userId, enabled: false } }); // calling LEADS is off

    const n = await C.callerNext(userId);
    if (!n.call) throw new Error(n.wait);
    expect(n.call.id.startsWith("own_")).toBe(true);
    expect(n.call.to).toBe("+919980801231");
    expect(n.call.opener).toMatch(/test call/);
    expect((await C.callerNext(userId)).wait).toMatch(/already in progress/);
    // the Android spare phone never gets laptop-mode calls
    expect(await db.phoneEvent.count({ where: { userId, status: "sending" } })).toBe(1);
    await O.ownerTurn(userId, n.call.id, "Hello?", { opener: true });
    await O.ownerEvent(userId, n.call.id, "answered");
    await O.ownerTurn(userId, n.call.id, "Okay thanks, bye", { ask: async () => JSON.stringify({ say: "Bye!", end: true }) });
    expect(await O.ownerFinish(userId, n.call.id, { reason: "ended" })).toEqual({ status: "completed" });
    expect((await db.phoneEvent.findFirstOrThrow({ where: { userId } })).status).toBe("sent");

    // a job waiting for your OK → a call; "what's that?" does nothing; "no, reject it" cancels it
    const job = await db.agentJob.create({ data: { userId, agent: "ev", title: "Publish today's post", request: "r", brief, status: "waiting_approval", progress: [{ at: new Date().toISOString(), text: "Waiting for your approval: publish", kind: "approval" }] } });
    await db.phoneLink.update({ where: { userId }, data: { lastCallAt: null } });
    const n2 = await C.callerNext(userId);
    if (!n2.call) throw new Error(n2.wait);
    expect(n2.call.opener).toMatch(/EV needs your approval: Publish today's post\. Do you want me to approve it/);
    await O.ownerTurn(userId, n2.call.id, "Hello", { opener: true });
    await O.ownerEvent(userId, n2.call.id, "answered");
    let seen = "";
    const q = await O.ownerTurn(userId, n2.call.id, "what's in the post?", { ask: async (sys) => { seen = sys; return JSON.stringify({ say: "It's today's reel for the gym demo.", action: { type: "reject", item: 1 } }); } });
    expect(seen).toMatch(/1: EV — Publish today's post/);
    expect(q.say).toMatch(/^Just to be sure — shall I reject EV's "Publish today's post"\?/); // no clear no → asks first
    expect((await db.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("waiting_approval");
    const r = await O.ownerTurn(userId, n2.call.id, "no, reject it", { ask: async () => JSON.stringify({ say: "Okay.", action: { type: "reject", item: 1 } }) });
    expect(r.say).toMatch(/Done — rejected\./);
    expect((await db.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
    const call = await db.ownerCall.findUniqueOrThrow({ where: { id: n2.call.id } });
    expect(call.actions).toEqual([expect.objectContaining({ type: "reject", title: "Publish today's post", ok: true })]);

    // you didn't pick up → the update waits for one more try
    await O.ownerFinish(userId, n2.call.id, { reason: "ended" });
    await P.queueTest(userId);
    await db.phoneLink.update({ where: { userId }, data: { lastCallAt: null } });
    const n3 = await C.callerNext(userId);
    await O.ownerFinish(userId, n3.call!.id, { reason: "no_answer" });
    expect(await db.phoneEvent.findFirstOrThrow({ where: { userId, kind: "test", status: { not: "sent" } } })).toMatchObject({ status: "queued", error: "You didn't pick up." });
  });
});
