import { describe, it, expect, vi } from "vitest";
import { RemoteTicks, dueAt } from "../operator/src/ticks.mjs";

const link = (url: string) => () => ({ url, token: "jmf_x" });
describe("helper runs JARVIS's every-minute jobs when JARVIS is on Vercel", () => {
  it("each job at its own pace", () => {
    expect(dueAt(0).map((j) => j[0])).toContain("/api/cron/mike");
    expect(dueAt(1).map((j) => j[0])).toEqual(["/api/cron/prospects", "/api/cron/phone", "/api/cron/robin", "/api/cron/jobs"]);
    expect(dueAt(5).map((j) => j[0])).toContain("/api/cron/plans");
  });
  it("calls Vercel with the cron secret", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const t = new RemoteTicks({ env: { JARVIS_CRON_SECRET: "s3" }, fetchImpl, link: link("https://jarvis.vercel.app") });
    await t.tick(); await t.tick();
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toContain("https://jarvis.vercel.app/api/cron/prospects");
    expect(calls[0][1].headers).toEqual({ Authorization: "Bearer s3" });
  });
  it("stays off for a JARVIS on this laptop, or without the secret", async () => {
    const fetchImpl = vi.fn();
    expect(await new RemoteTicks({ env: { JARVIS_CRON_SECRET: "s3" }, fetchImpl, link: link("http://127.0.0.1:3000") }).tick()).toEqual([]);
    expect(await new RemoteTicks({ env: {}, fetchImpl, link: link("https://jarvis.vercel.app") }).tick()).toEqual([]);
    expect(new RemoteTicks({ env: {}, fetchImpl, link: () => null }).start()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
