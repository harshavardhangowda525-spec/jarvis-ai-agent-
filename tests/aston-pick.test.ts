import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { matchSite } from "@/lib/tools/aston";

describe("which demo the user means", () => {
  const sites = [{ name: "Iron Temple" }, { name: "Bean Story" }, { name: "Brew & Bloom" }, { name: "Bean" }];
  it("finds it by name or in the request, longest name first", () => {
    expect(matchSite(sites, "Bean Story")?.name).toBe("Bean Story");
    expect(matchSite(sites, "bean story café")?.name).toBe("Bean Story");
    expect(matchSite(sites, undefined, "Change the Bean Story website: make the colours deep green")?.name).toBe("Bean Story");
    expect(matchSite(sites, "brew and bloom")?.name).toBe("Brew & Bloom");
    expect(matchSite(sites, "iron temple gym")?.name).toBe("Iron Temple");
  });
  it("no name, no match — never a guess", () => {
    expect(matchSite(sites, undefined, "make the colours deep green")).toBeNull();
    expect(matchSite(sites, "Spice Route")).toBeNull();
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("aston_demo changes go to the right demo (integration)", () => {
  let userId = "";
  let T: typeof import("@/lib/tools/aston");
  beforeAll(async () => {
    T = await import("@/lib/tools/aston");
    userId = (await getDb().user.create({ data: { email: `pick-${Date.now()}@example.com`, passwordHash: "x" } })).id;
    for (const [name, t] of [["Bean Story", "tokbeanstory0000001"], ["Iron Temple", "tokirontemple000001"]] as const) {
      await getDb().astonSite.create({ data: { userId, name, kind: "website", previewToken: `${t}${Date.now()}`, currentVersion: 1 } });
      await new Promise((r) => setTimeout(r, 20)); // Iron Temple is the most recent one
    }
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  const run = (input: Record<string, unknown>) => T.jarvisAstonDemoTool.execute(T.jarvisAstonDemoTool.schema.parse(input), { userId, timezone: "UTC", activity: () => {} });

  it("a change naming Bean Story goes to Bean Story, not the most recent demo", async () => {
    const r = await run({ action: "changes", feedback: "Change the Bean Story website: make the colours deep green and add free Wi-Fi" });
    expect(r.summary).toBe("Changes requested: Bean Story");
    const r2 = await run({ action: "changes", name: "Iron Temple", feedback: "bigger book button" });
    expect(r2.summary).toBe("Changes requested: Iron Temple");
  });
  it("a name passed as the id still works", async () => {
    const r = await run({ action: "changes", siteId: "Bean Story", feedback: "add opening hours" });
    expect(r.summary).toBe("Changes requested: Bean Story");
  });
  it("with no name it asks which demo instead of guessing", async () => {
    await expect(run({ action: "changes", feedback: "make the colours deep green" })).rejects.toThrow(/Which demo should I change\? Your demos: .*Iron Temple.*Bean Story/);
    await expect(run({ action: "changes", name: "Spice Route", feedback: "x" })).rejects.toThrow(/no demo called "Spice Route"/);
  });
});
