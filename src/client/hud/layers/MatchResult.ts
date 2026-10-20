// The end of a match is the only moment a player has something worth telling
// someone else. This module turns the final game state into (a) the four numbers
// worth showing and (b) the one line worth pasting into a chat.
//
// Pure by design — no lit, no GameView, no DOM — so both are unit-testable
// without a browser, and so the share line can be asserted against the rules it
// must never break (see the tests: no era denominator, no em/en dash).

// The era ladder's depth is deliberately NOT surfaced: how many ages exist, and
// how far you are from the last one, is meant to stay unknown. So the era reads
// as a numeral ("Era IV"), never as a fraction of a known total.
const ROMAN = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export function romanNumeral(n: number): string {
  return ROMAN[n] ?? String(n);
}

/** Ten sim ticks per second (see Config.ts). */
export const TICKS_PER_SECOND = 10;

/**
 * The slice of a player this module needs. Narrow on purpose: PlayerView drags
 * in the whole client view layer, and none of it is needed to count corpses.
 */
export interface MatchResultPlayer {
  isAlive(): boolean;
  age(): number;
}

export interface MatchOutcome {
  won: boolean;
  /** 1-based era reached. Numeric so a challenge link can carry it. */
  era: number;
  /** Era reached, as a roman numeral. Never a fraction. */
  eraNumeral: string;
  /** High-water mark of territory, not the (often zero) final count. */
  peakTiles: number;
  /** Rivals already dead when this match ended for the player. */
  outlasted: number;
  /** Every other tribe in the game, alive or dead. */
  rivals: number;
  /** Ticks the player was actually on the map. */
  survivedTicks: number;
}

export function computeMatchOutcome(
  me: MatchResultPlayer,
  everyone: readonly MatchResultPlayer[],
  opts: { won: boolean; peakTiles: number; survivedTicks: number },
): MatchOutcome {
  let rivals = 0;
  let outlasted = 0;
  for (const p of everyone) {
    if (p === me) continue;
    rivals++;
    if (!p.isAlive()) outlasted++;
  }
  const era = me.age() + 1;
  return {
    won: opts.won,
    era,
    eraNumeral: romanNumeral(era),
    peakTiles: Math.max(0, Math.floor(opts.peakTiles)),
    outlasted,
    rivals,
    survivedTicks: Math.max(0, Math.floor(opts.survivedTicks)),
  };
}

/** Grouped thousands, pinned to en-US so the share line is deterministic. */
export function formatTiles(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}

/** mm:ss, widening to h:mm:ss only when a match actually runs past the hour. */
export function formatDuration(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks / TICKS_PER_SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * A native share sheet is a win on a phone (one tap into a chat app) and a
 * regression on a desktop, where it is slower than a copy.
 *
 * AI-NOTE: gate on pointer type, NOT on `navigator.share` being present —
 * desktop Chrome defines share() and, headless, resolves it without doing
 * anything, which silently swallowed the whole share action | evidence:
 * 2026-08-03 M4 real-GPU capture returned an empty clipboard and an unchanged
 * button label
 */
export function prefersNativeShare(
  hasShare: boolean,
  matches: (query: string) => boolean,
): boolean {
  return hasShare && matches("(pointer: coarse)");
}

/**
 * The line a player pastes into a group chat.
 *
 * AI-NOTE: separators are middots, never em/en dashes, and the era is a bare
 * numeral — this string leaves the fleet under the brand's name and would leak
 * the ladder length if it ever carried a denominator | evidence:
 * tests/client/MatchResult.test.ts asserts both
 */
export function formatShareText(outcome: MatchOutcome): string {
  const headline = outcome.won
    ? `Won Primalfront at Era ${outcome.eraNumeral}`
    : `Fell at Era ${outcome.eraNumeral} in Primalfront`;
  const parts = [headline, `${formatTiles(outcome.peakTiles)} tiles`];
  // Outlasting nobody is noise, not a brag: "outlasted 0 of 283 tribes" is a
  // worse line to paste than no line at all.
  if (outcome.outlasted > 0) {
    parts.push(`outlasted ${outcome.outlasted} of ${outcome.rivals} tribes`);
  }
  parts.push(formatDuration(outcome.survivedTicks));
  return parts.join(" · ");
}
