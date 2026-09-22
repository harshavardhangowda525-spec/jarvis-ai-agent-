import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getVoiceProvider } from "@/lib/voice/elevenlabs";
import { VoiceNotConfiguredError, VoiceProviderError } from "@/lib/voice/provider";
import { getDb } from "@/lib/db";
import { ttsSchema } from "@/lib/validation";
import { env } from "@/lib/env";
import { fail, handleError, rateLimit } from "@/lib/api";

export const runtime = "nodejs";

/**
 * Streaming text-to-speech. The ElevenLabs API key stays server-side; the
 * browser receives only the audio stream. Low time-to-first-audio via the
 * provider's streaming endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`tts:${user.id}`, 60, 60_000);
    if (!rl.allowed) return fail("Slow down — too many voice requests.", 429);

    const { text, agent } = ttsSchema.parse(await req.json());

    const provider = getVoiceProvider();
    if (!provider.isConfigured()) {
      return fail("JARVIS voice is not configured.", 503);
    }

    // Per-user voice override (applies to JARVIS). Each internal agent uses its
    // own distinct voice so they're easy to tell apart by ear.
    const pref = await getDb().voicePreference.findUnique({
      where: { userId: user.id },
    });

    // Fixed per-agent voice IDs; JARVIS honors the user's saved preference.
    const agentVoiceId: Record<string, string> = {
      edith: env.edithVoiceId,
      ev: env.evVoiceId,
      darwin: env.darwinVoiceId,
    };
    const voiceId = agent && agent !== "jarvis"
      ? agentVoiceId[agent]
      : (pref?.voiceId ?? undefined);

    // Each agent gets a characteristic cadence; JARVIS keeps the user's setting.
    const agentRate: Record<string, number | undefined> = {
      edith: undefined,
      ev: 1.08,      // upbeat, energetic
      darwin: 0.96,  // measured, analytical
    };
    const speakingRate = agent && agent !== "jarvis"
      ? agentRate[agent]
      : (pref?.speakingRate ?? undefined);

    const audioStream = await provider.streamTts(text, { voiceId, speakingRate });

    return new Response(audioStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof VoiceNotConfiguredError) return fail(err.message, 503);
    if (err instanceof VoiceProviderError) return fail(err.message, err.status);
    return handleError(err);
  }
}
