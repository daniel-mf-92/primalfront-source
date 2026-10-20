import { expect, test } from "vitest";
import { AdvanceAgeExecution } from "../src/core/execution/AdvanceAgeExecution";
import { RaidExecution } from "../src/core/execution/RaidExecution";
import {
  Age,
  Game,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Primal-meta (docs/PRIMAL_META.md): the primitive power CURVE (twilight of
// the wild), WORLD PRESSURE after the first advance, and the primitive raid
// toys (tech loot, unrest, Great Work sabotage).

// The curve/pressure knobs are pure functions of replicated state, so they can
// be exercised against a minimal fake game — no sim needed.
function fakeGame(ticks: number, firstAdvanceTick: number | null): Game {
  return {
    ticks: () => ticks,
    worldFirstAdvanceTick: () => firstAdvanceTick,
  } as unknown as Game;
}

test("twilight of the wild: full yield through the ice age, decaying to the floor after the melt", async () => {
  const p1 = new PlayerInfo("pm-cfg", PlayerType.Human, "pm-cfg", "pm-cfg");
  const game = await setup("plains", {}, [p1]);
  const config = game.config();
  const melt = config.climateMeltTicks();
  const span = config.primitiveTwilightTicks();
  const floor = config.primitiveTwilightFloor();

  expect(config.primitiveTwilightMult(fakeGame(0, null))).toBe(1);
  expect(config.primitiveTwilightMult(fakeGame(melt, null))).toBe(1);
  const mid = config.primitiveTwilightMult(fakeGame(melt + span / 2, null));
  expect(mid).toBeLessThan(1);
  expect(mid).toBeGreaterThan(floor);
  expect(config.primitiveTwilightMult(fakeGame(melt + span, null))).toBeCloseTo(
    floor,
    6,
  );
  // Monotone decay — waiting never gets BETTER again.
  let prev = 1;
  for (let t = melt; t <= melt + span; t += 500) {
    const v = config.primitiveTwilightMult(fakeGame(t, null));
    expect(v).toBeLessThanOrEqual(prev);
    prev = v;
  }
});

test("world pressure: 1.0 while the world is wild, ramping once civilization exists", async () => {
  const p1 = new PlayerInfo("pm-cfg2", PlayerType.Human, "pm-cfg2", "pm-cfg2");
  const game = await setup("plains", {}, [p1]);
  const config = game.config();
  const ramp = config.worldPressureRampTicks();
  const max = config.worldPressureMaxMult();

  expect(config.worldPressureMult(fakeGame(5000, null))).toBe(1);
  expect(config.worldPressureMult(fakeGame(1000, 1000))).toBe(1);
  const mid = config.worldPressureMult(fakeGame(1000 + ramp / 2, 1000));
  expect(mid).toBeGreaterThan(1);
  expect(mid).toBeLessThan(max);
  expect(config.worldPressureMult(fakeGame(1000 + ramp, 1000))).toBeCloseTo(
    max,
    6,
  );
});

// Real-sim raid harness: attacker massively out-powers the defender, so the
// deterministic success roll lands within a few attempts; we retry across
// ticks until the first SUCCESS (visible as stolen gold), then assert the
// primal-meta side effects of that success.
async function raidWorld() {
  const att = new PlayerInfo("pm-att", PlayerType.Human, "pm-att", "pm-att");
  const def = new PlayerInfo("pm-def", PlayerType.Human, "pm-def", "pm-def");
  const game = await setup("big_plains", { infiniteTroops: true }, [att, def]);
  const attacker = game.player("pm-att");
  const defender = game.player("pm-def");
  for (let dx = -6; dx <= 6; dx++) {
    for (let dy = -6; dy <= 6; dy++) {
      attacker.conquer(game.ref(30 + dx, 50 + dy));
    }
  }
  defender.conquer(game.ref(80, 50));
  attacker.addTroops(100_000);
  return { game, attacker, defender };
}

test("primitive raid on a civilized victim loots tech and spreads unrest", async () => {
  const { game, attacker, defender } = await raidWorld();
  defender.setAge(Age.Imperial);
  defender.addGold(100_000n);
  defender.addTechPoints(1_000);
  expect(attacker.age()).toBe(Age.Primitive);

  const debtBefore = defender.integrationDebt();
  for (let i = 0; i < 60 && attacker.techPoints() === 0; i++) {
    game.addExecution(new RaidExecution(attacker, defender.id()));
    game.executeNextTick();
  }

  // The first successful raid moved tech AND injected unrest.
  expect(attacker.techPoints()).toBeGreaterThan(0);
  expect(defender.techPoints()).toBeLessThan(1_000);
  expect(defender.integrationDebt()).toBeGreaterThan(debtBefore);
});

test("a successful raid sets back the victim's Great Work", async () => {
  const { game, attacker, defender } = await raidWorld();
  game.config().climateMeltTicks = () => 0;
  defender.addGold(2_000_000n);
  const spot = defender.canBuild(UnitType.City, game.ref(80, 50));
  expect(spot).not.toBe(false);
  defender.buildUnit(UnitType.City, spot as number, {});
  game.addExecution(new AdvanceAgeExecution(defender));
  game.executeNextTick(); // ritual opens
  expect(defender.greatWork()).not.toBeNull();
  // Pre-load progress well past one setback so the knock-back isn't hidden by
  // the clamp-at-zero (a raid landing at progress ~5 only shows a 5-tick drop).
  defender.setGreatWorkProgress(200);

  const setback = game.config().greatWorkRaidSetbackTicks();
  let raided = false;
  for (let i = 0; i < 60 && !raided; i++) {
    const before = defender.greatWork();
    if (before === null) break; // completed — should not happen in 60 ticks
    const progressBefore = before.progress;
    game.addExecution(new RaidExecution(attacker, defender.id()));
    game.executeNextTick();
    const after = defender.greatWork();
    // Ritual gains 1/tick; a successful raid knocks it back `setback` ticks,
    // so a net drop from the pre-tick reading proves the sabotage landed.
    if (after !== null && after.progress < progressBefore) {
      raided = true;
      expect(progressBefore - after.progress).toBeGreaterThanOrEqual(
        setback - 2,
      );
    }
  }
  expect(raided).toBe(true);
});
