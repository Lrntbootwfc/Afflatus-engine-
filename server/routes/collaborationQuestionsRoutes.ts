import { Router } from 'express';
import { resolveUserIdAsync } from '../services/firebaseAdmin';
import {
  selectNextQuestionSet,
  submitProgressiveSet,
  loadProgressiveState,
  getStatusFromState,
} from '../services/progressiveCollaborationService';
import { getAdminDb } from '../services/firebaseAdmin';

export const collaborationQuestionsRoutes = Router();

/** GET /api/collaboration-questions/status */
collaborationQuestionsRoutes.get('/status', async (req, res) => {
  try {
    const userId = await resolveUserIdAsync(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const state = await loadProgressiveState(userId);
    return res.json(getStatusFromState(state));
  } catch (err: any) {
    console.error('[collab-questions/status]', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

/** GET /api/collaboration-questions/next-set — Gemini-selected set of up to 5 */
collaborationQuestionsRoutes.get('/next-set', async (req, res) => {
  try {
    const userId = await resolveUserIdAsync(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    let profileSummary: Record<string, unknown> = {};
    try {
      const db = getAdminDb();
      const snap = await db.collection('users').doc(userId).get();
      if (snap.exists) {
        const u = snap.data() as any;
        profileSummary = {
          primaryRole: u.primaryRole,
          location: u.location,
          bio: typeof u.bio === 'string' ? u.bio.slice(0, 240) : undefined,
          collaborationScenariosAnswered: !!(u.collaborationScenarios?.q1 || u.collaborationScenarios?.q5),
        };
      }
    } catch {
      /* non-blocking */
    }

    const result = await selectNextQuestionSet({ userId, profileSummary });
    return res.json(result);
  } catch (err: any) {
    console.error('[collab-questions/next-set]', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

/** POST /api/collaboration-questions/submit-set */
collaborationQuestionsRoutes.post('/submit-set', async (req, res) => {
  try {
    const userId = await resolveUserIdAsync(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { questionIds, answers } = req.body || {};
    if (!Array.isArray(questionIds) || !answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'questionIds and answers required' });
    }
    const result = await submitProgressiveSet({ userId, questionIds, answers });
    return res.json({
      success: true,
      hasMore: result.hasMore,
      status: getStatusFromState(result.state),
    });
  } catch (err: any) {
    console.error('[collab-questions/submit-set]', err?.message || err);
    return res.status(400).json({ error: err?.message || 'Submit failed' });
  }
});
