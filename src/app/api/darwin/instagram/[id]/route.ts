import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { CONTACT_STATUSES, FOLLOW_UP_STATUSES } from "@/lib/darwin/instagram/types";

export const runtime = "nodejs";


const schema = z.object({
  contactStatus: z.enum(CONTACT_STATUSES).optional(),
  followUpStatus: z.enum(FOLLOW_UP_STATUSES).optional(),
  followUpAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

/** Update an "Instagram + No Website" lead's contact / follow-up status and notes (your own records only). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const db = getDb();
    const lead = await db.darwinIgLead.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } });
    if (!lead) return fail("Lead not found.", 404);
    const updated = await db.darwinIgLead.update({
      where: { id: lead.id },
      data: {
        ...(body.contactStatus ? { contactStatus: body.contactStatus } : {}),
        ...(body.followUpStatus ? { followUpStatus: body.followUpStatus } : {}),
        ...(body.followUpAt !== undefined ? { followUpAt: body.followUpAt ? new Date(body.followUpAt) : null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      },
    });
    return ok({ lead: updated });
  } catch (err) {
    return handleError(err);
  }
}
