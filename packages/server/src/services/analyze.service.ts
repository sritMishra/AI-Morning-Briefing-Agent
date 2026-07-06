import { generateObject } from 'ai';

import { smartModel } from '../ai/provider.js';
import { type BoardTicket, getMyDisplayName } from '../connectors/jira.connector.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { buildBriefSystemPrompt, buildBriefUserPrompt } from '../prompts/brief.prompt.js';
import { analysisOutputSchema, type BoardRow, type BriefItem, type BriefOutput } from '../types/index.js';

/** Is an LLM provider actually configured (do we have a key)? */
export function llmAvailable(): boolean {
  return env.LLM_PROVIDER === 'anthropic' ? !!env.ANTHROPIC_API_KEY : !!env.OPENAI_API_KEY;
}

/** Deterministic fallback recommendation if the LLM omits one for a board ticket. */
function fallbackRecommendation(t: BoardTicket): string {
  if (t.blocked && t.overdue) return 'Overdue & blocked — chase the blocker';
  if (t.blocked) return 'Blocked — needs unblocking';
  if (t.overdue) return 'Overdue — review';
  return '';
}

/** Build the Section-2 table: deterministic ticket + status, AI recommendation. */
function buildBoardTable(board: BoardTicket[], recs: { ticket: string; recommendation: string }[]): BoardRow[] {
  const byTicket = new Map(recs.map((r) => [r.ticket, r.recommendation]));
  return board.map((t) => ({
    ticket: t.ticket,
    status: t.status, // exact, from Jira — never the LLM
    recommendation: byTicket.get(t.ticket)?.trim() || fallbackRecommendation(t),
  }));
}

/**
 * AI analysis: categorise Section-1 changed tickets and get board
 * recommendations, then assemble the final BriefOutput. The board's status is
 * deterministic; only recommendations come from the model.
 */
export async function analyseBrief(items: BriefItem[], board: BoardTicket[]): Promise<BriefOutput> {
  const userName = await getMyDisplayName();
  const { object, usage } = await generateObject({
    model: smartModel(),
    schema: analysisOutputSchema,
    system: buildBriefSystemPrompt(userName),
    prompt: buildBriefUserPrompt(items, board),
  });

  logger.info({ usage }, 'AI analysis complete');
  return {
    urgent: object.urgent,
    important: object.important,
    notImportant: object.notImportant,
    board: buildBoardTable(board, object.boardRecommendations),
  };
}

const KEY_RE = /[A-Z][A-Z0-9]+-\d+/;

function keyOf(it: { title: string; link?: string }): string | null {
  const m = (it.link ?? '').match(KEY_RE) ?? it.title.match(KEY_RE);
  return m ? m[0] : null;
}

/**
 * Deterministic guard: a ticket due today or overdue (and NOT blocked) MUST be
 * urgent, regardless of what the LLM decided (it tends to under-rate changes the
 * user made themselves). Promote such items from important/notImportant into
 * urgent. Apply this BEFORE enforceBlockedNotUrgent (which removes blocked ones).
 */
export function enforceDueDateUrgent(brief: BriefOutput, dueUrgentKeys: Set<string>): BriefOutput {
  if (!dueUrgentKeys.size) return brief;

  const promoted: BriefOutput['urgent'] = [];
  const takeMatching = (list: BriefOutput['urgent']) =>
    list.filter((it) => {
      const k = keyOf(it);
      if (k && dueUrgentKeys.has(k)) {
        promoted.push(it);
        return false;
      }
      return true;
    });

  const important = takeMatching(brief.important);
  const notImportant = takeMatching(brief.notImportant);
  if (!promoted.length) return brief;

  logger.warn({ promoted: promoted.map(keyOf) }, 'Enforced due-date-urgent: promoted to urgent');
  return { ...brief, urgent: [...brief.urgent, ...promoted], important, notImportant };
}

/**
 * Deterministic guard: a blocked ticket must NEVER sit in `urgent`, no matter
 * what the LLM decided. Move any blocked item from urgent into important. Hard
 * business rules are enforced in code, not left to the model's discretion.
 */
export function enforceBlockedNotUrgent(brief: BriefOutput, blockedKeys: Set<string>): BriefOutput {
  if (!blockedKeys.size) return brief;

  const moved: BriefOutput['urgent'] = [];
  const urgent = brief.urgent.filter((it) => {
    const k = keyOf(it);
    if (k && blockedKeys.has(k)) {
      moved.push(it);
      return false;
    }
    return true;
  });
  if (!moved.length) return brief;

  logger.warn(
    { moved: moved.map(keyOf) },
    'Enforced blocked-not-urgent: moved blocked items out of urgent',
  );
  return { ...brief, urgent, important: [...moved, ...brief.important] };
}
