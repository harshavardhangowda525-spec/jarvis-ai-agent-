import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * resolveAiConfig reads env at module load, so we re-import the module fresh
 * with different process.env for each case.
 */
const KEYS = [
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
];

async function resolveWith(vars: Record<string, string>) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  const mod = await import("@/lib/env");
  return mod.resolveAiConfig();
}

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("resolveAiConfig", () => {
  it("selects Gemini via OpenAI-compatible endpoint", async () => {
    const cfg = await resolveWith({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "g-key" });
    expect(cfg).not.toBeNull();
    expect(cfg!.provider).toBe("gemini");
    expect(cfg!.kind).toBe("openai");
    expect(cfg!.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(cfg!.model).toBe("gemini-2.0-flash");
  });

  it("returns null when the selected provider has no key (graceful degradation)", async () => {
    const cfg = await resolveWith({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "" });
    expect(cfg).toBeNull();
  });

  it("infers the provider from whichever key is present", async () => {
    const groq = await resolveWith({ GROQ_API_KEY: "gk" });
    expect(groq!.provider).toBe("groq");
    expect(groq!.kind).toBe("openai");

    const anthropic = await resolveWith({ AI_API_KEY: "sk-ant-x" });
    expect(anthropic!.provider).toBe("anthropic");
    expect(anthropic!.kind).toBe("anthropic");
    expect(anthropic!.model).toBe("claude-sonnet-5");
  });

  it("honors an explicit model override", async () => {
    const cfg = await resolveWith({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "g",
      AI_MODEL: "gemini-2.5-flash",
    });
    expect(cfg!.model).toBe("gemini-2.5-flash");
  });

  it("returns null when nothing is configured", async () => {
    const cfg = await resolveWith({});
    expect(cfg).toBeNull();
  });
});
