/**
 * Module §11 — prey variety, owner direction 2026-08-03: "add more variety like
 * roaming deer on map, and bison, etc, terrain appropriate, also mammoth during
 * ice age declining as time advances."
 *
 * Mammoths already existed as ice-age megafauna that go extinct with the caps.
 * These pin the two properties that must not silently regress:
 *   1. each species stays in terrain that suits it, and
 *   2. ONLY the megafauna decline — deer and bison are the staple that outlives
 *      them, or a roaming tribe has nothing left to follow once the ice goes.
 *
 * Asserts the real exported rules, not a copy of them.
 */
import {
  HerdSpecies,
  speciesAllowsBiome,
  speciesIsClimateBound,
} from "../src/core/execution/MammothHerdExecution";
import { Biome } from "../src/core/game/Game";

const FULL_ICE = 1;
const NO_ICE = 0;

describe("terrain-appropriate ranges", () => {
  test("deer are woodland game, never desert, ice or open arid", () => {
    for (const b of [Biome.Forest, Biome.Jungle, Biome.Green]) {
      expect(speciesAllowsBiome(HerdSpecies.Deer, b, NO_ICE)).toBe(true);
    }
    for (const b of [Biome.Sandy, Biome.Cold, Biome.Arid]) {
      expect(speciesAllowsBiome(HerdSpecies.Deer, b, NO_ICE)).toBe(false);
    }
  });

  test("bison range open grass and arid, never forest or jungle", () => {
    expect(speciesAllowsBiome(HerdSpecies.Bison, Biome.Green, NO_ICE)).toBe(
      true,
    );
    expect(speciesAllowsBiome(HerdSpecies.Bison, Biome.Arid, NO_ICE)).toBe(
      true,
    );
    expect(speciesAllowsBiome(HerdSpecies.Bison, Biome.Forest, NO_ICE)).toBe(
      false,
    );
    expect(speciesAllowsBiome(HerdSpecies.Bison, Biome.Jungle, NO_ICE)).toBe(
      false,
    );
  });

  test("mammoths roam widely under ice but retreat to cold and forest after it", () => {
    // Under the caps: everywhere except jungle.
    expect(speciesAllowsBiome(HerdSpecies.Mammoth, Biome.Arid, FULL_ICE)).toBe(
      true,
    );
    expect(
      speciesAllowsBiome(HerdSpecies.Mammoth, Biome.Jungle, FULL_ICE),
    ).toBe(false);
    // Once receded: refugia only.
    expect(speciesAllowsBiome(HerdSpecies.Mammoth, Biome.Cold, NO_ICE)).toBe(
      true,
    );
    expect(speciesAllowsBiome(HerdSpecies.Mammoth, Biome.Forest, NO_ICE)).toBe(
      true,
    );
    expect(speciesAllowsBiome(HerdSpecies.Mammoth, Biome.Arid, NO_ICE)).toBe(
      false,
    );
    expect(speciesAllowsBiome(HerdSpecies.Mammoth, Biome.Green, NO_ICE)).toBe(
      false,
    );
  });

  test("the three species do not occupy identical ranges", () => {
    const range = (s: HerdSpecies) =>
      [
        Biome.Cold,
        Biome.Green,
        Biome.Arid,
        Biome.Sandy,
        Biome.Forest,
        Biome.Jungle,
      ]
        .filter((b) => speciesAllowsBiome(s, b, NO_ICE))
        .join(",");
    expect(range(HerdSpecies.Deer)).not.toBe(range(HerdSpecies.Bison));
    expect(range(HerdSpecies.Mammoth)).not.toBe(range(HerdSpecies.Deer));
  });
});

describe("only the megafauna decline with the ice", () => {
  test("mammoths are climate-bound", () => {
    expect(speciesIsClimateBound(HerdSpecies.Mammoth)).toBe(true);
  });

  test("deer and bison are not, so prey survives the melt", () => {
    expect(speciesIsClimateBound(HerdSpecies.Deer)).toBe(false);
    expect(speciesIsClimateBound(HerdSpecies.Bison)).toBe(false);
  });
});
