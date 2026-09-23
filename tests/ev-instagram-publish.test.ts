import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
import { igPublishImage, IgError } from "@/lib/ev/instagram";

const creds = { accessToken: "IGAAfake", businessId: "me", source: "env" as const };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** Fake Graph API: container → N× IN_PROGRESS → final status; publish fails `notReady` times first. */
function fakeGraph(opts: { inProgress: number; final: string; statusText?: string; notReady?: number }) {
  const log: string[] = [];
  let polls = 0, publishes = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (init?.method === "POST" && u.pathname.endsWith("/media")) { log.push("create"); return json(200, { id: "C1" }); }
    if (u.pathname.endsWith("/C1")) {
      polls++; log.push("poll");
      if (polls <= opts.inProgress) return json(200, { status_code: "IN_PROGRESS" });
      return json(200, { status_code: opts.final, status: opts.statusText ?? opts.final });
    }
    if (u.pathname.endsWith("/media_publish")) {
      publishes++; log.push("publish");
      if (publishes <= (opts.notReady ?? 0))
        return json(400, { error: { message: "Media ID is not available", code: 9007, error_subcode: 2207027 } });
      return json(200, { id: "IGMEDIA123" });
    }
    return json(404, {});
  }));
  return log;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("igPublishImage", () => {
  it("waits for Instagram to finish processing before publishing (fixes 'Media ID is not available')", async () => {
    vi.useFakeTimers();
    const log = fakeGraph({ inProgress: 2, final: "FINISHED" });
    const p = igPublishImage(creds, "https://app.example.com/api/ev/media/x", "caption");
    await vi.runAllTimersAsync();
    expect(await p).toBe("IGMEDIA123");
    expect(log).toEqual(["create", "poll", "poll", "poll", "publish"]);
  });

  it("retries media_publish when Instagram briefly answers 9007", async () => {
    vi.useFakeTimers();
    const log = fakeGraph({ inProgress: 0, final: "FINISHED", notReady: 2 });
    const p = igPublishImage(creds, "https://app.example.com/i.jpg", "caption");
    await vi.runAllTimersAsync();
    expect(await p).toBe("IGMEDIA123");
    expect(log.filter((x) => x === "publish")).toHaveLength(3);
  });

  it("surfaces Instagram's own reason when processing fails", async () => {
    vi.useFakeTimers();
    fakeGraph({ inProgress: 0, final: "ERROR", statusText: "Error: The aspect ratio is not supported." });
    const p = igPublishImage(creds, "https://app.example.com/i.jpg", "caption").catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(IgError);
    expect(err.message).toMatch(/aspect ratio is not supported/i);
  });
});
