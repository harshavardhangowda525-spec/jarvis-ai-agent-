import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi, toDate } from "@/lib/robin/http";
import { logInteraction } from "@/lib/robin/engage";
import { CHANNELS, CALL_OUTCOMES } from "@/lib/robin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  channel: z.enum(CHANNELS),
  direction: z.enum(["outbound", "inbound"]).optional(),
  // calls: one of the call outcomes; messages: replied | no_reply | sent
  outcome: z.union([z.enum(CALL_OUTCOMES), z.enum(["replied", "no_reply", "sent"])]).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  occurredAt: z.preprocess(toDate, z.date().optional()),
  followUp: z.object({ dueAt: z.preprocess(toDate, z.date()), action: z.string().max(20).optional(), notes: z.string().max(2000).optional().nullable(), priority: z.enum(["high", "medium", "low"]).optional() }).optional().nullable(),
  source: z.enum(["user", "voice"]).optional(),
});

/** You record how a call / WhatsApp / DM / email went. (Opening the app records nothing.) */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "interaction", async (user) => {
    const b = schema.parse(await req.json());
    // a message you logged yourself is "logged" — never "delivered" (no API confirmed it)
    const r = await logInteraction(user.id, params.id, { ...b, status: b.direction === "inbound" ? "received" : "logged" }, b.source ?? "user");
    return ok(r);
  });
}
