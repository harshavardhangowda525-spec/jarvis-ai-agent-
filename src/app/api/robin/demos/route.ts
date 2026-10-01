import { z } from "zod";
import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { robinApi, toDate } from "@/lib/robin/http";
import { scheduleDemo } from "@/lib/robin/engage";
import { DEMO_TYPES } from "@/lib/robin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return robinApi(req, "demos", async (user) => ok({
    demos: await getDb().robinDemo.findMany({ where: { userId: user.id }, orderBy: { scheduledAt: "desc" }, take: 200, include: { lead: { select: { id: true, businessName: true, category: true } } } }),
  }));
}
const schema = z.object({ leadId: z.string().min(1), at: z.preprocess(toDate, z.date()), demoType: z.enum(DEMO_TYPES).optional(), notes: z.string().max(2000).optional().nullable(), source: z.enum(["user", "voice"]).optional() });
export async function POST(req: Request) {
  return robinApi(req, "demo-create", async (user) => {
    const b = schema.parse(await req.json());
    return ok(await scheduleDemo(user.id, b.leadId, b, b.source ?? "user"));
  });
}
