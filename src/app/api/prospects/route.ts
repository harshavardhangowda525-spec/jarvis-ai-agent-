import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, fail, handleError } from "@/lib/api";
import { board, createProspect, CrmError } from "@/lib/prospects/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** JARVIS CRM: everything the CRM screen shows (prospects, call list, searches, the finder). */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await board(user.id));
  } catch (e) { return handleError(e); }
}

const s = (n: number) => z.string().trim().max(n).nullable().optional();
const Body = z.object({ businessName: z.string().trim().min(1).max(200), category: s(80), contactPerson: s(120), phone: s(30), whatsapp: s(30), address: s(300), area: s(80), city: s(60), website: s(300), instagram: s(200), notes: s(2000) });

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    return ok(await createProspect(user.id, Body.parse(await req.json()), "you"), { status: 201 });
  } catch (e) { return e instanceof CrmError ? fail(e.message) : handleError(e); }
}
