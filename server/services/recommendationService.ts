import { queryUsersByRoles, queryUsersByCity, listUsers } from './dataStore';
import type { DBUser } from '../types';
import { RECOMMENDATION_WEIGHTS } from './recommendationWeights';

const METRO_CITIES = [
  'mumbai', 'delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai',
  'kolkata', 'pune', 'ahmedabad', 'jaipur', 'chandigarh', 'kochi', 'goa',
];

const STATE_HINTS: Record<string, string[]> = {
  maharashtra: ['mumbai', 'pune', 'nagpur', 'nashik'],
  karnataka: ['bengaluru', 'bangalore', 'mysuru'],
  'tamil nadu': ['chennai', 'coimbatore'],
  telangana: ['hyderabad'],
  'west bengal': ['kolkata'],
  delhi: ['delhi', 'noida', 'gurgaon', 'gurugram', 'ghaziabad'],
  ncr: ['delhi', 'noida', 'gurgaon', 'gurugram'],
  madhya: ['bhopal', 'indore', 'gwalior'],
  bhopal: ['bhopal', 'indore'],
};

const TRAIT_KEYWORDS: Record<string, string[]> = {
  creativity: ['creative', 'innovat', 'imagin', 'vision', 'artistic', 'original'],
  communication: ['communicat', 'listen', 'speak', 'articulat', 'discuss', 'proactiv'],
  reliability: ['reliab', 'dependab', 'consist', 'deadline', 'punctual', 'deliver'],
  flexibility: ['flexib', 'adapt', 'versatil', 'open-mind', 'agile'],
  teamwork: ['team', 'collaborat', 'together', 'cooperat', 'collective', 'partner'],
  feedback_openness: ['feedback', 'growth mindset', 'criticism', 'learn', 'open to'],
  leadership: ['lead', 'manag', 'direct', 'guid', 'mentor'],
  technical_proficiency: ['technic', 'expert', 'proficien', 'skill', 'master', 'speciali'],
};

function normalizeRole(r: string) {
  // Space-preserving normalize (for keywords / display logic)
  return (r || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[&+/|,;:_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical form for exact role equality: "Script Writer" === "scriptwriter" === "Script-Writer" */
function canonicalizeRole(r: string): string {
  return normalizeRole(r).replace(/\s+/g, '');
}

/**
 * Split compound role fields into components, then canonicalize each.
 * "Scriptwriter/Supervisor" → ["scriptwriter", "supervisor"]
 */
function roleCanonicalTokens(r: string): string[] {
  const raw = (r || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/[/|,;&]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tokens = new Set<string>();
  for (const part of parts.length ? parts : [raw]) {
    const c = canonicalizeRole(part);
    if (c) tokens.add(c);
  }
  // Full field as one token too (harmless if same)
  const full = canonicalizeRole(raw);
  if (full) tokens.add(full);
  return Array.from(tokens);
}

function roleKeywords(r: string) {
  return normalizeRole(r).split(' ').filter((w) => w.length > 2);
}
function cityKey(loc: string) {
  return (loc || '').toLowerCase().trim();
}
function userRoleStrings(user: any): string[] {
  return [
    user.primaryRole || '',
    ...(user.secondaryRoles || []),
    ...(user.rolesOffered || []),
    ...(user.professions || []),
  ].filter(Boolean);
}

/** All canonical role tokens for a user (primary + secondary + compound splits). */
function userRoleCanonicalSet(user: any): Set<string> {
  const set = new Set<string>();
  for (const r of userRoleStrings(user)) {
    for (const t of roleCanonicalTokens(r)) set.add(t);
  }
  return set;
}

/** Expand a requested role into related titles for DB-level related_roles stage (not strict). */
function expandRelatedRoleTitles(wantedRoles: string[]): string[] {
  const RELATED: Record<string, string[]> = {
    'camera operator': ['Camera Operator', 'Cameraman', 'Camera Assistant', '1st AC', '2nd AC', 'Focus Puller'],
    cameraman: ['Camera Operator', 'Cameraman', 'Cinematographer'],
    cinematographer: ['Cinematographer', 'Director of Photography', 'DP', 'DoP'],
    dp: ['Cinematographer', 'Director of Photography', 'DP', 'DoP'],
    editor: ['Editor', 'Video Editor', 'Film Editor', 'Assistant Editor'],
    'video editor': ['Editor', 'Video Editor', 'Film Editor'],
    director: ['Director', 'Assistant Director', '1st AD', '2nd AD'],
    'sound designer': ['Sound Designer', 'Sound Engineer', 'Audio Engineer', 'Boom Operator'],
    'sound engineer': ['Sound Designer', 'Sound Engineer', 'Audio Engineer'],
    producer: ['Producer', 'Line Producer', 'Executive Producer', 'Associate Producer'],
    'creative director': ['Creative Director', 'Art Director', 'Director'],
    photographer: ['Photographer', 'Photojournalist', 'Fashion Photographer'],
  };
  const out = new Set<string>();
  for (const wr of wantedRoles) {
    out.add(wr);
    const key = normalizeRole(wr);
    for (const [k, vals] of Object.entries(RELATED)) {
      if (key.includes(k) || k.includes(key)) {
        vals.forEach((v) => out.add(v));
      }
    }
  }
  return Array.from(out);
}

function rolesOverlap(wanted: string, candidateRoles: string[]): 'exact' | 'related' | 'none' {
  const wantTokens = roleCanonicalTokens(wanted);
  if (!wantTokens.length) return 'none';

  // Build candidate token set from provided role strings (already primary+secondary when from userRoleStrings)
  const candTokens = new Set<string>();
  for (const r of candidateRoles) {
    for (const tok of roleCanonicalTokens(r)) candTokens.add(tok);
  }

  // STEP: exact canonical match first (never skip to related)
  if (wantTokens.some((w) => candTokens.has(w))) return 'exact';

  // Related only if no exact match — keyword overlap on normalized spaced form
  const ww = roleKeywords(wanted);
  for (const r of candidateRoles) {
    const n = normalizeRole(r);
    if (!n) continue;
    const cw = roleKeywords(r);
    // Require meaningful shared keyword (length > 2), but not pure substring of entire role
    if (ww.some((w) => cw.includes(w))) return 'related';
  }
  return 'none';
}


function estimateTraitScore(user: any, trait: string): { value: number; source: string } {
  const cp = user.collaborationProfile;
  // Prefer Gemini-scored traits from onboarding scenario answers
  if (cp && typeof cp[trait] === 'number' && Number(cp[trait]) > 0) {
    return { value: Number(cp[trait]), source: 'collaborationProfile' };
  }
  // Fallback: keyword evidence from raw scenario answers + bio
  const sc = user.collaborationScenarios || {};
  const scenarioText = [sc.q1, sc.q2, sc.q3, sc.q4, sc.q5, user.bio]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!scenarioText) return { value: 5, source: 'default' };
  const keywords = TRAIT_KEYWORDS[trait] || [trait];
  const matchCount = keywords.filter((kw) => scenarioText.includes(kw)).length;
  if (matchCount >= 2) return { value: 8.5, source: 'scenarios' };
  if (matchCount === 1) return { value: 7, source: 'scenarios' };
  return { value: 5, source: 'default' };
}

function experienceContributionScore(user: any, wantedRoles: string[], projectType?: string) {
  const reasons: string[] = [];
  let score = 0;
  const past = Array.isArray(user.pastProjects) ? user.pastProjects : [];
  const completedCollabs = Number(user.experience?.projectsCompleted) || 0;
  const relevantPast = past.filter((p: any) => {
    const roleHit = wantedRoles.some((wr) => rolesOverlap(wr, [p.role || '']) !== 'none');
    const typeHit =
      projectType &&
      projectType !== 'not_specified' &&
      String(p.projectType || '').toLowerCase().includes(String(projectType).toLowerCase());
    const genreHit =
      projectType &&
      Array.isArray(p.genres) &&
      p.genres.some((g: string) => String(projectType).toLowerCase().includes(String(g).toLowerCase()));
    return roleHit || typeHit || genreHit;
  });
  if (relevantPast.length > 0) {
    const n = relevantPast.length;
    score += Math.min(0.7, 1 - Math.exp(-n / 4));
    reasons.push(`${n} relevant project${n > 1 ? 's' : ''} on profile`);
  } else if (completedCollabs > 0) {
    score += Math.min(0.35, 1 - Math.exp(-completedCollabs / 8));
    reasons.push('Self-reported completed projects');
  }
  const fb = Number(user.collaborationProfile?.feedbackCount) || 0;
  if (fb > 0) {
    score += Math.min(0.25, fb * 0.05);
    reasons.push(`${fb} collaboration feedback${fb > 1 ? 's' : ''}`);
  }
  const years = Number(user.experience?.yearsActive || user.yearsExperience) || 0;
  if (years > 0 && score > 0) score += Math.min(0.15, years / 40);
  return { score: Math.min(1, score), reasons };
}

function behaviouralScore(user: any, prefs: Record<string, { level?: string; importance?: string }>) {
  const active = Object.entries(prefs || {}).filter(([, v]) => v && v.level && v.level !== 'not_specified');
  if (!active.length) {
    const cp = user.collaborationProfile;
    if (cp && typeof cp.reliability === 'number') {
      const traits = ['reliability', 'communication', 'teamwork', 'creativity', 'flexibility', 'feedback_openness', 'leadership', 'technical_proficiency'];
      const vals = traits.map((t) => (typeof cp[t] === 'number' ? cp[t] : 5));
      return { score: vals.reduce((a, b) => a + b, 0) / vals.length / 10, reasons: [] as string[] };
    }
    return { score: 0.5, reasons: [] as string[] };
  }
  let total = 0, weightSum = 0;
  const reasons: string[] = [];
  for (const [key, v] of active) {
    const { value, source } = estimateTraitScore(user, key);
    const w = v.importance === 'required' ? 1 : v.importance === 'preferred' ? 0.7 : 0.4;
    let m = 0.5;
    if (v.level === 'high') m = value / 10;
    else if (v.level === 'mid') m = value >= 4 && value <= 8 ? 0.8 : 0.4;
    else if (v.level === 'low') m = (10 - value) / 10;
    total += m * w;
    weightSum += w;
    if (m >= 0.7 && source !== 'default') reasons.push(`Strong ${key.replace(/_/g, ' ')}`);
  }
  return { score: weightSum ? total / weightSum : 0.5, reasons };
}

function projectRelevanceScore(user: any, projectType?: string, genres?: string[]) {
  const reasons: string[] = [];
  if ((!projectType || projectType === 'not_specified') && (!genres || !genres.length)) {
    return { score: 0.5, reasons };
  }
  const blob = [
    user.bio || '',
    ...(user.specialtyTags || []),
    JSON.stringify(user.interests || {}),
    JSON.stringify(user.skills || {}),
    ...(Array.isArray(user.pastProjects)
      ? user.pastProjects.flatMap((p: any) => [p.projectType, ...(p.genres || []), p.description])
      : []),
  ].join(' ').toLowerCase();
  let hits = 0, checks = 0;
  if (projectType && projectType !== 'not_specified') {
    checks++;
    if (blob.includes(String(projectType).toLowerCase())) {
      hits++;
      reasons.push(`Relevant to ${projectType}`);
    }
  }
  for (const g of genres || []) {
    checks++;
    if (blob.includes(String(g).toLowerCase())) {
      hits++;
      reasons.push(`${g} experience`);
    }
  }
  if (!checks) return { score: 0.5, reasons };
  return { score: hits / checks, reasons };
}

function locationTravelScore(user: any, wantedCity?: string, seekerTravel?: string) {
  const userLoc = cityKey(user.location || user.city || '');
  const want = cityKey(wantedCity || '');
  const travel = (user.travelPreference || seekerTravel || 'within_city') as string;
  if (!want || want === 'not_specified') return { score: 0.7, reasons: [] as string[], tier: 'unspecified' };
  if (userLoc.includes(want) || want.includes(userLoc.split(',')[0])) {
    return { score: 1, reasons: [`Based in ${user.location || user.city}`], tier: 'exact' };
  }
  if (travel === 'remote_only') return { score: 0.15, reasons: [], tier: 'remote_only_mismatch' };
  if (travel === 'within_city') return { score: 0.1, reasons: [], tier: 'outside_city' };
  if (travel === 'nearby_metro' || travel === 'nearby_cities') {
    const uMetro = METRO_CITIES.some((m) => userLoc.includes(m));
    const wMetro = METRO_CITIES.some((m) => want.includes(m));
    if (uMetro && wMetro) return { score: 0.65, reasons: ['Metro-city flexibility'], tier: 'metro' };
  }
  if (travel === 'nearby_states' || travel === 'nearby_cities' || travel === 'nearby_metro') {
    for (const [region, cities] of Object.entries(STATE_HINTS)) {
      const regionMatch = want.includes(region) || cities.some((c) => want.includes(c));
      const userMatch = userLoc.includes(region) || cities.some((c) => userLoc.includes(c));
      if (regionMatch && userMatch) {
        return { score: travel === 'nearby_states' ? 0.7 : 0.55, reasons: ['Nearby region'], tier: 'region' };
      }
    }
  }
  if (travel === 'anywhere') return { score: 0.5, reasons: ['Open to travel'], tier: 'anywhere' };
  return { score: 0.2, reasons: [], tier: 'distant' };
}

function roleMatchScore(user: any, wantedRoles: string[]) {
  const candidateRoles = userRoleStrings(user);
  const matched: string[] = [];
  const related: string[] = [];
  if (!wantedRoles.length) return { score: 0.5, reasons: [] as string[], matched, related };
  for (const wr of wantedRoles) {
    const o = rolesOverlap(wr, candidateRoles);
    if (o === 'exact') matched.push(wr);
    else if (o === 'related') related.push(wr);
  }
  const score = Math.min(1, (matched.length / wantedRoles.length) * 1.0 + (related.length / wantedRoles.length) * 0.45);
  const reasons: string[] = [];
  if (matched.length > 1) reasons.push(`Matches ${matched.join(' and ')} roles`);
  else if (matched.length === 1) reasons.push(`Matches ${matched[0]} role`);
  if (related.length) reasons.push(`Related: ${related.join(', ')}`);
  return { score, reasons, matched, related };
}

function availabilityScore(user: any) {
  const a = user.availability;
  if (!a) return 0.5;
  if (a.status === 'available') return 1;
  if (a.status === 'busy') return 0.25;
  return 0.5;
}

export class RecommendationService {
  static async searchFromRequirements(requirements: any, requesterId?: string | null) {
    let wantedRoles: string[] = [];
    if (Array.isArray(requirements.roles) && requirements.roles.length) {
      wantedRoles = requirements.roles.map((r: string) => String(r).trim()).filter(Boolean);
    } else if (requirements.role && requirements.role !== 'not_specified') {
      wantedRoles = [String(requirements.role).trim()];
    }

    const wantedCity =
      requirements.location?.city && requirements.location.city !== 'not_specified'
        ? requirements.location.city
        : null;
    const projectType = requirements.project_type;
    const genres: string[] = Array.isArray(requirements.genres) ? requirements.genres : [];
    const prefs = requirements.preferences || {};
    const seekerTravel = requirements.travelPreference || requirements.seekerTravelPreference;
    const W = RECOMMENDATION_WEIGHTS;
    const relaxed: string[] = [];

    /**
     * DB-level (or memory-filtered) candidate fetch for one relaxation stage.
     * Never loads the full user table for role searches.
     */
    const fetchEligible = async (
      roleMode: 'strict' | 'related' | 'any',
      locMode: 'strict' | 'soft' | 'off'
    ): Promise<any[]> => {
      let users: any[] = [];

      if (wantedRoles.length && roleMode === 'strict') {
        users = await queryUsersByRoles(wantedRoles, { excludeUserId: requesterId, limitPerQuery: 200 });
      } else if (wantedRoles.length && roleMode === 'related') {
        const expanded = expandRelatedRoleTitles(wantedRoles);
        users = await queryUsersByRoles(expanded, { excludeUserId: requesterId, limitPerQuery: 200 });
      } else if (wantedCity && (locMode === 'strict' || locMode === 'soft')) {
        // Role unconstrained — try structured city fields only
        users = await queryUsersByCity(wantedCity, { excludeUserId: requesterId, limitPerQuery: 200 });
      } else {
        // No role and no city: limited list only (cannot query all users forever)
        users = ((await listUsers(200)) as DBUser[]).filter((u) => u?.id && u.id !== requesterId);
      }

      // Strict location = base city match only (travelPreference does NOT count as "based in city")
      if (wantedCity && locMode === 'strict') {
        const want = cityKey(wantedCity);
        users = users.filter((u) => {
          const loc = cityKey((u as any).location || (u as any).city || (u as any).locationCity || '');
          return loc.includes(want) || want.includes(loc.split(',')[0]);
        });
      }

      // Related mode: keep exact + keyword-related only (exclude unrelated from expanded list)
      if (wantedRoles.length && roleMode === 'related') {
        users = users.filter((u) => {
          const { matched, related } = roleMatchScore(u, wantedRoles);
          return matched.length > 0 || related.length > 0;
        });
      }
      // Strict role mode: DB already constrained; tighten exact match on primary/secondary
      if (wantedRoles.length && roleMode === 'strict') {
        users = users.filter((u) => {
          const { matched } = roleMatchScore(u, wantedRoles);
          return matched.length > 0;
        });
      }

      return users;
    };

    const scorePool = (users: any[], roleMode: 'strict' | 'related' | 'any', locMode: 'strict' | 'soft' | 'off') => {
      let list = users;
      return list.map((user) => {
        const role = roleMatchScore(user, wantedRoles);
        const beh = behaviouralScore(user, prefs);
        const exp = experienceContributionScore(user, wantedRoles, projectType);
        const proj = projectRelevanceScore(user, projectType, genres);
        const loc = locationTravelScore(user, wantedCity || undefined, seekerTravel);
        const avail = availabilityScore(user);
        const locCombined = loc.score * 0.85 + avail * 0.15;
        const final =
          W.role * role.score +
          W.experience * exp.score +
          W.behavioural * beh.score +
          W.projectRelevance * proj.score +
          W.location * (locMode === 'off' ? 0.5 : locCombined);
        const reasons = [...role.reasons, ...beh.reasons, ...exp.reasons, ...proj.reasons, ...loc.reasons].filter(Boolean);
        return {
          user,
          final,
          reasons: reasons.length ? reasons : ['Possible collaborator'],
          parts: {
            role: role.score,
            experience: exp.score,
            behavioural: beh.score,
            projectRelevance: proj.score,
            location: locMode === 'off' ? 0.5 : locCombined,
          },
        };
      });
    };

    // Progressive stages — each stage queries eligible users at DB level first
    let scored = scorePool(await fetchEligible('strict', wantedCity ? 'strict' : 'off'), 'strict', wantedCity ? 'strict' : 'off');
    if (!scored.length && wantedRoles.length) {
      relaxed.push('related_roles');
      scored = scorePool(await fetchEligible('related', wantedCity ? 'strict' : 'off'), 'related', wantedCity ? 'strict' : 'off');
    }
    if (!scored.length && wantedCity) {
      relaxed.push('location');
      scored = scorePool(await fetchEligible('strict', 'soft'), 'strict', 'soft');
    }
    if (!scored.length && wantedRoles.length && wantedCity) {
      relaxed.push('related_roles_and_location');
      scored = scorePool(await fetchEligible('related', 'soft'), 'related', 'soft');
    }
    // Do NOT run unconstrained broad_search — that fabricates weak matches from the whole pool.
    // If still empty, return no candidates (honest empty state).

    // Drop candidates with essentially no role fit when roles were requested
    if (wantedRoles.length) {
      scored = scored.filter((c) => (c.parts?.role ?? 0) >= 0.25);
    }

    scored.sort((a, b) => b.final - a.final);
    const top = scored.slice(0, 10);

    return {
      results: top.map((c) => ({
        creatorId: c.user.id,
        score: Math.round(c.final * 1000) / 1000,
        reasons: c.reasons,
        scoreBreakdown: c.parts,
        profile: {
          id: c.user.id,
          name: c.user.name,
          avatarUrl: c.user.avatarUrl,
          primaryRole: c.user.primaryRole,
          secondaryRoles: c.user.secondaryRoles || [],
          location: (c.user as any).location || (c.user as any).city,
          bio: c.user.bio,
          travelPreference: (c.user as any).travelPreference,
        },
      })),
      relaxed,
      weights: W,
    };
  }
}
