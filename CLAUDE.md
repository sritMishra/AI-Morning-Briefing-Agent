# Morning Briefing Analyser

> Single source of truth for this project — the full requirements, technical
> approach, and phased plan in one place. **This file is authoritative.**

---

## 1. What this is

A scheduled, **read-only** AI analyser that runs every morning at **10:15 AM**.
It connects to **Slack, Jira, and Gmail**, reads everything relevant,
understands context from past activity, and delivers a prioritised morning
brief via **email + Slack DM** — before the workday starts at 11 AM.

**This is NOT an agent that takes action.** It is a read-only analyser and
recommender. It never replies to anyone, never posts to channels, never
modifies any ticket, message, or email. It only reads, analyses, and reports.

### The problem it solves
Replaces ~45 minutes of manual morning triage (scanning Slack mentions,
reading overnight Jira updates, building a plan for the day) with a ready
brief delivered before you open your laptop.

---

## 2. Guiding principles

1. **Read-only, always.** No connector gets write/modify scopes. The *only*
   two write actions the system performs are (a) sending the brief email and
   (b) sending a Slack DM to me. Notably, reading an unread email via the
   Gmail API (`messages.get`) does **not** mark it read — we never change
   read state.
2. **Idempotent + resumable.** Each run computes "what's new since the last
   successful brief" from a stored watermark — a missed run drops nothing, a
   re-run duplicates nothing.
3. **Context over raw dumps.** Value = summarised history + a recommendation,
   not a wall of raw messages.
4. **Fail soft, report clearly.** If one source is down, still send a partial
   brief and say what failed. A missing brief is worse than a partial one.
5. **Never silently drop.** Filtered/low-priority items are still counted and
   reported so I can verify.

---

## 3. Data sources (read-only, priority order)

### 1. Slack (highest priority)
- Messages/threads where I'm directly @mentioned.
- Activity in my key project channels (configured in `.env`).
- Filter out `@here`/`@channel` broadcasts unless directly relevant.
- Look back: last 24h (or since last brief).

### 2. Jira (highest priority) — **Jira Cloud, project `EA` only**
Scoped to the **Edible Arrangements (`EA`)** project. Two distinct views:
- **Board focus** = tickets assigned to me in the **active sprint**
  (`sprint IN openSprints()`), grouped: In Progress / Blocked / Overdue /
  Due Soon / New Today (Done is skipped).
- **Change notes** = **any** EA ticket assigned to me that changed in the
  window — *in or out of the active sprint* — so backlog/other-sprint updates
  aren't missed. Each is tagged with its sprint membership + a "what changed"
  summary from the changelog.
- Look back: last 24h (→ real watermark later) + changelog for context.
- Config: `JIRA_PROJECT_KEYS=EA`. Active sprint resolved via JQL
  `openSprints()` (avoids the extra Agile-API scopes).

### 3. Gmail — **DESCOPED (not implemented)**
Deliberately dropped. Rationale: work email is largely a *notification mirror*
of Slack + Jira (redundant), and personal email is too private to route through
a server-side LLM. The `gmail.connector.ts` stub returns `[]` and is inert.
(Can be revisited later if a genuine non-redundant need appears.)

### 4. Microsoft Teams (Phase 2 — future)
- Client-side communication channel; read-only, same pattern as Slack.

---

## 4. What the analyser must understand

**Context awareness — history, not just today.** For each active Jira ticket:
original requirement → last week's discussion → last decision → current
blocker/open question → what changed in 24h (incl. **new comments**). For each
Slack thread: original question → current state → does it need my input.
A new comment must be *explained* ("X commented, here's what it means for this
ticket"), not just flagged.

**Cross-source correlation — connect the dots (the key differentiator).**
The brief should weave sources together per topic, not list them in silos:
- A new Jira comment should be related to the ticket's own prior history.
- If a Slack message references the same ticket/topic, surface it *alongside*
  the ticket so I get one connected picture.
- Two levels of linking:
  1. **Explicit** — a Slack/email message names the ticket (e.g. "EA-2729").
     Cheap string match; available once Slack/Gmail land (Phase 1/2).
  2. **Semantic/topical** — related discussion that never names the ticket.
     Needs embeddings → **pgvector (Phase 3)**.
This correlation is done by the AI layer (pipeline steps 5-6), never by the
connectors, which only supply raw material.

**Relevance filtering (Slack + Gmail):**
- **HIGH** — direct @mention / email with a question or action for me.
- **MEDIUM** — a thread I previously participated in has new activity.
- **LOW / SKIP** — `@here`/`@channel` broadcasts or newsletters with no
  action for me. *Always reported ("filtered N items") — never silently
  dropped.*

**Section-1 trigger.** A ticket enters "changed in last 24h" if EITHER a field
change (due date, description, status… — *any* author, including me) OR a
comment by someone *other than me* landed in the window. My own comments are
noise and don't trigger; my own field changes do.

**Prioritisation rules (Jira) — critical/urgent criteria.** A ticket is
`urgent` ONLY if: (a) its due date is **today or already past**, (b) a comment
requires an urgent action from me, or (c) a question (from anyone) has been
unanswered by me for > 1 day. Being merely in-progress or due-soon is NOT urgent.
**Blocked tickets** (status contains "block" OR a `Blocked`/`EA_BLOCK` label)
are NEVER urgent — instead they're listed under important/fyi with a short
"blocked for <reason>" note (reason inferred from comments). If a blocked
ticket is *also* overdue, it stays non-urgent but gets a recommendation entry
flagging "overdue AND blocked" so it isn't lost. To judge (c), the
connector supplies dated comments over a 3-day look-back and the user's own
display name.

**Recommendations — not just summaries.** For each surfaced item: what
action I likely need to take, whether it's urgent-today or can wait, what
info is missing if a ticket is blocked, the key point to address if a thread
needs my reply. The recommendation is a suggestion; I make the final call.

---

## 5. Output — the morning brief

Delivered via **email + Slack DM** at **10:15 AM daily**. Two sections:

```
MORNING BRIEF — [Day, Date]

=== SECTION 1 — CHANGED IN LAST 24h ===
(only tickets changed by someone OTHER than me — my own updates ignored)
🔴 URGENT       [item] summary (what changed + what's asked) · action · link
🟡 IMPORTANT    [item] ...
⚪ NOT IMPORTANT [item] ...
(each item: AI reads the full comment thread, works out what's asked, categorises)

=== SECTION 2 — TODAY'S BOARD (EA · active sprint) ===
Table:  Ticket | Status (exact) | Recommendation (AI, one line)
```

Categorisation + blocked rules per §4. Board status is deterministic; only
the recommendation column is AI-written.

---

## 6. Technology stack

Node.js + TypeScript, using the Shopify AI Assistant repo as a reference
baseline with deliberate improvements. Infrastructure is familiar; only the
connectors and briefing pipeline are new.

| Concern | Choice |
|---|---|
| Runtime / language | Node.js + TypeScript |
| Repo shape | Monorepo (npm workspaces): `packages/server` + `packages/client` |
| Web framework | Express (health-check + manual "run now" trigger) |
| AI | Vercel AI SDK (v5) + provider abstraction — **OpenAI default**, Anthropic drop-in |
| Structured LLM output | `generateObject` + Zod (brief returned as a typed object) |
| Database | PostgreSQL + Prisma ORM |
| Semantic search | pgvector — **deferred to Phase 3** |
| Validation | Zod |
| Logging | Pino / pino-http |
| Security | Helmet, CORS |
| HTTP client | Axios |
| Scheduling | `node-cron` (in-process, 10:15 AM) |
| Email delivery | Resend + React Email |
| Slack | `@slack/web-api` |
| Jira | Jira Cloud REST v3 (via Axios) — email + API token auth |
| Gmail | `googleapis` + OAuth (`gmail.readonly`) |
| Evals | golden-set + LLM-as-judge |
| Testing | Vitest + Supertest |
| Deploy | Railway (+ Railway PostgreSQL) |

**OpenAI ↔ Anthropic swap:** add `@ai-sdk/anthropic`, set
`ANTHROPIC_API_KEY`, change one factory line (`openai(...)` →
`anthropic(...)`). All call sites unchanged.

---

## 7. Architecture

```
10:15 AM (node-cron) ─► Orchestrator (runBrief pipeline, partial-failure safe)
        │
        ├─ Slack connector  (mentions, channels)      ─┐
        ├─ Jira connector   (tickets, sprint)          ├─► normalise → BriefItem[]
        └─ Gmail connector  (UNREAD only, read-only)  ─┘
                                        │
              State store (Postgres/Prisma) ◄──► watermark, seen items, context cache
                                        │
        Analysis (LLM via AI SDK): relevance filter → context summarise → prioritise → recommend
                                        │
        Renderer (React Email + Slack mrkdwn) ─► Email (Resend) + Slack DM
                                        │
                          Persist watermark + seen ids + refreshed context cache
```

### Per-run pipeline
1. Load watermark (last successful brief time).
2. Collect in parallel: Slack (mentions + channels + my threads), Jira
   (changed/assigned/mentioned + sprint), Gmail (unread only, capped).
3. Normalise every item → `BriefItem { source, type, title, url,
   rawContext, lastActivityTs, participants }`.
4. Relevance filter (LLM) for Slack/Gmail → HIGH / MEDIUM / SKIP; retain
   skipped for the FYI count.
5. Context enrichment (LLM) per surfaced item (ticket/thread/email history).
6. Prioritise + recommend (one stronger-model pass) → Urgent / Important /
   FYI + suggested day order.
7. Render (email HTML + Slack mrkdwn).
8. Deliver email + Slack DM.
9. Persist new watermark + seen ids + refreshed context cache.

### State model (Prisma)
- `RunLog` — resumability (started_at, status, watermark_used).
- `SeenItem` — dedupe across runs (source, external_id, last_activity).
- `TicketContext` — cached rolling summary per active ticket (refreshed only
  when the ticket changed) → history-aware without re-reading everything.
- `ThreadContext` — same for Slack threads I participate in.
- `EmailSeen` — an email that stays unread is surfaced once, never re-marked.

### Trigger modes (both share one pipeline)
The exact same `runBrief()` pipeline can be fired two ways:
1. **Automatic (scheduled):** `node-cron` fires it at 10:15 AM daily → delivers
   email + Slack DM. The unattended default.
2. **Manual (on-demand):** a **"Run brief now" button** in the dashboard calls
   `POST /brief/run`, which runs the identical pipeline immediately and returns
   the result — so I can pull the latest inflow from all connectors anytime
   without waiting for the schedule (useful for testing and for an ad-hoc
   mid-day catch-up). Both paths are read-only.

---

## 8. API requirements per source

### Slack
- **User OAuth token** (`xoxp-…`) — required for `search.messages` (finding
  my @mentions; not available to bot tokens).
- **Bot token** (`xoxb-…`) — to send the DM to me.
- Scopes: `search:read`, `channels:history`, `groups:history`,
  `im:history`, `mpim:history`, `users:read`, `channels:read`,
  `groups:read`, `chat:write`, `im:write`/`conversations.open`.

### Jira (Cloud)
- Auth: `JIRA_EMAIL` + **scoped** `JIRA_API_TOKEN` (Basic), scopes
  `read:jira-work` + `read:jira-user` (read-only, no write scopes ever).
- ⚠️ **Scoped tokens must use the gateway, not the site URL.** They fail to
  authenticate against `anatta-io.atlassian.net`; requests go to
  `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3`. The cloudId is
  auto-resolved from `{JIRA_BASE_URL}/_edge/tenant_info` (or set `JIRA_CLOUD_ID`).
- Endpoints: `/rest/api/3/search` (JQL), `/issue/{key}?expand=changelog`,
  `/issue/{key}/comment`, `/rest/agile/1.0/board/{id}/sprint` + `/issue`,
  `/myself`.
- JQL: `assignee = currentUser() AND updated >= -1d`; mentions; newly
  assigned via `assignee CHANGED AFTER -1d`.

### Gmail (read-only)
- OAuth scope **`gmail.readonly`** (one-time consent → refresh token secret).
- List: `messages?q=is:unread newer_than:1d`; fetch `messages/{id}?format=full`.
- Fetching does **not** change read state.

### Email delivery (Resend)
- `RESEND_API_KEY` + a verified sender domain (SPF/DKIM in DNS).

### LLM (via AI SDK)
- `OPENAI_API_KEY` (default). `ANTHROPIC_API_KEY` optional for the swap.

---

## 9. Phases

- **Phase 0 — Foundations:** monorepo scaffold, env schema, Prisma + state
  models, AI-SDK wiring, health + manual-trigger endpoints, client shell.
- **Phase 1 — Core MVP (Slack + Jira + Gmail):** three read-only connectors,
  normalisation, relevance filter, context enrichment, prioritisation, brief
  rendering, delivery (email + Slack DM), 10:15 AM schedule.
  Build order: **Jira → Slack → Gmail** (all ship for the MVP).
  *Done when:* a correctly prioritised brief lands in inbox + Slack DM daily
  with working links and sensible recommendations; filtered items reported;
  no unread email marked read.
- **Phase 2 — Microsoft Teams:** Graph API connector (client comms),
  read-only. Longest approval lead time — start Azure app registration early.
- **Phase 3 — Deep historical context (pgvector):** embed historical
  messages/comments; retrieve semantically-relevant history (e.g. "what was
  discussed on this ticket 7 days ago") instead of only the text cache.
- **Later:** feedback loop (useful/not-useful → tune prompts), config UI for
  channels/priorities, multi-recipient/team briefs.

---

## 10. Decisions & open items

**Settled:** Node/TS; monorepo server + client; Express, Prisma+Postgres,
AI SDK v5, Zod, Pino, Helmet/CORS, Axios, Vitest, Railway, node-cron;
OpenAI default (Anthropic drop-in); Resend + React Email; Gmail unread-only
read-only OAuth (approved); Jira Cloud (`anatta-io.atlassian.net`, project
`EA`, board `1156`); pgvector deferred to Phase 3.

**Open:**
- **Slack channels** — key project channels to watch (provide later; goes in
  `.env`). Not blocking.
- **Data-policy sign-off** — informal OK at Anatta to send Phase-1 work data
  to the LLM API (same exposure as the Shopify assistant; API terms = no
  training). **Confirm before Phase 2 (Teams = client data).** Mitigations
  available: zero-retention request + secret redaction.

---

## 11. Repo layout

```
morning-briefing-agent/
├── CLAUDE.md                 ← this file (authoritative plan)
├── package.json              ← npm workspaces root
└── packages/
    ├── server/               ← Node + Express + Prisma + AI SDK (the analyser)
    │   ├── prisma/schema.prisma
    │   └── src/
    │       ├── index.ts       ← boot + node-cron schedule
    │       ├── app.ts         ← express app
    │       ├── config/        ← zod-validated env
    │       ├── lib/           ← logger, prisma client
    │       ├── ai/            ← provider abstraction (OpenAI/Anthropic)
    │       ├── connectors/    ← slack / jira / gmail (read-only)
    │       ├── pipeline/      ← runBrief orchestrator
    │       ├── services/      ← relevance / enrich / prioritise / render / deliver
    │       ├── prompts/       ← system prompts
    │       ├── routes/        ← health, brief-run trigger
    │       ├── controllers/
    │       └── types/         ← BriefItem etc.
    └── client/               ← React + Vite dashboard (preview brief + run now)
```

## 12. Local setup (quick)

```bash
npm install                       # install all workspaces
cp .env.example packages/server/.env   # fill in secrets
npm run dev:server                # start API + scheduler
npm run dev:client                # start dashboard
```
