import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getVoiceProvider } from "@/lib/voice/elevenlabs";
import { VoiceNotConfiguredError, VoiceProviderError } from "@/lib/voice/provider";
import { ok, fail, handleError, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Speech-to-text: accepts a recorded audio blob, returns the transcript. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`stt:${user.id}`, 60, 60_000);
    if (!rl.allowed) return fail("Slow down — too many voice requests.", 429);

    const provider = getVoiceProvider();
    if (!provider.isConfigured()) {
      return fail("JARVIS voice is not configured.", 503);
    }

    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) return fail("No audio provided.", 400);
    if (file.size === 0) return fail("Empty audio.", 400);
    if (file.size > 25 * 1024 * 1024) return fail("Audio too large.", 413);

    const result = await provider.transcribe(file, file.type || "audio/webm");
    return ok({ text: result.text, language: result.language ?? null });
  } catch (err) {
    if (err instanceof VoiceNotConfiguredError) return fail(err.message, 503);
    if (err instanceof VoiceProviderError) return fail(err.message, err.status);
    return handleError(err);
  }
}
