/**
 * Multi-turn film production chatbot:
 * - Answer filmmaking / crew questions
 * - Guide project → roles → budget → matches
 * - Rental / equipment hints in the user's area (from connected creators when available)
 */
import { generateContentWithFallback } from './geminiClient';
import { getAdminDb, isFirebaseAdminReady } from './firebaseAdmin';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type ProductionDraft = {
  projectType?: string;
  genre?: string;
  location?: string;
  budgetInr?: number | null;
  budgetNote?: string;
  rolesNeeded: string[];
  equipmentNeeded: string[];
  rentalQuery?: string;
  stage:
    | 'idle'
    | 'gathering_project'
    | 'gathering_budget'
    | 'gathering_roles'
    | 'ready_to_match'
    | 'rental'
    | 'general';
};

export type FilmChatResult = {
  message: string;
  intent:
    | 'chat'
    | 'help'
    | 'production_plan'
    | 'crew_advice'
    | 'rental'
    | 'match_creators'
    | 'general';
  draft: ProductionDraft;
  rolesSuggested: string[];
  shouldSearchCreators: boolean;
  searchRoles: string[];
  searchLocation?: string;
  suggestedFollowUps: string[];
  rentalSuggestions: Array<{ title: string; detail: string; area?: string }>;
  modelUsed?: string;
};

const CREW_BY_PROJECT: Record<string, string[]> = {
  short_film: [
    'Director',
    'Director of Photography (DP)',
    '1st Assistant Director',
    'Sound Recordist',
    'Gaffer',
    'Editor',
    'Production Designer',
    'Makeup Artist',
  ],
  feature: [
    'Director',
    'Producer',
    'Director of Photography (DP)',
    '1st AD',
    'Production Manager',
    'Sound Designer',
    'Gaffer',
    'Key Grip',
    'Editor',
    'Colorist',
    'Production Designer',
    'Costume Designer',
  ],
  commercial: [
    'Director',
    'Producer',
    'DP',
    '1st AD',
    'Gaffer',
    'Sound Recordist',
    'Editor',
    'Colorist',
    'Art Director',
  ],
  music_video: [
    'Director',
    'DP',
    'Editor',
    'Colorist',
    'Gaffer',
    'Choreographer',
    'Art Director',
  ],
  documentary: [
    'Director',
    'DP / Camera Operator',
    'Sound Recordist',
    'Editor',
    'Producer',
    'Researcher',
  ],
  wedding_event: [
    'Lead Videographer',
    'Second Camera',
    'Sound',
    'Editor',
    'Drone Operator',
  ],
  default: [
    'Director',
    'DP',
    'Sound Recordist',
    'Editor',
    'Gaffer',
    'Production Assistant',
  ],
};

function detectProjectType(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/music\s*video|mv\b/.test(t)) return 'music_video';
  if (/documentary|docu\b/.test(t)) return 'documentary';
  if (/commercial|ad film|brand film|tvC|advert/.test(t)) return 'commercial';
  if (/wedding|event shoot|corporate event/.test(t)) return 'wedding_event';
  if (/feature\s*film|full length/.test(t)) return 'feature';
  if (/short\s*film|short\b/.test(t)) return 'short_film';
  if (/film|movie|shoot|production|project/.test(t)) return 'short_film';
  return undefined;
}

function extractBudgetInr(text: string): number | null {
  const t = text.replace(/,/g, '').toLowerCase();
  const lakh = t.match(/(\d+(?:\.\d+)?)\s*lakh/);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  const cr = t.match(/(\d+(?:\.\d+)?)\s*(cr|crore)/);
  if (cr) return Math.round(parseFloat(cr[1]) * 10000000);
  const inr = t.match(/(?:₹|rs\.?|inr)\s*(\d{4,9})/);
  if (inr) return parseInt(inr[1], 10);
  const plain = t.match(/\b(\d{5,9})\b/);
  if (plain && /(budget|₹|rs|inr|lakh|spend)/.test(t)) return parseInt(plain[1], 10);
  return null;
}

function isRentalIntent(text: string): boolean {
  return /(rent|rental|on hire|hire gear|hire camera|equipment|lens|gimbal|light kit|studio space|sound stage)/i.test(
    text
  );
}

function isCrewAdviceIntent(text: string): boolean {
  return /(what (crew|team|roles)|who do i need|crew list|department|how many people|staffing)/i.test(
    text
  );
}

function mergeDraft(prev: ProductionDraft | undefined, userText: string): ProductionDraft {
  const base: ProductionDraft = {
    rolesNeeded: [],
    equipmentNeeded: [],
    stage: 'idle',
    ...(prev || {}),
  };
  const type = detectProjectType(userText);
  if (type) base.projectType = type;

  const budget = extractBudgetInr(userText);
  if (budget != null) {
    base.budgetInr = budget;
    base.budgetNote = userText.slice(0, 120);
  }

  if (isRentalIntent(userText)) {
    base.stage = 'rental';
    base.rentalQuery = userText.slice(0, 240);
  } else if (type && base.budgetInr == null && !/\d/.test(userText)) {
    base.stage = 'gathering_budget';
  } else if (type && (!base.rolesNeeded.length || /role|crew|team|need a |need an /i.test(userText))) {
    if (!base.rolesNeeded.length) {
      base.rolesNeeded = [...(CREW_BY_PROJECT[type] || CREW_BY_PROJECT.default)].slice(0, 6);
    }
    base.stage = base.budgetInr != null ? 'ready_to_match' : 'gathering_roles';
  } else if (base.rolesNeeded.length && base.budgetInr != null) {
    base.stage = 'ready_to_match';
  } else if (isCrewAdviceIntent(userText)) {
    base.stage = 'gathering_project';
  } else if (!type && !isRentalIntent(userText)) {
    base.stage = base.stage === 'idle' ? 'general' : base.stage;
  }

  // Location hints
  const loc = userText.match(
    /\b(mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|goa|jaipur|ahmedabad|london|la|los angeles|new york|dubai)\b/i
  );
  if (loc) base.location = loc[1];

  return base;
}

function formatBudget(n?: number | null): string {
  if (n == null) return 'not set';
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)} lakh`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function buildSystemPrompt(draft: ProductionDraft, profileSummary: string): string {
  return `You are Afflatus Assistant — a practical film & production collaborator chatbot for creators in India and worldwide.

Your job:
1. Talk like a helpful production coordinator, not a generic chatbot.
2. Answer filmmaking questions (crew, departments, gear, workflow, roles).
3. When someone is making a project: clarify type → suggest crew → ask budget if missing → then offer to find multi-skilled people on Afflatus.
4. For rentals/equipment: suggest what to rent and that Afflatus can point to people/places in their network/area (do not invent shop names or phone numbers).
5. Never invent real creator names, emails, or that a person exists on the platform.
6. Keep replies concise (short paragraphs or bullets). Ask at most 1–2 questions at a time.
7. If ready to match creators, end with a clear line that you can search Afflatus for those roles.

Current production draft (may be partial):
${JSON.stringify(draft, null, 0)}

User profile summary: ${profileSummary || 'unknown'}

Respond in plain text for the user. Do not output JSON.`;
}

async function loadProfileSummary(userId?: string): Promise<string> {
  if (!userId || !isFirebaseAdminReady()) return '';
  try {
    const snap = await getAdminDb().collection('users').doc(userId).get();
    if (!snap.exists) return '';
    const u = snap.data() as any;
    return [
      u.name && `name=${u.name}`,
      u.primaryRole && `role=${u.primaryRole}`,
      u.location && `location=${u.location}`,
      Array.isArray(u.skills) && u.skills.length && `skills=${u.skills.slice(0, 8).join('|')}`,
    ]
      .filter(Boolean)
      .join(', ');
  } catch {
    return '';
  }
}

/** Creators in same city who mention gear/rent in bio — soft rental hints only */
async function softRentalHints(
  location?: string,
  query?: string
): Promise<Array<{ title: string; detail: string; area?: string }>> {
  if (!isFirebaseAdminReady()) return [];
  try {
    const db = getAdminDb();
    let snap;
    if (location) {
      snap = await db.collection('users').where('location', '>=', location).limit(30).get();
    } else {
      snap = await db.collection('users').limit(40).get();
    }
    const q = (query || '').toLowerCase();
    const hints: Array<{ title: string; detail: string; area?: string }> = [];
    for (const doc of snap.docs) {
      const u = doc.data() as any;
      const blob = `${u.bio || ''} ${u.primaryRole || ''} ${(u.skills || []).join(' ')}`.toLowerCase();
      const loc = String(u.location || '');
      const locOk = !location || loc.toLowerCase().includes(location.toLowerCase());
      const gearOk =
        /camera|lens|light|gimbal|rent|gear|equipment|studio|blackmagic|red |arri|sony fx|atomos/.test(
          blob
        ) || /rent|gear|equipment|camera|light/.test(q);
      if (locOk && gearOk && u.name) {
        hints.push({
          title: String(u.name),
          detail: [u.primaryRole, u.bio ? String(u.bio).slice(0, 120) : '']
            .filter(Boolean)
            .join(' — '),
          area: loc || undefined,
        });
      }
      if (hints.length >= 5) break;
    }
    return hints;
  } catch {
    return [];
  }
}

/**
 * Main multi-turn film chat turn.
 */
export async function handleFilmProductionTurn(params: {
  messages: ChatMessage[];
  userId?: string;
  previousDraft?: ProductionDraft;
}): Promise<FilmChatResult> {
  const lastUser =
    [...params.messages].reverse().find((m) => m.role === 'user')?.content?.trim() || '';
  const draft = mergeDraft(params.previousDraft, lastUser);
  // Recover plan from earlier turns when user only says "yes" / "find people"
  if (!draft.projectType || !draft.rolesNeeded.length) {
    const blob = params.messages.map((m) => m.content).join('\n');
    if (!draft.projectType) {
      const t = detectProjectType(blob);
      if (t) draft.projectType = t;
    }
    if (!draft.rolesNeeded.length && draft.projectType) {
      draft.rolesNeeded = [...(CREW_BY_PROJECT[draft.projectType] || CREW_BY_PROJECT.default)].slice(0, 8);
    }
    if (draft.budgetInr == null) {
      const b = extractBudgetInr(blob);
      if (b != null) draft.budgetInr = b;
    }
    if (!draft.location) {
      const loc = blob.match(
        /\b(mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|goa|jaipur|ahmedabad|madhya pradesh|indore|bhopal)\b/i
      );
      if (loc) draft.location = loc[1];
    }
  }
  if (/(all location|all over|anywhere|worldwide|remote|no location|any city|search all)/i.test(lastUser)) {
    draft.location = undefined;
  }
  const profileSummary = await loadProfileSummary(params.userId);


  if (draft.projectType && draft.rolesNeeded.length === 0) {
    draft.rolesNeeded = [...(CREW_BY_PROJECT[draft.projectType] || CREW_BY_PROJECT.default)].slice(
      0,
      8
    );
  }

  let rentalSuggestions: FilmChatResult['rentalSuggestions'] = [];
  if (draft.stage === 'rental' || isRentalIntent(lastUser)) {
    rentalSuggestions = await softRentalHints(draft.location, draft.rentalQuery || lastUser);
  }

  const historyText = params.messages
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const systemInstruction = buildSystemPrompt(draft, profileSummary);

  const userPrompt = `Conversation so far:
${historyText}

Latest user message: ${lastUser}

Write the next assistant reply. If suggesting crew, list roles as bullets. If budget is missing for a project, ask for it. If they asked about rentals, give practical rental categories and mention any network hints without inventing shops.`;

  let message = '';
  let modelUsed: string | undefined;

  try {
    const ai = await generateContentWithFallback(
      {
        contents: userPrompt,
        systemInstruction,
        temperature: 0.4,
      },
      '[FilmChat]'
    );
    if (ai?.text) {
      message = ai.text.trim();
      modelUsed = ai.model;
    } else {
      message = buildDeterministicReply(draft, lastUser, rentalSuggestions);
    }
  } catch (err: any) {
    console.warn('[FilmChat] Gemini unavailable, deterministic reply:', err?.message || err);
    message = buildDeterministicReply(draft, lastUser, rentalSuggestions);
  }

  // Recommend people only when the user is asking for people / matches — not during pure planning chat.
  const t = lastUser.toLowerCase().trim();
  const affirmative =
    /^(yes|yeah|yep|ok|okay|sure|please|go ahead|do it|proceed|start|pull|send)([.!\s]|$)/i.test(t) ||
    /^(yes|yeah|ok|okay|sure)/.test(t);
  const explicitPeopleAsk =
    /(find (me )?(all )?(of )?(them|people|crew|creators|members|talent)|find people|find all|show (me )?(people|creators|matches|profiles|cards)|suggest (me )?(all |those )?(people|creators|matches|someone|profiles|cards|crew)|recommend (people|creators|someone|profiles|crew)|pull (the )?profiles|show cards|through cards|search (on )?afflatus|search all|all location|all over|remote|worldwide|look for (a |an |some )?(dp|editor|director|people|crew)|connect me|match me|assemble|get me (the )?(team|crew|people)|crew members)/i.test(
      lastUser
    ) ||
    (/\b(people|creators|candidates|profiles|cards|crew)\b/i.test(lastUser) &&
      /(find|show|suggest|recommend|search|need|get|hire|pull)/i.test(lastUser)) ||
    (/\b(them|these roles|those roles)\b/i.test(lastUser) &&
      /(find|show|get|need|all|suggest)/i.test(lastUser));

  // "yes" after we already have a production plan / roles = start matching
  const confirmAfterPlan =
    affirmative &&
    (draft.rolesNeeded.length > 0 ||
      !!draft.projectType ||
      draft.stage === 'ready_to_match' ||
      draft.stage === 'gathering_roles');

  const shouldSearchCreators = explicitPeopleAsk || confirmAfterPlan;

  const fromText = guessRolesFromText(lastUser);
  const searchRoles = (
    fromText.length > 0
      ? fromText
      : draft.rolesNeeded.length > 0
        ? draft.rolesNeeded
        : ['Director', 'Director of Photography', 'Editor', 'Sound Recordist']
  ).slice(0, 6);

  const suggestedFollowUps: string[] = [];
  if (draft.stage === 'gathering_budget' || (draft.projectType && draft.budgetInr == null)) {
    suggestedFollowUps.push('Budget is around 2 lakh INR');
  }
  if (draft.rolesNeeded.length) {
    suggestedFollowUps.push('Find people on Afflatus for these roles');
  }
  if (draft.stage === 'rental') {
    suggestedFollowUps.push('Camera and lighting rental near me');
  }
  suggestedFollowUps.push('What crew do I need for a short film?');

  return {
    message,
    intent: shouldSearchCreators
      ? 'match_creators'
      : draft.stage === 'rental'
        ? 'rental'
        : draft.projectType
          ? 'production_plan'
          : isCrewAdviceIntent(lastUser)
            ? 'crew_advice'
            : 'general',
    draft,
    rolesSuggested: draft.rolesNeeded,
    shouldSearchCreators,
    searchRoles,
    searchLocation: draft.location,
    suggestedFollowUps: suggestedFollowUps.slice(0, 4),
    rentalSuggestions,
    modelUsed,
  };
}

function guessRolesFromText(text: string): string[] {
  const roles: string[] = [];
  const t = text.toLowerCase();
  if (/dp|cinematograph|dop|director of photography/.test(t)) roles.push('Director of Photography');
  if (/editor|edit\b|davinci|premiere/.test(t)) roles.push('Editor');
  if (/sound|audio|recordist|boom/.test(t)) roles.push('Sound Recordist');
  if (/gaffer|lighting/.test(t)) roles.push('Gaffer');
  if (/director\b/.test(t) && !/photography/.test(t)) roles.push('Director');
  if (/producer/.test(t)) roles.push('Producer');
  return roles;
}

function buildDeterministicReply(
  draft: ProductionDraft,
  lastUser: string,
  rentals: FilmChatResult['rentalSuggestions']
): string {
  if (draft.stage === 'rental' || isRentalIntent(lastUser)) {
    const lines = [
      'For rentals, think in kits: camera body + lenses, lighting (LED panels / fresnels), sound (wireless lavs + recorder), and support (tripod / gimbal).',
      draft.location
        ? `I’ll prioritize people and leads around ${draft.location} in your Afflatus network.`
        : 'Tell me your city so I can narrow to your area.',
    ];
    if (rentals.length) {
      lines.push('People on Afflatus who may help with gear or local knowledge:');
      rentals.forEach((r) => lines.push(`• ${r.title}${r.area ? ` (${r.area})` : ''} — ${r.detail}`));
    } else {
      lines.push(
        'I could not pull strong gear-tagged profiles yet. Once creators list equipment in their profile, I can match them here.'
      );
    }
    return lines.join('\n');
  }

  if (draft.projectType || isCrewAdviceIntent(lastUser)) {
    const roles =
      draft.rolesNeeded.length > 0
        ? draft.rolesNeeded
        : CREW_BY_PROJECT[draft.projectType || 'default'];
    const typeLabel = (draft.projectType || 'film project').replace(/_/g, ' ');
    const parts = [
      `For a typical ${typeLabel}, start with this core crew:`,
      ...roles.map((r) => `• ${r}`),
      draft.budgetInr != null
        ? `Budget noted: ${formatBudget(draft.budgetInr)}. I can look for multi-role creators who fit that range.`
        : 'What is your approximate budget (INR)? That changes whether you hire separate departments or multi-role people.',
      'Say “find people on Afflatus” when you want role matches.',
    ];
    return parts.join('\n');
  }

  return (
    "I can help plan film & production work: crew lists, budget trade-offs, role suggestions, rentals in your area, and finding people on Afflatus.\n" +
    'Try: “I am making a short film in Mumbai” or “What crew do I need for a commercial?” or “Camera rental near Delhi.”'
  );
}
