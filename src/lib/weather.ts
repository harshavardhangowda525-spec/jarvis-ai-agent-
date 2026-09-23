import "server-only";

// Common old/colloquial city names → the name the geocoder knows best.
export const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru", bengalooru: "Bengaluru", blr: "Bengaluru",
  bombay: "Mumbai", madras: "Chennai", calcutta: "Kolkata", poona: "Pune",
  mysore: "Mysuru", mangalore: "Mangaluru", gurgaon: "Gurugram", trivandrum: "Thiruvananthapuram",
  vizag: "Visakhapatnam", cochin: "Kochi", baroda: "Vadodara", benares: "Varanasi",
  "new york": "New York City", nyc: "New York City", la: "Los Angeles", sf: "San Francisco",
  peking: "Beijing", saigon: "Ho Chi Minh City", "st petersburg": "Saint Petersburg",
};

export interface GeoHit { name: string; latitude: number; longitude: number; country?: string; country_code?: string; admin1?: string; population?: number; feature_code?: string }

/**
 * Resolve a place name to the place the user most likely means. The geocoder's
 * first result is often a tiny namesake (e.g. "Bangalore" → a town in Pakistan),
 * so we fetch several candidates and rank them: an explicit ", Country" wins,
 * then the viewer's own country, then capitals/major cities by population.
 */
export async function geocode(raw: string, userCountry: string): Promise<GeoHit | null> {
  // "Bangalore, India" → name + country filter.
  const [namePart, ...rest] = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const countryWanted = rest.join(" ").toLowerCase();
  const key = namePart.toLowerCase();
  const name = CITY_ALIASES[key] ?? namePart;

  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) },
  ).catch(() => null);
  const json: any = res && res.ok ? await res.json().catch(() => ({})) : {};
  const hits: GeoHit[] = Array.isArray(json?.results) ? json.results : [];
  if (!hits.length) return null;

  const rank = (h: GeoHit): number => {
    let s = Math.log10((h.population ?? 0) + 10); // bigger city → higher
    if (countryWanted && ((h.country ?? "").toLowerCase().includes(countryWanted) || (h.country_code ?? "").toLowerCase() === countryWanted)) s += 100;
    if (userCountry && h.country_code === userCountry) s += 3;
    if (h.feature_code === "PPLC") s += 2;                       // national capital
    else if (h.feature_code === "PPLA" || h.feature_code === "PPLA2") s += 1; // regional capital
    if (h.name.toLowerCase() === name.toLowerCase()) s += 0.5;  // exact name match
    return s;
  };
  return [...hits].sort((a, b) => rank(b) - rank(a))[0];
}
