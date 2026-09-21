import "server-only";
import { env } from "@/lib/env";

/**
 * EV image generation. Provider-agnostic and configurable via env — no
 * hard-coded obsolete model names. Supports:
 *   - Gemini native image generation (generativelanguage API)
 *   - OpenAI Images API (or any OpenAI-images-compatible endpoint)
 * Returns raw bytes + mime type; the caller hosts them at a public URL.
 */

export type EvImageProvider = "gemini" | "openai";

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  provider: EvImageProvider;
  model: string;
}

export type Aspect = "square" | "portrait" | "landscape";

export class ImageGenError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ImageGenError";
  }
}

const GEMINI_DEFAULT = "gemini-2.5-flash-image";
const OPENAI_DEFAULT = "gpt-image-1";

/** Which image provider is active (explicit env, else inferred from keys). */
export function resolveImageProvider(): { provider: EvImageProvider; model: string } | null {
  const explicit = env.evImageProvider as EvImageProvider | "";
  if (explicit === "gemini" && env.geminiApiKey) return { provider: "gemini", model: env.evImageModel || GEMINI_DEFAULT };
  if (explicit === "openai" && env.openaiApiKey) return { provider: "openai", model: env.evImageModel || OPENAI_DEFAULT };
  if (env.geminiApiKey) return { provider: "gemini", model: env.evImageModel || GEMINI_DEFAULT };
  if (env.openaiApiKey) return { provider: "openai", model: env.evImageModel || OPENAI_DEFAULT };
  return null;
}

function openAiSize(aspect: Aspect): string {
  if (aspect === "portrait") return "1024x1536";
  if (aspect === "landscape") return "1536x1024";
  return "1024x1024";
}

function aspectHint(aspect: Aspect): string {
  if (aspect === "portrait") return " Vertical 4:5 portrait composition suitable for an Instagram feed post.";
  if (aspect === "landscape") return " Wide 16:9 landscape composition.";
  return " Square 1:1 composition suitable for Instagram.";
}

/** Generate an image. Throws ImageGenError with an honest message on failure. */
export async function generateImage(prompt: string, aspect: Aspect = "square"): Promise<GeneratedImage> {
  const cfg = resolveImageProvider();
  if (!cfg) {
    throw new ImageGenError(
      "Image generation isn't configured. Set GEMINI_API_KEY (free) or OPENAI_API_KEY — EV then generates images with no extra setup.",
    );
  }
  const fullPrompt = prompt.trim() + aspectHint(aspect);
  return cfg.provider === "gemini"
    ? geminiImage(fullPrompt, cfg.model)
    : openAiImage(fullPrompt, cfg.model, aspect);
}

// --- Gemini native image generation --------------------------------------
async function geminiImage(prompt: string, model: string): Promise<GeneratedImage> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(env.geminiApiKey)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ImageGenError("Couldn't reach the Gemini image API.");
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Gemini image API error (HTTP ${res.status}).`;
    if (res.status === 404) {
      throw new ImageGenError(`Image model "${model}" not found. Set EV_IMAGE_MODEL to a current image model. ${msg}`, 404);
    }
    throw new ImageGenError(msg, res.status);
  }
  const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const inline = imgPart?.inlineData ?? imgPart?.inline_data;
  if (!inline?.data) {
    const textPart = parts.find((p) => p?.text)?.text;
    throw new ImageGenError(
      textPart
        ? `The image model returned text instead of an image: ${String(textPart).slice(0, 160)}`
        : "The image model returned no image data.",
    );
  }
  return {
    bytes: Buffer.from(inline.data, "base64"),
    mimeType: inline.mimeType || inline.mime_type || "image/png",
    provider: "gemini",
    model,
  };
}

// --- OpenAI Images API ----------------------------------------------------
async function openAiImage(prompt: string, model: string, aspect: Aspect): Promise<GeneratedImage> {
  const base = (env.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.openaiApiKey}` },
      body: JSON.stringify({ model, prompt, size: openAiSize(aspect), n: 1 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ImageGenError("Couldn't reach the OpenAI image API.");
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `OpenAI image API error (HTTP ${res.status}).`;
    throw new ImageGenError(msg, res.status);
  }
  const item = json?.data?.[0];
  if (item?.b64_json) {
    return { bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png", provider: "openai", model };
  }
  if (item?.url) {
    // Some models return a URL instead of b64 — fetch the bytes so we can host them.
    const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) throw new ImageGenError("Couldn't download the generated image.");
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return { bytes: buf, mimeType: imgRes.headers.get("content-type") || "image/png", provider: "openai", model };
  }
  throw new ImageGenError("The image API returned no image data.");
}
