import { z } from 'zod';

import { briefItemOutputSchema, type BriefOutput } from '../types/index.js';

type BriefItemOut = z.infer<typeof briefItemOutputSchema>;

export interface RenderedBrief {
  subject: string;
  slack: string; // Slack mrkdwn (for the DM)
  html: string; // email body
}

const SOURCE_EMOJI: Record<string, string> = { slack: '💬', jira: '🎫', gmail: '📧' };

function formatDate(now: Date): string {
  return now.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Slack (mrkdwn) ────────────────────────────────────────────────────────
function slackItem(it: BriefItemOut): string {
  const src = SOURCE_EMOJI[it.source] ?? '•';
  const lines = [`*${it.title}* ${src}`, it.summary];
  if (it.context) lines.push(`_Context:_ ${it.context}`);
  lines.push(`_Action:_ ${it.recommendedAction}`);
  if (it.link) lines.push(`<${it.link}|open>`);
  return lines.join('\n');
}

function slackBucket(heading: string, items: BriefItemOut[]): string {
  if (!items.length) return '';
  return `\n${heading}\n${items.map(slackItem).join('\n\n')}`;
}

function renderSlack(b: BriefOutput, dateStr: string, boardUnavailable: boolean): string {
  const parts: string[] = [`:sunny: *MORNING BRIEF — ${dateStr}*`];

  parts.push('\n*— Changed in the last 24h —*');
  const s1 = [
    slackBucket(':red_circle: *URGENT*', b.urgent),
    slackBucket(':large_yellow_circle: *IMPORTANT*', b.important),
    slackBucket(':white_circle: *Not important*', b.notImportant),
  ]
    .filter(Boolean)
    .join('\n');
  parts.push(s1 || '_No changes from others in the last 24h._');

  parts.push("\n:clipboard: *Today's board (EA · active sprint)*");
  if (boardUnavailable) {
    parts.push(':warning: _Board unavailable — could not fetch from Jira this run._');
  } else {
    parts.push(
      b.board.length
        ? b.board.map((r) => `• *${r.ticket}* — ${r.status}${r.recommendation ? ` — ${r.recommendation}` : ''}`).join('\n')
        : '_No active-sprint tickets._',
    );
  }

  return parts.join('\n');
}

// ── Email (HTML) ──────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlItem(it: BriefItemOut): string {
  const src = SOURCE_EMOJI[it.source] ?? '•';
  return [
    `<div style="margin:0 0 16px">`,
    `<div style="font-weight:600">${esc(it.title)} ${src}</div>`,
    `<div>${esc(it.summary)}</div>`,
    it.context ? `<div style="color:#555"><em>Context:</em> ${esc(it.context)}</div>` : '',
    `<div><em>Action:</em> ${esc(it.recommendedAction)}</div>`,
    it.link ? `<div><a href="${esc(it.link)}">open</a></div>` : '',
    `</div>`,
  ].join('');
}

function htmlBucket(title: string, color: string, items: BriefItemOut[]): string {
  if (!items.length) return '';
  return `<h4 style="margin:16px 0 8px;color:${color}">${title} (${items.length})</h4>${items
    .map(htmlItem)
    .join('')}`;
}

function renderHtml(b: BriefOutput, dateStr: string, boardUnavailable: boolean): string {
  const s1 =
    [
      htmlBucket('🔴 Urgent', '#c0392b', b.urgent),
      htmlBucket('🟡 Important', '#b9770e', b.important),
      htmlBucket('⚪ Not important', '#666', b.notImportant),
    ]
      .filter(Boolean)
      .join('') || '<p style="color:#666">No changes from others in the last 24h.</p>';

  const rows = b.board
    .map(
      (r) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><a href="https://anatta-io.atlassian.net/browse/${esc(
          r.ticket,
        )}">${esc(r.ticket)}</a></td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.status)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.recommendation)}</td></tr>`,
    )
    .join('');
  const table = boardUnavailable
    ? '<p style="color:#c0392b">⚠️ Board unavailable — could not fetch from Jira this run.</p>'
    : b.board.length
      ? `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
        `<thead><tr style="text-align:left;background:#f4f4f4">` +
        `<th style="padding:6px 10px">Ticket</th><th style="padding:6px 10px">Status</th><th style="padding:6px 10px">Recommendation</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`
      : '<p style="color:#666">No active-sprint tickets.</p>';

  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;color:#111">`,
    `<h2>☀️ Morning Brief — ${esc(dateStr)}</h2>`,
    `<h3 style="margin:24px 0 4px">Changed in the last 24h</h3>`,
    s1,
    `<h3 style="margin:28px 0 8px">📋 Today's Board (EA · active sprint)</h3>`,
    table,
    `</div>`,
  ].join('');
}

export interface RenderOptions {
  now?: Date;
  /** When true, the board couldn't be fetched — render "unavailable", not "empty". */
  boardUnavailable?: boolean;
}

/** Render a structured brief into subject + Slack mrkdwn + email HTML. */
export function renderBrief(brief: BriefOutput, opts: RenderOptions = {}): RenderedBrief {
  const { now = new Date(), boardUnavailable = false } = opts;
  const dateStr = formatDate(now);
  const urgentCount = brief.urgent.length;
  const subject =
    urgentCount > 0
      ? `☀️ Morning Brief — ${urgentCount} urgent — ${dateStr}`
      : `☀️ Morning Brief — ${dateStr}`;
  return {
    subject,
    slack: renderSlack(brief, dateStr, boardUnavailable),
    html: renderHtml(brief, dateStr, boardUnavailable),
  };
}
