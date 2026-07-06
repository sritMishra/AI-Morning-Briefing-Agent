import { collectGmailItems } from '../../connectors/gmail.connector.js';
import { collectJiraItems } from '../../connectors/jira.connector.js';
import { collectSlackItems } from '../../connectors/slack.connector.js';
import { logger } from '../../lib/logger.js';
import type { BriefItem } from '../../types/index.js';

export interface CollectChangesResult {
  /** Normalised items that changed since `since` (currently Jira; Slack/Gmail stubbed). */
  items: BriefItem[];
  /** One message per source that failed (empty if all succeeded). */
  errors: string[];
}

/**
 * STEP 2 — Collect Section-1 items ("changed in the last 24h").
 *
 * Purpose:
 *   Run the read-only source connectors (Slack, Jira, Gmail) IN PARALLEL and
 *   gather everything that changed since `since`. Fail-soft: if one source
 *   throws, the others still contribute and the failure is recorded — a partial
 *   brief beats no brief.
 *
 * Expected output:
 *   `{ items, errors }` —
 *     items:  BriefItem[] normalised across sources (Jira only for now),
 *     errors: string[] naming any source that failed.
 *
 * Example:
 *   const { items, errors } = await collectChanges(since);
 *   // items -> [{ source:'jira', title:'EA-2843: …', … }], errors -> []
 */
export async function collectChanges(since: Date): Promise<CollectChangesResult> {
  const sources = ['slack', 'jira', 'gmail'] as const;
  const settled = await Promise.allSettled([
    collectSlackItems(since),
    collectJiraItems(since),
    collectGmailItems(since),
  ]);

  const items: BriefItem[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      const msg = `${sources[i]} collection failed: ${String(r.reason?.message ?? r.reason)}`;
      logger.error({ err: r.reason }, msg);
      errors.push(msg);
    }
  });

  return { items, errors };
}
