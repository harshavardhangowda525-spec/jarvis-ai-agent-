import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi, toDate } from "@/lib/robin/http";
import { followUpQueue, scheduleFollowUp } from "@/lib/robin/engage";
import { FOLLOWUP_ACTIONS } from "@/lib/robin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return robinApi(req, "followups", async (user) => ok(await followUpQueue(user.id)));
}

const schema = z.object({
  leadId: z.string().min(1),
  dueAt: z.preprocess(toDate, z.date()),
  action: z.enum(FOLLOWUP_ACTIONS).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  source: z.enum(["user", "voice"]).optional(),
});
export async function POST(req: Request) {
  return robinApi(req, "followup-create", async (user) => {
    const b = schema.parse(await req.json());
    return ok(await scheduleFollowUp(user.id, b.leadId, b, b.source ?? "user"));
  });
}
