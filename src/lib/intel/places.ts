/**
 * Where a story is about — ONLY when the headline or summary names a place.
 * Cities are matched first (more precise), then countries/regions; nothing is
 * inferred from a company's headquarters. Coordinates are the place's centre,
 * and every marker says whether it is city- or country-level. Client-safe.
 */
export interface Place { id: string; name: string; level: "city" | "country" | "region"; lat: number; lng: number; re: RegExp }

const P = (id: string, name: string, level: Place["level"], lat: number, lng: number, words: string, cs = false): Place =>
  ({ id, name, level, lat, lng, re: new RegExp(`(?:^|[^\\p{L}])(?:${words})(?=$|[^\\p{L}])`, cs ? "u" : "iu") });

export const PLACES: Place[] = [
  // India (home market) — cities
  P("bengaluru", "Bengaluru", "city", 12.97, 77.59, "Bengaluru|Bangalore"), P("mumbai", "Mumbai", "city", 19.08, 72.88, "Mumbai"),
  P("delhi", "Delhi NCR", "city", 28.61, 77.21, "New Delhi|Delhi|Gurugram|Gurgaon|Noida"), P("hyderabad", "Hyderabad", "city", 17.39, 78.49, "Hyderabad"),
  P("chennai", "Chennai", "city", 13.08, 80.27, "Chennai"), P("pune", "Pune", "city", 18.52, 73.86, "Pune"), P("kolkata", "Kolkata", "city", 22.57, 88.36, "Kolkata"),
  P("ahmedabad", "Ahmedabad", "city", 23.02, 72.57, "Ahmedabad|GIFT City"), P("kochi", "Kochi", "city", 9.93, 76.27, "Kochi|Cochin"), P("jaipur", "Jaipur", "city", 26.91, 75.79, "Jaipur"),
  // global tech hubs
  P("sf", "San Francisco Bay Area", "city", 37.62, -122.2, "San Francisco|Silicon Valley|Bay Area|Palo Alto|Mountain View|Menlo Park|Cupertino|San Jose"),
  P("seattle", "Seattle", "city", 47.61, -122.33, "Seattle|Redmond"), P("nyc", "New York", "city", 40.71, -74.01, "New York"), P("austin", "Austin", "city", 30.27, -97.74, "Austin"),
  P("london", "London", "city", 51.51, -0.13, "London"), P("berlin", "Berlin", "city", 52.52, 13.4, "Berlin"), P("paris", "Paris", "city", 48.86, 2.35, "Paris"),
  P("tokyo", "Tokyo", "city", 35.68, 139.69, "Tokyo"), P("seoul", "Seoul", "city", 37.57, 126.98, "Seoul"), P("beijing", "Beijing", "city", 39.9, 116.4, "Beijing"),
  P("shenzhen", "Shenzhen", "city", 22.54, 114.06, "Shenzhen"), P("shanghai", "Shanghai", "city", 31.23, 121.47, "Shanghai"), P("singapore", "Singapore", "city", 1.35, 103.82, "Singapore"),
  P("dubai", "Dubai", "city", 25.2, 55.27, "Dubai"), P("telaviv", "Tel Aviv", "city", 32.08, 34.78, "Tel Aviv"), P("toronto", "Toronto", "city", 43.65, -79.38, "Toronto"),
  P("sydney", "Sydney", "city", -33.87, 151.21, "Sydney"), P("taipei", "Taipei", "city", 25.03, 121.57, "Taipei|Hsinchu"), P("brussels", "Brussels", "city", 50.85, 4.35, "Brussels"),
  // countries & regions (centres)
  P("india", "India", "country", 22.5, 79.0, "India|Indian"), P("usa", "United States", "country", 39.8, -98.6, "United States|U\\.S\\.|USA|America|American"),
  P("usa-cs", "United States", "country", 39.8, -98.6, "US", true), P("china", "China", "country", 35.0, 103.0, "China|Chinese"),
  P("uk", "United Kingdom", "country", 54.0, -2.0, "United Kingdom|Britain|British|UK", false), P("japan", "Japan", "country", 36.2, 138.3, "Japan|Japanese"),
  P("korea", "South Korea", "country", 36.5, 127.9, "South Korea|Korean"), P("germany", "Germany", "country", 51.2, 10.4, "Germany|German"),
  P("france", "France", "country", 46.6, 2.2, "France|French"), P("eu", "European Union", "region", 50.5, 9.0, "European Union|EU|Europe|European"),
  P("canada", "Canada", "country", 56.1, -106.3, "Canada|Canadian"), P("australia", "Australia", "country", -25.3, 133.8, "Australia|Australian"),
  P("brazil", "Brazil", "country", -14.2, -51.9, "Brazil|Brazilian"), P("uae", "United Arab Emirates", "country", 24.0, 54.0, "UAE|United Arab Emirates|Emirati"),
  P("saudi", "Saudi Arabia", "country", 24.0, 45.0, "Saudi Arabia|Saudi"), P("israel", "Israel", "country", 31.0, 35.0, "Israel|Israeli"),
  P("taiwan", "Taiwan", "country", 23.7, 121.0, "Taiwan|Taiwanese"), P("indonesia", "Indonesia", "country", -2.5, 118.0, "Indonesia|Indonesian"),
  P("vietnam", "Vietnam", "country", 14.1, 108.3, "Vietnam|Vietnamese"), P("bangladesh", "Bangladesh", "country", 23.7, 90.4, "Bangladesh"),
  P("srilanka", "Sri Lanka", "country", 7.9, 80.8, "Sri Lanka"), P("nigeria", "Nigeria", "country", 9.1, 8.7, "Nigeria|Nigerian"), P("kenya", "Kenya", "country", 0.0, 37.9, "Kenya|Kenyan"),
  P("russia", "Russia", "country", 61.5, 105.3, "Russia|Russian"), P("ukraine", "Ukraine", "country", 48.4, 31.2, "Ukraine|Ukrainian"),
];

/** Places named in a story: cities first; a country is kept only when none of its cities was named. */
export function placesIn(text: string): Place[] {
  const hits = PLACES.filter((p) => p.re.test(text));
  const cityIn: Record<string, string> = { bengaluru: "india", mumbai: "india", delhi: "india", hyderabad: "india", chennai: "india", pune: "india", kolkata: "india", ahmedabad: "india", kochi: "india", jaipur: "india", sf: "usa", seattle: "usa", nyc: "usa", austin: "usa", london: "uk", berlin: "germany", paris: "france", tokyo: "japan", seoul: "korea", beijing: "china", shenzhen: "china", shanghai: "china", dubai: "uae", telaviv: "israel", toronto: "canada", sydney: "australia", taipei: "taiwan", brussels: "eu" };
  const covered = new Set(hits.filter((h) => h.level === "city").map((h) => cityIn[h.id]));
  const out = hits.filter((h) => h.level === "city" || !covered.has(h.id === "usa-cs" ? "usa" : h.id));
  const seen = new Set<string>();
  return out.filter((h) => { const k = h.id === "usa-cs" ? "usa" : h.id; if (seen.has(k)) return false; seen.add(k); return true; });
}
