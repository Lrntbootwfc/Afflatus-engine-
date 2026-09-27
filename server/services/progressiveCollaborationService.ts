/**
 * Progressive collaboration questions — next-set selection + signal derivation.
 * Complements (does not replace) onboarding scenario_q1–q5 and Explore scoring.
 */
import { Type } from '@google/genai';
import { generateContentWithFallback } from './geminiClient';
import {
  PROGRESSIVE_COLLAB_QUESTIONS,
  PROGRESSIVE_COLLAB_BY_ID,
  type ProgressiveCollabQuestion,
} from '../constants/progressiveCollaborationQuestions';
import { getAdminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const SET_SIZE = 5;

export type ProgressiveState = {
  answers: Record<string, string | string[]>;
  answeredIds: string[];
  answeredAt: Record<string, string>;
  setsCompleted: number;
  lastSetQuestionIds: string[];
  lastSetCompletedAt: string | null;
  signals: Record<string, number>;
  signalConfidence: Record<string, number>;
  /** Free-text style notes from Gemini — not public precision scores */
  signalNotes?: Record<string, string>;
  updatedAt?: string;
};

const EMPTY_STATE: ProgressiveState = {
  answers: {},
  answeredIds: [],
  answeredAt: {},
  setsCompleted: 0,
  lastSetQuestionIds: [],
  lastSetCompletedAt: null,
  signals: {},
  signalConfidence: {},
};

function asState(raw: any): ProgressiveState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  return {
    answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
    answeredIds: Array.isArray(raw.answeredIds) ? raw.answeredIds.map(String) : [],
    answeredAt: raw.answeredAt && typeof raw.answeredAt === 'object' ? raw.answeredAt : {},
    setsCompleted: Number(raw.setsCompleted) || 0,
    lastSetQuestionIds: Array.isArray(raw.lastSetQuestionIds) ? raw.lastSetQuestionIds.map(String) : [],
    lastSetCompletedAt: raw.lastSetCompletedAt || null,
    signals: raw.signals && typeof raw.signals === 'object' ? raw.signals : {},
    signalConfidence: raw.signalConfidence && typeof raw.signalConfidence === 'object' ? raw.signalConfidence : {},
    signalNotes: raw.signalNotes && typeof raw.signalNotes === 'object' ? raw.signalNotes : {},
    updatedAt: raw.updatedAt,
  };
}

export async function loadProgressiveState(userId: string): Promise<ProgressiveState> {
  const db = getAdminDb();
  const snap = await db.collection('users').doc(userId).get();
  const data = snap.exists ? snap.data() : null;
  return asState(data?.progressiveCollaboration);
}

/** Deterministic fallback when Gemini is unavailable */
function sequentialNextSet(answeredIds: string[]): ProgressiveCollabQuestion[] {
  const answered = new Set(answeredIds);
  return PROGRESSIVE_COLLAB_QUESTIONS.filter((q) => !answered.has(q.id)).slice(0, SET_SIZE);
}

/**
 * Gemini picks the most useful 5 unanswered questions given weak/missing signals.
 */
export async function selectNextQuestionSet(params: {
  userId: string;
  profileSummary?: Record<string, unknown>;
}): Promise<{
  questions: ProgressiveCollabQuestion[];
  remaining: number;
  answeredCount: number;
  total: number;
  selectionSource: 'gemini' | 'sequential';
}> {
  const state = await loadProgressiveState(params.userId);
  const answered = new Set(state.answeredIds);
  const remainingQs = PROGRESSIVE_COLLAB_QUESTIONS.filter((q) => !answered.has(q.id));
  const total = PROGRESSIVE_COLLAB_QUESTIONS.length;
  const answeredCount = state.answeredIds.length;

  if (remainingQs.length === 0) {
    return {
      questions: [],
      remaining: 0,
      answeredCount,
      total,
      selectionSource: 'sequential',
    };
  }

  if (!process.env.GEMINI_API_KEY || remainingQs.length <= SET_SIZE) {
    return {
      questions: sequentialNextSet(state.answeredIds),
      remaining: remainingQs.length,
      answeredCount,
      total,
      selectionSource: 'sequential',
    };
  }

  const catalog = remainingQs.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    signalTags: q.signalTags,
  }));

  const systemInstruction = `You select the next collaboration-behaviour questions for Afflatus, a creator collaboration platform.
Pick exactly ${SET_SIZE} question ids from the catalog (or fewer if fewer remain).
Goals:
- Prefer questions that strengthen WEAK or MISSING collaboration signals (low confidence or absent).
- Avoid overlapping the same signal when stronger evidence already exists.
- Prefer genuinely new information over re-asking known ground.
- Do NOT invent ids. Only use ids from the catalog.
Return JSON: { "questionIds": string[] }`;

  const prompt = JSON.stringify(
    {
      alreadyAnsweredIds: state.answeredIds,
      existingSignals: state.signals,
      signalConfidence: state.signalConfidence,
      profileHints: params.profileSummary || {},
      catalog,
      pickCount: Math.min(SET_SIZE, remainingQs.length),
    },
    null,
    2
  );

  try {
    const schema = {
      type: Type.OBJECT,
      properties: {
        questionIds: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['questionIds'],
    };
    const { text } = await generateContentWithFallback(
      {
        contents: prompt,
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
        useThinkingBudget: true,
      },
      '[ProgressiveCollabSelect]'
    );
    const parsed = JSON.parse(text);
    const ids: string[] = Array.isArray(parsed.questionIds) ? parsed.questionIds.map(String) : [];
    const picked: ProgressiveCollabQuestion[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id) || answered.has(id)) continue;
      const q = PROGRESSIVE_COLLAB_BY_ID[id];
      if (q) {
        picked.push(q);
        seen.add(id);
      }
      if (picked.length >= SET_SIZE) break;
    }
    if (picked.length < Math.min(SET_SIZE, remainingQs.length)) {
      for (const q of remainingQs) {
        if (seen.has(q.id)) continue;
        picked.push(q);
        seen.add(q.id);
        if (picked.length >= SET_SIZE) break;
      }
    }
    return {
      questions: picked.slice(0, SET_SIZE),
      remaining: remainingQs.length,
      answeredCount,
      total,
      selectionSource: 'gemini',
    };
  } catch (err: any) {
    console.warn('[ProgressiveCollabSelect] Gemini failed, sequential fallback', err?.message || err);
    return {
      questions: sequentialNextSet(state.answeredIds),
      remaining: remainingQs.length,
      answeredCount,
      total,
      selectionSource: 'sequential',
    };
  }
}

/** Derive soft collaboration signals from a submitted set (1–10 scale + confidence 0–1). */
export async function analyzeProgressiveAnswers(
  answers: Record<string, string | string[]>,
  prior: ProgressiveState
): Promise<{ signals: Record<string, number>; signalConfidence: Record<string, number>; signalNotes: Record<string, string> }> {
  const fallback = {
    signals: { ...prior.signals },
    signalConfidence: { ...prior.signalConfidence },
    signalNotes: { ...(prior.signalNotes || {}) },
  };

  if (!process.env.GEMINI_API_KEY) return fallback;

  const systemInstruction = `You analyze Afflatus collaboration-behaviour questionnaire answers.
Return soft signals on a 1–10 scale with confidence 0–1. Dimensions may include:
communication, reliability, initiative, ownership, adaptability, feedback_style,
independence, creative_compatibility, trust, working_structure, teamwork,
and qualities_valued_in_collaborators (as short notes only).

CRITICAL:
- Do NOT invent factual experience.
- Do NOT output public precision claims like "Reliability: 91/100".
- Low evidence → neutral ~5 and low confidence.
- Merge with prior signals when provided: raise confidence only with new evidence.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      signals: { type: Type.OBJECT },
      signalConfidence: { type: Type.OBJECT },
      signalNotes: { type: Type.OBJECT },
    },
  };

  try {
    const { text } = await generateContentWithFallback(
      {
        contents: JSON.stringify({ newAnswers: answers, priorSignals: prior.signals, priorConfidence: prior.signalConfidence }, null, 2),
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.3,
        useThinkingBudget: true,
      },
      '[ProgressiveCollabAnalyze]'
    );
    const parsed = JSON.parse(text);
    const signals = { ...prior.signals, ...(parsed.signals || {}) };
    const signalConfidence = { ...prior.signalConfidence, ...(parsed.signalConfidence || {}) };
    const signalNotes = { ...(prior.signalNotes || {}), ...(parsed.signalNotes || {}) };
    // Clamp
    for (const k of Object.keys(signals)) {
      const n = Number(signals[k]);
      if (!Number.isFinite(n)) delete signals[k];
      else signals[k] = Math.max(1, Math.min(10, n));
    }
    for (const k of Object.keys(signalConfidence)) {
      const n = Number(signalConfidence[k]);
      if (!Number.isFinite(n)) delete signalConfidence[k];
      else signalConfidence[k] = Math.max(0, Math.min(1, n));
    }
    return { signals, signalConfidence, signalNotes };
  } catch (err: any) {
    console.warn('[ProgressiveCollabAnalyze] failed', err?.message || err);
    return fallback;
  }
}

/**
 * Map progressive signals into collaborationProfile trait keys used by recommendation scoring.
 * Does not wipe peer feedback fields (feedbackCount, etc.).
 */
function mergeIntoCollaborationProfile(existing: any, signals: Record<string, number>, conf: Record<string, number>) {
  const cp = { ...(existing && typeof existing === 'object' ? existing : {}) };
  const map: Record<string, string> = {
    communication: 'communication',
    reliability: 'reliability',
    initiative: 'leadership',
    ownership: 'leadership',
    adaptability: 'flexibility',
    feedback_style: 'feedback_openness',
    independence: 'technical_proficiency',
    creative_compatibility: 'creativity',
    teamwork: 'teamwork',
    trust: 'reliability',
  };
  for (const [src, dest] of Object.entries(map)) {
    const v = Number(signals[src]);
    const c = Number(conf[src] ?? 0.3);
    if (!Number.isFinite(v) || c < 0.15) continue;
    const prev = Number(cp[dest]);
    // Blend if prior exists; else set
    if (Number.isFinite(prev) && prev > 0) {
      cp[dest] = Math.round((prev * 0.55 + v * 0.45) * 10) / 10;
    } else {
      cp[dest] = v;
    }
  }
  cp.progressiveSignalsUpdatedAt = new Date().toISOString();
  return cp;
}

export async function submitProgressiveSet(params: {
  userId: string;
  questionIds: string[];
  answers: Record<string, string | string[]>;
}): Promise<{ state: ProgressiveState; hasMore: boolean }> {
  const { userId, questionIds, answers } = params;
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    throw new Error('questionIds required');
  }
  // Validate answers only for known questions
  const cleaned: Record<string, string | string[]> = {};
  for (const id of questionIds) {
    if (!PROGRESSIVE_COLLAB_BY_ID[id]) continue;
    if (answers[id] === undefined || answers[id] === null || answers[id] === '') {
      throw new Error(`Missing answer for ${id}`);
    }
    cleaned[id] = answers[id];
  }

  const prior = await loadProgressiveState(userId);
  const now = new Date().toISOString();
  const answeredIds = Array.from(new Set([...prior.answeredIds, ...Object.keys(cleaned)]));
  const answeredAt = { ...prior.answeredAt };
  for (const id of Object.keys(cleaned)) answeredAt[id] = now;

  const derived = await analyzeProgressiveAnswers(cleaned, prior);

  const next: ProgressiveState = {
    answers: { ...prior.answers, ...cleaned },
    answeredIds,
    answeredAt,
    setsCompleted: prior.setsCompleted + 1,
    lastSetQuestionIds: questionIds,
    lastSetCompletedAt: now,
    signals: derived.signals,
    signalConfidence: derived.signalConfidence,
    signalNotes: derived.signalNotes,
    updatedAt: now,
  };

  const db = getAdminDb();
  const userRef = db.collection('users').doc(userId);
  const snap = await userRef.get();
  const existingCp = snap.exists ? (snap.data() as any)?.collaborationProfile : null;
  const collaborationProfile = mergeIntoCollaborationProfile(existingCp, derived.signals, derived.signalConfidence);

  await userRef.set(
    {
      progressiveCollaboration: next,
      collaborationProfile,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const hasMore = answeredIds.length < PROGRESSIVE_COLLAB_QUESTIONS.length;
  return { state: next, hasMore };
}

export function getStatusFromState(state: ProgressiveState) {
  const total = PROGRESSIVE_COLLAB_QUESTIONS.length;
  const answeredCount = state.answeredIds.length;
  const remaining = Math.max(0, total - answeredCount);
  return {
    answeredCount,
    total,
    remaining,
    setsCompleted: state.setsCompleted,
    hasAvailableQuestions: remaining > 0,
    signals: state.signals,
    signalConfidence: state.signalConfidence,
  };
}
