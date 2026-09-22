import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Real leads for the DARWIN lead explorer. Query: stage, source, q, limit. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get("stage") || undefined;
    const source = searchParams.get("source") || undefined;
    const q = searchParams.get("q") || undefined;
    const limit = Math.min(Number(searchParams.get("limit")) || 60, 200);

    const leads = await getDb().darwinLead.findMany({
      where: {
        userId: user.id,
        ...(stage ? { stage } : {}),
        ...(source ? { source } : {}),
        ...(q
          ? { OR: [
              { businessName: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { location: { contains: q, mode: "insensitive" } },
            ] }
          : {}),
      },
      orderBy: { discoveredAt: "desc" },
      take: limit,
      select: {
        id: true, businessName: true, category: true, location: true, website: true, phone: true, email: true,
        instagram: true, source: true, sourceUrl: true, stage: true, opportunityType: true, leadScore: true,
        verifiedFields: true, aiAnalysis: true, nextFollowUpAt: true, discoveredAt: true, lastVerifiedAt: true,
      },
    });
    return ok({ count: leads.length, leads });
  } catch (err) {
    return handleError(err);
  }
}
