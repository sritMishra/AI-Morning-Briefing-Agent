import type { BoardTicket } from '../../connectors/jira.connector.js';
import {
  analyseBrief,
  enforceActiveSprintUrgent,
  enforceBlockedNotUrgent,
  enforceDueDateUrgent,
} from '../../services/analyze.service.js';
import type { BriefItem, BriefOutput } from '../../types/index.js';

/**
 * STEP 4 — Analyse the material and enforce the hard rules.
 *
 * Purpose:
 *   Turn raw Section-1 items + the board into a categorised, prioritised
 *   BriefOutput using the LLM (`analyseBrief`), then apply the DETERMINISTIC
 *   guards so business invariants hold regardless of what the model decided.
 *   Guard order matters (promote first, then the demotions win):
 *     1. enforceDueDateUrgent    — due-today/overdue, in active sprint, not blocked → urgent
 *     2. enforceActiveSprintUrgent — future-sprint ticket → never urgent (→ important)
 *     3. enforceBlockedNotUrgent — blocked → never urgent (→ important)
 *
 * Expected output:
 *   A fully-assembled `BriefOutput`: { urgent, important, notImportant, board }.
 *
 * Throws:
 *   Propagates any LLM/analysis error — the caller records it (runBrief turns it
 *   into a run error rather than crashing).
 */
export async function analyseAndGuard(items: BriefItem[], board: BoardTicket[]): Promise<BriefOutput> {
  let brief = await analyseBrief(items, board);

  // Only active-sprint, non-blocked, due-today/overdue tickets may be force-urgent.
  const dueUrgentKeys = new Set(
    items.filter((i) => i.dueUrgent && !i.blocked && i.inActiveSprint).map((i) => i.externalId),
  );
  // Jira tickets NOT in the active sprint (future/backlog) must not be urgent.
  const nonActiveSprintKeys = new Set(
    items.filter((i) => i.source === 'jira' && !i.inActiveSprint).map((i) => i.externalId),
  );
  const blockedKeys = new Set(items.filter((i) => i.blocked).map((i) => i.externalId));

  brief = enforceDueDateUrgent(brief, dueUrgentKeys);
  brief = enforceActiveSprintUrgent(brief, nonActiveSprintKeys);
  brief = enforceBlockedNotUrgent(brief, blockedKeys);
  return brief;
}
