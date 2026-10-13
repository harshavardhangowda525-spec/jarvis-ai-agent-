import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { groqApiKey: "gsk_test" } }));
const { groqTranscribe, groqSttAvailable } = await import("@/lib/voice/groq-stt");

describe("Groq speech-to-text fallback", () => {
  it("sends the audio to Groq Whisper and returns the words", async () => {
    let sent: { url: string; auth: string; model: unknown; file: unknown } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      const f = init.body as FormData;
      sent = { url, auth: (init.headers as Record<string, string>).Authorization, model: f.get("model"), file: f.get("file") };
      return new Response(JSON.stringify({ text: " Which clients need follow-up today? " }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await groqTranscribe(new Blob([new Uint8Array(10)], { type: "audio/webm" }), fake);
    expect(r.text).toBe("Which clients need follow-up today?");
    expect(sent!.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(sent!.auth).toBe("Bearer gsk_test");
    expect(sent!.model).toBe("whisper-large-v3-turbo");
    expect(sent!.file).toBeInstanceOf(Blob);
    expect(groqSttAvailable()).toBe(true);
  });
  it("reports a bad key or a used-up limit plainly", async () => {
    const st = (s: number) => (async () => new Response("{}", { status: s })) as unknown as typeof fetch;
    await expect(groqTranscribe(new Blob([]), st(401))).rejects.toThrow(/rejected GROQ_API_KEY/);
    await expect(groqTranscribe(new Blob([]), st(429))).rejects.toThrow(/limit/);
  });
});
