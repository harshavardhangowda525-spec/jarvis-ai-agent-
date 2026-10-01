import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED, allowedCategory, allowedLabel, allowedList, onlyAllowed } from "@/lib/darwin/categories";

describe("DARWIN only looks for cafes, restaurants and gyms", () => {
  it("defaults to the three, 'all' lifts the limit, a custom list is respected", () => {
    expect(allowedList(undefined)).toEqual(DEFAULT_ALLOWED);
    expect(allowedList("")).toEqual(["cafes", "restaurants", "gyms"]);
    expect(allowedList("all")).toBeNull();
    expect(allowedList("gyms, cafes")).toEqual(["gyms", "cafes"]);
    expect(allowedLabel(DEFAULT_ALLOWED)).toBe("cafes, restaurants and gyms");
  });

  it("maps what people type onto the allowed kinds and refuses the rest", () => {
    const a = DEFAULT_ALLOWED;
    expect(allowedCategory("Coffee shops", a)).toBe("cafes");
    expect(allowedCategory("café", a)).toBe("cafes");
    expect(allowedCategory("restaurants", a)).toBe("restaurants");
    expect(allowedCategory("dhabas", a)).toBe("restaurants");
    expect(allowedCategory("fitness centres", a)).toBe("gyms");
    expect(allowedCategory("CrossFit boxes", a)).toBe("gyms");
    for (const no of ["salons", "dentists", "pharmacies", "coaching centres", "hotels", "businesses"]) expect(allowedCategory(no, a)).toBeNull();
    expect(allowedCategory("salons", null)).toBe("salons");
  });

  it("filters a list, de-duplicates, and falls back to all three", () => {
    expect(onlyAllowed(["gyms", "salons", "fitness studio", "cafes"], DEFAULT_ALLOWED)).toEqual(["gyms", "cafes"]);
    expect(onlyAllowed(["salons", "spas"], DEFAULT_ALLOWED)).toEqual(DEFAULT_ALLOWED);
    expect(onlyAllowed(["salons"], null)).toEqual(["salons"]);
  });
});
