import { ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which build is actually live. Vercel injects the git SHA at build time, so
 * this lets you confirm a deploy picked up the latest commit (the recurring
 * "is it deployed yet?" question). No auth — it exposes nothing sensitive.
 */
export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    "dev";
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";
  return ok({
    sha,
    shortSha: sha.slice(0, 7),
    branch: process.env.VERCEL_GIT_COMMIT_REF || "",
    message: message.split("\n")[0].slice(0, 80),
    builtAt: process.env.VERCEL_DEPLOYMENT_ID ? new Date().toISOString() : null,
    env: process.env.VERCEL_ENV || "local",
  });
}
