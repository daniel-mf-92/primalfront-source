/**
 * Nomadic attrition gradient (owner direction, Marta 2026-10-21):
 *
 *   "OpenFront-style logic, but in early eras nomadic logic which descends as
 *    eras advance and carrying capacity advances, until the modern era: land
 *    held indefinitely, no attrition, just like OpenFront."
 *
 * So expansion is a real attack in every age (the camp-migration mechanic is
 * retired), and what changes per age is how much land can be KEPT: capacity
 * climbs, the held radius widens, the shed slows, and from Modern on nothing
 * is shed at all. The earlier owner direction of 2026-08-03 (Classical holds
 * 3x a primitive band and does not fill the map) is the second step of that
 * ladder and is kept.
 */
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  Age,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

const AGES = [
  Age.Primitive,
  Age.Classical,
  Age.Imperial,
  Age.Feudal,
  Age.Enlightened,
  Age.Industrial,
  Age.Modern,
  Age.Alien,
];

describe("nomadic attrition gradient", () => {
  test("land sheds in every age before Modern and never after", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("p", PlayerType.Human, null, "p"),
    ]);
    const config = game.config();
    for (const age of AGES) {
      expect(config.rewildEnabled(age), `age ${age}`).toBe(age < Age.Modern);
    }
  });

  test("capacity climbs, the held radius widens and the shed slows with every age", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("p", PlayerType.Human, null, "p"),
    ]);
    const config = game.config();
    for (let i = 1; i < AGES.length; i++) {
      const prev = AGES[i - 1];
      const age = AGES[i];
      expect(config.landCapacityMult(age)).toBeGreaterThanOrEqual(
        config.landCapacityMult(prev),
      );
      expect(config.supportRadiusMult(age)).toBeGreaterThanOrEqual(
        config.supportRadiusMult(prev),
      );
      expect(config.rewildBudgetMult(age)).toBeLessThanOrEqual(
        config.rewildBudgetMult(prev),
      );
    }
    expect(config.landCapacityMult(Age.Primitive)).toBe(1);
    expect(config.landCapacityMult(Age.Classical)).toBe(3);
    expect(config.landCapacityMult(Age.Modern)).toBe(Number.POSITIVE_INFINITY);
    expect(config.rewildBudgetMult(Age.Modern)).toBe(0);
  });

  test("a Classical band still holds exactly 3x the ground of a primitive one", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", {}, [info]);
    const player = game.player(info.id);
    const config = game.config();
    player.setTroops(20_000);
    player.setAge(Age.Primitive);
    const primitive = config.primitiveMigrationCapacity(player);
    player.setAge(Age.Classical);
    const classical = config.primitiveMigrationCapacity(player);
    expect(Number.isFinite(primitive)).toBe(true);
    expect(classical).toBe(primitive * 3);
  });
});

function conquerBlock(
  game: Game,
  player: Player,
  startX: number,
  startY: number,
  width: number,
  height: number,
) {
  for (let y = startY; y < startY + height; y++) {
    for (let x = startX; x < startX + width; x++) {
      player.conquer(game.ref(x, y));
    }
  }
}

function centroidX(game: Game, player: Player): number {
  let sum = 0;
  let n = 0;
  for (const t of player.tiles()) {
    sum += game.x(t);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

async function walk(focusX: number, ticks: number) {
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");
  const game = await setup(
    "big_plains",
    { infiniteGold: true, instantBuild: true },
    [info],
    undefined,
    UseRealAttackLogic,
  );
  const player = game.player(info.id);
  conquerBlock(game, player, 60, 60, 10, 5);
  player.setTroops(20_000);
  const before = centroidX(game, player);
  // The land-shedding pass lives in PlayerExecution (added on spawn in a real
  // game); without it the tribe only ever grows.
  game.addExecution(new PlayerExecution(player));
  game.addExecution(
    new AttackExecution(
      4000,
      player,
      game.terraNullius().id(),
      null,
      true,
      game.ref(focusX, 62),
    ),
  );
  for (let i = 0; i < ticks; i++) {
    game.executeNextTick();
  }
  return { game, player, before, after: centroidX(game, player) };
}

describe("a Stone Age tribe walks where you point", () => {
  test("the front grows toward the clicked tile", async () => {
    const east = await walk(110, 200);
    expect(east.after).toBeGreaterThan(east.before + 3);
    const west = await walk(10, 200);
    expect(west.after).toBeLessThan(west.before - 3);
  });

  test("the land behind the camp goes wild instead of piling up", async () => {
    const { game, player } = await walk(110, 600);
    const radius = game.config().nomadCampSupportRadius();
    let minX = Infinity;
    let maxX = -Infinity;
    for (const t of player.tiles()) {
      minX = Math.min(minX, game.x(t));
      maxX = Math.max(maxX, game.x(t));
    }
    const cx = centroidX(game, player);
    // Started at x 60..69 and walked east: the tail is shed back to within the
    // camp's support radius (plus the capture grace slack), the front is not.
    expect(cx - minX).toBeLessThanOrEqual(radius + 4);
    expect(maxX).toBeGreaterThan(69);
  });
});

describe("the Stone Age exit gate", () => {
  test("no Permanent Settlement until the ice has mostly receded", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", { infiniteGold: true }, [info]);
    const player = game.player(info.id);
    for (let y = 60; y < 70; y++)
      for (let x = 60; x < 70; x++) player.conquer(game.ref(x, y));
    // Real gate value, not the test config's lifted one.
    (
      game.config() as unknown as { settlementMaxIceFraction: () => number }
    ).settlementMaxIceFraction = () => 0.1;
    const tile = game.ref(65, 65);
    expect(player.canBuild(UnitType.City, tile)).toBe(false);
    const melt = game.config().climateMeltTicks();
    while (game.ticks() < melt * 0.9 + 1) game.executeNextTick();
    expect(player.canBuild(UnitType.City, tile)).not.toBe(false);
  });
});
