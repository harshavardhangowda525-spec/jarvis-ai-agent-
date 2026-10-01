import "server-only";
import { getDb } from "@/lib/db";
import { RobinError, audit, logRobin, moveStage, mustLead, loadSettings, type Source } from "./crm";
import { CLIENT_STATUSES, money } from "./types";

/**
 * Lead → client. Only with your confirmation. The lead row (and with it every
 * call, message, follow-up, demo, quotation, note and stage change) stays
 * linked to the client — nothing is copied away or lost.
 */
export async function convertToClient(userId: string, leadId: string, o: {
  confirm?: boolean; quotationId?: string | null; amount?: number | null; project?: string | null; service?: string | null;
  contactName?: string | null; startDate?: Date | null; deliveryDate?: Date | null; notes?: string | null;
}, source: Source) {
  const db = getDb();
  const lead = await mustLead(userId, leadId);
  const existing = await db.robinClient.findUnique({ where: { leadId: lead.id } });
  if (existing) return { client: existing, created: false };
  const quote = o.quotationId
    ? await db.robinQuotation.findFirst({ where: { id: o.quotationId, userId, leadId: lead.id }, include: { items: true } })
    : await db.robinQuotation.findFirst({ where: { userId, leadId: lead.id, status: "accepted" }, orderBy: { acceptedAt: "desc" }, include: { items: true } });
  const amount = o.amount ?? quote?.total ?? lead.potentialValue ?? null;
  if (!o.confirm) {
    throw new RobinError(`Convert ${lead.businessName} into a client${amount != null ? ` (${money(amount, quote?.currency ?? "INR")})` : ""}?`, 409, "needs_confirmation");
  }
  if (amount == null) throw new RobinError("What's the deal amount? Add an accepted quotation or type the amount.", 422, "invalid");
  const settings = await loadSettings(userId);
  if (lead.stage !== "won") await moveStage(userId, lead.id, "won", { source, confirm: true, note: quote ? `Quotation ${quote.number} accepted` : "Converted to client" });
  const client = await db.robinClient.create({
    data: {
      userId, leadId: lead.id, quotationId: quote?.id ?? null, businessName: lead.businessName, contactName: o.contactName ?? quote?.clientName ?? null,
      phone: lead.phone, email: lead.email, project: o.project ?? (quote ? quote.items.map((i) => i.service).join(" + ") : lead.serviceInterest),
      service: o.service ?? quote?.items[0]?.service ?? lead.serviceInterest, amount, currency: quote?.currency ?? settings.currency,
      startDate: o.startDate ?? new Date(), deliveryDate: o.deliveryDate ?? null, notes: o.notes ?? null,
    },
  });
  await logRobin(userId, lead.id, "client_converted", `${lead.businessName} converted into a client — ${money(amount, client.currency)}`, { clientId: client.id, amount }, 5);
  await audit(userId, "client_converted", "client", client.id, source, { leadId: lead.id, amount, quotationId: quote?.id ?? null });
  return { client, created: true };
}

async function syncPaymentStatus(clientId: string) {
  const db = getDb();
  const c = await db.robinClient.findUnique({ where: { id: clientId }, include: { payments: true } });
  if (!c) return null;
  const paid = c.payments.reduce((s, p) => s + p.amount, 0);
  const paymentStatus = paid <= 0 ? "unpaid" : paid + 0.005 >= c.amount ? "paid" : "partial";
  return db.robinClient.update({ where: { id: clientId }, data: { paymentStatus } });
}

export async function addPayment(userId: string, clientId: string, p: { amount: number; paidAt?: Date; method?: string | null; note?: string | null }, source: Source) {
  if (!(p.amount > 0)) throw new RobinError("Payment amount must be more than 0.", 422, "invalid");
  const db = getDb();
  const c = await db.robinClient.findFirst({ where: { id: clientId, userId } });
  if (!c) throw new RobinError("That client doesn't exist.", 404, "not_found");
  const row = await db.robinPayment.create({ data: { userId, clientId, amount: p.amount, paidAt: p.paidAt ?? new Date(), method: p.method ?? null, note: p.note ?? null } });
  const client = await syncPaymentStatus(clientId);
  await logRobin(userId, c.leadId, "payment", `Payment of ${money(p.amount, c.currency)} recorded from ${c.businessName}`, { clientId, paymentId: row.id }, 3);
  await audit(userId, "payment_recorded", "payment", row.id, source, { clientId, amount: p.amount });
  return { payment: row, client };
}

export async function updateClient(userId: string, clientId: string, patch: { status?: string; project?: string | null; deliveryDate?: Date | null; startDate?: Date | null; notes?: string | null; contactName?: string | null; amount?: number }, source: Source) {
  const db = getDb();
  const c = await db.robinClient.findFirst({ where: { id: clientId, userId } });
  if (!c) throw new RobinError("That client doesn't exist.", 404, "not_found");
  if (patch.status && !(CLIENT_STATUSES as readonly string[]).includes(patch.status)) throw new RobinError("Unknown client status.", 422, "invalid");
  const row = await db.robinClient.update({ where: { id: clientId }, data: patch });
  if (patch.amount != null) await syncPaymentStatus(clientId);
  if (patch.status && patch.status !== c.status) await logRobin(userId, c.leadId, "client_status", `${c.businessName} is now ${patch.status === "completed" ? "a completed project" : `${patch.status}`}`, { clientId }, 2);
  await audit(userId, "client_updated", "client", clientId, source, { fields: Object.keys(patch) });
  return row;
}

export async function listClients(userId: string) {
  const rows = await getDb().robinClient.findMany({ where: { userId }, orderBy: { convertedAt: "desc" }, include: { payments: { orderBy: { paidAt: "desc" } } } });
  return rows.map((c) => ({ ...c, paid: c.payments.reduce((s, p) => s + p.amount, 0) }));
}
