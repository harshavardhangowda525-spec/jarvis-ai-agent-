import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getVisionConfigs, getAnthropicClient, getOpenAiClient } from "@/lib/ai/client";
import { ok, fail, handleError, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

// A captured screen frame, base64-encoded. ~8MB of base64 ≈ a large 4K JPEG.
const MAX_B64 = 8 * 1024 * 1024;

/**
 * Screen reading: the browser captures a frame of the user's screen/window/tab
 * (via getDisplayMedia) and posts it here as a base64 image. We send it to a
 * VISION-capable provider (Gemini / OpenAI / Anthropic / OpenRouter) — never a
 * text-only model like Groq gpt-oss — and return JARVIS's answer.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`vision:${user.id}`, 30, 60_000);
    if (!rl.allowed) return fail("Too many screen reads. Try again shortly.", 429);

    let configs;
    try {
      configs = getVisionConfigs();
    } catch {
      return fail(
        "No vision-capable AI is configured. Add a multimodal provider key (e.g. GEMINI_API_KEY) — text-only models like Groq gpt-oss can't read the screen.",
        503,
      );
    }

    const body = (await req.json().catch(() => null)) as
      | { image?: string; mimeType?: string; prompt?: string }
      | null;
    if (!body?.image) return fail("No screen image provided.", 400);

    // Accept either a raw base64 string or a full data URL.
    const raw = body.image.startsWith("data:")
      ? body.image.slice(body.image.indexOf(",") + 1)
      : body.image;
    if (raw.length > MAX_B64) return fail("Screen image too large.", 413);

    const mimeType = body.mimeType || "image/jpeg";
    const question =
      (body.prompt || "").slice(0, 2000) ||
      "This is a screenshot of my screen. Describe what's on it, read any visible text, and tell me anything important or actionable.";
    const dataUrl = `data:${mimeType};base64,${raw}`;

    let lastErr: unknown = null;
    for (const cfg of configs) {
      try {
        let answer = "";
        if (cfg.kind === "anthropic") {
          const client = getAnthropicClient(cfg);
          const message = await client.messages.create({
            model: cfg.model,
            max_tokens: 1200,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg", data: raw } },
                  { type: "text", text: question },
                ],
              },
            ],
          });
          answer = message.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
        } else {
          const client = getOpenAiClient(cfg);
          const completion = await client.chat.completions.create({
            model: cfg.model,
            max_tokens: 1200,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: question },
                  { type: "image_url", image_url: { url: dataUrl } },
                ] as any,
              },
            ],
          });
          answer = completion.choices[0]?.message?.content ?? "";
        }
        if (answer.trim()) return ok({ answer, provider: cfg.provider });
        lastErr = new Error("Empty response from vision model.");
      } catch (err) {
        // Fall back to the next vision provider (rate limit, model gone, etc.).
        console.error(`[vision] provider ${cfg.provider} failed:`, err);
        lastErr = err;
      }
    }
    return handleError(lastErr ?? new Error("Vision request failed."));
  } catch (err) {
    return handleError(err);
  }
}
