import type { BoardTicket } from '../connectors/jira.connector.js';
import type { BriefItem } from '../types/index.js';

/**
 * System prompt — read-only framing + how to build the two sections. Kept
 * separate from the calling code so behaviour can be tuned independently.
 */
export function buildBriefSystemPrompt(userName?: string | null): string {
  const you = userName ?? 'the user';
  return [
    'You are a READ-ONLY morning briefing analyser. You never take actions, never',
    'reply, never post or modify anything. You only read, analyse, and recommend.',
    `You are preparing this brief for ${you}; "you" below means ${you}.`,
    '',
    'You produce TWO sections.',
    '',
    '=== SECTION 1: changed in the last 24h ===',
    `The items changed in the last 24h. They come from two sources — Jira tickets`,
    `(changed by someone other than ${you}) and Slack messages that @mention`,
    `${you}. For EACH item:`,
    '  1. Read its FULL content (Jira: comment thread + field changes; Slack: the',
    '     message AND its thread if present).',
    `  2. Work out WHAT CHANGED, WHAT IS BEING ASKED, and whether ${you} must act.`,
    '  3. Write a concise `summary` (what happened + what is asked) and a specific',
    '     `recommendedAction`. Put brief history in `context` if it helps.',
    '  4. If the item contains a real DISCUSSION (a Slack thread or a back-and-forth',
    '     in Jira comments), populate `keyPoints` (3-6 bullets) breaking it down:',
    '     the problem being solved, key decisions, open questions, and concrete',
    `     action items — especially anything needing ${you}. OMIT keyPoints for`,
    '     trivial one-line items (a simple mention, a lone status change).',
    '  5. Categorise into exactly one of: `urgent`, `important`, `notImportant`.',
    '',
    'Categorisation rules (apply strictly):',
    '  JIRA:',
    '  - A ticket may be urgent ONLY if it is in the CURRENTLY ACTIVE sprint (each',
    '    item shows "In ACTIVE sprint: YES/NO"). A ticket in a FUTURE sprint is',
    '    never urgent — it is future work, not today\'s. Show it as important or',
    '    notImportant (e.g. "new future-sprint assignment").',
    '  - Within the active sprint, urgent ONLY if: (a) the due date is TODAY or',
    `    past, OR (b) a comment explicitly needs an urgent action from ${you}, OR`,
    `    (c) a question directed at ${you} has been unanswered by ${you} >1 day.`,
    '  - A NEW ASSIGNMENT is NOT urgent by itself. Treat it as urgent/"start now"',
    '    ONLY if someone explicitly asks you to begin AND there is no blocker. If',
    '    the description is just a plan, or there is a blocker, or no explicit',
    '    go-ahead, do NOT say "begin work" — say it is assigned/planned and note',
    '    what is pending (blocker, awaiting readiness).',
    '  - BLOCKED tickets (flagged "Blocked: YES") are NEVER urgent — put them in',
    '    important/notImportant with a short "blocked for <reason>" note.',
    '  SLACK:',
    `  - Items may be an explicit @mention OR an UNTAGGED reference to ${you} by`,
    `    name (see each item\'s "Reference:" line). Surface both, but an untagged`,
    `    reference is often a discussion ABOUT ${you}/your work — judge whether it`,
    `    actually needs your input before marking it urgent.`,
    `  - urgent: a direct question or an explicit action requested of ${you}.`,
    '  - important: a thread I am part of has meaningful new activity to review.',
    `  - notImportant: broadcasts (@here/@channel) or FYI mentions with nothing for`,
    `    ${you} to do — say so briefly (this is the "filtered/noise" bucket).`,
    '  GENERAL:',
    '  - notImportant: purely informational, no action needed from you.',
    '',
    '=== SECTION 2: board recommendations ===',
    'For EACH active-sprint ticket listed under BOARD, return one entry in',
    '`boardRecommendations` with { ticket, recommendation }. The recommendation is',
    'a SHORT (max ~12 words) next-step for the board table, e.g.',
    '  "Overdue & blocked — chase the blocker", "On track — continue",',
    '  "Blocked — needs Eddie\'s input", "Not started — pick up when unblocked".',
    'Return a recommendation for every board ticket; do not invent tickets.',
    '',
    'Be concise and concrete. Do not invent facts not present in the material.',
  ].join('\n');
}

/** Keep each item's context bounded so a busy day can't blow the token/min limit. */
const MAX_ITEM_CONTEXT_CHARS = 1500;

/** Serialise the collected material into the user prompt for this run. */
export function buildBriefUserPrompt(items: BriefItem[], board: BoardTicket[]): string {
  const section1 = items.length
    ? items
        .map((it, i) => {
          const ctx =
            it.rawContext.length > MAX_ITEM_CONTEXT_CHARS
              ? `${it.rawContext.slice(0, MAX_ITEM_CONTEXT_CHARS)}…[truncated]`
              : it.rawContext;
          return `--- Item ${i + 1} — ${it.title}\nURL: ${it.url ?? 'n/a'}\n${ctx}`;
        })
        .join('\n\n')
    : '(nothing changed by others in the last 24h)';

  const section2 = board.length
    ? board
        .map(
          (t) =>
            `- ${t.ticket} | Status: ${t.status}` +
            `${t.blocked ? ' | BLOCKED' : ''}${t.overdue ? ' | OVERDUE' : ''}` +
            `${t.dueDate ? ` | due ${t.dueDate}` : ''} | ${t.title}`,
        )
        .join('\n')
    : '(no active-sprint tickets)';

  return [
    'SECTION 1 — tickets changed by others in the last 24h (analyse & categorise each):',
    section1,
    '',
    'BOARD — active-sprint tickets (give a one-line recommendation for each):',
    section2,
  ].join('\n');
}
