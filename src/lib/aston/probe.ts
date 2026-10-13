import "server-only";

/**
 * A real HTTP check of a website. Used to confirm a production incident before
 * anyone is woken up, and to notice when a site has recovered. Read-only GET.
 */
export interface ProbeResult { ok: boolean; status: number | null; ms: number; error?: string }

/** Only public http(s) URLs — never localhost or private networks (no SSRF). */
export function probeAllowed(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || !h.includes(".") && !h.includes(":")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    if (h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function probe(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<ProbeResult> {
  const t0 = Date.now();
  if (!probeAllowed(url)) return { ok: false, status: null, ms: 0, error: "URL not allowed (public http/https only)." };
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "ASTON-monitor/1.0 (+uptime check)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 2xx/3xx = up. 401/403 = the site answered (it's just protected), also up.
    const up = res.status < 400 || res.status === 401 || res.status === 403;
    return { ok: up, status: res.status, ms: Date.now() - t0, ...(up ? {} : { error: `HTTP ${res.status}` }) };
  } catch (e) {
    const msg = /timeout|abort/i.test(String(e)) ? `No answer within ${Math.round(timeoutMs / 1000)}s` : "Could not connect";
    return { ok: false, status: null, ms: Date.now() - t0, error: msg };
  }
}

/** Confirm a failure: it must fail twice, a few seconds apart, before it counts. */
export async function confirmDown(url: string, fetchImpl: typeof fetch = fetch, gapMs = 4_000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ down: boolean; checks: ProbeResult[] }> {
  const first = await probe(url, fetchImpl);
  if (first.ok) return { down: false, checks: [first] };
  await sleep(gapMs);
  const second = await probe(url, fetchImpl);
  return { down: !second.ok, checks: [first, second] };
}
