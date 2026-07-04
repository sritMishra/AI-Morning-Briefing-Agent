import { collectGmailItems } from '../connectors/gmail.connector.js';
import { collectJiraItems } from '../connectors/jira.connector.js';
import { collectSlackItems } from '../connectors/slack.connector.js';
import { logger } from '../lib/logger.js';
import type { BriefItem, BriefOutput } from '../types/index.js';

export interface RunBriefResult {
  status: 'success' | 'partial' | 'failed';
  itemCount: number;
  errors: string[];
  brief?: BriefOutput;
}

/**
 * The orchestrator — one full run of the morning-briefing pipeline.
 *
 * Steps (see CLAUDE.md §7):
 *   1. load watermark (last successful brief)   [TODO: from RunLog]
 *   2. collect from Slack + Jira + Gmail in parallel (fail-soft per source)
 *   3. normalise → BriefItem[]                   (connectors already do this)
 *   4. relevance filter (LLM)                    [TODO]
 *   5. context enrichment (LLM)                  [TODO]
 *   6. prioritise + recommend (LLM)              [TODO -> generateObject]
 *   7. render (email + Slack mrkdwn)             [TODO]
 *   8. deliver (Resend + Slack DM)               [TODO]
 *   9. persist watermark + seen ids + context    [TODO]
 *
 * This scaffold wires steps 2-3 (collection is fail-soft) and returns a
 * skeleton result so the endpoint and scheduler are exercisable end-to-end.
 */
export async function runBrief(): Promise<RunBriefResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // TODO: real watermark
  const errors: string[] = [];

  logger.info({ since }, 'Starting morning-briefing run');

  // Step 2 — collect in parallel, fail-soft: one source failing must not sink the brief.
  const results = await Promise.allSettled([
    collectSlackItems(since),
    collectJiraItems(since),
    collectGmailItems(since),
  ]);

  const items: BriefItem[] = [];
  const sourceNames = ['slack', 'jira', 'gmail'] as const;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      const msg = `${sourceNames[i]} collection failed: ${String(r.reason)}`;
      logger.error({ err: r.reason }, msg);
      errors.push(msg);
    }
  });

  // Steps 4-9 are not implemented yet — see the TODOs above.
  logger.info({ itemCount: items.length, errors: errors.length }, 'Run complete (scaffold)');

  return {
    status: errors.length === 0 ? 'success' : errors.length === 3 ? 'failed' : 'partial',
    itemCount: items.length,
    errors,
  };
}
