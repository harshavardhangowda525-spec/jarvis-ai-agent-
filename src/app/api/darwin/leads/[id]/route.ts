import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { CRM_STATUSES, STAGE_LABEL } from "@/lib/darwin/config";
import { logActivity } from "@/lib/darwin/store";
import { LEAD_SELECT, toLeadDTO } from "@/lib/darwin/lead-dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateOrNull = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional();

const schema = z.object({
  stage: z.enum(CRM_STATUSES).optional(),
  notes: z.string().max(8000).nullable().optional(),
  nextFollowUpAt: dateOrNull,
  lastContactedAt: dateOrNull,
  salesValue: z.number().min(0).max(1e12).nullable().optional(),
  serviceInterest: z.string().trim().max(120).nullable().optional(),
});

// Date-only values are stored at noon UTC so they show as the same calendar day in any timezone.
const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v));
const label = (s: string) => STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s.toUpperCase();

/** Update a lead's CRM fields (status, notes, follow-up, contact date, deal). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const db = getDb();
    const lead = await db.darwinLead.findFirst({ where: { id: params.id, userId: user.id } });
    if (!lead) return fail("Lead not found.", 404);

    const data: Record<string, unknown> = {};
    if (body.stage !== undefined) data.stage = body.stage;
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
    if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = toDate(body.nextFollowUpAt);
    if (body.lastContactedAt !== undefined) data.lastContactedAt = toDate(body.lastContactedAt);
    if (body.salesValue !== undefined) data.salesValue = body.salesValue;
    if (body.serviceInterest !== undefined) data.serviceInterest = body.serviceInterest || null;
    // Moving to CONTACTED without a contact date stamps "now" (the user just contacted them).
    if (body.stage === "contacted" && body.lastContactedAt === undefined && !lead.lastContactedAt) data.lastContactedAt = new Date();

    const updated = await db.darwinLead.update({ where: { id: lead.id }, data, select: LEAD_SELECT });

    if (body.stage && body.stage !== lead.stage) {
      await logActivity(user.id, "stage_changed", `${lead.businessName}: ${label(lead.stage)} → ${label(body.stage)}.`, lead.id, { from: lead.stage, to: body.stage });
    }
    const other = Object.keys(data).filter((k) => k !== "stage");
    if (other.length) await logActivity(user.id, "crm_updated", `${lead.businessName}: updated ${other.join(", ")}.`, lead.id);

    return ok({ lead: toLeadDTO(updated) });
  } catch (err) {
    return handleError(err);
  }
}
