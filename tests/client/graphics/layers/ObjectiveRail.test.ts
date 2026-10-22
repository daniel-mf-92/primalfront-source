import { expect, test } from "vitest";
import {
  canAdvanceFromGates,
  chooseObjective,
  computeAgeGates,
  computeEraTriumphs,
  computePrimitiveGoldPipeline,
} from "../../../../src/client/hud/layers/ObjectiveRail";
import { PlayerExecution } from "../../../../src/core/execution/PlayerExecution";
import {
  Age,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../../src/core/game/Game";
import { setup } from "../../../util/Setup";

test("primitive age gates match the sim: City + gold, no client-only tech blocker", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  player.conquer(game.ref(50, 50));
  player.addGold(2_000_000n);
  player.buildUnit(UnitType.City, game.ref(50, 50), {});

  const gates = computeAgeGates(player, game.config());

  expect(player.techPoints()).toBe(0);
  expect(gates.map((gate) => gate.id)).toEqual(["city", "gold"]);
  expect(canAdvanceFromGates(gates)).toBe(true);
  expect(player.canAdvanceAge()).toBe(true);
  expect(chooseObjective(player, game.config(), gates).id).toBe("advance_age");
});

test("primitive objective starts on resource discovery when no economy exists", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  player.conquer(game.ref(50, 50));

  const objective = chooseObjective(player, game.config());

  expect(objective.id).toBe("find_resources");
  expect(objective.progress).toBe(0);
});

test("a dry stand with a Hut's worth of gold says build, not walk again", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  player.conquer(game.ref(50, 50));
  player.addGold(BigInt(game.config().hutCost() * 2));

  const objective = chooseObjective(player, game.config());

  expect(player.resources()).toBe(0);
  expect(objective.id).toBe("build_economy");
  expect(objective.progress).toBe(0.8);
});

test("primitive pipeline projects resource and farm gold flow per second", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      player.conquer(game.ref(50 + dx, 50 + dy));
    }
  }
  player.addGold(1_000_000n);
  player.addWood(500);
  player.addSlaves(100);
  player.buildUnit(UnitType.PrimitiveFarm, game.ref(50, 50), {});

  const pipeline = computePrimitiveGoldPipeline(player, game.config());

  expect(pipeline.resourceSpendPerSecond).toBeGreaterThan(0);
  expect(pipeline.resourceGoldPerSecond).toBeGreaterThan(0n);
  expect(pipeline.farmGoldPerSecond).toBeGreaterThan(0n);
  expect(pipeline.totalGoldPerSecond).toBe(
    pipeline.resourceGoldPerSecond + pipeline.farmGoldPerSecond,
  );
});

test("objective moves to conversion while resources are minting gold", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  player.conquer(game.ref(50, 50));
  player.addWood(100);
  game.addExecution(new PlayerExecution(player));
  for (let i = 0; i < 3; i++) game.executeNextTick();

  const objective = chooseObjective(player, game.config());

  expect(objective.id).toBe("convert_resources");
});

test("non-primitive gates include discounted tech and gold", async () => {
  const info = new PlayerInfo("kingdom", PlayerType.Human, null, "kingdom");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("kingdom");
  player.setAge(Age.Classical);
  player.setAgeAdvanceCredit(0.5);
  const rushed = game.config().advanceAgeCost(player)!;
  // Half the tech requirement is waived by the diffusion credit above.
  const discountedTech = Math.ceil(rushed.techPoints * 0.5);
  player.addTechPoints(discountedTech);
  player.addGold(rushed.gold);

  const gates = computeAgeGates(player, game.config());

  expect(gates.map((gate) => gate.id)).toEqual(["tech", "gold"]);
  expect(gates[0].target).toBe(discountedTech);
  expect(canAdvanceFromGates(gates)).toBe(true);
});

test("era Triumph rail exposes broad optional mastery goals", async () => {
  const info = new PlayerInfo("kingdom", PlayerType.Human, null, "kingdom");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("kingdom");
  player.setAge(Age.Classical);
  const base = game.config().baseAdvanceAgeCost(Age.Classical)!;
  player.addTechPoints(
    Math.ceil(base.techPoints * game.config().eraIngenuityTargetMult()),
  );
  player.addGold(game.config().eraProsperityTarget(Age.Classical));
  player.refreshEraTriumphs();

  const triumphs = computeEraTriumphs(player, game.config());

  expect(triumphs.map((triumph) => triumph.id)).toEqual([
    "ingenuity",
    "prosperity",
    "dominion",
    "legacy",
  ]);
  expect(
    triumphs.filter((triumph) => triumph.complete).map((t) => t.id),
  ).toEqual(["ingenuity", "prosperity"]);
});

// Regression: a FRACTIONAL resource pile (player.resources()/_resources accumulate
// float regen) made `pile * resourceGoldValue()` a non-integer that was passed
// straight to BigInt(), throwing RangeError and crashing the game. 0.8539 * 5 =
// 4.269499999999974 — the exact value from the production crash report.
test("HUD gold pipeline never throws on a fractional resource pile (BigInt RangeError regression)", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  player.conquer(game.ref(50, 50));
  player.addWood(0.8539); // sub-1 pile: resourceSpend = min(0.8539, 1)

  expect(() =>
    computePrimitiveGoldPipeline(player, game.config()),
  ).not.toThrow();
  const pipeline = computePrimitiveGoldPipeline(player, game.config());
  expect(typeof pipeline.resourceGoldPerSecond).toBe("bigint");
  expect(pipeline.resourceGoldPerSecond).toBeGreaterThanOrEqual(0n);
});

test("lockstep tick never crashes converting a fractional resource pool (BigInt RangeError regression)", async () => {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  player.conquer(game.ref(50, 50));
  player.addWood(0.8539); // 0.8539 * resourceGoldValue(5) = 4.269499999999974
  game.addExecution(new PlayerExecution(player));

  const before = player.gold();
  expect(() => {
    for (let i = 0; i < 3; i++) game.executeNextTick();
  }).not.toThrow();
  expect(typeof player.gold()).toBe("bigint");
  expect(player.gold()).toBeGreaterThanOrEqual(before);
});
