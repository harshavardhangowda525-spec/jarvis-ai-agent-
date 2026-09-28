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
- [Memory — "remember that…"](#memory--remember-that)
- [NIOS board notifications](#nios-board-notifications)
- [EV daily content](#ev-daily-content)
- [Gesture control](#gesture-control)
- [DARWIN daily lead search](#darwin-daily-lead-search)

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
plus the Ollama brain gateway and the ULTRON runtime on your own computer, in one
window. Ollama is reached directly on `127.0.0.1` (no Cloudflare tunnel, no round
trip through Vercel), and it uses the **same database** as your Vercel app, so your
account, memories, leads and chats are identical in both places.

```bash
# one time: copy your app settings from Vercel
npx vercel login
npx vercel link
npx vercel env pull .env.local --environment=production

npm run local        # builds when the code changed, starts everything, opens http://localhost:3000
```

- JARVIS runs only on the PC brain; EV, DARWIN and ULTRON run only on Groq (see
  "Which brain each agent uses" below). The Ollama model comes from `edith/.env` (`OLLAMA_MODEL`).
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

JARVIS opens websites and links in a **new tab**, alongside launching apps:

- **Sites by name:** "open YouTube", "open Gmail in a new tab", "open Amazon and search for USB cables", "search YouTube for lo-fi".
- **Any address:** "open https://github.com/…", "go to example.com/docs", "open this link www.example.org", "open localhost:3000". Paste a link on its own (`https://…` or `www.…`) and it opens too.
- **Links JARVIS showed you:** "open that link", "open the second link", "click the last link".
- **App or website?** JARVIS keeps the list of apps installed on your PC (from ULTRON), so it decides instantly: "open Spotify" launches the Spotify app if it's installed, and "open YouTube" opens a tab. Without ULTRON running, every known site opens as a tab.
- **Pop-up blocker:** a tab opened from a typed command or click always works. Voice commands and AI replies aren't clicks, so the browser may block the tab. Then ULTRON (when running) opens the link in your default browser, and otherwise the reply has an "Open …" button. Allowing pop-ups for your JARVIS site (icon at the right of Chrome's address bar) makes voice links open directly.
- **Safety:** ULTRON only opens `http`/`https` addresses, as one argument to the system's own URL opener (no shell), and only for your paired JARVIS app. `ULTRON_APPS=off` turns this off too.

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

| Time | Step |
| --- | --- |
| 04:00 | **Research.** Reads every past package and EV's content memory, then picks a niche, a service (websites, apps, automation, AI, online ordering/booking, software, redesigns, AI marketing) and a format that haven't been used recently. |
| 04:15 | **Content.** EV's writing brain (`EV_PROVIDER`) writes the topic, hook, caption, CTA, 10–15 hashtags, the creative concept and the Reel story. A draft too close to anything recent is rewritten. |
| 04:45 | **Creative.** A real image from Gemini/OpenAI (or Magic Hour), with no text baked in. |
| 05:00 | **Video.** A real MP4 Reel (1080×1920, about 12 s). The hook lands in the first second, two on-screen beats follow, and a brand end card shows the CTA, 8317480583 and @infinitywebapps. If Magic Hour is connected and `APP_URL` is public, the creative is animated there first and then cut into the Reel. Otherwise EV renders the Reel itself from the image (ffmpeg with Inter, bundled). |
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
| Closed fist (hold) | Pause: stops JARVIS speaking, the reply in progress and playing media. Background jobs keep running |
| Thumbs up (hold) | Approve: EV's daily content, the creative on screen, or text EV is holding |
| Thumbs down (hold) | Reject: EV's content (makes a new version), dismiss a creative, or cancel a pending shutdown |
| Point | Aim: a holographic pointer follows your index finger and highlights what it's on |
| Pinch (thumb + index) | Click whatever you're pointing at, such as an agent node, a button, or EV's Approve |
| Two-finger swipe ← / → | Previous / next item |
| Open palm sweep ← | Go back: closes the popup, EV, Humanoid View… |
| Open palm sweep → | Next interface: JARVIS → EV → Humanoid View → DARWIN → ULTRON |

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

**How a day runs** (from 06:00 in `DARWIN_DAILY_TZ`, default Asia/Kolkata):
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

**What drives it:**
- Vercel Cron `/api/cron/darwin-daily` at 06:00 and 09:00 IST (needs `CRON_SECRET`).
- `npm run local`, every 5 minutes.
- JARVIS or DARWIN whenever they're open.

It survives restarts and refreshes: progress lives in `DarwinDailyRun`, checked businesses in `DarwinCandidate`, and leads in `DarwinLead`. Each new day starts a new run; earlier leads and reports are kept.

Settings (optional):
- `DARWIN_DAILY=off`
- `DARWIN_DAILY_TZ`
- `DARWIN_DAILY_START` (`06:00`)
- `DARWIN_DAILY_TARGET` (`50`)
- `DARWIN_DAILY_LOCATIONS` and `DARWIN_DAILY_CATEGORIES` (comma- or line-separated; also editable in DARWIN)
- `DARWIN_DAILY_STRICT` (`on`)

Without Google Places or web search, strict mode can't confirm the absence of a website. Those businesses are reported as "unclear" rather than counted.

## Which brain each agent uses

| Agent  | Setting             | Default  | Meaning                                  |
| ------ | ------------------- | -------- | ---------------------------------------- |
| JARVIS | `JARVIS_PROVIDER`   | `ollama` | your PC brain (Ollama) only              |
| EV     | `EV_PROVIDER`       | `groq,gemini` | Groq, Gemini as backup              |
| DARWIN | `DARWIN_PROVIDER`   | `groq,gemini` | Groq, Gemini as backup              |
| ULTRON | `ULTRON_AI_PROVIDER` (edith/.env) | `groq,gemini` | Groq, Gemini as backup |

A provider id (or comma list, tried in that order) means those providers and
nothing else — if they're all offline or out of quota, the agent says so
instead of quietly answering with another model.
`auto` restores the old behaviour: every configured provider, fastest first,
with automatic fallback.
