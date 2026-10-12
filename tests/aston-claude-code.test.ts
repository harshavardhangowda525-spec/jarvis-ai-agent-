import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const H = vi.hoisted(() => {
  process.env.ASTON_OWNER_EMAIL = "aston-claude-owner@example.com";
  process.env.GROQ_API_KEY = "gsk_claude_test_key_00000000000000000000";
  delete process.env.ASTON_SITE_ENGINE;
  delete process.env.ASTON_CLAUDE_CODE;
  delete process.env.VERCEL;
  class UnauthorizedError extends Error {}
  return { user: null as null | { id: string; email: string }, UnauthorizedError };
});
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: H.UnauthorizedError,
  getCurrentUser: async () => H.user,
  requireUser: async () => { if (!H.user) throw new H.UnauthorizedError("Unauthorized"); return H.user; },
}));

import { getDb, isDbConfigured } from "@/lib/db";
import { childEnv, classify, claudeStatus, claudeStream, disabledReason, fromMessages, type ClaudeDeps } from "@/lib/aston/site/claude-code";

type Call = { cmd: string; args: string[]; env: Record<string, string | undefined>; cwd: string; stdin: string; shell: boolean };

/** A stand-in `claude` CLI: answers `auth status`, and streams `-p` replies as stream-json. */
function fakeClaude(o: { status?: object | null; reply?: (system: string, user: string) => string; fail?: string; missing?: boolean } = {}) {
  const calls: Call[] = [];
  const spawn = (cmd: string, args: string[], opts: { env?: Record<string, string | undefined>; cwd?: string; shell?: boolean }) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void };
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    const call: Call = { cmd, args, env: opts.env ?? {}, cwd: String(opts.cwd), stdin: "", shell: !!opts.shell };
    calls.push(call);
    if (o.missing) { setTimeout(() => child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })), 0); return child; }
    if (args[0] === "auth") {
      setTimeout(() => { child.stdout.end(JSON.stringify(o.status ?? { loggedIn: true, authMethod: "claude.ai", email: "owner@example.com" })); child.emit("close", o.status === null ? 1 : 0); }, 0);
      return child;
    }
    let input = "";
    child.stdin.on("data", (b) => { input += b.toString(); });
    child.stdin.on("end", async () => {
      call.stdin = input;
      const sysFile = args[args.indexOf("--system-prompt-file") + 1];
      const system = await import("node:fs/promises").then((fs) => fs.readFile(sysFile, "utf8"));
      const out = (e: object) => child.stdout.write(JSON.stringify(e) + "\n");
      out({ type: "system", subtype: "init", apiKeySource: "none", model: "claude-sonnet" });
      if (o.fail) {
        out({ type: "result", subtype: "success", is_error: true, result: o.fail });
        child.stdout.end(); child.emit("close", 1); return;
      }
      const text = (o.reply ?? (() => "hello world"))(system, input);
      for (const piece of text.match(/[\s\S]{1,30}/g) ?? []) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: piece } } });
      out({ type: "result", subtype: "success", is_error: false, result: text });
      child.stdout.end(); child.emit("close", 0);
    });
    return child;
  };
  const deps: Partial<ClaudeDeps> = { spawn: spawn as never, env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-should-never-reach-claude", ANTHROPIC_AUTH_TOKEN: "x", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_OAUTH_TOKEN: "keep-me" }, platform: "linux" };
  return { calls, deps };
}

describe("ASTON · local Claude Code engine", () => {
  it("never passes an API key or a cloud-provider switch to Claude Code (keeps the subscription login)", () => {
    const env = childEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "u", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_OAUTH_TOKEN: "oauth" });
    expect(env).toEqual({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "oauth" });
  });

  it("is off on servers and when turned off", () => {
    expect(disabledReason({ AWS_LAMBDA_FUNCTION_NAME: "fn" })).toMatch(/your own PC/);
    expect(disabledReason({ LAMBDA_TASK_ROOT: "/var/task" })).toMatch(/your own PC/);
    // `vercel env pull` puts VERCEL=1 / VERCEL_ENV into a local .env — that's still the owner's PC
    expect(disabledReason({ VERCEL: "1", VERCEL_ENV: "production" })).toBeNull();
    expect(disabledReason({ ASTON_CLAUDE_CODE: "off" })).toMatch(/ASTON_CLAUDE_CODE=off/);
    expect(disabledReason({})).toBeNull();
  });

  it("explains limits, sign-in problems and a missing install in plain words", () => {
    expect(classify("You've hit your session limit · resets 3:45pm")).toMatchObject({ kind: "limit", message: expect.stringContaining("resets 3:45pm") });
    expect(classify("You've hit your weekly limit")).toMatchObject({ kind: "limit" });
    expect(classify("Not logged in · Please run /login")).toMatchObject({ kind: "not_signed_in" });
    expect(classify("'claude' is not recognized as an internal or external command")).toMatchObject({ kind: "not_installed" });
    expect(classify("something odd")).toMatchObject({ kind: "failed" });
  });

  it("streams a text-only, single-turn, isolated run with the prompt on stdin", async () => {
    const f = fakeClaude({ reply: (sys, user) => `SYS[${sys}] USER[${user}]` });
    const deltas: string[] = [];
    const msgs = fromMessages([{ role: "system", content: "be a designer" }, { role: "user", content: "Brief: café" }]);
    const text = await claudeStream({ ...msgs, model: "sonnet" }, (d) => deltas.push(d), { deps: f.deps });
    expect(text).toBe("SYS[be a designer] USER[Brief: café]");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(text);
    const c = f.calls[0];
    expect(c.cmd).toBe("claude");
    expect(c.args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", "sonnet", "--max-turns", "1", "--strict-mcp-config", "--no-session-persistence"]));
    expect(c.args[c.args.indexOf("--tools") + 1]).toBe(""); // every tool off
    expect(c.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(c.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(c.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("keep-me");
    expect(c.cwd).toMatch(/aston-claude-/); // an empty temp folder, not the project
    expect(c.stdin).toBe("Brief: café");
  });

  it("uses a shell on Windows so both claude.exe and an npm claude.cmd are found", async () => {
    const f = fakeClaude();
    await claudeStream({ system: "s", user: "u", model: "opus" }, () => {}, { deps: { ...f.deps, platform: "win32" } });
    expect(f.calls[0].shell).toBe(true);
    expect(f.calls[0].args).toContain('""'); // the empty --tools value survives the shell
  });

  it("turns a usage limit into a ClaudeCodeError — no silent fallback", async () => {
    const f = fakeClaude({ fail: "You've hit your session limit · resets 3:45pm" });
    await expect(claudeStream({ system: "s", user: "u", model: "sonnet" }, () => {}, { deps: f.deps })).rejects.toMatchObject({ name: "ClaudeCodeError", kind: "limit" });
    const g = fakeClaude({ missing: true });
    await expect(claudeStream({ system: "s", user: "u", model: "sonnet" }, () => {}, { deps: g.deps })).rejects.toMatchObject({ kind: "not_installed" });
  });

  it("checks the install and that it's signed in with a Claude subscription", async () => {
    expect(await claudeStatus({ fresh: true, deps: fakeClaude().deps })).toMatchObject({ available: true, account: "owner@example.com" });
    expect(await claudeStatus({ fresh: true, deps: fakeClaude({ status: { loggedIn: true, authMethod: "api_key" } }).deps })).toMatchObject({ available: false, reason: expect.stringContaining("not your Claude subscription") });
    expect(await claudeStatus({ fresh: true, deps: fakeClaude({ status: null }).deps })).toMatchObject({ available: false, reason: expect.stringContaining("isn't signed in") });
    expect(await claudeStatus({ fresh: true, deps: fakeClaude({ missing: true }).deps })).toMatchObject({ available: false, reason: expect.stringContaining("isn't installed") });
    expect(await claudeStatus({ fresh: true, deps: { ...fakeClaude().deps, env: { AWS_LAMBDA_FUNCTION_NAME: "fn" } } })).toMatchObject({ available: false });
  });
});

const d = isDbConfigured ? describe : describe.skip;
const OWNER = "aston-claude-owner@example.com";

const PLAN = {
  siteName: "Brew Lab", tagline: "Slow coffee", industry: "café", tone: "warm", mode: "dark",
  palette: { bg: "#120d0a", surface: "#1f1712", text: "#f5ede6", muted: "#b8a99c", primary: "#e8a25c", accent: "#7dd3c0" },
  fonts: { heading: "Fraunces", body: "Inter" },
  sections: [{ id: "home", type: "hero", title: "Home", brief: "Welcome" }, { id: "menu", type: "menu", title: "Menu", brief: "Coffee" }, { id: "visit", type: "contact", title: "Visit", brief: "Hours" }],
  cta: { label: "Visit", target: "#visit" },
};
const builderReply = (sys: string, user: string) => {
  if (sys.includes("Plan a one-page")) return JSON.stringify(PLAN);
  if (sys.includes("complete stylesheet")) return "/* GUIDE\n.btn — button\n*/\n:root{--bg:#120d0a}\n" + ".pad{padding:1px}\n".repeat(20);
  const id = user.match(/Write #([\w-]+)/)?.[1] ?? "x";
  const tag = id === "footer" ? "footer" : "section";
  return `<${tag} id="${id}" class="section"><h2>${id}</h2></${tag}>`;
};

d("ASTON website builder on Claude Code (database integration)", () => {
  let userId = "";
  let B: typeof import("@/lib/aston/site/builder");
  beforeAll(async () => {
    await getDb().user.deleteMany({ where: { email: OWNER } });
    userId = (await getDb().user.create({ data: { email: OWNER, passwordHash: "x" } })).id;
    B = await import("@/lib/aston/site/builder");
  });
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });
  beforeEach(async () => { await getDb().astonSite.deleteMany({ where: { userId } }); H.user = { id: userId, email: OWNER }; });

  const ready = () => fakeClaude({ reply: builderReply });

  it("auto: uses Claude Code when it's signed in here, Groq when it isn't", async () => {
    const { claudeStatus: cs } = await import("@/lib/aston/site/claude-code");
    await cs({ fresh: true, deps: ready().deps }); // the check is cached for a minute
    const a = await B.resolveEngine("auto", "opus");
    expect(a).toMatch(/^claude-code:/);
    await expect(B.resolveEngine("groq", undefined, ready().deps)).resolves.toBe("groq");
  });

  it("asking for Claude Code when it isn't available is an error with the reason, not a silent switch", async () => {
    const { claudeStatus: cs } = await import("@/lib/aston/site/claude-code");
    await cs({ fresh: true, deps: fakeClaude({ missing: true }).deps }); // prime the cache: not installed
    await expect(B.createSite(userId, "A website for Brew Lab café in Indiranagar.", { engine: "claude-code", claudeDeps: fakeClaude({ missing: true }).deps }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("Groq instead") });
    expect(await getDb().astonSite.count({ where: { userId } })).toBe(0);
    const site = await B.createSite(userId, "A website for Brew Lab café in Indiranagar.", { engine: "auto" });
    expect(site.engine).toBe("groq");
    expect(site.engineLabel).toBe("Groq (free)");
  });

  it("builds a whole site with Claude Code, step by step, and can be switched to Groq only on request", async () => {
    const { claudeStatus: cs } = await import("@/lib/aston/site/claude-code");
    const f = ready();
    await cs({ fresh: true, deps: f.deps });
    const site = await B.createSite(userId, "A website for Brew Lab café in Indiranagar.", { engine: "claude-code", model: "opus" });
    expect(site).toMatchObject({ engine: "claude-code:opus", engineLabel: "Claude Opus · your Claude Code" });
    const events: { t: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const evs: { t: string }[] = [];
      await B.nextStep(userId, site.id, (e) => evs.push(e), { claude: f.deps });
      events.push(...evs);
      if (["complete", "error"].includes(evs.at(-1)!.t)) break;
    }
    expect(events.at(-1), JSON.stringify(events.filter((e) => e.t !== "d"))).toMatchObject({ t: "complete" });
    expect(events.filter((e) => e.t === "d").length).toBeGreaterThan(5);
    expect(f.calls.filter((c) => c.args[0] === "-p").every((c) => c.args.includes("opus") && !c.env.ANTHROPIC_API_KEY)).toBe(true);
    const row = await B.getSite(userId, site.id);
    expect(row.status).toBe("done");
    expect(B.siteHtml(row)).toContain('<section id="home"');

    // a limit mid-build: the step fails with the Claude Code reason; nothing switches by itself
    const s2 = await B.createSite(userId, "Landing page for Peak Gym in Koramangala.", { engine: "claude-code" });
    const evs: { t: string; engine?: string; kind?: string }[] = [];
    await B.nextStep(userId, s2.id, (e) => evs.push(e as never), { claude: fakeClaude({ fail: "You've hit your session limit · resets 3:45pm" }).deps });
    expect(evs.at(-1)).toMatchObject({ t: "error", engine: "claude-code", kind: "limit" });
    expect((await B.getSite(userId, s2.id)).engine).toMatch(/^claude-code/);
    const switched = await B.setEngine(userId, s2.id, "groq");
    expect(switched.engine).toBe("groq");
  });
});

describe("ASTON · setup problems are named, not 'Something went wrong'", () => {
  it("points at the missing step", async () => {
    const { setupProblem } = await import("@/lib/aston/ingest");
    expect(setupProblem(Object.assign(new Error("The column `AstonSite.engine` does not exist in the current database."), { code: "P2022" }))).toMatch(/npm run db:migrate/);
    expect(setupProblem(Object.assign(new Error("Unknown argument `engine`. Available options are marked with ?."), { name: "PrismaClientValidationError" }))).toMatch(/npm install/);
    expect(setupProblem(Object.assign(new Error("Can't reach database server at `127.0.0.1:5432`"), { code: "P1001" }))).toMatch(/DATABASE_URL/);
    expect(setupProblem(new Error("something else"))).toBeNull();
  });
});
