import { logger } from './lib/logger.js';
import { runBrief } from './pipeline/runBrief.js';

/**
 * One-shot entrypoint for scheduled runs (e.g. GitHub Actions). Runs the whole
 * briefing pipeline ONCE and exits — no always-on server or in-process cron
 * needed. Exit code 1 on failure so the CI run is marked failed.
 *
 * Local dev still uses `npm run dev` (Express + node-cron + dashboard); this is
 * purely for the unattended scheduled run.
 */
async function main(): Promise<void> {
  const result = await runBrief();
  logger.info(
    {
      status: result.status,
      itemCount: result.itemCount,
      delivered: result.delivered,
      errors: result.errors,
    },
    'Brief run finished (CLI)',
  );
  process.exit(result.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err }, 'Brief run crashed (CLI)');
  process.exit(1);
});
