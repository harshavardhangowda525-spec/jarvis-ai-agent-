import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.hoisted(() => { process.env.ELEVENLABS_API_KEY = "el-test-key"; delete process.env.ROBIN_VOICE_ID; });
import { getDb, isDbConfigured } from "@/lib/db";

const d = isDbConfigured ? describe : describe.skip;

d("Robin designs its own voice (ElevenLabs Voice Design, mocked)", () => {
  let userId = "";
  let V: typeof import("@/lib/robin/voice");
  const calls: { url: string; method: string; body: any; key: string | null }[] = [];
  let n = 0;
  let fail: string | null = null;
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    V = await import("@/lib/robin/voice");
    userId = (await getDb().user.create({ data: { email: `robin-voice-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, key: (init.headers as Record<string, string>)["xi-api-key"] ?? null });
      if (fail) return new Response(JSON.stringify({ detail: { message: fail } }), { status: 403 });
      if (url.endsWith("/text-to-voice/design")) return Response.json({ previews: [{ generated_voice_id: `gen-${++n}`, audio_base_64: "SUQz" }] });
      if (url.endsWith("/text-to-voice")) return Response.json({ voice_id: `robin-voice-${n}` });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
  });
  afterAll(async () => { globalThis.fetch = realFetch; await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("speaks with the stock voice until its own exists", async () => {
    expect(await V.robinVoiceFor(userId)).toBe("cjVigY5qzO86Huf0OWal");
  });
  it("designs a voice from the description, saves it, and uses it", async () => {
    const r = await V.createRobinVoice(userId);
    expect(r).toEqual({ voiceId: "robin-voice-1", preview: "SUQz" });
    expect(calls[0]).toMatchObject({ url: "https://api.elevenlabs.io/v1/text-to-voice/design", method: "POST", key: "el-test-key" });
    expect(calls[0].body.voice_description).toMatch(/friendly young adult male/);
    expect(calls[1]).toMatchObject({ url: "https://api.elevenlabs.io/v1/text-to-voice", body: { generated_voice_id: "gen-1", voice_name: "ROBIN (JARVIS sales agent)" } });
    expect(await V.robinVoiceFor(userId)).toBe("robin-voice-1");
    expect(await V.robinVoiceStatus(userId)).toMatchObject({ using: "designed", voiceId: "robin-voice-1", error: null });
    expect(await V.ensureRobinVoice(userId)).toBe("exists"); // never re-designs on its own
  });
  it("a new voice replaces the old one (and frees its slot)", async () => {
    calls.length = 0;
    await V.createRobinVoice(userId, "A deep, calm baritone male voice with a British accent, measured and reassuring.");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.elevenlabs.io/v1", "")}`)).toEqual(["POST /text-to-voice/design", "POST /text-to-voice", "DELETE /voices/robin-voice-1"]);
    expect(await V.robinVoiceFor(userId)).toBe("robin-voice-2");
  });
  it("if ElevenLabs refuses, Robin keeps its current voice and says why", async () => {
    fail = "voice design is not available on your plan";
    await expect(V.createRobinVoice(userId)).rejects.toThrow(/may not allow Voice Design/);
    fail = null;
    expect(await V.robinVoiceFor(userId)).toBe("robin-voice-2");
    expect((await V.robinVoiceStatus(userId)).error).toMatch(/not available on your plan/);
  });
});
