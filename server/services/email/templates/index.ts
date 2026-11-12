import { escapeHtml, sanitizeHeaderValue } from '../htmlEscape';
import type { EmailTemplateId, RenderedEmail } from '../types';

function baseLayout(params: {
  title: string;
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const brand = escapeHtml(process.env.EMAIL_FROM_NAME || 'Afflatus');
  const cta =
    params.ctaLabel && params.ctaUrl
      ? `<p style="margin:28px 0 8px;">
          <a href="${escapeHtml(params.ctaUrl)}"
             style="display:inline-block;background:#E58B13;color:#111;text-decoration:none;
                    font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;">
            ${escapeHtml(params.ctaLabel)}
          </a>
        </p>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f10;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f10;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#1a1a1d;border:1px solid #2a2a2e;border-radius:16px;padding:28px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#E58B13;font-weight:700;">${brand.toUpperCase()}</p>
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#f5f5f5;">${escapeHtml(params.title)}</h1>
              <div style="color:#c8c8cc;font-size:15px;line-height:1.55;">
                ${params.bodyHtml}
              </div>
              ${cta}
              <hr style="border:none;border-top:1px solid #2a2a2e;margin:28px 0 16px;" />
              <p style="margin:0;font-size:12px;color:#888;">
                You received this email because of activity on your Afflatus account.
                This is a transactional message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function appUrl(path = '/'): string {
  const base = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return path.startsWith('http') ? path : '#';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function renderTemplate(
  templateId: EmailTemplateId,
  data: Record<string, string>
): RenderedEmail {
  const d = Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, sanitizeHeaderValue(v)])
  );

  switch (templateId) {
    case 'join_application_admin': {
      const name = d.applicantName || 'Applicant';
      const email = d.applicantEmail || '';
      const message = d.message || '(no message)';
      const reviewUrl = d.reviewUrl || appUrl('/');
      const subject = `New Afflatus join application: ${name}`;
      const bodyHtml = `
        <p>A new creator has requested to join Afflatus.</p>
        <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
           <strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong><br/>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`;
      const text = `New Afflatus join application\n\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}\n\nReview: ${reviewUrl}`;
      return {
        subject,
        html: baseLayout({
          title: 'New join application',
          preheader: `${name} applied to join Afflatus`,
          bodyHtml,
          ctaLabel: 'Open Afflatus',
          ctaUrl: reviewUrl,
        }),
        text,
      };
    }
    case 'join_application_approved': {
      const name = d.applicantName || 'there';
      const accessUrl = d.accessUrl || appUrl('/');
      const subject = 'Your Afflatus application was approved';
      const bodyHtml = `
        <p>Hello ${escapeHtml(name)},</p>
        <p>Good news — your request to join Afflatus has been <strong>approved</strong>.</p>
        <p>Sign in to complete your profile and start collaborating with other creators.</p>`;
      const text = `Hello ${name},\n\nYour Afflatus application was approved.\n\nSign in: ${accessUrl}`;
      return {
        subject,
        html: baseLayout({
          title: 'Application approved',
          preheader: 'Welcome to Afflatus',
          bodyHtml,
          ctaLabel: 'Enter Afflatus',
          ctaUrl: accessUrl,
        }),
        text,
      };
    }
    case 'join_application_rejected': {
      const name = d.applicantName || 'there';
      const subject = 'Update on your Afflatus application';
      const bodyHtml = `
        <p>Hello ${escapeHtml(name)},</p>
        <p>Thank you for your interest in Afflatus. After review, we are unable to approve your application at this time.</p>
        <p>You may contact the team if you believe this decision was made in error.</p>`;
      const text = `Hello ${name},\n\nThank you for your interest in Afflatus. We are unable to approve your application at this time.`;
      return {
        subject,
        html: baseLayout({
          title: 'Application update',
          preheader: 'Update on your Afflatus application',
          bodyHtml,
        }),
        text,
      };
    }
    case 'connection_request': {
      const fromName = d.fromName || 'A creator';
      const url = d.actionUrl || appUrl('/');
      const subject = `${fromName} sent you a connection request on Afflatus`;
      const bodyHtml = `
        <p><strong>${escapeHtml(fromName)}</strong> would like to connect with you on Afflatus.</p>
        <p>${escapeHtml(d.message || '')}</p>`;
      const text = `${fromName} sent you a connection request on Afflatus.\n\n${d.message || ''}\n\n${url}`;
      return {
        subject,
        html: baseLayout({
          title: 'New connection request',
          preheader: subject,
          bodyHtml,
          ctaLabel: 'View request',
          ctaUrl: url,
        }),
        text,
      };
    }
    case 'connection_accepted': {
      const fromName = d.fromName || 'A creator';
      const url = d.actionUrl || appUrl('/');
      const subject = `${fromName} accepted your connection on Afflatus`;
      const bodyHtml = `<p><strong>${escapeHtml(fromName)}</strong> accepted your connection request.</p>`;
      const text = `${fromName} accepted your connection on Afflatus.\n\n${url}`;
      return {
        subject,
        html: baseLayout({
          title: 'Connection accepted',
          preheader: subject,
          bodyHtml,
          ctaLabel: 'Open messages',
          ctaUrl: url,
        }),
        text,
      };
    }
    case 'connection_declined': {
      const fromName = d.fromName || 'A creator';
      const subject = `Connection update on Afflatus`;
      const bodyHtml = `<p>Your connection request to <strong>${escapeHtml(fromName)}</strong> was declined.</p>`;
      const text = `Your connection request to ${fromName} was declined.`;
      return {
        subject,
        html: baseLayout({
          title: 'Connection declined',
          preheader: subject,
          bodyHtml,
        }),
        text,
      };
    }
    case 'message_request': {
      const fromName = d.fromName || 'A creator';
      const url = d.actionUrl || appUrl('/');
      const subject = `${fromName} sent you a message request on Afflatus`;
      const bodyHtml = `
        <p><strong>${escapeHtml(fromName)}</strong> sent you a message request.</p>
        <p>${escapeHtml(d.preview || '')}</p>`;
      const text = `${fromName} sent you a message request.\n\n${d.preview || ''}\n\n${url}`;
      return {
        subject,
        html: baseLayout({
          title: 'Message request',
          preheader: subject,
          bodyHtml,
          ctaLabel: 'Open Afflatus',
          ctaUrl: url,
        }),
        text,
      };
    }
    default: {
      const _exhaustive: never = templateId;
      throw new Error(`Unknown email template: ${_exhaustive}`);
    }
  }
}
