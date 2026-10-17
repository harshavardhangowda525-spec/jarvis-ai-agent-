/**
 * The HTTP layer every DARWIN data provider goes through: a timeout on every
 * request, retries with exponential backoff for TRANSIENT failures only
 * (network drop, timeout, HTTP 5xx, HTTP 429 that isn't a used-up quota), and
 * one classification of what went wrong. Secrets never reach a log or an error
 * message: URLs are reported without their query string.
 */

export type ProviderState =
  | "ready"            // a real test request succeeded
  | "not_configured"   // no key set
  | "auth_failed"      // the key was rejected
  | "rate_limited"     // too many requests right now — try again shortly
  | "quota_exhausted"  // the plan's daily/monthly allowance is used up
  | "billing_required" // the provider needs billing enabled on the account
  | "provider_error"   // the provider answered with an error (4xx/5xx)
  | "unreachable";     // network / DNS / timeout — never got an answer

export const STATE_LABEL: Record<ProviderState, string> = {
  ready: "Ready", not_configured: "Not configured", auth_failed: "Authentication failed", rate_limited: "Rate limited",
  quota_exhausted: "Quota exhausted", billing_required: "Billing required", provider_error: "Provider error", unreachable: "Unreachable",
};

export class ProviderHttpError extends Error {
  constructor(message: string, public state: ProviderState, public status: number | null) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** Decide what a failed answer means from its status and (provider-specific) body text. */
export function classify(status: number, bodyText: string): ProviderState {
  const t = bodyText.toLowerCase();
  if (/billing|payment (is )?required|enable billing|billing account/.test(t)) return "billing_required";
  if (status === 402 || /quota|credits? (are )?(exhausted|exceeded|used up)|daily limit|monthly limit|limit (has been )?exceeded|out of credits/.test(t)) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403 || /invalid (api )?key|api key (is )?(invalid|not valid|missing)|unauthori[sz]ed|forbidden|permission denied/.test(t)) return "auth_failed";
  return "provider_error";
}

const transient = (s: ProviderState) => s === "rate_limited" || s === "unreachable";

/** A URL safe to show: host + path, never the query (that's where API keys live). */
export function safeUrl(url: string): string {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return "(url)"; }
}

export interface FetchOpts {
  provider: string;
  init?: RequestInit;
  timeoutMs?: number;
  /** Total attempts (1 = no retry). */
  attempts?: number;
  /** First backoff; doubles each retry (plus jitter). */
  backoffMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * GET/POST with timeout + bounded retries. Resolves with the parsed JSON of a
 * 2xx answer; throws ProviderHttpError with a classified state otherwise. A 5xx
 * is retried (as "provider_error" it's often transient); quota, auth and
 * billing failures are never retried — retrying can't fix them.
 */
export async function fetchJson<T = any>(url: string, o: FetchOpts): Promise<T> {
  const attempts = Math.max(1, o.attempts ?? 3);
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: ProviderHttpError | null = null;
  let retryAfterMs = 0;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const wait = Math.max(retryAfterMs, (o.backoffMs ?? 600) * 2 ** (i - 1)) + Math.floor(Math.random() * 200);
      await sleep(Math.min(wait, 10_000));
    }
    let res: Response;
    try {
      res = await f(url, { ...o.init, headers: { accept: "application/json", ...(o.init?.headers ?? {}) }, signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      last = new ProviderHttpError(`${o.provider}: ${timedOut ? "timed out" : "couldn't connect"} (${safeUrl(url)})`, "unreachable", null);
      continue;
    }
    const text = await res.text().catch(() => "");
    if (res.ok) {
      try { return (text ? JSON.parse(text) : {}) as T; } catch { throw new ProviderHttpError(`${o.provider}: answered with something that isn't JSON`, "provider_error", res.status); }
    }
    const state = classify(res.status, text);
    const ra = Number(res.headers.get("retry-after"));
    retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
    let detail = "";
    try { const j = JSON.parse(text); detail = String(j?.message || j?.error?.message || j?.error || j?.detail || "").slice(0, 160); } catch { detail = text.slice(0, 120); }
    last = new ProviderHttpError(`${o.provider}: ${STATE_LABEL[state].toLowerCase()} (HTTP ${res.status}${detail ? ` — ${detail}` : ""})`, state, res.status);
    // retry only what time can fix: rate limits, timeouts and 5xx
    if (!(transient(state) || (state === "provider_error" && res.status >= 500))) break;
  }
  throw last!;
}
