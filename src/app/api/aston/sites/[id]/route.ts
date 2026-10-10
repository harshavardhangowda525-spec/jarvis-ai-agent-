import { ok } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { getSite, toSiteDTO } from "@/lib/aston/site/builder";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireOwner();
    return ok(toSiteDTO(await getSite(user.id, params.id)));
  } catch (err) {
    return astonError(err);
  }
}
