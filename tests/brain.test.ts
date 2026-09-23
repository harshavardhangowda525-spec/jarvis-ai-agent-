import { describe, it, expect, vi, beforeEach } from "vitest";

// env.ts reads process.env at import time → set vars, then import fresh.
async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  for (const k of ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "OLLAMA_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "AI_PROVIDER", "AI_MODEL", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "AI_API_KEY"]) delete process.env[k];
  Object.assign(process.env, vars);
  return import("@/lib/env");
}

describe("Ollama brain in the provider chain", () => {
  it("puts a live brain FIRST, with /v1, its model, the shared key and cloud fallbacks after", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OPENAI_API_KEY: "sk-openai", OLLAMA_API_KEY: "brain_secret", AI_PROVIDER: "groq" });
    const chain = resolveAiConfigs(undefined, { baseUrl: "https://abc.trycloudflare.com", model: "qwen2.5-coder:7b" });
    expect(chain.map((c) => c.provider)).toEqual(["ollama", "groq", "openai"]);
    expect(chain[0]).toMatchObject({
      baseUrl: "https://abc.trycloudflare.com/v1",
      model: "qwen2.5-coder:7b",
      apiKey: "brain_secret", // never the OpenAI key
      timeoutMs: 150_000,
    });
  });

  it("wins over a provider picked in Settings while the PC is online", async () => {
    const { resolveAiConfigs } = await loadEnv({ GROQ_API_KEY: "gsk_x", OLLAMA_API_KEY: "k" });
    expect(resolveAiConfigs("groq", { baseUrl: "https://abc.trycloudflare.com" })[0].provider).toBe("ollama");
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
