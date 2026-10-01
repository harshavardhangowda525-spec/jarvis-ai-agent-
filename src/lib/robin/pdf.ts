import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { money, type RobinSettings } from "./types";

/**
 * A clean, professional A4 quotation PDF built from the real quotation record.
 * Uses the bundled Inter font (it has the ₹ sign). Nothing in it is invented:
 * empty company details are simply left out.
 */

export interface QuotePdfInput {
  number: string;
  createdAt: Date;
  validUntil: Date | null;
  status: string;
  currency: string;
  businessName: string;
  clientName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  items: { service: string; description: string | null; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number;
  discount: number;
  taxPct: number;
  taxAmount: number;
  total: number;
  paymentTerms: string | null;
  notes: string | null;
  company: Pick<RobinSettings, "companyName" | "companyPhone" | "companyEmail" | "companyAddress">;
}

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
function fonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  fontCache = { regular: fs.readFileSync(path.join(dir, "Inter-Medium.ttf")), bold: fs.readFileSync(path.join(dir, "InterDisplay-ExtraBold.ttf")) };
  return fontCache;
}

const INK = rgb(0.07, 0.09, 0.12);
const MUTED = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.86, 0.88, 0.91);
const ACCENT = rgb(0.05, 0.55, 0.78);

export async function quotationPdf(q: QuotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = fonts();
  const reg = await doc.embedFont(f.regular, { subset: true });
  const bold = await doc.embedFont(f.bold, { subset: true });
  doc.setTitle(`Quotation ${q.number} — ${q.businessName}`);
  doc.setAuthor(q.company.companyName || "ROBIN");
  doc.setCreator("JARVIS · ROBIN");

  const W = 595.28, H = 841.89, M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, font: PDFFont = reg, color = INK) => p.drawText(s, { x, y: yy, size, font, color });
  const right = (p: PDFPage, s: string, xr: number, yy: number, size: number, font: PDFFont = reg, color = INK) => text(p, s, xr - font.widthOfTextAtSize(s, size), yy, size, font, color);
  const wrap = (s: string, font: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of s.split(/\n/)) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const next = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = w; } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const fmt = (v: number) => money(v, q.currency);
  const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const ensure = (need: number) => { if (y - need < M + 40) { page = doc.addPage([W, H]); y = H - M; } };

  // header band
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: ACCENT });
  text(page, q.company.companyName || "Quotation", M, y - 6, 20, bold);
  right(page, "QUOTATION", W - M, y - 4, 22, bold, ACCENT);
  y -= 26;
  for (const line of [q.company.companyAddress, q.company.companyPhone, q.company.companyEmail].filter(Boolean) as string[]) {
    for (const l of wrap(line, reg, 9, 260)) { text(page, l, M, y, 9, reg, MUTED); y -= 12; }
  }
  let ry = H - M - 30;
  for (const [k, v] of [["No.", q.number], ["Date", day(q.createdAt)], ...(q.validUntil ? [["Valid until", day(q.validUntil)]] : [])] as [string, string][]) {
    right(page, v, W - M, ry, 10, bold); right(page, k, W - M - 110, ry, 9, reg, MUTED); ry -= 14;
  }
  y = Math.min(y, ry) - 18;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 22;

  // client
  text(page, "PREPARED FOR", M, y, 8, bold, MUTED); y -= 15;
  text(page, q.businessName, M, y, 13, bold); y -= 15;
  for (const line of [q.clientName ? `Attn: ${q.clientName}` : null, q.address, q.phone, q.email].filter(Boolean) as string[]) {
    for (const l of wrap(line, reg, 9.5, W - 2 * M)) { text(page, l, M, y, 9.5, reg, MUTED); y -= 13; }
  }
  y -= 14;

  // items table
  const cols = { svc: M, qty: W - M - 210, unit: W - M - 110, amt: W - M };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: rgb(0.95, 0.96, 0.98) });
    text(page, "SERVICE", cols.svc + 8, y + 1, 8, bold, MUTED);
    right(page, "QTY", cols.qty + 30, y + 1, 8, bold, MUTED);
    right(page, "UNIT PRICE", cols.unit + 50, y + 1, 8, bold, MUTED);
    right(page, "AMOUNT", cols.amt - 8, y + 1, 8, bold, MUTED);
    y -= 26;
  };
  header();
  for (const it of q.items) {
    const desc = it.description ? wrap(it.description, reg, 8.5, cols.qty - cols.svc - 30) : [];
    ensure(22 + desc.length * 11);
    if (y > H - M - 5) header();
    text(page, it.service, cols.svc + 8, y, 10.5, bold);
    right(page, String(it.quantity), cols.qty + 30, y, 10);
    right(page, fmt(it.unitPrice), cols.unit + 50, y, 10);
    right(page, fmt(it.amount), cols.amt - 8, y, 10, bold);
    y -= 13;
    for (const l of desc) { text(page, l, cols.svc + 8, y, 8.5, reg, MUTED); y -= 11; }
    y -= 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  // totals
  ensure(110);
  const tx = W - M - 220;
  const row = (k: string, v: string, strong = false) => {
    text(page, k, tx, y, strong ? 11 : 9.5, strong ? bold : reg, strong ? INK : MUTED);
    right(page, v, W - M - 8, y, strong ? 13 : 10, strong ? bold : reg, strong ? ACCENT : INK);
    y -= strong ? 22 : 15;
  };
  y -= 4;
  row("Subtotal", fmt(q.subtotal));
  if (q.discount) row("Discount", `− ${fmt(q.discount)}`);
  if (q.taxPct) row(`Tax (${q.taxPct}%)`, fmt(q.taxAmount));
  page.drawLine({ start: { x: tx, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.8, color: LINE });
  y -= 4;
  row("TOTAL", fmt(q.total), true);
  y -= 8;

  for (const [title, body] of [["PAYMENT TERMS", q.paymentTerms], ["NOTES", q.notes]] as [string, string | null][]) {
    if (!body) continue;
    const lines = wrap(body, reg, 9.5, W - 2 * M);
    ensure(24 + lines.length * 13);
    text(page, title, M, y, 8, bold, MUTED); y -= 14;
    for (const l of lines) { text(page, l, M, y, 9.5); y -= 13; }
    y -= 10;
  }

  // footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 6 }, end: { x: W - M, y: M - 6 }, thickness: 0.5, color: LINE });
    text(p, `${q.company.companyName || ""}${q.company.companyName ? " · " : ""}Quotation ${q.number}`, M, M - 20, 8, reg, MUTED);
    right(p, `Page ${i + 1} of ${pages.length}`, W - M, M - 20, 8, reg, MUTED);
  });
  return doc.save();
}
