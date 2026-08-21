# JARVIS AI

A **production-ready, general-purpose personal AI assistant** with realtime
voice, long-term memory, a dynamic tool-using agent, tasks, notes, persistent
conversations, authentication, and an extensible OAuth integration layer.

JARVIS is **not** a predefined-command chatbot. It is a general agent: it
understands natural language, decides whether to answer directly, use a tool,
chain several tools, ask a clarifying question, ask for confirmation, or
honestly say a capability is unavailable. New capabilities are added by
registering a **tool** — the agent loop never changes.

> Speak naturally: _"Search the latest AI news"_, _"Remember that my company is
> Infinity Web and Apps"_, _"Create a task for tomorrow"_, _"Calculate 55000 +
> 18000"_, _"Summarize this PDF"_.

---

## Table of contents

- [Architecture](#architecture)
- [Feature overview](#feature-overview)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [AI configuration](#ai-configuration)
- [Realtime voice (ElevenLabs)](#realtime-voice-elevenlabs)
- [Microphone permissions](#microphone-permissions)
- [Database setup](#database-setup)
- [Integrations (OAuth)](#integrations-oauth)
- [Local development](#local-development)
- [Testing](#testing)
- [Production deployment](#production-deployment)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
USER SPEAKS
   ↓  (mic → VAD → capture)
ElevenLabs STT  ──►  transcript
   ↓
JARVIS AGENT  (Claude, tool-calling loop)
   ├─ understand intent + context (conversation history + long-term memory)
   ├─ choose: answer · use tool · chain tools · clarify · confirm · decline
   ├─ TOOL REGISTRY  (calculator, web search, tasks, notes, memory, time,
   │                  weather, navigation …)  ← add a tool to add a capability
   └─ stream response (NDJSON: activity · text · tool · navigate · done)
   ↓
ElevenLabs streaming TTS  ──►  JARVIS SPEAKS  (barge-in interruptible)
```

Key modules:

| Layer | Location |
|------|----------|
| AI agent loop | `src/lib/ai/agent.ts` |
| Tool registry + tools | `src/lib/tools/*` |
| Voice provider abstraction | `src/lib/voice/provider.ts`, `elevenlabs.ts` |
| Realtime voice client | `src/hooks/useVoice.ts` |
| Agent streaming client | `src/hooks/useAgent.ts` |
| Auth (JWT + bcrypt + sessions) | `src/lib/auth/*`, `src/middleware.ts` |
| Database (Prisma) | `prisma/schema.prisma`, `src/lib/db.ts` |
| API routes | `src/app/api/*` |
| UI (orb, console, panels) | `src/components/*`, `src/app/dashboard/*` |

The **VoiceProvider** interface (`src/lib/voice/provider.ts`) means ElevenLabs
can be swapped for another backend without touching the agent:

```
VoiceProvider
  ├── ElevenLabsVoiceProvider   (implemented)
  └── FutureVoiceProvider       (drop-in replacement)
```

## Feature overview

- **Realtime voice** — continuous, hands-free conversation. Voice-activity
  detection, streaming TTS, and **barge-in** (speak to interrupt JARVIS).
- **General agent** — dynamic tool selection & multi-step chaining via Claude
  tool-calling. No hard-coded commands.
- **Tools** — calculator (safe evaluator, no `eval`), web search (Tavily),
  tasks, notes, long-term memory, time, weather, in-app navigation.
- **Memory** — durable per-user facts, injected into the system prompt.
  Refuses to store secrets.
- **Tasks & notes** — full CRUD by voice, text, or UI.
- **Conversations** — persistent, searchable, renamable, deletable. Voice and
  text share the same context.
- **Files & vision** — analyze images, PDFs, and text documents.
- **Auth** — email/password, bcrypt, signed JWT sessions, per-user isolation.
- **Integrations** — extensible OAuth (Google, GitHub, Slack, Notion, …).
- **Premium UI** — dark, glassy, animated JARVIS orb with IDLE / LISTENING /
  THINKING / SPEAKING / EXECUTING / ERROR / OFFLINE states, live activity feed,
  and system-status panel. Responsive with mobile bottom-nav.
- **Graceful degradation** — a missing API key disables only that capability
  ("web search is not configured") and never crashes the app or fakes results.

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Prisma · PostgreSQL ·
Zod · `jose` (JWT) · bcrypt · Anthropic Claude · ElevenLabs · Vitest.

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#   set DATABASE_URL and AUTH_SECRET (openssl rand -base64 48)
#   optionally set AI_API_KEY, ELEVENLABS_* , SEARCH_API_KEY, WEATHER_API_KEY

# 3. Create the schema
npm run db:push          # or: npm run db:migrate   (prisma migrate deploy)

# 4. Run
npm run dev              # http://localhost:3000
```

Sign up at `/signup`, then open the dashboard and click **Enable JARVIS Voice**.

## Environment variables

See [`.env.example`](./.env.example). Summary:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | Signs session JWTs (≥ 32 chars) |
| `APP_URL` | ✅ | Public base URL (OAuth callbacks) |
| `AI_API_KEY` | for reasoning | Anthropic API key |
| `AI_MODEL` | optional | Claude model id (default `claude-sonnet-5`) |
| `ELEVENLABS_API_KEY` | for voice | ElevenLabs key (server-only) |
| `ELEVENLABS_VOICE_ID` | for voice | Voice used for speech |
| `ELEVENLABS_MODEL_ID` | optional | Default `eleven_turbo_v2_5` (low latency) |
| `ELEVENLABS_STT_MODEL_ID` | optional | Default `scribe_v1` |
| `SEARCH_API_KEY` | for web search | Tavily key |
| `WEATHER_API_KEY` | for weather | OpenWeatherMap key |
| `GOOGLE_/GITHUB_/SLACK_/NOTION_*` | per integration | OAuth client credentials |

**Missing keys degrade gracefully** — the rest of JARVIS keeps working.

## AI configuration

The agent uses Anthropic's tool-calling API. Set `AI_API_KEY` and optionally
`AI_MODEL`. Tools are defined in `src/lib/tools/` and registered in
`src/lib/tools/registry.ts`. To add a capability, implement a `ToolDefinition`
(name, description, Zod schema + JSON `inputSchema`, `execute`) and add it to
the registry — the model will discover and use it automatically.

## Realtime voice (ElevenLabs)

- **STT**: recorded microphone audio → `POST /api/voice/stt` → ElevenLabs
  speech-to-text → transcript.
- **TTS**: reply text → `POST /api/voice/tts` → ElevenLabs **streaming**
  endpoint (`eleven_turbo_v2_5`, `optimize_streaming_latency`) piped straight to
  the browser for low time-to-first-audio.
- The **API key never reaches the browser** — all provider calls go through
  server routes.
- If `ELEVENLABS_API_KEY` is missing the UI shows _"JARVIS voice is not
  configured"_ and text chat still works. Nothing is faked.

Voice selection is configurable per user (Settings → Voice) and via
`ELEVENLABS_VOICE_ID`. It is never hard-coded.

## Microphone permissions

Browsers require a user gesture and explicit permission before capturing audio
or playing sound. JARVIS handles this:

1. On load it shows **INITIALIZING VOICE…**, then **Enable JARVIS Voice**.
2. Clicking it (a user gesture) requests mic permission and opens the realtime
   session. After that you don't click before each sentence — it's continuous.
3. Denied/blocked permission shows a clear retry path. `NotFoundError`,
   playback-blocked, and network errors all surface friendly messages.

## Database setup

PostgreSQL (local, Supabase, Neon, RDS, …). Models: `User`, `Profile`,
`VoicePreference`, `Session`, `Conversation`, `Message`, `Memory`, `Task`,
`Note`, `ToolLog`, `Integration`. Every user-owned row carries `userId` and all
queries are scoped to the authenticated user (RLS-friendly).

```bash
npm run db:push          # dev: sync schema
npm run db:migrate       # prod: prisma migrate deploy (uses prisma/migrations)
npm run db:seed          # optional demo user (demo@jarvis.ai / demopassword123)
```

## Integrations (OAuth)

`src/lib/integrations/providers.ts` defines an extensible provider registry. A
provider becomes connectable only when its client credentials are set; the flow
is `GET /api/integrations/:id/connect` → provider consent → `.../callback`
(state-verified token exchange). Integrations are marked **connected only after
a successful exchange** — never faked. Disconnect clears stored tokens.

## Local development

```bash
npm run dev          # dev server
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run build        # production build
```

## Testing

Automated (Vitest): safe math evaluator + calculator, tool registry &
capability gating, password hashing, JWT sign/verify, request validation, and
**live DB integration** tests for memory (incl. secret-refusal), tasks, notes,
and **per-user isolation**. DB tests auto-skip if `DATABASE_URL` is unset.

```bash
npm test
```

Manual QA checklist: microphone permission, continuous conversation,
interruption (barge-in), reconnect, mute/unmute, tool execution, memory recall,
task creation, multi-step requests, mobile layout, and missing-key degradation.

## Production deployment

**Vercel** (recommended): import the repo, set the environment variables, and
deploy. `vercel.json` sets the build command
(`prisma generate && prisma migrate deploy && next build`) and per-route
function durations. Point `APP_URL` at your domain and add matching OAuth
callback URLs.

**Docker**:

```bash
docker build -t jarvis-ai .
docker run -p 3000:3000 --env-file .env jarvis-ai
# entrypoint runs `prisma migrate deploy` then `next start`
```

**Health check**: `GET /api/health` returns `200` when the DB is reachable
(`503` otherwise) plus AI/voice configuration status — wire it to your load
balancer / uptime monitor.

## Security

- Passwords hashed with bcrypt (cost 12); never stored in plaintext.
- Stateless **and** revocable sessions: signed JWT (HS256) + a `Session` row
  that can be revoked (Settings → Security → sign out other sessions).
- All secrets are server-side; the ElevenLabs/AI keys never reach the client.
- Zod validation on every input; rate limiting on auth, agent, voice, and file
  routes; safe error mapping (no stack traces leaked).
- Strict per-user data isolation on every query.
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`).
- The calculator uses a hand-written parser — **no `eval`/`Function`**.
- Memory refuses to store passwords, keys, and tokens.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Database is not configured" | Set `DATABASE_URL`, run `npm run db:push`. |
| "The AI model is not configured" | Set `AI_API_KEY`. |
| "JARVIS voice is not configured" | Set `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`). |
| Mic not working | Grant permission; use `https://` or `localhost`; click **Enable JARVIS Voice**. |
| "The configured voice ID was not found" | Fix `ELEVENLABS_VOICE_ID` or pick a voice in Settings. |
| Web search says not configured | Set `SEARCH_API_KEY` (Tavily). |
| OAuth connect returns "not configured" | Add that provider's client id/secret. |

---

Built as a real, deployable agent — not a mockup. Add a tool, and JARVIS can do
something new.
