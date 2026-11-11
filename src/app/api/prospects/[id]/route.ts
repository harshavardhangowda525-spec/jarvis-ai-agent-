import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { CrmError, deleteProspect, getProspect, updateProspect } from "@/lib/prospects/service";
import { STATUSES } from "@/lib/prospects/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try { const user = await requireUser(); return ok(await getProspect(user.id, params.id)); }
  catch (e) { return e instanceof CrmError ? fail(e.message, 404) : handleError(e); }
}

const s = (n: number) => z.string().trim().max(n).nullable().optional();
const Patch = z.object({
  status: z.enum(STATUSES).optional(), lostReason: s(40), nextAction: s(200), nextActionAt: z.coerce.date().nullable().optional(), note: s(4000),
  contactPerson: s(120), phone: s(30), whatsapp: s(30), interestedServices: z.array(z.string().max(80)).max(20).optional(), budgetRange: s(80), decisionMaker: s(120),
  value: z.number().nonnegative().nullable().optional(), contacted: z.boolean().optional(), doNotContact: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  try { const user = await requireUser(); return ok(await updateProspect(user.id, params.id, Patch.parse(await req.json()), "you")); }
  catch (e) { return e instanceof CrmError ? fail(e.message) : handleError(e); }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try { const user = await requireUser(); await deleteProspect(user.id, params.id); return ok({ deleted: true }); }
  catch (e) { return e instanceof CrmError ? fail(e.message, 404) : handleError(e); }
}
