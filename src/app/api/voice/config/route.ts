import { requireUser } from "@/lib/auth/session";
import { getVoiceProvider } from "@/lib/voice/elevenlabs";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice configuration for the client: whether voice is available, the user's
 * current preferences, and (when configured) the selectable voices. No secret
 * ever leaves the server — the client talks to /api/voice/tts and /stt, which
 * hold the key server-side.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const provider = getVoiceProvider();
    const configured = provider.isConfigured();

    const pref = await getDb().voicePreference.findUnique({
      where: { userId: user.id },
    });

    let voices: { id: string; name: string }[] = [];
    if (configured) {
      try {
        voices = await provider.listVoices();
      } catch {
        voices = [];
      }
    }

    return ok({
      configured,
      provider: provider.name,
      preferences: {
        voiceId: pref?.voiceId ?? null,
        voiceEnabled: pref?.voiceEnabled ?? true,
        autoListen: pref?.autoListen ?? true,
        speakingRate: pref?.speakingRate ?? 1.0,
      },
      voices,
    });
  } catch (err) {
    return handleError(err);
  }
}
