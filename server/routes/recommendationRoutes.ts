import { Router } from 'express';
import { QueryUnderstandingService } from '../services/queryUnderstandingService';
import { RecommendationService } from '../services/recommendationService';
import { listProjects, getUser, listUsers } from '../services/dataStore';
import { resolveUserIdAsync } from '../services/firebaseAdmin';
import { handleFilmProductionTurn, type ProductionDraft } from '../services/filmProductionChatService';

/** Only approved + profile-complete creators may appear in AI Match cards. */
function isRecommendableCreator(u: any): boolean {
  if (!u || !u.id) return false;
  const status = String(u.applicationStatus || u.status || '').toLowerCase();
  return u.profileCompleted === true && status === 'approved';
}

function filterRecommendableResults(results: any[]): any[] {
  return (results || []).filter((c) => {
    const p = c.profile || c;
    const status = String(p.applicationStatus || p.status || '').toLowerCase();
    return p.profileCompleted === true && status === 'approved';
  });
}



/** Lightweight project discovery from existing Explore project data (no invented rows). */
async function searchOpenProjects(opts: {
  text: string;
  roleHint?: string;
  locationHint?: string;
  requesterId?: string | null;
}): Promise<{ message: string; projects: any[] }> {
  const all = ((await listProjects(200)) || []) as any[];
  const q = (opts.text || '').toLowerCase();
  const role = (opts.roleHint || '').toLowerCase().trim();
  const loc = (opts.locationHint || '').toLowerCase().trim();

  let list = all.filter((p) => p && (p.title || p.rawTextBrief || p.id));
  const scored = list.map((p) => {
    let score = 0;
    const blob = [
      p.title,
      p.rawTextBrief,
      p.description,
      p.location,
      p.requiredRole,
      ...(p.genreTags || []),
      ...(p.rolesNeeded || []),
      ...(p.requiredRoles || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (role && blob.includes(role)) score += 40;
    if (role && String(p.requiredRole || '').toLowerCase().includes(role)) score += 30;
    if (loc && loc !== 'remote' && String(p.location || '').toLowerCase().includes(loc)) score += 20;
    if (/film|cinema|shoot|production/.test(q) && /film|cinema|shoot|production/.test(blob)) score += 10;
    if (q.split(/\s+/).some((w) => w.length > 3 && blob.includes(w))) score += 5;
    // Prefer open-ish statuses when present
    const st = String(p.status || p.projectStatus || '').toLowerCase();
    if (!st || st === 'open' || st === 'active' || st === 'hiring') score += 8;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, 8).map((s) => s.p);
  const fallback = top.length ? top : scored.slice(0, 5).map((s) => s.p);

  if (!fallback.length) {
    return {
      message:
        'I could not find matching projects in the current Explore project data. Try Explore → Projects, or ask with a clearer role (e.g. \"projects for editors\").',
      projects: [],
    };
  }
  const lines = fallback.slice(0, 6).map((p, i) => {
    const title = p.title || p.name || 'Untitled project';
    const roleNeed = p.requiredRole || (p.rolesNeeded && p.rolesNeeded[0]) || '';
    const place = p.location || '';
    const bits = [title, roleNeed && `needs ${roleNeed}`, place].filter(Boolean);
    return `${i + 1}. ${bits.join(' · ')}`;
  });
  return {
    message:
      `Here are projects from the current Afflatus data that look relevant:\n\n` +
      lines.join('\n') +
      `\n\nOpen Explore → Projects for the full list and details. I only list real projects already in the system.`,
    projects: fallback.slice(0, 6).map((p) => ({
      id: p.id,
      title: p.title || p.name,
      location: p.location,
      requiredRole: p.requiredRole,
    })),
  };
}



/**
 * People who NEED the requester's skills:
 * match requester primary/secondary roles → candidate.seekingRoles
 * (NOT candidate.primaryRole)
 */
async function searchPeopleSeekingMyRoles(opts: {
  requesterId?: string | null;
  explicitRoles?: string[];
  text?: string;
}): Promise<{ message: string; candidates: any[] }> {
  let offered: string[] = (opts.explicitRoles || []).map((r) => String(r).trim()).filter(Boolean);

  if (!offered.length && opts.requesterId) {
    try {
      const me = await getUser(opts.requesterId);
      if (me) {
        offered = [
          String((me as any).primaryRole || '').trim(),
          ...(((me as any).secondaryRoles as string[]) || []).map((r) => String(r || '').trim()),
        ].filter(Boolean);
      }
    } catch {
      /* */
    }
  }

  // Extract role from text if user named one (e.g. "who needs script writers")
  if (!offered.length && opts.text) {
    const lower = opts.text.toLowerCase();
    const roleWords = [
      'script writer', 'screenwriter', 'scriptwriter', 'cinematographer', 'director',
      'editor', 'producer', 'gaffer', 'sound', 'colorist', 'vfx', 'actor', 'photographer', 'dp',
    ];
    for (const w of roleWords) {
      if (lower.includes(w)) {
        offered.push(w);
        break;
      }
    }
  }

  if (!offered.length) {
    return {
      message:
        'To find people who are looking for someone like you, I need your roles from your profile (primary/secondary), or tell me which role they should be seeking (e.g. "who is looking for a script writer?").',
      candidates: [],
    };
  }

  const users = ((await listUsers(300)) || []) as any[];
  const meId = opts.requesterId ? String(opts.requesterId) : '';

  const roleHit = (seeking: string[], offeredRole: string) => {
    const o = offeredRole.toLowerCase();
    return seeking.some((s) => {
      const x = String(s || '').toLowerCase();
      return x && (x.includes(o) || o.includes(x) || (o.includes('script') && x.includes('script')));
    });
  };

  const matches: any[] = [];
  for (const u of users) {
    if (!u || (meId && String(u.id) === meId)) continue;
    const seeking = [
      ...((u.seekingRoles as string[]) || []),
      ...((u.lookingFor as string[]) || []),
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (!seeking.length) continue;

    const hitRoles = offered.filter((r) => roleHit(seeking, r));
    if (!hitRoles.length) continue;

    // Explicitly exclude "they ARE this role" as the reason — seeking is the signal
    matches.push({
      userId: u.id,
      score: 70 + Math.min(20, hitRoles.length * 5),
      matchReasons: [
        `Seeking: ${seeking.slice(0, 3).join(', ')}`,
        `Matches what you offer: ${hitRoles.join(', ')}`,
      ],
      profile: u,
    });
  }

  matches.sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = matches.slice(0, 12);

  if (!top.length) {
    return {
      message:
        `I looked for creators whose "seeking / looking for" roles include what you offer (${offered.join(', ')}). ` +
        `None matched in the current data. People list collaborator needs on their profile (seeking roles) — try again as more creators fill that in, or open Explore → Creators.`,
      candidates: [],
    };
  }

  const lines = top.slice(0, 6).map((c, i) => {
    const name = c.profile?.name || c.profile?.username || 'Creator';
    const role = c.profile?.primaryRole || '';
    const seeking = (c.profile?.seekingRoles || []).slice(0, 3).join(', ');
    return `${i + 1}. ${name}${role ? ` (${role})` : ''} — looking for: ${seeking || 'collaborators'}`;
  });

  return {
    message:
      `Here are people who are looking for skills you can provide (${offered.join(', ')}). ` +
      `This is based on their seeking/looking-for roles — not people who already work as ${offered[0]}:\n\n` +
      lines.join('\n') +
      `\n\nOpen Explore → Creators or a Public Profile to connect.`,
    candidates: top,
  };
}


export const recommendationRoutes = Router();

/**
 * POST /api/recommendations/search
 * Direct search bypasses chat understanding
 */
recommendationRoutes.post('/search', async (req, res) => {
  try {
    const body = req.body || {};
    const requesterId = (await resolveUserIdAsync(req)) || body.requesterId || null;
    
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
        message: scope.reply || "I'm Afflatus AI Match — ask about the app, creators, or open projects.",
        understanding: null,
        candidates: [],
        relaxed: [],
        productionDraft: req.body?.productionDraft || null,
      });
      return;
    }

    const requesterIdEarly =
      (await resolveUserIdAsync(req)) ||
      req.body?.requesterId ||
      null;

    // Multi-turn film production / crew / rental (keeps productionDraft across turns)
    const priorDraft = (req.body?.productionDraft || null) as ProductionDraft | null;
    const lastUserText = String(
      [...messages].reverse().find((m: any) => m.role === 'user')?.content || ''
    );
    const historyText = messages.map((m: any) => String(m.content || '')).join(' \n ').toLowerCase();
    const peopleAskNow =
      /(find people|find all|suggest (all |those )?(people|crew)|pull (the )?profiles|show cards|through cards|recommend (people|creators|crew)|yes pull|assemble|crew members|search all|all location|all over|worldwide)/i.test(
        lastUserText
      ) ||
      (/^(yes|yeah|yep|ok|okay|sure|go ahead|proceed|do it)\b/i.test(lastUserText.trim()) &&
        /(crew|role|budget|short film|film|dp|director|editor)/i.test(historyText));
    const forceProduction =
      scope.intent === 'production_plan' ||
      scope.intent === 'rental' ||
      !!priorDraft?.projectType ||
      !!priorDraft?.rolesNeeded?.length ||
      peopleAskNow ||
      /find all (of )?(them|the people|the roles)/i.test(lastUserText) ||
      (/(short film|making a film|budget)/i.test(historyText) && peopleAskNow);

    if (forceProduction || scope.intent === 'production_plan' || scope.intent === 'rental') {
      const film = await handleFilmProductionTurn({
        messages: messages.map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })),
        userId: requesterIdEarly || undefined,
        previousDraft: priorDraft || undefined,
      });

      let candidates: any[] = [];
      let message = film.message;

      if (film.shouldSearchCreators) {
        try {
          const wantsAnyLocation =
            /(all location|all over|anywhere|worldwide|remote|no location|any city|search all|every location)/i.test(
              lastUserText
            );
          // Prefer draft city only if user did not ask to clear location; do NOT force session Mumbai
          let city = wantsAnyLocation
            ? undefined
            : film.searchLocation || film.draft.location || undefined;
          if (city && /remote|worldwide|anywhere/i.test(String(city))) city = undefined;

          let roles = (film.searchRoles?.length ? film.searchRoles : film.rolesSuggested || []).map((r) =>
            String(r)
              .replace(/\(.*?\)/g, '')
              .split('/')[0]
              .replace(/&.*$/, '')
              .trim()
          );
          // Normalize to roles the DB actually scores well
          const normalizeRole = (r: string) => {
            const x = r.toLowerCase();
            if (/cinematograph|director of photography|\bdp\b|\bdop\b/.test(x)) return 'Cinematographer';
            if (/script supervisor|continuity/.test(x)) return 'Script Supervisor';
            if (/screen.?writer|script writer|writer/.test(x)) return 'Screenwriter';
            if (/sound|recordist|boom|audio/.test(x)) return 'Sound Recordist';
            if (/gaffer|lighting/.test(x)) return 'Gaffer';
            if (/edit/.test(x)) return 'Editor';
            if (/produc/.test(x)) return 'Producer';
            if (/direct/.test(x) && !/photography/.test(x)) return 'Director';
            if (/1st|first ad|assistant director/.test(x)) return '1st AD';
            return r;
          };
          roles = [...new Set(roles.map(normalizeRole).filter(Boolean))];
          if (!roles.length) {
            roles = ['Director', 'Cinematographer', 'Editor', 'Sound Recordist', 'Screenwriter'];
          }
          // Search more roles for "all crew" but still bounded
          roles = roles.slice(0, 8);

          const byId = new Map<string, any>();
          const relaxedAll: string[] = [];
          let lastStructured: any = null;

          // Per-role searches merge better than one multi-role constraint
          for (const role of roles) {
            const structured: any = {
              roles: [role],
              role,
              location: city ? { city: String(city) } : { city: 'not_specified' },
              project_type: film.draft.projectType,
              rawQuery: lastUserText,
            };
            lastStructured = structured;
            try {
              const searchResult = await RecommendationService.searchFromRequirements(
                structured,
                requesterIdEarly
              );
              if (Array.isArray(searchResult.relaxed)) relaxedAll.push(...searchResult.relaxed);
              for (const c of searchResult.results || []) {
                const profile = c.profile || {};
                const id = String(profile.id || c.creatorId || c.userId || '');
                if (!id || id === requesterIdEarly) continue;
                const score = typeof c.score === 'number' ? c.score : 0;
                const prev = byId.get(id);
                if (!prev || score > prev.score) {
                  byId.set(id, {
                    userId: id,
                    creatorId: id,
                    score,
                    matchReasons: [
                      ...(c.reasons || c.matchReasons || []),
                      `Fit for ${role}`,
                    ].filter(Boolean),
                    scoreBreakdown: c.scoreBreakdown,
                    profile: {
                      ...profile,
                      id,
                      name: profile.name || profile.displayName || 'Creator',
                      primaryRole: profile.primaryRole || profile.role || role,
                      location: profile.location || profile.city || city || '',
                    },
                  });
                } else if (prev) {
                  prev.matchReasons = [
                    ...new Set([...(prev.matchReasons || []), `Fit for ${role}`]),
                  ];
                }
              }
            } catch (re: any) {
              console.warn('[ai-match] role search failed', role, re?.message || re);
            }
          }

          // If still empty or thin, broaden: no city + listUsers fallback
          if (byId.size < 3) {
            try {
              const pool = ((await listUsers(120)) || []) as any[];
              for (const u of pool) {
                if (!u?.id || u.id === requesterIdEarly) continue;
                if (!isRecommendableCreator(u)) continue;
                if (byId.has(u.id)) continue;
                const blob = `${u.primaryRole || ''} ${(u.secondaryRoles || []).join(' ')} ${u.bio || ''}`.toLowerCase();
                const hit = roles.some((role) => {
                  const k = role.toLowerCase().split(' ')[0];
                  return blob.includes(k) || blob.includes(role.toLowerCase());
                });
                if (!hit && byId.size >= 6) continue;
                if (!hit && byId.size < 6) {
                  // still allow a few general creators so cards appear
                } else if (!hit) continue;
                byId.set(u.id, {
                  userId: u.id,
                  creatorId: u.id,
                  score: hit ? 45 : 30,
                  matchReasons: hit
                    ? ['Role/keywords match your crew needs']
                    : ['Available on Afflatus — check profile for fit'],
                  profile: {
                    id: u.id,
                    name: u.name || 'Creator',
                    avatarUrl: u.avatarUrl,
                    primaryRole: u.primaryRole || u.role || 'Creator',
                    secondaryRoles: u.secondaryRoles || [],
                    location: u.location || u.city || '',
                    bio: u.bio,
                  },
                });
                if (byId.size >= 12) break;
              }
            } catch (fe: any) {
              console.warn('[ai-match] listUsers fallback failed', fe?.message || fe);
            }
          }

          candidates = filterRecommendableResults(
            [...byId.values()]
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .slice(0, 12)
          );

          console.log('[ai-match] multi-role crew search', {
            roles,
            city: city || null,
            wantsAnyLocation,
            count: candidates.length,
          });

          // Prefer a clear UI message over Gemini inventing fake named packages
          if (candidates.length) {
            message =
              `Here are ${candidates.length} people on Afflatus for your crew` +
              (city ? ` (preferring ${city})` : ' (all locations)') +
              `. Cards below — open a profile or send a connection request.\\nRoles covered: ${roles.join(', ')}.`;
          } else {
            message =
              'I could not load creator profiles right now. Try a single role, e.g. \"find a screenwriter\" or \"find a DP\".';
          }

          res.json({
            success: true,
            conversational: false,
            outOfScope: false,
            showCards: candidates.length > 0,
            intent: 'creators',
            message,
            understanding: lastStructured,
            understandingSource: 'multi-role-crew-search',
            candidates,
            results: candidates,
            relaxed: [...new Set(relaxedAll)],
            rolesSuggested: roles,
            productionDraft: {
              ...film.draft,
              location: city,
              rolesNeeded: roles,
            },
            suggestedFollowUps: [
              'Find a DP',
              'Find a screenwriter',
              'Search all locations',
              'Show editors',
            ],
            rentalSuggestions: film.rentalSuggestions,
            activeLocation: city || null,
            locationSource: city ? 'session' : 'none',
          });
          return;
        } catch (e: any) {
          console.warn('[ai-match] production match failed', e?.message || e);
          message +=
            '\\n\\nI tried to search creators but the match step failed. Try \"find a DP\" or \"find a screenwriter\".';
        }
      }

      // Pure conversation (planning / rental / crew advice) — no cards
      res.json({
        success: true,
        conversational: true,
        intent: film.intent,
        message,
        understanding: null,
        candidates: [],
        relaxed: [],
        rolesSuggested: film.rolesSuggested,
        productionDraft: film.draft,
        suggestedFollowUps: film.suggestedFollowUps,
        rentalSuggestions: film.rentalSuggestions,
        modelUsed: film.modelUsed,
      });
      return;
    }

    // Conversational / navigation help — no ranking
    if (scope.wantsRecommendation === false) {
      res.json({
        success: true,
        conversational: true,
        intent: scope.intent || 'chat',
        message:
          scope.reply ||
          "I can help plan your film crew and budget, find creators by role/location, rentals in your area, or open projects on Explore. What do you need?",
        understanding: null,
        candidates: [],
        relaxed: [],
        productionDraft: priorDraft,
      });
      return;
    }

    // Project discovery from existing project data
    if (scope.intent === 'projects') {
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')?.content || '';
      const requesterId =
        (await resolveUserIdAsync(req)) ||
        req.body?.requesterId ||
        null;
      let roleHint = '';
      let locationHint = '';
      try {
        if (requesterId) {
          const me = await getUser(requesterId);
          roleHint = String(me?.primaryRole || '');
          locationHint = String(me?.location || me?.city || '');
        }
      } catch {
        /* optional */
      }
      // Light role extraction from text
      const roleWords = [
        'cinematographer', 'cinematography', 'director', 'editor', 'producer', 'gaffer',
        'screenwriter', 'sound', 'colorist', 'vfx', 'actor', 'photographer', 'dp',
      ];
      const lower = lastUser.toLowerCase();
      for (const w of roleWords) {
        if (lower.includes(w)) {
          roleHint = roleHint || w;
          break;
        }
      }
      if (/my role|someone like me|related to my role|useful for me/.test(lower) && requesterId) {
        try {
          const me = await getUser(requesterId);
          if (me?.primaryRole) roleHint = String(me.primaryRole);
        } catch {
          /* */
        }
      }
      const found = await searchOpenProjects({
        text: lastUser,
        roleHint,
        locationHint,
        requesterId,
      });
      res.json({
        success: true,
        conversational: true,
        intent: 'projects',
        message: found.message,
        projects: found.projects,
        understanding: null,
        candidates: [],
        relaxed: [],
      });
      return;
    }

    // People who need MY skills (my roles → their seekingRoles)
    if (scope.intent === 'seeking_me') {
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')?.content || '';
      const requesterId =
        (await resolveUserIdAsync(req)) ||
        req.body?.requesterId ||
        null;
      const found = await searchPeopleSeekingMyRoles({
        requesterId,
        text: lastUser,
      });
      res.json({
        success: true,
        conversational: true,
        intent: 'seeking_me',
        message: found.message,
        understanding: null,
        candidates: found.candidates,
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
    const requesterId = (await resolveUserIdAsync(req)) || undefined;
    // Ensure roles[] for multi-role ranking
    if ((!data.roles || !Array.isArray(data.roles) || !data.roles.length) && data.role && data.role !== 'not_specified') {
      data.roles = [data.role];
    }

    // Vague phrasing ("role as mine") → use requester's own roles from profile
    const roleMissing =
      (!data.roles || !Array.isArray(data.roles) || !data.roles.length) &&
      (!data.role || data.role === 'not_specified');
    if (roleMissing && requesterId) {
      try {
        const { getUser } = await import('../services/dataStore');
        const me = await getUser(requesterId);
        if (me) {
          const mine = [
            me.primaryRole,
            ...(Array.isArray(me.secondaryRoles) ? me.secondaryRoles : []),
            ...(Array.isArray(me.rolesOffered) ? me.rolesOffered : []),
            ...(Array.isArray(me.professions) ? me.professions : []),
          ]
            .map((r: any) => String(r || '').trim())
            .filter(Boolean);
          if (mine.length) {
            data.roles = Array.from(new Set(mine));
            data.role = mine[0];
          }
        }
      } catch (e: any) {
        console.warn('[ai-match] requester role fallback failed:', e?.message || e);
      }
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

    const isRemoteLike = (s: string) =>
      /remote|worldwide|anywhere|open to travel|work from anywhere|global/i.test(s || '');

    if (extractedCity) {
      locationSource = 'explicit';
      if (isRemoteLike(extractedCity)) {
        data.location = { city: 'not_specified' };
        locationSource = 'none';
      }
    } else if (
      typeof req.body?.sessionLocation === 'string' &&
      req.body.sessionLocation.trim() &&
      !/(all location|all over|anywhere|worldwide|remote|search all)/i.test(String(
        [...(req.body?.messages || [])].reverse().find((m: any) => m.role === 'user')?.content || ''
      ))
    ) {
      const s = req.body.sessionLocation.trim();
      if (isRemoteLike(s)) {
        data.location = { city: 'not_specified' };
        locationSource = 'none';
      } else {
        data.location = { city: s };
        locationSource = 'session';
      }
    } else if (bodyLoc) {
      if (isRemoteLike(bodyLoc)) {
        data.location = { city: 'not_specified' };
        locationSource = 'none';
      } else {
        data.location = { city: bodyLoc };
        locationSource = 'profile';
      }
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

    const classicCandidates = filterRecommendableResults(
      (searchResult.results || []).map((c: any) => ({
        userId: c.creatorId,
        creatorId: c.creatorId,
        score: c.score,
        matchReasons: c.reasons,
        scoreBreakdown: c.scoreBreakdown,
        profile: {
          ...(c.profile || {}),
          id: c.profile?.id || c.creatorId,
          applicationStatus: c.profile?.applicationStatus,
          profileCompleted: c.profile?.profileCompleted,
        },
      }))
    );

    res.json({
      success: true,
      understanding: data,
      understandingSource: 'engine-gemini',
      locationSource,
      activeLocation: activeCity,
      relaxed: searchResult.relaxed || [],
      candidates: classicCandidates,
      results: classicCandidates,
      showCards: classicCandidates.length > 0,
      conversational: false,
    });
  } catch (err: any) {
    console.error('[recommendations/ai-match]', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed' });
  }
});
