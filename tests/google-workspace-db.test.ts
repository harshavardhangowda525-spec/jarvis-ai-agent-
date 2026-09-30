import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { googleWorkspaceTool, fileIdOf } from "@/lib/tools/googleWorkspace";
import { syncLeadsToSheet, leadSheet } from "@/lib/darwin/daily/sheet";
import { availableTools } from "@/lib/tools/registry";

describe("google_workspace basics", () => {
  it("takes a file id or any Docs/Sheets/Drive link", () => {
    expect(fileIdOf("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOp");
    expect(fileIdOf("https://drive.google.com/open?id=1ZyXwVuTsRqPoNm")).toBe("1ZyXwVuTsRqPoNm");
    expect(fileIdOf(" 1PlainIdPlainId ")).toBe("1PlainIdPlainId");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("DARWIN in your Google Workspace (Google stubbed)", () => {
  const realFetch = globalThis.fetch;
  let userId = "";
  let calls: { method: string; url: string; body: any }[] = [];
  let sheetsGone = false;
  let firstSheet = "";
  const ctx = () => ({ userId, timezone: "UTC", activity: () => {} }) as never;
  const FULL = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/contacts.readonly";

  beforeAll(async () => {
    userId = (await getDb().user.create({ data: { email: `gw-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  beforeEach(async () => {
    calls = []; sheetsGone = false; firstSheet = "";
    await getDb().integration.upsert({
      where: { userId_provider: { userId, provider: "google" } },
      create: { userId, provider: "google", status: "connected", accessToken: "ya29.test", scope: FULL, expiresAt: new Date(Date.now() + 3_600_000) },
      update: { status: "connected", accessToken: "ya29.test", scope: FULL, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!/googleapis\.com/.test(url)) return realFetch(input, init);
      const method = init?.method ?? "GET";
      let body: any = init?.body ?? null;
      try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { /* multipart */ }
      calls.push({ method, url, body });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ya29.test");
      if (url.includes("upload/drive/v3/files")) return Response.json({ id: "1NewDoc", name: "Call script", webViewLink: "https://docs.google.com/document/d/1NewDoc" });
      if (url.includes("/drive/v3/files?")) return Response.json({ files: [{ id: "1LeadsSheet", name: "Leads 2026", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-09-29T10:00:00Z", webViewLink: "https://docs.google.com/spreadsheets/d/1LeadsSheet" }] });
      if (/\/drive\/v3\/files\/1Doc\?fields/.test(url)) return Response.json({ id: "1Doc", name: "Pitch notes", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/1Doc" });
      if (url.includes("/drive/v3/files/1Doc/export")) return new Response("Offer: websites from ₹4,999 for cafes.");
      if (url.includes("people:searchContacts")) return Response.json({ results: [{ person: { names: [{ displayName: "Priya Sharma" }], emailAddresses: [{ value: "priya@cafebloom.in" }], phoneNumbers: [{ value: "+91 98450 11111" }] } }] });
      if (/sheets\.googleapis\.com\/v4\/spreadsheets$/.test(url) && method === "POST") {
        const id = `1Sheet${calls.length}`; firstSheet ||= id;
        return Response.json({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` });
      }
      if (url.includes(":append")) {
        // the first sheet was deleted by the user
        if (sheetsGone && url.includes(`/${firstSheet}/`)) return Response.json({ error: { message: "Requested entity was not found." } }, { status: 404 });
        return Response.json({ updates: { updatedRange: "Leads!A2:K4", updatedRows: body?.values?.length ?? 0 } });
      }
      if (url.includes("/values/")) return Response.json({ range: "Sheet1!A1:C3", values: [["Business", "Phone"], ["Cafe Bloom", "+91 98450 11111"]] });
      return Response.json({ error: { message: "unexpected" } }, { status: 500 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("DARWIN (and JARVIS) get Gmail, Calendar and Google Workspace once Google is set up", () => {
    const names = availableTools("darwin").map((t) => t.name);
    if (!process.env.GOOGLE_CLIENT_ID) return; // tools only show with the OAuth client configured
    expect(names).toEqual(expect.arrayContaining(["gmail", "google_calendar", "google_workspace"]));
  });

  it("searches Drive, reads a Doc, reads a Sheet, finds a contact", async () => {
    const s = await googleWorkspaceTool.execute({ action: "drive_search", query: "leads" }, ctx());
    expect((s.data as any).files[0]).toMatchObject({ id: "1LeadsSheet", type: "Google Sheet" });
    const doc = await googleWorkspaceTool.execute({ action: "read_file", fileId: "https://docs.google.com/document/d/1Doc/edit" }, ctx());
    expect((doc.data as any).text).toMatch(/websites from ₹4,999/);
    const sheet = await googleWorkspaceTool.execute({ action: "read_sheet", fileId: "1LeadsSheet" }, ctx());
    expect((sheet.data as any).rows[1]).toEqual(["Cafe Bloom", "+91 98450 11111"]);
    const c = await googleWorkspaceTool.execute({ action: "contacts_search", query: "Priya" }, ctx());
    expect((c.data as any).people[0]).toMatchObject({ name: "Priya Sharma", emails: ["priya@cafebloom.in"] });
  });

  it("creates new files and adds rows — never deletes or overwrites", async () => {
    const doc = await googleWorkspaceTool.execute({ action: "create_doc", title: "Call script", text: "Hi, this is Harsha…" }, ctx());
    expect(doc.data).toMatchObject({ id: "1NewDoc", openUrl: "https://docs.google.com/document/d/1NewDoc" });
    await googleWorkspaceTool.execute({ action: "append_rows", fileId: "1LeadsSheet", range: "Leads", rows: [["Cafe Bloom", "+91 98450 11111"]] }, ctx());
    expect(calls.every((c) => c.method !== "DELETE" && !/trash|:clear|batchUpdate/.test(c.url))).toBe(true);
    expect(calls.find((c) => c.url.includes(":append"))!.url).toMatch(/insertDataOption=INSERT_ROWS/);
  });

  it("an old Google connection without the new permissions says to reconnect", async () => {
    globalThis.fetch = (async () => Response.json({ error: { message: "Request had insufficient authentication scopes." } }, { status: 403 })) as typeof fetch;
    await expect(googleWorkspaceTool.execute({ action: "drive_search", query: "x" }, ctx())).rejects.toThrow(/disconnect Google and connect it again/);
  });

  it('the day\'s leads go into the "DARWIN Leads" sheet once each; a deleted sheet is started again', async () => {
    const run = await getDb().darwinDailyRun.create({ data: { userId, date: "2026-10-10", target: 50, status: "running", config: {}, log: [] } });
    for (const n of ["Alpha Gym", "Beta Bakery"]) {
      await getDb().darwinLead.create({ data: { userId, businessName: n, fingerprint: `fp-${n}`, phone: "+91 98450 22222", latitude: 12.97, longitude: 77.59, metadata: { dailyRunId: run.id, dailyDate: "2026-10-10" } } });
    }
    const a = await syncLeadsToSheet(userId, run.id);
    expect(a.added).toBe(2);
    const created = calls.filter((c) => /v4\/spreadsheets$/.test(c.url));
    expect(created).toHaveLength(1);
    expect(created[0].body.properties.title).toBe("DARWIN Leads");
    const rows = calls.filter((c) => c.url.includes(":append")).map((c) => c.body.values).flat();
    expect(rows[0][1]).toBe("Business"); // header
    expect(rows.slice(1).map((r: string[]) => r[1])).toEqual(["Alpha Gym", "Beta Bakery"]);
    expect(await leadSheet(userId)).toMatchObject({ url: expect.stringMatching(/^https:\/\/docs\.google\.com\/spreadsheets\//) });
    // again: nothing new
    calls = [];
    expect((await syncLeadsToSheet(userId, run.id)).added).toBe(0);
    expect(calls.filter((c) => c.url.includes(":append"))).toHaveLength(0);
    // a new lead, but the sheet was deleted meanwhile → a fresh sheet, the lead still lands
    await getDb().darwinLead.create({ data: { userId, businessName: "Gamma Salon", fingerprint: "fp-gamma", metadata: { dailyRunId: run.id } } });
    sheetsGone = true;
    const b = await syncLeadsToSheet(userId, run.id);
    expect(b.added).toBe(1);
  });

  it("without the Sheets permission nothing is sent to Google", async () => {
    await getDb().integration.update({ where: { userId_provider: { userId, provider: "google" } }, data: { scope: "https://www.googleapis.com/auth/gmail.send" } });
    const run = await getDb().darwinDailyRun.create({ data: { userId, date: "2026-10-11", target: 50, status: "running", config: {}, log: [] } });
    await getDb().darwinLead.create({ data: { userId, businessName: "Delta Dental", fingerprint: "fp-delta", metadata: { dailyRunId: run.id } } });
    expect(await syncLeadsToSheet(userId, run.id)).toMatchObject({ added: 0, skipped: expect.stringMatching(/isn't connected/) });
    expect(calls).toHaveLength(0);
  });
});
