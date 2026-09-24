/**
 * Central environment access + capability detection.
 *
 * JARVIS never crashes on a missing optional key. Instead each capability
 * exposes an `enabled` flag; routes and the UI read these and degrade
 * gracefully ("web search is not configured", "voice is not configured").
 *
 * Server-only. Do not import into client components.
 */
import "server-only";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Public base URL of the app. External services (Instagram Graph API, Magic Hour
 * image-to-video) fetch our generated media server-side, so this MUST be a
 * publicly reachable https URL — not localhost. We honor APP_URL first, then
 * auto-detect Vercel's URLs so publishing "just works" on Vercel with no config.
 */
function resolveAppUrl(): string {
  const explicit = read("APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = read("VERCEL_PROJECT_PRODUCTION_URL"); // stable production domain
  if (prod) return `https://${prod}`;
  const dep = read("VERCEL_URL"); // per-deploy URL (still public)
  if (dep) return `https://${dep}`;
  return "http://localhost:3000";
}

export const env = {
  databaseUrl: read("DATABASE_URL"),
  authSecret: read("AUTH_SECRET"),
  appUrl: resolveAppUrl(),

  // Legacy/Anthropic key. Kept for backward compatibility.
  aiApiKey: read("AI_API_KEY"),
  aiModel: read("AI_MODEL"),

  // Provider selection: "gemini" | "groq" | "openai" | "anthropic".
  // If unset, it is inferred from whichever key is present.
  aiProvider: read("AI_PROVIDER").toLowerCase(),
  geminiApiKey: read("GEMINI_API_KEY"),
  geminiModel: read("GEMINI_MODEL"),
  groqApiKey: read("GROQ_API_KEY"),
  groqModel: read("GROQ_MODEL"),
  openaiApiKey: read("OPENAI_API_KEY"),
  openaiBaseUrl: read("OPENAI_BASE_URL"),
  // OpenRouter (OpenAI-compatible aggregator; has free models).
  openrouterApiKey: read("OPENROUTER_API_KEY"),
  openrouterModel: read("OPENROUTER_MODEL"),
  // Cerebras (OpenAI-compatible, very fast, free tier).
  cerebrasApiKey: read("CEREBRAS_API_KEY"),
  cerebrasModel: read("CEREBRAS_MODEL"),
  // Ollama (local, OpenAI-compatible). Default endpoint is localhost:11434.
  // On Vercel you normally leave OLLAMA_BASE_URL empty: the brain gateway on your
  // PC (`npm run brain` in edith/) registers its live tunnel URL automatically.
  ollamaBaseUrl: read("OLLAMA_BASE_URL"),
  ollamaModel: read("OLLAMA_MODEL"),
  // Shared secret between JARVIS and the brain gateway (Bearer auth on every
  // request + on registration). Never a real AI vendor key.
  ollamaApiKey: read("OLLAMA_API_KEY"),
  // How long to wait for the PC's first token before falling back to the cloud.
  // A 7B model on a CPU must read the whole prompt first (often 1–2 min).
  ollamaTimeoutMs: Math.max(10_000, Number(read("OLLAMA_TIMEOUT_MS")) || 150_000),
  // Recent messages sent to the local model each turn (fewer = faster on a CPU).
  ollamaHistory: Math.max(0, Number(read("OLLAMA_HISTORY")) || 8),
  // Where the PC brain sits in the chain: "fallback" (default) = the fastest
  // cloud model answers and the PC brain is the unlimited backup; "first" = the
  // PC brain answers first (unlimited, but a CPU is slow). Per-user Settings
  // ("Your PC (Ollama) first") override this.
  brainPriority: read("BRAIN_PRIORITY").toLowerCase() === "first" ? "first" : "fallback",
  // Reasoning models (gpt-oss) think before answering; "low" keeps replies quick.
  reasoningEffort: read("AI_REASONING_EFFORT").toLowerCase() || "low",

  elevenLabsApiKey: read("ELEVENLABS_API_KEY"),
  // JARVIS voice — defaults to "Daniel" (British male, authoritative). Override
  // with ELEVENLABS_VOICE_ID.
  elevenLabsVoiceId: read("ELEVENLABS_VOICE_ID") || "onwK4e9ZLuTAKqWW03F9",
  // ULTRON voice — deep and intense ("Callum") so ULTRON and JARVIS are easy to
  // tell apart. Override with ULTRON_VOICE_ID (EDITH_VOICE_ID still works).
  ultronVoiceId: read("ULTRON_VOICE_ID") || read("EDITH_VOICE_ID") || "N2lVS1w4EtoT3dr4eOWO",
  // EV voice — bright, energetic (marketing/growth agent). Defaults to "Aria".
  // Override with EV_VOICE_ID.
  evVoiceId: read("EV_VOICE_ID") || "9BWtsMINqrJLrRacOk9x",
  // DARWIN voice — deep, analytical operator. Defaults to "Charlie" (Australian
  // male). Override with DARWIN_VOICE_ID.
  darwinVoiceId: read("DARWIN_VOICE_ID") || "IKne3meq5aSn9XLyUdCD",
  elevenLabsModelId: read("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5",
  elevenLabsSttModelId: read("ELEVENLABS_STT_MODEL_ID") || "scribe_v1",

  searchApiKey: read("SEARCH_API_KEY"),
  weatherApiKey: read("WEATHER_API_KEY"),

  // Infinity Web & Apps (Supabase) — read-only analysis of the site's own data
  // (leads, visitors, signups, …). The service_role key is server-side ONLY and
  // is never sent to the browser. Only GET queries are ever issued.
  supabaseUrl: read("SUPABASE_URL"),
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),

  // Pluslide (AI slide/presentation generator) — Bearer API token.
  // Builds a presentation into an existing project via /v1/project/export.
  pluslideApiKey: read("PLUSLIDE_API_KEY"),
  pluslideBaseUrl: read("PLUSLIDE_BASE_URL") || "https://api.pluslide.com",
  pluslideExportPath: read("PLUSLIDE_EXPORT_PATH") || "/v1/project/export",
  // Default project to export into when the user doesn't name one.
  // Defaults to the user's "My First Project"; override with PLUSLIDE_PROJECT_ID.
  pluslideProjectId: read("PLUSLIDE_PROJECT_ID") || "0b5ab46f-b1a9-4e64-977e-1c0c94a615fd",
  // Freeform description of THIS project's templates (keys + fields) so the
  // agent composes slides with valid templateKeys. Templates are custom per
  // project, so this can't be hard-coded. Example:
  //   business-report-title: companyLogo, staticTitle, reportTitle, reportDate
  pluslideTemplates: read("PLUSLIDE_TEMPLATES"),

  // Infinity Compass (Lovable app on Supabase) — read-only follow-ups / CRM data.
  // Separate project from Infinity Web & Apps, so it has its own credentials.
  // The service_role key is server-side ONLY and never sent to the browser.
  compassSupabaseUrl: read("COMPASS_SUPABASE_URL"),
  compassSupabaseServiceRoleKey: read("COMPASS_SUPABASE_SERVICE_ROLE_KEY"),

  // --- EV marketing agent -------------------------------------------------
  // Instagram Graph API (Business/Creator account via a long-lived token). The
  // token + IG business id are server-side ONLY and never sent to the browser.
  // A per-user OAuth connection (Integration table) takes precedence when present.
  instagramAccessToken: read("INSTAGRAM_ACCESS_TOKEN"),
  instagramBusinessId: read("INSTAGRAM_BUSINESS_ID"),
  instagramGraphVersion: read("INSTAGRAM_GRAPH_VERSION") || "v21.0",
  // DARWIN lead-discovery service (optional). EV talks to it for REAL leads; if
  // unset, EV honestly reports lead discovery isn't wired and never fakes leads.
  darwinApiUrl: read("DARWIN_API_URL"),
  darwinApiKey: read("DARWIN_API_KEY"),

  // EV image generation. Provider + model are configurable (no hard-coded
  // obsolete model names). If blank, the provider is inferred from whichever AI
  // key is present (Gemini preferred, then OpenAI). Uses the same keys as the
  // text brain — no extra credentials required for Gemini/OpenAI.
  evImageProvider: read("EV_IMAGE_PROVIDER").toLowerCase(),
  evImageModel: read("EV_IMAGE_MODEL"),

  // Magic Hour AI — dedicated image + VIDEO generation for EV. Bearer API key.
  // Server-side only. Async jobs: create → poll project → download URL.
  magicHourApiKey: read("MAGICHOUR_API_KEY"),
  magicHourBaseUrl: read("MAGICHOUR_BASE_URL") || "https://api.magichour.ai",
  // Optional model overrides (Magic Hour defaults are used when blank).
  magicHourVideoModel: read("MAGICHOUR_VIDEO_MODEL"),

  // DARWIN lead generation. Google Places (real, authorized) is the primary lead
  // source. Without it (and with no CSV/manual leads) DARWIN shows
  // "NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE" rather than any mock data.
  googlePlacesApiKey: read("GOOGLE_PLACES_API_KEY"),
  // Foursquare Places — alternative discovery source (its "free" tier now needs
  // billing credits). Get a key at https://foursquare.com/developers.
  foursquareApiKey: read("FOURSQUARE_API_KEY"),
  // Foursquare Places API version header (date-stamped). Override if needed.
  foursquareApiVersion: read("FOURSQUARE_API_VERSION") || "2025-06-17",
  // Geoapify Places — TRULY FREE discovery source (3,000 requests/day, API key,
  // NO credit card). OSM-backed business data (name, website, phone). Get a key
  // at https://myprojects.geoapify.com (sign up → create project → API key).
  geoapifyApiKey: read("GEOAPIFY_API_KEY"),
  // Hard guard: even if code were misconfigured, never fabricate leads.
  mockDataDisabled: (read("MOCK_DATA") || "false").toLowerCase() !== "true",
  appEnv: read("APP_ENV").toLowerCase() || "development",
};

/**
 * Resolves which AI provider powers the agent. Supports Anthropic natively and
 * any OpenAI-compatible endpoint (Gemini, Groq, OpenAI, …). The provider can be
 * swapped entirely via environment variables — no code change required.
 */
export type AiKind = "anthropic" | "openai";

export interface AiConfig {
  provider: string; // gemini | groq | openai | anthropic
  kind: AiKind; // which SDK/protocol to use
  apiKey: string;
  baseUrl?: string; // for OpenAI-compatible providers
  model: string;
  /** Extra request headers (e.g. to get past a tunnel's browser-warning page). */
  headers?: Record<string, string>;
  /** Give up waiting for the first response after this long (then fall back). */
  timeoutMs?: number;
}

/** A live Ollama brain registered by the gateway on the user's PC. */
export interface BrainEndpoint { baseUrl: string; model?: string }

/** Ollama's OpenAI-compatible API lives under /v1 — add it if the URL lacks it. */
function ollamaV1(url: string): string {
  const u = url.replace(/\/+$/, "");
  return /\/v1$/.test(u) ? u : `${u}/v1`;
}

const AI_DEFAULT_MODEL: Record<string, string> = {
  gemini: "gemini-3.6-flash",
  // Groq decommissioned llama-3.3-70b-versatile (2026-08-16). GPT-OSS 120B is
  // Groq's recommended replacement. Override with GROQ_MODEL / AI_MODEL if needed.
  groq: "openai/gpt-oss-120b",
  cerebras: "gpt-oss-120b",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  ollama: "qwen2.5-coder:7b",
};

/** Order tried when falling back (a provider is skipped if not configured). */
const AI_FALLBACK_ORDER = ["groq", "gemini", "cerebras", "openrouter", "openai", "anthropic", "ollama"];

/** Human labels for the provider picker. */
export const AI_PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq (fast, free)",
  gemini: "Google Gemini (free)",
  cerebras: "Cerebras (very fast, free)",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  ollama: "Your PC (Ollama) first — unlimited, slower",
};

/** Providers that actually have credentials configured, in fallback order. */
export function listConfiguredProviders(): { id: string; label: string }[] {
  return AI_FALLBACK_ORDER
    // The PC brain has no static URL (the gateway registers it live), so it's
    // offered whenever its key is set.
    .filter((p) => buildAiConfig(p) !== null || (p === "ollama" && env.ollamaApiKey.length > 0))
    .map((p) => ({ id: p, label: AI_PROVIDER_LABELS[p] ?? p }));
}

/** Build a single provider's config, or null if its credentials aren't set. */
function buildAiConfig(provider: string, brain?: BrainEndpoint | null): AiConfig | null {
  switch (provider) {
    case "gemini":
      return env.geminiApiKey
        ? { provider, kind: "openai", apiKey: env.geminiApiKey,
            // No trailing slash: the OpenAI SDK appends "/chat/completions".
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            model: env.geminiModel || AI_DEFAULT_MODEL.gemini }
        : null;
    case "groq":
      return env.groqApiKey
        ? { provider, kind: "openai", apiKey: env.groqApiKey,
            baseUrl: "https://api.groq.com/openai/v1",
            model: env.groqModel || AI_DEFAULT_MODEL.groq }
        : null;
    case "cerebras":
      return env.cerebrasApiKey
        ? { provider, kind: "openai", apiKey: env.cerebrasApiKey,
            baseUrl: "https://api.cerebras.ai/v1",
            model: env.cerebrasModel || AI_DEFAULT_MODEL.cerebras }
        : null;
    case "openrouter":
      return env.openrouterApiKey
        ? { provider, kind: "openai", apiKey: env.openrouterApiKey,
            baseUrl: "https://openrouter.ai/api/v1",
            model: env.openrouterModel || AI_DEFAULT_MODEL.openrouter }
        : null;
    case "openai":
      return env.openaiApiKey
        ? { provider, kind: "openai", apiKey: env.openaiApiKey,
            baseUrl: env.openaiBaseUrl || undefined, model: AI_DEFAULT_MODEL.openai }
        : null;
    case "ollama": {
      // A live gateway registration wins over a static OLLAMA_BASE_URL. Vercel
      // can't reach localhost, so on Vercel this is normally the tunnel URL.
      const base = brain?.baseUrl || env.ollamaBaseUrl;
      if (!base) return null;
      return {
        provider, kind: "openai",
        // The gateway's shared secret — never another vendor's key.
        apiKey: env.ollamaApiKey || "ollama",
        baseUrl: ollamaV1(base),
        model: brain?.model || env.ollamaModel || AI_DEFAULT_MODEL.ollama,
        headers: { "ngrok-skip-browser-warning": "1" },
        // A PC that's asleep/too slow shouldn't eat the whole request: fall back.
        timeoutMs: env.ollamaTimeoutMs,
      };
    }
    case "anthropic":
      return env.aiApiKey
        ? { provider, kind: "anthropic", apiKey: env.aiApiKey, model: AI_DEFAULT_MODEL.anthropic }
        : null;
    default:
      return null;
  }
}

/**
 * The ordered provider chain. The chosen AI_PROVIDER (or, if blank, the first
 * configured provider) is primary; every other configured provider follows as
 * an automatic fallback. AI_MODEL overrides only the primary provider's model.
 */
export function resolveAiConfigs(primaryOverride?: string, brain?: BrainEndpoint | null): AiConfig[] {
  // Speed first: the fastest configured cloud model answers, and a live PC brain
  // (unlimited, but slow on a CPU) is the automatic backup at the end of the
  // chain. Choosing "Your PC (Ollama) first" in Settings — or BRAIN_PRIORITY=first
  // — puts the PC brain in front again. Otherwise a per-user pick wins over the
  // env default, as long as it's configured.
  const picked = (primaryOverride ?? "").toLowerCase();
  const brainFirst = !!brain && (picked === "ollama" || (!picked && env.brainPriority === "first"));
  const override = brainFirst ? "ollama" : picked === "ollama" ? "" : picked;
  // An old AI_PROVIDER=ollama doesn't force a live PC brain first — speed wins
  // unless the PC was chosen explicitly (Settings or BRAIN_PRIORITY=first).
  const envPrimary = brain && !brainFirst && env.aiProvider === "ollama" ? "" : env.aiProvider;
  const primary = override && buildAiConfig(override, brain) ? override : envPrimary;
  const order = [
    ...(primary && AI_FALLBACK_ORDER.includes(primary) ? [primary] : []),
    ...AI_FALLBACK_ORDER.filter((p) => p !== primary),
  ];
  const seen = new Set<string>();
  const configs: AiConfig[] = [];
  for (const p of order) {
    if (seen.has(p)) continue;
    seen.add(p);
    const cfg = buildAiConfig(p, brain);
    if (cfg) configs.push(cfg);
  }
  // AI_MODEL overrides the primary provider's model — but only when we're using
  // the env default (no per-user override, or the override matches AI_PROVIDER).
  // An AI_MODEL meant for Groq must not be forced onto a UI-picked Cerebras/Gemini.
  const usingEnvPrimary = !override || override === env.aiProvider;
  if (configs.length && env.aiModel && usingEnvPrimary) {
    configs[0] = { ...configs[0], model: env.aiModel };
  }
  return configs;
}

/** The primary (first) provider, or null if none is configured. */
export function resolveAiConfig(): AiConfig | null {
  return resolveAiConfigs()[0] ?? null;
}

/**
 * Vision (screen / image reading) needs a MULTIMODAL model. Several configured
 * providers are text-only on their default models (Groq gpt-oss, Cerebras
 * gpt-oss), so we resolve a separate chain that only includes providers whose
 * model can actually see an image — swapping in a known vision model where the
 * provider's text default wouldn't work.
 */
const VISION_PRIORITY = ["gemini", "openai", "anthropic", "openrouter"];

/** Known vision-capable model per provider (overrides the text default). */
const VISION_MODEL: Record<string, string> = {
  gemini: "gemini-3.6-flash", // multimodal
  openai: "gpt-4o-mini", // multimodal
  anthropic: "claude-sonnet-5", // multimodal
  // OpenRouter: only used if the user pointed OPENROUTER_MODEL at a vision model.
  openrouter: "meta-llama/llama-3.2-90b-vision-instruct:free",
};

/**
 * Resolve the vision provider chain (best first). Each entry is a normal
 * AiConfig but guaranteed to use a vision-capable model. Returns [] if no
 * configured provider can see images.
 */
export function resolveVisionConfigs(): AiConfig[] {
  const configs: AiConfig[] = [];
  for (const p of VISION_PRIORITY) {
    const base = buildAiConfig(p);
    if (!base) continue;
    // OpenRouter only joins if the user explicitly set a (vision) model.
    const model = p === "openrouter" ? (env.openrouterModel || VISION_MODEL.openrouter) : VISION_MODEL[p];
    configs.push({ ...base, model });
  }
  return configs;
}

/** True when at least one configured provider can read images/screens. */
export function hasVision(): boolean {
  return resolveVisionConfigs().length > 0;
}

/** High-level capability matrix used by /api/status and the UI. */
export const capabilities = {
  get database() {
    return env.databaseUrl.length > 0;
  },
  get auth() {
    return env.authSecret.length >= 16;
  },
  get ai() {
    return resolveAiConfig() !== null;
  },
  get vision() {
    return hasVision();
  },
  get voice() {
    return env.elevenLabsApiKey.length > 0;
  },
  get search() {
    return env.searchApiKey.length > 0;
  },
  get weather() {
    return env.weatherApiKey.length > 0;
  },
  get websiteData() {
    return env.supabaseUrl.length > 0 && env.supabaseServiceRoleKey.length > 0;
  },
  get compass() {
    return env.compassSupabaseUrl.length > 0 && env.compassSupabaseServiceRoleKey.length > 0;
  },
  get pluslide() {
    return env.pluslideApiKey.length > 0;
  },
  /** EV can publish/read Instagram via an env-level long-lived token. A per-user
   *  OAuth token (Integration table) can also enable it at request time. The
   *  Instagram-Login API (tokens starting "IG") can use "me" as the node, so it
   *  doesn't require a separate business id. */
  get instagram() {
    if (env.instagramAccessToken.length === 0) return false;
    return env.instagramBusinessId.length > 0 || env.instagramAccessToken.startsWith("IG");
  },
  /** DARWIN lead-discovery service is reachable. */
  get darwin() {
    return env.darwinApiUrl.length > 0;
  },
  /** EV can generate images (Magic Hour, or a Gemini/OpenAI key is present). */
  get evImage() {
    return env.magicHourApiKey.length > 0 || env.geminiApiKey.length > 0 || env.openaiApiKey.length > 0;
  },
  /** Magic Hour is configured — enables high-quality image + video generation. */
  get magicHour() {
    return env.magicHourApiKey.length > 0;
  },
  /** Google Places lead source is connected (real business discovery). */
  get googlePlaces() {
    return env.googlePlacesApiKey.length > 0;
  },
  /** Foursquare Places lead source is connected. */
  get foursquare() {
    return env.foursquareApiKey.length > 0;
  },
  /** Geoapify Places lead source is connected (truly free, no card). */
  get geoapify() {
    return env.geoapifyApiKey.length > 0;
  },
  /** Any automated business-discovery source is connected. */
  get leadDiscovery() {
    return env.googlePlacesApiKey.length > 0 || env.foursquareApiKey.length > 0 || env.geoapifyApiKey.length > 0;
  },
};

export type CapabilityKey = keyof typeof capabilities;
