import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { crmLead, crmPatch } from "@/lib/crm/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One lead: history, notes, follow-ups, verification evidence. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "crm-lead", async (user) => ok(await crmLead(user.id, params.id)));
}

/** Edit / change status. Converted and Rejected answer 409 needs_confirmation until confirm: true. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "crm-lead", async (user) => ok(await crmPatch(user.id, params.id, await req.json())), 60);
}
