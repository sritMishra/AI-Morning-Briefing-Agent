import type { BoardTicket } from '../../connectors/jira.connector.js';
import {
  analyseBrief,
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
 *   Guard order matters:
 *     1. enforceDueDateUrgent  — due-today/overdue (& not blocked) → must be urgent
 *     2. enforceBlockedNotUrgent — blocked → never urgent (moved to important)
 *
 * Expected output:
 *   A fully-assembled `BriefOutput`:
 *     { urgent, important, notImportant, board }.
 *
 * Throws:
 *   Propagates any LLM/analysis error — the caller decides how to record it
 *   (runBrief turns it into a run error rather than crashing).
 *
 * Example:
 *   const brief = await analyseAndGuard(items, board);
 *   // brief.urgent -> [{ title:'EA-2843: …', summary:'Due today …', … }]
 */
export async function analyseAndGuard(items: BriefItem[], board: BoardTicket[]): Promise<BriefOutput> {
  let brief = await analyseBrief(items, board);

  const dueUrgentKeys = new Set(
    items.filter((i) => i.dueUrgent && !i.blocked).map((i) => i.externalId),
  );
  const blockedKeys = new Set(items.filter((i) => i.blocked).map((i) => i.externalId));

  brief = enforceDueDateUrgent(brief, dueUrgentKeys);
  brief = enforceBlockedNotUrgent(brief, blockedKeys);
  return brief;
}
