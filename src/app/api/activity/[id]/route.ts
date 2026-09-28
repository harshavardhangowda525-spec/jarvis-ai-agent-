import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { forgetActivity } from "@/lib/activity/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Forget this event" — permanently removes one event from the history. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!(await forgetActivity(user.id, params.id))) return fail("Event not found.", 404);
    return ok({ forgotten: true });
  } catch (err) {
    return handleError(err);
  }
}
