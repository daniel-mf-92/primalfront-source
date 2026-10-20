import { Game, PlayerType } from "../game/Game";

// ONE definition of how many primitive tribes the world should hold.
//
// This used to live inline in PrimitiveRepopulationExecution while
// TribeSplitExecution multiplied tribes with no ceiling at all. Two subsystems,
// opposed ideas of the same quantity: repopulation aimed for a "gappy" world of
// at most primitiveMaxTribes, while splitting drove a stock 133-bot public game
// to 3,646 alive tribes. Neither looked wrong on its own, and the world could
// never resolve — the map leader held 0.2% of the land for eleven minutes.
//
// Both callers now read the ceiling from here, so the two can no longer drift.

/**
 * The land-scaled ceiling on primitive bot tribes: low by design, because the
 * Primitive era is meant to be mostly empty wilderness with a few tribes roaming
 * it. Floored so a tiny map still has opponents.
 */
export function primitiveTribeCeiling(mg: Game): number {
  const config = mg.config();
  return Math.max(
    config.primitiveMinTribes(),
    Math.min(
      config.primitiveMaxTribes(),
      Math.floor(mg.numLandTiles() / config.primitiveTilesPerTribe()),
    ),
  );
}

// Per-(game, tick) memo: split checks are staggered across players, so without
// this the census runs once per checking player per tick.
let cachedGame: Game | null = null;
let cachedTick = -1;
let cachedCount = 0;

/**
 * Living bot tribes right now.
 *
 * AI-NOTE: mg.players() is ALREADY filtered to the living — relied on here, and
 * the reason a naive "total minus alive" census elsewhere always read zero |
 * evidence: fleet lesson L69, tests/PrimitiveDensity.test.ts
 */
export function aliveBotTribes(mg: Game): number {
  if (cachedGame === mg && cachedTick === mg.ticks()) {
    return cachedCount;
  }
  let count = 0;
  for (const p of mg.players()) {
    if (p.type() === PlayerType.Bot) count++;
  }
  cachedGame = mg;
  cachedTick = mg.ticks();
  cachedCount = count;
  return count;
}

/** True when the world already holds as many tribes as it is meant to. */
export function atPrimitiveTribeCeiling(mg: Game): boolean {
  return aliveBotTribes(mg) >= primitiveTribeCeiling(mg);
}
