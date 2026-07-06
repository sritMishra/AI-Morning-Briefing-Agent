import { env } from '../../config/env.js';

/**
 * STEP 1 — Resolve the look-back start ("since").
 *
 * Purpose:
 *   Decide the instant from which this run treats activity as "new". Everything
 *   that changed AFTER this timestamp is a candidate for Section 1 ("changed in
 *   the last 24h").
 *
 * Current behaviour:
 *   A rolling window of BRIEF_LOOKBACK_HOURS hours (default 24), configurable
 *   via env for testing. Once persistence lands, this will instead return the
 *   timestamp of the last successful brief (the `RunLog` watermark).
 *
 * Expected output:
 *   A `Date` — the start of the window.
 *
 * Example:
 *   const since = resolveWatermark();  // now - BRIEF_LOOKBACK_HOURS
 */
export function resolveWatermark(): Date {
  // TODO(persistence): read the last successful RunLog.watermark instead.
  return new Date(Date.now() - env.BRIEF_LOOKBACK_HOURS * 60 * 60 * 1000);
}
