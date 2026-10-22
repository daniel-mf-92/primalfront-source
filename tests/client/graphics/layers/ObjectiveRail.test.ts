import { expect, test } from "vitest";
import {
  canAdvanceFromGates,
  chooseObjective,
  computeAgeGates,
  computeEraTriumphs,
  computePrimitiveGoldPipeline,
  primitiveStageOf,
  settlementIceWaitTicks,
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

// ---------------------------------------------------------------------------
// Goal ladder (real-screen audit 2026-10-22): the Stone Age goal follows real
// state forward only, and never sends the player to a wood stand that is not
// there.
// ---------------------------------------------------------------------------

async function freshTribe() {
  const info = new PlayerInfo("tribe", PlayerType.Human, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("tribe");
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      player.conquer(game.ref(50 + dx, 50 + dy));
    }
  }
  return { game, player };
}

test("ladder: once a Hut has stood, a dry stand never sends the goal back to 'claim the wood stand'", async () => {
  const { game, player } = await freshTribe();
  const memory = { stage: 0 };
  const config = game.config();
  player.addGold(BigInt(config.hutCost() * 2));
  expect(
    chooseObjective(player, config, undefined, undefined, 0, { memory }).id,
  ).toBe("build_economy");
  player.buildUnit(UnitType.Hut, game.ref(50, 50), {});
  expect(
    chooseObjective(player, config, undefined, undefined, 0, { memory }).id,
  ).toBe("found_city");
  // The Hut wears away, the stand is dry, the gold was spent: still the
  // settlement step, with advice to get wood again.
  for (const hut of player.units(UnitType.Hut)) hut.delete();
  player.removeGold(player.gold());
  const after = chooseObjective(player, config, undefined, undefined, 0, {
    memory,
    woodInSight: true,
  });
  expect(after.id).toBe("found_city");
  expect(after.detailKey).toBe("control_panel.objective_hint_dry_wood");
  expect(after.pointToWood).toBe(true);
  expect(after.progress).toBeLessThan(1);
});

test("ladder: with no wood stand in sight the first goal says explore, not 'claim the wood stand'", async () => {
  const { game, player } = await freshTribe();
  const goal = chooseObjective(player, game.config(), undefined, undefined, 0, {
    memory: { stage: 0 },
    woodInSight: false,
  });
  expect(goal.id).toBe("find_resources");
  expect(goal.titleKey).toBe("control_panel.objective_explore");
  expect(goal.pointToWood).toBe(false);
  const withWood = chooseObjective(
    player,
    game.config(),
    undefined,
    undefined,
    0,
    { memory: { stage: 0 }, woodInSight: true },
  );
  expect(withWood.titleKey).toBe("control_panel.objective_find_resources");
  expect(withWood.pointToWood).toBe(true);
});

test("ladder: the step index only ever rises over a scripted Stone Age run", async () => {
  const { game, player } = await freshTribe();
  const config = game.config();
  const memory = { stage: 0 };
  const seen: number[] = [];
  const look = () => {
    const goal = chooseObjective(player, config, undefined, undefined, 0, {
      memory,
      woodInSight: true,
    });
    seen.push(primitiveStageOf(goal.id));
  };
  look(); // nothing yet
  player.addWood(50);
  look(); // wood in the pile
  player.addGold(BigInt(config.hutCost()));
  look(); // can afford a Hut
  player.buildUnit(UnitType.Hut, game.ref(50, 50), {});
  look(); // Hut standing
  for (const hut of player.units(UnitType.Hut)) hut.delete();
  player.removeGold(player.gold());
  look(); // Hut gone, broke
  player.addGold(5_000_000n);
  look(); // rich
  for (let i = 1; i < seen.length; i++) {
    expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  }
  expect(seen[0]).toBe(0);
  expect(seen[seen.length - 1]).toBe(3);
});

test("ladder: a settlement the tribe can afford says build it now, never 100%", async () => {
  const { game, player } = await freshTribe();
  const config = game.config();
  const memory = { stage: 3 };
  player.addGold(50_000_000n);
  const late = config.climateMeltTicks() * 2;
  const goal = chooseObjective(player, config, undefined, undefined, late, {
    memory,
  });
  expect(goal.id).toBe("found_city");
  expect(goal.detailKey).toBe(
    "control_panel.objective_found_city_ready_detail",
  );
  expect(goal.progress).toBeLessThan(1);
  // Before the ice has receded the same gold says how long the ice has left
  // (the test config may melt instantly; then it is "build it now" too).
  const early = chooseObjective(player, config, undefined, undefined, 0, {
    memory,
  });
  expect(early.detailKey).toBe(
    settlementIceWaitTicks(config, 0) > 0
      ? "control_panel.objective_found_city_ice_detail"
      : "control_panel.objective_found_city_ready_detail",
  );
});

test("ladder: a Hut that wore away with gold in hand says rebuild it, not push out", async () => {
  const { game, player } = await freshTribe();
  const config = game.config();
  const goal = chooseObjective(player, config, undefined, undefined, 0, {
    memory: { stage: 3 },
    woodInSight: false,
  });
  expect(goal.id).toBe("found_city");
  expect(goal.detailKey).not.toBe("control_panel.objective_hint_rebuild_hut");
  player.addGold(BigInt(config.hutCost() * 2));
  const rich = chooseObjective(player, config, undefined, undefined, 0, {
    memory: { stage: 3 },
    woodInSight: false,
  });
  expect(rich.detailKey).toBe("control_panel.objective_hint_rebuild_hut");
});
