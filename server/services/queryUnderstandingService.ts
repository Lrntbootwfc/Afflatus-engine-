import { Type } from '@google/genai';
import { generateContentWithFallback } from './geminiClient';

export class QueryUnderstandingService {

  /**
   * Returns whether the latest user message is Afflatus/collaboration related.
   */
  /**
   * Classify the latest user message:
   * chat / help / creators / projects / seeking_me / production_plan / rental / film_advice.
   * Never force greetings or navigation into creator ranking.
   */
  static async classifyAfflatusIntent(
    messages: { role: string; content: string }[]
  ): Promise<{
    inScope: boolean;
    wantsRecommendation?: boolean;
    intent?:
      | 'chat'
      | 'help'
      | 'creators'
      | 'projects'
      | 'seeking_me'
      | 'production_plan'
      | 'rental'
      | 'film_advice';
    reply?: string;
  }> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const text = lastUser.toLowerCase().trim();
    const original = lastUser.trim();

    // --- 1. Greetings / small talk (no matching) ---
    const greetings = [
      'hi', 'hello', 'hey', 'hola', 'namaste', 'yo', 'sup', 'good morning',
      'good afternoon', 'good evening', 'how are you', 'how r you', "what's up",
      'whats up', "how's it going", 'how is it going', 'nice to meet you',
      'thanks', 'thank you', 'ok', 'okay', 'cool', 'nice', 'bye',
      'hi how are you', 'hello how are you', 'hey how are you',
    ];
    const isGreeting =
      greetings.some((g) => text === g || text === g + '!' || text === g + '.' || text === g + '?') ||
      /^(hi|hello|hey|good morning|good evening)([\s,!.?]|$)/i.test(text) ||
      /how are you|how's it going|how is it going|nice to meet you/i.test(text);
    if (isGreeting && !/(find|need|cinematograph|project|collaborat|script|who |film|crew|budget)/i.test(text)) {
      // Answer the social question first — do not pitch Afflatus features here
      const howAreYou = /how are you|how's it going|how is it going|whats up|what's up/.test(text);
      return {
        inScope: true,
        wantsRecommendation: false,
        intent: 'chat',
        reply: howAreYou
          ? "I'm doing well! How are you? Ask me anything about filmmaking, crew, budget, gear, or finding people on Afflatus."
          : "Hi! Ask me anything about filmmaking, crew planning, rentals, or finding creators on Afflatus.",
      };
    }

    // --- 2. What can you do / about Afflatus ---
    if (
      /what can you do|what do you do|help me|who are you/.test(text) ||
      /tell me about (this )?app|what is (this )?app|what is afflatus|about afflatus|how does (this|the) (app|platform) work/.test(text)
    ) {
      return {
        inScope: true,
        wantsRecommendation: false,
        intent: 'help',
        reply:
          "Afflatus is a collaboration platform for film and creative professionals. You can complete your creator profile, discover people and projects in Explore, publish posts and public works, send collaboration requests, message accepted connections, and leave peer collaboration feedback after you collaborate.\n\n" +
          "In this chat I can:\n" +
          "• Answer filmmaking questions (crew, budget, gear, technique, workflow)\n" +
          "• Plan a production (short film, commercial, MV, doc) and suggest roles\n" +
          "• Find creators by role and location — results show as profile cards\n" +
          "• Look for open projects related to a role or topic\n" +
          "• Explain where things live in the app (profile, Explore, messages, requests)\n\n" +
          "Try: \"What crew do I need for a short film?\", \"DP in Mumbai\", or \"where is my public profile?\"",
      };
    }

    // --- 3. Navigation / help (must match real Afflatus UI) ---
    const navAnswer = ((): string | null => {
      // Peer ratings / feedback
      if (/peer rating|peer review|ratings?|collaboration feedback|leave feedback|where.*feedback/.test(text)) {
        return (
          "Peer collaboration ratings live on a creator's Public Profile.\n\n" +
          "• Open Explore → Creators (or open someone from Posts / matches), then open their Public Profile.\n" +
          "• On that profile, look for the collaboration / peer review section — it shows overall rating, feedback count, and trait scores when peers have left feedback.\n" +
          "• You can leave feedback only after a collaboration with that person is active or completed: on their Public Profile use the feedback option when it appears (after you are collaborating).\n" +
          "There is no separate \"Peer Ratings\" page — ratings are shown on Public Profiles and on Explore creator cards when available."
        );
      }
      // Own public profile preview (do NOT tell users to find themselves in Explore Creators)
      if (
        /public profile|preview.*profile|see my (own )?profile as others|how others see|how can i see my public|where is my public/.test(
          text
        )
      ) {
        return (
          "To see your own Public Profile (exactly as others see it):\n\n" +
          "1. Open Profile Setup / Edit Profile from the Dashboard (Edit Profile).\n" +
          "2. Use the \"Preview public profile\" button on that screen.\n\n" +
          "That opens your Public Profile with Public Works, Posts, Projects, bio, and peer ratings when available.\n" +
          "Your own account is not listed in Explore → Creators while you browse (Explore is for discovering others). " +
          "Other people reach Public Profiles from Explore Creators or by tapping a name/avatar on posts."
        );
      }
      // Edit profile
      if (/edit (my )?profile|where.*profile|update profile|profile setup|complete (my )?profile/.test(text) && !/public profile/.test(text)) {
        return (
          "To edit your profile: open the main Dashboard and use Edit Profile / Profile Setup (also reachable after approval when the app prompts you to complete your profile).\n" +
          "There you set roles, location, portfolio links, avatar, and other details. Save profile to apply changes."
        );
      }
      // Explore creators
      if (/explore creator|find creator|where.*creator|creators tab|discover creator/.test(text) && !/project/.test(text)) {
        return (
          "Open Explore (from the main navigation / Dashboard \"Explore\").\n" +
          "Use the Creators tab to browse suggested creators. You can search and filter by category.\n" +
          "Tap a creator to open their Public Profile."
        );
      }
      // Explore projects / posts
      if (/explore project|where.*project|projects tab|briefs|explore post|where.*post|posts tab|feed/.test(text)) {
        return (
          "In Explore:\n" +
          "• Projects & briefs: use the Projects tab (and related project cards).\n" +
          "• Posts: use the Posts / feed section in Explore (\"Posts & Updates\" / global posts feed).\n" +
          "• Works, tasks, and clubs have their own tabs when available.\n" +
          "Use the search box on Explore to filter by keywords."
        );
      }
      // Messages
      if (/where.*message|open message|messenger|chat with|direct message|\bdms?\b/.test(text)) {
        return (
          "Messages open through the Messenger drawer after you have an accepted connection.\n" +
          "From the header/network controls (clipboard / messenger entry) or after accepting a connection request, open Messenger to chat with that person.\n" +
          "Pending requests are not full chat until accepted."
        );
      }
      // Collaboration requests / my collaboration
      if (/collaboration request|send (a )?collaborat|start collaborat|where.*request|pending request|my collaboration|incoming request/.test(text)) {
        return (
          "To send a collaboration request: open someone's Public Profile and use Start Collaboration (when you are approved and profile-complete). You can add a short message, then send.\n" +
          "• Pending: the button shows Collaboration Requested.\n" +
          "• If declined, you can send again later.\n" +
          "• When accepted / collaborating, status shows Collaborating.\n" +
          "Incoming requests appear in notifications and on the Dashboard collaboration / pending requests area. Accept or decline there.\n" +
          "Messenger lists accepted and collaborating connections."
        );
      }
      // Notifications
      if (/notification|alerts?/.test(text)) {
        return (
          "Notifications (connection requests, accepts, messages) open from the notifications panel in the app chrome / messaging area. Connection requests can be accepted or declined there."
        );
      }
      // Create post
      if (/create (a )?post|how do i post|publish (a )?post|share an update/.test(text)) {
        return (
          "You can create a post from Explore (Posts / Projects areas that show \"Share an update\" / Create Post) and from your own Public Profile Posts tab when you are viewing yourself.\n" +
          "Add text and optional image, then Post. Profile completion is required to interact fully."
        );
      }
      // Edit/delete post
      if (/edit (my )?post|delete (my )?post|remove (my )?post/.test(text)) {
        return (
          "On your own posts, use the pencil icon to edit the caption and the trash icon to delete (you will get a confirmation).\n" +
          "Edit/delete only appear on posts you authored — not on other people's posts."
        );
      }
      // View another creator
      if (/view (another|other|someone).*(profile|creator)|open (a )?creator|how.*see.*profile/.test(text)) {
        return (
          "Open Explore → Creators and tap a person, or click their name/avatar on a post in the Explore posts feed. That opens their Public Profile (works, posts, projects, ratings)."
        );
      }
      return null;
    })();

    if (navAnswer) {
      return {
        inScope: true,
        wantsRecommendation: false,
        intent: 'help',
        reply: navAnswer,
      };
    }

    // --- 3b. Film production planning / rental / general filmmaking advice ---
    // Route these into the multi-turn film production chatbot (answers + optional cards).
    const rentalSignals =
      /(rent|rental|on hire|hire gear|hire camera|equipment rental|lens kit|light kit|studio space|sound stage|camera package)/i.test(
        text
      );
    if (rentalSignals) {
      return {
        inScope: true,
        wantsRecommendation: true,
        intent: 'rental',
      };
    }

    const productionPlanSignals =
      /(short film|feature film|music video|documentary|commercial|ad film|brand film|making a (film|movie|video)|shoot a (film|movie)|my (film|project) budget|crew for|what crew|who do i need|staffing|call sheet|production plan|pre[- ]?production|post[- ]?production workflow)/i.test(
        text
      ) ||
      (/\b(budget|lakh|crore)\b/i.test(text) &&
        /\b(film|movie|shoot|production|crew|project)\b/i.test(text));
    if (productionPlanSignals && !/find (me )?(a |an )?(dp|editor|director|cinematograph)/i.test(text)) {
      return {
        inScope: true,
        wantsRecommendation: true,
        intent: 'production_plan',
      };
    }

    // Pure filmmaking knowledge (technique, gear theory, roles explained) — still in-scope
    const filmAdviceSignals =
      /(how (do|does|to|should)|what is|what's|explain|difference between|when (do|should)|why (do|should)|best (practice|way|lens|codec|format)|frame rate|shutter angle|aspect ratio|log vs rec|color grade|color grading|davinci|premiere|final cut|arri|red camera|blackmagic|gimbal|steadicam|three[- ]point lighting|continuity|script supervisor|coverage|master shot|b[- ]roll|slate|timecode|dailies|assembly cut|picture lock)/i.test(
        text
      ) &&
      /(film|cinema|camera|lens|light|sound|edit|grade|shoot|scene|shot|crew|production|director|dp|cinematograph)/i.test(
        text
      );
    if (filmAdviceSignals) {
      return {
        inScope: true,
        wantsRecommendation: true,
        intent: 'film_advice',
      };
    }

    // --- 4a. People SEEKING my skills (direction: my roles → their seekingRoles) ---
    // Critical: NOT the same as finding people whose primary role matches mine.
    const seekingMeSignals = [
      'who needs me',
      'who is looking for someone like me',
      'who is searching for someone like me',
      'who needs someone like me',
      'looking for my skills',
      'searching for my skills',
      'seeking my skills',
      'who needs a',
      'who is looking for a',
      'who is searching for a',
      'who is looking for my',
      'people who need',
      'people who are searching for',
      'people who are looking for',
      'creators who need',
      'creators who are seeking',
      'show me people who are seeking',
      'find people who are searching',
      'find people who are looking for',
      'who can i collaborate with based on what i offer',
      "don't want script writers",
      'not script writers',
      'searching for script writers',
      'looking for script writers',
      'seeking script writer',
      'requires my role that i can provide',
      'people who are searching for my',
    ];
    const isSeekingMe =
      seekingMeSignals.some((k) => text.includes(k)) ||
      /who (needs|is looking for|is searching for).*(me|my (role|skills)|someone like me)/.test(text) ||
      /(looking|searching|seeking) for (script writer|cinematograph|editor|my role|my skills)/.test(text) ||
      (/script writer|screenwriter/.test(text) && /(looking for|searching for|seeking|needs|require)/.test(text) && !/project/.test(text));

    // Explicit clarification: user does NOT want people who ARE that role
    const clarifiesSeekingDirection =
      /don'?t want .+ writers|not .+ writers|people who are searching|who need .+ not people who are/.test(text);

    if ((isSeekingMe || clarifiesSeekingDirection) && !/project/.test(text)) {
      return {
        inScope: true,
        wantsRecommendation: true,
        intent: 'seeking_me',
      };
    }

    // --- 4b. Project discovery (projects needing a role / open projects) ---
    const projectSignals = [
      'project', 'projects', 'brief', 'briefs',
    ];
    const asksProjects =
      projectSignals.some((k) => text.includes(k)) &&
      /(open|find|show|any|related|suitable|for|near|about|filmmaking|available|looking for|need|require)/.test(text);

    if (asksProjects || /project(s)? (open|for|related|looking|need)|open for (a )?(cinematograph|director|editor|producer|script)/.test(text)) {
      return {
        inScope: true,
        wantsRecommendation: true,
        intent: 'projects',
      };
    }

    // --- 5. Creator matching (find people who ARE a role) — existing direction ---
    // "Who can I collaborate with?" uses broader relevance, not seeking_me.
    const findSignals = [
      'find me', 'looking for', 'need a', 'need an', 'need someone', 'hire',
      'search', 'recommend', 'who can', 'suggest', 'crew for', 'team for',
      'creators i could', 'collaborators', 'people who are', 'who can i work with',
      'who can i collaborate with',
    ];
    const roleSignals = [
      'cinematograph', 'director', 'editor', 'producer', 'gaffer', 'sound',
      'camera', 'writer', 'screenwriter', 'colorist', 'vfx', 'actor', 'photographer',
      'dp', 'dop', '1st ac', '2nd ac', 'boom', 'composer', 'designer', 'collaborator',
      'focus puller', 'script supervisor', 'art director', 'costume', 'makeup',
      'hmua', 'production designer', 'line producer', '1st ad', '2nd ad', 'dit',
      'drone', 'steadicam', 'key grip', 'best boy', 'location scout', 'choreographer',
    ];
    const wantsCreators =
      findSignals.some((k) => text.includes(k)) ||
      (roleSignals.some((k) => text.includes(k)) &&
        (text.includes('in ') ||
          text.includes('for ') ||
          text.includes('mumbai') ||
          text.includes('delhi') ||
          text.includes('bangalore') ||
          text.includes('pune') ||
          text.includes('hyderabad') ||
          text.includes('chennai') ||
          text.includes('find') ||
          text.includes('need') ||
          text.includes('looking') ||
          text.length > 20));

    // Exclude if this was already classified as seeking_me style
    if (wantsCreators && !isSeekingMe && !clarifiesSeekingDirection) {
      return { inScope: true, wantsRecommendation: true, intent: 'creators' };
    }

    // Follow-up refinements after a previous search
    const priorAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (
      priorAssistant &&
      messages.filter((m) => m.role === 'user').length > 1 &&
      text.length < 100 &&
      (text.includes('only ') || text.includes('also ') || text.includes('in ') || text.includes('more'))
    ) {
      return { inScope: true, wantsRecommendation: true, intent: 'creators' };
    }

    // Natural "what can I work on" without explicit project word
    if (/what can i work|anything (here )?i might|useful for me|related to my role/.test(text)) {
      return { inScope: true, wantsRecommendation: true, intent: 'projects' };
    }

    // Default in-scope help (do not force role+place)
    if (
      text.includes('afflatus') ||
      text.includes('collaborat') ||
      text.includes('explore') ||
      text.includes('profile') ||
      text.includes('how ')
    ) {
      return {
        inScope: true,
        wantsRecommendation: false,
        intent: 'help',
        reply:
          "I can explain Afflatus navigation, find creators by role/location, or look for open projects. " +
          "Ask something like \"where is Explore?\", \"find editors in Pune\", or \"any projects for cinematographers?\".",
      };
    }

    // Optional Gemini fallback for edge cases
    if (!process.env.GEMINI_API_KEY) {
      return {
        inScope: true,
        wantsRecommendation: false,
        intent: 'chat',
        reply:
          "I'm Afflatus AI Match. Ask me about the app, where to find profile/Explore/messages, open projects, or creators by role and city.",
      };
    }
    try {
      const { text: raw } = await generateContentWithFallback(
        {
          contents: `Afflatus is a film/creator collaboration app. Classify this message.
Message: """${lastUser}"""
JSON only: {"inScope":true|false,"intent":"chat"|"help"|"creators"|"projects"|"seeking_me"|"production_plan"|"rental"|"film_advice","wantsRecommendation":true|false,"reply":"short helpful string if chat/help"}
Rules:
- chat = greeting/small talk
- help = how the app works / where UI is (no inventing features)
- creators = find people by role/location (e.g. DP in Mumbai)
- projects = find open projects/briefs needing a role
- seeking_me = people whose seekingRoles match what the user offers (NOT people who are that role)
- production_plan = planning a film/shoot, crew lists, budgets for a project
- rental = camera/lighting/sound gear or studio rental
- film_advice = technique, gear theory, workflows, role explanations (filmmaking Q&A)
- wantsRecommendation true for creators, projects, seeking_me, production_plan, rental, film_advice
- Almost all filmmaking questions are inScope=true`,
          systemInstruction: 'Return valid JSON only.',
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
        '[QueryUnderstanding.classify]'
      );
      const parsed = JSON.parse(raw);
      return {
        inScope: parsed.inScope !== false,
        wantsRecommendation: !!parsed.wantsRecommendation,
        intent: parsed.intent || (parsed.wantsRecommendation ? 'creators' : 'help'),
        reply: parsed.reply,
      };
    } catch {
      return {
        inScope: true,
        wantsRecommendation: false,
        intent: 'chat',
        reply:
          "I can help with Afflatus: find creators, open projects, or explain where things are in the app. What do you need?",
      };
    }
  }

  /**
   * Deterministic role/location extraction when Gemini is unavailable or fails.
   * Keeps AI Match usable in production even if GEMINI_API_KEY is missing or
   * every model in the ladder returns unavailable for the deployed key.
   */
  static heuristicUnderstandFromMessages(
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): any {
    const combined = messages
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content || ''))
      .join(' \n ')
      .toLowerCase();

    const roleMap: Array<{ keys: RegExp; role: string }> = [
      { keys: /\b(director of photography|dop\b|\bdp\b)/i, role: 'Director of Photography (DP)' },
      { keys: /\bcinematograph/i, role: 'Cinematographer' },
      { keys: /\b(camera operator|cam op)\b/i, role: 'Camera Operator (A-Cam / B-Cam)' },
      { keys: /\b(1st ac|focus puller)\b/i, role: '1st Assistant Camera (1st AC / Focus Puller)' },
      { keys: /\b(2nd ac|clapper)\b/i, role: '2nd Assistant Camera (2nd AC / Clapper Loader)' },
      { keys: /\b(steadicam|gimbal)\b/i, role: 'Steadicam / Gimbal Specialist' },
      { keys: /\b(drone|aerial)\b/i, role: 'Drone Pilot / Aerial Cinematographer' },
      { keys: /\b\bdit\b/i, role: 'DIT (Digital Imaging Technician)' },
      { keys: /\b(screen ?writer|script ?writer)\b/i, role: 'Screenwriter / Scriptwriter' },
      { keys: /\bdirector\b/i, role: 'Director' },
      { keys: /\b(executive producer)\b/i, role: 'Executive Producer' },
      { keys: /\b(line producer)\b/i, role: 'Line Producer' },
      { keys: /\b(creative producer|producer)\b/i, role: 'Creative Producer' },
      { keys: /\b(1st ad)\b/i, role: '1st Assistant Director (1st AD)' },
      { keys: /\b(2nd ad)\b/i, role: '2nd Assistant Director (2nd AD)' },
      { keys: /\b(gaffer|lighting tech)\b/i, role: 'Gaffer / Chief Lighting Technician' },
      { keys: /\b(key grip)\b/i, role: 'Key Grip' },
      { keys: /\b(sound designer|sound recordist|sound engineer|audio)\b/i, role: 'Sound Designer / Audio Recordist' },
      { keys: /\b(boom)\b/i, role: 'Boom Operator' },
      { keys: /\b(composer|score)\b/i, role: 'Music Composer / Score Producer' },
      { keys: /\b(colorist|davinci)\b/i, role: 'Colorist (DaVinci Resolve / Baselight)' },
      { keys: /\b(vfx|compositor)\b/i, role: 'VFX Artist / Compositor' },
      { keys: /\b(motion graphics|3d artist)\b/i, role: 'Motion Graphics / 3D Artist' },
      { keys: /\b(video )?editor\b/i, role: 'Lead Video Editor' },
      { keys: /\b(photographer|stills)\b/i, role: 'Photographer / BTS Stills Photographer' },
      { keys: /\b(costume|stylist)\b/i, role: 'Costume Designer / Stylist' },
      { keys: /\b(makeup|hmua)\b/i, role: 'Key Makeup & Hair Artist (HMUA)' },
      { keys: /\b(production designer)\b/i, role: 'Production Designer' },
      { keys: /\b(art director)\b/i, role: 'Art Director' },
      { keys: /\b(actor|actress)\b/i, role: 'Actor' },
    ];

    const roles: string[] = [];
    for (const entry of roleMap) {
      if (entry.keys.test(combined) && !roles.includes(entry.role)) {
        roles.push(entry.role);
      }
    }

    const cityPatterns = [
      'mumbai', 'delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'kolkata',
      'pune', 'ahmedabad', 'jaipur', 'chandigarh', 'kochi', 'goa', 'noida', 'gurgaon',
      'gurugram', 'indore', 'bhopal', 'lucknow', 'coimbatore', 'mysuru', 'nagpur',
    ];
    let city = 'not_specified';
    for (const c of cityPatterns) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(combined)) {
        city = c.charAt(0).toUpperCase() + c.slice(1);
        if (c === 'bangalore') city = 'Bengaluru';
        if (c === 'gurgaon' || c === 'gurugram') city = 'Gurugram';
        break;
      }
    }
    // "in <City>" loose capture for cities not in the list
    if (city === 'not_specified') {
      const m = combined.match(/\bin\s+([a-z][a-z\s]{2,24}?)(?:\s|$|,|\.|!|\?)/i);
      if (m && m[1] && !/the|a|an|my|our|this|that|need|looking|search/i.test(m[1].trim())) {
        const raw = m[1].trim();
        city = raw.charAt(0).toUpperCase() + raw.slice(1);
      }
    }

    const genreList = ['horror', 'thriller', 'comedy', 'drama', 'documentary', 'commercial', 'fashion', 'music video', 'short film', 'feature'];
    const genres = genreList.filter((g) => combined.includes(g));

    const pref = (level: string, importance: string) => ({ level, importance });
    const notSpec = pref('not_specified', 'optional');

    return {
      location: city !== 'not_specified' ? { city } : { city: 'not_specified' },
      project_type: 'not_specified',
      role: roles[0] || 'not_specified',
      roles: roles.length ? roles : [],
      genres,
      minExperienceYears: null,
      preferences: {
        creativity: notSpec,
        communication: notSpec,
        reliability: notSpec,
        flexibility: notSpec,
        teamwork: notSpec,
        feedback_openness: notSpec,
        leadership: notSpec,
        technical_proficiency: notSpec,
      },
      _source: 'heuristic',
    };
  }

  static async understandChat(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<{ success: boolean; data?: any; error?: string }> {
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

    // Prefer Gemini when configured; never hard-fail the chat — fall back to heuristics.
    if (process.env.GEMINI_API_KEY) {
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
        const parsed = JSON.parse(text);
        return { success: true, data: parsed };
      } catch (err: any) {
        console.error(
          '[QueryUnderstanding] Gemini failed, using heuristic fallback:',
          err?.message || err
        );
      }
    } else {
      console.warn('[QueryUnderstanding] GEMINI_API_KEY not configured — heuristic fallback');
    }

    try {
      const data = this.heuristicUnderstandFromMessages(messages);
      return { success: true, data };
    } catch (err: any) {
      console.error('[QueryUnderstanding] Heuristic fallback failed:', err);
      return { success: false, error: err.message || 'Failed to understand query' };
    }
  }
}
