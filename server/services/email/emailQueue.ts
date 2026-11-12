/**
 * Firestore-backed email job queue with transactional claiming and leases.
 */
import { getAdminDb, isFirebaseAdminReady } from '../firebaseAdmin';
import type { EmailJob, EmailJobStatus, EnqueueEmailInput } from './types';

const COLLECTION = 'emailJobs';
const DEFAULT_MAX_ATTEMPTS = 5;
const LEASE_MS = 90_000;

function nowIso(): string {
  return new Date().toISOString();
}

function jobRef(id: string) {
  return getAdminDb().collection(COLLECTION).doc(id);
}

/** Deterministic doc id from idempotency key (safe for Firestore). */
export function jobIdFromIdempotencyKey(key: string): string {
  const cleaned = String(key || '')
    .replace(/[^a-zA-Z0-9_\-.:]/g, '_')
    .slice(0, 700);
  return cleaned || `job_${Date.now()}`;
}

export async function enqueueEmailJob(input: EnqueueEmailInput): Promise<{
  job: EmailJob;
  created: boolean;
}> {
  if (!isFirebaseAdminReady()) {
    throw new Error('Firebase Admin is required to enqueue email jobs');
  }

  const id = jobIdFromIdempotencyKey(input.idempotencyKey);
  const ref = jobRef(id);
  const db = getAdminDb();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = { id: snap.id, ...(snap.data() as object) } as EmailJob;
      return { job: existing, created: false };
    }

    const ts = nowIso();
    const job: EmailJob = {
      id,
      eventType: input.eventType,
      recipientUserId: input.recipientUserId,
      recipientEmail: String(input.recipientEmail || '').trim().toLowerCase(),
      templateId: input.templateId,
      templateData: input.templateData || {},
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: ts,
      createdAt: ts,
      updatedAt: ts,
      idempotencyKey: input.idempotencyKey,
    };

    tx.set(ref, job);
    return { job, created: true };
  });

  return result;
}

export function computeBackoffMs(attempts: number): number {
  const base = Math.min(60 * 60 * 1000, 1000 * Math.pow(2, Math.max(0, attempts)));
  const jitter = Math.floor(Math.random() * 1000);
  return base + jitter;
}

/**
 * Atomically claim up to `limit` jobs that are pending (or lease-expired processing).
 */
export async function claimEmailJobs(limit = 5): Promise<EmailJob[]> {
  if (!isFirebaseAdminReady()) return [];
  const db = getAdminDb();
  const now = Date.now();
  const nowIsoStr = new Date(now).toISOString();
  const claimed: EmailJob[] = [];

  // Pending due jobs
  let pendingSnap;
  try {
    pendingSnap = await db
      .collection(COLLECTION)
      .where('status', '==', 'pending')
      .where('nextAttemptAt', '<=', nowIsoStr)
      .orderBy('nextAttemptAt', 'asc')
      .limit(limit * 2)
      .get();
  } catch {
    // Index may be missing — fall back to status-only scan
    pendingSnap = await db
      .collection(COLLECTION)
      .where('status', '==', 'pending')
      .limit(40)
      .get();
  }

  // Abandoned processing (expired lease)
  let abandonedSnap;
  try {
    abandonedSnap = await db
      .collection(COLLECTION)
      .where('status', '==', 'processing')
      .where('leaseExpiresAt', '<=', nowIsoStr)
      .limit(limit)
      .get();
  } catch {
    abandonedSnap = await db
      .collection(COLLECTION)
      .where('status', '==', 'processing')
      .limit(20)
      .get();
  }

  const candidates = [
    ...pendingSnap.docs,
    ...abandonedSnap.docs.filter((d) => {
      const lease = (d.data() as EmailJob).leaseExpiresAt;
      return lease && lease <= nowIsoStr;
    }),
  ];

  for (const doc of candidates) {
    if (claimed.length >= limit) break;
    const ref = doc.ref;
    try {
      const job = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const data = snap.data() as EmailJob;
        const leaseOk =
          data.status === 'pending' ||
          (data.status === 'processing' &&
            data.leaseExpiresAt &&
            data.leaseExpiresAt <= nowIsoStr);
        if (!leaseOk) return null;
        if (data.status === 'pending' && data.nextAttemptAt > nowIsoStr) return null;

        const leaseExpiresAt = new Date(now + LEASE_MS).toISOString();
        const updated: Partial<EmailJob> = {
          status: 'processing',
          processingStartedAt: nowIsoStr,
          leaseExpiresAt,
          updatedAt: nowIsoStr,
          attempts: (data.attempts || 0) + 1,
        };
        tx.update(ref, updated);
        return { ...data, ...updated, id: snap.id } as EmailJob;
      });
      if (job) claimed.push(job);
    } catch (err: any) {
      console.warn('[emailQueue] claim failed', doc.id, err?.message || err);
    }
  }

  return claimed;
}

export async function markJobAccepted(
  jobId: string,
  providerMessageId?: string
): Promise<void> {
  const ref = jobRef(jobId);
  await ref.update({
    status: 'accepted' satisfies EmailJobStatus,
    providerMessageId: providerMessageId || null,
    sentAt: nowIso(),
    updatedAt: nowIso(),
    leaseExpiresAt: null,
    lastError: null,
  });
}

export async function markJobRetryOrFail(
  jobId: string,
  error: string,
  opts: { retryable: boolean; attempts: number; maxAttempts: number }
): Promise<void> {
  const permanent =
    !opts.retryable || opts.attempts >= opts.maxAttempts;
  const next = permanent
    ? null
    : new Date(Date.now() + computeBackoffMs(opts.attempts)).toISOString();

  await jobRef(jobId).update({
    status: permanent ? 'failed' : 'pending',
    lastError: String(error || 'unknown').slice(0, 1000),
    nextAttemptAt: next || nowIso(),
    updatedAt: nowIso(),
    leaseExpiresAt: null,
  });
}

export async function updateJobStatusByProviderMessageId(
  providerMessageId: string,
  status: EmailJobStatus,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  if (!providerMessageId || !isFirebaseAdminReady()) return false;
  const db = getAdminDb();
  const snap = await db
    .collection(COLLECTION)
    .where('providerMessageId', '==', providerMessageId)
    .limit(1)
    .get();
  if (snap.empty) return false;
  const doc = snap.docs[0];
  const current = doc.data() as EmailJob;
  // Do not regress terminal delivery states incorrectly
  if (current.status === 'delivered' && status === 'accepted') return true;

  await doc.ref.update({
    status,
    updatedAt: nowIso(),
    ...(status === 'delivered' ? { deliveredAt: nowIso() } : {}),
    ...extra,
  });
  return true;
}

/** Soft retention: mark very old completed jobs (does not hard-delete). */
export async function archiveOldJobs(days = 30): Promise<number> {
  if (!isFirebaseAdminReady()) return 0;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const db = getAdminDb();
  const statuses: EmailJobStatus[] = ['accepted', 'delivered', 'failed', 'cancelled', 'bounced', 'blocked'];
  let archived = 0;
  for (const st of statuses) {
    const snap = await db
      .collection(COLLECTION)
      .where('status', '==', st)
      .where('updatedAt', '<', cutoff)
      .limit(50)
      .get();
    for (const d of snap.docs) {
      await d.ref.update({ archived: true, updatedAt: nowIso() });
      archived += 1;
    }
  }
  return archived;
}
