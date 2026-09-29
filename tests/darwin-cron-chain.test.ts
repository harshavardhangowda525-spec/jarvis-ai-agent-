import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.hoisted(() => { process.env.CRON_SECRET = "cron-test-secret"; });

const run = vi.hoisted(() => ({ more: true, calls: [] as unknown[] }));
vi.mock("@/lib/darwin/daily/run", () => ({
  runDarwinDaily: async (o: unknown) => { run.calls.push(o); return { date: "2026-10-02", results: [{ userId: "u", status: run.more ? "running" : "completed", verified: 3 }], more: run.more }; },
}));
import { GET } from "@/app/api/cron/darwin-daily/route";

/** The cron hands today's search on to itself until it's done — no one has to open DARWIN. */
describe("DARWIN daily cron keeps going by itself", () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; auth: string | null }[] = [];
  beforeEach(() => {
    run.more = true; run.calls = []; sent = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return new Response("{}");
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });
  const call = (qs = "", auth = "Bearer cron-test-secret") => GET(new Request(`https://jarvis.example.com/api/cron/darwin-daily${qs}`, { headers: { authorization: auth } }));

  it("still searching → starts the next call (hop 1) with the cron secret", async () => {
    const res = await call();
    expect((await res.json()).data).toMatchObject({ more: true, hop: 0, continued: true });
    expect(sent).toEqual([{ url: "https://jarvis.example.com/api/cron/darwin-daily?hop=1", auth: "Bearer cron-test-secret" }]);
    expect(run.calls[0]).toMatchObject({ earlyMin: 60 });
  });

  it("stops handing on when the day is done, at the hop limit, or when asked not to", async () => {
    run.more = false;
    await call();
    await call("?hop=5");
    run.more = true;
    await call("?hop=30");
    await call("?chain=off");
    expect(sent).toEqual([]);
  });

  it("refuses without the cron secret", async () => {
    expect((await call("", "Bearer nope")).status).toBe(401);
    expect(run.calls).toHaveLength(0);
  });
});
