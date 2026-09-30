import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { googleFetch } from "@/lib/integrations/google";

/**
 * google_workspace — the user's Google Drive, Docs, Sheets and Contacts, as
 * the user (their own Google connection). Read anything they can see; create
 * new Docs/Sheets and add rows to a Sheet. It never deletes, trashes or
 * overwrites existing content, and never shares files with anyone.
 */

const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const PEOPLE = "https://people.googleapis.com/v1";
const MAX_TEXT = 12_000;

const schema = z.object({
  action: z.enum(["drive_search", "read_file", "create_doc", "create_sheet", "read_sheet", "append_rows", "contacts_search"]),
  query: z.string().max(300).optional().describe("drive_search: words to find in file names/contents; contacts_search: a name, email or phone."),
  fileId: z.string().max(200).optional().describe("A Drive file id (from drive_search) — or a docs.google.com / drive.google.com link."),
  title: z.string().max(200).optional().describe("create_doc / create_sheet: the new file's name."),
  text: z.string().max(50_000).optional().describe("create_doc: the document's text."),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(500).optional().describe("create_sheet / append_rows: rows of cells (the first row of a new sheet is its header)."),
  range: z.string().max(100).optional().describe("read_sheet / append_rows: A1 range or sheet tab name, e.g. 'Leads' or 'Sheet1!A1:F50'."),
  maxResults: z.number().int().min(1).max(25).optional(),
});
type Input = z.infer<typeof schema>;

/** A file id from an id or any Google Docs/Sheets/Drive link. */
export function fileIdOf(raw: string): string {
  const s = raw.trim();
  return s.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? s.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1] ?? s;
}
const need = (v: string | undefined, what: string) => { if (!v?.trim()) throw new ToolError(`Give the ${what}.`); return v.trim(); };
const cell = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : String(v));
const cut = (t: string) => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n… (cut — ${t.length - MAX_TEXT} more characters)` : t);

export const googleWorkspaceTool: ToolDefinition<Input> = {
  name: "google_workspace",
  description:
    "The user's Google Drive, Docs, Sheets and Contacts. drive_search finds files; read_file reads a Doc (as text), a Sheet (as CSV) or a text file; " +
    "read_sheet reads cells; create_doc / create_sheet make NEW files in their Drive; append_rows adds rows to the end of a Sheet; " +
    "contacts_search looks up a person in their Google Contacts. It can't delete, overwrite or share anything. Needs Google connected in Settings.",
  schema,
  activityLabel: "Working in Google Workspace",
  async execute(input, ctx) {
    const u = ctx.userId;
    switch (input.action) {
      case "drive_search": {
        const q = need(input.query, "words to search for").replace(/['\\]/g, " ");
        const params = new URLSearchParams({
          q: `(name contains '${q}' or fullText contains '${q}') and trashed = false`,
          fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))",
          pageSize: String(input.maxResults ?? 10), orderBy: "modifiedTime desc",
          supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        });
        const j = await googleFetch(u, `${DRIVE}/files?${params}`);
        const files = (j.files ?? []).map((f: any) => ({ id: f.id, name: f.name, type: kindOf(f.mimeType), modified: f.modifiedTime, link: f.webViewLink }));
        return { data: { files }, summary: files.length ? `Found ${files.length} file${files.length === 1 ? "" : "s"} in Drive.` : "Nothing in Drive matches that." };
      }
      case "read_file": {
        const id = fileIdOf(need(input.fileId, "file (id or link)"));
        const meta = await googleFetch(u, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`);
        const mt = String(meta.mimeType);
        let text: string;
        if (mt === "application/vnd.google-apps.document") text = await googleFetch(u, `${DRIVE}/files/${id}/export?mimeType=text/plain`);
        else if (mt === "application/vnd.google-apps.spreadsheet") text = await googleFetch(u, `${DRIVE}/files/${id}/export?mimeType=text/csv`);
        else if (mt === "application/vnd.google-apps.presentation") text = await googleFetch(u, `${DRIVE}/files/${id}/export?mimeType=text/plain`);
        else if (/^text\/|json|csv|xml/.test(mt)) text = await googleFetch(u, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`);
        else return { data: { id, name: meta.name, type: kindOf(mt), link: meta.webViewLink }, summary: `${meta.name} is a ${kindOf(mt)} — I can't read its contents as text, but here's the link.` };
        const body = typeof text === "string" ? text : JSON.stringify(text);
        return { data: { id, name: meta.name, type: kindOf(mt), link: meta.webViewLink, text: cut(body) }, summary: `Read "${meta.name}".` };
      }
      case "create_doc": {
        const title = need(input.title, "document title");
        const boundary = `jv${Date.now().toString(36)}`;
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" })}\r\n` +
          `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${input.text ?? ""}\r\n--${boundary}--`;
        const f = await googleFetch(u, `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`, {
          method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
        });
        return { data: { id: f.id, name: f.name, link: f.webViewLink, openUrl: f.webViewLink, label: f.name }, summary: `Created the Google Doc "${f.name}".` };
      }
      case "create_sheet": {
        const title = need(input.title, "spreadsheet title");
        const s = await googleFetch(u, SHEETS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ properties: { title } }) });
        if (input.rows?.length) {
          await googleFetch(u, `${SHEETS}/${s.spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: input.rows.map((r) => r.map(cell)) }),
          });
        }
        return { data: { id: s.spreadsheetId, link: s.spreadsheetUrl, openUrl: s.spreadsheetUrl, label: title, rows: input.rows?.length ?? 0 }, summary: `Created the Google Sheet "${title}"${input.rows?.length ? ` with ${input.rows.length} rows` : ""}.` };
      }
      case "read_sheet": {
        const id = fileIdOf(need(input.fileId, "spreadsheet (id or link)"));
        const range = input.range?.trim() || "A1:Z200";
        const j = await googleFetch(u, `${SHEETS}/${id}/values/${encodeURIComponent(range)}`);
        const values: string[][] = j.values ?? [];
        return { data: { id, range: j.range, rows: values.slice(0, 200) }, summary: `Read ${values.length} row${values.length === 1 ? "" : "s"} from the sheet.` };
      }
      case "append_rows": {
        const id = fileIdOf(need(input.fileId, "spreadsheet (id or link)"));
        if (!input.rows?.length) throw new ToolError("Give the rows to add.");
        const range = input.range?.trim() || "A1";
        const j = await googleFetch(u, `${SHEETS}/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: input.rows.map((r) => r.map(cell)) }),
        });
        return { data: { id, updatedRange: j.updates?.updatedRange ?? null, added: j.updates?.updatedRows ?? input.rows.length }, summary: `Added ${j.updates?.updatedRows ?? input.rows.length} row(s) to the sheet.` };
      }
      case "contacts_search": {
        const q = need(input.query, "name, email or phone to look up");
        const params = new URLSearchParams({ query: q, readMask: "names,emailAddresses,phoneNumbers,organizations", pageSize: String(input.maxResults ?? 10) });
        // People API wants one empty warm-up search before the first real one
        await googleFetch(u, `${PEOPLE}/people:searchContacts?${new URLSearchParams({ query: "", readMask: "names" })}`).catch(() => null);
        const j = await googleFetch(u, `${PEOPLE}/people:searchContacts?${params}`);
        const people = (j.results ?? []).map((r: any) => ({
          name: r.person?.names?.[0]?.displayName ?? null,
          emails: (r.person?.emailAddresses ?? []).map((e: any) => e.value),
          phones: (r.person?.phoneNumbers ?? []).map((p: any) => p.value),
          company: r.person?.organizations?.[0]?.name ?? null,
        }));
        return { data: { people }, summary: people.length ? `Found ${people.length} contact${people.length === 1 ? "" : "s"}.` : "No contact matches that." };
      }
    }
  },
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["drive_search", "read_file", "create_doc", "create_sheet", "read_sheet", "append_rows", "contacts_search"] },
      query: { type: "string" },
      fileId: { type: "string" },
      title: { type: "string" },
      text: { type: "string" },
      rows: { type: "array", items: { type: "array", items: { type: "string" } } },
      range: { type: "string" },
      maxResults: { type: "integer" },
    },
    required: ["action"],
  },
};

function kindOf(mt: string): string {
  const m: Record<string, string> = {
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.folder": "folder",
    "application/pdf": "PDF",
  };
  return m[mt] ?? mt.split("/").pop() ?? "file";
}
