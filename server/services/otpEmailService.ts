/**
 * Production email delivery for signup OTP.
 * Firestore does NOT send email — only stores data.
 * This uses Resend (free tier) when RESEND_API_KEY is set.
 * Optional fallback: Gmail API if GMAIL_ACCESS_TOKEN is set.
 */
export type SendOtpEmailResult = {
  sent: boolean;
  provider?: 'resend' | 'gmail';
  error?: string;
};

export async function sendOtpEmail(params: {
  to: string;
  name: string;
  otp: string;
  gmailAccessToken?: string | null;
}): Promise<SendOtpEmailResult> {
  const { to, name, otp, gmailAccessToken } = params;
  const from =
    (process.env.OTP_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'Afflatus <onboarding@resend.dev>').trim();

  // 1) Resend (recommended for production)
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `Your Afflatus verification code: ${otp}`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
              <p style="font-size:12px;letter-spacing:2px;color:#E58B13;font-weight:700;">AFFLATUS</p>
              <h1 style="font-size:22px;margin:8px 0 16px;">Email verification</h1>
              <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
              <p>Your 6-digit verification code:</p>
              <p style="font-size:32px;font-weight:800;letter-spacing:8px;font-family:monospace;">${otp}</p>
              <p style="color:#666;font-size:13px;">Valid for 10 minutes. If you did not request this, ignore this email.</p>
            </div>
          `,
        }),
      });
      if (res.ok) return { sent: true, provider: 'resend' };
      const errBody = await res.text().catch(() => '');
      console.warn('[OTP email] Resend failed:', res.status, errBody.slice(0, 300));
      return { sent: false, provider: 'resend', error: `Resend HTTP ${res.status}` };
    } catch (err: any) {
      console.error('[OTP email] Resend error:', err?.message || err);
      return { sent: false, provider: 'resend', error: String(err?.message || err) };
    }
  }

  // 2) Optional Gmail API fallback
  const token =
    gmailAccessToken ||
    (process.env.GMAIL_ACCESS_TOKEN || '').trim() ||
    null;
  if (token) {
    try {
      const subject = `Your Afflatus Verification Code: ${otp}`;
      const htmlBody = `<p>Hello ${escapeHtml(name)},</p><p>Your code: <strong>${otp}</strong> (valid 10 minutes)</p>`;
      const rawMessage = [
        `To: ${to}`,
        `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=utf-8`,
        '',
        htmlBody,
      ].join('\r\n');
      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encodedMessage }),
      });
      if (gmailRes.ok) return { sent: true, provider: 'gmail' };
      const errJson = await gmailRes.json().catch(() => ({}));
      console.warn('[OTP email] Gmail failed:', errJson);
      return { sent: false, provider: 'gmail', error: 'Gmail API send failed' };
    } catch (err: any) {
      return { sent: false, provider: 'gmail', error: String(err?.message || err) };
    }
  }

  return {
    sent: false,
    error:
      'No email provider configured. Set RESEND_API_KEY (recommended) or GMAIL_ACCESS_TOKEN on the Engine service.',
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Production = never return OTP in API JSON */
export function shouldExposeOtpInResponse(): boolean {
  if (process.env.ALLOW_OTP_PREVIEW === 'true') return true;
  if (process.env.NODE_ENV === 'production') return false;
  // local default: allow preview only when explicitly enabled
  return process.env.ALLOW_OTP_PREVIEW === 'true';
}
