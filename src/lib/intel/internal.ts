import "server-only";
import { getDb } from "@/lib/db";

/**
 * Internal metrics from JARVIS's own records (RUBIN's CRM, DARWIN's leads,
 * ASTON's projects). Counts only — every number is a database count for the
 * stated window. Kept off the command center's main view.
 */
export async function internalSnapshot(userId: string, now = new Date()) {
  const db = getDb();
  const d7 = new Date(now.getTime() - 7 * 86_400_000), d30 = new Date(now.getTime() - 30 * 86_400_000);
  const [leadsByStage, newLeads7, clientsActive, quotesOpen, quotesAccepted30, payments30, darwin7, aston30] = await Promise.all([
    db.robinLead.groupBy({ by: ["stage"], where: { userId }, _count: { _all: true } }),
    db.robinLead.count({ where: { userId, createdAt: { gte: d7 } } }),
    db.robinClient.count({ where: { userId, status: "active" } }),
    db.robinQuotation.count({ where: { userId, status: "sent" } }),
    db.robinQuotation.count({ where: { userId, status: "accepted", acceptedAt: { gte: d30 } } }),
    db.robinPayment.aggregate({ where: { userId, paidAt: { gte: d30 } }, _sum: { amount: true }, _count: { _all: true } }),
    db.darwinLead.count({ where: { userId, createdAt: { gte: d7 } } }).catch(() => null),
    db.astonProject.count({ where: { userId, createdAt: { gte: d30 } } }).catch(() => null),
  ]);
  return {
    asOf: now.toISOString(),
    leadsByStage: Object.fromEntries(leadsByStage.map((g) => [g.stage, g._count._all])),
    leadsTotal: leadsByStage.reduce((a, g) => a + g._count._all, 0),
    newLeads7d: newLeads7,
    activeClients: clientsActive,
    quotationsAwaiting: quotesOpen,
    quotationsAccepted30d: quotesAccepted30,
    payments30d: { count: payments30._count._all, amount: payments30._sum.amount ?? 0 },
    darwinLeads7d: darwin7,
    websiteProjects30d: aston30,
  };
}
export type InternalSnapshot = Awaited<ReturnType<typeof internalSnapshot>>;
