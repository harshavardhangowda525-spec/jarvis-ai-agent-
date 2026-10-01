import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi, toDate } from "@/lib/robin/http";
import { updateDemo } from "@/lib/robin/engage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["completed", "cancelled", "rescheduled"]), at: z.preprocess(toDate, z.date().optional()), notes: z.string().max(2000).optional().nullable(), source: z.enum(["user", "voice"]).optional() });
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "demo", async (user) => {
    const b = schema.parse(await req.json());
    return ok(await updateDemo(user.id, params.id, b, b.source ?? "user"));
  });
}
