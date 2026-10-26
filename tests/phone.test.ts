import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { cleanNumber, inQuiet, messageText } from "@/lib/phone/service";

describe("phone calls: pure helpers", () => {
  it("accepts real-looking numbers only", () => {
    expect(cleanNumber("+91 98765-43210")).toBe("+919876543210");
    expect(cleanNumber("09876543210")).toBe("09876543210");
    expect(cleanNumber("call me")).toBeNull();
    expect(cleanNumber("+12")).toBeNull();
  });
  it("quiet hours, including across midnight; off when unset", () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 26, h, m));
    expect(inQuiet({ quietFrom: "23:00", quietTo: "07:00" }, at(23, 30), "UTC")).toBe(true);
    expect(inQuiet({ quietFrom: "23:00", quietTo: "07:00" }, at(6, 59), "UTC")).toBe(true);
    expect(inQuiet({ quietFrom: "23:00", quietTo: "07:00" }, at(7, 0), "UTC")).toBe(false);
    expect(inQuiet({ quietFrom: "13:00", quietTo: "14:00" }, at(13, 10), "UTC")).toBe(true);
    expect(inQuiet({ quietFrom: null, quietTo: null }, at(3), "UTC")).toBe(false);
    // 18:00 UTC is 23:30 in India
    expect(inQuiet({ quietFrom: "23:00", quietTo: "07:00" }, at(18, 0), "Asia/Kolkata")).toBe(true);
  });
  it("the text is plain ASCII and groups updates", () => {
    const t = messageText([{ kind: "completed", text: "Done - ASTON: Build the café site" }, { kind: "approval", text: "Needs your approval - EV: Post" }]);
    expect(t).toMatch(/^JARVIS: 2 updates\n- Done - ASTON: Build the cafe site\n- Needs your approval - EV: Post\nOpen JARVIS > Activity Center to approve\.$/);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("phone calls: the spare phone's path (integration)", () => {
  let userId = "";
  let P: typeof import("@/lib/phone/service");
  const brief = { objective: "o", expectedOutcome: "e", context: [], requirements: [], constraints: [], acceptance: ["a"], approvals: [] };
  beforeAll(async () => {
    P = await import("@/lib/phone/service");
    userId = (await getDb().user.create({ data: { email: `phone-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("an unknown token gets nothing; a paired phone checks in", async () => {
    expect((await P.deviceNext("jph_nope", null)).authorized).toBe(false);
    await P.saveSettings(userId, { enabled: true, toNumber: "+91 98765 43210" });
    const token = await P.pair(userId);
    const r = await P.deviceNext(token, "Pixel+6");
    expect(r.authorized && r.call).toBeNull();
    const s = await P.phoneStatus(userId);
    expect(s.link!.online).toBe(true);
    expect(s.link!.device).toBe("Pixel+6");
    await expect(P.saveSettings(userId, { toNumber: "nope" })).rejects.toThrow(/phone number/);
  });

  it("calls once about real events after calls were switched on, groups them, waits between calls, records the outcome", async () => {
    const db = getDb();
    const token = await P.pair(userId);
    const old = new Date(Date.now() - 3_600_000);
    await db.phoneLink.update({ where: { userId }, data: { since: new Date(Date.now() - 60_000), lastCallAt: null } });
    // before "since": never called about
    await db.agentJob.create({ data: { userId, agent: "aston", title: "Old site", request: "r", brief, status: "completed", finishedAt: old } });
    await db.agentJob.create({ data: { userId, agent: "aston", title: "Gym website", request: "r", brief, status: "completed", finishedAt: new Date() } });
    await db.agentJob.create({ data: { userId, agent: "darwin", title: "Find gyms", request: "r", brief, status: "failed", error: "Search offline", finishedAt: new Date() } });
    await db.agentJob.create({ data: { userId, agent: "ev", title: "Post the reel", request: "r", brief, status: "waiting_approval", progress: [{ at: new Date().toISOString(), text: "Waiting for your approval: publish", kind: "approval" }] } });

    const r = await P.deviceNext(token, null);
    if (!r.authorized || !r.call) throw new Error("expected a call");
    expect(r.call.to).toBe("+919876543210");
    expect(r.call.message).toContain("JARVIS: 3 updates");
    expect(r.call.message).toContain("Done - ASTON: Gym website");
    expect(r.call.message).toContain("Failed - DARWIN: Find gyms (Search offline)");
    expect(r.call.message).toMatch(/Needs your approval - EV(IE)?: Post the reel/);
    expect(r.call.message).not.toContain("Old site");

    // a new event right away waits for the gap; the same events are never queued again
    await db.agentJob.create({ data: { userId, agent: "mike", title: "Market scan", request: "r", brief, status: "completed", finishedAt: new Date() } });
    const r2 = await P.deviceNext(token, null);
    expect(r2.authorized && r2.call).toBeNull();
    expect(await db.phoneEvent.count({ where: { userId, status: "queued" } })).toBe(1);

    expect(await P.deviceAck(token, { id: r.call.id, ok: true })).toBe(true);
    expect(await db.phoneEvent.count({ where: { userId, status: "sent" } })).toBe(3);

    await db.phoneLink.update({ where: { userId }, data: { lastCallAt: new Date(Date.now() - P.CALL_GAP_MS - 1000) } });
    const r3 = await P.deviceNext(token, null);
    if (!r3.authorized || !r3.call) throw new Error("expected the second call");
    expect(r3.call.message).toBe("JARVIS:\n- Done - MIKE: Market scan");
    await P.deviceAck(token, { id: r3.call.id, ok: false, error: "WhatsApp didn't open the call screen" });
    expect((await db.phoneEvent.findFirst({ where: { userId, batchId: r3.call.id } }))!.status).toBe("failed");
  });

  it("quiet hours hold calls; a test call still goes through; switching off stops calls", async () => {
    const db = getDb();
    const token = await P.pair(userId);
    await db.phoneLink.update({ where: { userId }, data: { quietFrom: "00:00", quietTo: "23:59", lastCallAt: null } });
    await db.agentJob.create({ data: { userId, agent: "aston", title: "Late build", request: "r", brief, status: "completed", finishedAt: new Date() } });
    expect((await P.deviceNext(token, null) as { call: unknown }).call).toBeNull();
    await db.phoneEvent.deleteMany({ where: { userId, status: "queued" } });
    await P.queueTest(userId);
    const t = await P.deviceNext(token, null);
    expect(t.authorized && t.call?.message).toBe("JARVIS:\n- Test call - JARVIS can reach you.");
    await P.saveSettings(userId, { enabled: false });
    await P.queueTest(userId);
    await db.phoneLink.update({ where: { userId }, data: { lastCallAt: null } });
    expect((await P.deviceNext(token, null) as { call: unknown }).call).toBeNull();
    await P.unpair(userId);
    expect((await P.deviceNext(token, null)).authorized).toBe(false);
  });
});
