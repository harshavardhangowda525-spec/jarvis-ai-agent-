import { requireUser } from "@/lib/auth/session";
import { pingDb } from "@/lib/db";
import { capabilities } from "@/lib/env";
import { toolCatalog } from "@/lib/tools/registry";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** System status for the dashboard's status panel + Settings. */
export async function GET() {
  try {
    await requireUser();
    const dbOk = await pingDb();
    return ok({
      services: {
        database: dbOk,
        ai: capabilities.ai,
        voice: capabilities.voice,
        search: capabilities.search,
        weather: capabilities.weather,
        tools: true,
      },
      tools: toolCatalog(),
    });
  } catch (err) {
    return handleError(err);
  }
}
