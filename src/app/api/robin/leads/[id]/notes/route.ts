import { z } from "zod";
import { ok } from "@/lib/api";
import { robinApi } from "@/lib/robin/http";
import { addFollowUpNote } from "@/lib/robin/engage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A note you told Robin about this lead — on its next follow-up, or on the lead when none is scheduled. */
const schema = z.object({ text: z.string().trim().min(1).max(1000), source: z.enum(["user", "voice"]).optional() });
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return robinApi(req, "lead-note", async (user) => {
    const b = schema.parse(await req.json());
    return ok(await addFollowUpNote(user.id, { leadId: params.id, text: b.text }, b.source ?? "user"));
  });
}
