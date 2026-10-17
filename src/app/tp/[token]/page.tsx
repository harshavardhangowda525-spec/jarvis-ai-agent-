import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { planSections, type Plan } from "@/lib/plans/schema";
import { Teleprompter } from "@/components/aston/teleprompter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teleprompter — ASTON", robots: { index: false, follow: false } };

/**
 * A saved daily plan opened from its share link (the link in the "plan ready"
 * message). The link is unguessable and can be revoked or replaced from
 * JARVIS; a plan never contains customer data.
 */
export default async function SharedTeleprompter({ params }: { params: { token: string } }) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.token)) notFound();
  const p = await getDb().marketingPlan.findUnique({ where: { shareToken: params.token } });
  if (!p || p.shareRevokedAt || p.status !== "ready" || !p.plan) notFound();
  const day = new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return <Teleprompter sections={planSections(p.plan as unknown as Plan)} heading={`ASTON · ${p.niche}`} sub={`Daily marketing plan — ${day}`} />;
}
