/**
 * Google Maps links for DARWIN leads — built only from the lead's REAL stored
 * name, address and coordinates (nothing guessed).
 */

export interface MapLead {
  businessName: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const hasCoords = (l: MapLead) => typeof l.latitude === "number" && typeof l.longitude === "number";

/**
 * One business on Google Maps. "Name, address" opens the business's own listing
 * (reviews, photos, hours); without an address, the exact coordinates are used.
 */
export function googleMapsLeadUrl(l: MapLead): string | null {
  const q = l.location?.trim()
    ? `${l.businessName}, ${l.location.trim()}`
    : hasCoords(l) ? `${l.latitude},${l.longitude}` : l.businessName.trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/**
 * Several leads at once: Google Maps searched for the category, centred on the
 * leads (zoomed to fit them), so they show up together with their neighbours.
 */
export function googleMapsAreaUrl(leads: MapLead[], category: string, place?: string | null): string {
  const pts = leads.filter(hasCoords) as (MapLead & { latitude: number; longitude: number })[];
  const what = category.trim() || "businesses";
  if (!pts.length) {
    const q = place?.trim() ? `${what} in ${place.trim()}` : what;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  const lats = pts.map((p) => p.latitude);
  const lons = pts.map((p) => p.longitude);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
  // Widest spread in degrees → a zoom that keeps every lead on screen.
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * Math.cos((lat * Math.PI) / 180), 0.002);
  const zoom = Math.max(10, Math.min(16, Math.floor(Math.log2(360 / span)) - 1));
  return `https://www.google.com/maps/search/${encodeURIComponent(what)}/@${lat.toFixed(6)},${lon.toFixed(6)},${zoom}z`;
}
