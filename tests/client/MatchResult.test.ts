import { describe, expect, it } from "vitest";
import {
  computeMatchOutcome,
  formatDuration,
  formatShareText,
  formatTiles,
  MatchResultPlayer,
  prefersNativeShare,
  romanNumeral,
} from "../../src/client/hud/layers/MatchResult";

function player(age: number, alive: boolean): MatchResultPlayer {
  return { age: () => age, isAlive: () => alive };
}

describe("computeMatchOutcome", () => {
  it("counts every other tribe as a rival and the dead ones as outlasted", () => {
    const me = player(2, true);
    const everyone = [me, player(0, false), player(1, false), player(3, true)];
    const out = computeMatchOutcome(me, everyone, {
      won: false,
      peakTiles: 100,
      survivedTicks: 0,
    });
    expect(out.rivals).toBe(3);
    expect(out.outlasted).toBe(2);
  });

  it("never reports outlasting more tribes than exist", () => {
    const me = player(0, false);
    const everyone = [me, player(0, false), player(0, false)];
    const out = computeMatchOutcome(me, everyone, {
      won: false,
      peakTiles: 0,
      survivedTicks: 0,
    });
    expect(out.outlasted).toBeLessThanOrEqual(out.rivals);
    expect(out.outlasted).toBe(2);
  });

  it("reports the era as a numeral one above the zero-based age", () => {
    const me = player(0, true);
    expect(
      computeMatchOutcome(me, [me], {
        won: true,
        peakTiles: 0,
        survivedTicks: 0,
      }).eraNumeral,
    ).toBe("I");
    expect(
      computeMatchOutcome(me, [me], {
        won: true,
        peakTiles: 0,
        survivedTicks: 0,
      }).era,
    ).toBe(1);
    const later = player(3, true);
    expect(
      computeMatchOutcome(later, [later], {
        won: true,
        peakTiles: 0,
        survivedTicks: 0,
      }).eraNumeral,
    ).toBe("IV");
  });

  it("clamps negative or fractional inputs rather than rendering them", () => {
    const me = player(0, true);
    const out = computeMatchOutcome(me, [me], {
      won: false,
      peakTiles: -5,
      survivedTicks: 12.9,
    });
    expect(out.peakTiles).toBe(0);
    expect(out.survivedTicks).toBe(12);
  });
});

describe("formatting", () => {
  it("groups thousands deterministically", () => {
    expect(formatTiles(1284)).toBe("1,284");
    expect(formatTiles(0)).toBe("0");
    expect(formatTiles(1234567)).toBe("1,234,567");
  });

  it("renders mm:ss, widening only past the hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(95)).toBe("0:09");
    expect(formatDuration(8620)).toBe("14:22");
    expect(formatDuration(36000)).toBe("1:00:00");
    expect(formatDuration(36610)).toBe("1:01:01");
  });

  it("keeps the roman table in step with the age index", () => {
    expect(romanNumeral(1)).toBe("I");
    expect(romanNumeral(8)).toBe("VIII");
    // Past the table it degrades to a number rather than an empty string.
    expect(romanNumeral(99)).toBe("99");
  });
});

describe("formatShareText", () => {
  const outcome = (over: Partial<ReturnType<typeof computeMatchOutcome>>) => ({
    won: false,
    era: 3,
    eraNumeral: "III",
    peakTiles: 1284,
    outlasted: 173,
    rivals: 205,
    survivedTicks: 8620,
    ...over,
  });

  it("brags on a win and stays honest on a loss", () => {
    expect(formatShareText(outcome({ won: true }))).toContain(
      "Won Primalfront at Age III",
    );
    expect(formatShareText(outcome({ won: false }))).toContain(
      "Fell at Age III in Primalfront",
    );
  });

  it("carries the numbers a reader would repeat", () => {
    const text = formatShareText(outcome({}));
    expect(text).toContain("1,284 tiles");
    expect(text).toContain("outlasted 173 of 205 tribes");
    expect(text).toContain("14:22");
  });

  it("drops the standing when there is nobody to have outlasted", () => {
    const text = formatShareText(outcome({ rivals: 0, outlasted: 0 }));
    expect(text).not.toContain("outlasted");
    expect(text).toContain("1,284 tiles");
  });

  it("drops the standing when the player outlasted nobody, however many rivals", () => {
    const text = formatShareText(outcome({ rivals: 283, outlasted: 0 }));
    expect(text).not.toContain("outlasted");
    expect(text).not.toContain("283");
  });

  it("keeps the standing the moment there is one corpse to name", () => {
    expect(formatShareText(outcome({ rivals: 283, outlasted: 1 }))).toContain(
      "outlasted 1 of 283 tribes",
    );
  });

  it("never leaks how long the era ladder is", () => {
    for (const era of ["I", "III", "VIII"]) {
      const text = formatShareText(outcome({ eraNumeral: era }));
      // No "3/8", no "3 of 8" — the tribe standing is the only "of" allowed.
      expect(text).not.toMatch(/\b(Era|Age)\s+[IVX]+\s*(\/|of)\s*\d/i);
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it("never uses an em or en dash — this string leaves the fleet", () => {
    const text = formatShareText(outcome({ won: true }));
    expect(text).not.toMatch(/[—–]/);
  });
});

describe("prefersNativeShare", () => {
  const coarse = (q: string) => q === "(pointer: coarse)";
  const fine = () => false;

  it("uses the native sheet on a touch device that has one", () => {
    expect(prefersNativeShare(true, coarse)).toBe(true);
  });

  it("copies instead of opening a sheet on a desktop, even though Chrome defines share()", () => {
    expect(prefersNativeShare(true, fine)).toBe(false);
  });

  it("copies when there is no share API at all", () => {
    expect(prefersNativeShare(false, coarse)).toBe(false);
    expect(prefersNativeShare(false, fine)).toBe(false);
  });
});
