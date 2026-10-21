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

test("every era after the Stone Age needs the same tech (equal-length eras)", async () => {
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
  const first = config.baseAdvanceAgeCost(Age.Classical)!.techPoints;
  for (const age of ages) {
    expect(config.baseAdvanceAgeCost(age)!.techPoints).toBe(first);
  }
});

test("tech per tick is capped, so building more cannot beeline an era", async () => {
  const info = new PlayerInfo("r", PlayerType.Human, null, "r");
  const game = await setup("plains", {}, [info]);
  const player = game.player(info.id);
  const config = game.config();
  expect(config.techPointsPerTick(player)).toBeLessThanOrEqual(
    config.techPointsPerTickCap(),
  );
  // At the cap, one era of tech takes at least ten minutes (6000 ticks).
  const need = config.baseAdvanceAgeCost(Age.Classical)!.techPoints;
  expect(need / config.techPointsPerTickCap()).toBeGreaterThanOrEqual(6000);
});

test("advancing an era resets tech to zero (no pre-paying the next era)", async () => {
  const info = new PlayerInfo("s", PlayerType.Human, null, "s");
  const game = await setup("plains", {}, [info]);
  const player = game.player(info.id);
  const config = game.config();
  player.setAge(Age.Classical); // Classical -> Imperial has no keystone
  const cost = config.advanceAgeCost(player)!;
  player.addGold(cost.gold);
  // With zero Triumphs the transition costs 1.5x base, which is exactly the
  // bank cap: reachable, and the slowest path up the ladder by design.
  player.addTechPoints(config.techPointCap(Age.Classical));
  expect(player.techPoints()).toBeGreaterThanOrEqual(cost.techPoints);
  expect(player.canAdvanceAge()).toBe(true);
  expect(player.advanceAge()).toBe(true);
  expect(player.age()).toBe(Age.Imperial);
  expect(player.techPoints()).toBe(0);
});

test("a one-City kingdom needs at least ten minutes of tech for Imperial", async () => {
  const info = new PlayerInfo("k", PlayerType.Human, null, "k");
  const game = await setup("plains", {}, [info]);
  const player = game.player(info.id);
  const config = game.config();
  // Tech resets to zero on advancing, so a new kingdom starts from nothing.
  const need = config.baseAdvanceAgeCost(Age.Classical)!.techPoints;
  // One City: base 1/tick + 0.5 -> 1.5/tick (the cap). Ten minutes = 6000 ticks.
  const perTick = Math.min(
    config.techPointsPerTickCap(),
    config.techPointsPerTick(player) + 0.5,
  );
  expect(need / perTick).toBeGreaterThanOrEqual(6000);
  // The Ingenuity triumph (1.25x) stays reachable under the 1.5x bank cap.
  expect(config.eraIngenuityTargetMult()).toBeLessThan(
    config.techPointBankMult(),
  );
});

test("diffusion credit never stacks past the contiguous grant and only reaches the next age", async () => {
  const a = new PlayerInfo("a", PlayerType.Human, null, "a");
  const b = new PlayerInfo("b", PlayerType.Human, null, "b");
  const game = await setup("plains", {}, [a, b]);
  const pb = game.player(b.id);
  const config = game.config();
  pb.addAgeAdvanceCredit(config.diffusionContiguousDiscount());
  pb.addAgeAdvanceCredit(config.diffusionContiguousDiscount());
  pb.addAgeAdvanceCredit(config.diffusionContiguousDiscount());
  expect(pb.ageAdvanceCredit()).toBe(config.diffusionContiguousDiscount());
  // A Classical player learns nothing from a neighbour reaching Classical.
  const pa = game.player(a.id);
  pa.setAge(Age.Classical);
  pb.setAge(Age.Classical);
  pb.setAgeAdvanceCredit(0);
  game.grantEraDiffusion(pa, Age.Classical);
  expect(pb.ageAdvanceCredit()).toBe(0);
});
