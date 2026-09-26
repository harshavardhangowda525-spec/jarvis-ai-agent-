import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.hoisted(() => { process.env.CRON_SECRET = "cron-test-secret"; });

import { parseNotices, findDate, categorize, decodeEntities } from "@/lib/nios/parse";
import { regionalSource, isNiosUrl, sourcesFor, DEFAULT_SOURCES } from "@/lib/nios/sources";
import { getDb, isDbConfigured } from "@/lib/db";

// ---------------------------------------------------------------- pages shaped like NIOS's

const SDMIS = `<html><head><title>NIOS</title><script>var a='<a href="x.pdf">Fake notice from a script</a>';</script></head><body>
<nav><ul><li><a href="/">Home</a></li><li><a href="/about">About Us</a></li><li><a href="/rti">RTI</a></li></ul></nav>
<table class="table">
 <tr><th>S.No</th><th>Notification</th><th>Date</th></tr>
 <tr><td>1</td><td><a href="/uploads/notification/Practical_Oct2026.pdf" target="_blank">Notification regarding Practical Exams of Secondary and Senior Secondary courses for Oct 2026 session</a> <img src="/images/new.gif"></td><td>06-09-2026</td></tr>
 <tr><td>2</td><td><a href="/uploads/notification/Fee_Reopen.pdf">Notification regarding re-opening of Exam Fee Payment option</a></td><td>03/08/2026</td></tr>
 <tr><td>3</td><td><a href='https://results.nios.ac.in/'>Result of April 2026 Public Examination</a></td><td>12.07.2026</td></tr>
 <tr><td>4</td><td><a href="/uploads/notification/Admission%20Block%202.pdf">Admission for Block-II (Stream 2) &amp; TOC &ndash; last date extended</a></td><td>1st July 2026</td></tr>
</table>
<footer><a href="/privacy">Privacy Policy</a> <a href="/contact">Contact Us</a></footer>
</body></html>`;

const MAIN = `<div class="menu"><a href="/">Home</a> <a href="/about.aspx">About NIOS</a> <a href="/tenders.aspx">Tenders</a> <a href="#">A+</a> <a href="javascript:void(0)">Screen Reader Access</a></div>
<div class="news"><marquee>
 <p>Date Sheet for October 2026 Theory Examination <a href="media/documents/datesheet_oct26.pdf">Click Here</a> (September 20, 2026)</p>
 <p><a href="media/documents/hallticket.pdf" title="Hall ticket">Hall Ticket for October 2026 examination is available</a> NEW</p>
</marquee></div>
<div><a href="https://www.facebook.com/nios">Facebook</a></div>
<div><a href="/media/documents/datesheet_oct26.pdf">Click Here</a></div>`;

describe("parseNotices", () => {
  it("reads table rows: title, absolute PDF link and the row's date — and skips navigation", () => {
    const n = parseNotices(SDMIS, "https://sdmis.nios.ac.in/registration/home-notifications");
    expect(n.map((x) => x.title)).toEqual([
      "Notification regarding Practical Exams of Secondary and Senior Secondary courses for Oct 2026 session",
      "Notification regarding re-opening of Exam Fee Payment option",
      "Result of April 2026 Public Examination",
      "Admission for Block-II (Stream 2) & TOC – last date extended",
    ]);
    expect(n[0].url).toBe("https://sdmis.nios.ac.in/uploads/notification/Practical_Oct2026.pdf");
    expect(n[0].dateText).toBe("06-09-2026");
    expect(n[0].publishedAt?.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(n[1].publishedAt?.toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(n[2].dateText).toBe("12.07.2026");
    expect(n[3].publishedAt?.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(n.map((x) => x.category)).toEqual(["exam", "fee", "result", "admission"]);
    expect(n.some((x) => /fake notice/i.test(x.title))).toBe(false);
  });

  it("uses the row text when the link just says 'Click Here', resolves relative links, drops chrome", () => {
    const n = parseNotices(MAIN, "https://www.nios.ac.in/");
    expect(n[0]).toMatchObject({
      title: "Date Sheet for October 2026 Theory Examination",
      url: "https://www.nios.ac.in/media/documents/datesheet_oct26.pdf",
      dateText: "September 20, 2026",
      category: "exam",
    });
    expect(n[1].title).toBe("Hall Ticket for October 2026 examination is available");
    expect(n).toHaveLength(2); // menu, social and a bare "Click Here" row are not notices
  });

  it("finds dates in the formats NIOS uses", () => {
    expect(findDate("dated 06-09-2026")?.date.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(findDate("on 2026-09-14")?.date.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(findDate("14th Sept 2026")?.date.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(findDate("Oct 5, 2026")?.date.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(findDate("31-02-2026")).toBeNull();
    expect(findDate("no date here")).toBeNull();
  });

  it("categorises notices", () => {
    expect(categorize("Date sheet for Oct 2026 exams")).toBe("exam");
    expect(categorize("Re-evaluation of answer books")).toBe("result");
    expect(categorize("Last date for exam fee payment extended")).toBe("fee");
    expect(categorize("Online admission Stream 1 Block 1")).toBe("admission");
    expect(categorize("Holiday on 2 October")).toBe("general");
    expect(decodeEntities("A &amp; B &#8211; &#x2014;")).toBe("A & B – —");
  });
});

describe("NIOS sources", () => {
  it("only ever watches nios.ac.in pages", () => {
    expect(regionalSource("Bengaluru")?.url).toBe("https://rcbengaluru.nios.ac.in/notification.html");
    expect(regionalSource("../evil")).toBeNull();
    expect(isNiosUrl("https://www.nios.ac.in/x")).toBe(true);
    expect(isNiosUrl("https://nios.ac.in.evil.com/")).toBe(false);
    expect(isNiosUrl("http://www.nios.ac.in/")).toBe(false);
    const s = sourcesFor({ regions: ["delhi"], envRegions: "bengaluru, delhi", extraUrls: "https://dled.nios.ac.in/notices, https://example.com/x" });
    expect(DEFAULT_SOURCES.find((x) => x.key === "rc-bengaluru")?.url).toBe(regionalSource("bengaluru")!.url);
    // Bengaluru is already a default — asking for it again doesn't add a duplicate
    expect(s.map((x) => x.key)).toEqual([...DEFAULT_SOURCES.map((x) => x.key), "rc-delhi", "x:https://dled.nios.ac.in/notices"]);
  });
});

// ---------------------------------------------------------------- watcher against a real DB

const d = isDbConfigured ? describe : describe.skip;

function fakeNios(pages: Record<string, string | number>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (typeof body === "number") return new Response("err", { status: body });
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const SDMIS_URL = "https://sdmis.nios.ac.in/registration/home-notifications";
const MAIN_URL = "https://www.nios.ac.in/";

d("NIOS watcher (integration)", () => {
  let userId = "";
  let W: typeof import("@/lib/nios/watch");
  beforeAll(async () => {
    W = await import("@/lib/nios/watch");
    const u = await getDb().user.create({ data: { email: `nios-${Date.now()}@example.com`, passwordHash: "x" } });
    userId = u.id;
  });
  afterAll(async () => { if (userId) await getDb().user.delete({ where: { id: userId } }).catch(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); W.clearPageCache(); });

  it("first read is stored as history — nothing is announced", async () => {
    fakeNios({ [SDMIS_URL]: SDMIS, [MAIN_URL]: MAIN, "https://voc.nios.ac.in/registration/home-notifications": 503 });
    const r = await W.checkForUser(userId, { force: true });
    expect(r.checked).toBe(true);
    expect(r.newNotices).toHaveLength(0);
    expect(r.baselineAdded).toBe(6);
    const voc = r.sources.find((s) => s.key === "voc")!;
    expect(voc.ok).toBe(false);
    expect(voc.error).toMatch(/503/);
    expect(await W.unseenNotices(userId)).toHaveLength(0);
    expect((await W.latestNotices(userId)).length).toBe(6);
  });

  it("a notice that appears later is announced once, then marked seen", async () => {
    const added = SDMIS.replace("<tr><td>1</td>", `<tr><td>0</td><td><a href="/uploads/notification/Datesheet_Oct2026.pdf">Date Sheet for October 2026 Public Examination (Theory)</a></td><td>25-09-2026</td></tr><tr><td>1</td>`);
    fakeNios({ [SDMIS_URL]: added, [MAIN_URL]: MAIN });
    const r = await W.checkForUser(userId, { force: true });
    expect(r.newNotices.map((n) => n.title)).toEqual(["Date Sheet for October 2026 Public Examination (Theory)"]);
    expect(r.newNotices[0]).toMatchObject({ category: "exam", dateText: "25-09-2026", sourceLabel: "Secondary & Sr. Secondary", isNew: true });
    expect(r.emailed).toBe(0);
    expect(r.emailNote).toMatch(/Gmail/); // no email channel in tests — said plainly, never faked
    const unseen = await W.unseenNotices(userId);
    expect(unseen).toHaveLength(1);
    expect(await W.markSeen(userId, unseen.map((u) => u.id))).toBe(1);
    expect(await W.unseenNotices(userId)).toHaveLength(0);
    // the same page again → nothing new
    W.clearPageCache();
    const again = await W.checkForUser(userId, { force: true });
    expect(again.newNotices).toHaveLength(0);
  });

  it("doesn't re-read the site on every poll", async () => {
    const f = fakeNios({ [SDMIS_URL]: SDMIS, [MAIN_URL]: MAIN });
    const r = await W.checkForUser(userId);
    expect(r.checked).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("a page redesign isn't a flood: at most ANNOUNCE_CAP announced per page per check", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => `<tr><td><a href="/new/n${i}.pdf">Notice number ${i} regarding examinations</a></td><td>0${(i % 9) + 1}-09-2026</td></tr>`).join("");
    fakeNios({ [SDMIS_URL]: `<table>${rows}</table>`, [MAIN_URL]: MAIN });
    const r = await W.checkForUser(userId, { force: true });
    expect(r.newNotices).toHaveLength(W.ANNOUNCE_CAP);
    expect(r.baselineAdded).toBe(20 - W.ANNOUNCE_CAP);
  });

  it("the watch can be switched off", async () => {
    await W.saveSettings(userId, { enabled: false });
    const f = fakeNios({});
    const r = await W.checkForUser(userId, { force: true });
    expect(r.checked).toBe(false);
    expect(f).not.toHaveBeenCalled();
    await W.saveSettings(userId, { enabled: true });
  });
});

describe("cron endpoint", () => {
  it("refuses without the right secret", async () => {
    const { GET } = await import("@/app/api/cron/nios/route");
    expect((await GET(new Request("http://x/api/cron/nios"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/nios", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });
});
