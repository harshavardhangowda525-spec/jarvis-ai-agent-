import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => {
  process.env.GROQ_API_KEY = "gsk_unit_test_key_000000000000000000";
  process.env.ASTON_AI_MAX_RETRIES = "2";
  process.env.ASTON_AI_DAILY_CAP = "5";
});
import { groqChat, memoryStore, parseDuration, classify429, AstonAiUnavailable, type GroqDeps } from "@/lib/aston/groq";
import { signAstonEvent, verifyAstonEvent, signGithub, verifyGithub } from "@/lib/aston/signature";
import { parseGithub, parseGeneric, eventSchema } from "@/lib/aston/events";
import { parseChannels, parseWatchUrls, maxPriority } from "@/lib/aston/types";
import { probeAllowed, confirmDown } from "@/lib/aston/probe";
import { templateSummary } from "@/lib/aston/summary";
import { TwilioCallProvider, TestCallProvider } from "@/lib/aston/phone";

const reply = (content = "hi") => ({ id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content, refusal: null } }] }) as never;
const apiErr = (status: number, message = "", headers: Record<string, string> = {}) => Object.assign(new Error(message), { status, headers });

function harness(responses: Array<() => unknown>, store = memoryStore()) {
  let t = Date.parse("2026-10-09T10:00:00Z");
  const calls: unknown[] = [];
  const sleeps: number[] = [];
  const deps: Partial<GroqDeps> = {
    store,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    create: async (body) => {
      calls.push(body);
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next() as never;
    },
  };
  return { deps, calls, sleeps, store, advance: (ms: number) => { t += ms; } };
}

describe("ASTON · Groq provider rails", () => {
  it("parses Groq durations and classifies 429s", () => {
    expect(parseDuration("7m12.48s")).toBe(432_480);
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration("3")).toBe(3000);
    expect(classify429("Rate limit reached on tokens per day (TPD): Limit 200000. Please try again in 7m12.5s.", {})).toEqual({ daily: true, waitMs: 432_500 });
    expect(classify429("Rate limit reached on tokens per minute (TPM)", { "retry-after": "2" })).toEqual({ daily: false, waitMs: 2000 });
    expect(classify429("limit", { "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "1h" }).daily).toBe(true);
  });

  it("succeeds and records the remaining quota from Groq's headers", async () => {
    const h = harness([() => ({ data: reply("ok"), headers: { "x-ratelimit-remaining-requests": "998", "x-ratelimit-remaining-tokens": "7000" } })]);
    const r = await groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps });
    expect(r.choices[0].message.content).toBe("ok");
    expect(h.store.state).toMatchObject({ status: "ok", remainingRequests: 998, remainingTokens: 7000, requestsToday: 1 });
    expect((h.calls[0] as { model: string; reasoning_effort?: string }).model).toBe("openai/gpt-oss-120b");
    expect((h.calls[0] as { reasoning_effort?: string }).reasoning_effort).toBe("low");
  });

  it("waits out a short per-minute 429 once, then succeeds", async () => {
    const h = harness([() => { throw apiErr(429, "tokens per minute (TPM)", { "retry-after": "2" }); }, () => ({ data: reply(), headers: {} })]);
    await groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps });
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toEqual([2000]);
  });

  it("quota exhaustion: stops immediately, never retries, and blocks until the reset", async () => {
    const h = harness([() => { throw apiErr(429, "Rate limit reached for model on requests per day (RPD): Limit 1000, Used 1000. Please try again in 2h", {}); }]);
    const err = await groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps }).catch((e) => e);
    expect(err).toBeInstanceOf(AstonAiUnavailable);
    expect(err.reason).toBe("quota_exhausted");
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toHaveLength(0);
    // Every later call is refused locally — zero requests reach Groq.
    for (let i = 0; i < 3; i++) await expect(groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps })).rejects.toMatchObject({ reason: "quota_exhausted" });
    expect(h.calls).toHaveLength(1);
    h.advance(2 * 3_600_000 + 1000);
    h.deps.create = async () => ({ data: reply("back"), headers: {} });
    expect((await groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps })).choices[0].message.content).toBe("back");
  });

  it("provider outage: bounded retries with backoff, then a circuit breaker", async () => {
    const h = harness([1, 2, 3, 4, 5].map(() => () => { throw apiErr(503, "Service Unavailable"); }));
    await expect(groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps })).rejects.toMatchObject({ reason: "outage" });
    expect(h.calls).toHaveLength(3); // 1 + ASTON_AI_MAX_RETRIES (2)
    expect(h.sleeps).toHaveLength(2);
    expect(h.sleeps[1]).toBeGreaterThan(h.sleeps[0]);
    await expect(groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps })).rejects.toMatchObject({ reason: "outage" });
    expect(h.calls).toHaveLength(3);
  });

  it("a rejected key is reported without ever echoing the key", async () => {
    const h = harness([() => { throw apiErr(401, "Invalid API Key gsk_unit_test_key_000000000000000000"); }]);
    const err = await groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps }).catch((e) => e);
    expect(err.reason).toBe("auth_error");
    expect(String(err.message)).not.toContain("gsk_");
    expect(String(h.store.state.lastError)).not.toContain("gsk_");
  });

  it("does not retry a bad request (4xx) and enforces ASTON's own daily cap", async () => {
    const h = harness([() => { throw apiErr(400, "model_decommissioned"); }]);
    await expect(groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: h.deps })).rejects.toMatchObject({ reason: "request_error" });
    expect(h.calls).toHaveLength(1);
    const capped = harness([], memoryStore({ day: "2026-10-09", requestsToday: 5 }));
    await expect(groqChat({ messages: [{ role: "user", content: "x" }] }, { deps: capped.deps })).rejects.toMatchObject({ reason: "quota_exhausted" });
    expect(capped.calls).toHaveLength(0);
  });
});

describe("ASTON · signatures and events", () => {
  it("accepts only correctly signed, fresh events", () => {
    const body = JSON.stringify({ a: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyAstonEvent("s3cret", ts, signAstonEvent("s3cret", ts, body), body)).toBe(true);
    expect(verifyAstonEvent("s3cret", ts, signAstonEvent("wrong", ts, body), body)).toBe(false);
    expect(verifyAstonEvent("s3cret", ts, signAstonEvent("s3cret", ts, body), body + " ")).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(verifyAstonEvent("s3cret", old, signAstonEvent("s3cret", old, body), body)).toBe(false);
    expect(verifyGithub("gh", signGithub("gh", body), body)).toBe(true);
    expect(verifyGithub("gh", "sha256=00", body)).toBe(false);
    expect(verifyGithub("", signGithub("", body), body)).toBe(false);
  });

  it("maps GitHub failed builds/deployments to incidents and successes to resolutions", () => {
    const repo = { full_name: "infinity/site", default_branch: "main" };
    const fail = parseGithub("workflow_run", { action: "completed", repository: repo, workflow_run: { name: "CI", head_branch: "main", conclusion: "failure", html_url: "https://github.com/x", head_sha: "abcdef1234", head_commit: { message: "feat: x" } } });
    expect(fail).toMatchObject({ action: "raise", signal: { kind: "build_failed", priority: "high", project: "infinity/site" } });
    const ok = parseGithub("workflow_run", { action: "completed", repository: repo, workflow_run: { name: "CI", head_branch: "main", conclusion: "success" } });
    expect(ok.action).toBe("resolve");
    expect(fail.action === "raise" && ok.action === "resolve" && fail.signal.key === ok.signal.key).toBe(true);
    const feature = parseGithub("workflow_run", { action: "completed", repository: repo, workflow_run: { name: "CI", head_branch: "feat/x", conclusion: "failure" } });
    expect(feature.action === "raise" && feature.signal.priority).toBe("normal");
    expect(parseGithub("deployment_status", { repository: repo, deployment: { environment: "Production", sha: "1234567" }, deployment_status: { state: "failure", log_url: "https://vercel.com/x" } })).toMatchObject({ action: "raise", signal: { kind: "deploy_failed", priority: "high" } });
    expect(parseGithub("deployment_status", { repository: repo, deployment: { environment: "Production" }, deployment_status: { state: "success" } }).action).toBe("resolve");
    expect(parseGithub("issues", {}).action).toBe("ignore");
  });

  it("validates generic events", () => {
    const e = eventSchema.parse({ kind: "task_blocked", key: "T-1", title: "Waiting on client logo", project: "Café site" });
    expect(parseGeneric(e)).toMatchObject({ action: "raise", signal: { source: "webhook", kind: "task_blocked" } });
    expect(() => eventSchema.parse({ kind: "made_up", key: "x", title: "y" })).toThrow();
  });
});

describe("ASTON · helpers", () => {
  it("channels, watch URLs and priorities", () => {
    expect(parseChannels("browser,email,phone")).toEqual(["browser", "email"]);
    expect(parseChannels("none")).toEqual([]);
    expect(parseWatchUrls("Main|https://infinity.example, https://b.example, ftp://x, junk")).toEqual([
      { name: "Main", url: "https://infinity.example/" }, { name: "b.example", url: "https://b.example/" },
    ]);
    expect(maxPriority("high", "critical")).toBe("critical");
    expect(maxPriority("high", "normal")).toBe("high");
  });

  it("probes only public URLs and needs two failures to call a site down", async () => {
    for (const bad of ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://[::1]/", "file:///etc/passwd", "http://intranet"]) expect(probeAllowed(bad)).toBe(false);
    expect(probeAllowed("https://infinitywebapps.example")).toBe(true);
    let n = 0;
    const flaky = (async () => new Response("", { status: n++ === 0 ? 502 : 200 })) as unknown as typeof fetch;
    expect((await confirmDown("https://a.example", flaky, 0, async () => {})).down).toBe(false);
    const dead = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const r = await confirmDown("https://a.example", dead, 0, async () => {});
    expect(r.down).toBe(true);
    expect(r.checks).toHaveLength(2);
  });

  it("the no-AI alert text is built from the recorded facts", () => {
    const t = templateSummary({ priority: "critical", project: "Infinity Web & Apps", title: "Site is down", detail: "Failed two checks. More text.", kind: "prod_incident", recommendation: null });
    expect(t.summary).toBe("Critical — Infinity Web & Apps: Site is down. Failed two checks.");
    expect(t.recommendation).toMatch(/roll back/i);
  });
});

describe("ASTON · phone providers", () => {
  it("the test provider never dials", async () => {
    const p = new TestCallProvider();
    const r = await p.place("+910000000000", "hello");
    expect(p.live).toBe(false);
    expect(r.ref).toMatch(/^test-/);
  });

  it("Twilio: Basic auth with API key, escaped TwiML, errors without credentials", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ sid: "CA123" }), { status: 201 });
    }) as unknown as typeof fetch;
    const p = new TwilioCallProvider({ accountSid: "AC_test", apiKey: "SK_test", apiSecret: "secret_value", from: "+15550000000" }, f);
    expect((await p.place("+919999999999", "Site <down> & out")).ref).toBe("CA123");
    expect(seen[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Calls.json");
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("SK_test:secret_value").toString("base64")}`);
    const form = new URLSearchParams(String(seen[0].init.body));
    expect(form.get("Twiml")).toContain("Site &lt;down&gt; &amp; out");
    const bad = new TwilioCallProvider({ accountSid: "AC_test", apiKey: "SK_test", apiSecret: "secret_value", from: "+1" }, (async () => new Response(JSON.stringify({ code: 21219, message: "The number is unverified. Trial accounts cannot call unverified numbers" }), { status: 400 })) as unknown as typeof fetch);
    const err = await bad.place("+91", "x").catch((e) => e);
    expect(err.message).toContain("21219");
    expect(err.message).not.toContain("secret_value");
  });
});
