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
- [Previous-day briefing](#previous-day-briefing)
- [Shut down your laptop by voice](#shut-down-your-laptop-by-voice)
- [Open apps on your PC](#open-apps-on-your-pc)
- [Open links and websites](#open-links-and-websites)
- [Throw to trash (gestures)](#throw-to-trash-gestures)
- [Memory — "remember that…"](#memory--remember-that)
- [NIOS board notifications](#nios-board-notifications)
- [EV daily content](#ev-daily-content)
- [Gesture control](#gesture-control)
- [DARWIN daily lead search](#darwin-daily-lead-search)
- [MIKE — market intelligence](#mike--market-intelligence)

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
| `AI_PROVIDER` | optional | `gemini` \| `groq` \| `openai` \| `anthropic` (inferred if blank) |
| `GEMINI_API_KEY` | for reasoning | Google Gemini key — **free** at aistudio.google.com |
| `GROQ_API_KEY` | alt | Groq key — free, very fast |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | alt | OpenAI or any compatible endpoint |
| `AI_API_KEY` | alt | Anthropic key (paid; native PDF/vision) |
| `AI_MODEL` | optional | Model override; sensible per-provider default if blank |
| `ELEVENLABS_API_KEY` | for voice | ElevenLabs key (server-only) |
| `ELEVENLABS_VOICE_ID` | for voice | Voice used for speech |
| `ELEVENLABS_MODEL_ID` | optional | Default `eleven_turbo_v2_5` (low latency) |
| `ELEVENLABS_STT_MODEL_ID` | optional | Default `scribe_v1` |
| `SEARCH_API_KEY` | for web search | Tavily key |
| `WEATHER_API_KEY` | for weather | OpenWeatherMap key |
| `GOOGLE_/GITHUB_/SLACK_/NOTION_*` | per integration | OAuth client credentials |

**Missing keys degrade gracefully** — the rest of JARVIS keeps working.

## AI configuration

The agent is **provider-agnostic**. Choose one via `AI_PROVIDER` (or just set a
key and it's inferred):

- **Gemini** (`AI_PROVIDER=gemini`, `GEMINI_API_KEY`) — **free**, recommended.
  Uses Google's OpenAI-compatible endpoint.
- **Groq** (`AI_PROVIDER=groq`, `GROQ_API_KEY`) — free, very low latency.
- **OpenAI / compatible** (`AI_PROVIDER=openai`, `OPENAI_API_KEY`, optional
  `OPENAI_BASE_URL`).
- **Anthropic** (`AI_PROVIDER=anthropic`, `AI_API_KEY`) — paid; native PDF +
  vision.

Provider resolution lives in `src/lib/env.ts` (`resolveAiConfig`) and the loop
in `src/lib/ai/agent.ts` dispatches to the Anthropic or OpenAI-compatible path.
Tools are defined in `src/lib/tools/` and registered in
`src/lib/tools/registry.ts`. To add a capability, implement a `ToolDefinition`
(name, description, Zod schema + JSON `inputSchema`, `execute`) and add it to
the registry — the model discovers and uses it automatically, regardless of
provider.

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


### ULTRON's voice

ULTRON sounds dangerous: a deep, husky voice (`ULTRON_VOICE_ID`) delivered cold
and dramatic, then darkened in your browser. The effect pitches it down, adds a
heavy low end, a gritty edge, a faint metallic ring and a dark cavernous
reverb. It applies to ULTRON only; JARVIS, EV and DARWIN are unchanged.

- Tune the delivery with `ULTRON_VOICE_STYLE` (0–1, default 0.65, more = more dramatic),
  `ULTRON_VOICE_STABILITY` (0–1, default 0.28, less = more restless) and
  `ULTRON_VOICE_SPEED` (0.7–1.2, default 0.92).
- The effect's settings are in `src/lib/voice/ultron-fx.ts`.
- To turn the effect off in one browser, run
  `localStorage.setItem("jarvis.ultron.voicefx", "off")` in its console.
- Without an ElevenLabs key, ULTRON's free browser voice is set as slow and low
  as the browser allows. The effect needs the ElevenLabs voice.

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

## Run everything on your PC (fastest with Ollama)

`npm run local` runs the whole app — JARVIS, EV, DARWIN and ULTRON's dashboard —
plus the ULTRON runtime on your own computer, in one window. ULTRON reaches
Ollama directly on `127.0.0.1`, and the app uses the **same database** as your
Vercel app, so your account, memories, leads and chats are identical in both places.

```bash
# one time: copy your app settings from Vercel
npx vercel login
npx vercel link
npx vercel env pull .env.local --environment=production

npm run local        # builds when the code changed, starts everything, opens http://localhost:3000
```

- JARVIS, EV and DARWIN answer with Groq, with Gemini as the backup.
- ULTRON runs on OpenRouter (`OPENROUTER_API_KEY` in `.env.local` or `edith/.env`;
  get one at openrouter.ai/keys). This PC's Ollama is its backup whenever OpenRouter
  fails (rate limit, outage, bad key). Without an OpenRouter key it runs on Ollama
  alone, and `npm run local` says so. See "Which brain each agent uses" below.
- If Ollama is installed but not running, `npm run local` starts it, and it tells you
  if ULTRON's model still needs `ollama pull`. ULTRON's model is `ULTRON_OLLAMA_MODEL` (or `OLLAMA_MODEL`)
  in `edith/.env`, `qwen2.5:3b` by default; a coder model such as
  `qwen2.5-coder:7b` writes better code if your PC can run it.
- EV's images keep your public Vercel address (`JARVIS_URL` in `edith/.env`, or
  `APP_URL`) so Instagram can still fetch them.
- Google sign-in locally needs `http://localhost:3000/api/integrations/google/callback`
  added to your OAuth client's redirect URIs.
- Values marked "Sensitive" on Vercel can't be pulled — copy those into `.env.local` by hand.
- `npm run local -- --rebuild` forces a fresh build; `JARVIS_LOCAL_PORT` changes the port.

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
| "The AI model is not configured" in the `npm run local` window | JARVIS found no AI key. `npm run local` now also uses the `GROQ_API_KEY` / `GEMINI_API_KEY` in `edith/.env` (where they lived when ULTRON used Groq) and says so at startup. If neither file has one, add a free key to `.env.local`: console.groq.com/keys or aistudio.google.com/apikey. |
| "Can't reach database server at `…neon.tech:5432`" | Neon puts the database to sleep when idle. JARVIS now waits up to 30 s for it to wake (`connect_timeout`/`pool_timeout`, unless `DATABASE_URL` sets its own) and retries a failed connection 3 times, logging one line: `[db] … retrying`. If it keeps failing, `npm run local` says why at startup (`Database: …`). The usual causes are an internet drop; a firewall, antivirus, VPN or office/college Wi-Fi blocking port 5432 (try a phone hotspot); or a Neon project that is suspended or out of compute quota (check console.neon.tech). |
| "The AI model is not configured" | Set `AI_API_KEY`. |
| "JARVIS voice is not configured" | Set `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`). |
| Mic not working | Grant permission; use `https://` or `localhost`; click **Enable JARVIS Voice**. |
| "The configured voice ID was not found" | Fix `ELEVENLABS_VOICE_ID` or pick a voice in Settings. |
| Web search says not configured | Set `SEARCH_API_KEY` (Tavily). |
| OAuth connect returns "not configured" | Add that provider's client id/secret. |

---

Built as a real, deployable agent — not a mockup. Add a tool, and JARVIS can do
something new.

## Previous-day briefing

Open JARVIS and it briefs you on **yesterday** (your own timezone): the core
wakes and scans, a liquid-glass briefing materialises, and — with voice on —
JARVIS reads it out. It stays until you press **Skip**, close it, press Esc or
choose **Ask JARVIS**. It opens once per browser session (a refresh doesn't
repeat it). **Replay** re-reads it; **Expand** shows the full day — accomplishments,
problems and fixes, decisions, next actions and every recorded event (each with a
"forget" button).

Ask any time: "What did I do yesterday?", "Yesterday's briefing", "What did I do
on September 25?", "What did I work on last week?", "Show me my activity from the
last 7 days". Specific questions ("What problems did I encounter?", "What did
DARWIN do yesterday?", "What did I leave unfinished?") are answered by JARVIS
from the same history. Tell JARVIS about work done elsewhere — "I called Iron
Temple Gym, they want a quote", "we decided to price websites at ₹4,999" — and
it's logged. "Forget this event" removes the latest event (or name it).

**What's recorded** (table `ActivityEvent`, in your database — survives restarts,
refreshes and redeploys): your commands and how they went; tasks created and
completed; DARWIN discoveries, pipeline moves, follow-ups and outreach; EV
content, visuals and Instagram publishing; ULTRON goals, completions, fixes and
deployments; emails and calendar events JARVIS created; new NIOS notices; agent
views you opened; every failure. Routine lookups (time, weather, listing) and
repeats are skipped. Passwords, API keys, tokens, private keys, connection
strings and card numbers are redacted before anything is stored.

**Every number is real.** Metrics, the completion ring, the timeline, agent
status, insights and "Continue today" are computed from recorded activity and
your tasks. Anything without enough data says so instead of showing a value.

**Daily summaries** (table `DailySummary`): each finished day is stored as
`{ date, accomplishments, projects, business_progress, development_progress,
problems, solutions, unfinished_tasks, important_decisions, next_actions }` —
built at the end of the day by Vercel Cron (`/api/cron/daily-summary`, 00:15 IST,
needs `CRON_SECRET`), hourly by `npm run local`, and whenever a briefing is opened
(refreshed if more activity for that day turns up).

## Open apps on your PC

"JARVIS, open Spotify", "launch VS Code", "open Word, Excel and PowerPoint",
"start WhatsApp": JARVIS opens the **real installed app** on your computer, not
a web page. It works like the shutdown command: ULTRON, the local runtime
started by `npm run local`, launches the app. JARVIS on Vercel asks it through
the same paired, origin-locked connection.

- **Which apps:** anything in your Start menu, both desktop and Microsoft Store apps, read from Windows' own list (`Get-StartApps`). File Explorer, Settings, Task Manager and Control Panel are always available. On macOS it uses `/Applications`; on Linux, `.desktop` entries.
- **Names can be loose:** "vs code", "calc", "ppt", "this pc", "windows settings" and small typos ("spotfy") all find the right app. Uninstallers and help links are never picked.
- **Not installed:** if the app isn't on the PC but it's a well-known website (Gmail, Amazon, YouTube…), JARVIS opens the website in a new tab straight away (see below). Otherwise it tells you it couldn't find it, suggesting a close match if there is one.
- **ULTRON not running:** JARVIS tells you to start `npm run local`. Websites still open as before.
- **"start …" / "run …"** only open an app when one by that name is installed, so "run the tests" still goes to JARVIS's brain. The brain can also open apps itself (the `open_app` tool) for requests like "I want to code — open VS Code and Spotify".
- **Safety:** ULTRON only launches apps from the computer's own installed list, with a fixed command and no shell, no paths and no arguments. It accepts requests only from your JARVIS app with the pairing token. Turn it off with `ULTRON_APPS=off` in `edith/.env`.

## Open links and websites

Links open **inside JARVIS**, in a liquid-glass browser window with back,
forward, reload, an address bar (type an address, a site name or a search),
maximize, "open in a new tab" and close.

- **What you can say:** "open YouTube", "open Gmail", "open Amazon and search for USB cables", "search YouTube for lo-fi", "open https://github.com/…", "go to example.com/docs", "open this link www.example.org", "open localhost:3000". A link pasted on its own opens too. "Open that link" / "open the second link" open links JARVIS already showed you, and clicking a link button in a reply opens it here (Ctrl/⌘-click for a real tab).
- **How the site runs in the window:**
  - Video/music/map links use the site's official player: YouTube videos, shorts and playlists, Google Maps, Spotify, Vimeo. These work everywhere, including on Vercel.
  - Sites that allow being shown inside other apps load directly.
  - Most big sites (YouTube's home page, Gmail, Amazon, GitHub, Google search…) refuse that. For those, **ULTRON runs the site in a real Chrome/Edge on your PC and streams it into the window**. Your clicks, scrolling, typing and paste go straight to it, so it works like a normal tab. That browser has its own profile (`edith/.browser-profile`), so sign in once and you stay signed in. Sound plays from your PC.
  - Without ULTRON running, those sites show a preview card with an "Open in a new tab" button.
- **App or website?** JARVIS keeps the list of apps installed on your PC (from ULTRON): "open Spotify" launches the Spotify app if it's installed, "open YouTube" opens the website.
- **Real tab:** say "… in a new tab" ("open Gmail in a new tab"), or use the ↗ button in the window. If the browser blocks a tab JARVIS didn't open from a click, ULTRON opens it in your default browser instead.
- **Closing:** the ✕ button, Esc, "close the browser" / "close it", or the gesture for back.
- **Limits of the live view:** file uploads and downloads are off (use "open in a new tab" for those). Some sign-ins, such as Google's, may refuse a browser that's being remote-controlled. If that happens, sign in with "open in a new tab" or use the app. Needs Google Chrome or Microsoft Edge on the PC (or set `ULTRON_BROWSER_PATH`).
- **Windows, macOS, Linux:** on Windows 10/11 it uses Google Chrome if installed, otherwise Microsoft Edge (always there). Chrome and Edge each keep their own profile folder. If a browser from an earlier run is still holding the profile (for example after closing the ULTRON window), ULTRON stops just that browser and carries on. The Windows side is checked on a real Windows machine by the `Windows (ULTRON)` GitHub Actions job.
- **Safety:** only your paired JARVIS page (allowed origin + pairing token) can drive the live browser or open links through ULTRON. Only `http`/`https` addresses are opened, as a single argument with no shell. Camera, microphone and location requests from sites are denied. Turn the live browser off with `ULTRON_BROWSER=off` (and link/app opening with `ULTRON_APPS=off`) in `edith/.env`.

## Throw to trash (gestures)

With a page open in JARVIS's browser, you can pick things off it with your hand and throw them into the small holographic bin in the bottom-right corner. Ads, pop-ups and banners are the obvious ones.

1. **Open hand:** move over the page. A glass ring follows your hand, and an outline shows what you'd grab.
2. **Close your fist** on it and hold it still for a moment. The element lifts off the page, glowing, and follows your hand.
3. **Carry it to the bin.** It leaves a particle trail. The bin glows as you get close, then opens its lid.
4. **Open your hand over the bin.** The element flies in, shrinks and disappears in a dust burst, and the bin settles back to idle. An **Undo** button stays up for a few seconds.

Open your hand anywhere else and the element springs back to where it was. Nothing is removed.

- **Safety:** something is removed only after the whole sequence is done on purpose. All of these must hold:
  - you were holding a real element;
  - you carried it at least a short distance, toward the bin;
  - your fist stayed inside the bin's zone for a moment;
  - your hand opened clearly for a moment.

  So a brief glitch of the camera tracking, a fist over nothing, a fist you never opened, or losing your hand all cancel the grab. While your hand is over the page, a fist grabs (it doesn't open JARVIS) and an open hand drops (it doesn't wake JARVIS). While you're grabbing, the other hand gestures are paused. It uses the gesture camera you already switch on for gesture mode; there is no second camera.
- **What gets removed:** on live pages (running through ULTRON), the real element is hidden in **your local view only**. The website isn't changed; reloading the page brings it back, and so does Undo. Embedded pages (YouTube players, maps, sites shown directly) can't be reached inside, so there the whole page is the thing you pick up, and throwing it closes it.
- **Mouse and touch:** hold **Alt** and drag something into the bin, or **long-press** and drag on a touch screen.
- **Tuning:** the thresholds are in `GRAB_DEFAULTS` in `src/lib/gesture/grab-throw.ts`: fist and open-hand confidence, hold times, grab stillness, release distance, the bin's hitbox and approach radius, and how long lost tracking is tolerated. They can also be passed per page through `<GrabThrowLayer config>`. In development the page shows a small readout and logs `[grab]` steps to the console.
- **Building blocks:**
  - `GrabThrowController` is the pure state machine, with no DOM access.
  - `TrashBin` is the bin component, with the states idle, approaching, ready, receiving and success.
  - `GrabThrowLayer` handles animation, springs, particles and input.
  - Each page view provides a small `GrabSurface` adapter that finds, snapshots and removes things.

## Memory — "remember that…"

Tell JARVIS to remember something and it's kept for good, in your database. It
survives refreshes, restarts and redeploys, and it's shared by JARVIS, EV and
DARWIN on every brain (cloud or your Ollama PC).

- **Saving:** "Remember that my favourite colour is blue", "can you remember I'm allergic to peanuts?", "don't forget I have exams in October", "keep in mind…", "note that…", "for future reference…", "from now on, keep answers short". These are saved directly, without waiting for the AI, so they work even when the PC brain is off. JARVIS confirms: *"Got it. I'll remember that your favourite colour is blue."*
- **Corrections replace:** "remember my favourite colour is green" updates the old fact instead of keeping both.
- **Asking:** "What do you remember about me?" lists everything, with what you asked it to keep first. Questions like "what's my favourite colour?" are answered from memory. What you asked JARVIS to remember always goes into every prompt, even alongside hundreds of facts learned from chats.
- **Forgetting:** "Forget my favourite colour" or "forget what I told you about the gym" removes exactly that. If it's ambiguous, JARVIS asks which one rather than guessing. You can also edit everything on the Memory page.
- **Secrets are never stored:** passwords, PINs, keys, tokens and card numbers. "Remember to call mom at 5" is a reminder, not a memory, so it goes to JARVIS as a task.

## Shut down your laptop by voice

Say **"JARVIS, shut down my laptop"** (or "turn off my PC in 10 minutes").

1. JARVIS asks you to confirm — nothing happens until you say **"yes"** (within 20 s).
2. The laptop powers off after a countdown (30 s by default, or the time you said).
3. Changed your mind? Say **"cancel shutdown"**. On Windows you can also run `shutdown /a`.

A website can't switch a computer off, so this goes through ULTRON — JARVIS's
runtime on your laptop, started by `npm run local` (or ULTRON on its own). It
only accepts requests from your JARVIS app with its pairing token, and it can do
exactly two things: shut down after a delay, or cancel. To disable it on a
computer, set `ULTRON_POWER=off` in `edith/.env`. "Power down" / "go to sleep"
still just put JARVIS to sleep — only "laptop / computer / PC" wording turns the
machine off.

## NIOS board notifications

JARVIS watches the official NIOS websites and tells you when a new notice
appears — exams, date sheets, practicals, hall tickets, results, admissions,
fees, anything published:

| Page watched | URL |
| --- | --- |
| NIOS main site | https://www.nios.ac.in/ |
| Secondary & Sr. Secondary | https://sdmis.nios.ac.in/registration/home-notifications |
| Vocational | https://voc.nios.ac.in/registration/home-notifications |
| Results | https://results.nios.ac.in/ |
| Regional Centre Bengaluru | https://rcbengaluru.nios.ac.in/notification.html |
| Other regional centres (optional) | `NIOS_REGIONAL_CENTRES="delhi,chennai"` or say "watch the Delhi regional centre" |

- **First read = history.** What's already on the pages is stored (ask "latest NIOS
  exam notices") but not announced; only notices that appear afterwards alert you.
- **In JARVIS:** while the console is open it checks every 10 minutes — a new notice
  pops up, JARVIS reads it out, and if the tab is in the background you get a
  desktop notification (allow it once from the pop-up).
- **By email:** with Gmail connected (Settings → Integrations), new notices are
  emailed from your Gmail to yourself.
- **When JARVIS is closed:** Vercel Cron calls `/api/cron/nios` daily at 08:00 IST
  (set `CRON_SECRET` in Vercel; the Hobby plan allows one run a day — Pro can run it
  more often by editing `vercel.json`). `npm run local` checks every 15 minutes
  while your PC is on.
- Ask JARVIS: "any new NIOS notifications?", "check NIOS now", "turn off NIOS email alerts".
- Notices are shown exactly as NIOS published them (title, date, link) — always
  confirm on nios.ac.in.

## EV daily content

Every morning EV prepares **today's Instagram package** for Infinity Web & Apps
(a feed post image and a 9:16 Reel) and has it waiting for your approval by
**5:30 AM** (Asia/Kolkata). You don't have to start it.

**Images and videos come from [Magic Hour](https://magichour.ai)** — the daily post
image, the Reel's animated clip, and anything you ask EV for in chat ("make an
image for…", "turn it into a reel"). Set `MAGICHOUR_API_KEY` (magichour.ai →
Developer → API key) in `.env.local` and on Vercel. Without it EV tells you it
needs connecting rather than using another generator; `EV_MEDIA_PROVIDER=auto`
brings back Gemini/OpenAI as a backup. Optional: `MAGICHOUR_IMAGE_MODEL`,
`MAGICHOUR_VIDEO_MODEL` and their `_RESOLUTION` settings (blank = Magic Hour's
recommended model). Each render uses Magic Hour credits.

A Magic Hour video takes a few minutes. When you ask EV for one in chat, EV
waits about half a minute. If the video isn't done by then, JARVIS keeps
checking in the background (every 10 s, for up to 30 minutes, even across a
page reload). The finished video shows up on EV's screen by itself, ready to
approve, and JARVIS says "Your video is ready". If Magic Hour fails, you get
Magic Hour's own reason instead of silence. The check runs through
`GET /api/ev/render?kind=video&projectId=…`, and each finished file is stored
only once.

**If Magic Hour won't use the picture** (for example "invalid url"), EV
recovers by itself:
1. It tries the same upload again after a few seconds.
2. It uploads the picture again as a PNG.
3. If Magic Hour still refuses, or the render fails while reading the
   picture, EV makes the same video from its description (text-to-video) and
   tells you why.

Magic Hour's exact answer for any failed step is written to the server console
as `[magichour] …`, with the API key never shown.

**Checking Magic Hour from your PC.** `npm run ev:check-video` runs EV's video
steps one by one with your key and prints Magic Hour's exact answer at each:
1. the key;
2. the upload address;
3. the picture upload.

These three are free. `npm run ev:check-video -- --create` also starts one
3-second test video, which uses credits. It tries text-to-video if
image-to-video is refused, then waits for the render. The output is saved to
`magichour-check.txt` (git-ignored). The key and upload signatures are never
printed.

| Time | Step |
| --- | --- |
| 04:00 | **Research.** Reads every past package and EV's content memory, then picks a niche, a service (websites, apps, automation, AI, online ordering/booking, software, redesigns, AI marketing) and a format that haven't been used recently. |
| 04:15 | **Content.** EV's writing brain (`EV_PROVIDER`) writes the topic, hook, caption, CTA, 10–15 hashtags, the creative concept and the Reel story. A draft too close to anything recent is rewritten. |
| 04:45 | **Creative.** A real image from Magic Hour, with no text baked in. |
| 05:00 | **Video.** A real MP4 Reel (1080×1920, about 12 s). The hook lands in the first second, two on-screen beats follow, and a brand end card shows the CTA, 8317480583 and @infinitywebapps. The creative is uploaded to Magic Hour and animated there (image-to-video), then cut into the Reel — this works on Vercel and with `npm run local`. If the Magic Hour clip fails, EV renders the Reel itself from the image (ffmpeg with Inter, bundled) and notes why in the log. The text overlays are drawn with satori + resvg; this works on Windows too, where `next/og` failed with "Invalid URL". |
| 05:20 | **Quality check.** Media exists; the caption exists and matches the creative; the video is a playable 9:16 MP4 of 3–90 s; it doesn't repeat recent topics, hooks or captions; the brand, handle and phone are exact; the positioning is right; there's no placeholder text; there are no unbacked claims (no stats, guarantees, rankings, or prices other than ₹4,999 / ₹55,000); the format is Instagram-friendly; and every publishing detail is present. Text problems are fixed automatically, up to twice. |
| 05:30 | **Ready for approval.** |

If a step runs late, the screen says so and keeps going. It never shows a step as
done before it is. If something fails (a missing key, a provider error), you see
the actual error and a **Retry** button.

**Open EV** and it opens on **TODAY'S CONTENT**. EV's core sits in the middle,
with the IDEA → CREATION → VIDEO → READY → APPROVAL streams around it. You also
see:
- the real post (image, full caption, hashtags, content type, planned posting time);
- the real Reel with play/pause and its actual duration;
- the morning schedule with planned and actual times;
- the log of what EV really did.

EV asks: *"Today's content is ready. Would you like me to publish it?"*

- **Publish:** "Approved", "Publish it", "Go ahead", "Looks good" (or "yes" right after EV asks). This posts the image and the Reel through the Instagram Graph API. It only says published once Instagram returns media ids. If Instagram isn't connected, or `APP_URL` isn't public https, it tells you exactly that.
- **Change it:** "Reject it" or "Regenerate it" (new version, new angle); "Show me another idea"; "Change the caption" (EV rewrites it); "Change the caption to: …" (your words, checked but never rewritten); "Change the video" (new Reel story and style); "Make it more professional" / "Make it more engaging". Every change is a new version, and the old one stays in the history.
- From JARVIS: "Show me today's content" or "Is today's content ready?".

**Nothing publishes without your approval.** The one exception is auto-publish,
which you turn on yourself with `EV_DAILY_AUTOPUBLISH=on`. Then it posts at the
planned time.

**Persistence.** Everything lives in the `EvDaily` table: one row per version,
holding date, topic, hook, caption, hashtags, image and video assets, the QC
report, the log, and status (`draft | generating | ready | approved | published | rejected | failed`)
with `created/ready/approved/published` times. The media are stored in `EvMedia`
and served at your app URL. The package is also mirrored into EV's content memory
and recorded in your activity history. The morning briefing then says, for
example: *"This morning EV generated today's Instagram content, created the
promotional video, and prepared the publishing package. The content is ready for
your approval."*

**What drives it:**
- Vercel Cron `/api/cron/ev-daily` at 04:00, 04:45 and 05:45 IST (needs `CRON_SECRET`).
- `npm run local`, every 5 minutes.
- JARVIS itself, whenever it's open after 04:00.

Each run moves the package forward from where it stopped. Slow Magic Hour renders
and Instagram processing are picked up on the next run.

Settings (all optional): `EV_DAILY=off`, `EV_DAILY_TZ` (default `Asia/Kolkata`),
`EV_DAILY_START` (`04:00`), `EV_DAILY_READY_BY` (`05:30`), `EV_DAILY_POST_TIME`
(`19:00`), `EV_DAILY_AUTOPUBLISH` (`off`), `EV_DAILY_VIDEO` (`auto` | `motion` |
`magichour`), `FFMPEG_PATH` (default: the bundled `ffmpeg-static`).

## Gesture control

Control JARVIS with your hand in front of the camera. It's an extra layer on top
of voice, which keeps working exactly as before.

**Turn it on:** say "Enable gesture mode" (or "Gesture mode"), or click the ✋
in the top bar. The camera opens only then. "Disable gesture mode", the ✋, or
the ⏻ in the tracker turns it off and releases the camera. If the tab stays in
the background for 2 minutes, the camera is also released; it resumes when you
come back.

| Gesture | Action |
| --- | --- |
| Open palm (hold still) | Wake JARVIS: turns voice on, or unmutes it |
| Closed fist (hold) | **Open JARVIS**, from any screen. On the way it stops JARVIS speaking, the reply in progress and playing media, and closes EV, the browser pop-up, Humanoid View and any briefing. Background jobs keep running |
| Thumbs up (hold) | Approve: EV's daily content, the creative on screen, or text EV is holding |
| Thumbs down (hold) | Reject: EV's content (makes a new version), dismiss a creative, or cancel a pending shutdown |
| Point | Aim: a holographic pointer follows your index finger and highlights what it's on |
| Pinch (thumb + index) | Click whatever you're pointing at, such as an agent node, a button, or EV's Approve |
| Two-finger swipe ← / → | Previous / next item |
| Open hand, swipe → | **Open DARWIN** |
| Open hand, swipe ← | **Open ULTRON** |
| Open hand, swipe ↑ | **Open EV**, also from DARWIN or ULTRON. Your hand must already be in view: raising it into the frame doesn't count |

Gestures go through the **same command router as voice**. A thumbs up is the
same as saying "Approved". Thumbs up never confirms a laptop shutdown; that
still needs a spoken "yes".

**One command per gesture:**
- A pose must be clear (confidence threshold), stable for a few frames, and held still for the hold time.
- It then fires once, so holding a thumbs up for 5 seconds is one approval. It re-arms only after your hand shows something else for a moment or leaves the view.
- Each action has a cooldown, and there's a short global one after any command.
- Swipes need a fast, mostly horizontal sweep of a consistent pose.
- A pinch clicks on press, and needs a release before the next click.
- The pointer is smoothed with a one-euro filter.

**What you see:**
- A small liquid-glass tracker in the bottom-right, showing hand landmarks, the recognised pose, confidence and hold progress.
- The pointer and its target highlight.
- On each command: "GESTURE DETECTED · THUMBS UP · APPROVED" with a holographic pulse, a JARVIS core reaction, and the action itself.

**Humanoid View** reacts too: the figure turns toward your hand, a beam links its
core to where you point, and its core flashes with each gesture.

**Settings** (⚙ in the tracker):
- Turn gesture mode on or off.
- Set sensitivity: deliberate ↔ responsive; it changes the hold time and confidence needed.
- Show or hide the camera preview behind the landmarks.
- Turn each gesture on or off.
- **Recalibrate**, which learns your pinch distance.

**Privacy.** Hand tracking uses MediaPipe Hand Landmarker (WebAssembly/WebGL)
and runs entirely in your browser. The runtime (`public/vision`, copied from
`node_modules` on install) and the model (`public/models/hand_landmarker.task`)
are served by this app. Camera frames are never uploaded or recorded.

If the camera can't be used (permission blocked, no camera, in use elsewhere,
unplugged), the tracker says why and offers **Try again**. Everything else keeps
working.

## DARWIN daily lead search

Every day, DARWIN searches on its own for **50 new, real businesses with no
website** (the target is configurable) in your target locations. It verifies
each one, saves them to the CRM and reports to you through JARVIS. You don't
need to start it.

**How a day runs** (from about 06:00 in `DARWIN_DAILY_TZ`, default Asia/Kolkata):
1. For every location × category you configured, DARWIN reads real businesses from Geoapify (OpenStreetMap). It keeps its position, so a restart continues where it stopped.
2. It removes duplicates. A business is skipped if it's already in DARWIN: same place id, same name/address/coordinates fingerprint, same phone, or the same name within 150 m. It also skips businesses already checked on an earlier day that had a website. Unclear ones are re-checked after 3 weeks.
3. It verifies the website with every available signal:
   - the listing's own website field;
   - the Google business profile (`GOOGLE_PLACES_API_KEY`);
   - a web search (`SEARCH_API_KEY`, Tavily), where directories such as Justdial and social pages don't count as websites;
   - a live accessibility check of any site found;
   - domains built from the business name, which only count if the page shows the full name plus the locality or phone.
4. Each business gets one status: **No website**, **Website exists**, **Website unclear**, **Website temporarily unavailable** (or permanently closed). Only **No website** counts toward the target. In strict mode (the default), that also needs an independent confirmation from Google or web search.
5. It checks the phone number (listing, or the Google profile). It then scores the lead from real signals only: no website, phone and mobile, category fit, distance, social presence, and Google reviews and rating. Nothing is invented to raise a score.
6. It saves each lead with its category, phone, address, map links, website status, the verification reasons, the score and needs, the source, the discovery date, and contact and follow-up status.
7. It stops at the target, or when the search area is exhausted, or when the day's API budget is used. It never pads the count.

**Report:** when the search finishes, JARVIS says for example:
*"DARWIN has finished today's lead search. I found 50 new businesses without verified websites. 46 have publicly available phone numbers, and 21 were marked as high-potential leads. I've saved them to your CRM."*
If it found fewer, JARVIS says so and gives the reasons: insufficient businesses, duplicates, unclear website status, missing phone, verification failures, or API limits. A card shows the numbers, and **DAILY REPORT** opens the breakdown (by category, contactable, high-potential, top leads). Ask any time: "DARWIN report", "How many leads did DARWIN find today?"

**In DARWIN:** the **DAILY TARGET** ring (e.g. 37 / 50) shows:
- verified leads and remaining;
- duplicates removed and websites rejected;
- contactable and high-potential leads.

At the target it shows **DAILY TARGET COMPLETE**, with **VIEW LEADS**, **OPEN CRM** and **DAILY REPORT**. The ⚙ opens the daily-search settings:
- target locations and categories;
- the daily target and search radius;
- "only count businesses with a phone";
- strict verification;
- which verification sources are on.

**What drives it.** The leads are ready before you open DARWIN. You don't
need to have JARVIS or DARWIN open while it searches:
- **On Vercel:** Cron `/api/cron/darwin-daily` fires at 06:00 IST and again at
  09:00 as a backup. It needs `CRON_SECRET`. Each call works for about 4
  minutes. If the day's search isn't finished, the call hands on to a fresh
  call of itself, and so on until the target is reached or the search area runs
  out (up to 30 hand-ons, about 2 hours).
- **With `npm run local`:** it searches back-to-back (a few seconds apart) while
  the day's search is unfinished, then checks every 5 minutes. The PC just needs
  to be on.
- **Opening JARVIS or DARWIN** also moves it along.

The scheduler may start up to an hour before `DARWIN_DAILY_START`, because
Vercel fires a daily cron at some point within its hour. So the leads are
ready by the start time, not an hour after it.

A call only hands on when it actually made progress, so a stuck search can't
loop. Only one call works on a day's run at a time.

**Accounts searched.** With `DARWIN_DAILY_LOCATIONS` set, every account gets the
daily search, even one that has never opened DARWIN. Without it, only accounts
that already use DARWIN get it. A day that was waiting for settings (no
location or no Geoapify key yet) starts on the next round once they're added.

**Every lead has a phone number.** Leads have no website *and* a public phone
number by default, so every one of them is someone you can call. Turn this off with
the ⚙ setting "Only count businesses with a phone", or with
`DARWIN_DAILY_REQUIRE_PHONE=off`. The phone can come from any of these, and no
Google Places key is needed:
- **The map listing:** phone, mobile or WhatsApp.
- **Web search** (`SEARCH_API_KEY`), the same search DARWIN uses to confirm there's
  no website. For a business with no listed phone, it also asks for the "contact
  number".
  - A number only counts if it's in a result that names the business, such as
    Justdial, IndiaMART, Sulekha or its Facebook or Instagram page.
  - A number seen once also needs a listing page or the area named. Seen twice, it
    counts either way.
  - Toll-free lines, directory helplines and junk numbers are ignored.
- **Foursquare** (`FOURSQUARE_API_KEY`): the place with the same name within 300 m.
- **Google Places** (`GOOGLE_PLACES_API_KEY`), if you have it.

Each lead records where its phone came from, for example
`web search (www.justdial.com)`. Businesses that list a phone are checked first. With
none of these sources set up, businesses with no listed phone are skipped before any
checks are spent on them. They're looked at again after 3 weeks.

**50 leads by 2:00 PM.** The day's search has a deadline, `DARWIN_DAILY_DEADLINE`
(default `14:00`, in `DARWIN_DAILY_TZ`). If the configured area runs out before the
target, DARWIN widens the search by itself instead of stopping:
1. It adds more kinds of business, 27 in total. Each is one DARWIN can search precisely.
2. It searches further out: first 12 km (or double your radius), then 25 km.

It never pads the count with unverified businesses. A search that started before
the deadline stops there and reports what it found and why it fell short. A search
that only started after the deadline, for example because the PC was off all
morning, runs to the end. The daily budget allows up to 600 map requests (Geoapify's
free tier is 3,000 a day).

**Google Sheet.** With Google connected, each verified lead is added once to a
Google Sheet named **DARWIN Leads** in your Drive. The sheet is created on the first
lead, isn't shared with anyone, and gets a new copy if you delete it. The DAILY TARGET
card has a GOOGLE SHEET button.

It survives restarts and refreshes: progress lives in `DarwinDailyRun`, checked businesses in `DarwinCandidate`, and leads in `DarwinLead`. Each new day starts a new run; earlier leads and reports are kept.

**Automatic outreach email.** DARWIN emails every new lead that has a public
email address, with no draft to approve. It's on by default. Turn it off in the
⚙ daily-search settings or with `DARWIN_AUTO_EMAIL=off`. It needs Google
connected (Settings → Integrations); the email goes from your own Gmail.

The email is a short, honest introduction from Infinity Web & Apps. It is
written only from what DARWIN verified:
- it says "you don't have a website yet" only for leads verified as having none;
- it includes your phone number and Instagram;
- it ends with "reply stop" to opt out.

Safeguards:
- **Once per address, ever.** A second lead with the same address is skipped.
- **Only uncontacted leads.** Leads you've already contacted are skipped, and
  so are leads marked not interested or "do not email".
- **Real addresses only.** Addresses are never guessed, and no-reply addresses
  are skipped.
- **Limits.** At most `DARWIN_AUTO_EMAIL_DAILY_CAP` (40) emails in 24 hours,
  at least `DARWIN_AUTO_EMAIL_GAP_SEC` (45) seconds apart.
- **Stops if Gmail refuses.** On a quota or sign-in error it stops and tries
  again later. Nothing is marked "sent" unless Gmail confirms it.
- **One attempt per lead.** A lead whose email fails is shown as failed and not
  retried.

The daily job sends the emails, so DARWIN doesn't need to be open. The ring shows
"N emailed today · M waiting". Many businesses without a website list no email
at all. Those can't be emailed, so reach them by phone.

Settings (optional):
- `DARWIN_DAILY=off`
- `DARWIN_DAILY_TZ`
- `DARWIN_DAILY_START` (`06:00`)
- `DARWIN_DAILY_DEADLINE` (`14:00`)
- `DARWIN_DAILY_REQUIRE_PHONE` (`on`)
- `DARWIN_DAILY_TARGET` (`50`)
- `DARWIN_DAILY_LOCATIONS` and `DARWIN_DAILY_CATEGORIES` (comma- or line-separated; also editable in DARWIN)
- `DARWIN_DAILY_STRICT` (`on`)

Without Google Places or web search, strict mode can't confirm the absence of a website. Those businesses are reported as "unclear" rather than counted.

## Instagram on your PC

Vercel doesn't copy "Sensitive" values such as `INSTAGRAM_ACCESS_TOKEN` to your PC.
To avoid needing the token in `.env.local`:
- When your Vercel JARVIS uses a working Instagram token (for example when EV
  opens), it saves the connection to your JARVIS database. That's the same place
  Google and the other connections are kept. It only saves after Instagram
  confirms the token works.
- JARVIS on your PC (`npm run local`) reads that saved connection. Open EV once
  on Vercel and Instagram shows as connected on the PC too.
- A renewed token on Vercel replaces the saved one the next time it's used.
- A Facebook-style token (not starting with `IG`) no longer needs
  `INSTAGRAM_BUSINESS_ID`: EV looks up the Instagram business account itself.

If Instagram still isn't connected, EV says exactly why (no token here, or no
business account for the token).

**Publishing from your PC.** Instagram downloads the post and Reel itself, from a
public https address, and your PC's JARVIS runs at `localhost`. The media is kept in
your shared database, so your Vercel app serves the very same files:
- Your Vercel JARVIS saves its own address when you open EV there. This is just
  the address; no secret is stored.
- When you publish from your PC, EV gives Instagram the Vercel address for the
  media.
- Setting `APP_URL` in `.env.local` to your Vercel address works too.

Reels are capped at about 2.5 Mbit/s (under 4 MB for 12 s). A Vercel function
can't send more than 4.5 MB.

## Google Workspace (DARWIN and JARVIS)

Connecting Google (Settings → Integrations) gives JARVIS and DARWIN:
- Gmail and Calendar;
- **Drive, Docs and Sheets**, through the `google_workspace` tool;
- **Contacts**, read-only.

With it they can:
- find files and read Docs, Sheets, Slides and text files;
- create new Docs and Sheets;
- add rows to a Sheet;
- look people up in your Contacts.

They can't delete, overwrite or share anything. Sending email still needs your
approval, except DARWIN's automatic outreach if it's on. DARWIN also uses this for
the DARWIN Leads sheet.

**Reconnect to allow the new permissions.** If Google was connected before this
update, disconnect it and connect again. Until then, Drive, Sheets and Contacts
requests say so, and Gmail and Calendar keep working. In your Google Cloud project,
enable the Google Drive API, the Google Sheets API and the People API. While the
app's OAuth consent screen is in "Testing", add your account as a test user;
Google shows a warning for the Drive permission until the app is verified.

## Which brain each agent uses

| Agent  | Setting             | Default  | Meaning                                  |
| ------ | ------------------- | -------- | ---------------------------------------- |
| JARVIS | `JARVIS_PROVIDER`   | `groq,gemini` | Groq, Gemini as backup              |
| EV     | `EV_PROVIDER`       | `groq,gemini` | Groq, Gemini as backup              |
| DARWIN | `DARWIN_PROVIDER`   | `groq,gemini` | Groq, Gemini as backup              |
| MIKE   | `MIKE_PROVIDER`     | `gemini,groq` | Gemini, Groq as backup              |
| ULTRON | `ULTRON_AI_PROVIDER` (edith/.env) | `openrouter,ollama` | OpenRouter (`OPENROUTER_API_KEY`, model `OPENROUTER_MODEL`), with this PC's Ollama as the backup (model: `ULTRON_OLLAMA_MODEL`, else `OLLAMA_MODEL`, else `qwen2.5:3b`) |

`JARVIS_PROVIDER=ollama` puts JARVIS back on your PC brain (then `npm run local`
starts the brain gateway again), and `ULTRON_AI_PROVIDER=ollama` keeps ULTRON on
this PC only.

An old `ULTRON_AI_PROVIDER=groq,gemini` line in `edith/.env` (a previous default)
is turned off automatically, with a note. Any other `ULTRON_AI_PROVIDER` line is
treated as your choice and kept; ULTRON says at startup which setting is in effect.

A provider id (or comma list, tried in that order) means those providers and
nothing else — if they're all offline or out of quota, the agent says so
instead of quietly answering with another model.
`auto` restores the old behaviour: every configured provider, fastest first,
with automatic fallback.


## MIKE — market intelligence

MIKE (**Market Intelligence & Knowledge Engine**) is JARVIS's trading-analysis
specialist: a decision-support system that analyses real market data and tells
you when the evidence lines up — and, just as often, that it doesn't. It never
claims an accuracy figure, never promises profit and never places a trade.

**Open it:** say or type *"Activate Mike"* in JARVIS (or pick **MIKE** in the
nav, `/dashboard/mike`). Speech recognition often hears "Mike" as "mic",
"Mick" or "Myke" — *"activate mic"* works too (and from DARWIN and ULTRON),
while microphone phrases like "turn on the mic" or "unmute mic" never open
MIKE. Say *"back to JARVIS"* or *"deactivate mic"* to leave.
MIKE powers up with its own sequence: JARVIS opens an iris onto MIKE's floor,
then the core ignites, market data streams in from every edge, the rings draw
themselves, the boot log reports how the market feeds really came up, and the
panels fly into place. Click or press any key to skip; with "reduce motion"
turned on in your OS it's skipped automatically.

**Data (no key needed):**

| Market | Source | Shown as |
|---|---|---|
| Crypto | Binance public market data (Yahoo `BTC-USD` if Binance is blocked in your region) | `LIVE` |
| Indices, stocks, forex, commodities, ETFs, futures | Yahoo Finance chart feed | `DELAYED` (free feed, may lag), `MARKET CLOSED` or `STALE` |

If a feed can't be reached MIKE shows **LIVE DATA UNAVAILABLE** and makes no
analysis. News context is optional: with `SEARCH_API_KEY` (Tavily) MIKE reads
the last 3 days of headlines and shows them separately as *EXTERNAL
INFORMATION*; without it the analysis is price data only and says so.

**Live chart of any market:** say *"Mike, pull up the Tesla chart"*, *"show me
Reliance on the daily"*, *"open the Bitcoin chart"* — or ask JARVIS
(*"JARVIS, show me the gold chart"* opens MIKE straight onto it). Names are
looked up across every exchange Yahoo Finance covers (NSE/BSE, NYSE/NASDAQ,
LSE, indices, forex, futures, ETFs) plus crypto; the chart's search box does
the same. Crypto streams **tick by tick** from Binance's public WebSocket
(`LIVE STREAM`); other markets have no free streaming feed, so they refresh
every 10 seconds and stay labelled `DELAYED` / `MARKET CLOSED`. If the stream is
blocked where you are, the chart says so and falls back to polling. Scroll to
zoom, hover for OHLC, toggle indicators, and press **Analyze** for a full
MIKE analysis of what's on screen.

**What an analysis does**

1. Fetches the setup timeframe plus up to three higher timeframes and one lower
   (e.g. 15M → 1D, 4H, 1H, 15M, 5M).
2. Analyses each: HH/HL/LH/LL structure, break of structure / change of
   character, support/resistance, liquidity zones, EMA 20/50/200, SMA, RSI,
   MACD, ATR, ADX, Bollinger Bands, VWAP, OBV, Stochastic, Fibonacci — and the
   market regime (trend strength, volatility, breakout, reversal).
3. Runs 8 independent confirmations (structure, trend, momentum, volume,
   volatility, support/resistance, multi-timeframe, news context).
4. Scores **confidence 0–100** as a transparent weighted sum of those checks
   (90+ very strong · 80+ strong · 70+ moderate · 60+ weak · below 60 no-trade
   zone). Confidence measures evidence quality — **it is not a win probability**.
5. Either builds a trade sheet (entry zone, structural stop, 3 targets, R:R,
   invalidation, position size) or says **NO HIGH-CONVICTION SETUP** with the
   reasons (timeframe conflict, weak momentum, poor R:R, abnormal volatility,
   stale data, …).

Position size comes only from your risk settings and the stop distance —
never from confidence. Correlated open setups halve the risk and the daily
limit caps it. Set the account size in **Risk settings** (shield icon).

**Also in MIKE:** a market scanner with a live market panel and ticker; a
**backtester** that replays strategies bar by bar with no look-ahead
(next-bar entries, conservative stops, fees) and labels everything
*BACKTEST RESULTS*; a **signal journal** that records every analysis,
resolves setups from the candles that followed (MFE/MAE, outcome) and adds a
self-audit without ever editing the original; and **alerts** (price levels,
breakouts, volume spikes, RSI, trend reversals, new validated setups) that
only notify you. Alerts are checked while MIKE is open, every 5 minutes by
`npm run local`, and once a day by the Vercel cron (`/api/cron/mike`).

**Voice:** "Mike, scan the market" · "Mike, analyze Bitcoin on the 4 hour" ·
"Mike, find high-confidence setups" · "Mike, explain this chart" ·
"Mike, why is this a no-trade?" · "Mike, compare BTC and ETH" ·
"Mike, backtest this strategy". JARVIS can also ask MIKE directly
("how are the markets?") and gets a structured summary.

> Trading involves substantial risk. Analytical confidence does not guarantee profit.

Env (all optional): `MIKE_PROVIDER` (default `gemini,groq` — Gemini, Groq as backup), `MIKE_VOICE_ID`,
`SEARCH_API_KEY` for news. The new `MikeSignal` / `MikeAlert` tables come with
migration `0011_mike`: your next Vercel deploy applies it (the PC uses the same
database). With a separate local database, run `npm run db:migrate`.
