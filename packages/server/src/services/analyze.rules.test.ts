import { describe, expect, it } from 'vitest';

import type { BriefOutput } from '../types/index.js';
import { enforceBlockedNotUrgent, enforceDueDateUrgent } from './analyze.service.js';

const base: BriefOutput = {
  urgent: [
    {
      title: 'EA-2028: Custom Events',
      source: 'jira',
      summary: 'Overdue and blocked.',
      recommendedAction: 'Review.',
      link: 'https://anatta-io.atlassian.net/browse/EA-2028',
    },
    {
      title: 'EA-9999: Genuinely urgent',
      source: 'jira',
      summary: 'A real urgent, not blocked.',
      recommendedAction: 'Act.',
      link: 'https://anatta-io.atlassian.net/browse/EA-9999',
    },
  ],
  important: [],
  notImportant: [],
  board: [],
};

describe('enforceBlockedNotUrgent', () => {
  it('moves blocked tickets out of urgent into important, keeps non-blocked', () => {
    const out = enforceBlockedNotUrgent(base, new Set(['EA-2028']));

    expect(out.urgent.map((u) => u.title)).toEqual(['EA-9999: Genuinely urgent']);
    expect(out.important.some((i) => i.title.includes('EA-2028'))).toBe(true);
  });

  it('is a no-op when nothing is blocked', () => {
    const out = enforceBlockedNotUrgent(base, new Set());
    expect(out.urgent).toHaveLength(2);
  });
});

describe('enforceDueDateUrgent', () => {
  const brief: BriefOutput = {
    urgent: [],
    important: [
      {
        title: 'EA-2843: [Test] - Ticket',
        source: 'jira',
        summary: 'Due date set to today.',
        recommendedAction: 'Review.',
        link: 'https://anatta-io.atlassian.net/browse/EA-2843',
      },
    ],
    notImportant: [
      {
        title: 'EA-1000: Something',
        source: 'jira',
        summary: 'No due date.',
        recommendedAction: 'None.',
      },
    ],
    board: [],
  };

  it('promotes a due-today ticket into urgent from wherever the LLM put it', () => {
    const out = enforceDueDateUrgent(brief, new Set(['EA-2843']));
    expect(out.urgent.some((u) => u.title.includes('EA-2843'))).toBe(true);
    expect(out.important.some((i) => i.title.includes('EA-2843'))).toBe(false);
    expect(out.notImportant.some((i) => i.title.includes('EA-1000'))).toBe(true);
  });
});
