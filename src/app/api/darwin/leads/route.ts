import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { LEAD_SELECT, toLeadDTO } from "@/lib/darwin/lead-dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's full lead history (never deleted), newest first.
 * Query: filter=all|no_website|no_website_phone|has_website|phone|no_phone, stage, q, ids (comma list),
 *        followups=1 (only leads with a follow-up date, soonest first), limit, cursor.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const filter = sp.get("filter") || "all";
    const stage = sp.get("stage") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const ids = sp.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const followups = sp.get("followups") === "1";
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);
    const cursor = sp.get("cursor") || undefined;

    const and: object[] = [{ userId: user.id }];
    if (filter === "no_website" || filter === "no_website_phone") and.push({ OR: [{ website: null }, { website: "" }] });
    if (filter === "no_website_phone") and.push({ phone: { not: null } }, { NOT: { phone: "" } });
    if (filter === "has_website") and.push({ website: { not: null } }, { NOT: { website: "" } });
    if (filter === "phone") and.push({ phone: { not: null } }, { NOT: { phone: "" } });
    if (filter === "no_phone") and.push({ OR: [{ phone: null }, { phone: "" }] });
    if (stage) and.push(stage === "converted" ? { stage: { in: ["converted", "won"] } } : stage === "not_interested" ? { stage: { in: ["not_interested", "lost"] } } : { stage });
    if (ids?.length) and.push({ id: { in: ids } });
    if (followups) and.push({ nextFollowUpAt: { not: null } }, { stage: { notIn: ["converted", "won", "not_interested", "lost"] } });
    if (q) {
      and.push({ OR: [
        { businessName: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { notes: { contains: q, mode: "insensitive" } },
      ] });
    }

    const db = getDb();
    const where = { AND: and };
    const [total, rows] = await Promise.all([
      db.darwinLead.count({ where }),
      db.darwinLead.findMany({
        where,
        orderBy: followups ? [{ nextFollowUpAt: "asc" }, { id: "asc" }] : [{ discoveredAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: LEAD_SELECT,
      }),
    ]);
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    return ok({ total, count: page.length, nextCursor: more ? page[page.length - 1].id : null, leads: page.map(toLeadDTO) });
  } catch (err) {
    return handleError(err);
  }
}
