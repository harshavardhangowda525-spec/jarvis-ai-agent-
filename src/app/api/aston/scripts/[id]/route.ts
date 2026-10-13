import { z } from "zod";
import { ok } from "@/lib/api";
import { requireOwner } from "@/lib/aston/auth";
import { deleteScript, getScript, updateScript } from "@/lib/aston/scripts/service";
import { detailsSchema, SCRIPT_KINDS } from "@/lib/aston/scripts/format";
import { astonError } from "@/lib/aston/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireOwner();
    return ok(await getScript(user.id, params.id));
  } catch (err) {
    return astonError(err);
  }
}

const patch = z.object({
  title: z.string().max(120).optional(),
  kind: z.enum(SCRIPT_KINDS).optional(),
  businessType: z.string().max(60).nullable().optional(),
  details: detailsSchema.optional(),
  sections: z.array(z.unknown()).max(20).optional(),
  saved: z.boolean().optional(),
});

/** Rename, re-categorise, save to the library, or store edited text. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireOwner();
    return ok(await updateScript(user.id, params.id, patch.parse(await req.json())));
  } catch (err) {
    return astonError(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireOwner();
    await deleteScript(user.id, params.id);
    return ok({ deleted: true });
  } catch (err) {
    return astonError(err);
  }
}
