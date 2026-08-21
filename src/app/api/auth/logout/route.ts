import { destroyCurrentSession } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";

export async function POST() {
  try {
    await destroyCurrentSession();
    return ok({ loggedOut: true });
  } catch (err) {
    return handleError(err);
  }
}
