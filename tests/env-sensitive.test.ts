import { describe, it, expect, vi } from "vitest";

describe("values pulled from Vercel as [SENSITIVE] count as not set", () => {
  it("voice falls back to the free browser voice; the STT model uses its default", async () => {
    vi.resetModules();
    process.env.ELEVENLABS_API_KEY = "[SENSITIVE]";
    process.env.ELEVENLABS_STT_MODEL_ID = "[SENSITIVE]";
    process.env.GROQ_API_KEY = "[sensitive]";
    const { env, capabilities } = await import("@/lib/env");
    expect(env.elevenLabsApiKey).toBe("");
    expect(env.elevenLabsSttModelId).toBe("scribe_v1");
    expect(capabilities.voice).toBe(false);
    expect(env.groqApiKey).toBe("");
    delete process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_STT_MODEL_ID; delete process.env.GROQ_API_KEY;
  });
});
