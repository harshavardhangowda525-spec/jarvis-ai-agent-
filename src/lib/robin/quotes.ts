import "server-only";
import { getDb } from "@/lib/db";
import { getGoogleAccessToken } from "@/lib/integrations/google";
import { emailChannelReady } from "@/lib/darwin/email";
import { RobinError, advanceTo, audit, loadSettings, logRobin, mustLead, listServices, type Source } from "./crm";
import { quotationPdf } from "./pdf";
import { money } from "./types";

/**
 * Quotations. Prices come from YOUR services list (Settings) or what you type —
 * Rubin never invents a price. Sending, accepting and converting are your
 * decisions: Rubin prepares, you confirm.
 */

export interface QuoteItemInput { service: string; description?: string | null; quantity?: number; unitPrice?: number | null }
export interface QuoteInput {
  items: QuoteItemInput[];
  discount?: number;
  taxPct?: number;
  validityDays?: number;
  paymentTerms?: string | null;
  notes?: string | null;
  clientName?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function totals(items: { quantity: number; unitPrice: number }[], discount = 0, taxPct = 0) {
  const subtotal = round2(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const d = round2(Math.min(Math.max(discount, 0), subtotal));
  const taxable = subtotal - d;
  const taxAmount = round2((taxable * Math.max(taxPct, 0)) / 100);
  return { subtotal, discount: d, taxAmount, total: round2(taxable + taxAmount) };
}

async function nextNumber(userId: string, now: Date) {
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await getDb().robinQuotation.count({ where: { userId, number: { startsWith: `Q-${ym}-` } } });
  return (n: number) => `Q-${ym}-${String(count + 1 + n).padStart(3, "0")}`;
}

export async function createQuotation(userId: string, leadId: string, q: QuoteInput, source: Source) {
  const lead = await mustLead(userId, leadId);
  if (!q.items?.length) throw new RobinError("Add at least one service to the quotation.", 422, "invalid");
  const [settings, services] = await Promise.all([loadSettings(userId), listServices(userId)]);
  const items = q.items.map((it, position) => {
    const svc = services.find((s) => s.name.toLowerCase() === it.service.trim().toLowerCase());
    const unitPrice = it.unitPrice ?? svc?.price ?? null;
    if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new RobinError(`No price for "${it.service}" — type one, or set it under Rubin → Settings → Services.`, 422, "invalid");
    }
    const quantity = Math.max(0.01, Number(it.quantity ?? 1));
    return { service: (svc?.name ?? it.service).trim().slice(0, 120), description: (it.description ?? svc?.description ?? null)?.slice(0, 1000) ?? null, quantity, unitPrice: round2(unitPrice), amount: round2(quantity * unitPrice), position };
  });
  const taxPct = q.taxPct ?? settings.taxPct;
  const t = totals(items, q.discount ?? 0, taxPct);
  const now = new Date();
  const validUntil = new Date(now.getTime() + Math.max(1, q.validityDays ?? settings.quoteValidityDays) * 86_400_000);
  const db = getDb();
  const numberAt = await nextNumber(userId, now);
  let quote = null;
  for (let n = 0; n < 5 && !quote; n++) {
    try {
      quote = await db.robinQuotation.create({
        data: {
          userId, leadId: lead.id, number: numberAt(n), clientName: q.clientName ?? null, currency: settings.currency,
          subtotal: t.subtotal, discount: t.discount, taxPct, taxAmount: t.taxAmount, total: t.total, validUntil,
          paymentTerms: q.paymentTerms ?? settings.paymentTerms, notes: q.notes ?? null,
          items: { create: items },
        },
        include: { items: { orderBy: { position: "asc" } } },
      });
    } catch (e) { if (!/Unique constraint/i.test(String((e as Error).message))) throw e; }
  }
  if (!quote) throw new RobinError("Couldn't number the quotation — try again.", 500);
  await db.robinLead.update({ where: { id: lead.id }, data: { potentialValue: t.total, serviceInterest: lead.serviceInterest ?? items.map((i) => i.service).join(", ").slice(0, 120) } });
  await logRobin(userId, lead.id, "quotation_created", `Quotation ${quote.number} prepared for ${lead.businessName} — ${money(t.total, settings.currency)}`, { quotationId: quote.id, total: t.total }, 3);
  await audit(userId, "quotation_created", "quotation", quote.id, source, { total: t.total, items: items.length });
  return quote;
}

export async function getQuotation(userId: string, id: string) {
  const q = await getDb().robinQuotation.findFirst({ where: { id, userId }, include: { items: { orderBy: { position: "asc" } }, lead: true } });
  if (!q) throw new RobinError("That quotation doesn't exist.", 404, "not_found");
  return q;
}

export async function renderQuotationPdf(userId: string, id: string) {
  const [q, s] = await Promise.all([getQuotation(userId, id), loadSettings(userId)]);
  const bytes = await quotationPdf({
    number: q.number, createdAt: q.createdAt, validUntil: q.validUntil, status: q.status, currency: q.currency,
    businessName: q.lead.businessName, clientName: q.clientName, address: q.lead.address, phone: q.lead.phone, email: q.lead.email,
    items: q.items, subtotal: q.subtotal, discount: q.discount, taxPct: q.taxPct, taxAmount: q.taxAmount, total: q.total,
    paymentTerms: q.paymentTerms, notes: q.notes, company: s,
  });
  return { bytes, filename: `${q.number}-${q.lead.businessName.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}.pdf`, quote: q };
}

/**
 * Mark a quotation as sent. `via: "manual"` = you sent it yourself (WhatsApp,
 * in person…). `via: "gmail"` = Rubin emails the PDF from your Gmail — only with
 * `confirm: true`, and it's "sent" only when Gmail returns a message id.
 */
export async function sendQuotation(userId: string, id: string, o: { via: "manual" | "gmail"; confirm?: boolean; to?: string | null; message?: string | null }, source: Source) {
  const db = getDb();
  const q = await getQuotation(userId, id);
  if (["accepted", "rejected"].includes(q.status)) throw new RobinError(`This quotation is already ${q.status}.`, 409, "invalid");
  let externalId: string | null = null;
  if (o.via === "gmail") {
    const to = (o.to ?? q.lead.email ?? "").trim();
    if (!to) throw new RobinError(`${q.lead.businessName} has no email address.`, 422, "invalid");
    if (!o.confirm) throw new RobinError(`Ready to email quotation ${q.number} to ${to}?`, 409, "needs_confirmation");
    if (!(await emailChannelReady(userId))) throw new RobinError("Gmail isn't connected — connect Google in Settings → Integrations, or mark it as sent yourself.", 409, "invalid");
    const s = await loadSettings(userId);
    const { bytes, filename } = await renderQuotationPdf(userId, id);
    const body = o.message?.trim() || `Hello${q.clientName ? ` ${q.clientName}` : ""},\n\nPlease find attached our quotation ${q.number} for ${q.lead.businessName} (${money(q.total, q.currency)}${q.validUntil ? `, valid until ${q.validUntil.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}).\n\nHappy to answer any questions.\n\n${s.companyName}${s.companyPhone ? `\n${s.companyPhone}` : ""}`;
    externalId = await gmailWithAttachment(userId, to, `Quotation ${q.number} — ${s.companyName}`, body, filename, bytes);
    await db.robinInteraction.create({ data: { userId, leadId: q.leadId, channel: "email", status: "sent", subject: `Quotation ${q.number}`, notes: body.slice(0, 4000), externalId } });
    await db.robinLead.update({ where: { id: q.leadId }, data: { lastContactAt: new Date() } });
  }
  const row = await db.robinQuotation.update({ where: { id }, data: { status: "sent", sentAt: new Date() } });
  await advanceTo(userId, q.lead, "quotation_sent", source, `Quotation ${q.number} sent`);
  await logRobin(userId, q.leadId, "quotation_sent", `Quotation ${q.number} sent to ${q.lead.businessName}${o.via === "gmail" ? " by email (Gmail confirmed)" : ""}`, { quotationId: id, via: o.via, externalId }, 3);
  await audit(userId, "quotation_sent", "quotation", id, source, { via: o.via, externalId });
  return row;
}

/** Accepting is the client's decision that YOU record — it needs confirmation. Then Rubin offers to convert. */
export async function decideQuotation(userId: string, id: string, decision: "accepted" | "rejected", o: { confirm?: boolean; note?: string | null }, source: Source) {
  const db = getDb();
  const q = await getQuotation(userId, id);
  if (q.status === decision) return { quote: q, convertSuggested: decision === "accepted" };
  if (!o.confirm) throw new RobinError(decision === "accepted" ? `Mark quotation ${q.number} (${money(q.total, q.currency)}) as accepted by ${q.lead.businessName}?` : `Mark quotation ${q.number} as rejected?`, 409, "needs_confirmation");
  const row = await db.robinQuotation.update({ where: { id }, data: decision === "accepted" ? { status: "accepted", acceptedAt: new Date() } : { status: "rejected", rejectedAt: new Date() }, include: { items: true, lead: true } });
  if (decision === "accepted") await advanceTo(userId, q.lead, "negotiating", source, `Quotation ${q.number} accepted`);
  await logRobin(userId, q.leadId, `quotation_${decision}`, `Quotation ${q.number} ${decision} by ${q.lead.businessName}${o.note ? ` — ${o.note}` : ""}`, { quotationId: id }, decision === "accepted" ? 4 : 3);
  await audit(userId, `quotation_${decision}`, "quotation", id, source, { note: o.note ?? null });
  return { quote: row, convertSuggested: decision === "accepted" };
}

/** Quotations past their validity (still "sent") become "expired". */
export async function expireQuotations(userId: string, now = new Date()) {
  const r = await getDb().robinQuotation.updateMany({ where: { userId, status: "sent", validUntil: { lt: now } }, data: { status: "expired" } });
  return r.count;
}

/** RFC 2047 for non-ASCII subjects (₹, accents). */
const encSubject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

async function gmailWithAttachment(userId: string, to: string, subject: string, body: string, filename: string, pdf: Uint8Array): Promise<string> {
  const token = await getGoogleAccessToken(userId);
  const boundary = `robin_${Math.random().toString(36).slice(2)}`;
  const b64 = Buffer.from(pdf).toString("base64").replace(/.{76}/g, "$&\r\n");
  const mime = [
    `To: ${to}`, `Subject: ${encSubject(subject)}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", body, "",
    `--${boundary}`, `Content-Type: application/pdf; name="${filename}"`, `Content-Disposition: attachment; filename="${filename}"`, "Content-Transfer-Encoding: base64", "", b64, "",
    `--${boundary}--`, "",
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }), signal: AbortSignal.timeout(25_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) throw new RobinError(json?.error?.message || `Gmail didn't send it (HTTP ${res.status}).`, 502);
  return json.id;
}
