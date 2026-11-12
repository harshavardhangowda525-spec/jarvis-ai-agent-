import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDb, isDbConfigured } from "@/lib/db";
import { kinOf, matchContact, personalOpener } from "@/lib/calls/personal";
import { runOneCall, type CallerIO } from "@/lib/calls/loop";

const contacts = [
  { name: "Amma", aliases: [], relation: "mother" },
  { name: "Ravi Kumar", aliases: ["Ravi anna"], relation: "friend" },
  { name: "Akka", aliases: [], relation: null },
];

describe("calling people you know (pure)", () => {
  it("knows what 'mom', 'appa', 'akka' mean", () => {
    expect(kinOf("Mom")).toBe("mother");
    expect(kinOf("amma")).toBe("mother");
    expect(kinOf("Appa")).toBe("father");
    expect(kinOf("Ravi")).toBeNull();
  });
  it("finds who you mean", () => {
    expect(matchContact("mom", contacts)?.name).toBe("Amma");
    expect(matchContact("my mother", contacts)?.name).toBe("Amma");
    expect(matchContact("Ravi", contacts)?.name).toBe("Ravi Kumar");
    expect(matchContact("ravi anna", contacts)?.name).toBe("Ravi Kumar");
    expect(matchContact("sister", contacts)?.name).toBe("Akka");
    expect(matchContact("dad", contacts)).toBeNull();
  });
  it("says who it is, that it's an AI assistant, and the message", () => {
    expect(personalOpener("Amma", "Harsha", "Harsha will be a bit late tonight.")).toBe("Hi, this is JARVIS, Harsha's AI assistant. Harsha asked me to let you know: Harsha will be a bit late tonight.");
    expect(personalOpener("Ravi Kumar", "Harsha", "the meeting moved to 5")).toMatch(/^Hi Ravi, this is JARVIS/);
  });
  it("speaks first if Mom picks up and says nothing", async () => {
    const said: string[] = []; let t = 0, i = 0;
    const heard: (string | null)[] = [null, "Okay, what time will he come?", "okay bye"];
    const io: CallerIO = {
      api: async (b) => (b.opener ? { say: "Hi, this is JARVIS, Harsha's AI assistant. Harsha asked me to let you know: Harsha will be late." } : b.action === "turn" ? { say: "I'll ask Harsha and let you know.", end: String(b.heard).includes("bye") } : {}),
      dial: async () => ({ ok: true }), hangup: async () => {}, inCall: async () => true,
      speak: async (x) => { said.push(x); t += 2000; return { interrupted: false }; },
      listen: async (ms) => { const h = i < heard.length ? heard[i++] : null; t += h === null ? ms : 1500; return h; },
      label: () => {}, log: () => {}, sleep: async (ms) => { t += ms; }, now: () => t, stopped: () => false,
    };
    expect(await runOneCall(io, { id: "per_x", to: "+919999999999", name: "Amma", maxMs: 300_000, maxTurns: 10 })).toBe("ended");
    expect(said[0]).toMatch(/Harsha will be late/);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("calling people you know (integration)", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `personal-call-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("saves Mom, calls her, passes the message, never invents, and tells you what she said", async () => {
    const P = await import("@/lib/calls/personal");
    const C = await import("@/lib/calls/service");
    const Ph = await import("@/lib/phone/service");
    const db = getDb();
    await expect(P.queuePersonalCall(userId, { who: "Mom", message: "Harsha will be late" })).rejects.toThrow(/don't have Mom's number/);
    await P.saveContact(userId, { name: "Amma", phone: "98450 12345", relation: "mother" });
    await expect(P.queuePersonalCall(userId, { who: "Mom", message: "Harsha will be late" })).rejects.toThrow(/Through the laptop/);
    await Ph.saveSettings(userId, { enabled: true, mode: "laptop", toNumber: "+91 99808 01231" });
    await db.callSettings.create({ data: { userId, enabled: false, ownerName: "Harshavardhan" } });
    const { call } = await P.queuePersonalCall(userId, { who: "mom", message: "Harsha will be a bit late tonight" });
    expect(call.toNumber).toBe("+919845012345");

    const n = await C.callerNext(userId);
    expect(n.call).toMatchObject({ id: call.id, name: "Amma" }); // goes out even with lead calling off
    expect((await C.callerNext(userId)).call).toBeNull(); // one call at a time

    const open = await P.personalTurn(userId, call.id, "", { opener: true });
    expect(open.say).toBe("Hi, this is JARVIS, Harshavardhan's AI assistant. Harshavardhan asked me to let you know: Harsha will be a bit late tonight.");
    await P.personalEvent(userId, call.id, "answered");
    const ask = vi.fn(async (system: string) => {
      expect(system).toMatch(/NEVER invent/);
      expect(system).toMatch(/never claim to be Harshavardhan or a human/);
      return '{"say":"I don\'t know the exact time, but I\'ll ask Harshavardhan and let you know.","end":false,"lang":"en"}';
    });
    const t = await P.personalTurn(userId, call.id, "Okay. What time will he come home?", { ask });
    expect(t.say).toMatch(/ask Harshavardhan/);
    await P.personalTurn(userId, call.id, "Okay, bye", { ask: async () => '{"say":"Bye, take care!","end":true}' });
    const fin = await P.personalFinish(userId, call.id, { reason: "ended" }, { ask: async () => "Your mom said okay and asked what time you'll be home." });
    expect(fin).toEqual({ status: "completed", summary: "Your mom said okay and asked what time you'll be home." });
    const rec = (await P.recentPersonalCalls(userId))[0];
    expect(rec).toMatchObject({ name: "Amma", status: "completed" });
    expect((rec.transcript as unknown[]).length).toBe(5);
    const act = await db.activityEvent.findFirst({ where: { userId, source: "personal-call" } });
    expect(act?.result).toMatch(/asked what time/);
  });
});
