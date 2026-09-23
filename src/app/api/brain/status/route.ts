import { env } from "@/lib/env";
import { ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup diagnostics for the brain gateway — open it in a browser to check the
 * live deployment. Reveals only WHETHER the key is set, never the key itself.
 */
export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  return ok({
    keyConfigured: env.ollamaApiKey.length > 0,
    build: sha.slice(0, 7),
    environment: process.env.VERCEL_ENV || "local",
    hint: env.ollamaApiKey
      ? "OLLAMA_API_KEY is set on this deployment."
      : "OLLAMA_API_KEY is NOT set on this deployment. Add it in Vercel → Settings → Environment Variables (tick Production), then redeploy.",
  });
}
