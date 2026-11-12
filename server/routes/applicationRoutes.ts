/**
 * Server-mediated join application submit + admin review.
 * Enqueues transactional emails after successful Firestore commits.
 */
import { Router } from 'express';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { getAdminDb, getAuth, isFirebaseAdminReady } from '../services/firebaseAdmin';
import {
  isAdminEmailServer,
  notifyAdminsNewApplication,
  notifyApplicantDecision,
} from '../services/email/emailNotificationService';

export const applicationRoutes = Router();

const rateBucket = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = rateBucket.get(key);
  if (!cur || cur.resetAt < now) {
    rateBucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count += 1;
  return true;
}

async function resolveCallerEmail(uid: string): Promise<string | null> {
  try {
    if (isFirebaseAdminReady()) {
      const user = await getAuth().getUser(uid);
      if (user.email) return user.email.toLowerCase();
    }
  } catch {
    /* fall through */
  }
  try {
    const snap = await getAdminDb().collection('users').doc(uid).get();
    const email = snap.data()?.email;
    return email ? String(email).toLowerCase() : null;
  } catch {
    return null;
  }
}

/** POST /api/applications — submit join application */
applicationRoutes.post('/applications', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    if (!isFirebaseAdminReady()) {
      return res.status(503).json({
        error: 'Firebase Admin is not configured. Cannot process applications securely.',
      });
    }
    const uid = req.userId!;
    if (!rateLimit(`app-submit:${uid}`, 5, 60_000)) {
      return res.status(429).json({ error: 'Too many application attempts. Please wait.' });
    }

    const message = String(req.body?.message || '')
      .trim()
      .slice(0, 2000);
    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const appRef = db.collection('applications').doc(uid);

    const authEmail = await resolveCallerEmail(uid);
    const userSnap = await userRef.get();
    const existing = userSnap.data() || {};
    const email = String(authEmail || existing.email || '').trim().toLowerCase();
    const name = String(
      req.body?.name || existing.name || email.split('@')[0] || 'Applicant'
    ).trim().slice(0, 120);

    if (!email) {
      return res.status(400).json({ error: 'Account email is required to apply.' });
    }

    const now = new Date().toISOString();
    const appPayload = {
      userId: uid,
      email,
      name,
      message,
      status: 'pending',
      createdAt: existing.applicationSubmittedAt || now,
      updatedAt: now,
    };

    // Commit application + user flags
    const batch = db.batch();
    batch.set(
      userRef,
      {
        id: uid,
        email,
        name,
        applicationStatus: 'pending',
        applicationMessage: message,
        applicationSubmittedAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(appRef, appPayload);
    await batch.commit();

    // Enqueue admin emails (async-safe; failure must not roll back application)
    notifyAdminsNewApplication({
      applicantUserId: uid,
      applicantName: name,
      applicantEmail: email,
      message,
    }).catch((err) => console.error('[applications] notify admins', err?.message || err));

    return res.status(201).json({
      success: true,
      application: { userId: uid, status: 'pending', message, email, name },
    });
  } catch (err: any) {
    console.error('[applications] submit', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to submit application' });
  }
});

/** GET /api/applications/pending — admin list */
applicationRoutes.get(
  '/applications/pending',
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    try {
      if (!isFirebaseAdminReady()) {
        return res.status(503).json({ error: 'Firebase Admin is not configured.' });
      }
      const uid = req.userId!;
      const email = await resolveCallerEmail(uid);
      if (!isAdminEmailServer(email)) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const db = getAdminDb();
      let snap;
      try {
        snap = await db
          .collection('applications')
          .where('status', '==', 'pending')
          .limit(100)
          .get();
      } catch {
        snap = await db.collection('applications').limit(100).get();
      }

      const items = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            userId: data.userId || d.id,
            email: data.email || '',
            name: data.name || '',
            message: data.message || '',
            createdAt: data.createdAt || '',
            status: data.status || 'pending',
          };
        })
        .filter((i) => i.status === 'pending');

      return res.json({ applications: items });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to list applications' });
    }
  }
);

/** POST /api/applications/:userId/review — admin approve/reject */
applicationRoutes.post(
  '/applications/:userId/review',
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    try {
      if (!isFirebaseAdminReady()) {
        return res.status(503).json({ error: 'Firebase Admin is not configured.' });
      }
      const adminUid = req.userId!;
      if (!rateLimit(`app-review:${adminUid}`, 30, 60_000)) {
        return res.status(429).json({ error: 'Too many review actions.' });
      }

      const adminEmail = await resolveCallerEmail(adminUid);
      if (!isAdminEmailServer(adminEmail)) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const applicantUserId = String(req.params.userId || '').trim();
      const decision = String(req.body?.decision || '').trim();
      if (!applicantUserId) {
        return res.status(400).json({ error: 'userId is required' });
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        return res.status(400).json({ error: 'decision must be approved or rejected' });
      }

      const db = getAdminDb();
      const appRef = db.collection('applications').doc(applicantUserId);
      const userRef = db.collection('users').doc(applicantUserId);
      const now = new Date().toISOString();

      const appSnap = await appRef.get();
      if (!appSnap.exists) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const batch = db.batch();
      batch.set(
        appRef,
        {
          status: decision,
          updatedAt: now,
          reviewedAt: now,
          reviewedBy: adminEmail,
        },
        { merge: true }
      );
      batch.set(
        userRef,
        {
          applicationStatus: decision,
          applicationReviewedAt: now,
          applicationReviewedBy: adminEmail,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // In-app notification for applicant
      const notifRef = db.collection('notifications').doc();
      batch.set(notifRef, {
        userId: applicantUserId,
        type: decision === 'approved' ? 'connection_accepted' : 'message',
        title: decision === 'approved' ? 'Application approved' : 'Application rejected',
        body:
          decision === 'approved'
            ? 'Welcome to Afflatus. Complete your profile setup to unlock full platform interactions.'
            : 'Your Afflatus application was not approved at this time.',
        relatedId: applicantUserId,
        fromUserId: adminUid,
        read: false,
        createdAt: now,
      });

      await batch.commit();

      notifyApplicantDecision({
        applicantUserId,
        decision: decision as 'approved' | 'rejected',
      }).catch((err) => console.error('[applications] notify applicant', err?.message || err));

      return res.json({
        success: true,
        userId: applicantUserId,
        decision,
      });
    } catch (err: any) {
      console.error('[applications] review', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Failed to review application' });
    }
  }
);
