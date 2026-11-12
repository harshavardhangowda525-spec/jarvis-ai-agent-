import { callerUser } from "@/lib/calls/device-auth";
import { ok, handleError } from "@/lib/api";
import { getLive } from "@/lib/calls/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Calls window on the laptop, right now: checks, waiting reason, live transcript. */
export async function GET(req: Request) {
  try { const user = await callerUser(req); return ok({ caller: getLive(user.id) }); }
  catch (e) { return handleError(e); }
}
