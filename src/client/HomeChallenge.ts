// A shared result link lands here. The URL carries the numbers the sharer put
// on their clipboard so the home page can answer "why am I here" instead of
// showing a stranger a lobby list and hoping.
//
// Pure by design (no DOM, no lit) and paranoid by necessity: everything below
// arrives from a URL that anyone can type, so nothing is trusted, nothing is
// interpolated into markup, and every field is clamped into a sane range or the
// whole thing is rejected. A malformed challenge must degrade to "no challenge",
// never to a broken or half-rendered page.

/** Query parameter carrying a shared result. Short because it is pasted. */
export const CHALLENGE_PARAM = "c";

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
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

/**
 * Parse a challenge out of a query string. Returns null for anything that is
 * absent, malformed, or self-contradictory — callers render nothing extra.
 */
export function parseChallenge(search: string): Challenge | null {
  let raw: string | null;
  try {
    // Tolerate being handed a whole href or a search string that still carries
    // the fragment: `location.search` never includes one, but callers do.
    const query = search.split("#")[0];
    raw = new URLSearchParams(query).get(CHALLENGE_PARAM);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const parts = SHAPE.exec(raw);
  if (parts === null) return null;

  const era = clamp(Number(parts[1]), MAX_ERA);
  // Era 0 is not a thing; the ladder starts at I.
  if (era < 1) return null;

  const rivals = clamp(Number(parts[4]), MAX_RIVALS);
  return {
    era,
    tiles: clamp(Number(parts[2]), MAX_TILES),
    // You cannot have outlasted more tribes than were in the game.
    outlasted: Math.min(clamp(Number(parts[3]), MAX_RIVALS), rivals),
    rivals,
    seconds: clamp(Number(parts[5]), MAX_SECONDS),
  };
}

/** Build the query fragment for a result worth challenging someone with. */
export function encodeChallenge(challenge: Challenge): string {
  const era = clamp(challenge.era, MAX_ERA);
  const rivals = clamp(challenge.rivals, MAX_RIVALS);
  const outlasted = Math.min(clamp(challenge.outlasted, MAX_RIVALS), rivals);
  return [
    `${CHALLENGE_PARAM}=${era}`,
    clamp(challenge.tiles, MAX_TILES),
    outlasted,
    rivals,
    clamp(challenge.seconds, MAX_SECONDS),
  ].join(".");
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
