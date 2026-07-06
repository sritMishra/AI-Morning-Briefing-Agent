import axios from 'axios';

import { env, slackNameAliases, slackProjectChannels } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { BriefItem } from '../types/index.js';

/**
 * Slack connector (read-only). Phase 1.
 *
 * Auth: a USER token (xoxp-). Scopes: search:read, channels:history,
 * groups:history, users:read. No write scopes — it cannot post anything.
 *
 * It surfaces two things since the watermark:
 *   1. Messages that @mention me — AND the surrounding THREAD, so the AI can
 *      read the whole discussion (not just the one line I was tagged in).
 *   2. Recent activity in my key project channels (SLACK_PROJECT_CHANNELS) —
 *      to catch discussions about my work where I wasn't @mentioned.
 */

const SLACK_BASE = 'https://slack.com/api';

interface SlackMsg {
  ts: string;
  user?: string;
  username?: string;
  text?: string;
  subtype?: string;
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
/** My own Slack user id (cached) — used for the mention query + skipping self. */
async function getMyId(): Promise<string | null> {
  if (myId) return myId;
  const data = await slackGet('auth.test', {});
  myId = data.user_id ?? null;
  return myId;
}

let searchTerms: string[] | null = null;
/**
 * The plain-text name terms to search for (case-insensitive), so untagged
 * references are caught too. Derived from my Slack profile (username + first
 * name) plus any configured aliases/spellings (SLACK_NAME_ALIASES).
 */
async function getNameTerms(me: string): Promise<string[]> {
  if (searchTerms) return searchTerms;
  const names: (string | undefined)[] = [];
  try {
    const data = await slackGet('users.info', { user: me });
    names.push(data.user?.name); // username, e.g. "srittam"
    const real = data.user?.profile?.real_name || data.user?.real_name;
    if (real) names.push(real.split(/\s+/)[0]); // first name, e.g. "Srittam"
    names.push(data.user?.profile?.display_name);
  } catch {
    /* fall back to aliases only */
  }
  names.push(...slackNameAliases);
  searchTerms = [
    ...new Set(names.filter((n): n is string => !!n && n.trim().length > 1).map((n) => n.trim().toLowerCase())),
  ];
  return searchTerms;
}

// Small cache so we resolve each user id → display name only once per run.
const userNameCache = new Map<string, string>();
async function resolveUserName(id?: string): Promise<string> {
  if (!id) return 'someone';
  const cached = userNameCache.get(id);
  if (cached) return cached;
  try {
    const data = await slackGet('users.info', { user: id });
    const name = data.user?.real_name || data.user?.name || id;
    userNameCache.set(id, name);
    return name;
  } catch {
    return id;
  }
}

/** Slack noise to skip — e.g. the automated EA_BLOCK report (per docs/improvements.md). */
function isIgnored(text?: string): boolean {
  return (text ?? '').toLowerCase().includes('ea_block');
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

/**
 * Fetch the thread around a message (oldest→newest), so a mention buried in a
 * discussion brings the whole conversation. Returns [] if there's no real
 * thread or if we lack access (e.g. DMs need im:history, which we don't have).
 */
async function getThreadContext(channelId: string, ts: string): Promise<string[]> {
  try {
    const data = await slackGet('conversations.replies', { channel: channelId, ts, limit: 20 });
    const msgs: SlackMsg[] = data.messages ?? [];
    if (msgs.length <= 1) return []; // not a thread — just the single message
    const out: string[] = [];
    for (const m of msgs) {
      const name = await resolveUserName(m.user);
      const date = new Date(parseFloat(m.ts) * 1000).toISOString().slice(0, 10);
      out.push(`[${date}] ${name}: ${cleanSlackText(m.text ?? '')}`);
    }
    return out;
  } catch {
    return [];
  }
}

function mapMention(m: SlackMsg, thread: string[], explicit: boolean): BriefItem {
  const channel = m.channel?.name ? `#${m.channel.name}` : 'DM';
  const author = m.username ?? 'someone';
  const how = explicit ? 'mentioned you (@tag)' : 'referred to you by name (untagged)';
  const lines = [
    `Channel: ${channel}`,
    `From: ${author}`,
    `Reference: ${how}`,
    `Message: ${cleanSlackText(m.text ?? '')}`,
  ];
  if (thread.length) lines.push(`Thread (oldest→newest):\n- ${thread.join('\n- ')}`);
  return {
    source: 'slack',
    type: thread.length ? 'thread' : explicit ? 'mention' : 'name-ref',
    externalId: `${m.channel?.id ?? '?'}:${m.ts}`,
    title: `${channel} — @${author} ${how}`,
    url: m.permalink,
    rawContext: lines.join('\n'),
    lastActivityTs: new Date(Math.round(parseFloat(m.ts) * 1000)).toISOString(),
    participants: [author],
  };
}

/**
 * (1) Messages that reference me — explicit @mention AND untagged name mentions
 * (any casing / configured spellings). We run one query per term, dedupe by
 * channel:ts (explicit wins), skip my own messages, and attach each thread.
 */
async function collectMentions(since: Date, me: string): Promise<BriefItem[]> {
  const sinceTs = since.getTime() / 1000;
  const terms = await getNameTerms(me);

  // Explicit @mention first (so it wins on dedupe), then each plain-text name term.
  const queries: { q: string; explicit: boolean }[] = [
    { q: `<@${me}>`, explicit: true },
    ...terms.map((t) => ({ q: t, explicit: false })),
  ];

  const seen = new Set<string>();
  const items: BriefItem[] = [];
  for (const { q, explicit } of queries) {
    const data = await slackGet('search.messages', { query: q, count: 20, sort: 'timestamp' });
    for (const m of (data.messages?.matches ?? []) as SlackMsg[]) {
      if (parseFloat(m.ts) < sinceTs) break; // sorted newest-first → rest are older
      if (m.user === me) continue; // ignore messages I sent
      if (isIgnored(m.text)) continue; // skip EA_BLOCK report noise
      const key = `${m.channel?.id ?? '?'}:${m.ts}`;
      if (seen.has(key)) continue; // already captured (e.g. by the explicit query)
      seen.add(key);
      const thread = m.channel?.id ? await getThreadContext(m.channel.id, m.ts) : [];
      items.push(mapMention(m, thread, explicit));
    }
  }
  return items;
}

/**
 * (2) Recent activity in each configured key channel, bundled into one item per
 * channel so the AI can spot discussions about my work even when I'm not tagged.
 * Inactive until SLACK_PROJECT_CHANNELS is set (comma-separated channel IDs).
 */
async function collectChannelActivity(since: Date): Promise<BriefItem[]> {
  if (!slackProjectChannels.length) return [];
  const oldest = (since.getTime() / 1000).toString();
  const items: BriefItem[] = [];

  for (const ch of slackProjectChannels) {
    try {
      // Cap volume: channels are chatty, and too much content blows the LLM's
      // token/min limit. 15 recent messages, each truncated, is plenty of signal.
      const data = await slackGet('conversations.history', { channel: ch, oldest, limit: 15 });
      const msgs: SlackMsg[] = (data.messages ?? []).filter(
        (m: SlackMsg) => !m.subtype && !isIgnored(m.text),
      );
      if (!msgs.length) continue;

      const ordered = [...msgs].reverse(); // history is newest-first → make oldest-first
      const lines: string[] = [];
      for (const m of ordered) {
        const name = await resolveUserName(m.user);
        const text = cleanSlackText(m.text ?? '');
        lines.push(`${name}: ${text.length > 240 ? `${text.slice(0, 240)}…` : text}`);
      }
      items.push({
        source: 'slack',
        type: 'channel',
        externalId: `channel:${ch}`,
        title: `Recent activity in channel ${ch}`,
        rawContext: `Recent messages in channel ${ch} (oldest→newest):\n- ${lines.join('\n- ')}`,
        lastActivityTs: new Date().toISOString(),
        participants: [],
      });
    } catch (err) {
      logger.warn({ channel: ch, err: String(err) }, 'Slack: channel history failed');
    }
  }
  return items;
}

/** Collect all Slack items for Section 1 (mentions + key-channel activity). */
export async function collectSlackItems(since: Date): Promise<BriefItem[]> {
  if (!env.SLACK_USER_TOKEN) {
    logger.warn('Slack token missing (SLACK_USER_TOKEN) — skipping Slack');
    return [];
  }
  const me = await getMyId();
  if (!me) return [];

  const [mentions, channelActivity] = await Promise.all([
    collectMentions(since, me),
    collectChannelActivity(since),
  ]);

  logger.info(
    { mentions: mentions.length, channels: channelActivity.length },
    'Slack: items collected',
  );
  return [...mentions, ...channelActivity];
}
