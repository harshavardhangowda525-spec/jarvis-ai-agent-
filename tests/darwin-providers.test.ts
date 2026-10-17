import { describe, expect, it, vi } from "vitest";
import { classify, fetchJson, ProviderHttpError, safeUrl } from "@/lib/darwin/providers/http";

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const noSleep = async () => {};

describe("provider error classification", () => {
  it("tells auth, quota, billing and rate limits apart", () => {
    expect(classify(401, "Invalid apiKey")).toBe("auth_failed");
    expect(classify(403, "")).toBe("auth_failed");
    expect(classify(402, "")).toBe("quota_exhausted");
    expect(classify(429, "Daily quota exceeded")).toBe("quota_exhausted");
    expect(classify(429, "Too many requests")).toBe("rate_limited");
    expect(classify(403, '{"error":{"message":"This API method requires billing to be enabled."}}')).toBe("billing_required");
    expect(classify(500, "oops")).toBe("provider_error");
  });

  it("never shows the query string (where API keys live)", () => {
    expect(safeUrl("https://api.geoapify.com/v2/places?apiKey=SECRET123&limit=1")).toBe("api.geoapify.com/v2/places");
  });
});

describe("fetchJson retries", () => {
  it("retries a 5xx and a network drop, then succeeds", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(503, "busy"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(res(200, { ok: 1 }));
    await expect(fetchJson("https://x.test/a?apiKey=k", { provider: "X", fetchImpl: f as never, sleep: noSleep })).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("never retries a rejected key or a used-up quota", async () => {
    for (const [status, state] of [[401, "auth_failed"], [402, "quota_exhausted"]] as const) {
      const f = vi.fn().mockResolvedValue(res(status, { message: "nope" }));
      const err = await fetchJson("https://x.test/a", { provider: "X", fetchImpl: f as never, sleep: noSleep }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.state).toBe(state);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after the attempts on a persistent rate limit, honouring Retry-After", async () => {
    const waits: number[] = [];
    const f = vi.fn().mockResolvedValue(res(429, "slow down", { "retry-after": "2" }));
    const err = await fetchJson("https://x.test/a", { provider: "X", attempts: 3, fetchImpl: f as never, sleep: async (ms) => { waits.push(ms); } }).catch((e) => e);
    expect(err.state).toBe("rate_limited");
    expect(f).toHaveBeenCalledTimes(3);
    expect(waits.every((w) => w >= 2000)).toBe(true);
  });

  it("an error message never contains the key", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const err = await fetchJson("https://api.geoapify.com/v1/geocode/search?apiKey=TOPSECRET", { provider: "Geoapify", attempts: 1, fetchImpl: f as never, sleep: noSleep }).catch((e) => e);
    expect(err.state).toBe("unreachable");
    expect(err.message).not.toContain("TOPSECRET");
  });
});

describe("provider health", () => {
  it("reports each state from a real-shaped answer, and Not configured without a key", async () => {
    const { providerHealth } = await import("@/lib/darwin/providers/health");
    const mk = (id: string, configured: boolean, probe: () => Promise<string>) => ({ id, label: id, role: "discovery" as const, purpose: "", envVar: "K", configured: () => configured, probe, fix: {} });
    const out = await providerHealth({ checks: [
      mk("a", true, async () => "fine"),
      mk("b", true, async () => { throw new ProviderHttpError("X: quota", "quota_exhausted", 429); }),
      mk("c", false, async () => "never called"),
    ] });
    expect(out.map((h) => [h.id, h.state])).toEqual([["a", "ready"], ["b", "quota_exhausted"], ["c", "not_configured"]]);
    expect(out[1].stateLabel).toBe("Quota exhausted");
  });
});
