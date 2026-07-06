import axios, { AxiosError, type AxiosInstance } from 'axios';

import { env, jiraProjectKeys } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { BriefItem } from '../types/index.js';

/**
 * Jira Cloud connector (read-only). Phase 1.
 *
 * Auth: HTTP Basic (JIRA_EMAIL + JIRA_API_TOKEN) with a *scoped* API token
 * (read:jira-work + read:jira-user). Scoped tokens are read-only and inherit my
 * own permissions — we never touch a write endpoint.
 *
 * IMPORTANT: scoped API tokens do NOT authenticate against the site URL
 * (anatta-io.atlassian.net); they must go through Atlassian's gateway
 * `https://api.atlassian.com/ex/jira/{cloudId}`. We resolve the cloudId once
 * from the unauthenticated `/_edge/tenant_info` endpoint (or JIRA_CLOUD_ID).
 *
 * Scope of what we surface (per requirements):
 *   - BOARD FOCUS  = tickets assigned to me in the active sprint (openSprints)
 *                    of the configured project(s) (EA), grouped by status.
 *   - CHANGE NOTES = ANY ticket assigned to me in EA that changed in the window
 *                    — in or out of the active sprint — with a "what changed"
 *                    summary from the changelog.
 *
 * We use JQL (`sprint IN openSprints()`) rather than the Agile API for the
 * sprint, because the Agile endpoints need extra `jira-software` scopes our
 * read-only token deliberately does not have.
 */

/** Only the fields we actually need — keeps responses small and clean. */
const FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'updated',
  'created',
  'duedate',
  'assignee',
  'labels',
];

/** `project IN (EA)` clause from configured keys (falls back to all projects). */
const PROJECT_CLAUSE = jiraProjectKeys.length
  ? `project IN (${jiraProjectKeys.join(', ')})`
  : 'project IS NOT EMPTY';

/**
 * How many recent comments to include as context so the AI can "go through the
 * comments" of a changed ticket to work out what's being asked.
 */
const MAX_COMMENTS = 12;

/** A ticket is "blocked" if its status says so OR it carries a *block* label (e.g. EA_block). */
function isBlocked(issue: JiraIssue): boolean {
  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  if (statusName.includes('block')) return true;
  return (issue.fields.labels ?? []).some((l) => l.toLowerCase().includes('block'));
}

/** True if the due date is today or already past (start-of-tomorrow boundary). */
function isDueUrgent(duedate?: string | null): boolean {
  if (!duedate) return false;
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  return new Date(duedate).getTime() < startOfTomorrow.getTime() + 24 * 60 * 60 * 1000;
}

interface SprintInfo {
  name?: string;
  state?: string; // 'active' | 'future' | 'closed'
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status?: { name: string; statusCategory?: { key: string; name: string } };
    issuetype?: { name: string };
    priority?: { name: string };
    updated?: string;
    created?: string;
    duedate?: string | null;
    assignee?: { displayName?: string } | null;
    labels?: string[];
    // Custom fields (e.g. the Sprint field) accessed by id at runtime.
    [customField: string]: unknown;
  };
}

// The Sprint custom field id (e.g. customfield_10020), discovered once.
let sprintFieldId: string | null = null;
async function getSprintFieldId(): Promise<string> {
  if (sprintFieldId) return sprintFieldId;
  const c = await jira();
  if (!c) return 'customfield_10020';
  try {
    const { data } = await c.get('/field');
    const f = (data as { id: string; name?: string; schema?: { custom?: string } }[]).find(
      (x) => x.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint' || x.name === 'Sprint',
    );
    sprintFieldId = f?.id ?? 'customfield_10020';
  } catch {
    sprintFieldId = 'customfield_10020';
  }
  return sprintFieldId;
}

function sprintsOf(issue: JiraIssue): SprintInfo[] {
  const v = sprintFieldId ? issue.fields[sprintFieldId] : undefined;
  return Array.isArray(v) ? (v as SprintInfo[]) : [];
}

/** True only if the ticket is in the CURRENTLY ACTIVE sprint (not a future one). */
function isInActiveSprint(issue: JiraIssue): boolean {
  return sprintsOf(issue).some((s) => s.state === 'active');
}

/** Human label of the ticket's sprint(s), e.g. "Edible Sprint 10 (future)". */
function sprintLabel(issue: JiraIssue): string {
  const s = sprintsOf(issue);
  return s.length ? s.map((x) => `${x.name ?? '?'} (${x.state ?? '?'})`).join(', ') : 'none';
}

interface ChangelogHistory {
  created: string;
  author?: { displayName?: string };
  items?: { field: string; fromString?: string | null; toString?: string | null }[];
}

let clientPromise: Promise<AxiosInstance | null> | null = null;

/** Resolve the Atlassian cloudId for our site (env override, else tenant_info). */
async function resolveCloudId(): Promise<string> {
  if (env.JIRA_CLOUD_ID) return env.JIRA_CLOUD_ID;
  const { data } = await axios.get(`${env.JIRA_BASE_URL}/_edge/tenant_info`, { timeout: 20_000 });
  if (!data?.cloudId) throw new Error('Could not resolve Jira cloudId from tenant_info');
  return data.cloudId as string;
}

/** Lazily build the authenticated Axios client (once), routed via the gateway. */
async function jira(): Promise<AxiosInstance | null> {
  if (!env.JIRA_API_TOKEN || !env.JIRA_EMAIL) {
    logger.warn('Jira credentials missing (JIRA_EMAIL / JIRA_API_TOKEN) — skipping Jira');
    return null;
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const cloudId = await resolveCloudId();
      logger.info({ cloudId }, 'Jira: resolved cloudId, using gateway base URL');
      return axios.create({
        baseURL: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
        auth: { username: env.JIRA_EMAIL!, password: env.JIRA_API_TOKEN! },
        headers: { Accept: 'application/json' },
        timeout: 20_000,
      });
    })().catch((err) => {
      clientPromise = null; // allow retry on next run
      throw toError(err, 'client init');
    });
  }
  return clientPromise;
}

let myDisplayName: string | null = null;

/** My own display name (cached) — lets the AI tell "my" comments from others'. */
export async function getMyDisplayName(): Promise<string | null> {
  if (myDisplayName) return myDisplayName;
  const c = await jira();
  if (!c) return null;
  try {
    const { data } = await c.get('/myself');
    myDisplayName = data.displayName ?? null;
    return myDisplayName;
  } catch {
    return null;
  }
}

/** Turn Axios noise into a short, useful error message. */
function toError(err: unknown, ctx: string): Error {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const detail =
      (err.response?.data as { errorMessages?: string[]; message?: string })?.errorMessages?.join(
        '; ',
      ) ??
      (err.response?.data as { message?: string })?.message ??
      err.message;
    return new Error(`Jira ${ctx} failed (${status ?? 'no-status'}): ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Run a JQL search and return matching issues (single page; enough for a daily brief). */
async function searchIssues(jql: string, fields = FIELDS, maxResults = 50): Promise<JiraIssue[]> {
  const c = await jira();
  if (!c) return [];
  try {
    const { data } = await c.post('/search/jql', { jql, fields, maxResults });
    return (data.issues ?? []) as JiraIssue[];
  } catch (err) {
    throw toError(err, `search "${jql}"`);
  }
}

/** Strip HTML tags to plain text (Jira renders rich fields as HTML). */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

interface IssueDetail {
  changes: string[];
  /** Recent comment thread (up to MAX_COMMENTS), each: "[date] Author: text". */
  comments: string[];
  /** Current description (plain text, truncated) for context. */
  description?: string;
  /**
   * Section-1 trigger. True if EITHER a field change (any author) OR a comment
   * by someone OTHER than me landed in the window. My own *comments* are noise
   * and don't trigger; but my own *field changes* (due date, description, …) do.
   */
  changed: boolean;
}

async function getIssueDetail(key: string, changeSince: Date, me: string | null): Promise<IssueDetail> {
  // Need an authenticated client; if creds are missing, return an empty detail.
  const c = await jira();
  if (!c) return { changes: [], comments: [], changed: false };

  // The window boundary as epoch ms — anything created after this is "new".
  const windowMs = changeSince.getTime();
  try {
    // ─── THE FETCH ───────────────────────────────────────────────────────
    // One GET to /issue/{key} pulls everything we need for this ticket:
    //   expand=changelog       → data.changelog.histories[]  (the audit trail of
    //                            field changes: status, due date, description, …)
    //   expand=renderedFields  → data.renderedFields.*       (rich fields as HTML,
    //                            so comment bodies & description are readable text)
    //   fields=comment         → data.fields.comment.comments[] (author + created ts)
    //   fields=description     → data.fields.description (ADF; we use the rendered one)
    const { data } = await c.get(`/issue/${key}`, {
      params: { expand: 'changelog,renderedFields', fields: 'comment,description' },
    });

    // The Section-1 trigger — flipped true below by a field change (any author)
    // or a comment from someone other than me.
    let changed = false;

    // ─── FIELD CHANGES (from the changelog) ──────────────────────────────
    // Each "history" is one edit event (by one author, at one time); each holds
    // one or more "items" (the individual fields that changed in that event).
    const histories: ChangelogHistory[] = data.changelog?.histories ?? [];
    const changes: string[] = [];
    for (const h of histories) {
      // Skip edits older than the window — we only care about recent changes.
      if (new Date(h.created).getTime() <= windowMs) continue;
      // A field change (regardless of who made it) is worth surfacing.
      changed = true;
      const who = h.author?.displayName ?? 'someone';
      for (const it of h.items ?? []) {
        // fromString/toString are the human-readable before/after values;
        // truncate because fields like "description" can be huge.
        const from = truncate(it.fromString ?? '∅', 120);
        const to = truncate(it.toString ?? '∅', 120);
        changes.push(`${who} changed ${it.field}: ${from} → ${to}`);
      }
    }

    // ─── COMMENTS ────────────────────────────────────────────────────────
    // rawComments carries metadata (author, created); renderedComments carries
    // the matching HTML body at the SAME index (so index i lines them up).
    const rawComments: { author?: { displayName?: string }; created?: string }[] =
      data.fields?.comment?.comments ?? [];
    const renderedComments: { body?: string }[] = data.renderedFields?.comment?.comments ?? [];

    // Trigger check: a comment inside the window, authored by someone OTHER than
    // me, counts as new activity. (My own comments are ignored as noise.)
    for (const cm of rawComments) {
      if (!cm.created) continue;
      if (new Date(cm.created).getTime() > windowMs && me && (cm.author?.displayName ?? '') !== me) {
        changed = true;
      }
    }

    // Context for the AI: the tail of the thread (most recent MAX_COMMENTS),
    // regardless of author/date, so it can "read the whole conversation" and
    // work out what's being asked. Format: "[YYYY-MM-DD] Author: text".
    const start = Math.max(0, rawComments.length - MAX_COMMENTS);
    const comments: string[] = [];
    for (let i = start; i < rawComments.length; i++) {
      const cm = rawComments[i];
      const date = (cm.created ?? '').slice(0, 10); // "2026-07-05"
      const text = stripHtml(renderedComments[i]?.body ?? '') || '(no text)'; // HTML → plain text
      comments.push(`[${date}] ${cm.author?.displayName ?? 'someone'}: ${text}`);
    }

    // ─── DESCRIPTION ─────────────────────────────────────────────────────
    // Current description as plain text (HTML stripped, truncated) — gives the
    // AI the "what is this ticket about" context.
    const description = data.renderedFields?.description
      ? truncate(stripHtml(data.renderedFields.description), 600)
      : undefined;

    return { changes, comments, description, changed };
  } catch (err) {
    // A single ticket's detail failing shouldn't sink the whole run.
    logger.warn({ key, err: String(err) }, 'Failed to fetch issue detail');
    return { changes: [], comments: [], changed: false };
  }
}

/** Build the human/LLM-facing context blob for a changed ticket. */
function buildContext(issue: JiraIssue, detail: IssueDetail, blocked: boolean): string {
  const f = issue.fields;
  const inActive = isInActiveSprint(issue);
  const lines = [
    `${issue.key}: ${f.summary}`,
    `Type: ${f.issuetype?.name ?? '?'} · Status: ${f.status?.name ?? '?'} · Priority: ${f.priority?.name ?? '?'}`,
    `Sprint: ${sprintLabel(issue)} · In ACTIVE sprint: ${inActive ? 'YES' : 'NO (future/backlog)'}`,
    `Blocked: ${blocked ? 'YES' : 'no'}`,
  ];
  if (f.duedate) lines.push(`Due: ${f.duedate}`);
  if (f.labels?.length) lines.push(`Labels: ${f.labels.join(', ')}`);
  if (detail.description) lines.push(`Description: ${detail.description}`);
  if (detail.changes.length) lines.push(`Field changes in last 24h:\n- ${detail.changes.join('\n- ')}`);
  if (detail.comments.length)
    lines.push(`Comment thread (oldest→newest):\n- ${detail.comments.join('\n- ')}`);
  return lines.join('\n');
}

function mapIssue(issue: JiraIssue, detail: IssueDetail, blocked: boolean): BriefItem {
  const f = issue.fields;
  return {
    source: 'jira',
    type: 'ticket',
    externalId: issue.key,
    title: `${issue.key}: ${f.summary}`,
    url: `${env.JIRA_BASE_URL}/browse/${issue.key}`,
    rawContext: buildContext(issue, detail, blocked),
    lastActivityTs: f.updated ?? new Date(0).toISOString(),
    participants: f.assignee?.displayName ? [f.assignee.displayName] : [],
    blocked,
    dueUrgent: isDueUrgent(f.duedate),
    inActiveSprint: isInActiveSprint(issue),
  };
}

/**
 * SECTION 1 — tickets CHANGED BY SOMEONE OTHER THAN ME in the window (a new
 * comment or field change; my own comments are ignored). For each, we attach
 * the recent comment thread so the AI can work out what's being asked. Tickets
 * with no external activity are not returned here (they still appear on the
 * board via getActiveSprintSnapshot).
 */
export async function collectJiraItems(since: Date): Promise<BriefItem[]> {
  if (!(await jira())) return [];

  const me = await getMyDisplayName();
  const sf = await getSprintFieldId(); // include the Sprint field so we can read its state
  const minutesAgo = Math.max(1, Math.round((Date.now() - since.getTime()) / 60_000));
  const jql = `${PROJECT_CLAUSE} AND assignee = currentUser() AND updated >= "-${minutesAgo}m" ORDER BY updated DESC`;
  const candidates = await searchIssues(jql, [...FIELDS, sf]);

  const detailed = await Promise.all(
    candidates.map(async (issue) => ({ issue, detail: await getIssueDetail(issue.key, since, me) })),
  );
  const changed = detailed.filter((d) => d.detail.changed);

  logger.info(
    { candidates: candidates.length, changed: changed.length },
    'Jira: tickets changed in window',
  );

  return changed.map(({ issue, detail }) => mapIssue(issue, detail, isBlocked(issue)));
}

/** SECTION 2 — one row per active-sprint ticket for the board table. */
export interface BoardTicket {
  ticket: string;
  title: string;
  status: string;
  blocked: boolean;
  overdue: boolean;
  dueDate?: string;
}

/**
 * ACTIVE SPRINT — my non-done tickets in the CURRENTLY ACTIVE sprint, as flat
 * rows for the board table (Section 2). We query openSprints() (active+future)
 * then filter to sprints whose state is `active`, so future-sprint tickets
 * (e.g. Sprint 10 while Sprint 9 is active) are excluded. Status is exact;
 * blocked = status or *block* label; overdue = due date before today.
 */
export async function getActiveSprintSnapshot(): Promise<BoardTicket[]> {
  if (!(await jira())) return [];

  const sf = await getSprintFieldId(); // need the Sprint field to read its state
  const jql = `${PROJECT_CLAUSE} AND assignee = currentUser() AND sprint IN openSprints() ORDER BY status`;
  const issues = await searchIssues(jql, [...FIELDS, sf]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const tickets: BoardTicket[] = [];
  for (const issue of issues) {
    const f = issue.fields;
    if (f.status?.statusCategory?.key === 'done') continue; // completed — not actionable today
    if (!isInActiveSprint(issue)) continue; // exclude future/planned-sprint tickets
    const dueMs = f.duedate ? new Date(f.duedate).getTime() : undefined;
    tickets.push({
      ticket: issue.key,
      title: f.summary,
      status: f.status?.name ?? 'Unknown',
      blocked: isBlocked(issue),
      overdue: dueMs !== undefined && dueMs < startOfTodayMs,
      dueDate: f.duedate ?? undefined,
    });
  }
  return tickets;
}
