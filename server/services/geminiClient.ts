/**
 * Shared Gemini client + model fallback for Afflatus-engine.
 * Only uses current Gemini 3.x model ids. Caches the first model that works
 * for this process so subsequent requests do not walk a dead chain.
 */
import { GoogleGenAI } from '@google/genai';

/** Active ladder — order is preference. Dead 1.5 / 2.0 / 2.5 ids are intentionally absent. */
export const GEMINI_MODEL_LADDER = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
] as const;

export type GeminiModelId = (typeof GEMINI_MODEL_LADDER)[number];

let aiClient: GoogleGenAI | null = null;
/** Model that succeeded at least once in this process */
let preferredModel: string | null = null;
/** Models that failed with not-found / denied / unsupported in this process */
const deadModels = new Set<string>();

function getClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[Gemini] GEMINI_API_KEY is not set');
    return null;
  }
  if (!aiClient) {
    try {
      aiClient = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'afflatus-engine-v1' } },
      });
    } catch (err) {
      console.warn('[Gemini] Failed to init client:', err);
      return null;
    }
  }
  return aiClient;
}

function isModelUnavailableError(err: any): boolean {
  const status = err?.status ?? err?.code ?? err?.error?.code;
  const msg = String(err?.message || err?.error?.message || '').toLowerCase();
  if (status === 404 || status === 403) return true;
  if (msg.includes('not found') || msg.includes('no longer available')) return true;
  if (msg.includes('permission_denied') || msg.includes('permission denied')) return true;
  if (msg.includes('not available to new users')) return true;
  if (msg.includes('unsupported')) return true;
  return false;
}

function isRetryableTransient(err: any): boolean {
  const status = err?.status ?? err?.code;
  return status === 429 || status === 503 || status === 500;
}

function orderedModels(): string[] {
  const base = [...GEMINI_MODEL_LADDER].filter((m) => !deadModels.has(m));
  if (preferredModel && !deadModels.has(preferredModel)) {
    return [preferredModel, ...base.filter((m) => m !== preferredModel)];
  }
  return base;
}

export type GenerateArgs = {
  contents: string | unknown;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: unknown;
  temperature?: number;
  /** Skip thinkingBudget if the model rejects it */
  useThinkingBudget?: boolean;
};

/**
 * Call generateContent with model fallback.
 * Marks permanently unavailable models and prefers the last successful model.
 */
export async function generateContentWithFallback(
  args: GenerateArgs,
  logPrefix = '[Gemini]'
): Promise<{ text: string; model: string }> {
  const ai = getClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY missing or Gemini client failed to initialize');
  }

  const models = orderedModels();
  if (!models.length) {
    throw new Error(
      'No Gemini models left to try. All configured models returned unavailable for this API key.'
    );
  }

  let lastError: any = null;

  for (const model of models) {
    try {
      console.log(`${logPrefix} Trying model: ${model}`);
      const config: Record<string, unknown> = {
        temperature: args.temperature ?? 0.3,
      };
      if (args.systemInstruction) config.systemInstruction = args.systemInstruction;
      if (args.responseMimeType) config.responseMimeType = args.responseMimeType;
      if (args.responseSchema) config.responseSchema = args.responseSchema;
      if (args.useThinkingBudget !== false) {
        config.thinkingConfig = { thinkingBudget: 0 };
      }

      const response = await ai.models.generateContent({
        model,
        contents: args.contents as any,
        config: config as any,
      });

      const text =
        response?.text ||
        (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text ||
        null;

      if (!text) {
        console.warn(`${logPrefix} ${model} returned empty text`);
        lastError = new Error(`Empty response from ${model}`);
        continue;
      }

      preferredModel = model;
      console.log(`${logPrefix} Success with model: ${model}`);
      return { text, model };
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.code ?? '?';
      console.warn(`${logPrefix} ${model} failed:`, status, err?.message || err);

      if (isModelUnavailableError(err)) {
        deadModels.add(model);
        if (preferredModel === model) preferredModel = null;
        continue;
      }
      if (isRetryableTransient(err)) {
        continue;
      }
      // Unknown error: try next model once
      continue;
    }
  }

  const detail = lastError?.message || String(lastError) || 'unknown error';
  throw new Error(
    `All Gemini models failed for this API key. Last error: ${detail}. Configure GEMINI_API_KEY with access to one of: ${GEMINI_MODEL_LADDER.join(', ')}`
  );
}

export function getGeminiPreferredModel(): string | null {
  return preferredModel;
}

export function getGeminiDeadModels(): string[] {
  return [...deadModels];
}
