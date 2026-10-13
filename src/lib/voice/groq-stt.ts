import "server-only";
import { env } from "@/lib/env";
import { VoiceProviderError } from "./provider";

/**
 * Speech-to-text through Groq's Whisper — the fallback when ElevenLabs isn't
 * set up on this PC. Uses the same GROQ_API_KEY JARVIS already answers with.
 */
export function groqSttAvailable(): boolean {
  return !!env.groqApiKey && !/^(your|x+|changeme)/i.test(env.groqApiKey);
}

export async function groqTranscribe(audio: Blob, fetchImpl: typeof fetch = fetch): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  form.append("file", audio, "audio.webm");
  form.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
  form.append("response_format", "json");
  let res: Response;
  try {
    res = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${env.groqApiKey}` }, body: form, signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new VoiceProviderError("The transcription service (Groq) is unreachable.", 504);
  }
  if (res.status === 401) throw new VoiceProviderError("Groq rejected GROQ_API_KEY.", 401);
  if (res.status === 429) throw new VoiceProviderError("Groq's speech limit is used up for now — try again in a minute.", 429);
  if (!res.ok) throw new VoiceProviderError(`Transcription failed (Groq ${res.status}).`, 502);
  const j = (await res.json().catch(() => null)) as { text?: string; language?: string } | null;
  return { text: String(j?.text ?? "").trim(), language: j?.language };
}
