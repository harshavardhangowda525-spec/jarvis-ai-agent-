import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { decideQuotation, getQuotation, sendQuotation } from "@/lib/robin/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "quotation", async (user) => ok(await getQuotation(user.id, params.id)));
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), via: z.enum(["manual", "gmail"]), confirm: z.boolean().optional(), to: z.string().email().optional().nullable(), message: z.string().max(4000).optional().nullable() }),
  z.object({ action: z.literal("accept"), confirm: z.boolean().optional(), note: z.string().max(300).optional().nullable() }),
  z.object({ action: z.literal("reject"), confirm: z.boolean().optional(), note: z.string().max(300).optional().nullable() }),
]);
/** Send (yourself, or by Gmail after you confirm), accepted / rejected (you confirm). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "quotation-patch", async (user) => {
    const b = schema.parse(await req.json());
    if (b.action === "send") return ok({ quote: await sendQuotation(user.id, params.id, b, "user") });
    return ok(await decideQuotation(user.id, params.id, b.action === "accept" ? "accepted" : "rejected", b, "user"));
  }, 20);
}
