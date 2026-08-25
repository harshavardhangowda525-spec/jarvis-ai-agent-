# JARVIS Operator — visible browser computer-control

This is the **local companion service** that lets JARVIS control a **real,
visible browser** on your own computer. Your JARVIS web app (on Vercel) sends
commands to this service; this service drives Chromium in front of you.

## Why it's separate from the web app

The JARVIS web app runs on Vercel (serverless): no screen, headless, killed
after seconds, and no access to your logged-in sessions. A browser you can
*watch*, with *your* Gmail/Instagram logins, can only run on **your machine**.
So this Operator runs locally and the web UI pairs with it over a localhost
WebSocket.

```
JARVIS Web UI (browser)  ──ws://127.0.0.1:7317──►  JARVIS Operator (this)
                                                     └─ Playwright, headed
                                                        persistent profile
                                                        observe → plan → act
```

## Setup (one time)

```bash
cd operator
npm install
npx playwright install chromium      # downloads the browser Playwright drives
cp .env.example .env                 # then put your AI key(s) in .env
```

Put at least one AI provider key in `operator/.env` (same keys as your web app):

```
GROQ_API_KEY=...        # or GEMINI_API_KEY / CEREBRAS_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY
# optional overrides:
# GROQ_MODEL=openai/gpt-oss-120b
# OPERATOR_PORT=7317
```

## Run

```bash
npm run operator
```

It prints a **URL** and a **TOKEN**. In the JARVIS web app go to
**Dashboard → Operator**, paste both, and click **Pair**. That's it — type or
speak a command and watch the browser work.

## How logins work (important)

- The browser uses a **persistent profile** in `operator/browser-data/`, so once
  you log into a site **manually**, that session is reused next time.
- JARVIS **never types passwords, OTP, 2FA, or solves CAPTCHAs.** If a site needs
  any of those, JARVIS stops and asks you to do it in the window, then continues.
- No passwords are stored by JARVIS. Only the sites' own cookies live in the
  profile folder (same as a normal browser).

## Safety model

- **Modes:** Autonomous (safe + moderate auto-run), **Confirmation (default,**
  moderate & high-impact ask first), Manual (only suggests).
- **High-impact actions** (send, submit, delete, purchase, publish, change
  settings) **always** require an explicit confirmation immediately before they
  run — regardless of mode.
- **STOP** halts everything instantly and returns control to you. The browser
  stays open.
- Page content is treated as **untrusted**: the brain is instructed never to
  follow instructions embedded in web pages.
- The control server binds to **127.0.0.1 only** and requires the pairing
  **token**, so no website and no other machine can drive JARVIS.

## Files

```
operator/
├─ run.mjs                 entrypoint
├─ src/
│  ├─ browser/manager.mjs  persistent headed Chromium
│  ├─ browser/observe.mjs  page → compact snapshot (tags elements)
│  ├─ browser/find.mjs     robust semantic element finding
│  ├─ browser/actions.mjs  click/type/select/scroll/navigate + recovery
│  ├─ provider.mjs         LLM (reuses your AI keys)
│  ├─ planner.mjs          command → plan; observation → next action
│  ├─ risk.mjs             safe/moderate/high classification + gating
│  ├─ router.mjs           app → adapter
│  ├─ adapters/            gmail, google, youtube, generic web
│  ├─ session.mjs          orchestrates one command, streams events
│  └─ server.mjs           localhost WebSocket + token pairing
└─ browser-data/           persistent browser profile (gitignored)
```

## Troubleshooting

- **UI can't connect:** make sure `npm run operator` is running and the token
  matches. If your browser blocks `ws://localhost` from an `https://` page, run
  the web app locally (`npm run dev`) and pair from `http://localhost:3000`.
- **"No AI provider":** add a key to `operator/.env`.
- **Browser didn't download:** run `npx playwright install chromium`.
