import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { discoveryReady, providerHealth } from "@/lib/darwin/providers/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every DARWIN data provider's REAL state: one small test request per
 * configured provider (cached 5 minutes; `?fresh=1` checks again now).
 * Answers names, states and fixes — never a key value.
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const providers = await providerHealth({ fresh });
    return ok({ providers, discoveryReady: discoveryReady(providers), checkedAt: new Date().toISOString() });
  } catch (e) {
    return handleError(e);
  }
}
