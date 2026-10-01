import { z } from "zod";
import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { robinApi } from "@/lib/robin/http";
import { createQuotation } from "@/lib/robin/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return robinApi(req, "quotations", async (user) => ok({
    quotations: await getDb().robinQuotation.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200, include: { items: { orderBy: { position: "asc" } }, lead: { select: { id: true, businessName: true, stage: true } } } }),
  }));
}
const schema = z.object({
  leadId: z.string().min(1),
  items: z.array(z.object({ service: z.string().trim().min(1).max(120), description: z.string().max(1000).optional().nullable(), quantity: z.number().min(0.01).max(10000).optional(), unitPrice: z.number().min(0).max(1e9).optional().nullable() })).min(1).max(30),
  discount: z.number().min(0).max(1e9).optional(),
  taxPct: z.number().min(0).max(100).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  paymentTerms: z.string().max(2000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  clientName: z.string().max(120).optional().nullable(),
  source: z.enum(["user", "voice"]).optional(),
});
export async function POST(req: Request) {
  return robinApi(req, "quotation-create", async (user) => {
    const b = schema.parse(await req.json());
    return ok(await createQuotation(user.id, b.leadId, b, b.source ?? "user"));
  }, 20);
}
