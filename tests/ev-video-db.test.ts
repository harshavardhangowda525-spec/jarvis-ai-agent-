import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
vi.hoisted(() => { process.env.MAGICHOUR_API_KEY = "mhk_test"; });
import sharp from "sharp";
import { getDb, isDbConfigured } from "@/lib/db";
import { resolveStartImage } from "@/lib/ev/start-image";
import { evVideoTool } from "@/lib/tools/ev/video";

const d = isDbConfigured ? describe : describe.skip;

d("EV video: the start image, however it's referred to", () => {
  let userId = "", otherId = "", imgId = "", png: Buffer;
  beforeAll(async () => {
    png = await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#1d4ed8" } }).png().toBuffer();
    const u = await getDb().user.create({ data: { email: `evv-${Date.now()}@example.com`, passwordHash: "x" } });
    const o = await getDb().user.create({ data: { email: `evv2-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id; otherId = o.id;
    imgId = (await getDb().evMedia.create({ data: { userId, mimeType: "image/png", data: png, prompt: "bakery" }, select: { id: true } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: { in: [userId, otherId] } } }).catch(() => {}); });

  it("finds EV's own image by id, by its link on any host (even localhost), or a bare id", async () => {
    for (const ref of [
      { contentImageId: imgId },
      { imageUrl: `http://localhost:3000/api/ev/media/${imgId}` },
      { imageUrl: `https://jarvis.vercel.app/api/ev/media/${imgId}?kind=image` },
      { imageUrl: imgId },
    ]) {
      const s = await resolveStartImage(userId, ref);
      expect(s, JSON.stringify(ref)).toMatchObject({ source: "own", mediaId: imgId });
      expect(s!.bytes.equals(png)).toBe(true);
    }
  });

  it("a garbled or private reference falls back to the image EV just made", async () => {
    expect(await resolveStartImage(userId, { imageUrl: "the image above" })).toMatchObject({ source: "latest", mediaId: imgId });
    expect(await resolveStartImage(userId, { imageUrl: "http://127.0.0.1:9/secret.png" })).toMatchObject({ source: "latest" }); // never fetched
  });

  it("never uses another user's image, and returns nothing when there's no image at all", async () => {
    expect(await resolveStartImage(otherId, { contentImageId: imgId })).toBeNull();
    expect(await resolveStartImage(userId, {})).toBeNull();
  });

  describe("the ev_video tool end to end (Magic Hour mocked)", () => {
    const realFetch = globalThis.fetch;
    let calls: { url: string; method: string; body: unknown }[] = [];
    beforeEach(() => {
      calls = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://api.magichour.ai") && !url.startsWith("https://upload.magichour.test")) return realFetch(input, init);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
        calls.push({ url, method: init?.method ?? "GET", body });
        if (url.endsWith("/files/v.mp4")) return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "Content-Type": "video/mp4" } });
        const json = url.endsWith("/v1/files/upload-urls") ? { items: [{ upload_url: "https://upload.magichour.test/put/1", file_path: "api-assets/u/1.jpg" }] }
          : url.endsWith("/v1/image-to-video") || url.endsWith("/v1/text-to-video") ? { id: "vid_9" }
          : url.includes("/v1/video-projects/") ? { id: "vid_9", status: "complete", downloads: [{ url: "https://api.magichour.ai/files/v.mp4" }] } : {};
        return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;
    });
    afterEach(() => { globalThis.fetch = realFetch; });
    const ctx = () => ({ userId, timezone: "UTC", activity: () => {} });

    it("the local link that used to fail with 'invalid url' now starts an image-to-video", async () => {
      const r = await evVideoTool.execute({ prompt: "slow cinematic push-in", imageUrl: `http://localhost:3000/api/ev/media/${imgId}`, aspect: "portrait", seconds: 8 }, ctx() as never);
      expect(r.data).toMatchObject({ url: expect.stringMatching(/\/api\/ev\/media\/.+kind=video/) });
      expect(calls.map((c) => `${c.method} ${c.url}`).slice(0, 3)).toEqual([
        "POST https://api.magichour.ai/v1/files/upload-urls",
        "PUT https://upload.magichour.test/put/1",
        "POST https://api.magichour.ai/v1/image-to-video",
      ]);
      expect(calls[2].body).toMatchObject({ assets: { image_file_path: "api-assets/u/1.jpg" }, end_seconds: 8 });
      // Magic Hour was never given a link to fetch
      expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("/api/ev/media/");
    }, 60_000);

    it("the mediaId works too, and a prompt alone is text-to-video", async () => {
      await evVideoTool.execute({ prompt: "pan across", contentImageId: imgId }, ctx() as never);
      expect(calls.some((c) => c.url.endsWith("/v1/image-to-video"))).toBe(true);
      calls = [];
      await evVideoTool.execute({ prompt: "a busy café at sunrise" }, ctx() as never);
      expect(calls[0].url).toBe("https://api.magichour.ai/v1/text-to-video");
    }, 60_000);
  });
});
