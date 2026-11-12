/**
 * High-level email notification API used by routes/services.
 * Resolves recipients from trusted data and enqueues jobs.
 */
import { enqueueEmailJob } from './emailQueue';
import type { EmailEventType, EmailTemplateId, EnqueueEmailInput } from './types';
import { isFirebaseAdminReady, getAdminDb } from '../firebaseAdmin';

function adminEmailsFromEnv(): string[] {
  const raw =
    process.env.AFFLATUS_ADMIN_EMAILS ||
    process.env.ADMIN_EMAILS ||
    '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Server-side admin check (email allowlist from env). */
export function isAdminEmailServer(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmailsFromEnv();
  if (!list.length) {
    // Fallback: single known bootstrap admin (must stay in sync with firestore.rules)
    list.push(
      'divyasharmagdscoist@gmail.com',
      'devbhagat383@gmail.com',
      'akshayadoffical@gmail.com',
      'dhruvbhardwaj401@gmail.com',
    );
  }
  return list.includes(email.trim().toLowerCase());
}

export async function getUserEmailById(
  userId: string
): Promise<{ email: string; name: string } | null> {
  if (!isFirebaseAdminReady() || !userId) return null;
  const snap = await getAdminDb().collection('users').doc(userId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) return null;
  return { email, name: String(data.name || email.split('@')[0] || 'User') };
}

async function enqueueSafe(input: EnqueueEmailInput): Promise<{ created: boolean; id: string } | null> {
  try {
    if (!input.recipientEmail) {
      console.warn('[emailNotification] skip — empty recipient', input.eventType);
      return null;
    }
    const { job, created } = await enqueueEmailJob(input);
    return { created, id: job.id };
  } catch (err: any) {
    console.error('[emailNotification] enqueue failed', input.eventType, err?.message || err);
    return null;
  }
}

export async function notifyAdminsNewApplication(params: {
  applicantUserId: string;
  applicantName: string;
  applicantEmail: string;
  message: string;
}): Promise<void> {
  const emails = adminEmailsFromEnv();
  if (!emails.length) {
    emails.push(
      'divyasharmagdscoist@gmail.com',
      'devbhagat383@gmail.com',
      'akshayadoffical@gmail.com',
      'dhruvbhardwaj401@gmail.com',
    );
  }
  const appUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '') || '';
  const reviewUrl = appUrl || '#';

  for (const adminEmail of emails) {
    // Prefer matching admin user doc; fall back to synthetic id
    let recipientUserId = `admin:${adminEmail}`;
    try {
      if (isFirebaseAdminReady()) {
        const q = await getAdminDb()
          .collection('users')
          .where('email', '==', adminEmail)
          .limit(1)
          .get();
        if (!q.empty) recipientUserId = q.docs[0].id;
      }
    } catch {
      /* ignore */
    }

    await enqueueSafe({
      eventType: 'join_application_submitted',
      recipientUserId,
      recipientEmail: adminEmail,
      templateId: 'join_application_admin',
      templateData: {
        applicantName: params.applicantName,
        applicantEmail: params.applicantEmail,
        message: params.message || '',
        reviewUrl,
      },
      idempotencyKey: `join_application_submitted:${params.applicantUserId}:${adminEmail}`,
    });
  }
}

export async function notifyApplicantDecision(params: {
  applicantUserId: string;
  decision: 'approved' | 'rejected';
}): Promise<void> {
  const user = await getUserEmailById(params.applicantUserId);
  if (!user) {
    console.warn('[emailNotification] applicant email missing', params.applicantUserId);
    return;
  }
  const appUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '') || '';
  const eventType: EmailEventType =
    params.decision === 'approved'
      ? 'join_application_approved'
      : 'join_application_rejected';
  const templateId: EmailTemplateId =
    params.decision === 'approved'
      ? 'join_application_approved'
      : 'join_application_rejected';

  await enqueueSafe({
    eventType,
    recipientUserId: params.applicantUserId,
    recipientEmail: user.email,
    templateId,
    templateData: {
      applicantName: user.name,
      accessUrl: appUrl || '#',
    },
    idempotencyKey: `${eventType}:${params.applicantUserId}`,
  });
}

export async function notifyConnectionEvent(params: {
  eventType: 'connection_request' | 'connection_accepted' | 'connection_declined' | 'message_request';
  recipientUserId: string;
  fromName: string;
  message?: string;
  preview?: string;
  connectionId?: string;
}): Promise<void> {
  const user = await getUserEmailById(params.recipientUserId);
  if (!user) return;
  const appUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '') || '';
  const templateId = params.eventType as EmailTemplateId;
  await enqueueSafe({
    eventType: params.eventType,
    recipientUserId: params.recipientUserId,
    recipientEmail: user.email,
    templateId,
    templateData: {
      fromName: params.fromName,
      message: params.message || '',
      preview: params.preview || '',
      actionUrl: appUrl || '#',
    },
    idempotencyKey: `${params.eventType}:${params.connectionId || 'x'}:${params.recipientUserId}`,
  });
}
