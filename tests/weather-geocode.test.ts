import { describe, it, expect, vi, afterEach } from "vitest";
import { geocode } from "@/lib/weather";

// Mock the Open-Meteo geocoder: return a fixed result list per queried name.
function mockGeocoder(byName: Record<string, unknown[]>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = new URL(url).searchParams.get("name") ?? "";
    calls.push(name);
    return new Response(JSON.stringify({ results: byName[name] ?? [] }), { status: 200 });
  }));
  return calls;
}

const BENGALURU_IN = { name: "Bengaluru", latitude: 12.97, longitude: 77.59, country: "India", country_code: "IN", admin1: "Karnataka", population: 8443675, feature_code: "PPLA" };
const BANGALORE_PK = { name: "Bangalore Town", latitude: 24.89, longitude: 67.08, country: "Pakistan", country_code: "PK", admin1: "Sindh", population: 0, feature_code: "PPLX" };
const LONDON_GB = { name: "London", latitude: 51.5, longitude: -0.12, country: "United Kingdom", country_code: "GB", population: 8961989, feature_code: "PPLC" };
const LONDON_CA = { name: "London", latitude: 42.98, longitude: -81.24, country: "Canada", country_code: "CA", admin1: "Ontario", population: 346765, feature_code: "PPL" };

afterEach(() => vi.unstubAllGlobals());

describe("weather geocode ranking", () => {
  it("maps 'Bangalore' to Bengaluru, India — not the Pakistan namesake", async () => {
    const calls = mockGeocoder({ Bengaluru: [BANGALORE_PK, BENGALURU_IN] });
    const hit = await geocode("bangalore", "");
    expect(calls[0]).toBe("Bengaluru"); // alias applied before lookup
    expect(hit?.country_code).toBe("IN");
  });

  it("prefers the bigger city even when the geocoder lists a tiny namesake first", async () => {
    mockGeocoder({ Bengaluru: [BANGALORE_PK, BENGALURU_IN] });
    expect((await geocode("Bengaluru", ""))?.name).toBe("Bengaluru");
  });

  it("honours an explicit ', Country' over population", async () => {
    mockGeocoder({ London: [LONDON_GB, LONDON_CA] });
    expect((await geocode("London, Canada", ""))?.country_code).toBe("CA");
  });

  it("defaults to the major city (capital) without hints", async () => {
    mockGeocoder({ London: [LONDON_CA, LONDON_GB] });
    expect((await geocode("London", ""))?.country_code).toBe("GB");
  });

  it("returns null when nothing matches", async () => {
    mockGeocoder({});
    expect(await geocode("Nowhereville", "")).toBeNull();
  });
});
