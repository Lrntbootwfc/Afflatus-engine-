import type { Request, Response } from 'express';
import { QueryUnderstandingService } from '../services/queryUnderstandingService';
import { RecommendationService } from '../services/recommendationService';
import { resolveUserIdAsync } from '../services/firebaseAdmin';
import {
  handleFilmProductionTurn,
  type ChatMessage,
  type ProductionDraft,
} from '../services/filmProductionChatService';

function normalizeMessages(body: any, fallbackPrompt: string): ChatMessage[] {
  const raw = body?.messages;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content).trim().slice(0, 4000),
      }))
      .filter((m: ChatMessage) => m.content)
      .slice(-16);
  }
  return [{ role: 'user', content: fallbackPrompt }];
}

export class AiAssistantController {
  /**
   * POST /api/assistant/chat
   * Body: { prompt: string, messages?: ChatMessage[], productionDraft?: ProductionDraft }
   */
  public static async chat(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { prompt } = body;
      const userId = (await resolveUserIdAsync(req)) || undefined;

      if ((!prompt || typeof prompt !== 'string' || !prompt.trim()) && !Array.isArray(body.messages)) {
        res.status(400).json({
          success: false,
          error: 'Prompt is required (or provide messages[]).',
        });
        return;
      }

      const sanitizedPrompt = String(prompt || '')
        .trim()
        .slice(0, 2000);
      const messages = normalizeMessages(body, sanitizedPrompt);
      const lastUser =
        [...messages].reverse().find((m) => m.role === 'user')?.content || sanitizedPrompt;

      const classified = await QueryUnderstandingService.classifyAfflatusIntent(
        messages.map((m) => ({ role: m.role, content: m.content }))
      );
      if (
        classified.inScope &&
        classified.wantsRecommendation === false &&
        classified.reply &&
        (classified.intent === 'chat' || classified.intent === 'help')
      ) {
        res.json({
          success: true,
          intent: classified.intent,
          message: classified.reply,
          matchedItems: [],
          candidates: [],
          suggestedFollowUps: [
            'I am making a short film',
            'What crew do I need for a commercial?',
            'Camera rental in my city',
          ],
          productionDraft: body.productionDraft || null,
        });
        return;
      }

      const film = await handleFilmProductionTurn({
        messages,
        userId,
        previousDraft: (body.productionDraft as ProductionDraft) || undefined,
      });

      let matchedItems: any[] = [];
      let candidates: any[] = [];
      let message = film.message;

      if (film.shouldSearchCreators && film.searchRoles.length > 0) {
        try {
          const structured: any = {
            roles: film.searchRoles,
            location: film.searchLocation || film.draft.location,
            budgetInr: film.draft.budgetInr,
            projectType: film.draft.projectType,
            rawQuery: lastUser,
          };

          const searchFn = (RecommendationService as any).searchFromRequirements;
          if (typeof searchFn === 'function') {
            const search = await searchFn.call(RecommendationService, structured, userId);
            candidates = search?.results || [];
            matchedItems = (candidates || []).map((c: any) => ({
              id: c.creatorId || c.id,
              type: 'creator',
              score: c.score,
              matchReasons: c.reasons || c.matchReasons,
              title: c.profile?.name || c.title,
              subtitle: c.profile?.primaryRole || c.subtitle,
              meta: { location: c.profile?.location || c.meta?.location },
            }));
            if (matchedItems.length > 0) {
              message += `\n\nFound ${matchedItems.length} people on Afflatus who may fit: ${matchedItems
                .slice(0, 5)
                .map((m) => m.title)
                .filter(Boolean)
                .join(', ')}.`;
            } else {
              message +=
                '\n\nI could not find strong profile matches yet. Broaden the city or roles, or ask creators to complete skills on their profiles.';
            }
          }
        } catch (err: any) {
          console.warn('[AiAssistantController] match search failed', err?.message || err);
        }
      }

      res.json({
        success: true,
        intent: film.intent,
        message,
        matchedItems,
        candidates,
        rolesSuggested: film.rolesSuggested,
        productionDraft: film.draft,
        suggestedFollowUps: film.suggestedFollowUps,
        rentalSuggestions: film.rentalSuggestions,
        modelUsed: film.modelUsed,
        understandingSource: film.modelUsed ? 'film-chat-gemini' : 'film-chat-deterministic',
      });
    } catch (err: any) {
      console.error('[AiAssistantController.chat] Error:', err);
      res.status(500).json({
        success: false,
        error: 'Assistant processing encountered an issue.',
        message:
          'Something went wrong on my side. Try asking: “What crew do I need for a short film?”',
      });
    }
  }

  public static async getSuggestions(_req: Request, res: Response): Promise<void> {
    try {
      const suggestions = [
        {
          id: 's1',
          label: 'Crew for a short film',
          query: 'I am making a short film. What crew do I need?',
        },
        {
          id: 's2',
          label: 'Commercial team + budget',
          query: 'Planning a brand commercial in Mumbai with about 3 lakh budget. Who should I hire?',
        },
        {
          id: 's3',
          label: 'Find DP and editor',
          query: 'Find a DP and editor who can also help with color on Afflatus',
        },
        {
          id: 's4',
          label: 'Camera rental near me',
          query: 'I need camera and lighting rental in Delhi. What should I get and who can help?',
        },
        {
          id: 's5',
          label: 'Music video crew',
          query: 'Music video shoot next month — suggest roles and multi-skilled people',
        },
      ];
      res.json({ success: true, suggestions });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to retrieve suggestions.' });
    }
  }
}
