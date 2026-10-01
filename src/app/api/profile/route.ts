import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { normalizeTz } from "@/lib/activity/dates";
import { forgetTz } from "@/lib/activity/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  assistantName: z.string().trim().min(1).max(40).optional(),
  timezone: z.string().max(60).optional(),
  language: z.string().max(10).optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const profile = await getDb().profile.findUnique({ where: { userId: user.id } });
    return ok({ profile });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    if (body.timezone !== undefined) {
      // "IST" / "India Standard Time" → "Asia/Kolkata"; anything that isn't a timezone is refused
      const tz = normalizeTz(body.timezone);
      if (!tz) return fail(`"${body.timezone}" isn't a timezone JARVIS knows — use a name like Asia/Kolkata.`, 422);
      body.timezone = tz;
    }
    const profile = await getDb().profile.update({
      where: { userId: user.id },
      data: body,
    });
    forgetTz(user.id);
    return ok({ profile });
  } catch (err) {
    return handleError(err);
  }
}
