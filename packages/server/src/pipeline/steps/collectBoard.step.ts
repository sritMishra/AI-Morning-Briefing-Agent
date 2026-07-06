import { type BoardTicket, getActiveSprintSnapshot } from '../../connectors/jira.connector.js';
import { logger } from '../../lib/logger.js';

export interface CollectBoardResult {
  /** One row per non-done active-sprint ticket (ticket/status/flags). */
  board: BoardTicket[];
  /** Present only if the board fetch failed (non-fatal to the run). */
  error?: string;
}

/**
 * STEP 3 — Collect the Section-2 board (active-sprint tickets).
 *
 * Purpose:
 *   Fetch every non-done ticket assigned to me in the active sprint, for the
 *   "Today's Board" table. Best-effort: a failure here is recorded but does NOT
 *   sink the run (Section 1 can still be delivered).
 *
 * Expected output:
 *   `{ board, error? }` —
 *     board: BoardTicket[] (empty on failure),
 *     error: string if the snapshot failed.
 *
 */
export async function collectBoard(): Promise<CollectBoardResult> {
  try {
     // board -> [{ ticket:'EA-2729', status:'Dev In Progress', blocked:true, … }]
    return { board: await getActiveSprintSnapshot() }; 
  } catch (err) {
    const msg = `Jira board snapshot failed: ${String(err instanceof Error ? err.message : err)}`;
    logger.warn({ err }, msg);
    return { board: [], error: msg };
  }
}
