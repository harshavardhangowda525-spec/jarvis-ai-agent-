import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => { process.env.ELEVENLABS_API_KEY = "el_test"; delete process.env.ULTRON_VOICE_STYLE; delete process.env.ULTRON_VOICE_SPEED; delete process.env.ULTRON_VOICE_STABILITY; });
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ voicePreference: { findUnique: async () => null } }) }));

import { ULTRON_FX, saturationCurve, darkImpulse } from "@/lib/voice/ultron-fx";
import { POST } from "@/app/api/voice/tts/route";

describe("ULTRON's voice effect (pure parts)", () => {
  it("is deeper and slower, never faster", () => {
    expect(ULTRON_FX.playbackRate).toBeLessThan(1);
    expect(ULTRON_FX.playbackRate).toBeGreaterThanOrEqual(0.8); // still clearly understandable
    expect(ULTRON_FX.lowShelf.gain).toBeGreaterThan(0);
  });
  it("saturation is a smooth, bounded, symmetric curve (clean at drive 0)", () => {
    const c = saturationCurve(ULTRON_FX.drive);
    expect(c[0]).toBeCloseTo(-1, 5); expect(c[c.length - 1]).toBeCloseTo(1, 5);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    expect(c[c.length - 1 - 100]).toBeCloseTo(-c[100], 5);
    const clean = saturationCurve(0);
    expect(clean[256]).toBeCloseTo((256 / 1023) * 2 - 1, 5);
  });
  it("the reverb tail is finite, decays to silence and is the same every time", () => {
    const [l, r] = darkImpulse(44100, 1.9, 3.2);
    expect(l.length).toBe(Math.round(44100 * 1.9));
    const energy = (a: Float32Array, from: number, to: number) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return e; };
    expect(energy(l, 0, 4000)).toBeGreaterThan(energy(l, l.length - 4000, l.length) * 50);
    expect(l.every(Number.isFinite)).toBe(true);
    expect(l).not.toEqual(r); // stereo, not mono copied
    expect(darkImpulse(44100, 0.5, 3)[0]).toEqual(darkImpulse(44100, 0.5, 3)[0]);
  });
});

describe("ULTRON's delivery from ElevenLabs", () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; body: any }[] = [];
  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(new Uint8Array([0xff, 0xf3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });
  const say = (agent?: string) => POST(new Request("http://x/api/voice/tts", { method: "POST", body: JSON.stringify({ text: "I was designed to save the world.", ...(agent ? { agent } : {}) }) }) as never);

  it("ULTRON: its own deep voice, restless and dramatic, a little slower", async () => {
    const res = await say("ultron");
    expect(res.status).toBe(200);
    expect(sent[0].url).toContain("/text-to-speech/N2lVS1w4EtoT3dr4eOWO/stream");
    expect(sent[0].body.voice_settings).toMatchObject({ stability: 0.28, similarity_boost: 0.85, style: 0.65, speed: 0.92 });
  });
  it("JARVIS, EV and DARWIN keep their usual delivery", async () => {
    for (const agent of [undefined, "jarvis", "ev", "darwin"]) {
      sent = [];
      await say(agent);
      expect(sent[0].body.voice_settings).toEqual({ stability: 0.4, similarity_boost: 0.75, style: 0, use_speaker_boost: true });
    }
  });
});
