import type { BoardTicket } from '../connectors/jira.connector.js';
import { logger } from '../lib/logger.js';
import { llmAvailable } from '../services/analyze.service.js';
import { deliverBriefEmail, emailConfigured } from '../services/deliver.service.js';
import { type RenderedBrief, renderBrief } from '../services/render.service.js';
import type { BriefOutput } from '../types/index.js';
import { analyseAndGuard } from './steps/analyse.step.js';
import { collectBoard } from './steps/collectBoard.step.js';
import { collectChanges } from './steps/collectChanges.step.js';
import { resolveWatermark } from './steps/watermark.step.js';

export interface RunBriefResult {
  status: 'success' | 'partial' | 'failed';
  itemCount: number;
  errors: string[];
  /** Raw Section-1 items (fallback view when no LLM key). */
  preview?: { source: string; title: string; url?: string }[];
  /** Active-sprint board rows (Section 2 raw data). */
  board?: BoardTicket[];
  brief?: BriefOutput;
  /** The brief rendered for delivery (email + Slack DM), present when analysed. */
  rendered?: RenderedBrief;
  /** Whether the brief email was actually sent this run. */
  delivered?: boolean;
}

/**
 * ORCHESTRATOR — one full run of the morning-briefing pipeline.
 *
 * Each step lives in its own module under ./steps for easy tracking:
 *   1. resolveWatermark()  → the "since" instant                (watermark.step)
 *   2. collectBoard()      → Section-2 active-sprint board       (collectBoard.step)
 *   3. collectChanges()    → Section-1 changed items (fail-soft) (collectChanges.step)
 *   4. analyseAndGuard()   → categorised BriefOutput + guards    (analyse.step)
 *   5. renderBrief()       → email HTML + Slack mrkdwn           (render.service)
 *   (8-9 deliver + persist: still to come.)
 *
 * Expected output: a RunBriefResult summarising the run and carrying the brief.
 */
export async function runBrief(): Promise<RunBriefResult> {
  const since = resolveWatermark();
  logger.info({ since }, 'Starting morning-briefing run');

  const errors: string[] = [];

  // Step 3 — the board. If it failed, `board` is [] AND `boardError` is set; we
  // must NOT later render that empty board as "no tickets" (it's unavailable,
  // not empty), so we track the distinction explicitly.

   // board -> [{ ticket:'EA-2729', status:'Dev In Progress', blocked:true, … }]
  const { board, error: boardError } = await collectBoard();
  if (boardError) errors.push(boardError);
  const boardUnavailable = !!boardError;

  // Step 2 — the changed items (fail-soft across sources).
  const { items, errors: collectErrors } = await collectChanges(since);
  errors.push(...collectErrors);

  // Steps 4 & 5 — analyse + render. Only if an LLM key is configured and there
  // is something to report; otherwise we return the raw preview (no key path).
  let brief: BriefOutput | undefined;
  let rendered: RenderedBrief | undefined;
  const hasContent = items.length > 0 || board.length > 0;
  if (llmAvailable() && hasContent) {
    try {
      brief = await analyseAndGuard(items, board);
      rendered = renderBrief(brief, { boardUnavailable });
    } catch (err) {
      const msg = `AI analysis failed: ${String(err instanceof Error ? err.message : err)}`;
      logger.error({ err }, msg);
      errors.push(msg);
    }
  } else if (!llmAvailable()) {
    logger.info('LLM not configured (no API key) — returning raw preview only');
  }

  // Step 8 — deliver the brief by email (skipped silently if not configured).
  let delivered = false;
  if (rendered && emailConfigured()) {
    const res = await deliverBriefEmail(rendered);
    delivered = res.delivered;
    if (res.error) errors.push(res.error);
  }

  logger.info(
    { itemCount: items.length, analysed: !!brief, delivered, errors: errors.length },
    'Run complete',
  );

  return {
    status: errors.length === 0 ? 'success' : errors.length >= 3 ? 'failed' : 'partial',
    itemCount: items.length,
    errors,
    preview: items.map((it) => ({ source: it.source, title: it.title, url: it.url })),
    board,
    brief,
    rendered,
    delivered,
  };
}

