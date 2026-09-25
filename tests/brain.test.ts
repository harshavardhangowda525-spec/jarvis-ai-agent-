import { describe, it, expect, vi, beforeEach } from "vitest";

// env.ts reads process.env at import time → set vars, then import fresh.
async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  for (const k of ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "OLLAMA_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "AI_PROVIDER", "AI_MODEL", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "AI_API_KEY", "BRAIN_PRIORITY"]) delete process.env[k];
  Object.assign(process.env, vars);
  return import("@/lib/env");
}

describe("Ollama brain in the provider chain", () => {
  it("keeps the fastest cloud model first and a live PC brain as the unlimited backup", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OPENAI_API_KEY: "sk-openai", OLLAMA_API_KEY: "brain_secret", AI_PROVIDER: "groq" });
    const chain = resolveAiConfigs(undefined, { baseUrl: "https://abc.trycloudflare.com", model: "qwen2.5-coder:7b" });
    expect(chain.map((c) => c.provider)).toEqual(["groq", "openai", "ollama"]);
    expect(chain.at(-1)).toMatchObject({
      baseUrl: "https://abc.trycloudflare.com/v1",
      model: "qwen2.5-coder:7b",
      apiKey: "brain_secret", // never the OpenAI key
      timeoutMs: 150_000,
    });
  });

  it("puts the PC brain first when chosen in Settings or with BRAIN_PRIORITY=first", async () => {
    let { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k" });
    expect(resolveAiConfigs("ollama", { baseUrl: "https://abc.trycloudflare.com" }).map((c) => c.provider)).toEqual(["ollama", "groq"]);
    ({ resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k", BRAIN_PRIORITY: "first" }));
    expect(resolveAiConfigs(undefined, { baseUrl: "https://abc.trycloudflare.com" })[0].provider).toBe("ollama");
    // …but a cloud pick in Settings still wins over BRAIN_PRIORITY
    expect(resolveAiConfigs("groq", { baseUrl: "https://abc.trycloudflare.com" })[0].provider).toBe("groq");
  });

  it("an old AI_PROVIDER=ollama doesn't force the slow PC brain first", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k", AI_PROVIDER: "ollama" });
    expect(resolveAiConfigs(undefined, { baseUrl: "https://abc.trycloudflare.com" }).map((c) => c.provider)).toEqual(["groq", "ollama"]);
  });

  it("running JARVIS on the PC: a local OLLAMA_BASE_URL + BRAIN_PRIORITY=first puts Ollama first", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k", OLLAMA_BASE_URL: "http://127.0.0.1:11500", BRAIN_PRIORITY: "first", OLLAMA_MODEL: "qwen2.5:3b" });
    const chain = resolveAiConfigs(undefined, null);
    expect(chain.map((c) => c.provider)).toEqual(["ollama", "groq"]);
    expect(chain[0]).toMatchObject({ baseUrl: "http://127.0.0.1:11500/v1", model: "qwen2.5:3b", apiKey: "k" });
  });

  it("with the PC offline and a picked provider missing, the PC choice is ignored", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k" });
    expect(resolveAiConfigs("ollama", null).map((c) => c.provider)).toEqual(["groq"]);
  });

  it("drops out entirely when the PC is offline (no brain, no static URL)", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k" });
    expect(resolveAiConfigs(undefined, null).map((c) => c.provider)).toEqual(["groq"]);
  });

  it("does not double /v1 and still supports a static OLLAMA_BASE_URL", async () => {
    const { resolveAiConfigs } = await loadEnv({ OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1/", AI_PROVIDER: "ollama" });
    const [cfg] = resolveAiConfigs();
    expect(cfg.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(cfg.model).toBe("qwen2.5-coder:7b");
  });
});

describe("live brain registration", () => {
  const rows = new Map<string, { status: string; metadata: unknown }>();
  beforeEach(() => {
    rows.clear();
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        user: { findMany: async () => [{ id: "u1" }] },
        integration: {
          findUnique: async ({ where }: any) => rows.get(`${where.userId_provider.userId}:${where.userId_provider.provider}`) ?? null,
          upsert: async ({ where, create, update }: any) => {
            const k = `${where.userId_provider.userId}:${where.userId_provider.provider}`;
            rows.set(k, rows.has(k) ? { status: update.status, metadata: update.metadata } : { status: create.status, metadata: create.metadata });
          },
        },
      }),
    }));
  });

  it("is live right after the gateway registers", async () => {
    const { registerBrain, getLiveBrain } = await import("@/lib/ai/brain");
    await registerBrain({ url: "https://abc.trycloudflare.com", model: "qwen2.5-coder:7b" });
    expect(await getLiveBrain("u1")).toEqual({ baseUrl: "https://abc.trycloudflare.com", model: "qwen2.5-coder:7b" });
  });

  it("goes offline when the gateway says so (Ctrl+C)", async () => {
    const { registerBrain, getLiveBrain } = await import("@/lib/ai/brain");
    await registerBrain({ url: "https://abc.trycloudflare.com" });
    await registerBrain({ url: null });
    expect(await getLiveBrain("u1")).toBeNull();
  });

  it("treats a missed heartbeat (PC off / asleep) as offline", async () => {
    const { registerBrain, getLiveBrain } = await import("@/lib/ai/brain");
    await registerBrain({ url: "https://abc.trycloudflare.com" });
    const row = rows.get("u1:ollama")!;
    (row.metadata as any).lastSeen = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(await getLiveBrain("u1")).toBeNull();
  });
});
