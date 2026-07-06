# Jira Implementation & AI Notes

> A reference for what we built for the **Jira** part of the Morning Briefing
> Analyser — the connector, the AI analysis, the prioritisation rules, and the
> key engineering lessons. Written to be read later for learning, not just as
> code docs. (Authoritative product plan lives in `CLAUDE.md`.)

---

## 1. The big picture

```
Jira (read-only)  →  Connector (raw)  →  AI analysis  →  Renderer  →  Email + Slack DM
                     collect + tag        categorise      2 sections
```

**Design principle that everything follows:** the **connector is "dumb"** (it
only fetches + tags raw data), and the **AI is the brain** (summarising,
categorising, connecting the dots). Hard *business rules* are enforced in
**code**, never left to the LLM. This separation is the single most important
idea in the codebase.

Key files:
| File | Role |
|---|---|
| `packages/server/src/connectors/jira.connector.ts` | Read-only Jira fetch + tagging |
| `packages/server/src/services/analyze.service.ts` | AI call + deterministic guards |
| `packages/server/src/prompts/brief.prompt.ts` | System + user prompts |
| `packages/server/src/services/render.service.ts` | Brief → email HTML + Slack mrkdwn |
| `packages/server/src/pipeline/runBrief.ts` | Orchestrates the whole run |
| `packages/server/src/types/index.ts` | Zod schemas + shared types |

---

## 2. Connecting to Jira (the hard-won specifics)

- **Jira Cloud**, site `anatta-io.atlassian.net`, REST API **v3**.
- **Scoped API token** (read-only): scopes `read:jira-work` + `read:jira-user`.
  No write scopes, ever.
- ⚠️ **The gotcha that cost us an hour:** a *scoped* token does NOT authenticate
  against the site URL (`anatta-io.atlassian.net`). Against the site URL it is
  treated as **anonymous** — `/myself` returns 401 while `/search/jql` returns
  200 with **0 issues** (a very confusing symptom). Scoped tokens must go through
  the gateway: `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...`.
- **cloudId** is auto-resolved (unauthenticated) from
  `{site}/_edge/tenant_info` → `{ "cloudId": "…" }`, cached for the process.
- *Classic* (unscoped) tokens work against the site URL directly — this gotcha
  is specific to scoped tokens.

### JQL, not GraphQL
We query with **JQL** (Jira Query Language) — a filter string, like a SQL
`WHERE` clause — passed to `POST /rest/api/3/search/jql`. Jira does the
filtering server-side and returns matching issues as JSON. Key queries:
- Changed items: `project = EA AND assignee = currentUser() AND updated >= "-Nm"`
- Active sprint: `project = EA AND assignee = currentUser() AND sprint IN openSprints()`
  — `openSprints()` gives the active sprint **without** needing the Agile API
  (which requires extra `jira-software` scopes we deliberately don't have).

---

## 3. What we actually surface — the two sections

### Section 1 — "Changed in the last 24h" (top)
The **new-activity** feed. A ticket qualifies if, in the window, EITHER:
- a **field change** happened (due date, description, status… — *any* author,
  including me), OR
- a **comment** was left by **someone other than me** (my own "update" comments
  are noise and are ignored).

For each qualifying ticket the connector attaches the **recent comment thread**
(+ current description + field changes), and the AI:
1. reads the thread, works out **what changed** and **what's being asked**,
2. writes a concise summary + a specific recommended action,
3. categorises it **Urgent / Important / Not important**.

### Section 2 — "Today's Board" (table)
One row per **active-sprint** ticket: **Ticket # | Status | Recommendation**.
- **Status is deterministic** (verbatim from Jira) — the LLM never writes it.
- Only the **Recommendation** column is AI-written (one short line).
- Done tickets are excluded; blocked tickets are flagged.

---

## 4. Prioritisation rules (the logic that matters)

**A ticket is Urgent ONLY if:**
- (a) its **due date is today or already past**, OR
- (b) a **comment explicitly needs an urgent action** from me, OR
- (c) a **question directed at me has been unanswered by me for > 1 day**
  (judged from dated comments; a later comment by me = answered).

**Being merely in-progress or due-soon is NOT urgent.**

**Blocked handling** — a ticket is "blocked" if its status contains "block" OR
it carries a `Blocked` / `EA_BLOCK` label:
- Blocked tickets are **never Urgent** (you can't act on a blocked item).
- They're shown under Important / Not important with a "blocked for <reason>"
  note (reason inferred from comments).
- A ticket that is **overdue AND blocked** stays non-urgent but gets a
  recommendation flagging "overdue & blocked — chase the blocker."

---

## 5. The AI implementation

- **Vercel AI SDK (`ai`)** with `generateObject` — the model is *forced* to
  return data matching a **Zod schema** (`analysisOutputSchema`). No brittle
  text parsing; the model retries itself on a schema mismatch.
- **Provider abstraction** (`ai/provider.ts`): default **OpenAI**
  (`gpt-4o` smart / `gpt-4o-mini` fast); switching to Anthropic is a one-line
  change (add `@ai-sdk/anthropic`, set the key, swap the factory call).
- **The board stays deterministic:** the LLM returns recommendations *keyed by
  ticket*; we merge them with the true status in code (`buildBoardTable`). The
  model can't hallucinate a ticket's status.
- **Prompt** (`brief.prompt.ts`) encodes the read-only "recommend, don't act"
  framing, the two-section structure, the categorisation rules, and the user's
  own name (so it can tell "my" comments from others').

---

## 6. ⭐ The most important lesson: hard rules go in code, not the prompt

LLMs are **non-deterministic** and will "reason around" prompt instructions.
We hit this **three times**:
1. It marked a **blocked** ticket Urgent because it was also overdue.
2. On a different run it ignored the blocked rule again.
3. It filed a **due-today** ticket as "Not important" because *I* had made the
   change ("you did this yourself, no action needed").

Prompts *guide*; they don't *guarantee*. So every firm business rule is enforced
by a **deterministic guard in TypeScript**, applied after the LLM responds:

| Guard (`analyze.service.ts`) | Rule it guarantees |
|---|---|
| `enforceDueDateUrgent` | due-today/overdue + not-blocked → **must** be Urgent |
| `enforceBlockedNotUrgent` | blocked → **never** Urgent (moved to Important) |

Order matters (promote by due-date first, then remove blocked). Both are
**unit-tested** (`analyze.rules.test.ts`) so they can't silently regress.

**Takeaway:** use the LLM for judgment + language; put invariants in code.

---

## 7. Read-only guarantees

- Only **read** scopes on the token; no endpoint we call can modify Jira.
- The analyser's *only* write actions (project-wide) are sending the email and
  the Slack DM — never anything back to Jira.

---

## 8. What's still pending (not yet built)

- **Persistence / real watermark:** "since last brief" is currently a fixed
  rolling **24h window** (`runBrief.ts`: `since = now - 24h`). A `RunLog` table
  exists in `schema.prisma` but isn't wired — needs Postgres. Until then it's
  "changed in last 24h," not truly "since the last brief ran."
- **Email delivery (Resend)** and **Slack-DM delivery** — the brief is rendered
  but not yet sent; it's currently viewable via the dashboard "Run brief now".
- **Semantic cross-source linking (pgvector)** — deferred to a later phase.

---

## 9. Quick glossary

- **JQL** — Jira Query Language; a filter expression (not GraphQL).
- **cloudId** — the UUID identifying our Jira Cloud tenant, used in the gateway URL.
- **openSprints()** — JQL function matching issues in any open (active) sprint.
- **statusCategory** — Jira's stable category (`new` / `indeterminate` / `done`)
  behind the custom status *names* (e.g. "Dev In Progress"); we group by category.
- **generateObject** — AI SDK call that returns schema-validated structured data.
- **Deterministic guard** — a code function that enforces a business rule
  regardless of what the LLM produced.
