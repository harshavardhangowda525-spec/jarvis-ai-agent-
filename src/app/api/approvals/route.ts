import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { listCenter } from "@/lib/approvals/center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything waiting for you, plus recent decisions. Reading this approves nothing. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await listCenter(user.id));
  } catch (e) {
    return handleError(e);
  }
}
