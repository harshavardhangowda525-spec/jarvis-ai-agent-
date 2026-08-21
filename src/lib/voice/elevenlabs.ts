import "server-only";
import { env } from "@/lib/env";
import {
  VoiceProvider,
  TtsOptions,
  SttResult,
  VoiceNotConfiguredError,
  VoiceProviderError,
} from "./provider";

const API_BASE = "https://api.elevenlabs.io/v1";

/**
 * ElevenLabs voice provider.
 *
 * - TTS uses the streaming endpoint with a low-latency conversational model
 *   (eleven_turbo_v2_5 by default) so time-to-first-audio stays small; the
 *   route pipes this straight to the browser <audio> element.
 * - STT uses the speech-to-text endpoint for microphone transcription.
 *
 * The API key is read from env server-side only and never sent to the browser.
 */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly name = "elevenlabs";

  isConfigured(): boolean {
    return env.elevenLabsApiKey.length > 0;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      "xi-api-key": env.elevenLabsApiKey,
      ...extra,
    };
  }

  private resolveVoiceId(override?: string): string {
    const id = override || env.elevenLabsVoiceId;
    if (!id) {
      throw new VoiceProviderError(
        "No ElevenLabs voice is configured. Set ELEVENLABS_VOICE_ID.",
        400,
      );
    }
    return id;
  }

  async streamTts(
    text: string,
    opts: TtsOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    if (!this.isConfigured()) throw new VoiceNotConfiguredError();
    const voiceId = this.resolveVoiceId(opts.voiceId);

    const url = `${API_BASE}/text-to-speech/${voiceId}/stream?optimize_streaming_latency=3&output_format=mp3_44100_128`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        }),
        body: JSON.stringify({
          text,
          model_id: env.elevenLabsModelId,
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new VoiceProviderError("The voice service is unreachable.", 504);
    }

    if (res.status === 401) throw new VoiceProviderError("ElevenLabs API key is invalid.", 401);
    if (res.status === 404) throw new VoiceProviderError("The configured voice ID was not found.", 400);
    if (!res.ok || !res.body) {
      const detail = await safeText(res);
      throw new VoiceProviderError(`Voice generation failed: ${detail}`, 502);
    }
    return res.body;
  }

  async transcribe(audio: Blob | ArrayBuffer, mimeType: string): Promise<SttResult> {
    if (!this.isConfigured()) throw new VoiceNotConfiguredError();

    const blob =
      audio instanceof Blob ? audio : new Blob([audio], { type: mimeType });
    const form = new FormData();
    form.append("file", blob, "audio.webm");
    form.append("model_id", env.elevenLabsSttModelId);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/speech-to-text`, {
        method: "POST",
        headers: this.headers(),
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new VoiceProviderError("The transcription service is unreachable.", 504);
    }

    if (res.status === 401) throw new VoiceProviderError("ElevenLabs API key is invalid.", 401);
    if (!res.ok) {
      const detail = await safeText(res);
      throw new VoiceProviderError(`Transcription failed: ${detail}`, 502);
    }
    const j: any = await res.json();
    return { text: j.text ?? "", language: j.language_code };
  }

  async listVoices(): Promise<{ id: string; name: string }[]> {
    if (!this.isConfigured()) throw new VoiceNotConfiguredError();
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/voices`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new VoiceProviderError("The voice service is unreachable.", 504);
    }
    if (!res.ok) throw new VoiceProviderError("Could not load voices.", 502);
    const j: any = await res.json();
    return (j.voices ?? []).map((v: any) => ({ id: v.voice_id, name: v.name }));
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}

let singleton: ElevenLabsVoiceProvider | null = null;

/** Returns the configured voice provider. Swap this factory to change backends. */
export function getVoiceProvider(): VoiceProvider {
  if (!singleton) singleton = new ElevenLabsVoiceProvider();
  return singleton;
}
