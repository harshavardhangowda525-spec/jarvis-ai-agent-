import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { RobinError } from "./crm";

/**
 * ROBIN's own voice — designed from a description with ElevenLabs Voice Design
 * (POST /v1/text-to-voice/design → POST /v1/text-to-voice), saved to your
 * ElevenLabs account and remembered in Robin's settings. ROBIN_VOICE_ID always
 * wins; until a designed voice exists (or if your ElevenLabs plan can't design
 * one) Robin uses the stock voice "Eric".
 */

export const DEFAULT_VOICE_DESCRIPTION =
  "A warm, friendly young adult male voice with a light, natural Indian English accent. Upbeat, relaxed and confident — " +
  "like a close friend who happens to be brilliant at sales. Smooth, clear, conversational, mid-pitch, with a subtle smile in the voice. Studio-quality recording.";
const FALLBACK_VOICE = "cjVigY5qzO86Huf0OWal"; // "Eric"
const API = "https://api.elevenlabs.io/v1";

export interface RobinVoiceState {
  voiceId: string | null;
  description: string;
  createdAt: string | null;
  error: string | null;
  creating: boolean;
}

async function readState(userId: string): Promise<RobinVoiceState> {
  const row = await getDb().robinSettings.findUnique({ where: { userId } });
  const v = ((row?.data as Record<string, unknown> | null)?.voice ?? {}) as Partial<RobinVoiceState> & { startedAt?: string };
  // a creation that started over 2 minutes ago and never finished isn't "in progress" any more
  const creating = !!v.creating && !!v.startedAt && Date.now() - +new Date(v.startedAt) < 120_000;
  return { voiceId: v.voiceId ?? null, description: v.description ?? DEFAULT_VOICE_DESCRIPTION, createdAt: v.createdAt ?? null, error: v.error ?? null, creating };
}
async function writeState(userId: string, patch: Partial<RobinVoiceState> & { startedAt?: string | null }) {
  const db = getDb();
  const row = await db.robinSettings.findUnique({ where: { userId } });
  const data = (row?.data ?? {}) as Record<string, unknown>;
  const next = { ...data, voice: { ...((data.voice as object) ?? {}), ...patch } } as unknown as Prisma.InputJsonValue;
  await db.robinSettings.upsert({ where: { userId }, create: { userId, data: next }, update: { data: next } });
}

/** The voice Robin speaks with for this user. */
export async function robinVoiceFor(userId: string): Promise<string> {
  if (process.env.ROBIN_VOICE_ID?.trim()) return env.robinVoiceId;
  const s = await readState(userId).catch(() => null);
  return s?.voiceId ?? FALLBACK_VOICE;
}

export async function robinVoiceStatus(userId: string) {
  const s = await readState(userId);
  return {
    ...s,
    using: process.env.ROBIN_VOICE_ID?.trim() ? "env" : s.voiceId ? "designed" : "default",
    elevenLabs: !!env.elevenLabsApiKey,
  };
}

async function el<T>(path: string, init: RequestInit, timeoutMs = 90_000): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": env.elevenLabsApiKey, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (j as { detail?: { message?: string; status?: string } | string }).detail;
    const msg = typeof d === "string" ? d : d?.message || d?.status || `ElevenLabs answered HTTP ${res.status}`;
    throw new Error(res.status === 401 || res.status === 403 ? `ElevenLabs refused (${msg}) — your plan or API key may not allow Voice Design.` : msg);
  }
  return j as T;
}

/**
 * Design and save a new voice for Robin (replacing the one designed before).
 * Returns a short MP3 preview of the new voice (base64) when ElevenLabs gives one.
 */
export async function createRobinVoice(userId: string, description?: string): Promise<{ voiceId: string; preview: string | null }> {
  if (!env.elevenLabsApiKey) throw new RobinError("ELEVENLABS_API_KEY isn't set — Robin can't design a voice without ElevenLabs.", 409);
  const desc = (description?.trim() || DEFAULT_VOICE_DESCRIPTION).slice(0, 1000);
  if (desc.length < 20) throw new RobinError("Describe the voice in a little more detail (at least 20 characters).", 422);
  const before = await readState(userId);
  await writeState(userId, { creating: true, startedAt: new Date().toISOString(), error: null });
  try {
    const design = await el<{ previews?: { generated_voice_id: string; audio_base_64?: string }[] }>("/text-to-voice/design", {
      method: "POST",
      body: JSON.stringify({ voice_description: desc, model_id: "eleven_multilingual_ttv_v2", auto_generate_text: true, should_enhance: false }),
    });
    const pick = design.previews?.[0];
    if (!pick?.generated_voice_id) throw new Error("ElevenLabs didn't return a voice preview.");
    const saved = await el<{ voice_id: string }>("/text-to-voice", {
      method: "POST",
      body: JSON.stringify({ voice_name: "ROBIN (JARVIS sales agent)", voice_description: desc, generated_voice_id: pick.generated_voice_id, labels: { agent: "robin", app: "jarvis" } }),
    });
    if (!saved.voice_id) throw new Error("ElevenLabs didn't save the voice.");
    await writeState(userId, { voiceId: saved.voice_id, description: desc, createdAt: new Date().toISOString(), creating: false, startedAt: null, error: null });
    // free the slot of the voice this one replaces (only one Robin designed itself)
    if (before.voiceId && before.voiceId !== saved.voice_id) await fetch(`${API}/voices/${before.voiceId}`, { method: "DELETE", headers: { "xi-api-key": env.elevenLabsApiKey } }).catch(() => {});
    return { voiceId: saved.voice_id, preview: pick.audio_base_64 ?? null };
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "ElevenLabs took too long to design the voice — try again." : (e as Error).message;
    await writeState(userId, { creating: false, startedAt: null, error: msg.slice(0, 300) });
    throw new RobinError(msg, 502);
  }
}

/** First time Robin opens with ElevenLabs set up: design its voice once, in the background. */
export async function ensureRobinVoice(userId: string): Promise<"exists" | "started" | "skipped"> {
  if (process.env.ROBIN_VOICE_ID?.trim() || !env.elevenLabsApiKey) return "skipped";
  const s = await readState(userId);
  if (s.voiceId) return "exists";
  if (s.creating || s.error) return "skipped"; // one try automatically; after a failure, Settings → Create
  void createRobinVoice(userId).catch((e) => console.error("[robin voice]", (e as Error).message));
  return "started";
}
