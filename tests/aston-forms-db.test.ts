import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";

const d = isDbConfigured ? describe : describe.skip;
d("ASTON site forms really save (integration)", () => {
  let userId = "", token = "", testKey = "";
  let F: typeof import("@/lib/aston/studio/forms");
  let R: typeof import("@/app/api/aston/forms/[token]/route");
  beforeAll(async () => {
    F = await import("@/lib/aston/studio/forms");
    R = await import("@/app/api/aston/forms/[token]/route");
    userId = (await getDb().user.create({ data: { email: `forms-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    token = `tok${Date.now()}abcdefghij`; testKey = "k123";
    await getDb().astonProject.create({ data: {
      userId, name: "Clinic", slug: `clinic-${Date.now()}`, dir: "/tmp/x", brief: "b", previewToken: token, testKey,
      spec: {
        name: "Clinic", summary: "s", audience: "a", style: "healthcare",
        pages: [{ file: "index.html", title: "Home", nav: "Home", purpose: "p", sections: [] }],
        design: { colors: { bg: "#fff", text: "#000", accent: "#09f" }, fonts: { display: { family: "Inter" }, body: { family: "Inter" } }, typeScale: "x", spacing: "x", grid: "x", breakpoints: "x", motion: "x", imageTreatment: "x", states: "x" },
        forms: [
          { id: "appointment", kind: "booking", page: "index.html", fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "date", label: "Date", type: "date", required: true }, { name: "time", label: "Time", type: "time", required: true }, { name: "dept", label: "Department", type: "select", options: ["Dental", "Skin"] }], success: "Booked — see you then." },
        ],
      },
    } });
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  const post = (body: unknown) => R.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } }), { params: { token } });

  it("validates on the server, saves, and answers with the real result", async () => {
    let r = await post({ form: "appointment", data: { name: "Asha", email: "not-an-email", date: "2026-11-02", time: "10:30" } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/valid email/);
    r = await post({ form: "appointment", data: { name: "Asha", email: "asha@example.com", date: "2026-11-02", time: "10:30", dept: "Dental" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, message: "Booked — see you then." });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const rows = await getDb().astonSubmission.findMany({ where: { project: { previewToken: token } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].slot).toBe("2026-11-02 10:30");
    expect(rows[0].test).toBe(false);
  });
  it("a taken slot is refused; another slot is fine", async () => {
    const r = await post({ form: "appointment", data: { name: "Ravi", email: "ravi@example.com", date: "2026-11-02", time: "10:30" } });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/already booked/);
    expect((await post({ form: "appointment", data: { name: "Ravi", email: "ravi@example.com", date: "2026-11-02", time: "11:00" } })).status).toBe(200);
  });
  it("rejects unknown forms and options; a bot's honeypot stores nothing", async () => {
    expect((await post({ form: "nope", data: {} })).status).toBe(404);
    expect((await post({ form: "appointment", data: { name: "A", email: "a@b.co", date: "2026-11-03", time: "09:00", dept: "Brain surgery" } })).status).toBe(400);
    const before = await getDb().astonSubmission.count({ where: { project: { previewToken: token } } });
    expect((await post({ form: "appointment", data: { _gotcha: "spam", name: "x" } })).status).toBe(200);
    expect(await getDb().astonSubmission.count({ where: { project: { previewToken: token } } })).toBe(before);
  });
  it("the browser tests' own submissions are marked as tests", async () => {
    await F.submitForm(token, { form: "appointment", data: { name: "T", email: "t@example.com", date: "2099-12-30", time: "10:30", _aston_test: testKey } });
    const t = await getDb().astonSubmission.findFirst({ where: { project: { previewToken: token }, slot: "2099-12-30 10:30" } });
    expect(t?.test).toBe(true);
  });
});
