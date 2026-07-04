import { z } from 'zod';

/** Where a briefing item came from. */
export type Source = 'slack' | 'jira' | 'gmail';

/** Priority buckets used throughout the pipeline and the rendered brief. */
export type Priority = 'urgent' | 'important' | 'fyi' | 'skip';

/**
 * The common shape every connector normalises its raw data into, so the
 * analysis pipeline is source-agnostic.
 */
export interface BriefItem {
  source: Source;
  type: string; // e.g. 'mention', 'ticket', 'thread', 'email'
  externalId: string; // stable id for dedupe (channel:ts, ticket key, message id)
  title: string;
  url?: string;
  rawContext: string; // the text we feed the LLM
  lastActivityTs: string; // ISO
  participants?: string[];
}

/** Zod schema for the LLM's structured brief output (used with generateObject). */
export const briefItemOutputSchema = z.object({
  title: z.string(),
  source: z.enum(['slack', 'jira', 'gmail']),
  summary: z.string().describe('1-2 sentence "what happened"'),
  context: z.string().optional().describe('brief history so I need not re-read everything'),
  recommendedAction: z.string().describe('specific suggestion; the user makes the final call'),
  link: z.string().optional(),
});

export const briefOutputSchema = z.object({
  urgent: z.array(briefItemOutputSchema),
  important: z.array(briefItemOutputSchema),
  fyi: z.array(z.string()).describe('one-liners, including counts of filtered items'),
  jiraBoard: z.object({
    inProgress: z.array(z.string()),
    blocked: z.array(z.string()),
    dueSoon: z.array(z.string()),
    newToday: z.array(z.string()),
  }),
  recommendations: z
    .array(z.object({ task: z.string(), reason: z.string() }))
    .describe('suggested priority order for the day'),
});

export type BriefOutput = z.infer<typeof briefOutputSchema>;
