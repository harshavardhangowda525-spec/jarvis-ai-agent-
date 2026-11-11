import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, isDbConfigured } from "@/lib/db";
import { INFINITY_TEMPLATE, operatorBlock, unfilledBlanks } from "@/lib/ai/operator";

describe("operating manual: pure helpers", () => {
  it("the template is the pasted document, word for word", () => {
    expect(INFINITY_TEMPLATE.startsWith("# JARVIS — Master Operating Prompt")).toBe(true);
    expect(INFINITY_TEMPLATE).toContain("Never invent a price.");
    expect(INFINITY_TEMPLATE.trimEnd().endsWith("☕")).toBe(true);
  });
  it("lists every real blank with its section, and ignores blanks quoted in backticks", () => {
    const b = unfilledBlanks("> Fill every `[FILL: …]` first.\n## 3.2 Catalogue\n| Landing Page | [FILL: ₹] |\n## Terms\n- GST: [FILL — e.g. 18%]\n- Done: ₹5,000");
    expect(b).toEqual([
      { line: 3, section: "3.2 Catalogue", text: "| Landing Page | [FILL: ₹] |" },
      { line: 5, section: "Terms", text: "- GST: [FILL — e.g. 18%]" },
    ]);
    expect(unfilledBlanks(INFINITY_TEMPLATE).length).toBeGreaterThan(25);
    expect(unfilledBlanks(INFINITY_TEMPLATE).some((x) => /Paste this whole file/.test(x.text))).toBe(false);
  });
  it("the block puts built-in rules first, names the agent, and counts the blanks", () => {
    const s = operatorBlock("Be brief.\nPrice: [FILL: ₹]", "ASTON");
    expect(s).toContain("you are ASTON");
    expect(s).toMatch(/rules above win any conflict/);
    expect(s).toMatch(/never invent the value/);
    expect(s).toContain("(1 still blank)");
    expect(s).toContain("<operating_manual>\nBe brief.\nPrice: [FILL: ₹]\n</operating_manual>");
    expect(operatorBlock("   ", "JARVIS")).toBe("");
  });
});

const d = isDbConfigured ? describe : describe.skip;
d("operating manual: saved per user (integration)", () => {
  let userId = "";
  let O: typeof import("@/lib/ai/operator");
  beforeAll(async () => {
    O = await import("@/lib/ai/operator");
    userId = (await getDb().user.create({ data: { email: `op-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  it("starts on the template, saves edits, switches off, and refuses an oversized manual", async () => {
    expect(await O.loadOperator(userId)).toMatchObject({ content: INFINITY_TEMPLATE, enabled: true, saved: false });
    expect(await O.operatorPromptFor(userId, "JARVIS")).toContain("Master Operating Prompt");
    await O.saveOperator(userId, { content: "Call me Harsha." });
    expect(await O.operatorPromptFor(userId, "EV")).toMatch(/you are EV[\s\S]*Call me Harsha\./);
    await O.saveOperator(userId, { enabled: false });
    expect(await O.operatorPromptFor(userId, "JARVIS")).toBe("");
    expect((await O.loadOperator(userId)).content).toBe("Call me Harsha.");
    await expect(O.saveOperator(userId, { content: "x".repeat(O.OPERATOR_MAX_CHARS + 1) })).rejects.toThrow(/too long/);
  });
});
