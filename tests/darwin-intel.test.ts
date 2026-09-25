import { describe, it, expect } from "vitest";
import { leadIntel, pipelineCounts, matchesFilters, DEFAULT_FILTERS, toLocalMeters } from "@/lib/darwin/intel";
import type { LeadDTO } from "@/lib/darwin/types";

const lead = (p: Partial<LeadDTO>): LeadDTO => ({
  id: "x", businessName: "Iron Gym", category: "Gym", address: "MG Road", phone: null, website: null, email: null,
  latitude: 12.97, longitude: 77.59, distanceM: 300, mapsUrl: null, osmUrl: null, websiteStatus: "no_website_listed",
  stage: "new", source: "geoapify", discoveredAt: new Date().toISOString(), lastSeenAt: null, lastContactedAt: null,
  nextFollowUpAt: null, notes: null, salesValue: null, serviceInterest: null, ...p,
});

describe("DARWIN lead intelligence (real data only)", () => {
  it("a reachable business with no website listed is HIGH POTENTIAL", () => {
    const i = leadIntel(lead({ phone: "+91 98450 00000" }));
    expect(i.kind).toBe("high_potential");
    expect(i.checks.find((c) => c.key === "quality")?.value).toBeNull(); // never analysed → not invented
    expect(i.score).toBeGreaterThanOrEqual(75);
  });
  it("no website and no contact is NO WEBSITE; a listed website + phone is VERIFIED", () => {
    expect(leadIntel(lead({})).kind).toBe("no_website");
    expect(leadIntel(lead({ website: "https://irongym.in", phone: "123" })).kind).toBe("verified");
  });
  it("an AI-flagged website is WEAK WEBSITE, or HIGH POTENTIAL when contactable", () => {
    expect(leadIntel(lead({ website: "https://x.in", opportunityType: "outdated_website" })).kind).toBe("weak_website");
    expect(leadIntel(lead({ website: "https://x.in", phone: "1", opportunityType: "outdated_website" })).kind).toBe("high_potential");
  });
  it("CRM stage wins: contacted, follow-up, client", () => {
    expect(leadIntel(lead({ stage: "contacted", phone: "1" })).kind).toBe("contacted");
    expect(leadIntel(lead({ stage: "follow_up" })).kind).toBe("follow_up");
    expect(leadIntel(lead({ stage: "won" })).kind).toBe("client");
  });
  it("pipeline counts each lead once, at its current stage", () => {
    const c = pipelineCounts([lead({ phone: "1" }), lead({ website: "w", phone: "1" }), lead({ stage: "converted" }), lead({ stage: "lost" })]);
    expect(c).toMatchObject({ "HIGH POTENTIAL": 1, VERIFIED: 1, CLIENT: 1, DISCOVERED: 0 });
  });
  it("filters: no website hides businesses with a website", () => {
    expect(matchesFilters(lead({ website: "w" }), { ...DEFAULT_FILTERS, website: "none" })).toBe(false);
    expect(matchesFilters(lead({}), { ...DEFAULT_FILTERS, website: "none" })).toBe(true);
    expect(matchesFilters(lead({ phone: "1" }), { ...DEFAULT_FILTERS, potential: "high" })).toBe(true);
  });
  it("positions are real distances from the centre", () => {
    const m = toLocalMeters(12.98, 77.60, { lat: 12.97, lon: 77.59 });
    expect(Math.hypot(m.x, m.y)).toBeGreaterThan(1500);
    expect(Math.hypot(m.x, m.y)).toBeLessThan(1600);
  });
});
