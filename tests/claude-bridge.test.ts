import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
// Plain-JS module from the PC side (edith/) — typed loosely here.
import * as P from "../edith/src/claude-protocol.mjs";

const tools = [{ type: "function", function: { name: "get_time", description: "Current time.", parameters: { type: "object", properties: { timezone: { type: "string" } } } } }];

describe("Claude bridge protocol", () => {
  it("turns a chat with tools into one prompt + a schema that only allows JARVIS's tools", () => {
    const r = P.buildRequest({ messages: [
      { role: "system", content: "You are JARVIS." },
      { role: "user", content: "What time is it?" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_time", arguments: "{\"timezone\":\"Asia/Kolkata\"}" } }] },
      { role: "tool", tool_call_id: "c1", content: "09:41" },
    ], tools });
    expect(r.system).toContain("You are JARVIS.");
    expect(r.system).toContain("- get_time: Current time.");
    expect(r.prompt).toContain("[USER]\nWhat time is it?");
    expect(r.prompt).toContain('[YOU CALLED get_time] {"timezone":"Asia/Kolkata"}');
    expect(r.prompt).toContain("[RESULT OF get_time (c1)]\n09:41");
    expect(r.schema!.properties.tool_calls.items.properties.name.enum).toEqual(["get_time"]);
    expect(P.buildRequest({ messages: [{ role: "user", content: "hi" }] }).schema).toBeNull();
  });

  it("reads Claude's structured answer, drops unknown tools, and maps limits to 429", () => {
    const ok = P.parseResult(JSON.stringify({ type: "result", subtype: "success", structured_output: { reply: "", tool_calls: [{ name: "get_time", arguments: { timezone: "UTC" } }, { name: "rm_rf", arguments: {} }] } }), ["get_time"]);
    expect(ok.toolCalls.map((c: { name: string; arguments: string }) => [c.name, c.arguments])).toEqual([["get_time", '{"timezone":"UTC"}']]);
    const fromText = P.parseResult(JSON.stringify({ subtype: "success", result: 'Sure: {"reply":"Hi","tool_calls":[]}' }), ["get_time"]);
    expect(fromText).toEqual({ text: "Hi", toolCalls: [] });
    expect(() => P.parseResult(JSON.stringify({ is_error: true, result: "Claude AI usage limit reached" }), [])).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => P.parseResult(JSON.stringify({ is_error: true, result: "Invalid API key · Please run /login" }), [])).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => P.parseResult("not json", [])).toThrow(expect.objectContaining({ status: 502 }));
  });

  it("switches off Claude's own tools, MCP servers and settings", () => {
    const a = P.claudeArgs({ model: "sonnet", systemFile: "/tmp/s.txt", schema: { type: "object" } });
    expect(a.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a).toEqual(expect.arrayContaining(["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--system-prompt-file", "/tmp/s.txt", "--json-schema"]));
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("");
  });

  it("finds what a Windows claude.cmd shim really runs (never node.exe itself)", () => {
    expect(P.shimTarget(String.raw`@IF EXIST "%~dp0\node.exe" ( "%~dp0\node.exe" "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js" %* ) ELSE ( node "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js" %* )`))
      .toEqual({ file: "node_modules/@anthropic-ai/claude-code/cli.js", node: true });
    expect(P.shimTarget(String.raw`"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`)).toEqual({ file: "node_modules/@anthropic-ai/claude-code/bin/claude.exe", node: false });
    expect(P.shimTarget("@echo off")).toBeNull();
  });

  it("streams text by sentence and tool calls in OpenAI chunk format", () => {
    const ch = P.toChunks("sonnet", { text: "Hello there. How are you?", toolCalls: [] });
    expect(ch.slice(1, -1).map((c: { choices: { delta: { content: string } }[] }) => c.choices[0].delta.content)).toEqual(["Hello there. ", "How are you?"]);
    const tc = P.toChunks("sonnet", { text: "", toolCalls: [{ id: "x", name: "get_time", arguments: "{}" }] });
    expect(tc.at(-1)!.choices[0].finish_reason).toBe("tool_calls");
  });
});

describe("Claude bridge server (with a stand-in claude command)", () => {
  let child: ChildProcess;
  const port = 11599, key = "claude_test_key_123";
  const log = path.join(os.tmpdir(), `fake-claude-${process.pid}.log`);
  beforeAll(async () => {
    fs.rmSync(log, { force: true });
    child = spawn(process.execPath, [path.join(__dirname, "../edith/claude-bridge.mjs")], {
      env: { ...process.env, CLAUDE_BIN: path.join(__dirname, "fixtures/fake-claude.mjs"), CLAUDE_BRIDGE_LOCAL_ONLY: "1", CLAUDE_BRIDGE_PORT: String(port), CLAUDE_BRIDGE_KEY: key, FAKE_CLAUDE_LOG: log, JARVIS_URL: "" },
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
    throw new Error("bridge didn't start");
  }, 20_000);
  afterAll(() => { child?.kill(); fs.rmSync(log, { force: true }); });

  it("needs the key", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", body: "{}", headers: { Authorization: "Bearer wrong" } });
    expect(r.status).toBe(401);
  });

  it("does a full tool round trip through the OpenAI SDK (streamed and not)", async () => {
    const ai = new OpenAI({ apiKey: key, baseURL: `http://127.0.0.1:${port}/v1` });
    const first = await ai.chat.completions.create({ model: "sonnet", messages: [{ role: "system", content: "You are JARVIS." }, { role: "user", content: "What time is it?" }], tools: tools as never });
    const calls = first.choices[0].message.tool_calls!;
    expect(calls.map((c) => (c as { function: { name: string } }).function.name)).toEqual(["get_time"]); // the made-up tool was dropped
    const stream = await ai.chat.completions.create({ model: "sonnet", stream: true, tools: tools as never, messages: [
      { role: "user", content: "What time is it?" }, first.choices[0].message as never, { role: "tool", tool_call_id: calls[0].id, content: "09:41" },
    ] });
    let text = "";
    for await (const c of stream) text += c.choices[0]?.delta?.content ?? "";
    expect(text).toBe("It's 9:41 in Bengaluru.");
    const runs = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = runs.at(-1);
    expect(last.system).toContain("You are the brain behind this assistant");
    expect(last.input).toContain("[RESULT OF get_time");
    expect(last.args[last.args.indexOf("--tools") + 1]).toBe("");
  });

  it("streams a plain answer piece by piece as Claude writes it (ASTON's live code)", async () => {
    const ai = new OpenAI({ apiKey: key, baseURL: `http://127.0.0.1:${port}/v1` });
    const stream = await ai.chat.completions.create({ model: "sonnet", stream: true, messages: [{ role: "system", content: "You write websites." }, { role: "user", content: "WRITE CODE for a page" }] });
    const pieces: string[] = [];
    for await (const c of stream) { const t = c.choices[0]?.delta?.content; if (t) pieces.push(t); }
    expect(pieces.length).toBeGreaterThan(3); // really arrived in pieces, not one block
    expect(pieces.join("")).toBe("<!doctype html>\n<h1>Hello</h1>\n");
    const last = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
    expect(last.args).toEqual(expect.arrayContaining(["stream-json", "--include-partial-messages"]));
  });

  it("reports a plan limit as 429 so JARVIS moves to the next brain", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "LIMIT" }] }) });
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toMatch(/usage limit/);
  });
});

describe("Claude on your PC in JARVIS's brain chain", () => {
  async function load(vars: Record<string, string>) {
    const { vi } = await import("vitest");
    vi.resetModules();
    for (const k of ["GROQ_API_KEY", "GEMINI_API_KEY", "CLAUDE_BRIDGE_KEY", "CLAUDE_BRIDGE_URL", "CLAUDE_FOR_ALL_AGENTS", "JARVIS_PROVIDER", "DARWIN_PROVIDER", "ASTON_PROVIDER", "AI_PROVIDER", "AI_MODEL"]) delete process.env[k];
    Object.assign(process.env, vars);
    return import("@/lib/ai/agent");
  }
  const live = { claudeUrl: "https://pc.trycloudflare.com", claudeModel: "sonnet" };

  it("CLAUDE_FOR_ALL_AGENTS puts Claude first for every agent, each keeping its own backups", async () => {
    const { agentConfigs } = await load({ GROQ_API_KEY: "gsk_x", GEMINI_API_KEY: "g", CLAUDE_BRIDGE_KEY: "claude_k", CLAUDE_FOR_ALL_AGENTS: "1" });
    for (const a of ["jarvis", "darwin", "robin", "ev", "mike", "aston"] as const) expect(agentConfigs(a, live).configs.map((c) => c.provider), a).toEqual(["claude", "groq", "gemini"]);
    expect(agentConfigs("aston", live).configs[0]).toMatchObject({ baseUrl: "https://pc.trycloudflare.com/v1", apiKey: "claude_k", model: "sonnet", timeoutMs: 300_000 });
    // PC off (no live bridge) → straight to the backups, no waiting
    expect(agentConfigs("jarvis", null).configs.map((c) => c.provider)).toEqual(["groq", "gemini"]);
  });

  it("works per agent via *_PROVIDER, and explains when only Claude was chosen and it's offline", async () => {
    const { agentConfigs } = await load({ GROQ_API_KEY: "gsk_x", CLAUDE_BRIDGE_KEY: "claude_k", DARWIN_PROVIDER: "claude,groq", ASTON_PROVIDER: "claude" });
    expect(agentConfigs("darwin", live).configs.map((c) => c.provider)).toEqual(["claude", "groq"]);
    expect(agentConfigs("jarvis", live).configs.map((c) => c.provider)).toEqual(["groq"]);
    expect(agentConfigs("aston", null).missing).toMatch(/npm run claude/);
  });

  it("uses the fixed local address when JARVIS runs on the PC (npm run local)", async () => {
    const { agentConfigs } = await load({ CLAUDE_BRIDGE_KEY: "claude_k", CLAUDE_BRIDGE_URL: "http://127.0.0.1:11510", JARVIS_PROVIDER: "claude" });
    expect(agentConfigs("jarvis", null).configs[0]).toMatchObject({ provider: "claude", baseUrl: "http://127.0.0.1:11510/v1" });
  });
});
