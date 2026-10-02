import { describe, expect, it } from "vitest";
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
});
