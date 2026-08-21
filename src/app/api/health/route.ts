import { pingDb } from "@/lib/db";
import { capabilities } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public health check for load balancers / uptime monitors. Returns 200 when
 * the app is up and the database is reachable, 503 otherwise.
 */
export async function GET() {
  const dbOk = await pingDb();
  const healthy = dbOk;
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      time: new Date().toISOString(),
      checks: {
        database: dbOk ? "up" : "down",
        ai: capabilities.ai ? "configured" : "unconfigured",
        voice: capabilities.voice ? "configured" : "unconfigured",
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
