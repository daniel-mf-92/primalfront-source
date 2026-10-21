import { Difficulty, GameMapType } from "./game/Game";

// A shared result link. The URL carries the numbers the sharer put on their
// clipboard, plus the practice setup they played, so the receiver can answer
// "why am I here" AND start the exact same match in one tap. Shared by the
// client (home page, end-of-match share) and the server (link preview tags).
//
// Pure by design (no DOM, no lit) and paranoid by necessity: everything below
// arrives from a URL that anyone can type, so nothing is trusted, nothing is
// interpolated into markup, and every field is clamped into a sane range or the
// whole thing is rejected. A malformed challenge must degrade to "no challenge",
// never to a broken or half-rendered page.

/** Query parameter carrying a shared result. Short because it is pasted. */
export const CHALLENGE_PARAM = "c";
/** The practice setup, as separate params so an old link still parses. */
export const CHALLENGE_MAP_PARAM = "m";
export const CHALLENGE_DIFFICULTY_PARAM = "d";
export const CHALLENGE_COMPACT_PARAM = "k";

/** Era ladder length is never disclosed, but a numeral above this is nonsense. */
const MAX_ERA = 12;
const MAX_TILES = 10_000_000;
const MAX_RIVALS = 1_000_000;
const MAX_SECONDS = 1_000_000;

/**
 * Five non-negative integers, dot-separated, with hard length caps so a
 * pathological string cannot reach the number parser at all.
 */
const SHAPE = /^(\d{1,2})\.(\d{1,8})\.(\d{1,7})\.(\d{1,7})\.(\d{1,7})$/;

export interface Challenge {
  /** 1-based era, already clamped into the roman-numeral table's range. */
  era: number;
  tiles: number;
  outlasted: number;
  rivals: number;
  seconds: number;
  /** The practice setup, when the link carries one (validated enum values). */
  map?: GameMapType;
  difficulty?: Difficulty;
  compact?: boolean;
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

const MAP_VALUES = new Set<string>(Object.values(GameMapType));
const DIFFICULTY_VALUES = new Set<string>(Object.values(Difficulty));

export function isGameMapType(value: unknown): value is GameMapType {
  return typeof value === "string" && MAP_VALUES.has(value);
}

export function isDifficultyValue(value: unknown): value is Difficulty {
  return typeof value === "string" && DIFFICULTY_VALUES.has(value);
}

/**
 * Parse a challenge out of a query string. Returns null for anything that is
 * absent, malformed, or self-contradictory — callers render nothing extra.
 */
export function parseChallenge(search: string): Challenge | null {
  let params: URLSearchParams;
  try {
    // Tolerate being handed a whole href or a search string that still carries
    // the fragment: `location.search` never includes one, but callers do.
    params = new URLSearchParams(search.split("#")[0]);
  } catch {
    return null;
  }
  const raw = params.get(CHALLENGE_PARAM);
  if (raw === null) return null;

  const parts = SHAPE.exec(raw);
  if (parts === null) return null;

  const era = clamp(Number(parts[1]), MAX_ERA);
  // Era 0 is not a thing; the ladder starts at I.
  if (era < 1) return null;

  const rivals = clamp(Number(parts[4]), MAX_RIVALS);
  const challenge: Challenge = {
    era,
    tiles: clamp(Number(parts[2]), MAX_TILES),
    // You cannot have outlasted more tribes than were in the game.
    outlasted: Math.min(clamp(Number(parts[3]), MAX_RIVALS), rivals),
    rivals,
    seconds: clamp(Number(parts[5]), MAX_SECONDS),
  };
  // The setup is optional and each field stands alone: an unknown map (a
  // renamed or removed one) drops silently, the score still shows.
  const map = params.get(CHALLENGE_MAP_PARAM);
  if (isGameMapType(map)) challenge.map = map;
  const difficulty = params.get(CHALLENGE_DIFFICULTY_PARAM);
  if (isDifficultyValue(difficulty)) challenge.difficulty = difficulty;
  if (params.get(CHALLENGE_COMPACT_PARAM) === "1") challenge.compact = true;
  return challenge;
}

/** Build the query fragment for a result worth challenging someone with. */
export function encodeChallenge(challenge: Challenge): string {
  const era = clamp(challenge.era, MAX_ERA);
  const rivals = clamp(challenge.rivals, MAX_RIVALS);
  const outlasted = Math.min(clamp(challenge.outlasted, MAX_RIVALS), rivals);
  let query = [
    `${CHALLENGE_PARAM}=${era}`,
    clamp(challenge.tiles, MAX_TILES),
    outlasted,
    rivals,
    clamp(challenge.seconds, MAX_SECONDS),
  ].join(".");
  if (isGameMapType(challenge.map)) {
    query += `&${CHALLENGE_MAP_PARAM}=${encodeURIComponent(challenge.map)}`;
  }
  if (isDifficultyValue(challenge.difficulty)) {
    query += `&${CHALLENGE_DIFFICULTY_PARAM}=${challenge.difficulty}`;
  }
  if (challenge.compact === true) {
    query += `&${CHALLENGE_COMPACT_PARAM}=1`;
  }
  return query;
}

/**
 * The full link a player shares. Origin is passed in rather than read from
 * `location` so this stays pure and testable.
 */
export function buildChallengeUrl(
  origin: string,
  challenge: Challenge,
): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/?${encodeChallenge(challenge)}`;
}
