import { expect, test } from "vitest";
import { Age, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Owner direction 2026-10-21: eras are long and progress keeps slowing. Tech is
// the per-era clock, which only works if a long Stone Age cannot pre-pay every
// later era. These pins keep that true.

test("tech is banked at most 1.5x the current era's requirement", async () => {
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");
  const game = await setup("plains", {}, [info]);
  const player = game.player(info.id);
  const config = game.config();
  const cap = config.techPointCap(Age.Primitive);
  expect(cap).toBe(Math.ceil(200 * 1.5));
  player.addTechPoints(100_000);
  expect(player.techPoints()).toBe(cap);
  // A shrinking cap never deletes points; only growth is clamped.
  player.addTechPoints(5);
  expect(player.techPoints()).toBe(cap);
});

test("every era after the Stone Age needs more tech than the one before", async () => {
  const info = new PlayerInfo("q", PlayerType.Human, null, "q");
  const game = await setup("plains", {}, [info]);
  const config = game.config();
  const ages = [
    Age.Classical,
    Age.Imperial,
    Age.Feudal,
    Age.Enlightened,
    Age.Industrial,
    Age.Modern,
  ];
  let prev = 0;
  for (const age of ages) {
    const cost = config.baseAdvanceAgeCost(age);
    expect(cost).not.toBeNull();
    expect(cost!.techPoints).toBeGreaterThan(prev);
    prev = cost!.techPoints;
  }
});

test("a one-City kingdom needs at least eight minutes of tech for Imperial", async () => {
  const info = new PlayerInfo("k", PlayerType.Human, null, "k");
  const game = await setup("plains", {}, [info]);
  const player = game.player(info.id);
  const config = game.config();
  // Banked tech on entering Classical is at most the Primitive cap (300).
  const banked = config.techPointCap(Age.Primitive);
  const need = config.baseAdvanceAgeCost(Age.Classical)!.techPoints - banked;
  // One City: base 1/tick + 0.5 -> 1.5/tick. Eight minutes = 4800 ticks.
  const perTick = config.techPointsPerTick(player) + 0.5;
  expect(need / perTick).toBeGreaterThanOrEqual(4800);
  // The Ingenuity triumph (1.25x) stays reachable under the 1.5x bank cap.
  expect(config.eraIngenuityTargetMult()).toBeLessThan(
    config.techPointBankMult(),
  );
});
