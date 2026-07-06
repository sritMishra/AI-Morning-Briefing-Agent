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
    'The items given to you are tickets that changed in the last 24h due to someone',
    `OTHER than ${you} (a new comment or field change). For EACH item:`,
    '  1. Read the comment thread (oldest→newest) and the field changes.',
    '  2. Work out WHAT CHANGED, WHAT IS BEING ASKED, and whether anything needs',
    `     doing by ${you}.`,
    '  3. Write a concise `summary` (what happened + what is asked) and a specific',
    '     `recommendedAction`. Put brief history in `context` if it helps.',
    '  4. Categorise the item into exactly one of: `urgent`, `important`,',
    '     `notImportant`.',
    '',
    'Categorisation rules (apply strictly):',
    '  - urgent ONLY if: (a) the due date is TODAY or already past, OR (b) a comment',
    `    explicitly needs an urgent action from ${you}, OR (c) a question directed`,
    `    at ${you} has been unanswered by ${you} for more than a day (judge from`,
    '    the dated comments; a later comment by you means it is answered).',
    '  - BLOCKED tickets (flagged "Blocked: YES") are NEVER urgent — put them in',
    '    important/notImportant with a short "blocked for <reason>" note.',
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

/** Serialise the collected material into the user prompt for this run. */
export function buildBriefUserPrompt(items: BriefItem[], board: BoardTicket[]): string {
  const section1 = items.length
    ? items.map((it, i) => `--- Item ${i + 1} — ${it.title}\nURL: ${it.url ?? 'n/a'}\n${it.rawContext}`).join('\n\n')
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
