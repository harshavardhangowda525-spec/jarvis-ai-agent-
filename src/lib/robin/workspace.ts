import "server-only";
import { getDb } from "@/lib/db";
import { explain } from "./qualify";
import { instagramLink, mustLead, telLink, whatsappLink, loadSettings } from "./crm";
import type { Priority } from "./types";

/** Everything about one lead: details, qualification (with reasons), sales state, and the full timeline. */
export async function leadWorkspace(userId: string, leadId: string) {
  const db = getDb();
  const lead = await mustLead(userId, leadId);
  const [scores, stageChanges, activities, interactions, followUps, demos, quotations, client, settings] = await Promise.all([
    db.robinLeadScore.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.robinStageChange.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } }),
    db.robinActivity.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.robinInteraction.findMany({ where: { leadId }, orderBy: { occurredAt: "desc" } }),
    db.robinFollowUp.findMany({ where: { leadId }, orderBy: { dueAt: "desc" } }),
    db.robinDemo.findMany({ where: { leadId }, orderBy: { scheduledAt: "desc" } }),
    db.robinQuotation.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, include: { items: { orderBy: { position: "asc" } } } }),
    db.robinClient.findUnique({ where: { leadId }, include: { payments: { orderBy: { paidAt: "desc" } } } }),
    loadSettings(userId),
  ]);
  const reasons = (lead.reasons ?? []) as { label: string; points: number }[];
  const pendingFU = followUps.filter((f) => f.status === "pending").sort((a, b) => +a.dueAt - +b.dueAt)[0] ?? null;
  const nextDemo = demos.filter((d) => ["scheduled", "rescheduled"].includes(d.status) && d.scheduledAt > new Date()).sort((a, b) => +a.scheduledAt - +b.scheduledAt)[0] ?? null;
  return {
    lead,
    currency: settings.currency,
    links: { call: telLink(lead), whatsapp: whatsappLink(lead), instagram: instagramLink(lead), email: lead.email ? `mailto:${lead.email}` : null, maps: lead.mapsUrl, website: lead.website },
    qualification: { priority: lead.priority, override: lead.priorityOverride, score: lead.score, reasons, explanation: explain({ priority: lead.priority as Priority, reasons }), history: scores },
    sales: {
      stage: lead.stage, lastContactAt: lead.lastContactAt, nextFollowUp: pendingFU, nextDemo, potentialValue: lead.potentialValue ?? quotations[0]?.total ?? null,
      assignedTo: lead.assignedTo, latestQuotation: quotations[0] ?? null,
    },
    stageChanges, activities, interactions, followUps, demos, quotations, client,
  };
}
export type LeadWorkspace = Awaited<ReturnType<typeof leadWorkspace>>;
