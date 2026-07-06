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
  /** True if this item is blocked — used to deterministically keep it out of urgent. */
  blocked?: boolean;
  /** True if due today or already past — used to deterministically force it urgent. */
  dueUrgent?: boolean;
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

/**
 * SECTION 2 — board table row. Status is deterministic (set from Jira in code);
 * only `recommendation` is written by the LLM.
 */
export const boardRowSchema = z.object({
  ticket: z.string(),
  status: z.string(),
  recommendation: z.string(),
});
export type BoardRow = z.infer<typeof boardRowSchema>;

/**
 * What the LLM returns via generateObject:
 *  - Section 1: changed-in-24h tickets categorised urgent/important/notImportant.
 *  - `boardRecommendations`: one recommendation per active-sprint ticket (keyed
 *    by ticket) — merged with deterministic status in code to build the table.
 */
export const analysisOutputSchema = z.object({
  urgent: z.array(briefItemOutputSchema),
  important: z.array(briefItemOutputSchema),
  notImportant: z.array(briefItemOutputSchema),
  boardRecommendations: z.array(z.object({ ticket: z.string(), recommendation: z.string() })),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

/** The full brief: Section 1 (categorised changes) + Section 2 (board table). */
export interface BriefOutput {
  urgent: z.infer<typeof briefItemOutputSchema>[];
  important: z.infer<typeof briefItemOutputSchema>[];
  notImportant: z.infer<typeof briefItemOutputSchema>[];
  board: BoardRow[];
}
