import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ok, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ weeklyEnabled: z.boolean().optional(), notifyEmail: z.boolean().optional(), notifyWhatsapp: z.boolean().optional() });

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const b = schema.parse(await req.json());
    const st = await getDb().tradingSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, ...b }, update: b });
    return ok({ settings: { weeklyEnabled: st.weeklyEnabled, notifyEmail: st.notifyEmail, notifyWhatsapp: st.notifyWhatsapp } });
  } catch (e) {
    return handleError(e);
  }
}
