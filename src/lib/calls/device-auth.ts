import "server-only";
import { requireUser, UnauthorizedError } from "@/lib/auth/session";
import { finderUserId } from "@/lib/prospects/service";

/**
 * Who is calling: you (signed in), or JARVIS's own calling window on your
 * laptop — the JARVIS helper there adds its laptop key (Authorization: Bearer
 * jmf_…) to the calling page's requests. Only the call routes accept it.
 */
export async function callerUser(req: Request): Promise<{ id: string }> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer?.startsWith("jmf_")) {
    const id = await finderUserId(bearer);
    if (!id) throw new UnauthorizedError();
    return { id };
  }
  return requireUser();
}
