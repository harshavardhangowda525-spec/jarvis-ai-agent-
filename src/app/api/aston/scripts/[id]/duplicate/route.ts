import { ok } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { duplicateScript } from "@/lib/aston/scripts/service";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Copy a script so it can be customised for another business. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    return ok(await duplicateScript(user.id, params.id), { status: 201 });
  } catch (err) {
    return astonError(err);
  }
}
