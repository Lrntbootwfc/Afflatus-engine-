import { Type } from '@google/genai';
import { generateContentWithFallback } from './geminiClient';

export interface CollaborationProfileResult {
  creativity: number;
  communication: number;
  flexibility: number;
  reliability: number;
  teamwork: number;
  feedback_openness: number;
  leadership: number;
  technical_proficiency: number;
  confidenceScores: Record<string, number>;
}

export class CollaborationAnalysisService {
  static async analyzeAnswers(
    answers: Record<string, string>
  ): Promise<{ success: boolean; data?: CollaborationProfileResult; error?: string }> {
    if (!process.env.GEMINI_API_KEY) {
      return { success: false, error: 'GEMINI_API_KEY not configured' };
    }

    const schema = {
      type: Type.OBJECT,
      properties: {
        collaborationProfile: {
          type: Type.OBJECT,
          properties: {
            creativity: { type: Type.NUMBER },
            communication: { type: Type.NUMBER },
            flexibility: { type: Type.NUMBER },
            reliability: { type: Type.NUMBER },
            teamwork: { type: Type.NUMBER },
            feedback_openness: { type: Type.NUMBER },
            leadership: { type: Type.NUMBER },
            technical_proficiency: { type: Type.NUMBER },
          },
        },
        confidenceScores: {
          type: Type.OBJECT,
          properties: {
            creativity: { type: Type.NUMBER },
            communication: { type: Type.NUMBER },
            flexibility: { type: Type.NUMBER },
            reliability: { type: Type.NUMBER },
            teamwork: { type: Type.NUMBER },
            feedback_openness: { type: Type.NUMBER },
            leadership: { type: Type.NUMBER },
            technical_proficiency: { type: Type.NUMBER },
          },
        },
      },
    };

    const systemInstruction = `You are an expert collaboration assessor for a professional networking platform.
Your task is to analyze a user's answers to scenario-based questions and assess their observable collaboration dimensions.
The dimensions are: creativity, communication, flexibility, reliability, teamwork, feedback_openness, leadership, and technical_proficiency.
Return a structured JSON with scores from 1.0 to 10.0 for each dimension, and a confidence score from 0.0 to 1.0.

CRITICAL RULES:
1. DO NOT invent factual experience (years, projects, roles).
2. ONLY score dimensions supported by evidence in the answers. If there is little or no evidence for a dimension, provide a neutral score (e.g., 5.0) and a low confidence score (e.g., 0.1).
3. Do not make psychological claims or diagnose personality types. Focus strictly on observable behaviors in a professional context.`;

    const prompt = `User's answers to scenario questions:
${JSON.stringify(answers, null, 2)}

Analyze these answers and return the structured scores.`;

    try {
      const { text } = await generateContentWithFallback(
        {
          contents: prompt,
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.3,
          useThinkingBudget: true,
        },
        '[CollaborationAnalysis]'
      );
      const parsed = JSON.parse(text);
      if (parsed.collaborationProfile) {
        return {
          success: true,
          data: {
            ...parsed.collaborationProfile,
            confidenceScores: parsed.confidenceScores || {},
          },
        };
      }
      return { success: false, error: 'Malformed collaboration analysis response' };
    } catch (err: any) {
      console.error('[CollaborationAnalysis] Error:', err);
      return {
        success: false,
        error: err.message || 'Failed to analyze collaboration profile',
      };
    }
  }
}
