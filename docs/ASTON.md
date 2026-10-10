# ASTON — attention manager

ASTON watches Infinity Web & Apps' real systems and tells you when a person is
needed. It lives at **`/aston`**: a full-screen holographic orb you can talk to
(browser speech) or type to. There's no dashboard. When something needs you, the
orb turns amber/red, says what happened, and offers **Acknowledge / Resolve /
Approve**.

```
signals ──► incident store (Postgres) ──► verify ──► Groq summary ──► alerts
 GitHub webhook (builds, deploys)     dedup by     still real?   (template if   browser → email
 signed events (anything)             fingerprint  resolved?      Groq is down)  → phone (opt-in)
 site probes, DARWIN/EV/RUBIN/JARVIS
 records, gate lockouts                                                  undelivered → shown in ASTON
```

## What ASTON detects (real data only)

| Signal | Source | Default priority |
|---|---|---|
| Production site down (fails **two** checks) | `ASTON_WATCH_URLS` probes | critical |
| Production incident reported by a monitor | signed event + ASTON re-checks the URL | critical |
| Failed build / CI on the default branch | GitHub `workflow_run` webhook | high (other branches: normal) |
| Failed deployment (incl. Vercel via GitHub) | GitHub `deployment_status` webhook | high for production |
| Blocked task / client decision needed | signed event (`task_blocked`, `decision_required`) | high |
| Repeated agent failures (≥3 in 1 h) | the activity log every agent writes (JARVIS, ULTRON/EDITH, DARWIN, EV, MIKE, RUBIN) | high |
| DARWIN daily search failed / needs setup | `DarwinDailyRun` | high |
| EV daily content failed | `EvDaily` | high |
| EV post waiting for approval | `EvDaily` | normal (shown, not pushed) |
| High-priority task due within 24 h or overdue | JARVIS tasks | high |
| Overdue high-priority RUBIN follow-up | `RobinFollowUp` | normal |
| JARVIS locked itself after failed unlock attempts | biometric gate | high (stays open until you acknowledge it) |

Groq never decides whether something failed. It only writes the spoken summary
and the suggested next action from the recorded facts.

## Attention rules

1. **Verify.** A production incident reported from outside is re-checked, and
   it's dropped if the site is up. Webhooks must carry a valid HMAC signature.
2. **Already resolved?** A success event (a green build or a successful deploy)
   closes the incident. A detector that no longer sees the problem closes it as
   recovered. Undelivered alerts for a closed incident are cancelled.
3. **No duplicates.** An open incident owns a unique `openKey`, so repeats,
   even concurrent ones, only increase `occurrences`. Each incident gets at
   most one alert per channel, plus one reminder after 60 minutes for an
   unacknowledged critical incident.
4. **Alert content:** project, problem, recovery attempts, recommended next
   action, and a link to ASTON.
5. **Delivery failure:** email retries with backoff (2, 4, 8, 16 minutes, up to
   5 attempts). Everything stays in the database and shows in ASTON the next
   time you open it.

**Approvals.** Safe actions (re-checking a site) ASTON runs itself. Consequential
actions, such as triggering a redeploy through `ASTON_REDEPLOY_HOOK_URL`, are
only *proposed*. They run only when you press **Approve** and confirm, which the
API enforces with `confirm: true`. The model can never approve anything.

## Configuration (server environment only — never in the browser or in git)

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Groq key ([console.groq.com/keys](https://console.groq.com/keys)). Shared with JARVIS. |
| `GROQ_MODEL` | Default `openai/gpt-oss-120b` (production model with tool use + JSON mode). |
| `ASTON_OWNER_EMAIL` | Your JARVIS login. Only this account can open ASTON or decide (others get 403). Webhook events go to this user. |
| `ASTON_NOTIFICATION_CHANNEL` | `browser,email` (default), `browser`, `email`, or `none`. |
| `ASTON_WEBHOOK_SECRET` | Enables `POST /api/aston/events`. |
| `ASTON_GITHUB_WEBHOOK_SECRET` | Enables `POST /api/aston/github`. |
| `ASTON_WATCH_URLS` | `Name\|https://site, Other\|https://other`. |
| `ASTON_REDEPLOY_HOOK_URL` | Optional Vercel deploy hook, used **only after approval**. |
| `ASTON_PHONE_ALERTS_ENABLED` | `false` by default. |
| `ASTON_PHONE_MODE` | `test` by default (never dials). `live` places real calls. |
| `ASTON_OWNER_PHONE_NUMBER` | E.164, e.g. `+91XXXXXXXXXX`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER` | Only needed for live calls. |
| `CRON_SECRET` | Protects `/api/cron/aston` (already used by JARVIS). |

Tuning (optional): `ASTON_AI_DAILY_CAP` (300), `ASTON_AI_TIMEOUT_MS` (20000),
`ASTON_AI_MAX_RETRIES` (2), `ASTON_FAILURE_THRESHOLD` (3),
`ASTON_PHONE_MAX_CALLS_PER_DAY` (2), `ASTON_PHONE_COOLDOWN_MINUTES` (60),
`ASTON_PHONE_MAX_DAILY_USD` (0.50), `ASTON_PHONE_EST_COST_USD` (0.15).

### Setup steps

1. Set `GROQ_API_KEY` and `ASTON_OWNER_EMAIL` (Vercel → Settings → Environment
   Variables), then redeploy. The `0021_aston` migration runs during the build.
2. Run `npm run aston:check-groq` locally. It confirms the model is listed, can
   call tools, and returns JSON. It also prints your remaining quota. You can
   also run the same check from the server with `POST /api/aston/ai/check`
   while signed in as the owner.
3. **GitHub** (failed builds and deployments): in each repo, go to Settings →
   Webhooks → Add webhook. Use payload URL `https://<app>/api/aston/github`,
   content type `application/json`, and secret = `ASTON_GITHUB_WEBHOOK_SECRET`.
   Select the events "Workflow runs" and "Deployment statuses".
4. **Heartbeat:** webhooks are instant. Site probes and agent checks run on a
   schedule:
   - in an open ASTON tab, every 2 minutes
   - with `npm run local`, every 2 minutes
   - through Vercel Cron, daily on the Hobby plan
   - through the free GitHub Actions workflow `.github/workflows/aston-tick.yml`,
     every 10 minutes, once you add the repo secrets `ASTON_APP_URL` and
     `CRON_SECRET`
5. **Email alerts** are sent from your own Gmail. Connect Google in JARVIS
   Settings → Integrations.
6. **Desktop alerts:** open `/aston` and click **Enable desktop alerts**. While
   any JARVIS screen is open, critical and high alerts appear as desktop
   notifications.

### Sending your own events

```bash
BODY='{"kind":"task_blocked","key":"client-x-logo","title":"Waiting for client logo","project":"Client X site"}'
TS=$(date +%s)
SIG="sha256=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$ASTON_WEBHOOK_SECRET" -hex | sed 's/^.* //')"
curl -X POST https://<app>/api/aston/events -H "content-type: application/json" \
  -H "x-aston-timestamp: $TS" -H "x-aston-signature: $SIG" -d "$BODY"
```

Send the same `key` with `"status":"resolved"` to close it. Kinds:
`build_failed`, `deploy_failed`, `prod_incident`, `task_blocked`,
`decision_required`, `agent_failures`, `security`, `deadline_risk`, `info`.

## Costs and limits (checked October 2026; verify before relying on them)

**Groq (AI):** free tier, no card needed. The published free-tier sample limits
for `openai/gpt-oss-120b` are about 30 requests/min, 1,000 requests/day, 8,000
tokens/min and 200,000 tokens/day. They are **per organization**, so JARVIS and
ASTON share them. Groq calls these sample limits; your real numbers are at
console.groq.com/settings/limits. Free access isn't guaranteed to stay free or
unchanged.

ASTON's protections:
- It caps itself at 300 requests/day (`ASTON_AI_DAILY_CAP`).
- It reads Groq's rate-limit headers.
- On a daily-quota 429 it stops completely until the reset time. This is
  persisted, so a restart doesn't resume hammering Groq.
- It waits out a short per-minute limit once.
- After 2 retries on outages it opens a 2-minute circuit.

ASTON **never falls back to another provider**. Without Groq it keeps working
with template alerts and says the AI is unavailable. Paid Groq usage only
happens if you upgrade the Groq account yourself (Developer tier: per-token
billing).

**Notifications:** browser notifications are free. Gmail is free within
Gmail's normal sending limits. In-app display is free.

**Phone calls (Twilio): not free.**
- A trial includes limited free credit or minutes, can only call **verified**
  numbers, plays a trial notice before your message, and is limited to your
  sign-up country.
- Pay-as-you-go outbound calls to an Indian mobile were listed at about **$0.05
  per minute** on Twilio's pricing page, plus the monthly phone-number rental.
- ASTON enforces 2 calls/day, a 60-minute cooldown and a $0.50/day budget
  estimate by default.
- It only dials when `ASTON_PHONE_ALERTS_ENABLED=true` **and**
  `ASTON_PHONE_MODE=live`.
- `POST /api/aston/phone/test` always uses the test provider and never places a
  call.

## Website builder

Say or type something like **"build a website for Brew Lab, a specialty café in
Indiranagar, warm and modern"**. A liquid-glass window opens over the orb. ASTON
writes the site live, and you watch the code stream into the editor (plan.json →
styles.css → index.html, one section at a time) while the page assembles in the
preview beside it.

- **Output:** one self-contained, responsive, animated HTML file. It has Google
  Fonts, a fixed header with a mobile menu, scroll reveals, inline SVG art, and
  no frameworks or paid services.
- **About 5 minutes, on Groq's free tier.** The build is done in small steps
  (plan, stylesheet, then each section) so every request fits Groq's free
  per-minute token budget. If Groq asks ASTON to slow down, the window shows a
  countdown and carries on. Every step is saved, so a closed tab, a restart or a
  pause simply resumes. **Pause after this step** and **Resume** are in the
  window.
- **Honest content.** ASTON only uses facts from your brief. Unknown phone
  numbers, addresses and prices appear as `[placeholders]`, and any
  testimonials are labelled as samples.
- **Changes:** when the site is ready, type a change ("make the hero darker").
  ASTON picks the part to change and rewrites it live.
- **Your sites:** use **Open full screen** or **Download** (one `.html` file).
  **Websites** at the bottom of ASTON lists past builds.
- **Safety:** model-written `<script>` tags, inline handlers, `javascript:` links
  and embeds are stripped; the only JavaScript is ASTON's small runtime. Previews
  run in a sandboxed frame, and the full-screen page is served with a CSP
  sandbox, so a generated page can never reach JARVIS.
- **Not included yet:** real photos (illustrations are SVG/CSS), multi-page
  sites, and publishing. Publishing would be a separate, approval-gated step.

## Limitations

- Browser notifications need an open JARVIS/ASTON tab. There's no service-worker
  push. When no tab is open, email (and optional phone) carry the alert.
- On Vercel Hobby, scheduled checks need the GitHub Actions heartbeat (or an open
  tab) to run more often than daily. Webhook-driven alerts are instant.
- Voice uses the browser's built-in speech recognition and synthesis. Chrome and
  Edge support recognition; elsewhere use the text box.
- "Blocked task" and "client decision needed" come from signed events (or EV's
  approval queue). JARVIS tasks have no "blocked" status of their own.
