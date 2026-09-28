import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => { process.env.MAGICHOUR_API_KEY = "mhk_test"; delete process.env.MAGICHOUR_VIDEO_MODEL; delete process.env.MAGICHOUR_IMAGE_MODEL; });
import sharp from "sharp";
import { createImage, createVideo, waitProject, videoSeconds, aspectRatio, MagicHourError } from "@/lib/ev/magichour";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => { status?: number; json?: unknown } = () => ({ json: {} });
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = {
      url: String(input), method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null,
    };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("Magic Hour client (current API shapes)", () => {
  it("creates an image with aspect_ratio, one image and the prompt — authenticated", async () => {
    respond = () => ({ json: { id: "img_1", credits_charged: 5, frame_cost: 5 } });
    expect(await createImage("A bakery storefront at dawn", "portrait")).toBe("img_1");
    expect(calls[0].url).toBe("https://api.magichour.ai/v1/ai-image-generator");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Bearer mhk_test");
    expect(calls[0].body).toEqual({ name: "EV image", image_count: 1, aspect_ratio: "9:16", style: { prompt: "A bakery storefront at dawn" } });
    expect(calls[0].body).not.toHaveProperty("orientation"); // deprecated field
  });

  it("image-to-video uploads EV's own image first — no public URL needed", async () => {
    respond = (c) => c.url.endsWith("/v1/files/upload-urls")
      ? { json: { items: [{ upload_url: "https://upload.magichour.test/put/abc", file_path: "api-assets/u1/abc.png", expires_at: "2026-10-01T00:00:00Z" }] } }
      : c.url.endsWith("/v1/image-to-video") ? { json: { id: "vid_1" } } : { json: {} };
    // a WebP labelled as PNG — what a generator sometimes hands back
    const bytes = await sharp({ create: { width: 900, height: 1600, channels: 3, background: "#2244aa" } }).webp().toBuffer();
    expect(await createVideo({ prompt: "slow push-in", image: { bytes, mimeType: "image/png" }, seconds: 8, aspect: "portrait" })).toBe("vid_1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.magichour.ai/v1/files/upload-urls",
      "PUT https://upload.magichour.test/put/abc",
      "POST https://api.magichour.ai/v1/image-to-video",
    ]);
    // always a real JPEG, declared as one — the type Magic Hour is told matches the bytes
    expect(calls[0].body).toEqual({ items: [{ type: "image", extension: "jpg" }] });
    const put = Buffer.from(calls[1].body as Uint8Array);
    expect(put.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect((await sharp(put).metadata())).toMatchObject({ format: "jpeg", width: 900, height: 1600 });
    expect(calls[1].headers.Authorization).toBeUndefined(); // the signed upload URL needs no API key
    expect(calls[2].body).toEqual({ name: "EV video", end_seconds: 8, assets: { image_file_path: "api-assets/u1/abc.png" }, style: { prompt: "slow push-in" } });
  });

  it("an unreadable start image is reported as that, before anything is sent", async () => {
    await expect(createVideo({ prompt: "x", image: { bytes: Buffer.from("not an image"), mimeType: "image/png" } })).rejects.toThrow(/isn't a readable picture/);
    expect(calls).toHaveLength(0);
  });

  it("if Magic Hour still rejects the start image, the message says which step", async () => {
    respond = (c) => c.url.endsWith("/v1/files/upload-urls")
      ? { json: { items: [{ upload_url: "https://upload.magichour.test/put/z", file_path: "api-assets/u1/z.jpg" }] } }
      : c.url.endsWith("/v1/image-to-video") ? { status: 422, json: { message: "Invalid URL" } } : { json: {} };
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(createVideo({ prompt: "x", image: { bytes } })).rejects.toThrow("Magic Hour: Invalid URL (image-to-video, uploaded start image api-assets/u1/z.jpg)");
  });

  it("text-to-video uses aspect_ratio and a length the default model accepts", async () => {
    respond = () => ({ json: { id: "vid_2" } });
    await createVideo({ prompt: "a busy café", aspect: "landscape", seconds: 20 });
    expect(calls[0].url).toBe("https://api.magichour.ai/v1/text-to-video");
    expect(calls[0].body).toEqual({ name: "EV video", end_seconds: 15, aspect_ratio: "16:9", style: { prompt: "a busy café" } });
    expect(videoSeconds(1)).toBe(3);
    expect(aspectRatio("square")).toBe("1:1");
  });

  it("reads finished projects (downloads[] or download) and Magic Hour's own error", async () => {
    respond = () => ({ json: { id: "p", status: "complete", downloads: [{ url: "https://cdn.magichour.ai/a.png", expires_at: "x" }] } });
    expect(await waitProject("image", "p", 5000)).toMatchObject({ done: true, ok: true, url: "https://cdn.magichour.ai/a.png" });
    expect(calls[0].url).toBe("https://api.magichour.ai/v1/image-projects/p");
    respond = () => ({ json: { id: "v", status: "complete", downloads: [], download: { url: "https://cdn.magichour.ai/v.mp4" } } });
    expect((await waitProject("video", "v", 5000)).url).toBe("https://cdn.magichour.ai/v.mp4");
    respond = () => ({ json: { id: "v", status: "error", error: { code: "nsfw", message: "Prompt was flagged" } } });
    expect(await waitProject("video", "v", 5000)).toMatchObject({ done: true, ok: false, error: "Prompt was flagged" });
  });

  it("keeps polling while it renders, and gives up at the time budget", async () => {
    let n = 0;
    respond = () => ({ json: { id: "p", status: ++n < 3 ? "rendering" : "complete", downloads: n < 3 ? [] : [{ url: "https://cdn/x.png" }] } });
    expect((await waitProject("image", "p", 5000, 10)).url).toBe("https://cdn/x.png");
    respond = () => ({ json: { id: "p", status: "queued", downloads: [] } });
    expect(await waitProject("image", "p", 30, 10)).toMatchObject({ done: false, status: "queued" });
  });

  it("explains key, credit and validation problems plainly", async () => {
    respond = () => ({ status: 401, json: { message: "Unauthorized" } });
    await expect(createImage("x")).rejects.toThrow(/rejected the API key/);
    respond = () => ({ status: 402, json: {} });
    await expect(createImage("x")).rejects.toThrow(/not enough credits/);
    respond = () => ({ status: 422, json: { message: "end_seconds must be at least 3" } });
    await expect(createVideo({ prompt: "x" })).rejects.toThrow("Magic Hour: end_seconds must be at least 3");
    respond = () => ({ status: 422, json: {} });
    await expect(createImage("x")).rejects.toBeInstanceOf(MagicHourError);
  });
});

describe("EV uses Magic Hour", () => {
  it("defaults to Magic Hour only; the key's other spelling works too", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    delete process.env.EV_MEDIA_PROVIDER; delete process.env.MAGICHOUR_API_KEY; process.env.MAGIC_HOUR_API_KEY = "mhk_alt";
    process.env.GEMINI_API_KEY = "gem_test";
    try {
      const { env, capabilities } = await import("@/lib/env");
      expect(env.evMediaProvider).toBe("magichour");
      expect(env.magicHourApiKey).toBe("mhk_alt");
      expect(capabilities.evImage).toBe(true);
      delete process.env.MAGIC_HOUR_API_KEY;
      vi.resetModules();
      const again = await import("@/lib/env");
      // Gemini is set, but EV makes images with Magic Hour — so no image engine until it's connected
      expect(again.capabilities.evImage).toBe(false);
    } finally { process.env = saved; vi.resetModules(); }
  });
});
