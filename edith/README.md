# EDITH — JARVIS's software-development subagent

EDITH is JARVIS's specialist developer. It performs **real** development work —
reads/writes files, runs terminal commands, uses git, builds, tests, and (when
providers are connected) deploys — on **your machine**, driven by natural-language
goals. JARVIS stays the orchestrator; EDITH is the coder.

## Why it runs locally (not on Vercel)

Real filesystem writes, a real terminal, dev servers, builds and deployments cannot
run on Vercel serverless (ephemeral, read-only, seconds-long timeouts). So EDITH is a
**local runtime** on your computer, and the JARVIS web UI pairs with it over a
token-protected localhost WebSocket — exactly like the Operator.

```
JARVIS Web UI ──ws://127.0.0.1:7420──► EDITH runtime (this)
  Dashboard → EDITH                       real fs / terminal / git / build / deploy
```

## What's real (verified) vs. what needs credentials

Run `npm run selftest` — it exercises the real tools against a throwaway workspace and
proves: real file writes, real command execution with real exit codes, a real git
commit hash, real build/test, blocked workspace-escape, and deploy honestly reporting
"not connected". **Nothing is simulated.**

- ✅ Real now: file read/write/edit/search/move/delete, terminal (stdout/stderr/exit/
  timing), git status/diff/log/init/commit, detect/install/build/test/lint, HTTP health
  check, capability check, the agentic coding loop, safety gating, audit log.
- 🔌 Needs credentials (shown as "not connected" until set): deployment to Vercel /
  Netlify / Cloudflare. Set the provider token and EDITH runs the provider's REAL CLI.

## Real deployment (Vercel, end-to-end)

EDITH deploys through the provider's actual CLI and then **verifies the result** —
no fabricated success:

1. Set a token in `edith/.env` (get one at vercel.com → Account → Settings → Tokens):
   ```
   VERCEL_TOKEN=your_real_token
   ```
2. Point EDITH at the project (`EDITH_WORKSPACE=/path/to/site`) and run `npm run edith`.
3. Ask EDITH: **"deploy this to production"** (or "deploy it").
4. EDITH will:
   - run `npx vercel --prod --yes --token …` in the workspace (the real deploy),
   - extract the live `*.vercel.app` URL from the CLI output (skipping dashboard links),
   - **verify** it with real HTTP(S) checks — status code, latency, HTTPS — retrying a
     few times while the deployment propagates,
   - report e.g. *"Deployed to https://cafe-site.vercel.app and verified live
     (HTTP 200, 180ms, HTTPS)."* — and the URL is clickable in the JARVIS panel.
   If the token is missing it says exactly that; if the deploy or verification fails it
   reports the real exit code / status, and does **not** claim success.

Netlify (`NETLIFY_AUTH_TOKEN`) and Cloudflare (`CLOUDFLARE_API_TOKEN`) work the same way.

## Setup

```bash
cd edith
npm install
cp .env.example .env         # add a GROQ/GEMINI/etc. key; optionally EDITH_WORKSPACE
npm run selftest             # prove the tool layer works (no key needed)
npm run edith                # start the runtime
```

It prints a URL + TOKEN. In JARVIS → **Dashboard → EDITH**, paste both, click
**Activate EDITH**, then give it a goal:

- "Create a simple website in ./cafe and run the build."
- "Inspect this project and tell me what's wrong."
- "Add a /health route and test it."
- "Commit the changes with a clear message."
- "Deploy it." (works when a provider token is set; otherwise says what to configure)

## Safety

- **Workspace isolation**: every operation is confined to the selected workspace; path
  escapes are rejected.
- **Command policy**: SAFE (build/test/read) auto-runs; REVIEW (commit/push/deploy)
  confirms in the default mode; DANGEROUS (`rm -rf`, `DROP DATABASE`, force-push, `sudo`)
  ALWAYS confirms. Modes: Autonomous / Confirmation (default) / Manual.
- **STOP** (button or Ctrl+Shift+X) kills running processes and halts the agent.
- **Secrets**: never printed — terminal output is scanned and `KEY=value` secrets are
  redacted. Deploy tokens live in env only.
- **Localhost + token**: the server binds to 127.0.0.1 and requires the pairing token,
  so no web page can drive EDITH.
- **Audit log**: every goal, tool call, and result is written to `.edith/audit.jsonl`
  in the workspace. Real events only.

## Files
```
edith/
├─ run.mjs               entrypoint + .env loader
├─ selftest.mjs          real-execution proof of the tool layer
├─ src/
│  ├─ workspace.mjs      workspace isolation
│  ├─ provider.mjs       LLM (reuses your AI keys)
│  ├─ safety.mjs         SAFE/REVIEW/DANGEROUS classifier
│  ├─ tools/fs.mjs       real filesystem ops
│  ├─ tools/terminal.mjs real command execution (+ kill for STOP)
│  ├─ tools/git.mjs      real git
│  ├─ tools/build.mjs    detect/install/build/test/lint + health + deploy adapters
│  ├─ registry.mjs       tool registry (name → real handler + risk)
│  ├─ agent.mjs          the coding loop (understand→…→verify→report)
│  ├─ capabilities.mjs   real capability check
│  ├─ audit.mjs          audit log + project memory
│  └─ server.mjs         localhost WebSocket + token pairing
└─ .env.example
```
