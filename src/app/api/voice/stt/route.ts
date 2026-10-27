import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getVoiceProvider } from "@/lib/voice/elevenlabs";
import { VoiceNotConfiguredError, VoiceProviderError } from "@/lib/voice/provider";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { groqSttAvailable, groqTranscribe } from "@/lib/voice/groq-stt";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Speech-to-text: accepts a recorded audio blob, returns the transcript. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`stt:${user.id}`, 60, 60_000);
    if (!rl.allowed) return fail("Slow down — too many voice requests.", 429);

    const provider = getVoiceProvider();
    // no ElevenLabs on this PC → Groq's Whisper (same key JARVIS already uses)
    const useGroq = !provider.isConfigured() && groqSttAvailable();
    if (!provider.isConfigured() && !useGroq) {
      return fail("Speech recognition needs ELEVENLABS_API_KEY or GROQ_API_KEY in .env.local.", 503);
    }

    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) return fail("No audio provided.", 400);
    if (file.size === 0) return fail("Empty audio.", 400);
    if (file.size > 25 * 1024 * 1024) return fail("Audio too large.", 413);

    let result;
    try {
      result = useGroq ? await groqTranscribe(file) : await provider.transcribe(file, file.type || "audio/webm");
    } catch (e) {
      // ElevenLabs refused (bad key, no speech-to-text permission, quota…) → Groq's Whisper, if there's a key
      if (!useGroq && e instanceof VoiceProviderError && groqSttAvailable()) result = await groqTranscribe(file);
      else throw e;
    }
    return ok({ text: result.text, language: result.language ?? null });
  } catch (err) {
    if (err instanceof VoiceNotConfiguredError) return fail(err.message, 503);
    // a speech provider rejecting its API key is not you being signed out: 401 here only ever means "sign in to JARVIS"
    if (err instanceof VoiceProviderError) return fail(err.status === 401 ? `${err.message} Check the key in .env.local (an ElevenLabs key needs the Speech to Text permission), then restart JARVIS.` : err.message, err.status === 401 ? 502 : err.status);
    return handleError(err);
  }
}
