import axios from 'axios';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { BriefItem } from '../types/index.js';

/**
 * Slack connector (read-only). Phase 1.
 *
 * Auth: a USER token (xoxp-) — required because `search.messages` (finding
 * messages that @mention me) is not available to bot tokens. Scopes:
 * search:read, channels:history, groups:history, users:read.
 *
 * v1 surfaces messages that @mention me since the watermark. The AI applies the
 * relevance rules (direct question/action = high; broadcast = skip). Reading
 * key-channel activity + thread context is a later addition.
 */

const SLACK_BASE = 'https://slack.com/api';

interface SlackMatch {
  ts: string; // "1782901520.431029" — epoch seconds.microseconds
  user?: string; // author's user id
  username?: string;
  text: string;
  permalink?: string;
  channel?: { id?: string; name?: string };
}

/** Authenticated GET against the Slack Web API; throws on `ok:false`. */
async function slackGet(method: string, params: Record<string, string | number>): Promise<any> {
  const { data } = await axios.get(`${SLACK_BASE}/${method}`, {
    headers: { Authorization: `Bearer ${env.SLACK_USER_TOKEN}` },
    params,
    timeout: 20_000,
  });
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

let myId: string | null = null;
/** My own Slack user id (cached) — used to build the mention query + skip self. */
async function getMyId(): Promise<string | null> {
  if (myId) return myId;
  const data = await slackGet('auth.test', {});
  myId = data.user_id ?? null;
  return myId;
}

/** Turn Slack markup into readable text (<@ID|Name> → @Name, <url|text> → text (url), …). */
function cleanSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapMatch(m: SlackMatch): BriefItem {
  const channel = m.channel?.name ? `#${m.channel.name}` : 'DM';
  const author = m.username ?? 'someone';
  const tsMs = Math.round(parseFloat(m.ts) * 1000);
  return {
    source: 'slack',
    type: 'mention',
    externalId: `${m.channel?.id ?? '?'}:${m.ts}`,
    title: `${channel} — @${author} mentioned you`,
    url: m.permalink,
    rawContext: [
      `Channel: ${channel}`,
      `From: ${author}`,
      `Message: ${cleanSlackText(m.text)}`,
    ].join('\n'),
    lastActivityTs: new Date(tsMs).toISOString(),
    participants: [author],
  };
}

/**
 * Collect Slack items for Section 1: messages that @mention me since `since`.
 * Skips my own messages. Results are sorted newest-first, so we stop once we
 * pass the window boundary.
 */
export async function collectSlackItems(since: Date): Promise<BriefItem[]> {
  if (!env.SLACK_USER_TOKEN) {
    logger.warn('Slack token missing (SLACK_USER_TOKEN) — skipping Slack');
    return [];
  }

  const me = await getMyId();
  if (!me) return [];

  const data = await slackGet('search.messages', {
    query: `<@${me}>`,
    count: 30,
    sort: 'timestamp', // newest first
  });

  const sinceTs = since.getTime() / 1000;
  const matches: SlackMatch[] = data.messages?.matches ?? [];
  const items: BriefItem[] = [];
  for (const m of matches) {
    if (parseFloat(m.ts) < sinceTs) break; // sorted desc → the rest are older
    if (m.user === me) continue; // ignore messages I sent
    items.push(mapMatch(m));
  }

  logger.info({ count: items.length }, 'Slack: mentions in window');
  return items;
}
