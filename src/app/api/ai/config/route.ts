import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { listConfiguredProviders } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List the AI brain providers that have credentials, plus the user's pick. */
export async function GET() {
  try {
    const user = await requireUser();
    const profile = await getDb().profile.findUnique({ where: { userId: user.id } });
    const providers = listConfiguredProviders();
    const selected = (profile as { aiProvider?: string | null } | null)?.aiProvider ?? null;
    return ok({ providers, selected });
  } catch (err) {
    return handleError(err);
  }
}

/** Set the user's preferred primary brain provider (must be configured). */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const raw = typeof body.provider === "string" ? body.provider.toLowerCase() : "";
    const configured = listConfiguredProviders().map((p) => p.id);

    // Empty string / "default" clears the pick (use env default).
    const value = raw && raw !== "default" ? raw : null;
    if (value && !configured.includes(value)) {
      return fail("That provider isn't configured. Add its API key first.", 400);
    }

    await getDb().profile.update({
      where: { userId: user.id },
      data: { aiProvider: value } as { aiProvider: string | null },
    });
    return ok({ selected: value });
  } catch (err) {
    return handleError(err);
  }
}
