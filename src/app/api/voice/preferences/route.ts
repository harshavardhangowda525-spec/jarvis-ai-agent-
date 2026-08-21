import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";

const patchSchema = z.object({
  voiceId: z.string().max(80).nullable().optional(),
  voiceEnabled: z.boolean().optional(),
  autoListen: z.boolean().optional(),
  speakingRate: z.number().min(0.5).max(2).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    const pref = await getDb().voicePreference.upsert({
      where: { userId: user.id },
      update: body,
      create: { userId: user.id, ...body },
    });
    return ok({ preferences: pref });
  } catch (err) {
    return handleError(err);
  }
}
