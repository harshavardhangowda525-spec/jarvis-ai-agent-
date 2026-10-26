import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { CATEGORIES } from "@/lib/intel/topics";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const topic = z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(80), query: z.string().min(2).max(200), category: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]), on: z.boolean() });
const schema = z.object({
  topics: z.array(topic).max(40).optional(),
  weights: z.object({ relevance: z.number().min(0).max(1), urgency: z.number().min(0).max(1), evidence: z.number().min(0).max(1), recency: z.number().min(0).max(1) }).optional(),
  dailyEnabled: z.boolean().optional(), weeklyEnabled: z.boolean().optional(), notifyEmail: z.boolean().optional(), notifyWhatsapp: z.boolean().optional(),
});

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const b = schema.parse(await req.json());
    const data = { ...b, topics: b.topics as Prisma.InputJsonValue | undefined };
    await getDb().intelSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}
