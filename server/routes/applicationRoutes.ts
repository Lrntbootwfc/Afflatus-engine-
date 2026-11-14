/**
 * Admin join-application listing (Firestore via Admin SDK when configured).
 */
import { Router } from 'express';
import { getAdminDb, isFirebaseAdminReady } from '../services/firebaseAdmin';

export const applicationRoutes = Router();

/**
 * GET /api/applications/pending
 */
applicationRoutes.get('/pending', async (_req, res) => {
  try {
    if (!isFirebaseAdminReady()) {
      res.json({ success: true, applications: [], source: 'unconfigured' });
      return;
    }
    const db = getAdminDb();
    try {
      const snap = await db.collection('applications').where('status', '==', 'pending').limit(100).get();
      const applications = snap.docs.map((d: any) => {
        const data = d.data() || {};
        return {
          userId: d.id,
          email: String(data.email || ''),
          name: String(data.name || ''),
          message: String(data.message || ''),
          status: String(data.status || 'pending'),
          createdAt:
            typeof data.createdAt === 'string'
              ? data.createdAt
              : data.createdAt?.toDate?.()?.toISOString?.() || '',
        };
      });
      res.json({ success: true, applications, source: 'admin-query' });
      return;
    } catch {
      const all = await db.collection('applications').limit(200).get();
      const applications = all.docs
        .map((d: any) => {
          const data = d.data() || {};
          return {
            userId: d.id,
            email: String(data.email || ''),
            name: String(data.name || ''),
            message: String(data.message || ''),
            status: String(data.status || ''),
            createdAt:
              typeof data.createdAt === 'string'
                ? data.createdAt
                : data.createdAt?.toDate?.()?.toISOString?.() || '',
          };
        })
        .filter((r: any) => String(r.status).toLowerCase() === 'pending');
      res.json({ success: true, applications, source: 'admin-scan' });
    }
  } catch (err: any) {
    console.error('[applications/pending]', err?.message || err);
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to list pending applications',
      applications: [],
    });
  }
});
