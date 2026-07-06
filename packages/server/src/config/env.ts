import 'dotenv/config';

import { z } from 'zod';

/**
 * Central, validated configuration. We parse process.env ONCE here with Zod so
 * the rest of the app gets a typed, guaranteed-present config object — and the
 * server fails fast on boot if something required is missing.
 *
 * Note: connector secrets (Slack/Jira/Gmail/Resend) are optional at this
 * scaffold stage so the server boots before every integration is wired. We
 * tighten these to required as each Phase-1 connector lands.
 */
const schema = z.object({
  // Server
  PORT: z.coerce.number().default(4400),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  // Scheduling
  BRIEF_CRON: z.string().default('15 10 * * *'),
  BRIEF_TZ: z.string().default('Asia/Kolkata'),
  // Look-back window in hours (default 24). A build-time knob for testing with
  // a wider window; superseded by the real RunLog watermark once persistence lands.
  BRIEF_LOOKBACK_HOURS: z.coerce.number().default(24),

  // Database
  DATABASE_URL: z.string().optional(),

  // LLM
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_MODEL_FAST: z.string().default('gpt-4o-mini'),
  LLM_MODEL_SMART: z.string().default('gpt-4o'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Slack
  SLACK_USER_TOKEN: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_DM_TARGET_USER_ID: z.string().optional(),
  SLACK_PROJECT_CHANNELS: z.string().default(''),

  // Jira
  JIRA_BASE_URL: z.string().default('https://anatta-io.atlassian.net'),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  // Optional — auto-resolved from the site if omitted. Scoped tokens route via
  // https://api.atlassian.com/ex/jira/{cloudId}.
  JIRA_CLOUD_ID: z.string().optional(),
  JIRA_PROJECT_KEYS: z.string().default('EA'),
  JIRA_BOARD_ID: z.coerce.number().optional(),

  // Gmail
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_MAX_UNREAD_PER_RUN: z.coerce.number().default(25),

  // Email delivery
  RESEND_API_KEY: z.string().optional(),
  BRIEF_FROM_EMAIL: z.string().optional(),
  BRIEF_TO_EMAIL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Convenience: parsed list of Slack channel IDs to watch. */
export const slackProjectChannels = env.SLACK_PROJECT_CHANNELS.split(',')
  .map((c) => c.trim())
  .filter(Boolean);

/** Convenience: parsed list of Jira project keys. */
export const jiraProjectKeys = env.JIRA_PROJECT_KEYS.split(',')
  .map((k) => k.trim())
  .filter(Boolean);
