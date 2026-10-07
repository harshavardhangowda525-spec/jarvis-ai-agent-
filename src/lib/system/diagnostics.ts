import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { env, capabilities, type AiConfig } from "@/lib/env";
import { agentConfigs } from "@/lib/ai/agent";
import { getLiveBrain } from "@/lib/ai/brain";
import { availableTools } from "@/lib/tools/registry";
import { configuredProviders } from "@/lib/darwin/web-search";
import { todayRun } from "@/lib/darwin/daily/run";
import { todayIgRun } from "@/lib/darwin/instagram/run";
import { emailChannelReady } from "@/lib/darwin/email";
import { resolveIgCreds } from "@/lib/ev/instagram";
import { faceIdSummary, attemptState } from "@/lib/gate/server";
import {
  STAGE_LABEL, nodeVerdict,
  type CheckStatus, type ClientProbe, type NodeId, type ScanEvent, type StageId,
} from "./types";

/**
 * JARVIS's read-only system analysis. Each check looks at something real, right
 * now: the database, each AI provider's own model list (a free call — no tokens
 * spent), each agent's configuration, its latest run and its failures in the
 * last 24 hours, the connections between agents, storage, and the server's
 * framework version. Nothing is changed, nothing is sent, and no result is
 * assumed: a check that can't run says so.
 */

type Result = { status: CheckStatus; detail: string };
interface Spec { stage: StageId; node: NodeId; label: string; run: () => Promise<Result> }

export interface DiagnosticDeps {
  fetch: typeof fetch;
  now: () => number;
}
const defaultDeps = (): DiagnosticDeps => ({ fetch: (...a) => fetch(...a), now: () => Date.now() });

const ok = (detail: string): Result => ({ status: "ok", detail });
const warn = (detail: string): Result => ({ status: "warn", detail });
const fail = (detail: string): Result => ({ status: "fail", detail });
const info = (detail: string): Result => ({ status: "info", detail });

const PROVIDER_LABEL: Record<string, string> = { groq: "Groq", gemini: "Gemini", cerebras: "Cerebras", openrouter: "OpenRouter", openai: "OpenAI", anthropic: "Claude", ollama: "PC brain (Ollama)" };
const plabel = (p: string) => PROVIDER_LABEL[p] ?? p;
const AGENT_LOG_NAME: Record<string, string> = { ev: "EV", darwin: "DARWIN", mike: "MIKE", rubin: "RUBIN" };
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

/** A provider's own model list: proves the key works and the configured model exists. */
async function probeProvider(cfg: AiConfig, deps: DiagnosticDeps): Promise<Result> {
  const t0 = deps.now();
  const anthropic = cfg.kind === "anthropic";
  const url = anthropic ? "https://api.anthropic.com/v1/models?limit=100" : `${(cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = anthropic
    ? { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.headers ?? {}) };
  try {
    const res = await deps.fetch(url, { headers, signal: AbortSignal.timeout(7000), cache: "no-store" });
    const ms = deps.now() - t0;
    if (res.status === 401) return fail("rejected the API key (HTTP 401)");
    if (res.status === 403) return fail("refused access (HTTP 403) — the key, its plan, or a network block");
    if (res.status === 429) return warn(`rate-limited right now (HTTP 429) — ${ms} ms`);
    if (!res.ok) return warn(`answered HTTP ${res.status} (${ms} ms)`);
    const j = (await res.json().catch(() => null)) as { data?: { id?: string }[]; models?: { name?: string }[] } | null;
    const ids = [...(j?.data ?? []).map((m) => String(m.id ?? "")), ...(j?.models ?? []).map((m) => String(m.name ?? ""))].filter(Boolean);
    if (!ids.length) return ok(`reachable · ${ms} ms`);
    const has = ids.some((id) => id === cfg.model || id.endsWith(`/${cfg.model}`) || cfg.model.endsWith(`/${id}`));
    return has ? ok(`reachable · ${cfg.model} available · ${ms} ms`) : warn(`reachable, but its model list has no "${cfg.model}" — check the model setting (${ms} ms)`);
  } catch (e) {
    return fail((e as Error)?.name === "TimeoutError" ? "didn't answer within 7 s" : "unreachable");
  }
}

async function brainChain(agent: "jarvis" | "ev" | "darwin" | "mike" | "robin", userId: string): Promise<Result> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const pick = agentConfigs(agent, brain);
  if (!pick.configs.length) return fail(pick.missing ?? "no AI provider configured");
  return ok(pick.configs.map((c) => `${plabel(c.provider)} (${c.model})`).join(" → "));
}

async function failures24h(userId: string, agent: string, now: number): Promise<Result> {
  const rows = await getDb().activityEvent.findMany({
    where: { userId, agent, status: "failed", timestamp: { gte: new Date(now - 86_400_000) } },
    orderBy: { timestamp: "desc" }, take: 50, select: { action: true, result: true },
  });
  if (!rows.length) return ok("no failures in the last 24 h");
  const last = (rows[0].result || rows[0].action || "").replace(/\s+/g, " ").slice(0, 140);
  return warn(`${rows.length} failure${rows.length === 1 ? "" : "s"} in the last 24 h — latest: ${last}`);
}

function nextVersion(): string | null {
  try {
    const p = path.join(process.cwd(), "node_modules", "next", "package.json");
    return (JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string }).version ?? null;
  } catch { return null; }
}
const vnum = (v: string) => v.split(/[.-]/).slice(0, 3).map((x) => Number(x) || 0);
const vlt = (a: string, b: string) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };

/** Every check of a run, in order (the count is known before the first one starts). */
export function plan(userId: string, probe: ClientProbe, deps: DiagnosticDeps): Spec[] {
  const db = getDb();
  const specs: Spec[] = [];
  const add = (stage: StageId, node: NodeId, label: string, run: () => Promise<Result>) => specs.push({ stage, node, label, run });

  // ---------------- core ----------------
  add("core", "core", "Database", async () => {
    const t0 = deps.now();
    try { await db.$queryRaw`SELECT 1`; return ok(`connected · ${deps.now() - t0} ms`); } catch { return fail("can't reach the database"); }
  });
  add("core", "core", "Sign-in secret", async () =>
    !env.authSecret ? fail("AUTH_SECRET is not set") : env.authSecret.length < 32 ? warn(`set, but short (${env.authSecret.length} characters; 32+ recommended)`) : ok("set"));
  add("core", "core", "JARVIS brain routing", () => brainChain("jarvis", userId));
  // each AI provider any agent uses, checked once
  const seen = new Map<string, AiConfig>();
  const brainP = getLiveBrain(userId).catch(() => null);
  for (const a of ["jarvis", "ev", "darwin", "mike", "robin"] as const) {
    // the cloud providers come from the environment (the PC brain is checked on its own below)
    for (const c of agentConfigs(a, null).configs) if (!seen.has(c.provider)) seen.set(c.provider, c);
  }
  for (const [p, c] of seen) add("core", "core", `AI provider · ${plabel(p)}`, () => probeProvider(c, deps));
  add("core", "core", "PC brain (Ollama)", async () => {
    const b = await brainP;
    if (!b) return info("offline — the cloud providers answer");
    const pick = agentConfigs("jarvis", b).configs.find((c) => c.provider === "ollama");
    return pick ? probeProvider(pick, deps) : info(`online at its tunnel · model ${b.model ?? "default"}`);
  });
  add("core", "core", "Tools", async () => {
    const n = availableTools().length;
    const since = new Date(deps.now() - 86_400_000);
    const rows = await db.toolLog.groupBy({ by: ["tool", "status"], where: { userId, createdAt: { gte: since } }, _count: true });
    const total = rows.reduce((s, r) => s + r._count, 0);
    const errs = rows.filter((r) => r.status === "error");
    const errN = errs.reduce((s, r) => s + r._count, 0);
    if (total >= 4 && errN / total > 0.25) {
      const worst = errs.sort((a, b) => b._count - a._count)[0];
      return warn(`${n} tools · ${errN} of ${total} calls failed in 24 h (most: ${worst.tool})`);
    }
    return ok(`${n} tools available · ${total} call${total === 1 ? "" : "s"} in 24 h, ${errN} failed`);
  });

  // ---------------- agents ----------------
  add("agents", "ev", "EV brain", () => brainChain("ev", userId));
  add("agents", "ev", "Image & video generation", async () => {
    const parts = [capabilities.evImage && "images", capabilities.magicHour && "video (Magic Hour)"].filter(Boolean);
    return parts.length ? ok(parts.join(" + ")) : warn("no image or video generation configured");
  });
  add("agents", "ev", "Instagram", async () => ((await resolveIgCreds(userId).catch(() => null)) ? ok("connected") : info("not connected — EV can't publish")));
  add("agents", "ev", "Today's content", async () => {
    const d = await db.evDaily.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { date: true, status: true, error: true, publishError: true } });
    if (!d) return info("no daily content yet");
    const err = d.publishError || d.error;
    return err ? warn(`${d.date}: ${d.status} — ${err.replace(/\s+/g, " ").slice(0, 140)}`) : ok(`${d.date}: ${d.status}`);
  });
  add("agents", "ev", "Failures (24 h)", () => failures24h(userId, AGENT_LOG_NAME.ev, deps.now()));

  add("agents", "darwin", "DARWIN brain", () => brainChain("darwin", userId));
  add("agents", "darwin", "Business listings (Geoapify)", async () => (env.geoapifyApiKey ? ok("configured") : fail("GEOAPIFY_API_KEY isn't set — DARWIN can't search")));
  add("agents", "darwin", "Verification search", async () => {
    const ps = configuredProviders().map((p) => p.label);
    const g = env.googlePlacesApiKey ? "Google Places" : null;
    const all = [g, ...ps].filter(Boolean);
    return all.length ? ok(all.join(" · ")) : warn("no Google Places or web search — leads can't be confirmed");
  });
  add("agents", "darwin", "Today's search", async () => {
    const r = await todayRun(userId, new Date(deps.now()));
    if (!r) return info("not started yet today");
    const line = `${r.status} · ${r.verified}/${r.target} verified`;
    return r.lastError ? warn(`${line} — ${r.lastError.replace(/\s+/g, " ").slice(0, 160)}`) : r.status === "needs_setup" ? warn(`${line} — needs setup`) : ok(line);
  });
  add("agents", "darwin", "Instagram + No Website", async () => {
    if (!env.darwinIg) return info("turned off (DARWIN_INSTAGRAM=off)");
    const r = await todayIgRun(userId, new Date(deps.now()));
    if (!r) return info("waits for today's daily target to be complete");
    const line = `${r.status} · ${r.saved}/${r.target} verified`;
    return r.lastError ? warn(`${line} — ${r.lastError.slice(0, 160)}`) : ok(line);
  });
  add("agents", "darwin", "Failures (24 h)", () => failures24h(userId, AGENT_LOG_NAME.darwin, deps.now()));

  add("agents", "mike", "MIKE brain", () => brainChain("mike", userId));
  add("agents", "mike", "Market data (Binance)", async () => {
    const t0 = deps.now();
    try {
      const res = await deps.fetch("https://api.binance.com/api/v3/ping", { signal: AbortSignal.timeout(6000), cache: "no-store" });
      return res.ok ? ok(`reachable · ${deps.now() - t0} ms`) : warn(`answered HTTP ${res.status}`);
    } catch (e) { return fail((e as Error)?.name === "TimeoutError" ? "didn't answer within 6 s" : "unreachable"); }
  });
  add("agents", "mike", "Journal", async () => {
    const open = await db.mikeSignal.count({ where: { userId, status: { in: ["open", "triggered"] } } });
    return info(`${open} open setup${open === 1 ? "" : "s"} being tracked`);
  });
  add("agents", "mike", "Failures (24 h)", () => failures24h(userId, AGENT_LOG_NAME.mike, deps.now()));

  add("agents", "rubin", "RUBIN brain", () => brainChain("robin", userId));
  add("agents", "rubin", "CRM", async () => {
    const n = await db.robinLead.count({ where: { userId } });
    return ok(`${n} lead${n === 1 ? "" : "s"} in the pipeline`);
  });
  add("agents", "rubin", "Failures (24 h)", () => failures24h(userId, AGENT_LOG_NAME.rubin, deps.now()));

  add("agents", "ultron", "Local runtime", async () => {
    const u = probe.ultron;
    if (!u || !u.known) return info("not used from this device — checked only where it runs");
    if (!u.reachable) return warn("not reachable from this page — not running (start npm run local), or this site isn't in ULTRON_ALLOWED_ORIGINS");
    return ok(`running on this computer${u.brain ? ` · brain ${u.brain}` : ""}${u.ms != null ? ` · ${u.ms} ms` : ""}`);
  });

  add("agents", "voice", "Speech (ElevenLabs)", async () => {
    if (!env.elevenLabsApiKey) return info("not configured — the browser's own voice is used");
    try {
      const res = await deps.fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": env.elevenLabsApiKey }, signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (res.status === 401 || res.status === 403) return fail(`rejected the API key (HTTP ${res.status})`);
      if (!res.ok) return warn(`answered HTTP ${res.status}`);
      const j = (await res.json().catch(() => null)) as { character_count?: number; character_limit?: number } | null;
      if (j?.character_limit) {
        const pct = Math.round(((j.character_count ?? 0) / j.character_limit) * 100);
        return pct >= 90 ? warn(`${pct}% of this month's characters used`) : ok(`reachable · ${pct}% of this month's characters used`);
      }
      return ok("reachable");
    } catch (e) { return fail((e as Error)?.name === "TimeoutError" ? "didn't answer within 6 s" : "unreachable"); }
  });
  add("agents", "voice", "Voice models", async () => info(`speech ${env.elevenLabsModelId} · transcription ${env.elevenLabsSttModelId}`));

  // ---------------- connections ----------------
  add("connections", "darwin", "Gmail (DARWIN's email)", async () => ((await emailChannelReady(userId).catch(() => false)) ? ok("connected — can send") : info("not connected — DARWIN can't email")));
  add("connections", "rubin", "DARWIN → RUBIN handover", async () => {
    const [d, r] = await Promise.all([db.darwinLead.count({ where: { userId } }), db.robinLead.count({ where: { userId, source: "darwin" } })]);
    if (!d) return info("no DARWIN leads yet");
    return r === 0 ? warn(`${d} DARWIN leads, none handed to RUBIN yet`) : ok(`${r} of ${d} DARWIN leads are in RUBIN`);
  });
  add("connections", "core", "Shared memory", async () => {
    const n = await db.memory.count({ where: { userId } });
    return ok(`${n} memor${n === 1 ? "y" : "ies"} shared by every agent`);
  });

  // ---------------- performance ----------------
  add("performance", "core", "Database latency", async () => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) { const t0 = deps.now(); await db.$queryRaw`SELECT 1`; times.push(deps.now() - t0); }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    return avg < 150 ? ok(`${avg} ms average`) : avg < 600 ? warn(`${avg} ms average — slow`) : fail(`${avg} ms average — very slow`);
  });
  add("performance", "core", "Tool speed (24 h)", async () => {
    const rows = await db.toolLog.groupBy({ by: ["tool"], where: { userId, createdAt: { gte: new Date(deps.now() - 86_400_000) }, durationMs: { not: null } }, _avg: { durationMs: true }, _count: true });
    if (!rows.length) return info("no tool calls in the last 24 h");
    const slow = rows.sort((a, b) => (b._avg.durationMs ?? 0) - (a._avg.durationMs ?? 0))[0];
    const ms = Math.round(slow._avg.durationMs ?? 0);
    return ms > 15_000 ? warn(`slowest: ${slow.tool} averages ${(ms / 1000).toFixed(1)} s`) : ok(`slowest: ${slow.tool} averages ${(ms / 1000).toFixed(1)} s`);
  });
  add("performance", "core", "Database size", async () => {
    const r = await db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
    const bytes = Number(r[0]?.size ?? 0);
    return bytes > 400 * 1024 * 1024 ? warn(`${mb(bytes)} — close to a 512 MB free-tier limit`) : ok(mb(bytes));
  });
  add("performance", "core", "Media kept in the database", async () => {
    const r = await db.$queryRaw<{ size: bigint }[]>`SELECT pg_total_relation_size('"EvMedia"') AS size`;
    const bytes = Number(r[0]?.size ?? 0);
    const n = await db.evMedia.count();
    return bytes > 150 * 1024 * 1024 ? warn(`${n} files, ${mb(bytes)} — nothing is ever removed`) : info(`${n} files, ${mb(bytes)}`);
  });

  // ---------------- security ----------------
  add("security", "core", "Web framework (Next.js)", async () => {
    const v = nextVersion();
    if (!v) return info("version unknown");
    if (vlt(v, "14.2.25")) return fail(`${v} — a crafted request header can get past the lock screen on a self-hosted server (CVE-2025-29927); upgrade`);
    return vlt(v, "15.5.24") ? warn(`${v} — has published security advisories; upgrade`) : ok(v);
  });
  // sign-up has no allow-list in this version (src/app/api/auth/signup) — a real risk for a personal JARVIS
  add("security", "core", "Accounts", async () => {
    const n = await db.user.count();
    return warn(`${n} account${n === 1 ? "" : "s"} · sign-up is open to anyone who finds this server`);
  });
  add("security", "core", "Lock screen", async () => {
    const [f, a] = await Promise.all([faceIdSummary(userId), attemptState(userId)]);
    const parts = [f.enrolled ? "Face ID enrolled" : f.outdated ? "Face ID needs re-enrolling" : "no Face ID", a.pinSet ? "PIN set" : "no PIN"];
    return f.outdated ? warn(parts.join(" · ")) : ok(parts.join(" · "));
  });

  return specs;
}

/** Run the analysis, yielding each step as it happens. */
export async function* runDiagnostics(userId: string, probe: ClientProbe, deps: DiagnosticDeps = defaultDeps()): AsyncGenerator<ScanEvent> {
  const t0 = deps.now();
  const specs = plan(userId, probe, deps);
  const left = new Map<NodeId, number>();
  for (const s of specs) left.set(s.node, (left.get(s.node) ?? 0) + 1);
  const statuses = new Map<NodeId, CheckStatus[]>();
  const summary = { ok: 0, warn: 0, fail: 0, info: 0 };
  yield { type: "start", total: specs.length, at: new Date(t0).toISOString() };
  let stage: StageId | null = null, focus: NodeId | null = null;
  for (const s of specs) {
    if (s.stage !== stage) { stage = s.stage; focus = null; yield { type: "stage", stage, label: STAGE_LABEL[stage] }; }
    if (s.node !== focus) { focus = s.node; yield { type: "focus", node: s.node }; }
    const c0 = deps.now();
    let r: Result;
    try { r = await s.run(); } catch (e) { r = fail(`check couldn't run (${(e as Error)?.message?.replace(/\s+/g, " ").slice(0, 100) || "error"})`); }
    summary[r.status]++;
    statuses.set(s.node, [...(statuses.get(s.node) ?? []), r.status]);
    yield { type: "check", node: s.node, stage: s.stage, label: s.label, status: r.status, detail: r.detail, ms: deps.now() - c0 };
    const n = (left.get(s.node) ?? 1) - 1;
    left.set(s.node, n);
    if (n === 0) yield { type: "node", node: s.node, state: nodeVerdict(statuses.get(s.node) ?? []) };
  }
  yield { type: "done", summary, durationMs: deps.now() - t0 };
}
