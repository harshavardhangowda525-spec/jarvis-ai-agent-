import { describe, expect, it } from "vitest";
import { resolveKeys } from "../scripts/local-helpers.mjs";

const GEO = { GEOAPIFY_API_KEY: /^GEO_?A?P?I?FY(_API)?(_KEY)?$|^GEOAPIFY_?(API_?)?KEY$|^GEOAPIFY$|^GEOAPI(_KEY)?$|^GEOPIFY_API_KEY$/i };

describe("finding API keys where they really are", () => {
  it("an empty line in .env.local (Vercel 'Sensitive') doesn't hide the key in .env", () => {
    const r = resolveKeys([{ name: ".env.local", env: { GEOAPIFY_API_KEY: "" } }, { name: ".env", env: { GEOAPIFY_API_KEY: "abc123" } }], GEO);
    expect(r.values).toEqual({ GEOAPIFY_API_KEY: "abc123" });
    expect(r.hidden).toEqual([{ key: "GEOAPIFY_API_KEY", file: ".env.local", real: ".env" }]);
  });
  it(".env.local still wins when it has a real value", () => {
    expect(resolveKeys([{ name: ".env.local", env: { GEOAPIFY_API_KEY: "local" } }, { name: ".env", env: { GEOAPIFY_API_KEY: "other" } }], GEO).values.GEOAPIFY_API_KEY).toBe("local");
  });
  it("a misspelt name is used and reported", () => {
    for (const wrong of ["GEOPIFY_API_KEY", "GEOAPIFY_KEY", "GEOAPIFY", "GEO_APIFY_API_KEY"]) {
      const r = resolveKeys([{ name: ".env", env: { [wrong]: "k1" } }], GEO);
      expect([wrong, r.values.GEOAPIFY_API_KEY, r.misnamed[0]?.wrong]).toEqual([wrong, "k1", wrong]);
    }
  });
  it("nothing anywhere → nothing made up", () => {
    expect(resolveKeys([{ name: ".env", env: { OTHER: "x" } }], GEO)).toEqual({ values: {}, from: {}, misnamed: [], hidden: [] });
  });
});
