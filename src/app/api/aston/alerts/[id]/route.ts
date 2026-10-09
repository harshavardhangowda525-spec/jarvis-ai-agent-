import { ok, fail } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { ackBrowserAlert } from "@/lib/aston/notify";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An open ASTON/JARVIS tab displayed this browser alert. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    return (await ackBrowserAlert(user.id, params.id)) ? ok({ delivered: true }) : fail("Alert not found or already shown.", 404);
  } catch (err) {
    return astonError(err);
  }
}
