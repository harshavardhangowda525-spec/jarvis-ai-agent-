import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { cancelFollowUp, completeFollowUp } from "@/lib/robin/engage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["complete", "cancel"]), notes: z.string().max(2000).optional().nullable(), source: z.enum(["user", "voice"]).optional() });
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "followup", async (user) => {
    const b = schema.parse(await req.json());
    const row = b.action === "complete" ? await completeFollowUp(user.id, params.id, { notes: b.notes }, b.source ?? "user") : await cancelFollowUp(user.id, params.id, b.source ?? "user");
    // "Follow-up completed. Would you like to schedule the next one?"
    return ok({ followUp: row, askNext: b.action === "complete" });
  });
}
