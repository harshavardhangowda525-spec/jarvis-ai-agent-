/**
 * Voice provider abstraction.
 *
 *   VoiceProvider
 *     ├── ElevenLabsVoiceProvider   (implemented)
 *     └── FutureVoiceProvider       (swap in without touching the agent)
 *
 * The JARVIS agent and API routes depend only on this interface, so the voice
 * backend can be replaced without rewriting anything else.
 */
import "server-only";

export interface TtsOptions {
  voiceId?: string;
  /** 0.25–4.0 nominal; providers clamp to their own range. */
  speakingRate?: number;
}

export interface SttResult {
  text: string;
  language?: string;
}

export interface VoiceProvider {
  readonly name: string;
  /** Whether the provider is configured (API key present). */
  isConfigured(): boolean;
  /** Stream low-latency TTS audio (mp3) for the given text. */
  streamTts(text: string, opts?: TtsOptions): Promise<ReadableStream<Uint8Array>>;
  /** Transcribe an audio blob to text. */
  transcribe(audio: Blob | ArrayBuffer, mimeType: string): Promise<SttResult>;
  /** List selectable voices for the UI. */
  listVoices(): Promise<{ id: string; name: string }[]>;
}

export class VoiceNotConfiguredError extends Error {
  constructor() {
    super("JARVIS voice is not configured.");
    this.name = "VoiceNotConfiguredError";
  }
}

export class VoiceProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}
