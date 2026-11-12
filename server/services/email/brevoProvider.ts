/**
 * Brevo transactional email provider adapter.
 * Business logic must not depend on Brevo-specific types.
 */
import type { ProviderSendResult, RenderedEmail } from './types';
import { sanitizeHeaderValue } from './htmlEscape';

export function isBrevoConfigured(): boolean {
  return Boolean((process.env.BREVO_API_KEY || '').trim());
}

function getApiKey(): string {
  return (process.env.BREVO_API_KEY || '').trim();
}

function getSender(): { email: string; name: string } {
  const email = (process.env.EMAIL_FROM || '').trim();
  const name = (process.env.EMAIL_FROM_NAME || 'Afflatus').trim();
  return { email, name };
}

/**
 * Send a transactional email via Brevo REST API.
 * Uses fetch to avoid hard failure when SDK is not installed in test stubs.
 * Prefer @getbrevo/brevo when available.
 */
export async function sendViaBrevo(params: {
  toEmail: string;
  toName?: string;
  rendered: RenderedEmail;
  tags?: string[];
}): Promise<ProviderSendResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      accepted: false,
      error: 'BREVO_API_KEY is not configured',
      retryable: false,
      statusCode: 0,
    };
  }

  const sender = getSender();
  if (!sender.email) {
    return {
      accepted: false,
      error: 'EMAIL_FROM is not configured',
      retryable: false,
      statusCode: 0,
    };
  }

  const toEmail = sanitizeHeaderValue(params.toEmail).toLowerCase();
  if (!toEmail || !toEmail.includes('@')) {
    return {
      accepted: false,
      error: 'Invalid recipient email',
      retryable: false,
      statusCode: 400,
    };
  }

  const body = {
    sender: { email: sender.email, name: sender.name },
    to: [{ email: toEmail, name: sanitizeHeaderValue(params.toName || toEmail) }],
    subject: sanitizeHeaderValue(params.rendered.subject).slice(0, 200),
    htmlContent: params.rendered.html,
    textContent: params.rendered.text,
    tags: params.tags?.slice(0, 10) || ['afflatus-transactional'],
  };

  try {
    // Prefer official SDK when installed
    try {
      const mod = await import('@getbrevo/brevo');
      const BrevoClient = (mod as any).BrevoClient || (mod as any).default?.BrevoClient;
      if (BrevoClient) {
        const client = new BrevoClient({ apiKey });
        const result = await client.transactionalEmails.sendTransacEmail(body);
        const messageId = result?.messageId || result?.body?.messageId;
        return { accepted: true, messageId: messageId ? String(messageId) : undefined };
      }
    } catch {
      // Fall through to REST
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text().catch(() => '');
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }

    if (res.ok) {
      return {
        accepted: true,
        messageId: json?.messageId ? String(json.messageId) : undefined,
        statusCode: res.status,
      };
    }

    const retryable = res.status === 429 || res.status >= 500;
    return {
      accepted: false,
      error: json?.message || `Brevo HTTP ${res.status}`,
      retryable,
      statusCode: res.status,
    };
  } catch (err: any) {
    return {
      accepted: false,
      error: String(err?.message || err || 'Brevo request failed'),
      retryable: true,
    };
  }
}
