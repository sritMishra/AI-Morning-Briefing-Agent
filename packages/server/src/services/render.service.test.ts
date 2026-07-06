import { describe, expect, it } from 'vitest';

import type { BriefOutput } from '../types/index.js';
import { renderBrief } from './render.service.js';

const mockBrief: BriefOutput = {
  urgent: [
    {
      title: 'EA-2729: Middleware Proxy App',
      source: 'jira',
      summary: 'Ekansh asked you to confirm the proxy auth approach.',
      context: 'Auth was the open question after the sprint move.',
      recommendedAction: 'Reply with the chosen auth approach so dev can proceed.',
      link: 'https://anatta-io.atlassian.net/browse/EA-2729',
    },
  ],
  important: [],
  notImportant: [],
  board: [
    { ticket: 'EA-2729', status: 'Dev In Progress', recommendation: 'On track — continue' },
    { ticket: 'EA-2029', status: 'Dev To Do', recommendation: 'Overdue & blocked — chase the blocker' },
  ],
};

describe('renderBrief', () => {
  const fixedDate = new Date('2026-07-04T10:15:00Z');
  const out = renderBrief(mockBrief, { now: fixedDate });

  it('subject flags the urgent count', () => {
    expect(out.subject).toContain('1 urgent');
  });

  it('slack output includes the urgent item, action, and the board', () => {
    expect(out.slack).toContain('MORNING BRIEF');
    expect(out.slack).toContain('EA-2729');
    expect(out.slack).toContain('Action:');
    expect(out.slack).toContain("Today's board");
  });

  it('html output includes both sections and the board table', () => {
    expect(out.html).toContain('Morning Brief');
    expect(out.html).toContain('Urgent');
    expect(out.html).toContain("Today's Board");
    expect(out.html).toContain('<table');
    expect(out.html).toContain('Overdue &amp; blocked — chase the blocker');
  });

  it('shows "board unavailable" (not "no tickets") when the fetch failed', () => {
    const failed = renderBrief(mockBrief, { now: fixedDate, boardUnavailable: true });
    expect(failed.html).toContain('Board unavailable');
    expect(failed.html).not.toContain('<table');
    expect(failed.slack).toContain('Board unavailable');
  });
});
