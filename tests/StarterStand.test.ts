import { PrimitiveMigrationExecution } from "../src/core/execution/PrimitiveMigrationExecution";
import { ResourceSeedExecution } from "../src/core/execution/ResourceSeedExecution";
import { ResourceTerritoryFlowExecution } from "../src/core/execution/ResourceTerritoryFlowExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  ensureStarterStand,
  STARTER_STAND_MAX_DIST,
  STARTER_STAND_MIN_DIST,
  STARTER_STAND_NODES,
  STARTER_STAND_SEARCH_RADIUS,
  woodNodesWithin,
} from "../src/core/execution/StarterStand";
import { PlayerInfo, PlayerType, ResourceKind } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

// The whole Primitive loop starts with a wood stand. Measured before this
// existed (World map, 2026-10-21): 83 stands for 650,000 land tiles, median 56
// tiles to the nearest, and a tribe that gathered nothing in ten minutes. A
// human spawn is now guaranteed one within a short walk.
describe("starter wood stand", () => {
  test("a human spawn always has a stand within a short walk", async () => {
    const game = await setup("world", { bots: 0 }, [], undefined, TestConfig);
    game.addExecution(new ResourceSeedExecution("starter_stand_game"));
    game.executeNextTick();
    const rand = new PseudoRandom(9);
    for (let i = 0; i < 12; i++) {
      const info = new PlayerInfo(`h${i}`, PlayerType.Human, null, `h_${i}`);
      game.addPlayer(info);
      let spawn = -1;
      while (spawn < 0) {
        const t = game.ref(
          rand.nextInt(0, game.width() - 1),
          rand.nextInt(0, game.height() - 1),
        );
        if (game.isLand(t) && !game.isBorder(t) && !game.hasOwner(t)) spawn = t;
      }
      game.addExecution(new SpawnExecution("starter_stand_game", info, spawn));
      game.executeNextTick();
      game.executeNextTick();
      expect(game.player(info.id).hasSpawned()).toBe(true);
      expect(
        woodNodesWithin(game, spawn, STARTER_STAND_SEARCH_RADIUS),
        `spawn ${i}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  test("the stand is outside the starting blob but inside sight, and only placed when needed", async () => {
    const game = await setup("world", { bots: 0 }, [], undefined, TestConfig);
    game.executeNextTick();
    // No seeding at all: the map has zero wood, so the stand must be placed.
    const center = game.ref(
      Math.floor(game.width() * 0.3),
      Math.floor(game.height() * 0.5),
    );
    expect(game.isLand(center)).toBe(true);
    const placed = ensureStarterStand(game, center, new PseudoRandom(3), 0);
    expect(placed).toHaveLength(STARTER_STAND_NODES);
    for (const tile of placed) {
      const d = Math.hypot(
        game.x(tile) - game.x(center),
        game.y(tile) - game.y(center),
      );
      expect(d).toBeGreaterThanOrEqual(STARTER_STAND_MIN_DIST - 5);
      expect(d).toBeLessThanOrEqual(STARTER_STAND_MAX_DIST + 5);
      expect(game.resourceAt(tile).kind).toBe(ResourceKind.Wood);
      expect(game.resourceAt(tile).quantity).toBeGreaterThanOrEqual(30);
    }
    // A second call finds the stand it just placed and adds nothing.
    expect(
      ensureStarterStand(game, center, new PseudoRandom(4), 0),
    ).toHaveLength(0);
  });

  test("placement is deterministic for the same seed", async () => {
    const a = await setup("world", { bots: 0 }, [], undefined, TestConfig);
    const b = await setup("world", { bots: 0 }, [], undefined, TestConfig);
    const center = a.ref(
      Math.floor(a.width() * 0.3),
      Math.floor(a.height() * 0.5),
    );
    const pa = ensureStarterStand(a, center, new PseudoRandom(77), 0);
    const pb = ensureStarterStand(b, center, new PseudoRandom(77), 0);
    expect(pa).toEqual(pb);
  });

  test("bots get no starter stand", async () => {
    const game = await setup("world", { bots: 0 }, [], undefined, TestConfig);
    game.executeNextTick();
    const info = new PlayerInfo("bot", PlayerType.Bot, null, "bot_1");
    game.addPlayer(info);
    const spawn = game.ref(
      Math.floor(game.width() * 0.3),
      Math.floor(game.height() * 0.5),
    );
    game.addExecution(new SpawnExecution("starter_stand_game", info, spawn));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.player(info.id).hasSpawned()).toBe(true);
    expect(woodNodesWithin(game, spawn, STARTER_STAND_SEARCH_RADIUS)).toBe(0);
  });

  test("a tribe on its starter stand mints gold within a minute", async () => {
    const game = await setup("world", { bots: 0 }, [], undefined, TestConfig);
    game.addExecution(new ResourceTerritoryFlowExecution());
    game.executeNextTick();
    const info = new PlayerInfo("h", PlayerType.Human, null, "h_gold");
    game.addPlayer(info);
    const spawn = game.ref(
      Math.floor(game.width() * 0.3),
      Math.floor(game.height() * 0.5),
    );
    game.addExecution(new SpawnExecution("starter_stand_game", info, spawn));
    game.executeNextTick();
    game.executeNextTick();
    const player = game.player(info.id);
    // Walk onto the stand the way a player does: one camp move toward it.
    let target = -1;
    game.forEachTile((t) => {
      if (target < 0 && game.resourceAt(t).kind === ResourceKind.Wood) {
        target = t;
      }
    });
    expect(target).toBeGreaterThanOrEqual(0);
    game.addExecution(new PrimitiveMigrationExecution(player, target));
    let hutAffordableAt = -1;
    for (let i = 1; i <= 900; i++) {
      game.executeNextTick();
      if (
        player.migrationTarget() === null &&
        game.ownerID(target) !== player.smallID()
      ) {
        game.addExecution(new PrimitiveMigrationExecution(player, target));
      }
      if (player.gold() >= BigInt(game.config().hutCost())) {
        hutAffordableAt = i;
        break;
      }
    }
    // A Hut's worth of gold inside 90 seconds of the first click.
    expect(hutAffordableAt).toBeGreaterThan(0);
    expect(hutAffordableAt).toBeLessThanOrEqual(900);
  });
});
