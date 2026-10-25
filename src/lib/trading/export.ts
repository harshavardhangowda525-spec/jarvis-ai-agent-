import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { WeekMetrics, WeekRow } from "./analyze";
import type { Narrative } from "./narrative";

/** CSV and PDF exports of one weekly review — the stored figures, nothing recomputed or added. */

type Report = { label: string; weekStart: string; weekEnd: string; revision: number; generatedAt: string | null; metrics: (WeekMetrics & { history: WeekRow[] }) | null; narrative: Narrative | null; source: { kind: string; fetchedAt: string; asOf: string | null } | null };

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (xs: unknown[]) => xs.map(cell).join(",");
const nd = (v: number | null | undefined) => (v == null ? "no data" : v);

export function reportCsv(r: Report): string {
  const m = r.metrics;
  if (!m) return row(["No figures in this report", r.label]);
  const out: string[] = [];
  out.push(row(["JARVIS · MIKE weekly trading review", r.label, `revision ${r.revision}`, `generated ${r.generatedAt ?? ""}`]));
  out.push(row(["Data source", r.source?.kind ?? "", `read ${r.source?.fetchedAt ?? ""}`]));
  out.push(row([m.labels.backtest]), row([m.labels.paper]), "");
  out.push(row(["Summary", "Backtest runs", "Backtest trades", "Paper sessions", "Paper trades", "Journal entries", "Lessons completed", "Discipline score", "Rule adherence"]));
  out.push(row(["", m.backtests.runs, m.backtests.trades, m.paper.sessions, m.paper.trades, m.journal.entries, m.learning.lessonsThisWeek.length, nd(m.discipline.score), nd(m.discipline.ruleAdherence)]), "");
  out.push(row(["Strategy", "Data", "Backtest trades", "BT win rate", "BT avg R", "BT net", "BT max DD", "Out-of-sample trades", "Paper trades", "Paper win rate", "Paper avg R", "Paper net", "Verdict"]));
  for (const s of m.strategies) out.push(row([`${s.letter} ${s.name}`, s.status === "insufficient" ? "Insufficient data" : s.status === "none" ? "No data" : "OK", s.backtest.trades, nd(s.backtest.winRate), nd(s.backtest.avgR), nd(s.backtest.net), nd(s.backtest.maxDrawdown), s.outOfSample?.trades ?? 0, s.paper.trades, nd(s.paper.winRate), nd(s.paper.avgR), nd(s.paper.net), s.verdict]));
  out.push("", row(["Risk finding", "Severity", "Count", "Evidence date", "Source", "Record", "Detail"]));
  for (const f of m.risk.findings) for (const e of f.evidence) out.push(row([f.rule, f.severity, f.count, e.date, e.source, e.ref, e.detail]));
  if (!m.risk.findings.length) out.push(row([m.risk.clean === null ? "Nothing to audit" : "No findings"]));
  out.push("", row(["Backtest run", "Saved", "Strategy", "ETF", "Interval", "Period", "Trades", "Net", "Win rate", "Avg R", "Out-of-sample trades", "Warnings"]));
  for (const b of m.backtests.list) out.push(row([b.id, b.createdAt, b.strategy, b.symbol, b.interval, b.period, b.trades, nd(b.net), nd(b.winRate), nd(b.avgR), b.testTrades, b.warnings.join(" | ")]));
  out.push("", row(["Paper session", "Started", "Replayed day", "Strategy", "ETFs", "Trades", "Net", "Day locked", "Violations"]));
  for (const p of m.paper.list) out.push(row([p.id, p.startedOn, p.replayedDay, p.strategy, p.symbols.join(" "), p.trades, nd(p.net), p.dayLocked, p.violations]));
  out.push("", row(["Day", "Backtest runs", "Backtest trades", "Paper sessions", "Paper trades", "Journal entries", "Lessons", "Workflow steps"]));
  for (const a of m.activity) out.push(row([a.date, a.backtestRuns, a.backtestTrades, a.paperSessions, a.paperTrades, a.journalEntries, a.lessons, a.workflowSteps]));
  out.push("", row(["Week", "Backtest trades", "Paper trades", "Journal entries", "Lessons", "Win rate", "Avg R", "Net", "Discipline", "Risk findings"]));
  for (const h of m.history ?? []) out.push(row([h.week.start, h.backtestTrades, h.paperTrades, h.journalEntries, h.lessons, nd(h.winRate), nd(h.avgR), nd(h.net), nd(h.discipline), h.riskFindings]));
  if (r.narrative) {
    out.push("", row(["Next week", "Why"]));
    for (const n of r.narrative.nextWeek) out.push(row([n.action, n.why]));
  }
  return out.join("\r\n") + "\r\n";
}

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
function fonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  fontCache = { regular: fs.readFileSync(path.join(dir, "Inter-Medium.ttf")), bold: fs.readFileSync(path.join(dir, "InterDisplay-ExtraBold.ttf")) };
  return fontCache;
}

const INK = rgb(0.07, 0.09, 0.12), MUTED = rgb(0.42, 0.46, 0.52), LINE = rgb(0.86, 0.88, 0.91), ACCENT = rgb(0.05, 0.55, 0.78), RED = rgb(0.75, 0.15, 0.2);

/** A shared A4 text-report writer: headings, wrapped paragraphs, simple tables, page breaks. */
export async function textPdf(title: string, subtitle: string, build: (w: PdfWriter) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = fonts();
  const reg = await doc.embedFont(f.regular, { subset: true });
  const bold = await doc.embedFont(f.bold, { subset: true });
  doc.setTitle(title);
  doc.setCreator("JARVIS");
  const w = new PdfWriter(doc, reg, bold);
  w.heading(title, 18);
  w.para(subtitle, 9, MUTED);
  build(w);
  return doc.save();
}

export class PdfWriter {
  W = 595.28; H = 841.89; M = 44; y: number; page: PDFPage;
  constructor(private doc: PDFDocument, private reg: PDFFont, private bold: PDFFont) { this.page = doc.addPage([this.W, this.H]); this.y = this.H - this.M; }
  private ensure(need: number) { if (this.y - need < this.M) { this.page = this.doc.addPage([this.W, this.H]); this.y = this.H - this.M; } }
  private safe(s: string, font: PDFFont) { return [...s].map((c) => { try { font.encodeText(c); return c; } catch { return "?"; } }).join(""); }
  private wrap(s: string, font: PDFFont, size: number, width: number) {
    const out: string[] = [];
    for (const para of this.safe(s, font).split(/\n/)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  heading(s: string, size = 13) {
    this.ensure(size + 14);
    this.y -= size + 6;
    this.page.drawText(this.safe(s, this.bold), { x: this.M, y: this.y, size, font: this.bold, color: size > 14 ? ACCENT : INK });
    this.y -= 6;
  }
  para(s: string, size = 9.5, color = INK) {
    for (const line of this.wrap(s, this.reg, size, this.W - 2 * this.M)) {
      this.ensure(size + 4);
      this.y -= size + 3.5;
      this.page.drawText(line, { x: this.M, y: this.y, size, font: this.reg, color });
    }
    this.y -= 4;
  }
  warn(s: string) { this.para(s, 9, RED); }
  table(head: string[], rows: (string | number | null)[][], widths?: number[]) {
    const total = this.W - 2 * this.M;
    const ws = widths ?? head.map(() => total / head.length);
    const size = 8;
    const draw = (cells: (string | number | null)[], font: PDFFont) => {
      const lines = cells.map((c, i) => this.wrap(c == null ? "no data" : String(c), font, size, ws[i] - 4));
      const h = Math.max(...lines.map((l) => l.length)) * (size + 2.5) + 4;
      this.ensure(h);
      let x = this.M;
      lines.forEach((ls, i) => { ls.forEach((l, k) => this.page.drawText(l, { x: x + 2, y: this.y - (k + 1) * (size + 2.5), size, font, color: INK })); x += ws[i]; });
      this.y -= h;
      this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 0.5, color: LINE });
    };
    draw(head, this.bold);
    for (const r of rows) draw(r, this.reg);
    this.y -= 8;
  }
}

const pct = (x: number | null | undefined) => (x == null ? "no data" : `${Math.round(x * 100)}%`);
const n2 = (x: number | null | undefined) => (x == null ? "no data" : x.toFixed(2));

export async function reportPdf(r: Report): Promise<Uint8Array> {
  const m = r.metrics;
  return textPdf(`MIKE · Weekly trading review`, `${r.label} · revision ${r.revision} · generated ${r.generatedAt?.slice(0, 16).replace("T", " ") ?? ""} UTC · source: ${r.source?.kind ?? "—"}`, (w) => {
    if (!m) { w.para("This report has no figures."); return; }
    w.warn(m.labels.backtest);
    w.warn(m.labels.paper);
    if (r.narrative) {
      w.heading("Executive summary");
      w.para(r.narrative.executiveSummary);
      w.para(r.narrative.by === "ai" ? `Written by AI (${r.narrative.provider ?? ""}) from the figures below; every number was checked against your records.` : "Written by rules straight from the figures below.", 8, MUTED);
    }
    w.heading("This week");
    w.table(["Backtest runs", "Backtest trades", "Paper sessions", "Paper trades", "Journal entries", "Lessons", "Discipline"], [[m.backtests.runs, m.backtests.trades, m.paper.sessions, m.paper.trades, m.journal.entries, m.learning.lessonsThisWeek.length, m.discipline.score]]);
    w.heading("Strategies");
    w.table(["Strategy", "Data", "BT trades", "BT win", "BT avg R", "OOS trades", "Paper trades", "Paper win", "Paper avg R"],
      m.strategies.map((s) => [`${s.letter} · ${s.name}`, s.status === "insufficient" ? "Insufficient data" : s.status === "none" ? "No data" : "OK", s.backtest.trades, pct(s.backtest.winRate), n2(s.backtest.avgR), s.outOfSample?.trades ?? 0, s.paper.trades, pct(s.paper.winRate), n2(s.paper.avgR)]),
      [100, 70, 45, 45, 50, 50, 50, 50, 47]);
    for (const s of m.strategies) w.para(`${s.letter} · ${s.name}: ${r.narrative?.strategies.find((x) => x.id === s.id)?.note ?? s.verdict}`, 8.5);
    w.heading("Risk audit");
    w.para(`Rules (${m.risk.rulesSource}): risk ${m.risk.rules.riskPct}% per trade, daily loss ${m.risk.rules.dailyLossPct}%, max ${m.risk.rules.maxTrades} trades/day, min R:R ${m.risk.rules.minRR}, virtual capital ₹${m.risk.rules.capital.toLocaleString("en-IN")}.`, 8.5, MUTED);
    if (!m.risk.findings.length) w.para(m.risk.clean === null ? "Nothing to audit this week." : "No findings.");
    else w.table(["Finding", "Severity", "Count", "Evidence"], m.risk.findings.map((f) => [f.rule, f.severity, f.count, f.evidence.slice(0, 3).map((e) => `${e.date} ${e.ref}: ${e.detail}`).join("\n")]), [150, 50, 40, 267]);
    w.heading("Learning & discipline");
    const L = m.learning;
    w.para(`84-day plan: ${L.lessonsTotal}/84 lessons (${L.progressPct}%)${L.expectedDay != null ? `, calendar day ${L.expectedDay}${L.phase ? ` — phase ${L.phase.num} ${L.phase.name}` : ""}` : ", not started"}; ${L.behind ? `${L.behind} behind` : "on pace"}. Backtested trades to date: ${L.backtestTradesTotal} (goal ${L.backtestTarget.min}–${L.backtestTarget.max}). Paper trades to date: ${L.paperTradesTotal}.`);
    w.para(`Discipline score: ${m.discipline.score ?? "no data"}. ${m.discipline.definition}`, 8.5);
    if (r.narrative?.discipline) w.para(r.narrative.discipline, 8.5);
    w.heading("Compared with previous weeks");
    w.table(["Week", "BT trades", "Paper", "Journal", "Lessons", "Win rate", "Avg R", "Discipline", "Risk"], (m.history ?? []).map((h) => [h.week.start, h.backtestTrades, h.paperTrades, h.journalEntries, h.lessons, pct(h.winRate), n2(h.avgR), h.discipline, h.riskFindings]));
    if (r.narrative) {
      w.heading("Next week");
      for (const n of r.narrative.nextWeek) w.para(`• ${n.action} — ${n.why}`);
    }
    if (m.missing.length) { w.heading("Missing data"); for (const x of m.missing) w.para(`• ${x}`, 8.5, MUTED); }
    w.para("Educational review of simulated practice on Indian-listed ETFs. Not financial advice; no real orders are placed.", 8, MUTED);
  });
}
