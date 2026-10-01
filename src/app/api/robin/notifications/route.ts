import { z } from "zod";
import { ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { robinApi } from "@/lib/robin/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return robinApi(req, "notifications", async (user) => {
    const b = z.object({ ids: z.array(z.string()).max(100).optional() }).parse(await req.json().catch(() => ({})));
    await getDb().robinNotification.updateMany({ where: { userId: user.id, readAt: null, ...(b.ids ? { id: { in: b.ids } } : {}) }, data: { readAt: new Date() } });
    return ok({ read: true });
  });
}
