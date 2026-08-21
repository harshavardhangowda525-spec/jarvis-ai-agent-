import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getAiConfig, getAnthropicClient, getOpenAiClient } from "@/lib/ai/client";
import { capabilities } from "@/lib/env";
import { ok, fail, handleError, rateLimit } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * Files & vision: analyze an uploaded image (vision), PDF, or text document.
 * Works with whichever AI provider is configured — Anthropic (native image +
 * PDF) or an OpenAI-compatible provider like Gemini (image + text).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!capabilities.ai) return fail("The AI model is not configured.", 503);
    const rl = rateLimit(`files:${user.id}`, 20, 60_000);
    if (!rl.allowed) return fail("Too many uploads. Try again shortly.", 429);

    const form = await req.formData();
    const file = form.get("file");
    const prompt = String(form.get("prompt") ?? "").slice(0, 2000);
    if (!(file instanceof Blob)) return fail("No file provided.", 400);
    if (file.size === 0) return fail("Empty file.", 400);
    if (file.size > MAX_BYTES) return fail("File too large (max 15MB).", 413);

    const type = file.type || "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());
    const b64 = bytes.toString("base64");
    const cfg = getAiConfig();
    const question =
      prompt || "Analyze this file. Summarize the key information and anything notable.";

    const isImage = IMAGE_TYPES.includes(type);
    const isText = type.startsWith("text/") || type === "application/json";
    const isPdf = type === "application/pdf";

    let answer = "";

    if (cfg.kind === "anthropic") {
      const client = getAnthropicClient(cfg);
      let content: any[];
      if (isImage) {
        content = [
          { type: "image", source: { type: "base64", media_type: type, data: b64 } },
          { type: "text", text: question },
        ];
      } else if (isPdf) {
        content = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: question },
        ];
      } else if (isText) {
        const text = bytes.toString("utf-8").slice(0, 100_000);
        content = [{ type: "text", text: `${question}\n\nDocument content:\n"""\n${text}\n"""` }];
      } else {
        return fail("Unsupported file type. Upload an image, PDF, or text file.", 415);
      }
      const message = await client.messages.create({
        model: cfg.model,
        max_tokens: 1200,
        messages: [{ role: "user", content }],
      });
      answer = message.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
    } else {
      // OpenAI-compatible (Gemini, Groq, OpenAI)
      const client = getOpenAiClient(cfg);
      let content: any;
      if (isImage) {
        content = [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: `data:${type};base64,${b64}` } },
        ];
      } else if (isText) {
        const text = bytes.toString("utf-8").slice(0, 100_000);
        content = `${question}\n\nDocument content:\n"""\n${text}\n"""`;
      } else if (isPdf) {
        return fail(
          "PDF analysis isn't supported by the current AI provider. Upload an image or text file, or switch to an Anthropic key for PDFs.",
          415,
        );
      } else {
        return fail("Unsupported file type. Upload an image or text file.", 415);
      }
      const completion = await client.chat.completions.create({
        model: cfg.model,
        max_tokens: 1200,
        messages: [{ role: "user", content }],
      });
      answer = completion.choices[0]?.message?.content ?? "";
    }

    return ok({ answer, fileType: type, fileName: (file as any).name ?? "upload" });
  } catch (err) {
    return handleError(err);
  }
}
