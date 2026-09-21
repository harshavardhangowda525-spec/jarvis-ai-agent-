import { describe, it, expect } from "vitest";
import { availableTools, getTool } from "@/lib/tools/registry";
import { fingerprint, findSimilar, normalizeText, tokenSet, jaccard } from "@/lib/ev/dedup";

describe("EV tool scoping", () => {
  const EV_TOOLS = ["ev_content", "ev_ideas", "ev_leads", "ev_instagram", "ev_analytics", "ev_outreach"];

  it("hides EV marketing tools from the base JARVIS toolset", () => {
    const names = availableTools().map((t) => t.name);
    for (const t of EV_TOOLS) expect(names).not.toContain(t);
  });

  it("exposes EV marketing tools only when the EV agent is active", () => {
    const names = availableTools("ev").map((t) => t.name);
    for (const t of EV_TOOLS) expect(names).toContain(t);
    // EV still shares the general JARVIS tools.
    expect(names).toContain("memory");
    expect(names).toContain("calculator");
  });

  it("every EV tool is registered with a valid schema and is agent-scoped", () => {
    for (const name of EV_TOOLS) {
      const tool = getTool(name)!;
      expect(tool).toBeDefined();
      expect(tool.agentScope).toBe("ev");
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("marks the Instagram publish tool as requiring confirmation", () => {
    expect(getTool("ev_instagram")!.requiresConfirmation).toBe(true);
  });
});

describe("EV de-duplication (no repeated content)", () => {
  it("normalizes away punctuation, emoji, hashtags and case", () => {
    expect(normalizeText("Grow your GYM 💪 with a #website!!!")).toBe("grow your gym with a");
  });

  it("gives order-independent fingerprints for the same meaningful words", () => {
    const a = fingerprint("Affordable websites for gyms starting at 4999");
    const b = fingerprint("Gyms: websites starting 4999, affordable");
    expect(a).toBe(b);
  });

  it("distinguishes genuinely different content", () => {
    const a = fingerprint("Reel idea: transformation before/after for gyms");
    const b = fingerprint("Post idea: menu photography package for cafes");
    expect(a).not.toBe(b);
  });

  it("flags substantially similar candidates against priors", () => {
    const priors = [
      { id: "1", title: "Gym website offer", text: "Affordable gym website launch offer starting 4999 grow members" },
      { id: "2", title: "Cafe app", text: "Mobile ordering app for cafes boost repeat orders" },
    ];
    const hits = findSimilar("Affordable gym website launch starting 4999 grow more members", priors, 0.6);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("1");
  });

  it("does not flag fresh, distinct candidates", () => {
    const priors = [{ id: "1", title: "x", text: "salon promo reel glow up before after" }];
    const hits = findSimilar("real estate walkthrough app for property listings", priors, 0.72);
    expect(hits).toHaveLength(0);
  });

  it("jaccard is symmetric and bounded", () => {
    const a = tokenSet("gym website growth offer");
    const b = tokenSet("gym website campaign");
    const s1 = jaccard(a, b);
    const s2 = jaccard(b, a);
    expect(s1).toBe(s2);
    expect(s1).toBeGreaterThanOrEqual(0);
    expect(s1).toBeLessThanOrEqual(1);
  });
});
