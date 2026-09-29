import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
vi.hoisted(() => { process.env.MAGICHOUR_API_KEY = "mhk_test"; });
import { getDb, isDbConfigured } from "@/lib/db";
import { finishMagicHour } from "@/lib/ev/render";
import { evVideoTool } from "@/lib/tools/ev/video";

const d = isDbConfigured ? describe : describe.skip;

/**
 * A Magic Hour video takes minutes. EV's tool only waits a little, then hands
 * the render to the app, which keeps checking (finishMagicHour, via
 * /api/ev/render) until it's stored and shown — or Magic Hour's reason is shown.
 */
d("EV: finishing a Magic Hour render in the background", () => {
  let userId = "", otherId = "";
  const realFetch = globalThis.fetch;
  let project: Record<string, unknown> = {};
  let projectHttp = 200;
  let downloads = 0;
  beforeAll(async () => {
    userId = (await getDb().user.create({ data: { email: `evr-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    otherId = (await getDb().user.create({ data: { email: `evr2-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: { in: [userId, otherId] } } }).catch(() => {}); });
  beforeEach(() => {
    project = { status: "rendering" }; projectHttp = 200; downloads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.magichour.ai") && !url.startsWith("https://cdn.magichour.test")) return realFetch(input, init);
      if (url.startsWith("https://cdn.magichour.test")) {
        downloads++;
        // CDNs often label videos as octet-stream — it must still be stored as a video
        return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      }
      if (url.endsWith("/v1/text-to-video")) return Response.json({ id: "vid_bg1" });
      if (url.includes("/v1/video-projects/")) return Response.json(project, { status: projectHttp });
      return Response.json({});
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

  it("still rendering → rendering (nothing stored yet)", async () => {
    const r = await finishMagicHour(userId, "video", "vid_bg1", { budgetMs: 0 });
    expect(r).toMatchObject({ status: "rendering", stage: "rendering" });
    expect(await getDb().evMedia.count({ where: { userId } })).toBe(0);
  });

  it("a hiccup reaching Magic Hour isn't a failed video — keep checking", async () => {
    projectHttp = 503;
    expect(await finishMagicHour(userId, "video", "vid_bg1", { budgetMs: 0 })).toMatchObject({ status: "rendering", stage: "waiting" });
  });

  it("Magic Hour's own error is passed on", async () => {
    project = { status: "error", error: { code: "no_credits", message: "Not enough frames left on your plan" } };
    const r = await finishMagicHour(userId, "video", "vid_err", { budgetMs: 0 });
    expect(r).toMatchObject({ status: "failed" });
    expect((r as { error: string }).error).toContain("Not enough frames left on your plan");
  });

  it("complete → stored once as a real video (asking again returns the same copy)", async () => {
    project = { status: "complete", downloads: [{ url: "https://cdn.magichour.test/out/v.mp4?sig=1" }] };
    const a = await finishMagicHour(userId, "video", "vid_done", { budgetMs: 0, label: "bakery reel" });
    expect(a).toMatchObject({ status: "ready", url: expect.stringMatching(/\/api\/ev\/media\/.+\?kind=video$/) });
    const b = await finishMagicHour(userId, "video", "vid_done", { budgetMs: 0 });
    expect(b).toEqual(a);
    expect(downloads).toBe(1);
    const m = await getDb().evMedia.findMany({ where: { userId, prompt: { startsWith: "mh:vid_done" } } });
    expect(m).toHaveLength(1);
    expect(m[0].mimeType).toBe("video/mp4");
    // another user can't pick up someone else's render
    project = { status: "rendering" };
    expect(await finishMagicHour(otherId, "video", "vid_done", { budgetMs: 0 })).toMatchObject({ status: "rendering" });
  });

  it("rejects anything that isn't a project id", async () => {
    expect(await finishMagicHour(userId, "video", "../../v1/secret", { budgetMs: 0 })).toMatchObject({ status: "failed" });
  });

  it("ev_video: a long render tells the app to keep watching instead of going silent", async () => {
    // skip the tool's short wait
    let t = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 60_000));
    const r = await evVideoTool.execute({ prompt: "slow push-in on fresh bread" }, { userId, timezone: "UTC", activity: () => {} } as never);
    expect(r.data).toMatchObject({ ready: false, pendingMedia: { kind: "video", projectId: "vid_bg1", label: "slow push-in on fresh bread" } });
    expect(r.summary).toMatch(/appear here by itself/);
  });

  it("ev_video check: a failed render is an error with Magic Hour's reason", async () => {
    project = { status: "error", error: { message: "Prompt was flagged" } };
    await expect(evVideoTool.execute({ action: "check", projectId: "vid_bg1" }, { userId, timezone: "UTC", activity: () => {} } as never))
      .rejects.toThrow(/Prompt was flagged/);
  });
});
