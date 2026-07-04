import type { Request, Response } from 'express';

import { logger } from '../lib/logger.js';
import { runBrief } from '../pipeline/runBrief.js';

/**
 * Manual "run the brief now" trigger — the same pipeline the scheduler fires,
 * exposed so we can test on demand from the dashboard without waiting for 10:15.
 * Read-only analyser, so this is safe to invoke anytime.
 */
export async function runBriefNow(_req: Request, res: Response): Promise<void> {
  try {
    const result = await runBrief();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, 'Manual brief run failed');
    res.status(500).json({ ok: false, error: String(err) });
  }
}
