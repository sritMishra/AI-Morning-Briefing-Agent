/**
 * STEP 1 — Resolve the look-back start ("since").
 *
 * Purpose:
 *   Decide the instant from which this run treats activity as "new". Everything
 *   that changed AFTER this timestamp is a candidate for Section 1 ("changed in
 *   the last 24h").
 *
 * Current behaviour:
 *   A fixed rolling 24-hour window. Once persistence lands, this will instead
 *   return the timestamp of the last successful brief (the `RunLog` watermark),
 *   making it a true "since last brief".
 *
 * Expected output:
 *   A `Date` — the start of the window.
 *
 * Example:
 *   const since = resolveWatermark();  // e.g. 2026-07-04T09:00:00Z if now is 07-05T09:00
 */
export function resolveWatermark(): Date {
  // TODO(persistence): read the last successful RunLog.watermark instead.
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}
