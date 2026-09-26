/**
 * Which official NIOS pages JARVIS watches. Only pages on nios.ac.in are ever
 * fetched (the list can't be pointed at other hosts). Client-safe.
 */
export interface NiosSource { key: string; label: string; url: string }

export const DEFAULT_SOURCES: NiosSource[] = [
  { key: "main", label: "NIOS", url: "https://www.nios.ac.in/" },
  { key: "sdmis", label: "Secondary & Sr. Secondary", url: "https://sdmis.nios.ac.in/registration/home-notifications" },
  { key: "voc", label: "Vocational", url: "https://voc.nios.ac.in/registration/home-notifications" },
  { key: "results", label: "Results", url: "https://results.nios.ac.in/" },
  { key: "rc-bengaluru", label: "Regional Centre Bengaluru", url: "https://rcbengaluru.nios.ac.in/notification.html" },
];

/** "bengaluru" → the Bengaluru regional centre's notification page. */
export function regionalSource(name: string): NiosSource | null {
  const t = name.trim().toLowerCase().replace(/\s+/g, "");
  if (!/^(rc)?[a-z]{3,20}$/.test(t)) return null;
  const n = t.replace(/^rc(?=[a-z]{3})/, "");
  return { key: `rc-${n}`, label: `Regional Centre ${n[0].toUpperCase()}${n.slice(1)}`, url: `https://rc${n}.nios.ac.in/notification.html` };
}

/** True only for https pages on nios.ac.in (or a subdomain). */
export function isNiosUrl(u: string): boolean {
  try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === "nios.ac.in" || x.hostname.endsWith(".nios.ac.in")); }
  catch { return false; }
}

export function sourcesFor(opts: { regions?: string[]; envRegions?: string; extraUrls?: string }): NiosSource[] {
  const out = [...DEFAULT_SOURCES];
  const regions = [...(opts.regions ?? []), ...(opts.envRegions ?? "").split(",")];
  for (const r of regions) { const s = r && regionalSource(r); if (s && !out.some((o) => o.key === s.key)) out.push(s); }
  (opts.extraUrls ?? "").split(",").map((u) => u.trim()).filter(isNiosUrl).forEach((url) => {
    if (!out.some((o) => o.url === url)) out.push({ key: `x:${url}`, label: new URL(url).hostname, url });
  });
  return out;
}
