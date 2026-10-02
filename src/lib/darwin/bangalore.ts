/**
 * Every area of Bangalore DARWIN's daily search covers — the whole city, from
 * the centre out to Yelahanka, Whitefield, Electronic City and Kengeri. Each
 * has a fixed centre (no geocoding call, no "couldn't find the location"), and
 * a small radius around each one still covers the city with some overlap.
 * Each day picks up where the day before stopped, so every area gets its turn.
 * Client-safe.
 */
export interface Area { name: string; lat: number; lon: number }

export const BANGALORE_AREAS: Area[] = [
  // central
  { name: "MG Road", lat: 12.9756, lon: 77.6066 },
  { name: "Shivajinagar", lat: 12.9857, lon: 77.6057 },
  { name: "Richmond Town", lat: 12.96, lon: 77.6 },
  { name: "Ulsoor", lat: 12.9817, lon: 77.62 },
  { name: "Frazer Town", lat: 12.9967, lon: 77.6136 },
  { name: "Cox Town", lat: 12.9946, lon: 77.625 },
  { name: "Vasanth Nagar", lat: 12.9915, lon: 77.5935 },
  { name: "Majestic", lat: 12.977, lon: 77.572 },
  { name: "Chickpet", lat: 12.97, lon: 77.577 },
  { name: "Shanthinagar", lat: 12.957, lon: 77.599 },
  { name: "Wilson Garden", lat: 12.948, lon: 77.597 },
  // east
  { name: "Indiranagar", lat: 12.9784, lon: 77.6408 },
  { name: "Domlur", lat: 12.961, lon: 77.6387 },
  { name: "Old Airport Road", lat: 12.959, lon: 77.656 },
  { name: "CV Raman Nagar", lat: 12.9855, lon: 77.663 },
  { name: "Marathahalli", lat: 12.9569, lon: 77.7011 },
  { name: "Brookefield", lat: 12.9662, lon: 77.7186 },
  { name: "Whitefield", lat: 12.9698, lon: 77.75 },
  { name: "Kadugodi", lat: 12.995, lon: 77.76 },
  { name: "Hoodi", lat: 12.992, lon: 77.716 },
  { name: "Mahadevapura", lat: 12.9916, lon: 77.6896 },
  { name: "KR Puram", lat: 13.0076, lon: 77.6955 },
  { name: "Ramamurthy Nagar", lat: 13.012, lon: 77.677 },
  { name: "Varthur", lat: 12.94, lon: 77.745 },
  // south-east
  { name: "Koramangala", lat: 12.9352, lon: 77.6245 },
  { name: "HSR Layout", lat: 12.9116, lon: 77.6474 },
  { name: "BTM Layout", lat: 12.9166, lon: 77.6101 },
  { name: "Bellandur", lat: 12.926, lon: 77.6762 },
  { name: "Sarjapur Road", lat: 12.91, lon: 77.686 },
  { name: "Sarjapur", lat: 12.86, lon: 77.786 },
  { name: "Bommanahalli", lat: 12.9, lon: 77.628 },
  { name: "Begur", lat: 12.878, lon: 77.629 },
  { name: "Electronic City", lat: 12.8452, lon: 77.6602 },
  { name: "Hulimavu", lat: 12.878, lon: 77.6 },
  { name: "Bannerghatta Road", lat: 12.887, lon: 77.597 },
  // south
  { name: "Jayanagar", lat: 12.9308, lon: 77.5838 },
  { name: "JP Nagar", lat: 12.9063, lon: 77.5857 },
  { name: "JP Nagar 7th Phase", lat: 12.892, lon: 77.58 },
  { name: "Basavanagudi", lat: 12.9422, lon: 77.5754 },
  { name: "Chamarajpet", lat: 12.9575, lon: 77.565 },
  { name: "Banashankari", lat: 12.9255, lon: 77.5468 },
  { name: "Padmanabhanagar", lat: 12.917, lon: 77.56 },
  { name: "Kumaraswamy Layout", lat: 12.908, lon: 77.562 },
  { name: "Uttarahalli", lat: 12.905, lon: 77.545 },
  { name: "Girinagar", lat: 12.942, lon: 77.538 },
  // west
  { name: "Rajarajeshwari Nagar", lat: 12.927, lon: 77.515 },
  { name: "Kengeri", lat: 12.9086, lon: 77.4855 },
  { name: "Nagarbhavi", lat: 12.96, lon: 77.51 },
  { name: "Mysore Road", lat: 12.945, lon: 77.525 },
  { name: "Vijayanagar", lat: 12.9719, lon: 77.5333 },
  { name: "Basaveshwaranagar", lat: 12.989, lon: 77.537 },
  { name: "Rajajinagar", lat: 12.9911, lon: 77.5539 },
  { name: "Malleshwaram", lat: 13.0031, lon: 77.5643 },
  { name: "Seshadripuram", lat: 12.989, lon: 77.573 },
  { name: "Sadashivanagar", lat: 13.0068, lon: 77.5813 },
  // north-west
  { name: "Yeshwanthpur", lat: 13.0285, lon: 77.5409 },
  { name: "Mathikere", lat: 13.033, lon: 77.563 },
  { name: "Peenya", lat: 13.0285, lon: 77.5197 },
  { name: "Nagasandra", lat: 13.048, lon: 77.5 },
  { name: "Jalahalli", lat: 13.045, lon: 77.548 },
  { name: "Vidyaranyapura", lat: 13.079, lon: 77.555 },
  // north
  { name: "Sanjay Nagar", lat: 13.037, lon: 77.58 },
  { name: "RT Nagar", lat: 13.021, lon: 77.595 },
  { name: "Hebbal", lat: 13.0358, lon: 77.597 },
  { name: "Sahakar Nagar", lat: 13.063, lon: 77.587 },
  { name: "Yelahanka", lat: 13.1005, lon: 77.5963 },
  { name: "Jakkur", lat: 13.078, lon: 77.606 },
  { name: "Thanisandra", lat: 13.06, lon: 77.633 },
  { name: "Nagawara", lat: 13.04, lon: 77.62 },
  // north-east
  { name: "Hennur", lat: 13.045, lon: 77.644 },
  { name: "HBR Layout", lat: 13.035, lon: 77.63 },
  { name: "Kalyan Nagar", lat: 13.028, lon: 77.64 },
  { name: "Kammanahalli", lat: 13.0159, lon: 77.6379 },
  { name: "Banaswadi", lat: 13.0104, lon: 77.6482 },
  { name: "Horamavu", lat: 13.025, lon: 77.66 },
];

export const CITY_SUFFIX = ", Bengaluru";
/** "Indiranagar, Bengaluru" … — every area, as a search location. */
export const bangaloreLocations = (): string[] => BANGALORE_AREAS.map((a) => `${a.name}${CITY_SUFFIX}`);

const key = (s: string) => s.toLowerCase().replace(/,?\s*(bengaluru|bangalore)(,.*)?$/, "").replace(/[^a-z0-9]/g, "");
const byKey = new Map(BANGALORE_AREAS.map((a) => [key(a.name), a]));

/** The fixed centre of a Bangalore area ("Koramangala, Bengaluru" / "koramangala"), or null. */
export function areaCenter(location: string): { lat: number; lon: number; label: string } | null {
  const a = byKey.get(key(location));
  return a ? { lat: a.lat, lon: a.lon, label: `${a.name}${CITY_SUFFIX}` } : null;
}

/** The areas in today's order: starting at `offset`, wrapping round the city. */
export function rotateAreas(offset: number, list = bangaloreLocations()): string[] {
  const n = list.length;
  const o = ((Math.floor(offset) % n) + n) % n;
  return [...list.slice(o), ...list.slice(0, o)];
}

/** Where tomorrow's search starts: just after the last area today's search reached. */
export function nextOffset(prevOffset: number, areasSearched: number, n = BANGALORE_AREAS.length): number {
  return (((prevOffset + Math.max(1, Math.floor(areasSearched))) % n) + n) % n;
}
