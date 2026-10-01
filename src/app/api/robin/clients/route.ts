import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi, toDate } from "@/lib/robin/http";
import { convertToClient, listClients } from "@/lib/robin/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return robinApi(req, "clients", async (user) => ok({ clients: await listClients(user.id) }));
}
const schema = z.object({
  leadId: z.string().min(1), confirm: z.boolean().optional(), quotationId: z.string().optional().nullable(), amount: z.number().min(0).max(1e9).optional().nullable(),
  project: z.string().max(200).optional().nullable(), service: z.string().max(120).optional().nullable(), contactName: z.string().max(120).optional().nullable(),
  startDate: z.preprocess(toDate, z.date().optional()), deliveryDate: z.preprocess(toDate, z.date().optional()), notes: z.string().max(4000).optional().nullable(),
});
/** "Convert this lead into a client?" — only with confirm: true. */
export async function POST(req: Request) {
  return robinApi(req, "client-convert", async (user) => {
    const b = schema.parse(await req.json());
    return ok(await convertToClient(user.id, b.leadId, b, "user"));
  }, 20);
}
