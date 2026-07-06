import { Resend } from 'resend';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { RenderedBrief } from './render.service.js';

/**
 * Email delivery via Resend (a transactional email API).
 *
 * Why Resend: it behaves identically in local dev and after deployment — it's
 * just an HTTPS call authenticated by an API key (one env var), with managed
 * deliverability (SPF/DKIM). Personal Gmail SMTP is fragile for automated app
 * mail and app passwords are being phased out, so we don't use it.
 */

export interface DeliverResult {
  delivered: boolean;
  id?: string; // Resend message id (on success)
  error?: string;
}

/** Is email delivery configured (do we have a key + a recipient)? */
export function emailConfigured(): boolean {
  return !!env.RESEND_API_KEY && !!env.BRIEF_TO_EMAIL;
}

let client: Resend | null = null;
function resend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

/**
 * STEP 8 (delivery) — email the rendered brief to my inbox.
 *
 * Purpose:
 *   Send the rendered brief (subject + HTML) to BRIEF_TO_EMAIL via Resend.
 *   Sender defaults to Resend's test address (works with no DNS setup when the
 *   recipient is the account owner); set BRIEF_FROM_EMAIL to a verified-domain
 *   address for production.
 *
 * Expected output:
 *   `{ delivered, id?, error? }` — delivered=true + message id on success;
 *   delivered=false (+ error) on failure or when not configured. Never throws.
 */
export async function deliverBriefEmail(rendered: RenderedBrief): Promise<DeliverResult> {
  const c = resend();
  if (!c || !env.BRIEF_TO_EMAIL) {
    logger.info('Email not configured (RESEND_API_KEY / BRIEF_TO_EMAIL) — skipping delivery');
    return { delivered: false };
  }

  const from = env.BRIEF_FROM_EMAIL || 'Morning Brief <onboarding@resend.dev>';
  try {
    const { data, error } = await c.emails.send({
      from,
      to: env.BRIEF_TO_EMAIL,
      subject: rendered.subject,
      html: rendered.html,
    });
    if (error) throw new Error(error.message ?? String(error));

    logger.info({ id: data?.id, to: env.BRIEF_TO_EMAIL }, 'Brief email delivered');
    return { delivered: true, id: data?.id };
  } catch (err) {
    const msg = `Email delivery failed: ${String(err instanceof Error ? err.message : err)}`;
    logger.error({ err }, msg);
    return { delivered: false, error: msg };
  }
}
