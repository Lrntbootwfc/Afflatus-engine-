/**
 * Configurable weights for final match score.
 * Change these values without touching ranking logic.
 */
export const RECOMMENDATION_WEIGHTS = {
  role: 0.35,
  experience: 0.2,
  behavioural: 0.2,
  projectRelevance: 0.15,
  location: 0.1,
  // availability folded into location block when present; keep sum = 1.0
};

export type TravelPreference =
  | 'remote_only'
  | 'within_city'
  | 'nearby_cities'
  | 'nearby_metro'
  | 'nearby_states'
  | 'anywhere';
