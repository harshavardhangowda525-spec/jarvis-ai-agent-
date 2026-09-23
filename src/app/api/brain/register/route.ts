import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { ok, fail, handleError, rateLimit } from "@/lib/api";
import { registerBrain } from "@/lib/ai/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  // The gateway's public tunnel URL (https), or null when it's shutting down.
  url: z.string().url().startsWith("https://").nullable(),
  model: z.string().trim().max(120).optional(),
});

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Called by the brain gateway on the user's PC (not by a browser). Authenticated
 * with the shared OLLAMA_API_KEY — the same secret the gateway requires on every
 * AI request — so only your own gateway can point JARVIS at a brain.
 */
export async function POST(req: NextRequest) {
  try {
    if (!env.ollamaApiKey) {
      return fail("Set OLLAMA_API_KEY on Vercel (the key `npm run brain` printed), then redeploy.", 503);
    }
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token || !sameSecret(token, env.ollamaApiKey)) return fail("Invalid brain key.", 401);

    const rl = rateLimit("brain-register", 30, 60_000);
    if (!rl.allowed) return fail("Too many registrations.", 429);

    const body = schema.parse(await req.json());
    const accounts = await registerBrain({ url: body.url, model: body.model });
    return ok({ online: !!body.url, accounts });
  } catch (err) {
    return handleError(err);
  }
}
