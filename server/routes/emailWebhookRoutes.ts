/**
 * Brevo webhook + internal email worker trigger.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { updateJobStatusByProviderMessageId } from '../services/email/emailQueue';
import { processEmailBatch } from '../services/email/emailWorker';
import type { EmailJobStatus } from '../services/email/types';

export const emailWebhookRoutes = Router();

function mapBrevoEvent(event: string): EmailJobStatus | null {
  const e = String(event || '').toLowerCase();
  if (e === 'delivered' || e === 'unique_opened' || e === 'opened') return 'delivered';
  if (e === 'request' || e === 'sent' || e === 'deferred') return 'accepted';
  if (e === 'hard_bounce' || e === 'soft_bounce' || e === 'bounce') return 'bounced';
  if (e === 'blocked' || e === 'invalid_email') return 'blocked';
  if (e === 'spam' || e === 'complaint') return 'blocked';
  if (e === 'error') return 'failed';
  return null;
}

/**
 * POST /api/email/webhooks/brevo
 * Configure the same path in Brevo dashboard.
 * Optional shared secret: EMAIL_WEBHOOK_SECRET via header x-email-webhook-secret
 * or query ?secret=
 */
emailWebhookRoutes.post('/email/webhooks/brevo', async (req: Request, res: Response) => {
  try {
    const secret = process.env.EMAIL_WEBHOOK_SECRET || '';
    if (secret) {
      const provided =
        (typeof req.headers['x-email-webhook-secret'] === 'string' &&
          req.headers['x-email-webhook-secret']) ||
        (typeof req.query.secret === 'string' ? req.query.secret : '') ||
        '';
      if (provided !== secret) {
        return res.status(401).json({ error: 'Unauthorized webhook' });
      }
    }

    const payload = Array.isArray(req.body) ? req.body : [req.body];
    let updated = 0;

    for (const item of payload) {
      if (!item || typeof item !== 'object') continue;
      const messageId = String(
        item['message-id'] || item.messageId || item['message_id'] || ''
      ).trim();
      const event = String(item.event || item.eventName || '');
      const status = mapBrevoEvent(event);
      if (!messageId || !status) continue;

      const ok = await updateJobStatusByProviderMessageId(messageId, status, {
        lastWebhookEvent: event,
        lastWebhookAt: new Date().toISOString(),
      });
      if (ok) updated += 1;
    }

    return res.json({ ok: true, updated });
  } catch (err: any) {
    console.error('[email webhook]', err?.message || err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * POST /api/internal/email/process
 * Protected cron endpoint for hosts that sleep (Render free tier, etc.).
 */
emailWebhookRoutes.post('/internal/email/process', async (req: Request, res: Response) => {
  const expected = process.env.INTERNAL_AI_SERVICE_SECRET || process.env.EMAIL_INTERNAL_SECRET || '';
  const provided =
    (typeof req.headers['x-internal-secret'] === 'string' && req.headers['x-internal-secret']) ||
    '';
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await processEmailBatch();
  return res.json({ ok: true, ...result });
});
