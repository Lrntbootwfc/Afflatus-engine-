/**
 * Progressive collaboration question pool (Afflatus).
 * Does NOT include the original onboarding scenario_q1–q5.
 * Does NOT include travel — travel stays a practical profile field.
 */
export type ProgressiveCollabQuestion = {
  id: string;
  prompt: string;
  type: 'single' | 'multi';
  maxSelect?: number;
  options: string[];
  /** Soft tags for selection / analysis — not public precision scores */
  signalTags: string[];
};

export const PROGRESSIVE_COLLAB_QUESTIONS: ProgressiveCollabQuestion[] = 
[
  {
    "id": "cq_01",
    "prompt": "When working with someone new, what helps you become comfortable working with them?",
    "type": "multi",
    "maxSelect": 3,
    "options": [
      "Clear communication",
      "Seeing their previous work",
      "Consistency",
      "Friendly interaction",
      "Understanding how they work",
      "Giving each other space",
      "A successful first task together"
    ],
    "signalTags": [
      "trust",
      "communication",
      "working_structure"
    ]
  },
  {
    "id": "cq_02",
    "prompt": "What usually makes you trust a new collaborator?",
    "type": "single",
      "options": [
      "Their previous work",
      "Consistency",
      "Communication",
      "Meeting commitments",
      "Recommendations from others",
      "How they treat people",
      "How they approach the first project"
    ],
    "signalTags": [
      "trust",
      "reliability"
    ]
  },
  {
    "id": "cq_03",
    "prompt": "When choosing between two equally skilled collaborators, what would influence your decision most?",
    "type": "single",
      "options": [
      "Communication",
      "Reliability",
      "Creative compatibility",
      "Previous work",
      "Working style",
      "Personality/team fit",
      "Previous collaboration experience"
    ],
    "signalTags": [
      "values_in_collaborators",
      "creative_compatibility"
    ]
  },
  {
    "id": "cq_04",
    "prompt": "What makes someone's communication difficult for you?",
    "type": "multi",
    "maxSelect": 3,
    "options": [
      "Slow responses",
      "Unclear messages",
      "Too many messages",
      "Not communicating problems early",
      "Being overly blunt",
      "Avoiding difficult conversations",
      "Changing expectations without discussion"
    ],
    "signalTags": [
      "communication",
      "feedback_style"
    ]
  },
  {
    "id": "cq_05",
    "prompt": "When something isn't going as planned, how would you prefer a collaborator to handle it?",
    "type": "single",
      "options": [
      "Tell me immediately",
      "Try to solve it first and then update me",
      "Discuss it with the team",
      "Bring a solution along with the problem",
      "Depends on the situation"
    ],
    "signalTags": [
      "communication",
      "problem_solving",
      "initiative"
    ]
  },
  {
    "id": "cq_06",
    "prompt": "How important is it that collaborators respect agreed boundaries and responsibilities?",
    "type": "single",
      "options": [
      "Not very important",
      "Somewhat important",
      "Important",
      "Very important",
      "Extremely important"
    ],
    "signalTags": [
      "ownership",
      "boundaries",
      "working_structure"
    ]
  },
  {
    "id": "cq_07",
    "prompt": "How important is it for collaborators to be able to work independently?",
    "type": "single",
      "options": [
      "Not important",
      "Slightly important",
      "Moderately important",
      "Very important",
      "Essential"
    ],
    "signalTags": [
      "independence",
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_08",
    "prompt": "What do you consider a sign that someone is genuinely committed to a project?",
    "type": "multi",
    "maxSelect": 3,
    "options": [
      "Meeting commitments",
      "Consistent communication",
      "Taking initiative",
      "Putting in extra effort when needed",
      "Preparing before meetings/tasks",
      "Helping the team",
      "Following through on ideas"
    ],
    "signalTags": [
      "reliability",
      "initiative",
      "commitment"
    ]
  },
  {
    "id": "cq_09",
    "prompt": "How important is it that collaborators give credit fairly?",
    "type": "single",
      "options": [
      "Not important",
      "Slightly important",
      "Moderately important",
      "Very important",
      "Extremely important"
    ],
    "signalTags": [
      "trust",
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_10",
    "prompt": "How important is it that collaborators openly acknowledge when they don't know something?",
    "type": "single",
      "options": [
      "Not important",
      "Slightly important",
      "Moderately important",
      "Very important",
      "Extremely important"
    ],
    "signalTags": [
      "trust",
      "feedback_style",
      "ownership"
    ]
  },
  {
    "id": "cq_11",
    "prompt": "How much do you value a collaborator who takes initiative without being asked?",
    "type": "single",
      "options": [
      "Not important to me",
      "Slightly important",
      "Moderately important",
      "Very important",
      "Essential"
    ],
    "signalTags": [
      "initiative",
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_12",
    "prompt": "If you finish your part early and notice another part needs attention, what would you normally do?",
    "type": "single",
      "options": [
      "Move on to my next task",
      "Let the person know",
      "Offer to help",
      "Take care of it if I can",
      "Discuss it with the team first"
    ],
    "signalTags": [
      "initiative",
      "teamwork",
      "ownership"
    ]
  },
  {
    "id": "cq_13",
    "prompt": "What kind of collaborator would you most enjoy having on a project?",
    "type": "multi",
    "maxSelect": 3,
    "options": [
      "Someone who brings new ideas",
      "Someone highly organised",
      "Someone dependable",
      "Someone who challenges ideas",
      "Someone who keeps the team motivated",
      "Someone technically strong",
      "Someone adaptable",
      "Someone who takes initiative"
    ],
    "signalTags": [
      "values_in_collaborators",
      "creative_compatibility",
      "adaptability"
    ]
  },
  {
    "id": "cq_14",
    "prompt": "When priorities suddenly change, what do you usually prefer?",
    "type": "single",
      "options": [
      "Clear new instructions",
      "Discuss the new priorities with the team",
      "Decide what needs changing myself",
      "Adapt and figure it out as I go",
      "Depends on the situation"
    ],
    "signalTags": [
      "adaptability",
      "working_structure",
      "independence"
    ]
  },
  {
    "id": "cq_15",
    "prompt": "If a collaborator is struggling with their part of a project, what would you most likely do?",
    "type": "single",
      "options": [
      "Offer help directly",
      "Ask what they need",
      "Give them space unless they ask",
      "Help them find a solution",
      "Take over if the deadline is at risk",
      "Discuss it with the project lead"
    ],
    "signalTags": [
      "teamwork",
      "initiative",
      "communication"
    ]
  },
  {
    "id": "cq_16",
    "prompt": "What kind of contribution do you appreciate most from someone who joins your project?",
    "type": "single",
      "options": [
      "Expertise",
      "New perspective",
      "Execution",
      "Problem-solving",
      "Organisation",
      "Creative ideas",
      "Connections/resources",
      "Emotional/team support"
    ],
    "signalTags": [
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_17",
    "prompt": "Which would you prefer?",
    "type": "single",
      "options": [
      "A highly skilled collaborator who works independently",
      "A moderately skilled collaborator who communicates constantly",
      "Someone somewhere between the two",
      "Depends on the project"
    ],
    "signalTags": [
      "independence",
      "communication",
      "working_structure"
    ]
  },
  {
    "id": "cq_18",
    "prompt": "Which matters more to you?",
    "type": "single",
      "options": [
      "Someone who challenges your ideas",
      "Someone who helps execute your ideas",
      "Someone who can do both"
    ],
    "signalTags": [
      "creative_compatibility",
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_19",
    "prompt": "Which would you rather have from a collaborator?",
    "type": "single",
      "options": [
      "Someone who agrees easily",
      "Someone who challenges my ideas constructively",
      "Someone who balances agreement and challenge",
      "Depends on the project"
    ],
    "signalTags": [
      "feedback_style",
      "creative_compatibility"
    ]
  },
  {
    "id": "cq_20",
    "prompt": "What would make you feel that a collaborator genuinely respects your contribution?",
    "type": "single",
      "options": [
      "Asking for my opinion",
      "Giving me creative freedom",
      "Giving proper credit",
      "Trusting my expertise",
      "Including me in decisions",
      "Taking my feedback seriously",
      "Giving constructive feedback"
    ],
    "signalTags": [
      "trust",
      "feedback_style",
      "ownership"
    ]
  },
  {
    "id": "cq_21",
    "prompt": "When someone asks for your opinion on their work, what do you usually focus on first?",
    "type": "single",
      "options": [
      "Whether the idea works",
      "Technical quality",
      "Creative quality",
      "Whether it meets the goal",
      "What could be improved",
      "What is already working well"
    ],
    "signalTags": [
      "feedback_style"
    ]
  },
  {
    "id": "cq_22",
    "prompt": "If you notice a collaborator making a mistake, what would you prefer to do?",
    "type": "single",
      "options": [
      "Tell them immediately",
      "Ask questions first",
      "Privately explain the issue",
      "Wait to see whether they notice",
      "Depends on how serious it is"
    ],
    "signalTags": [
      "feedback_style",
      "communication"
    ]
  },
  {
    "id": "cq_23",
    "prompt": "When working on a project, how do you usually approach decisions that fall outside your specific role?",
    "type": "single",
      "options": [
      "I prefer someone else to make the call",
      "I share my perspective but leave the final decision to the lead",
      "I actively participate in the decision",
      "I prefer taking ownership and making the decision when needed"
    ],
    "signalTags": [
      "ownership",
      "initiative",
      "working_structure"
    ]
  },
  {
    "id": "cq_24",
    "prompt": "If you had to choose, what would you value more in a collaborator?",
    "type": "single",
      "options": [
      "Extremely creative but unpredictable",
      "Very reliable but less experimental",
      "A balance of both",
      "Depends on the project"
    ],
    "signalTags": [
      "creative_compatibility",
      "reliability",
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_25",
    "prompt": "What does being a reliable collaborator mean to you?",
    "type": "single",
      "options": [
      "Meeting agreed deadlines",
      "Communicating early when something changes",
      "Following through without repeated reminders",
      "Being available when needed",
      "Taking responsibility when something goes wrong"
    ],
    "signalTags": [
      "reliability",
      "ownership",
      "communication"
    ]
  },
  {
    "id": "cq_26",
    "prompt": "If you notice something in a project that could be improved, what would you normally do?",
    "type": "single",
      "options": [
      "Focus on my assigned responsibility",
      "Suggest the improvement to the relevant person",
      "Try to fix it myself if I can",
      "Discuss it with the team and take ownership if needed"
    ],
    "signalTags": [
      "initiative",
      "ownership",
      "teamwork"
    ]
  },
  {
    "id": "cq_27",
    "prompt": "When giving feedback to a collaborator, what is most important to you?",
    "type": "single",
      "options": [
      "Being direct",
      "Being constructive",
      "Being specific",
      "Being respectful",
      "Explaining the reasoning",
      "Suggesting a solution"
    ],
    "signalTags": [
      "feedback_style"
    ]
  },
  {
    "id": "cq_28",
    "prompt": "What would make you reconsider continuing a collaboration?",
    "type": "single",
      "options": [
      "Repeatedly missed commitments",
      "Poor communication",
      "Disrespectful behaviour",
      "Lack of accountability",
      "Creative differences",
      "Lack of effort",
      "Unclear expectations",
      "Something else"
    ],
    "signalTags": [
      "trust",
      "reliability",
      "values_in_collaborators"
    ]
  },
  {
    "id": "cq_29",
    "prompt": "Which matters most to you when working with others?",
    "type": "single",
      "options": [
      "Recognition for my contribution",
      "Creative freedom",
      "Learning opportunities",
      "Being trusted",
      "Being included in decisions",
      "Building something meaningful",
      "Building professional relationships"
    ],
    "signalTags": [
      "values_in_collaborators",
      "ownership"
    ]
  },
  {
    "id": "cq_30",
    "prompt": "If a collaborator proposes an idea very different from yours, what would you most likely do?",
    "type": "single",
      "options": [
      "Explore their idea before deciding",
      "Compare both approaches",
      "Explain why I prefer mine",
      "Let the project lead decide",
      "Try combining both ideas"
    ],
    "signalTags": [
      "adaptability",
      "creative_compatibility",
      "feedback_style"
    ]
  },
  {
    "id": "cq_31",
    "prompt": "If you make a mistake that affects the project, what would you consider the right response?",
    "type": "single",
      "options": [
      "Fix it myself",
      "Inform the relevant person immediately",
      "Explain what happened and propose a solution",
      "Ask for help if necessary",
      "Depends on the impact"
    ],
    "signalTags": [
      "ownership",
      "reliability",
      "communication"
    ]
  },
  {
    "id": "cq_32",
    "prompt": "What do you value most from a collaborator who works outside your own role?",
    "type": "single",
      "options": [
      "Fresh ideas",
      "Technical expertise",
      "Different perspective",
      "Constructive criticism",
      "Problem-solving",
      "Helping execute the idea",
      "Challenging my assumptions"
    ],
    "signalTags": [
      "values_in_collaborators",
      "creative_compatibility"
    ]
  },
  {
    "id": "cq_33",
    "prompt": "When a project doesn't go the way you expected, what do you tend to focus on first?",
    "type": "single",
      "options": [
      "Finding the problem",
      "Finding a solution",
      "Understanding what went wrong",
      "Adjusting expectations",
      "Getting the team aligned",
      "Moving forward and adapting"
    ],
    "signalTags": [
      "adaptability",
      "problem_solving",
      "teamwork"
    ]
  },
  {
    "id": "cq_34",
    "prompt": "How comfortable are you working with someone whose experience level is very different from yours?",
    "type": "single",
      "options": [
      "Very uncomfortable",
      "Somewhat uncomfortable",
      "Neutral",
      "Comfortable",
      "Very comfortable"
    ],
    "signalTags": [
      "adaptability",
      "teamwork"
    ]
  },
  {
    "id": "cq_35",
    "prompt": "What do you value more from a collaborator when a project is under pressure?",
    "type": "single",
      "options": [
      "Staying calm",
      "Working faster",
      "Communicating clearly",
      "Taking initiative",
      "Helping others",
      "Focusing strictly on priorities",
      "Finding creative solutions"
    ],
    "signalTags": [
      "adaptability",
      "communication",
      "initiative",
      "reliability"
    ]
  }
];

export const PROGRESSIVE_COLLAB_BY_ID = Object.fromEntries(
  PROGRESSIVE_COLLAB_QUESTIONS.map((q) => [q.id, q])
) as Record<string, ProgressiveCollabQuestion>;
