# EV — Marketing & Growth Agent

EV is a **standalone internal agent inside JARVIS**, dedicated to growing
**Infinity Web & Apps** (websites from ₹4,999, apps from ₹55,000,
@infinitywebapps). It does **not** replace or duplicate JARVIS, EDITH, or any
other agent — it reuses the exact same infrastructure and only swaps in its own
brain, tools, memory, and a cinematic presentation layer.

## What is reused (no duplication)

| Concern            | Reused from JARVIS                                   |
| ------------------ | --------------------------------------------------- |
| Command router     | `sendRef` intercept in `jarvis-console.tsx`         |
| Voice (STT/TTS/VAD)| `useVoice` — EV speaks with the JARVIS voice        |
| Agent loop         | `runAgent` (`src/lib/ai/agent.ts`) with `agent:"ev"`|
| AI providers       | The same fallback chain (Gemini/Groq/… via env)     |
| Database / auth    | Prisma + JWT session                                |
| Streaming API      | `POST /api/agent` (NDJSON), via `useAgent`          |

EV never hard-codes a model name — it uses whatever `AI_PROVIDER` / `*_MODEL`
env vars configure, exactly like JARVIS.

## Activation / deactivation (voice or text)

- **Activate:** "Activate EV", "Open EV", "Start EV", "EV mode", or just "EV".
  → EV replies *"EV online. Marketing systems ready."* and the cinematic EV
  dashboard materializes over the JARVIS interface (no reload).
- **Deactivate:** "Close EV", "Exit EV", "Deactivate EV", "Back to JARVIS".
  → EV stands down and the normal JARVIS interface returns.

## The brain

`src/lib/ev/prompt.ts` gives EV a proactive senior-growth-marketer persona
scoped exclusively to Infinity Web & Apps, with hard honesty rules:

- **No repetition.** Every idea/caption is fingerprinted and compared against
  memory (`src/lib/ev/dedup.ts`); substantially similar content is rejected.
- **Approval before anything external.** EV presents `CONTENT READY …` and waits;
  it only publishes/sends after explicit approval ("approve", "publish it", …).
- **No fake data.** If DARWIN or Instagram isn't connected, EV says so — it never
  invents businesses, phone numbers, or analytics.

## Tools (agent-scoped to EV)

| Tool            | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `ev_content`    | Store content, **duplicate-check**, approval lifecycle, stats    |
| `ev_ideas`      | Idea engine: niche **gap analysis** + batch store (deduped)      |
| `ev_image`      | Generate a **real** image (Gemini/OpenAI) → public URL to publish|
| `ev_leads`      | DARWIN bridge for **real** leads (honest when not connected)     |
| `ev_instagram`  | Profile / media / insights + **approval-gated** publish (real)   |
| `ev_analytics`  | Real IG + content metrics; states clearly what's unavailable     |
| `ev_outreach`   | Personalized outreach **drafts** (never sends, never bulk)       |

### Content generation

EV writes all the copy itself (captions, hooks, reel scripts, ads, CTAs) via the
LLM brain, then `ev_content` stores + dedupes it. For **visuals**, `ev_image`
calls the configured image model, stores the bytes (`EvMedia`), and returns a
public URL served at `/api/ev/media/<id>` — that URL is what Instagram's Graph
API fetches when publishing. No external image host is required.

These only appear when EV is active; the base JARVIS toolset is unchanged.

## Memory

`EvContent` (Prisma) stores every piece with a `status` lifecycle
(`draft → ready → approved/rejected/scheduled → published`), `niche`, `theme`,
and a normalized `fingerprint` for the no-repeat guarantee. Per-user isolated.

## Operating states → UI

`IDLE, LISTENING, THINKING, GENERATING, WAITING_FOR_APPROVAL, EXECUTING,
SUCCESS, ERROR` are derived from the real voice + agent + tool signals and drive
the hologram and the two glass panels (**EV ACTIVITY**, **COMMAND**).

## Configuration (all server-side)

```
# Instagram (auto-detects Instagram-Login "IG…" tokens vs Facebook Graph tokens)
INSTAGRAM_ACCESS_TOKEN="…"
INSTAGRAM_BUSINESS_ID=""        # leave blank for IG-Login tokens ("me")
INSTAGRAM_GRAPH_VERSION="v21.0"

# DARWIN lead discovery (optional; EV degrades honestly if unset)
DARWIN_API_URL=""
DARWIN_API_KEY=""

# Image generation — reuses the Gemini/OpenAI key; provider/model overridable
EV_IMAGE_PROVIDER=""   # "gemini" | "openai" (blank = auto)
EV_IMAGE_MODEL=""      # e.g. gemini-2.5-flash-image | gpt-image-1
```

Tokens never reach the browser. A per-user Instagram OAuth connection
(Integration table) takes precedence over the env token when present.

## Example commands

```
Activate EV.
EV, what's today's marketing plan?
EV, give me five fresh content ideas.
EV, create a reel for gyms.
EV, design a post with an image for my ₹4,999 website offer.
EV, create an ad for my ₹4,999 website offer.
EV, analyze our recent content.
EV, find leads through DARWIN.
EV, create a personalized message for this gym.
EV, show me pending approvals.
Back to JARVIS.
```
