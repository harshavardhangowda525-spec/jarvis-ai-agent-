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
  // "claude" = the Claude bridge (`npm run claude`); default = the Ollama brain
  kind: z.enum(["ollama", "claude"]).optional(),
});

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Called by a gateway on the user's PC (not by a browser): the Ollama brain
 * (`npm run brain`, OLLAMA_API_KEY) or the Claude bridge (`npm run claude`,
 * CLAUDE_BRIDGE_KEY). Each is authenticated with its own shared secret — the
 * same one it requires on every AI request — so only your own PC can point
 * JARVIS at a brain.
 */
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const claude = body.kind === "claude";
    const secret = claude ? env.claudeBridgeKey : env.ollamaApiKey;
    if (!secret) {
      return fail(claude ? "Set CLAUDE_BRIDGE_KEY on Vercel (the key `npm run claude` printed), then redeploy." : "Set OLLAMA_API_KEY on Vercel (the key `npm run brain` printed), then redeploy.", 503);
    }
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token || !sameSecret(token, secret)) return fail(claude ? "Invalid bridge key." : "Invalid brain key.", 401);

    const rl = rateLimit("brain-register", 30, 60_000);
    if (!rl.allowed) return fail("Too many registrations.", 429);

    const accounts = await registerBrain({ url: body.url, model: body.model }, claude ? "claude" : "ollama");
    return ok({ online: !!body.url, accounts });
  } catch (err) {
    return handleError(err);
  }
}
