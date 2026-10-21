// The shared-result link lives in core (the server reads it too, for link
// previews); this module keeps the client's import path and test surface.
export {
  CHALLENGE_COMPACT_PARAM,
  CHALLENGE_DIFFICULTY_PARAM,
  CHALLENGE_MAP_PARAM,
  CHALLENGE_PARAM,
  buildChallengeUrl,
  encodeChallenge,
  parseChallenge,
} from "../core/ChallengeLink";
export type { Challenge } from "../core/ChallengeLink";
