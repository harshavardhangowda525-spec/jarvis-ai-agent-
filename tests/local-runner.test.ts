import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { retireOldUltronProvider, parseNetstat, stopPort, listeningPids, describeDbError, probeDatabase, cloudAiKeys } from "../scripts/local-helpers.mjs";

const tmp = (text: string) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edenv-")), ".env"); fs.writeFileSync(f, text); return f; };

describe("a leftover 'Groq' setting can't keep ULTRON off Ollama", () => {
  it("turns off the old default, in any spelling, and keeps everything else", () => {
    const f = tmp([
      "GROQ_API_KEY=gsk_keepme",
      'ULTRON_AI_PROVIDER="groq,gemini"',
      "OLLAMA_MODEL=qwen2.5:3b",
    ].join("\r\n"));
    expect(retireOldUltronProvider(f)).toEqual(["ULTRON_AI_PROVIDER=groq,gemini"]);
    const out = fs.readFileSync(f, "utf8");
    expect(out.split("\r\n")).toHaveLength(3); // Windows line endings kept
    expect(out).toContain("GROQ_API_KEY=gsk_keepme");
    expect(out).toContain("OLLAMA_MODEL=qwen2.5:3b");
    expect(out).toMatch(/^# ULTRON_AI_PROVIDER="groq,gemini" {3}# turned off by JARVIS/m);
    expect(retireOldUltronProvider(f)).toEqual([]); // idempotent
  });
  it.each(["ULTRON_AI_PROVIDER=groq", "EDITH_AI_PROVIDER=groq,gemini", "export ULTRON_AI_PROVIDER = 'groq > gemini'  # from the example", "ULTRON_AI_PROVIDER=Gemini"])("%s → off", (line) => {
    expect(retireOldUltronProvider(tmp(line))).toHaveLength(1);
  });
  it.each(["ULTRON_AI_PROVIDER=ollama,groq", "ULTRON_AI_PROVIDER=openrouter", "ULTRON_AI_PROVIDER=auto", "# ULTRON_AI_PROVIDER=groq,gemini", "AI_PROVIDER=groq"])("a deliberate choice stays: %s", (line) => {
    const f = tmp(line);
    expect(retireOldUltronProvider(f)).toEqual([]);
    expect(fs.readFileSync(f, "utf8")).toBe(line);
  });
  it("no edith/.env is fine", () => { expect(retireOldUltronProvider(path.join(os.tmpdir(), "nope", ".env"))).toEqual([]); });
});

describe("finding and stopping an older ULTRON on its port", () => {
  it("reads Windows netstat output (only the LISTENING owner of that exact port)", () => {
    const out = [
      "Active Connections",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:7420         0.0.0.0:0              LISTENING       4312",
      "  TCP    127.0.0.1:7420         127.0.0.1:51544        ESTABLISHED     4312",
      "  TCP    127.0.0.1:51544        127.0.0.1:7420         ESTABLISHED     9001",
      "  TCP    0.0.0.0:17420          0.0.0.0:0              LISTENING       777",
      "  TCP    [::1]:7420             [::]:0                 LISTENING       4312",
    ].join("\r\n");
    expect(parseNetstat(out, 7420)).toEqual([4312]);
  });

  it("stops the process holding the port (netstat + taskkill on Windows)", async () => {
    const script = `require("http").createServer((q,r)=>r.end("ok")).listen(0,"127.0.0.1",function(){console.log(this.address().port)})`;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    const port = await new Promise<number>((r) => child.stdout!.once("data", (d) => r(Number(String(d).trim()))));
    const exited = new Promise((r) => child.once("exit", r));
    expect(listeningPids(port)).toContain(child.pid);
    expect(stopPort(port)).toBeGreaterThan(0);
    await exited;
    expect(listeningPids(port)).toEqual([]);
    void http;
  }, 20_000);
});

describe("npm run local explains a database it can't reach", () => {
  it("says what each connection error means, in plain words", () => {
    expect(describeDbError("Can't reach database server at `ep-soft-water-pooler.neon.tech:5432`")).toMatch(/firewall|hotspot|console\.neon\.tech/);
    expect(describeDbError("ERROR: Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.")).toMatch(/compute quota/);
    expect(describeDbError("password authentication failed for user 'neondb_owner'")).toMatch(/rejected the password/);
    expect(describeDbError("getaddrinfo ENOTFOUND ep-x.neon.tech")).toMatch(/DNS/);
    expect(describeDbError("")).toBeNull();
  });

  it("the startup check reports an unreachable database without hanging or throwing", async () => {
    const r = await probeDatabase(process.cwd(), "postgresql://u:p@127.0.0.1:1/x?connect_timeout=2", 15_000);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  }, 30_000);
});

describe("JARVIS gets the AI keys wherever they are on this PC", () => {
  it("uses .env.local's key, else the one in ULTRON's edith/.env — never a [Sensitive] placeholder", () => {
    const r = cloudAiKeys(
      { GROQ_API_KEY: "[Sensitive]", GEMINI_API_KEY: "", OPENAI_API_KEY: "sk-local" },
      { GROQ_API_KEY: "gsk_from_edith", GEMINI_API_KEY: "gem_from_edith", OPENAI_API_KEY: "sk-edith", GROQ_MODEL: "llama-3.3-70b-versatile" },
    );
    expect(r.values).toEqual({ GROQ_API_KEY: "gsk_from_edith", GEMINI_API_KEY: "gem_from_edith", OPENAI_API_KEY: "sk-local", GROQ_MODEL: "llama-3.3-70b-versatile" });
    expect(r.borrowed).toEqual(["GROQ_API_KEY", "GEMINI_API_KEY", "GROQ_MODEL"]);
    expect(cloudAiKeys({}, {})).toEqual({ values: {}, borrowed: [] });
  });
});
