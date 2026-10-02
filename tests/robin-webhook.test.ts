import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.hoisted(() => { process.env.ROBIN_WEBHOOK_SECRET = "whsec-test-123"; });
import { getDb, isDbConfigured } from "@/lib/db";
import { signRobinWebhook } from "@/lib/robin/webhook";

const d = isDbConfigured ? describe : describe.skip;

d("RUBIN webhook (signed)", () => {
  let email = "";
  let userId = "";
  let POST: (req: Request) => Promise<Response>;
  beforeAll(async () => {
    POST = (await import("@/app/api/robin/webhook/route")).POST;
    email = `robin-wh-${Date.now()}@example.com`;
    userId = (await getDb().user.create({ data: { email, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  const send = (body: unknown, o: { secret?: string; ts?: number } = {}) => {
    const raw = JSON.stringify(body);
    const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    return POST(new Request("http://x/api/robin/webhook", { method: "POST", body: raw, headers: { "x-robin-timestamp": ts, "x-robin-signature": signRobinWebhook(o.secret ?? "whsec-test-123", ts, raw) } }));
  };

  it("rejects unsigned, wrongly signed and stale requests", async () => {
    const lead = { event: "lead", userEmail: email, lead: { businessName: "Hook Café", phone: "+91 90000 55555" } };
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify(lead) }))).status).toBe(401);
    expect((await send(lead, { secret: "wrong" })).status).toBe(401);
    expect((await send(lead, { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    expect(await getDb().robinLead.count({ where: { userId } })).toBe(0);
  });

  it("a signed lead is created (once) and a signed reply is logged on it", async () => {
    const lead = { event: "lead", userEmail: email, lead: { businessName: "Hook Café", phone: "+91 90000 55555", city: "Pune" } };
    const r1 = await (await send(lead)).json();
    expect(r1).toMatchObject({ ok: true, data: { duplicate: false } });
    const r2 = await (await send(lead)).json();
    expect(r2.data).toMatchObject({ duplicate: true, leadId: r1.data.leadId });
    const r3 = await send({ event: "reply", userEmail: email, reply: { channel: "whatsapp", phone: "9000055555", notes: "Send me the price" } });
    expect(r3.status).toBe(200);
    const it = await getDb().robinInteraction.findFirst({ where: { leadId: r1.data.leadId } });
    expect(it).toMatchObject({ channel: "whatsapp", direction: "inbound", status: "received", outcome: "replied" });
    expect(await getDb().robinAudit.count({ where: { userId, source: "webhook" } })).toBeGreaterThan(0);
  });
});
