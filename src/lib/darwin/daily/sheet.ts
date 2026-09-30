import "server-only";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { googleFetch, hasGoogleScope, WORKSPACE_SCOPES } from "@/lib/integrations/google";
import { googleMapsLeadUrl } from "@/lib/darwin/maps";

/**
 * DARWIN's daily leads, in the user's own Google Sheet ("DARWIN Leads"): each
 * verified lead is added once, as it's found. The sheet is created the first
 * time (in their Drive, not shared with anyone). Needs Google connected with
 * the Sheets/Drive permission; otherwise it quietly does nothing.
 */

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const PROVIDER = "darwin_sheet";
export const SHEET_TITLE = "DARWIN Leads";
const HEADER = ["Found on", "Business", "Category", "Phone", "Email", "Address", "Google Maps", "Lead score", "Website", "Stage", "DARWIN id"];

export async function leadSheet(userId: string): Promise<{ id: string; url: string } | null> {
  const row = await getDb().integration.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } }, select: { metadata: true } }).catch(() => null);
  const m = (row?.metadata ?? {}) as { spreadsheetId?: string; url?: string };
  return m.spreadsheetId && m.url ? { id: m.spreadsheetId, url: m.url } : null;
}

async function createSheet(userId: string) {
  const s = await googleFetch(userId, SHEETS, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title: SHEET_TITLE }, sheets: [{ properties: { title: "Leads", gridProperties: { frozenRowCount: 1 } } }] }),
  });
  await googleFetch(userId, `${SHEETS}/${s.spreadsheetId}/values/Leads!A1:append?valueInputOption=RAW`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [HEADER] }),
  });
  const meta = { spreadsheetId: s.spreadsheetId, url: s.spreadsheetUrl };
  await getDb().integration.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, status: "connected", metadata: meta },
    update: { status: "connected", metadata: meta },
  });
  return { id: String(s.spreadsheetId), url: String(s.spreadsheetUrl) };
}

export interface SheetSync { added: number; url: string | null; skipped?: string }

/** Add the run's leads that aren't in the sheet yet. Never throws. */
export async function syncLeadsToSheet(userId: string, runId: string): Promise<SheetSync> {
  try {
    if (!(await hasGoogleScope(userId, WORKSPACE_SCOPES.sheets))) return { added: 0, url: null, skipped: "Google Sheets isn't connected" };
    const leads = await getDb().darwinLead.findMany({
      where: { userId, metadata: { path: ["dailyRunId"], equals: runId } },
      orderBy: { createdAt: "asc" },
    });
    const todo = leads.filter((l) => !(l.metadata as { sheetAdded?: boolean } | null)?.sheetAdded);
    let sheet = await leadSheet(userId);
    if (!todo.length) return { added: 0, url: sheet?.url ?? null };
    const rows = todo.map((l) => {
      const m = (l.metadata ?? {}) as { dailyDate?: string; google?: { mapsUri?: string } | null };
      const maps = m.google?.mapsUri ?? googleMapsLeadUrl(l) ?? "";
      return [m.dailyDate ?? l.createdAt.toISOString().slice(0, 10), l.businessName, l.category ?? "", l.phone ?? "", l.email ?? "", l.location ?? "", maps, l.leadScore ?? "", "No website (verified)", l.stage, l.id];
    });
    const append = (id: string) => googleFetch(userId, `${SHEETS}/${id}/values/Leads!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: rows }),
    });
    if (!sheet) sheet = await createSheet(userId);
    try { await append(sheet.id); }
    catch (e) {
      // the sheet was deleted or its tab renamed — start a fresh one
      if (!/couldn't find|Unable to parse range/i.test((e as Error).message)) throw e;
      sheet = await createSheet(userId);
      await append(sheet.id);
    }
    await Promise.all(todo.map((l) => getDb().darwinLead.update({
      where: { id: l.id },
      data: { metadata: { ...((l.metadata ?? {}) as object), sheetAdded: true } as Prisma.InputJsonValue },
    })));
    return { added: todo.length, url: sheet.url };
  } catch (e) {
    return { added: 0, url: null, skipped: (e as Error).message };
  }
}
