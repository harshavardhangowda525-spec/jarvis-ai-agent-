import { describe, it, expect, vi, afterEach } from "vitest";

// No JARVIS_PROVIDER / ULTRON_AI_PROVIDER set: the real defaults.
vi.hoisted(() => {
  delete process.env.JARVIS_PROVIDER; delete process.env.EV_PROVIDER; delete process.env.DARWIN_PROVIDER; delete process.env.AI_PROVIDER;
  process.env.GROQ_API_KEY = "gsk_test"; process.env.GEMINI_API_KEY = "gem_test";
});
import { env } from "@/lib/env";
import { agentConfigs } from "@/lib/ai/agent";

describe("which brain each agent uses (defaults)", () => {
  const pcBrain = { baseUrl: "http://127.0.0.1:11500", model: "qwen2.5:3b" };

  it("JARVIS answers with Groq, then Gemini — never the PC brain, even when it's online", () => {
    expect(env.jarvisProvider).toBe("groq,gemini");
    const { configs, missing } = agentConfigs("jarvis", pcBrain);
    expect(missing).toBeUndefined();
    expect(configs.map((c) => c.provider)).toEqual(["groq", "gemini"]);
  });

  it("EV and DARWIN stay on Groq, then Gemini", () => {
    expect(agentConfigs("ev", pcBrain).configs.map((c) => c.provider)).toEqual(["groq", "gemini"]);
    expect(agentConfigs("darwin", pcBrain).configs.map((c) => c.provider)).toEqual(["groq", "gemini"]);
  });

  it("JARVIS can still be put back on the PC brain with JARVIS_PROVIDER=ollama", () => {
    const saved = env.jarvisProvider;
    (env as { jarvisProvider: string }).jarvisProvider = "ollama";
    try {
      expect(agentConfigs("jarvis", pcBrain).configs.map((c) => c.provider)).toEqual(["ollama"]);
      expect(agentConfigs("jarvis", null).missing).toMatch(/PC brain/);
    } finally { (env as { jarvisProvider: string }).jarvisProvider = saved; }
  });
});

describe("ULTRON runs on this PC's Ollama", () => {
  const keep = { ...process.env };
  afterEach(() => { for (const k of ["ULTRON_AI_PROVIDER", "ULTRON_OLLAMA_MODEL", "OLLAMA_MODEL", "OLLAMA_BASE_URL"]) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } vi.resetModules(); });
  const load = async (e: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(e)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    vi.resetModules();
    return import("../edith/src/provider.mjs");
  };

  it("by default: Ollama only (with Groq and Gemini keys present), with a small default model", async () => {
    const p = await load({ ULTRON_AI_PROVIDER: undefined, ULTRON_OLLAMA_MODEL: undefined, OLLAMA_MODEL: undefined });
    expect(p.onlyProvider()).toBe("ollama");
    expect(p.providerSummary()).toBe(`ollama(${p.DEFAULT_OLLAMA_MODEL})`);
    expect(p.groqFirst()).toBe(false);
  });

  it("uses ULTRON_OLLAMA_MODEL, then OLLAMA_MODEL", async () => {
    expect((await load({ ULTRON_AI_PROVIDER: undefined, OLLAMA_MODEL: "llama3.2:3b", ULTRON_OLLAMA_MODEL: undefined })).providerSummary()).toBe("ollama(llama3.2:3b)");
    expect((await load({ ULTRON_AI_PROVIDER: undefined, OLLAMA_MODEL: "llama3.2:3b", ULTRON_OLLAMA_MODEL: "qwen2.5-coder:7b" })).providerSummary()).toBe("ollama(qwen2.5-coder:7b)");
  });

  it("a cloud backup or the old setup is one setting away", async () => {
    expect((await load({ ULTRON_AI_PROVIDER: "ollama,groq", ULTRON_OLLAMA_MODEL: undefined, OLLAMA_MODEL: undefined })).providerSummary()).toMatch(/^ollama\(.+\) → groq\(/);
    expect((await load({ ULTRON_AI_PROVIDER: "groq,gemini" })).providerSummary()).toMatch(/^groq\(.+\) → gemini\(/);
  });

  it("says plainly when Ollama isn't running (nothing else is tried)", async () => {
    const p = await load({ ULTRON_AI_PROVIDER: undefined, OLLAMA_BASE_URL: "http://127.0.0.1:1" });
    await expect(p.askJson("Reply with json", "ping")).rejects.toThrow(/Ollama isn't running on this PC/);
  }, 30_000);

  it("with no AI key at all it says what to add — it doesn't crash the reply", () => {
    const e = env as unknown as Record<string, string>;
    const saved = { g: e.groqApiKey, m: e.geminiApiKey, o: e.ollamaBaseUrl, j: e.jarvisProvider };
    e.groqApiKey = ""; e.geminiApiKey = ""; e.ollamaBaseUrl = "";
    try {
      for (const agent of ["jarvis", "ev", "darwin"] as const) {
        const r = agentConfigs(agent, null);
        expect(r.configs).toEqual([]);
        expect(r.missing).toMatch(/GROQ_API_KEY .* or GEMINI_API_KEY/);
      }
      e.jarvisProvider = "auto";
      expect(agentConfigs("jarvis", null).missing).toMatch(/has no AI key/);
    } finally { e.groqApiKey = saved.g; e.geminiApiKey = saved.m; e.ollamaBaseUrl = saved.o; e.jarvisProvider = saved.j; }
  });
});

