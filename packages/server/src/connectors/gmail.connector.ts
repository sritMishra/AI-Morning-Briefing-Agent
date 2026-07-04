import type { BriefItem } from '../types/index.js';

/**
 * Gmail connector (read-only, UNREAD emails only). Phase 1.
 *
 * Requires the official googleapis SDK (added when we implement this):
 *   npm i googleapis --workspace=packages/server
 *
 * OAuth scope: gmail.readonly. Lists messages with q="is:unread newer_than:1d"
 * and fetches each with format=full. IMPORTANT: messages.get does NOT change
 * read state — we never call messages.modify, so mail stays unread.
 * Capped at GMAIL_MAX_UNREAD_PER_RUN; the cap is reported in the FYI section.
 *
 * TODO(phase-1): implement list + get → BriefItem[].
 */
export async function collectGmailItems(_since: Date): Promise<BriefItem[]> {
  return [];
}
