# Morning Briefing Analyser — Technical Approach

> Companion to `requirement.md`. This document proposes *how* we build the
> read-only morning briefing analyser. It is written for review — nothing
> here is final until we agree and merge it into the project plan.

---

## 1. Guiding principles (derived from requirements)

1. **Read-only, always.** No connector is ever granted write/modify scopes
   to Slack messages, Jira tickets, Gmail, or comments. The *only* write
   actions the system performs are: (a) sending the brief email, and (b)
   sending a Slack DM to me. Everything else is read. **Notably, reading an
   unread email via the Gmail API (`messages.get`) does *not* mark it as
   read** — only an explicit label change would, and we never do that — so
   analysing unread mail leaves my inbox state untouched.
2. **Idempotent + resumable.** Each run computes "what's new since the last
   successful brief" using a stored watermark, so a missed run doesn't drop
   items and a re-run doesn't duplicate them.
3. **Context over raw dumps.** The value is summarised history + a
   recommendation, not a wall of raw messages. The LLM does the reasoning;
   the connectors just supply clean, relevant source data.
4. **Fail soft, report clearly.** If Jira is down but Slack works, still
   send a partial brief and say what failed. A missing brief is worse than
   a partial one.
5. **Phased delivery** matching the requirement doc: Phase 1 Slack + Jira,
   Phase 2 Email ingestion, Phase 3 MS Teams.

---

## 2. High-level architecture

```
                    ┌──────────────────────────┐
   10:15 AM daily → │      Scheduler (cron)     │
                    └────────────┬─────────────┘
                                 │ triggers
                    ┌────────────▼─────────────┐
                    │      Orchestrator        │
                    │  (run pipeline, handle   │
                    │   partial failure)       │
                    └──┬─────────┬─────────┬──────┘
            reads     │         │         │     reads
     ┌────────────────▼┐ ┌──────▼──────┐ ┌▼──────────────────┐
     │ Slack Connector │ │ Jira        │ │ Gmail Connector    │
     │ (mentions,      │ │ Connector   │ │ (UNREAD mail only, │
     │  channels)      │ │ (tickets,   │ │  read-only fetch)  │
     │                 │ │  sprint)    │ │                    │
     └────────┬────────┘ └──────┬──────┘ └─────────┬──────────┘
              │                 │                   │
              │        normalised items             │
              └────────────────┬────────────────────┘
                               ▼
                 ┌───────────────────────┐        ┌──────────────┐
                 │   State Store         │◄──────► │  watermark,  │
                 │  (PostgreSQL/Prisma)  │         │  seen items, │
                 └───────────┬───────────┘         │  ticket cache│
                             ▼                      └──────────────┘
                 ┌───────────────────────┐
                 │   Analysis Engine     │
                 │   (LLM via AI SDK):   │
                 │   - relevance filter  │
                 │   - context summarise │
                 │   - prioritise        │
                 │   - recommend         │
                 └───────────┬───────────┘
                             ▼
                 ┌───────────────────────┐
                 │   Brief Renderer      │  (HTML email + Slack mrkdwn)
                 └───────┬───────────────┘
                         │
              ┌──────────▼──────────┐
              │  Email + Slack DM   │
              └─────────────────────┘
```

---

## 3. Technology stack

**Decision: Node.js + TypeScript, using the Shopify AI Assistant as a
reference baseline — with deliberate improvements where they fit this
project better.** The Shopify repo proves out the toolchain and conventions;
we reuse what serves us and diverge with reason (marked **↑ improvement**
below). The infrastructure is familiar; only the *connectors*
(Slack/Jira/Gmail) and the *briefing pipeline* are genuinely new.

| Concern | Choice | Why / notes |
|---|---|---|
| Runtime + language | **Node.js + TypeScript** | Same as Shopify assistant. |
| Repo shape | **Single standalone repo, server-only package** | **↑ improvement:** this tool has no UI (output = email + Slack DM), so we drop the `client` package the Shopify monorepo had. Less to build/maintain. |
| Web framework | **Express.js** | Same. Minimal role: health-check for Railway + a manual "run brief now" trigger endpoint. |
| AI | **Vercel AI SDK (latest, v5)** with a **provider-abstraction** (`@ai-sdk/openai` default; `@ai-sdk/anthropic` a drop-in) | **↑ improvement:** Shopify pins an old AI SDK (v3); a new project should use the current major for better structured-output support. |
| Structured LLM output | **`generateObject` + Zod schema** | **↑ improvement:** the brief comes back as a *typed object* (urgent/important/fyi arrays) instead of parsed text — far more reliable. Reuses Zod you already know. |
| Database | **PostgreSQL + Prisma ORM** | Same. |
| Semantic search | **pgvector — deferred to a later phase** | Not in Phase 1 (see §7). Motivating use case: recall what was discussed on a Jira ticket 7 days ago and connect it to today. |
| Validation | **Zod** | Same — config + connector responses + LLM output. |
| Logging | **Pino / pino-http** | Same. |
| Security | **Helmet, CORS** | Same. |
| HTTP client | **Axios** | Same — used by the connectors. |
| Config/secrets | **dotenv + `.env.example`** | Same. Requirement references `.env`. |
| Scheduling | **`node-cron` in-process** | Fires the pipeline at 10:15 AM — see §8. |
| Email delivery | **Resend + React Email** | **↑ improvement:** best-reviewed modern transactional email service; React Email lets us template the brief in React (matches your skills). Postmark is the fallback if we ever prioritise raw deliverability. |
| Slack access | `@slack/web-api` (official Node SDK) | Handles auth, pagination, rate limits. |
| Jira access | `axios` against **Jira Cloud REST v3** (`anatta-io.atlassian.net`), or `jira.js` | JQL + changelog + agile board. |
| Gmail access | `googleapis` (official Node SDK) + OAuth (`gmail.readonly`) | Query `is:unread` without altering read state. |
| Evals | golden-set + LLM-as-judge | Same pattern as your `evals/run.ts` + `judge.ts`. |
| Testing | Vitest + Supertest | Same. |
| Deploy | Railway (+ Railway PostgreSQL) | Same backend target as Shopify. |

**Provider-abstraction note (OpenAI ↔ Anthropic):** we default to **OpenAI**
(your existing credits). Switching to **Anthropic** later is a drop-in: add
`@ai-sdk/anthropic`, set `ANTHROPIC_API_KEY`, and change one factory line
from `openai('gpt-…')` to `anthropic('claude-…')`. All `generateObject` /
`generateText` call sites stay identical.

---

## 4. API requirements per data source

This is the part that needs the most up-front coordination, because scopes
and tokens must be requested/approved before we can build.

### 4.1 Slack (Phase 1)

**App type:** internal Slack app installed to our workspace.

**Tokens needed:**
- **User OAuth token** (`xoxp-…`) — required because *searching for
  messages where I'm @mentioned* uses `search.messages`, which is **not**
  available to bot tokens. This must be my user token.
- **Bot token** (`xoxb-…`) — to send the DM to me.

**Scopes:**
| Scope | Token | Purpose |
|---|---|---|
| `search:read` | user | Find messages/threads mentioning me |
| `channels:history` | user/bot | Read public channel messages |
| `groups:history` | user/bot | Read private channels I'm in |
| `im:history`, `mpim:history` | user | Read DMs/group DMs if in scope |
| `users:read` | bot | Resolve user IDs → names |
| `channels:read`, `groups:read` | bot | Resolve channel names, verify configured channels |
| `chat:write` | bot | Send the morning brief DM to me |
| `im:write` / `conversations.open` | bot | Open the DM channel with me |

**Data we pull:**
- `search.messages` with query like `has:@me after:<watermark>` for mentions.
- `conversations.history` + `conversations.replies` for each configured
  project channel (from `.env`) and for threads I'm part of.

**Constraints:** Slack Tier 3 rate limits (~50 req/min for history);
`search.messages` is rate-limited more tightly — we paginate and cache.

### 4.2 Jira (Phase 1)

**Confirmed: Jira Cloud** — site `anatta-io.atlassian.net`.
- Base URL: `https://anatta-io.atlassian.net`
- Known context from your board URL: project key **`EA`**, board **`1156`**
  (we'll confirm these are the ones to track; more projects can be added).

**Auth:** **API token + your email over Basic auth** (REST API **v3**). You
generate the token once at `id.atlassian.com → Security → API tokens`; we
store it as `JIRA_API_TOKEN` + `JIRA_EMAIL` in `.env`. (OAuth 2.0 3LO is an
option only if org security later mandates it — not needed to start.)

**Endpoints / permissions (read-only):**
| Endpoint | Purpose |
|---|---|
| `GET /rest/api/3/search` (JQL) | `assignee = currentUser() AND updated >= -24h`; also mentions & newly assigned |
| `GET /rest/api/3/issue/{key}?expand=changelog,renderedFields` | Full ticket + what changed in 24h |
| `GET /rest/api/3/issue/{key}/comment` | Comment history (for context) |
| `GET /rest/agile/1.0/board/{id}/sprint` + `/sprint/{id}/issue` | Sprint status: in progress / blocked / due soon |
| `GET /rest/api/3/myself` | Resolve `currentUser()` / account id |

**JQL queries we'll run:**
- Assigned + changed: `assignee = currentUser() AND updated >= -1d`
- Mentioned: `comment ~ currentUser() AND updated >= -1d` (approx; refine)
- Newly assigned: `assignee = currentUser() AND assignee CHANGED AFTER -1d`

**Permission needed:** a Jira account (mine) with normal read access to the
relevant projects — no admin scope required.

### 4.3 Gmail — inbound read (Phase 1)

**Scope:** we read **only unread ("unopened") emails** — the `is:unread`
filter — treating them as a first-class data source alongside Slack and Jira.

**Auth:** Gmail API via OAuth 2.0, scope **`gmail.readonly`** (read-only —
cannot modify, delete, or mark mail). A one-time OAuth consent produces a
refresh token stored as a secret; the daily job uses it non-interactively.
(IMAP with an app password is a fallback if OAuth setup is blocked.)

**Read-only guarantee:** fetching a message with `messages.get` returns its
content **without** removing the `UNREAD` label. Only `messages.modify`
would change read state, and we never call it. So the analyser can read my
unread mail and leave every message still showing as unread in my inbox.

**Endpoints (read-only):**
| Endpoint | Purpose |
|---|---|
| `GET /users/me/messages?q=is:unread newer_than:1d` | List unread messages since last brief |
| `GET /users/me/messages/{id}?format=full` | Fetch headers + body for each |
| `GET /users/me/threads/{id}` | Thread context when an unread mail is a reply |

**Data we pull:** sender, subject, snippet/body, thread, received time,
labels. Each unread email is normalised into the same `BriefItem` shape and
runs through the relevance filter (direct/actionable = HIGH; FYI/newsletter
/ broadcast = SKIP-but-reported) exactly like Slack items.

**Note on volume:** if the unread count is large (backlog), we cap the
number of emails analysed per run and report the cap in the FYI section so
nothing is silently dropped (see §5).

### 4.4 Email delivery — outbound (Phase 1)

- **Resend** account + API key (`RESEND_API_KEY`); brief templated with
  **React Email**.
- A verified sender domain/address for deliverability (SPF/DKIM records
  added to DNS — Resend walks you through this).
- This is *sending* the brief — separate concern from the Gmail inbound
  read in §4.3.

### 4.5 LLM provider via Vercel AI SDK (Phase 1)

- Accessed through the same **AI SDK + provider-abstraction** pattern as the
  Shopify assistant. Default provider **OpenAI** (to match existing repo);
  swappable to Anthropic/Gemini without refactoring — see Q in §10.
- Need: one API key for the chosen provider.
- We use a **cheaper/faster model** for per-item summarisation and a
  **stronger model** for the single "rank my day" prioritisation pass.
- Budget/rate: one run ≈ a handful of summarisation calls + one
  prioritisation call. Low daily volume.

### 4.6 Microsoft Teams (Phase 3)

- Microsoft Graph API, app registration in Azure AD.
- Read scopes: `Chat.Read`, `ChannelMessage.Read.All` (admin consent
  likely required — flag early as it's the longest-lead approval).

---

## 5. The analysis pipeline (per run)

1. **Load watermark** — timestamp of last successful brief from state store.
2. **Collect (parallel):**
   - Slack: mentions since watermark + configured-channel activity + my active threads.
   - Jira: changed/assigned/mentioned tickets + sprint board snapshot.
   - Gmail: **unread emails only** (`is:unread newer_than:1d`), capped per
     run if the backlog is large.
3. **Normalise** every raw item into a common `BriefItem` shape:
   `{source, type, title, url, raw_context, last_activity_ts, participants}`.
4. **Relevance filter (LLM, per Slack/Gmail item):** classify HIGH / MEDIUM
   / LOW-SKIP per the requirement rules. Slack: direct actionable @mention =
   HIGH; prior-thread activity = MEDIUM; broadcast @here/@channel with no
   action = SKIP. Gmail: direct/actionable mail addressed to me = HIGH;
   newsletters/notifications/broadcasts = SKIP. *Skipped items are retained
   in a list so the FYI section can report "filtered N broadcasts / M
   emails" — never silently dropped, and (for Gmail) never marked read.*
5. **Context enrichment (LLM, per surfaced item):** for each Jira ticket,
   summarise original requirement → discussion → last decision → current
   blocker → what changed in 24h, using cached history + fresh data. For
   each Slack thread, summarise original question → current state → does it
   need my input. For each unread email, summarise sender → ask/subject →
   whether it needs a reply, pulling prior thread messages for context.
6. **Prioritise + recommend (LLM, one Opus pass):** rank everything into
   URGENT / IMPORTANT / FYI, produce the suggested priority order for the
   day with reasons, and attach a recommended action to each item.
7. **Render** into the exact brief structure from `requirement.md`
   (email HTML + Slack mrkdwn variants).
8. **Deliver** email + Slack DM.
9. **Persist** new watermark + seen-item ids + refreshed ticket-context cache.

**Prompting note:** system prompt hard-codes the read-only, "recommend
don't act" framing and the exact output sections so the model can't drift
into taking or suggesting automated actions.

---

## 6. State & context model

To deliver *history-aware* briefs without re-reading everything daily:

- `run_log(run_id, started_at, status, watermark_used)` — resumability.
- `seen_items(source, external_id, first_seen, last_activity)` — dedupe.
- `ticket_context(ticket_key, summary_json, updated_at)` — cached rolling
  summary of each active ticket, refreshed only when the ticket changed.
  This is what lets the brief say "context: … so I don't re-read everything."
- `thread_context(channel, thread_ts, summary_json, updated_at)` — same for
  Slack threads I participate in.
- `email_seen(message_id, thread_id, first_seen)` — so an email that stays
  unread across days is surfaced once (not re-reported every morning),
  while still never being marked read in Gmail itself.

The cache is the key to keeping cost/latency low *and* giving genuine
"understanding over the past week" rather than only last-24h.

---

## 7. Phased delivery plan

### Phase 0 — Foundations (setup)
- Provision tokens/scopes (§4), scaffold repo, `.env` schema, state store,
  AI-SDK / LLM-provider wiring, "hello world" run that prints a fake brief
  locally.

### Phase 1 — Slack + Jira + Gmail core (the MVP)
- Slack, Jira, **and Gmail (unread-only, read-only)** connectors,
  normalisation, relevance filter, context enrichment, prioritisation,
  brief rendering.
- Delivery via email + Slack DM.
- Scheduling at 10:15 AM.
- **Definition of done:** a real, correctly prioritised brief lands in my
  inbox + Slack DM every morning with working links and sensible
  recommendations; filtered items are reported; and no unread email has
  been marked read by the analyser.

*(Suggested build order within Phase 1: Jira first — most structured, best
for validating the pipeline end-to-end — then Slack, then Gmail. All three
must ship for the MVP; this is only the sequence, not a re-scoping.)*

### Phase 2 — Microsoft Teams
- Add Graph API connector (client-side comms), same read-only pattern.
- Longest approval lead time — start Azure app registration early.

*(Note: the requirement's original "email = future phase" has been
promoted into Phase 1 as unread-Gmail reading, so it's no longer a separate
later phase.)*

### Phase 3 — Deep historical context via pgvector (semantic search / RAG)
- **Motivating use case (your example):** for a Jira ticket, ask "what was
  discussed 7 days ago?" and connect that older discussion to what's
  happening today — even when the words don't match exactly.
- We embed historical messages/comments into **pgvector** (the tech you
  already used in Shopify) and retrieve the semantically-relevant history at
  brief time, instead of relying only on the rolling text summary cache.
- Deferred deliberately: Phase 1 uses the simpler summarise-and-cache
  approach (§6); vectors are added once the core brief is proven.

### Later / nice-to-have
- Feedback loop: I mark items "useful/not useful" → tune relevance prompt.
- Config UI for channels & priorities (vs `.env`).
- Multiple recipients / team briefs (schema change only — Postgres already
  in the stack, per §3).

---

## 8. Hosting & scheduling (aligned to Shopify stack)

We deploy to **Railway** — the same backend target as the Shopify assistant
— with **Railway PostgreSQL** for the state store. Two ways to fire the
10:15 AM run:

| Option | How | Trade-off |
|---|---|---|
| **`node-cron` in-process** (recommended) | The always-on Express service schedules the job internally at 10:15 AM | Simplest; one service; job runs in the same process. Fine for a single daily task. |
| **Railway scheduled job** | A separate Railway cron trigger invokes the pipeline | Cleaner separation; the run is independent of the web service. |

**Recommendation:** start with **`node-cron` in-process** on the always-on
Railway service for Phase 1 — least moving parts, and we already run an
Express service for the manual "run now" trigger. We can split it into a
dedicated scheduled job later if needed.

---

## 9. Security & privacy notes

- Least-privilege scopes only; **no write scopes** to Slack/Jira content.
- Secrets in a secret manager (prod) / `.env` (local, git-ignored).
- The brief and cached summaries contain work-sensitive content — encrypt
  the state store at rest and lock down the host.
- Data retention: keep ticket/thread context caches only as long as useful
  (e.g. prune contexts for tickets closed > 30 days).
- LLM calls send work data to the chosen provider (OpenAI/Anthropic) —
  confirm that's acceptable under our data policy (covered by the API's
  no-training terms, but worth an explicit sign-off).

---

## 10. Decisions & open questions

### Settled ✅
- **Runtime:** Node.js + TypeScript.
- **Repo shape:** single standalone repo, **server-only** (no client package).
- **Stack:** Express, Prisma + PostgreSQL, latest Vercel AI SDK, Zod, Pino,
  Helmet/CORS, Axios, Vitest, Railway, `node-cron`.
- **LLM provider:** **OpenAI** default (existing credits); Anthropic is a
  drop-in swap via the AI SDK — will explore later.
- **Email delivery:** **Resend + React Email**.
- **Gmail:** one-time `gmail.readonly` OAuth consent — approved.
- **pgvector semantic search:** deferred to **Phase 3** (7-day ticket-history
  recall use case); Phase 1 uses summarise-and-cache.
- **Cost/rate:** design around low daily volume — no special constraint.
- **Slack channels:** to be provided later (not blocking; goes in `.env`).

### Still open — awaiting your input
- ~~Q2 — Jira type~~ ✅ **Confirmed Jira Cloud** (`anatta-io.atlassian.net`,
  project `EA`, board `1156`): REST v3, email + API token auth. See §4.2.
- **Q9 — Data-policy sign-off:** proceeding on the assumption that sending
  Phase-1 work data (your own Slack/Jira/Gmail) to the LLM API is acceptable
  (same exposure as the Shopify assistant; API terms = no training on data).
  Please get an informal OK from whoever owns data policy at Anatta —
  **especially before Phase 2 (MS Teams = client data)**. Mitigations
  available if needed: zero-retention request + secret redaction.

---

*Next step: you review, we resolve the open questions in §10, then merge
the agreed decisions back into `requirement.md` / a final project plan.*
