import cron from 'node-cron';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { runBrief } from './pipeline/runBrief.js';

/**
 * Schedules the daily briefing run (default 10:15 AM, BRIEF_TZ timezone).
 * In-process on the always-on Express service — simplest reliable option for a
 * single daily job. Can be split into a dedicated Railway cron job later.
 */
export function startScheduler(): void {
  if (!cron.validate(env.BRIEF_CRON)) {
    logger.error({ cron: env.BRIEF_CRON }, 'Invalid BRIEF_CRON expression — scheduler not started');
    return;
  }

  cron.schedule(
    env.BRIEF_CRON,
    () => {
      logger.info('Scheduled trigger fired');
      runBrief().catch((err) => logger.error({ err }, 'Scheduled brief run failed'));
    },
    { timezone: env.BRIEF_TZ },
  );

  logger.info({ cron: env.BRIEF_CRON, tz: env.BRIEF_TZ }, 'Briefing scheduler started');
}
