import type { BriefItem } from '../types/index.js';

/**
 * Jira Cloud connector (read-only). Phase 1, built first.
 *
 * Auth: Basic (JIRA_EMAIL + JIRA_API_TOKEN) against JIRA_BASE_URL, REST v3.
 * Responsibilities:
 *   - JQL: assigned + changed in last 24h, mentions, newly assigned
 *   - per-ticket detail with ?expand=changelog for "what changed"
 *   - sprint board snapshot (in progress / blocked / due soon)
 *
 * TODO(phase-1): implement with axios; normalise each ticket into a BriefItem.
 */
export async function collectJiraItems(_since: Date): Promise<BriefItem[]> {
  return [];
}
