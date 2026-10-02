import { describe, expect, it } from "vitest";
import { darwinSearchNowLine, darwinSearchNowRequest } from "@/lib/darwin/daily/intent";
import { BANGALORE_AREAS, areaCenter, bangaloreLocations, nextOffset, rotateAreas } from "@/lib/darwin/bangalore";

describe("every area of Bangalore", () => {
  it("covers the whole city, once each, inside Bangalore", () => {
    expect(BANGALORE_AREAS.length).toBeGreaterThanOrEqual(70);
    expect(new Set(BANGALORE_AREAS.map((a) => a.name.toLowerCase())).size).toBe(BANGALORE_AREAS.length);
    for (const a of BANGALORE_AREAS) {
      expect(a.lat, a.name).toBeGreaterThan(12.8); expect(a.lat, a.name).toBeLessThan(13.15);
      expect(a.lon, a.name).toBeGreaterThan(77.45); expect(a.lon, a.name).toBeLessThan(77.82);
    }
    // north, south, east and west all reached
    for (const n of ["Yelahanka", "Electronic City", "Whitefield", "Kengeri", "Koramangala", "Malleshwaram"]) expect(areaCenter(n), n).not.toBeNull();
  });

  it("finds an area's fixed centre however it's written", () => {
    expect(areaCenter("Koramangala, Bengaluru")).toMatchObject({ label: "Koramangala, Bengaluru" });
    expect(areaCenter("hsr layout, Bangalore, Karnataka")).toMatchObject({ label: "HSR Layout, Bengaluru" });
    expect(areaCenter("Mysuru")).toBeNull();
  });

  it("each day starts just after where the last one stopped, wrapping round the city", () => {
    const all = bangaloreLocations(), n = all.length;
    expect(rotateAreas(0)).toEqual(all);
    expect(rotateAreas(5)[0]).toBe(all[5]);
    expect(rotateAreas(n + 2)[0]).toBe(all[2]);
    expect(rotateAreas(3)).toHaveLength(n);
    expect(nextOffset(0, 3)).toBe(3);
    expect(nextOffset(n - 2, 5)).toBe(3);
    expect(nextOffset(10, 0)).toBe(11); // always moves on, even after a day that barely started
  });

  it("hears 'search for leads now' — but a specific search stays a one-off search", () => {
    for (const t of ["make darwin search for leads now", "DARWIN, search for leads now", "search for new leads right now", "find more leads now", "start the lead search", "run today's search", "start searching", "DARWIN start the daily search", "search leads again", "search all of Bangalore"]) expect(darwinSearchNowRequest(t), t).toBe(true);
    for (const t of ["find 20 gyms in Indiranagar", "search for cafes near Koramangala", "DARWIN report", "how many leads did DARWIN find today", "open DARWIN", "search for leads in Mysuru now", "start searching for cafes"]) expect(darwinSearchNowRequest(t), t).toBe(false);
    expect(darwinSearchNowLine({ run: { status: "running", verified: 4, target: 50, lastError: null } })).toBe("Searching now — 4 of 50 verified so far. I'll keep going until I reach the target.");
    expect(darwinSearchNowLine({ run: { status: "needs_setup", verified: 0, target: 50, lastError: "Geoapify isn't configured (GEOAPIFY_API_KEY), so DARWIN can't search." } })).toMatch(/^I can't search yet: Geoapify isn't configured/);
  });
});
