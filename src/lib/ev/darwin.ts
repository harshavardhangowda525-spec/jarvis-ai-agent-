import "server-only";
import { env } from "@/lib/env";

/**
 * DARWIN = lead-discovery agent. EV consumes REAL leads from DARWIN via an HTTP
 * service. If DARWIN isn't configured (no DARWIN_API_URL), EV honestly reports
 * that lead discovery isn't wired — it NEVER fabricates businesses or numbers.
 */

export interface DarwinLead {
  id?: string;
  name?: string;
  category?: string;
  niche?: string;
  location?: string;
  phone?: string;
  instagram?: string;
  website?: string;
  [k: string]: unknown;
}

export function darwinConfigured(): boolean {
  return env.darwinApiUrl.length > 0;
}

export class DarwinError extends Error {}

/**
 * Fetch leads from DARWIN. Returns real rows from the service. Throws
 * DarwinError with a clear message when unavailable — the tool surfaces that
 * honestly rather than inventing data.
 */
export async function darwinFetchLeads(opts: {
  niche?: string;
  location?: string;
  limit?: number;
}): Promise<DarwinLead[]> {
  if (!darwinConfigured()) {
    throw new DarwinError("DARWIN lead discovery is not connected (DARWIN_API_URL is not set).");
  }
  const url = new URL(env.darwinApiUrl.replace(/\/$/, "") + "/leads");
  if (opts.niche) url.searchParams.set("niche", opts.niche);
  if (opts.location) url.searchParams.set("location", opts.location);
  url.searchParams.set("limit", String(Math.min(opts.limit ?? 20, 100)));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.darwinApiKey) headers.Authorization = `Bearer ${env.darwinApiKey}`;

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new DarwinError("Couldn't reach the DARWIN service.");
  }
  if (!res.ok) throw new DarwinError(`DARWIN returned HTTP ${res.status}.`);

  const json: any = await res.json().catch(() => null);
  const rows: DarwinLead[] = Array.isArray(json) ? json : json?.leads ?? json?.data ?? [];
  if (!Array.isArray(rows)) throw new DarwinError("DARWIN returned an unexpected response shape.");
  return rows;
}
