import { expect, test } from "vitest";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TribeExecution } from "../src/core/execution/TribeExecution";
import { Age, PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Regression coverage for the "all tribes locked, no development" freeze
// (docs/ICE_AGE_ECONOMY.md §A). The deadlock had three pieces, each asserted here:
//   1. no income — resources never became gold;
//   2. an unreachable gate — 2 Cities @ 125k;
//   3. bots that could not develop — TribeExecution only attacked + self-deleted
//      its own structures, so it could never own a City to advance.

test("internal economy: a tick mints gold from stockpiled wood", async () => {
  const p1 = new PlayerInfo("p1", PlayerType.Human, "p1", "p1");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const player = game.player("p1");
  player.conquer(game.ref(50, 50));
  player.addWood(100);
  const goldBefore = player.gold();
  const woodBefore = player.wood();

  game.addExecution(new PlayerExecution(player));
  // First executeNextTick init()s the execution; income accrues over the ticks
  // that follow (it's a slow per-tick drip by design).
  for (let i = 0; i < 6; i++) game.executeNextTick();

  expect(player.wood()).toBeLessThan(woodBefore); // wood is consumed
  expect(player.gold()).toBeGreaterThan(goldBefore); // gold is minted
});

test("era gate: a City is prohibitive under full ice, reachable once it recedes", async () => {
  const bot = new PlayerInfo("tribe-gate", PlayerType.Bot, null, "tribe-gate");
  const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
  const tribe = game.player("tribe-gate");
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      tribe.conquer(game.ref(50 + dx, 50 + dy));
    }
  }
  expect(tribe.isAnimalPack()).toBe(false);
  // Enough for a baseline (ice-receded) City + toll, but NOT the 8× ice-age
  // settlement cost — so settlement is gated by the climate clock.
  const iceCost = game.unitInfo(UnitType.City).cost(game, tribe);
  tribe.addGold((iceCost * 3n) / 4n);

  // Deep ice age (tick 0): the permanent settlement is prohibitively expensive.
  expect(tribe.canBuild(UnitType.City, game.ref(50, 50))).toBe(false);

  // Fast-forward until the ice caps have fully receded (no PlayerExecution added,
  // so the tribe just holds its blob and its gold while the clock advances).
  const melt = game.config().climateMeltTicks();
  while (game.ticks() <= melt) game.executeNextTick();

  // With the caps gone the City is back to baseline cost → affordable, and the
  // era gate (≥citiesToAdvance Cities + gold ≥ toll) is reachable.
  const spawn = tribe.canBuild(UnitType.City, game.ref(50, 50));
  expect(spawn).not.toBe(false);
  tribe.buildUnit(UnitType.City, spawn as number, {});
  expect(tribe.unitsOwned(UnitType.City)).toBeGreaterThanOrEqual(1);
  expect(tribe.canAdvanceAge()).toBe(true);
});

test("un-freeze: a developing tribe builds a City and leaves Primitive", async () => {
  const bot = new PlayerInfo("tribe-dev", PlayerType.Bot, null, "tribe-dev");
  const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
  const tribe = game.player("tribe-dev");
  // A compact owned blob — well inside the nomad-camp support radius (never
  // rewilded) and large enough that the develop behavior finds a City placement.
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      tribe.conquer(game.ref(50 + dx, 50 + dy));
    }
  }
  expect(tribe.age()).toBe(Age.Primitive);
  // Ample gold so the develop behavior can afford a settlement even at the
  // ice-age-inflated cost — this asserts the un-freeze itself still holds (a
  // resourced tribe is NOT permanently locked), independent of the climate ramp.
  tribe.addGold(2_000_000n);

  game.addExecution(new PlayerExecution(tribe));
  game.addExecution(new TribeExecution(tribe));

  // Develop is throttled to the tribe's attackRate (~40-80 ticks); give it room
  // for several cycles plus City construction time. Pure sim — cheap.
  for (let i = 0; i < 2000 && tribe.age() === Age.Primitive; i++) {
    game.executeNextTick();
  }

  expect(tribe.unitsOwned(UnitType.City)).toBeGreaterThanOrEqual(1);
  expect(tribe.age()).toBeGreaterThan(Age.Primitive); // it developed out of Primitive
});
