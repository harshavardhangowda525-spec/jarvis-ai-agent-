import { NextRequest } from "next/server";
import { callerUser } from "@/lib/calls/device-auth";
import { getVoiceProvider } from "@/lib/voice/elevenlabs";
import { VoiceNotConfiguredError, VoiceProviderError } from "@/lib/voice/provider";
import { getDb } from "@/lib/db";
import { ttsSchema } from "@/lib/validation";
import { env } from "@/lib/env";
import { fail, handleError, rateLimit } from "@/lib/api";
import { robinVoiceFor } from "@/lib/robin/voice";
import { localTts, localVoiceAvailable, scriptLang } from "@/lib/voice/local-tts";

// short lines repeat a lot (fillers, "Hello? Can you hear me?") — keep the last few ready
const cache = new Map<string, Buffer>();
const remember = (k: string, b: Buffer) => { if (b.length > 600_000) return; cache.set(k, b); if (cache.size > 60) cache.delete(cache.keys().next().value as string); };

export const runtime = "nodejs";

/**
 * Streaming text-to-speech. The ElevenLabs API key stays server-side; the
 * browser receives only the audio stream. Low time-to-first-audio via the
 * provider's streaming endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await callerUser(req);
    const rl = rateLimit(`tts:${user.id}`, 150, 60_000); // calls speak sentence by sentence
    if (!rl.allowed) return fail("Slow down — too many voice requests.", 429);

    const { text, agent, lang } = ttsSchema.parse(await req.json());

    const provider = getVoiceProvider();
    const l = lang ?? scriptLang(text);
    // JARVIS's own voice (free, on this PC): when ElevenLabs isn't set up, when you choose it
    // (JARVIS_VOICE=local), and always for Kannada
    // (on Vercel, where the PC voice doesn't exist, everything goes to ElevenLabs once its key is set)
    const pcVoice = localVoiceAvailable(l) || localVoiceAvailable("en");
    if (!provider.isConfigured() || (pcVoice && (process.env.JARVIS_VOICE === "local" || (l === "kn" && localVoiceAvailable("kn"))))) {
      if (!localVoiceAvailable(l) && !localVoiceAvailable("en")) {
        return fail("JARVIS's own voice isn't installed yet — run npm run local once on this PC (it downloads it, about 150 MB).", 503);
      }
      const key = `${l}|${text}`;
      let wav = cache.get(key);
      if (!wav) {
        try { wav = await localTts(text, localVoiceAvailable(l) ? l : "en"); }
        catch (e) { return fail((e as Error).message || "JARVIS's voice failed.", 502); }
        if (text.length <= 80) remember(key, wav);
      }
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Voice": `jarvis-local-${l}` } });
    }

    // Per-user voice override (applies to JARVIS). Each internal agent uses its
    // own distinct voice so they're easy to tell apart by ear.
    const pref = await getDb().voicePreference.findUnique({
      where: { userId: user.id },
    });

    // Fixed per-agent voice IDs; JARVIS honors the user's saved preference.
    const agentVoiceId: Record<string, string> = {
      ultron: env.ultronVoiceId,
      edith: env.ultronVoiceId, // former name
      ev: env.evVoiceId,
      darwin: env.darwinVoiceId,
      mike: env.mikeVoiceId,
      aston: env.astonVoiceId,
      friday: env.fridayVoiceId,
      // Rubin speaks with the voice it designed for you (ROBIN_VOICE_ID still wins)
      robin: agent === "robin" ? await robinVoiceFor(user.id) : env.robinVoiceId,
    };
    const voiceId = agent && agent !== "jarvis"
      ? agentVoiceId[agent]
      : (pref?.voiceId ?? undefined);

    // Each agent gets a characteristic cadence; JARVIS keeps the user's setting.
    const agentRate: Record<string, number | undefined> = {
      ultron: 0.95,  // slow, deliberate
      edith: 0.95,
      ev: 1.08,      // upbeat, energetic
      darwin: 1.0,   // warm, friendly, natural pace
      mike: 1.0,     // calm, precise analyst
      aston: 1.03,   // smooth, confident designer
      friday: 1.05,  // quick, precise engineer
      robin: 1.04,   // brisk, friendly, organised
    };
    const speakingRate = agent && agent !== "jarvis"
      ? agentRate[agent]
      : (pref?.speakingRate ?? undefined);

    // ULTRON's delivery: menacing — less steady, more dramatic, slower. (The
    // browser then deepens and darkens it further; see src/lib/voice/ultron-fx.ts.)
    const agentDelivery: Record<string, { stability: number; similarity: number; style: number; speed: number } | undefined> = {
      ultron: env.ultronVoiceDelivery,
      edith: env.ultronVoiceDelivery,
    };
    const delivery = agent ? agentDelivery[agent] : undefined;

    const audioStream = await provider.streamTts(text, { voiceId, speakingRate, delivery });

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
