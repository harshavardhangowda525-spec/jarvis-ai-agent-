import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { env } from "@/lib/env";
import { publicMediaUrl, isPublicUrl, publicBase, ownPublicBase, NO_PUBLIC_URL } from "@/lib/public-url";

describe("the address Instagram downloads EV's media from", () => {
  it("serves EV's own media from the public address, whatever host the link was made with", () => {
    const base = "https://jarvis.example.app";
    expect(publicMediaUrl("http://localhost:3000/api/ev/media/abc123XYZ?kind=video", base)).toBe("https://jarvis.example.app/api/ev/media/abc123XYZ?kind=video");
    expect(publicMediaUrl("http://localhost:3000/api/ev/media/abc123XYZ", base)).toBe("https://jarvis.example.app/api/ev/media/abc123XYZ");
    expect(publicMediaUrl("https://cdn.example.com/v.mp4", null)).toBe("https://cdn.example.com/v.mp4"); // already public
    expect(publicMediaUrl("http://localhost:3000/api/ev/media/abc123XYZ", null)).toBeNull();   // nowhere to serve it from
    expect(isPublicUrl("https://127.0.0.1/x")).toBe(false);
    expect(NO_PUBLIC_URL).toMatch(/Open EV once in your Vercel JARVIS/);
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("Vercel saves its address; JARVIS on the PC uses it", () => {
  const e = env as unknown as Record<string, string>;
  const savedAppUrl = e.appUrl;
  let userId = "";
  beforeAll(async () => { userId = (await getDb().user.create({ data: { email: `pub-${Date.now()}@example.com`, passwordHash: "x" } })).id; });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  afterEach(() => { delete process.env.VERCEL_PROJECT_PRODUCTION_URL; e.appUrl = savedAppUrl; });

  it("on the PC with nothing saved yet: no public address", async () => {
    e.appUrl = "http://localhost:3000";
    expect(ownPublicBase()).toBeNull();
    expect(await publicBase(userId)).toBeNull();
  });

  it("on Vercel: its production address is used and saved", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "jarvis-ai-agent-self.vercel.app";
    expect(await publicBase(userId)).toBe("https://jarvis-ai-agent-self.vercel.app");
    await new Promise((r) => setTimeout(r, 50));
    const row = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: "jarvis_public_url" } } });
    expect(row?.metadata).toEqual({ url: "https://jarvis-ai-agent-self.vercel.app" });
    expect(row?.accessToken).toBeNull(); // just an address — no secret stored
  });

  it("then on the PC (localhost): the saved address is used", async () => {
    e.appUrl = "http://localhost:3000";
    expect(await publicBase(userId)).toBe("https://jarvis-ai-agent-self.vercel.app");
  });
});
