import { Type } from '@google/genai';
import { generateContentWithFallback } from './geminiClient';

export class QueryUnderstandingService {

  /**
   * Returns whether the latest user message is Afflatus/collaboration related.
   */
  static async classifyAfflatusIntent(
    messages: { role: string; content: string }[]
  ): Promise<{ inScope: boolean; wantsRecommendation?: boolean; reply?: string }> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const text = lastUser.toLowerCase().trim();

    // Pure greetings / small talk → chat only, NEVER recommend
    const greetings = [
      'hi', 'hello', 'hey', 'hola', 'namaste', 'yo', 'sup', 'good morning',
      'good afternoon', 'good evening', 'how are you', 'how r you', "what's up",
      'whats up', 'thanks', 'thank you', 'ok', 'okay', 'cool', 'nice', 'bye',
    ];
    const isGreeting =
      greetings.some((g) => text === g || text === g + '!' || text === g + '.') ||
      /^(hi|hello|hey)[\s,!.]*$/i.test(text);
    if (isGreeting) {
      return {
        inScope: true,
        wantsRecommendation: false,
        reply:
          "Hi! I'm Afflatus AI Match. Tell me who you need — for example: \"I need a cinematographer in Mumbai for a horror short\" — and I'll find people for you.",
      };
    }

    // Explicit find/crew intent
    const findSignals = [
      'find me', 'looking for', 'need a', 'need an', 'need someone', 'hire',
      'search', 'recommend', 'who can', 'suggest', 'crew for', 'team for',
    ];
    const roleSignals = [
      'cinematograph', 'director', 'editor', 'producer', 'gaffer', 'sound',
      'camera', 'writer', 'screenwriter', 'colorist', 'vfx', 'actor', 'photographer',
      'dp', '1st ac', 'boom', 'composer', 'designer',
    ];
    const wantsRec =
      findSignals.some((k) => text.includes(k)) ||
      (roleSignals.some((k) => text.includes(k)) &&
        (text.includes('in ') || text.includes('for ') || text.includes('mumbai') || text.includes('delhi') || text.length > 25));

    const allowProduct = [
      'afflatus', 'collaborat', 'profile', 'project', 'post', 'proposal', 'connect',
      'how do i', 'how does', 'explore', 'portfolio', 'feedback', 'travel',
    ];
    if (allowProduct.some((k) => text.includes(k)) && !wantsRec) {
      return {
        inScope: true,
        wantsRecommendation: false,
        reply:
          "I can help with Afflatus discovery and collaboration. Describe a role and city (e.g. \"editor in Bengaluru\") when you want matches.",
      };
    }
    if (wantsRec) {
      return { inScope: true, wantsRecommendation: true };
    }

    // Follow-up only if prior turn was already a search (assistant had results context)
    const priorAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (
      priorAssistant &&
      messages.filter((m) => m.role === 'user').length > 1 &&
      text.length < 100 &&
      (text.includes('only ') || text.includes('also ') || text.includes('in ') || text.includes('more'))
    ) {
      return { inScope: true, wantsRecommendation: true };
    }

    if (!process.env.GEMINI_API_KEY) {
      return {
        inScope: false,
        wantsRecommendation: false,
        reply:
          "I'm Afflatus AI Match — ask for a role and location to find collaborators, or ask how Afflatus works.",
      };
    }
    try {
      const { text: raw } = await generateContentWithFallback(
        {
          contents: `For Afflatus (film/creator collaboration app). Message: """${lastUser}"""
Reply JSON only: {"inScope": true|false, "wantsRecommendation": true|false}
wantsRecommendation=true only if user is asking to FIND/MATCH people (roles, crew, collaborators).
Greetings and general chat: inScope true, wantsRecommendation false.
Unrelated topics (homework, recipes, physics): inScope false.`,
          temperature: 0,
          responseMimeType: 'application/json',
          useThinkingBudget: false,
        },
        '[QueryUnderstanding/classify]'
      );
      const parsed = JSON.parse(raw || '{}');
      if (parsed.inScope === false) {
        return {
          inScope: false,
          wantsRecommendation: false,
          reply:
            "I'm focused on Afflatus — discovery and collaboration. Ask me to find a creator or how the platform works.",
        };
      }
      return {
        inScope: true,
        wantsRecommendation: !!parsed.wantsRecommendation,
        reply: parsed.wantsRecommendation
          ? undefined
          : "Tell me a role and place when you want matches — e.g. \"cinematographer in Mumbai\".",
      };
    } catch {
      return {
        inScope: true,
        wantsRecommendation: false,
        reply: "Tell me who you're looking for (role + city) and I'll search the network.",
      };
    }
  }

  static async understandChat(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<{ success: boolean; data?: any; error?: string }> {
    if (!process.env.GEMINI_API_KEY) {
      return { success: false, error: 'GEMINI_API_KEY not configured' };
    }

    const schema = {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.OBJECT,
          properties: {
            city: { type: Type.STRING },
          },
          nullable: true,
        },
        project_type: { type: Type.STRING },
        role: { type: Type.STRING },
        roles: { type: Type.ARRAY, items: { type: Type.STRING } },
        genres: { type: Type.ARRAY, items: { type: Type.STRING } },
        minExperienceYears: { type: Type.NUMBER, nullable: true },
        preferences: {
          type: Type.OBJECT,
          properties: {
            creativity: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            communication: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            reliability: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            flexibility: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            teamwork: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            feedback_openness: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            leadership: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
            technical_proficiency: {
              type: Type.OBJECT,
              properties: { level: { type: Type.STRING }, importance: { type: Type.STRING } },
            },
          },
        },
      },
    };

    const systemInstruction = `You are a query extractor for a film/media collaboration platform.
Extract the CURRENT, COMBINED requirements from the user's chat history.
- The history may contain previous requirements and recent refinements (e.g., "only show people in Goa").
- Combine all active constraints into the final output.
- For preferences (creativity, communication, reliability, flexibility, teamwork, feedback_openness, leadership, technical_proficiency), determine the 'level' (high, mid, low, not_specified) and 'importance' (required, preferred, optional).
- IMPORTANT: If a user does NOT mention a specific preference or trait, you MUST output "not_specified" for its level and "optional" for its importance. Do NOT assume "mid" or any other value.
- Map natural language intelligently (e.g. "technically excellent" -> technical_proficiency: high, "very reliable" -> reliability: high).
- If role, location, or project_type are not mentioned at all in the history, output "not_specified".

CRITICAL - ROLE MAPPING: The platform uses these EXACT role names. You MUST map the user's natural language to ONE of these exact strings for the "role" field:
Cinematography & Camera: "Director of Photography (DP)", "Cinematographer", "Camera Operator (A-Cam / B-Cam)", "1st Assistant Camera (1st AC / Focus Puller)", "2nd Assistant Camera (2nd AC / Clapper Loader)", "Steadicam / Gimbal Specialist", "Drone Pilot / Aerial Cinematographer", "DIT (Digital Imaging Technician)"
Writing, Directing & Producing: "Director", "Screenwriter / Scriptwriter", "Creative Producer", "Executive Producer", "Line Producer", "1st Assistant Director (1st AD)", "2nd Assistant Director (2nd AD)", "Script Supervisor / Continuity", "Story / Narrative Consultant"
Lighting & Grip: "Gaffer / Chief Lighting Technician", "Best Boy Electric", "Key Grip", "Best Boy Grip", "Dolly Grip", "Rigging Gaffer"
Sound & Audio: "Location Sound Recordist", "Boom Operator", "Sound Designer / Audio Recordist", "Re-recording Mixer / Audio Post Engineer", "Foley Artist", "Dialogue Editor", "Music Composer / Score Producer"
Post-Production: "Lead Video Editor", "Assistant Editor", "Colorist (DaVinci Resolve / Baselight)", "VFX Artist / Compositor", "Motion Graphics / 3D Artist", "CGI / Unreal Engine Virtual Production Artist"
Art & Design: "Production Designer", "Art Director", "Set Decorator / Prop Master", "Costume Designer / Stylist", "Key Makeup & Hair Artist (HMUA)", "SFX Makeup Artist", "UI/UX Designer", "Photographer / BTS Stills Photographer"

Examples:
- "screen writer" or "script writer" or "screenwriter" -> "Screenwriter / Scriptwriter"
- "DP" or "director of photography" -> "Director of Photography (DP)"
- "director" (when meaning film director) -> "Director"
- "editor" or "video editor" -> "Lead Video Editor"
- "sound guy" or "sound person" -> "Sound Designer / Audio Recordist"
If the user mentions multiple roles, put ALL of them in the "roles" array (each mapped to an EXACT platform role string above).
Also set "role" to the first/primary requested role for backward compatibility.
Extract genres when mentioned (horror, thriller, comedy, etc.) into the genres array.
Never drop a requested role — always include every distinct role the user asked for in "roles".`;

    const formattedHistory = messages.map(m => `${m.role === 'user' ? 'User' : 'System'}: "${m.content}"`).join('\n');
    const prompt = `Chat History:\n${formattedHistory}\n\nBased on the ENTIRE conversation history above, extract the FINAL combined structured requirements that reflect the user's current intent.`;

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
        '[QueryUnderstanding]'
      );
      return { success: true, data: JSON.parse(text) };
    } catch (err: any) {
      console.error('[QueryUnderstanding] Error:', err);
      return { success: false, error: err.message || 'Failed to understand query' };
    }
  }
}
