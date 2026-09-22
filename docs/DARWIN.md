# DARWIN — Lead Generation, CRM & Follow-up Agent

DARWIN is a **real** lead-generation, CRM and follow-up agent for Infinity Web &
Apps — a standalone internal agent inside JARVIS that **reuses** the shared
infrastructure (agent loop, voice, DB, auth, command router). **Real data only:
DARWIN never fabricates businesses, contacts, activity, analytics, or sends.**

## Hard rule — no mock data
- Leads come only from **connected sources**. With none connected, DARWIN shows
  **"NO REAL DATA AVAILABLE — CONNECT A DATA SOURCE"** — it never pads a list.
- Every lead keeps its **source** and which fields are **VERIFIED FACT** vs
  **AI ANALYSIS** (opportunity type + lead score are always labeled AI analysis).
- No message/email is ever reported "sent" unless the provider confirms it.

## Lead sources (modular)
| Source | Status |
|---|---|
| **Google Places** (New Places API) | real discovery — set `GOOGLE_PLACES_API_KEY` |
| CSV import / manual | always available (user-provided) |

Adding a source = one file in `src/lib/darwin/sources.ts` — the rest of the
architecture (dedup, CRM, tools, UI) is unchanged.

## The brain & tools (agent-scoped to `darwin`)
| Tool | Purpose |
|---|---|
| `darwin_search` | Find **real** businesses from a source → dedupe → store. Reports the true count. |
| `darwin_leads` | Read the CRM: list/filter, get one lead + history, stats, needs-attention. |
| `darwin_qualify` | Attach an **AI** opportunity analysis + optional AI lead score. |
| `darwin_stage` | Move a lead through the pipeline; logs the change. |
| `darwin_note` | Add a note to a lead. |
| `darwin_followup` | Schedule / list (due·today·overdue) / complete follow-ups. |
| `darwin_outreach` | Draft a personalized message from the lead's real info (approval-required). |
| `darwin_message` | **Send** via a connected channel (email/Gmail) — approval-gated; real states only. |

Pipeline: `new → qualified → contacted → replied → interested → demo →
proposal → negotiation → won / lost / follow_up`.

## Duplicate protection
A business is fingerprinted by its strongest identifier — website domain, then
phone, then name+location — so the same business is never stored twice.

## Data model (Prisma)
`DarwinLead` (lead/company + verified-fields + AI analysis + source provenance),
`DarwinActivity` (real event log), `DarwinFollowUp`, `DarwinMessage` (real
delivery states). Per-user isolated, indexed.

## Dashboard
A sci-fi command center at **`/dashboard/darwin`**: a central holographic core
that reacts to DARWIN's state (IDLE·LISTENING·THINKING·SEARCHING·PROCESSING·
WAITING_FOR_APPROVAL·COMPLETED·ERROR), a **minimal HUD** (status, current
operation, pipeline, follow-up alerts, source connection status, approvals), a
voice/text command bar, and a **Lead Explorer** that shows real leads with their
source, verification badges, and clearly-labeled AI analysis. When no source is
connected it shows the "NO REAL DATA AVAILABLE" banner instead of sample leads.

Open it by voice/text from JARVIS ("open DARWIN" / "activate DARWIN") or the
sidebar. EV's `ev_leads` reads DARWIN's CRM directly, so EV works on the same
real leads.

## Configuration
```
GOOGLE_PLACES_API_KEY="..."   # Google Cloud → enable "Places API (New)"
APP_ENV="production"
MOCK_DATA="false"             # real data only
```
Email outreach uses the Google (Gmail) integration you connect in Settings.
All keys are server-side; nothing is exposed to the browser.

## Example commands
```
Darwin, find 20 real cafes in Bengaluru that have a website.
Darwin, show me leads that haven't replied.
Darwin, prepare follow-ups for today.
Darwin, show overdue follow-ups.
Darwin, qualify this lead and draft outreach.
Darwin, send the outreach to this lead.   ← asks approval, then really sends
```
