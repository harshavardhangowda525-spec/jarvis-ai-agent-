import "server-only";
import { env } from "@/lib/env";

/**
 * DARWIN's data sources and whether each one is configured. Being configured is
 * not proof it works — /api/darwin/health makes a real test request to each.
 *
 * - Geoapify Places is the discovery source (businesses by category and area).
 * - Google Places, Foursquare and the web searches verify and complete what
 *   Geoapify found; they are not used to list businesses.
 * Nothing here ever fabricates a business.
 */

export interface SourceInfo {
  id: string;
  label: string;
  connected: boolean;
  kind: "api" | "import";
  /** discovery = finds businesses; verification = checks/completes them. */
  role: "discovery" | "verification";
}

export function listSources(): SourceInfo[] {
  return [
    { id: "geoapify", label: "Geoapify Places", kind: "api", role: "discovery", connected: env.geoapifyApiKey.length > 0 },
    { id: "google_places", label: "Google Places", kind: "api", role: "verification", connected: env.googlePlacesApiKey.length > 0 },
    { id: "foursquare", label: "Foursquare Places", kind: "api", role: "verification", connected: env.foursquareApiKey.length > 0 },
  ];
}
