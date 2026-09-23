import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";

const stored: { data: Buffer; mimeType: string }[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    evMedia: {
      findUnique: async () => null,
      create: async ({ data }: { data: { data: Buffer; mimeType: string } }) => { stored.push(data); return { id: `m${stored.length}` }; },
    },
  }),
}));

import { prepareImageForInstagram } from "@/lib/ev/igready";

const img = (w: number, h: number, fmt: "png" | "webp" | "jpeg") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } })[fmt]().toBuffer();

function serve(buf: Buffer) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(buf), { status: 200 })));
}

beforeEach(() => { stored.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe("prepareImageForInstagram", () => {
  it("turns a tall 9:16 PNG into a 4:5 JPEG (padded, not cropped)", async () => {
    serve(await img(1080, 1920, "png"));
    const r = await prepareImageForInstagram("u1", "https://cdn.example.com/a.png");
    expect(r.converted).toBe(true);
    const meta = await sharp(stored[0].data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(stored[0].mimeType).toBe("image/jpeg");
    expect(meta.width! / meta.height!).toBeGreaterThanOrEqual(0.8 - 0.005);
    expect(meta.width!).toBeLessThanOrEqual(1440);
    expect(r.url).toMatch(/\/api\/ev\/media\/m1$/);
    expect(r.note).toMatch(/PNG → JPEG/);
  });

  it("fits a very wide WebP into 1.91:1", async () => {
    serve(await img(3000, 1000, "webp"));
    await prepareImageForInstagram("u1", "https://cdn.example.com/b.webp");
    const meta = await sharp(stored[0].data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width! / meta.height!).toBeLessThanOrEqual(1.91 + 0.01);
    expect(meta.width!).toBe(1440);
  });

  it("leaves an already-valid square JPEG untouched", async () => {
    serve(await img(1080, 1080, "jpeg"));
    const r = await prepareImageForInstagram("u1", "https://cdn.example.com/c.jpg");
    expect(r).toEqual({ url: "https://cdn.example.com/c.jpg", converted: false });
    expect(stored).toHaveLength(0);
  });
});
