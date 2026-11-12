import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDb, isDbConfigured } from "@/lib/db";
import { phoneBridge, routeDecision, CallsWindow } from "../operator/src/calls/caller.mjs";

type Op = (op: string, arg?: string | null) => Promise<Record<string, unknown>>;

describe("JARVIS's calls without the orb: phone controls", () => {
  it("only fixed Phone Link actions, and only dialable numbers", async () => {
    const seen: unknown[] = [];
    const op: Op = phoneBridge({ platform: "win32", runPs: async (a: unknown) => { seen.push(a); return { ok: true }; } });
    expect(await op("dial", "+91 99808-01231")).toEqual({ ok: true });
    expect(seen.at(-1)).toEqual({ op: "phone-dial", to: "+919980801231" });
    expect(await op("dial", "call me; rm -rf")).toMatchObject({ ok: false });
    expect(await op("state")).toEqual({ ok: true });
    expect(seen.at(-1)).toEqual({ op: "phone-state" });
    expect(await op("format-disk")).toMatchObject({ ok: false });
    expect(seen).toHaveLength(2);
  });
  it("says plainly that calling needs Windows (Phone Link)", async () => {
    const op: Op = phoneBridge({ platform: "linux", runPs: async () => ({ ok: true }) });
    expect(await op("check")).toMatchObject({ ok: false, error: expect.stringMatching(/Windows/) });
  });
  it("the calls window only talks to JARVIS, and only JARVIS's API gets the laptop key", () => {
    const link = { url: "http://localhost:3000", token: "jmf_abc" };
    expect(routeDecision("http://localhost:3000/api/voice/tts", link, false)).toEqual({ action: "continue", headers: { authorization: "Bearer jmf_abc" } });
    expect(routeDecision("http://localhost:3000/calls/live?auto=1", link, true)).toEqual({ action: "continue" });
    expect(routeDecision("https://evil.example/api/x", link, false).action).toBe("abort");
    expect(routeDecision("https://evil.example/", link, true).action).toBe("abort");
  });
});

describe("JARVIS's calls without the orb: opening and closing the window", () => {
  function fakeCtx() {
    const page = { closed: false, url: "", isClosed() { return this.closed; }, on: () => {}, goto: async (u: string) => { page.url = u; } };
    const ctx = { closed: false, bindings: {} as Record<string, unknown>, grantPermissions: async () => {}, route: async () => {}, exposeBinding: async (n: string, f: unknown) => { ctx.bindings[n] = f; }, on: () => {}, pages: () => [page], newPage: async () => page, close: async () => { ctx.closed = true; page.closed = true; } };
    return { ctx, page };
  }
  it("opens by itself when calling is on, closes when it's off (never mid-call)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const linkFile = path.resolve("operator/.finder.json");
    const had = fs.existsSync(linkFile) ? fs.readFileSync(linkFile, "utf8") : null;
    fs.writeFileSync(linkFile, JSON.stringify({ url: "http://localhost:3999", token: "jmf_test" }));
    try {
      let on = true, inCall = false;
      const f = fakeCtx();
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { on } }), { status: 200 }));
      const w = new CallsWindow({ fetchImpl, launch: async () => f.ctx as never, phone: async (op: string) => (op === "state" ? { ok: true, inCall } : { ok: true }) });
      await w.poll();
      expect(f.page.url).toBe("http://localhost:3999/calls/live?auto=1");
      expect(Object.keys(f.ctx.bindings)).toEqual(["__jarvisPhone"]);
      expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: "Bearer jmf_test" });
      on = false; inCall = true;
      await w.poll();
      expect(f.ctx.closed).toBe(false); // on a call: stays
      inCall = false;
      await w.poll();
      expect(f.ctx.closed).toBe(true);
    } finally {
      if (had === null) fs.rmSync(linkFile, { force: true }); else fs.writeFileSync(linkFile, had);
    }
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("JARVIS's calls without the orb: the laptop key (integration)", () => {
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `calls-dev-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("the laptop key signs the calls window in; a wrong key doesn't; the helper knows when to open it", async () => {
    const P = await import("@/lib/prospects/service");
    const A = await import("@/lib/calls/device-auth");
    const C = await import("@/lib/calls/service");
    const Ph = await import("@/lib/phone/service");
    const token = await P.pairFinder(userId);
    const req = (t: string) => new Request("http://x/api/voice/tts", { headers: { authorization: `Bearer ${t}` } });
    expect(await A.callerUser(req(token))).toEqual({ id: userId });
    await expect(A.callerUser(req("jmf_wrong"))).rejects.toThrow();
    expect(await C.callsWanted(userId)).toMatchObject({ on: false });
    await Ph.saveSettings(userId, { enabled: true, mode: "laptop", toNumber: "+91 99808 01231" });
    expect(await C.callsWanted(userId)).toMatchObject({ on: true, toYou: true, leads: false });
    const { GET } = await import("@/app/api/calls/device/route");
    const r = await GET(new Request("http://x/api/calls/device", { headers: { authorization: `Bearer ${token}` } }));
    expect(await r.json()).toMatchObject({ ok: true, data: { on: true } });
    expect((await GET(new Request("http://x/api/calls/device"))).status).toBe(401);
  });
});
