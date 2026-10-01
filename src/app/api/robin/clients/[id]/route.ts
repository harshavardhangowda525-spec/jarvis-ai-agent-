import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi, toDate } from "@/lib/robin/http";
import { addPayment, updateClient } from "@/lib/robin/clients";
import { CLIENT_STATUSES } from "@/lib/robin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(CLIENT_STATUSES).optional(), project: z.string().max(200).nullable().optional(), contactName: z.string().max(120).nullable().optional(),
  amount: z.number().min(0).max(1e9).optional(), notes: z.string().max(4000).nullable().optional(),
  startDate: z.preprocess(toDate, z.date().nullable().optional()), deliveryDate: z.preprocess(toDate, z.date().nullable().optional()),
  payment: z.object({ amount: z.number().positive().max(1e9), paidAt: z.preprocess(toDate, z.date().optional()), method: z.string().max(40).optional().nullable(), note: z.string().max(300).optional().nullable() }).optional(),
});
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "client", async (user) => {
    const { payment, ...patch } = schema.parse(await req.json());
    if (Object.keys(patch).length) await updateClient(user.id, params.id, patch, "user");
    const p = payment ? await addPayment(user.id, params.id, payment, "user") : null;
    return ok({ payment: p });
  });
}
