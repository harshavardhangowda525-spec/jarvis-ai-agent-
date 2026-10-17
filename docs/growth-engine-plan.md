# Infinity Business Growth Engine — diagnosis and plan

Written after inspecting the repository on 17 Oct 2026. Measured facts only;
anything not verifiable from here is marked so.

## 1. Agents and integrations that exist

| Agent / piece | Where | State |
|---|---|---|
| JARVIS (voice console, task brain) | `src/components/console/jarvis-console.tsx`, `src/lib/ai/*` | working |
| DARWIN (lead discovery, verification, daily 50) | `src/lib/darwin/*`, chat `/dashboard/chat/darwin` | working; see §3 |
| RUBIN / ROBIN (sales CRM, follow-ups, quotations, clients) | `src/lib/robin/*` | working |
| RUBEN (desktop island, Electron) | `desktop/rubin/*`, `src/components/island/*` | working; has its own CRM pop-up |
| EV / EVIE (Instagram content, daily post + Reel) | `src/lib/ev/*` | working |
| MIKE (market analysis) | `src/lib/mike/*` | working |
| ULTRON (EDITH dev agent on the PC) | `edith/*` | working |
| **ASTON** (website/app builder, teleprompter) | — | **does not exist** |
| **WhatsApp sending** (Business Platform API) | — | **not integrated** — only `wa.me` links that open the chat |
| **Central notification service / queue** | — | **does not exist** (RUBIN emails reminders; JARVIS speaks) |
| **Android companion app** | — | **does not exist** (JARVIS is a responsive web app) |
| Email sending | Gmail OAuth / SMTP (`src/lib/google/*`, DARWIN auto-email) | working when connected |
| Google Calendar | `src/lib/google/*` (DARWIN Workspace) | working when connected |
| Scheduler | Vercel Cron (`vercel.json`) + `npm run local` ticks | working |

"Qpify" is not referenced anywhere; the provider in the code is **Geoapify**
(`GEOAPIFY_API_KEY`), and its endpoints and auth (`/v1/geocode/search`,
`/v2/places`, `apiKey` query parameter) match Geoapify's documentation.

## 2. Data ownership today

| Data | Table(s) | Owner |
|---|---|---|
| Discovered businesses (+ dedup history, search cursors) | `DarwinLead`, `DarwinSearchCursor`, `DarwinCandidate`, `DarwinDailyRun` | DARWIN |
| Instagram-only leads | `DarwinIgLead`, `DarwinIgRun`, `DarwinIgCheck` | DARWIN |
| Sales CRM: stages, interactions, follow-ups, demos, quotations, clients, payments | `RobinLead` + 11 `Robin*` tables | RUBIN |
| RUBEN pop-up CRM | reads `RobinLead` through `/api/robin/island*` | RUBEN (UI only) |

**Two lead stores exist.** DARWIN leads are *copied* into `RobinLead`
(`src/lib/robin/darwin-sync.ts`, linked by `darwinLeadId`). That copy is what
the request asks to remove.

## 3. Lead generation — root causes found

1. **The health check proved nothing.** JARVIS's system analysis reported
   Geoapify "configured" whenever a key was set — a wrong, expired or
   out-of-quota key looked healthy. → Fixed: a real test request.
2. **No retries.** One network blip, timeout, 5xx or short rate limit stopped
   the whole search. → Fixed: bounded retries with backoff (honours
   `Retry-After`); a rejected key or used-up quota is never retried.
3. **Quota reported as a bad key.** HTTP 402 / quota answers said "rejected
   the API key". → Fixed: Authentication failed / Quota exhausted / Billing
   required / Rate limited / Provider error / Unreachable are told apart.
4. **Misleading source list.** DARWIN's overview listed OpenStreetMap as
   "always connected" and three search functions (Google, Foursquare, OSM
   discovery) that nothing called. → Removed; the list shows real roles.
5. **No run report** of discovered / errors / runtime. → Added to every run.
6. **Data coverage (not a bug).** Geoapify's data is OpenStreetMap: many
   Indian small businesses are listed without a phone or website. A missing
   website in the listing is *unknown*, not "no website" — DARWIN's daily run
   verifies it with Google Places / web search, which need at least one of
   `GOOGLE_PLACES_API_KEY`, `SEARXNG_URL`, `BRAVE_SEARCH_API_KEY`,
   `SEARCH_API_KEY`, `SERPER_API_KEY`. Without them leads stay "unclear".
7. **Not verifiable from the build environment:** your real keys, quotas and
   network. `npm run darwin:check` proves it on your PC.

## 4. Storage — measured

Measured in the project folder (`npm run storage`):

| | Before | After |
|---|---|---|
| Next.js build cache (`.next/cache`) | 877 MB | 0 MB (rebuilt on demand; now capped at 400 MB) |
| Dependencies (`node_modules`) | 859 MB | 859 MB — required |
| Electron for RUBEN | 295 MB | 295 MB — required |
| Face/gesture models | 40 MB | 40 MB — required |
| **Total** | **2,126 MB** | **1,248 MB** |

Unbounded growth found: the Next.js webpack cache (now capped) and ULTRON's
`audit.jsonl` (now rolls over at 2 MB). RUBEN's log was already capped. The
database lives on Neon (online), ~6 MB in the test copy.

## 5. Plan, by business impact

1. **Lead generation reliability** — done in this change (health, retries,
   states, run report, `npm run darwin:check`). Proven only when the check
   passes on your PC with your key.
2. **One CRM** — decision needed (§6): make one lead store canonical, remove
   the DARWIN→RUBIN copy, give it a simple light CRM screen, and point RUBEN's
   "Open CRM" at it through the same API. Migration with counts before/after.
3. **Import the existing ~400-lead CRM** — needs the provider name (§6).
   CSV/XLSX import works for any provider: preview, duplicate detection,
   status mapping, "already contacted" preserved, dry run on a sample first.
4. **JARVIS task delegation** — persistent task records (id, agent, status,
   timestamps, result, errors), cancel/retry/recover.
5. **Daily marketing plan + teleprompter page** — Vercel Cron (runs with the
   laptop off), saved plans with a revocable share link, email notification.
6. **ASTON** (website demos with previews) — a new agent; scope to agree.
7. **WhatsApp notifications** — needs a WhatsApp Business Platform account
   (Meta) or Twilio, an approved template and a phone number.
8. **Android** — recommend an installable PWA first (push, voice, deep links,
   dialler `tel:` links); a native app needs Android Studio and Play/APK setup.

## 6. Decisions needed from you

- Which CRM holds the ~400 contacted leads (HubSpot, Zoho, Google Sheets,
  Excel, …)? Can you export it as CSV/XLSX?
- Clear DARWIN's current CRM after a verified backup — yes/no (an in-app
  confirmation will still be required).
- WhatsApp: do you have a Meta WhatsApp Business account or Twilio?
