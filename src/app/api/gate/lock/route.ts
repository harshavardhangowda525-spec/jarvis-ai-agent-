import { ok, handleError } from "@/lib/api";
import { clearUnlocked } from "@/lib/gate/server";

export const runtime = "nodejs";

/** Lock JARVIS now (stays signed in; the gate asks again). */
export async function POST() {
  try {
    clearUnlocked();
    return ok({ locked: true });
  } catch (err) {
    return handleError(err);
  }
}
