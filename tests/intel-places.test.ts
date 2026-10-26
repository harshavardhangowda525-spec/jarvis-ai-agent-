import { describe, it, expect } from "vitest";
import { placesIn } from "@/lib/intel/places";
import { impactScore, serviceOf } from "@/lib/intel/impact";

describe("places come only from names in the story", () => {
  it.each([
    ["Bengaluru startup raises funding for clinic software", ["Bengaluru"]],
    ["Indian SMBs adopt UPI faster than ever", ["India"]],
    ["OpenAI opens an office in London and Tokyo", ["London", "Tokyo"]],
    ["US regulators probe AI chip exports to China", ["United States", "China"]],
    ["New AI coding agent launches for developers", []],
    ["Apple's new iPhone", []],
    ["The EU AI Act takes effect", ["European Union"]],
    ["Mumbai and India's fintech scene", ["Mumbai"]],
  ])("%s", (t, names) => expect(placesIn(t).map((p) => p.name)).toEqual(names));
});

describe("impact score is transparent", () => {
  it("marks measured parts and AI judgement, and follows the weights", () => {
    const base = { relevance: 5, importance: 4, publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), fetchedAt: new Date().toISOString(), confidence: "medium" as const, publishers: 2, official: false, hasSummary: true };
    const s = impactScore(base);
    expect(s.parts.find((p) => p.key === "relevance")!.basis).toBe("ai_judgement");
    expect(s.parts.find((p) => p.key === "evidence")!.basis).toBe("measured");
    expect(s.score).toBeGreaterThan(70);
    const evidenceOnly = impactScore({ ...base, relevance: null }, { relevance: 0, urgency: 0, evidence: 1, recency: 0 });
    expect(evidenceOnly.score).toBe(75);
    expect(serviceOf("Clinics adopt online appointment booking").id).toBe("clinic");
  });
});
