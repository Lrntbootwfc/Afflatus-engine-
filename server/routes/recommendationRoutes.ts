import { Router } from 'express';
import { QueryUnderstandingService } from '../services/queryUnderstandingService';
import { RecommendationService } from '../services/recommendationService';

export const recommendationRoutes = Router();

/**
 * POST /api/recommendations/search
 * Direct search bypasses chat understanding
 */
recommendationRoutes.post('/search', async (req, res) => {
  try {
    const body = req.body || {};
    const requesterId = (typeof req.headers['x-user-id'] === 'string' && req.headers['x-user-id']) || body.requesterId || null;
    
    // Minimal mock structured requirements from body
    const requirements = {
      location: body.location ? { city: body.location } : 'not_specified',
      role: body.requiredRoles && body.requiredRoles.length > 0 ? body.requiredRoles[0] : 'not_specified',
      project_type: body.projectType || 'not_specified'
    };

    const result = await RecommendationService.searchFromRequirements(requirements, requesterId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[recommendations/search]', err);
    res.status(500).json({ success: false, error: err?.message || 'Search failed' });
  }
});

/**
 * POST /api/recommendations/ai-match
 * Understands conversational queries with history
 */
recommendationRoutes.post('/ai-match', async (req, res) => {
  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }

    const scope = await QueryUnderstandingService.classifyAfflatusIntent(messages);
    if (!scope.inScope) {
      res.json({
        success: true,
        outOfScope: true,
        message: scope.reply,
        understanding: null,
        candidates: [],
        relaxed: [],
      });
      return;
    }

    // Conversational / product help — no ranking
    if (scope.wantsRecommendation === false) {
      res.json({
        success: true,
        conversational: true,
        message: scope.reply || "Tell me a role and city when you want creator matches.",
        understanding: null,
        candidates: [],
        relaxed: [],
      });
      return;
    }

    const understood = await QueryUnderstandingService.understandChat(messages);
    if (!understood.success || !understood.data) {
      console.error('[ai-match] understand failed:', understood.error);
      res.status(503).json({
        success: false,
        error: understood.error || 'Failed to understand query',
        message:
          'AI Match could not reach a working Gemini model. Check GEMINI_API_KEY and that your project can use gemini-3.8-flash (or another model in the engine ladder).',
      });
      return;
    }

    const data = understood.data;
    const requesterId = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : undefined;
    // Ensure roles[] for multi-role ranking
    if ((!data.roles || !Array.isArray(data.roles) || !data.roles.length) && data.role && data.role !== 'not_specified') {
      data.roles = [data.role];
    }

    // Location resolution (session > extracted > profile default). Never silent.
    const bodyLoc =
      (typeof req.body?.sessionLocation === 'string' && req.body.sessionLocation.trim()) ||
      (typeof req.body?.defaultLocation === 'string' && req.body.defaultLocation.trim()) ||
      '';
    let locationSource: 'explicit' | 'session' | 'profile' | 'none' = 'none';
    const extractedCity =
      data.location && typeof data.location === 'object' && data.location.city && data.location.city !== 'not_specified'
        ? String(data.location.city).trim()
        : '';

    if (extractedCity) {
      locationSource = 'explicit';
    } else if (typeof req.body?.sessionLocation === 'string' && req.body.sessionLocation.trim()) {
      data.location = { city: req.body.sessionLocation.trim() };
      locationSource = 'session';
    } else if (bodyLoc) {
      data.location = { city: bodyLoc };
      locationSource = 'profile';
    }

    // If Gemini left roles empty but user clearly asked for a role word, keep failure honest
    const searchResult = await RecommendationService.searchFromRequirements(data, requesterId);

    console.log('[REC_DEBUG]', JSON.stringify({
      roles: data.roles || data.role,
      city: data.location?.city || null,
      locationSource,
      relaxed: searchResult.relaxed,
      count: searchResult.results?.length,
      top: (searchResult.results || []).slice(0, 5).map((c: any) => ({
        id: c.creatorId,
        score: c.score,
        parts: c.scoreBreakdown,
      })),
    }));

    const activeCity =
      data.location && typeof data.location === 'object' && data.location.city && data.location.city !== 'not_specified'
        ? data.location.city
        : null;

    res.json({
      success: true,
      understanding: data,
      understandingSource: 'engine-gemini',
      locationSource,
      activeLocation: activeCity,
      relaxed: searchResult.relaxed || [],
      candidates: (searchResult.results || []).map((c: any) => ({
        userId: c.creatorId,
        score: c.score,
        matchReasons: c.reasons,
        scoreBreakdown: c.scoreBreakdown,
        profile: c.profile,
      })),
    });
  } catch (err: any) {
    console.error('[recommendations/ai-match]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed' });
  }
});
