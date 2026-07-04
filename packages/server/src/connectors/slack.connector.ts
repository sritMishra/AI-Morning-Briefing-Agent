import type { BriefItem } from '../types/index.js';

/**
 * Slack connector (read-only). Phase 1.
 *
 * Requires the official @slack/web-api SDK (added when we implement this):
 *   npm i @slack/web-api --workspace=packages/server
 *
 * Uses the USER token for search.messages (finding my @mentions) and reads
 * configured project channels + my active threads. The BOT token is used only
 * for sending the final DM (see services/deliver).
 *
 * TODO(phase-1): implement search + conversations.history/replies → BriefItem[].
 */
export async function collectSlackItems(_since: Date): Promise<BriefItem[]> {
  return [];
}
