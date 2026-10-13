import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.ASTON_OWNER_EMAIL = "aston-phone-owner@example.com";
  process.env.ASTON_PHONE_ALERTS_ENABLED = "true";
  process.env.ASTON_PHONE_MODE = "live";
  process.env.ASTON_OWNER_PHONE_NUMBER = "+919876543210";
  process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
  process.env.TWILIO_API_KEY = "SK00000000000000000000000000000000";
  process.env.TWILIO_API_SECRET = "test-secret-not-real";
  process.env.TWILIO_PHONE_NUMBER = "+15005550006";
  process.env.ASTON_PHONE_COOLDOWN_MINUTES = "60";
});
import { getDb, isDbConfigured } from "@/lib/db";
import { maskNumber, placeTestCall, TwilioCallProvider } from "@/lib/aston/phone";

describe("ASTON sample call · pure parts", () => {
  it("never echoes the whole number", () => {
    expect(maskNumber("+919876543210")).toBe("+91 ••••• •3210");
  });
  it("says hello as a sample, not as an urgent alert", async () => {
    let body = "";
    const p = new TwilioCallProvider({ accountSid: "AC1", apiKey: "SK1", apiSecret: "s", from: "+1500" }, (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ sid: "CA1" }), { status: 201 }); }) as never);
    await p.place("+91", "Sample text", { intro: "Hello, this is ASTON." });
    expect(decodeURIComponent(body.replace(/\+/g, " "))).toContain("<Say>Hello, this is ASTON.</Say>");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("ASTON sample call (database integration)", () => {
  let userId = "";
  beforeAll(async () => {
    await getDb().user.deleteMany({ where: { email: "aston-phone-owner@example.com" } });
    userId = (await getDb().user.create({ data: { email: "aston-phone-owner@example.com", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  beforeEach(async () => { await getDb().astonIncident.deleteMany({ where: { userId } }); });

  const fake = (fail?: string) => {
    const calls: { to: string; message: string; intro?: string }[] = [];
    return { calls, provider: { name: "twilio", live: true, async place(to: string, message: string, o?: { intro?: string }) { if (fail) throw new Error(fail); calls.push({ to, message, intro: o?.intro }); return { ref: "CA123" }; } } };
  };

  it("places one real call to the owner, records it, and counts it toward the caps", async () => {
    const f = fake();
    const r = await placeTestCall(userId, f.provider);
    expect(r).toEqual({ to: "+91 ••••• •3210", ref: "CA123" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ to: "+919876543210", intro: "Hello, this is ASTON." });
    const alerts = await getDb().astonAlert.findMany({ where: { userId, channel: "phone" } });
    expect(alerts).toMatchObject([{ status: "delivered", testMode: false, providerRef: "CA123" }]);
    // it doesn't show up as an open alert
    expect(await getDb().astonIncident.count({ where: { userId, status: { in: ["open", "acknowledged"] } } })).toBe(0);
    // cooldown: a second sample call right away is refused, nothing dialled
    await expect(placeTestCall(userId, f.provider)).rejects.toMatchObject({ message: expect.stringMatching(/Cooling down.*Nothing was dialled/) });
    expect(f.calls).toHaveLength(1);
  });

  it("explains a Twilio trial refusal (unverified number)", async () => {
    const f = fake("Twilio refused the call (HTTP 400, code 21219): The number +91… is unverified.");
    await expect(placeTestCall(userId, f.provider)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Verified Caller IDs") });
    expect(await getDb().astonAlert.count({ where: { userId, channel: "phone", status: "gave_up" } })).toBe(1);
  });

  it("refuses in test mode — that mode never dials", async () => {
    await expect(placeTestCall(userId, { name: "test", live: false, async place() { return { ref: "t" }; } })).rejects.toMatchObject({ message: expect.stringContaining("ASTON_PHONE_MODE") });
  });
});
