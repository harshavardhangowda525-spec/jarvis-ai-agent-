import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { listSources } from "@/lib/darwin/sources";
import { emailChannelReady } from "@/lib/darwin/email";
import { DARWIN_STAGES } from "@/lib/darwin/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Real DARWIN dashboard data — sources, pipeline, follow-ups, activity, approvals. */
export async function GET() {
  try {
    const user = await requireUser();
    const db = getDb();
    const now = new Date();

    const [leads, dueFollowUps, recentActivity, pendingApprovals, emailReady] = await Promise.all([
      db.darwinLead.findMany({
        where: { userId: user.id },
        select: { stage: true, source: true, website: true, phone: true, email: true, verifiedFields: true, opportunityType: true, leadScore: true },
      }),
      db.darwinFollowUp.findMany({
        where: { userId: user.id, status: "pending", dueAt: { lte: now } },
        select: { id: true }, take: 200,
      }),
      db.darwinActivity.findMany({
        where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 18,
        select: { id: true, type: true, detail: true, createdAt: true },
      }),
      db.darwinMessage.count({ where: { userId: user.id, status: "approval_required" } }),
      emailChannelReady(user.id).catch(() => false),
    ]);

    const byStage: Record<string, number> = {};
    for (const s of DARWIN_STAGES) byStage[s] = 0;
    const bySource: Record<string, number> = {};

    // Intelligence stats — derived from REAL leads only.
    const WEAK = new Set(["outdated_website", "weak_digital_presence", "website_redesign", "poor_mobile"]);
    let noWebsite = 0, weakWebsite = 0, highPotential = 0, contactable = 0, verified = 0;
    for (const l of leads) {
      byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
      bySource[l.source] = (bySource[l.source] ?? 0) + 1;
      if (!l.website) noWebsite++;
      if (l.opportunityType && WEAK.has(l.opportunityType)) weakWebsite++;
      if (typeof l.leadScore === "number" && l.leadScore >= 70) highPotential++;
      if (l.phone || l.email) contactable++;
      const vf = new Set(l.verifiedFields ?? []);
      if (vf.has("phone") || vf.has("email") || vf.has("website")) verified++;
    }

    const sources = listSources().map((s) => ({ ...s }));
    const hasData = leads.length > 0;
    const hasConnectedDiscovery = sources.some((s) => s.kind === "api" && s.connected);

    return ok({
      hasData,
      hasConnectedDiscovery,
      emailReady,
      totals: { leads: leads.length, dueFollowUps: dueFollowUps.length, pendingApprovals },
      intelligence: {
        businessesFound: leads.length,
        verifiedLeads: verified,
        noWebsite,
        weakWebsite,
        highPotential,
        contactable,
      },
      byStage,
      bySource,
      sources,
      recentActivity,
    });
  } catch (err) {
    return handleError(err);
  }
}
