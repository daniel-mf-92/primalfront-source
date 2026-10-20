/**
 * 2026-08-03 — the auto-split rule is packs-only, and that is load-bearing.
 *
 * TribeSplitExecution's own header says "ONLY Primitive packs auto-split", but
 * the trigger in PlayerExecution only checked type()===Bot && age()===Primitive.
 * Every primitive bot therefore fissioned at tribeAutoSplitTiles (220), so no
 * tribe could ever grow enough to bank its first age advance. Measured on the
 * world map with the stock 133-bot config: 3,646 tribes alive and the map leader
 * pinned at 0.2% of the land for eleven straight minutes.
 *
 * These tests encode the restored rule so it cannot silently regress again.
 */
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TribeSplitExecution } from "../src/core/execution/TribeSplitExecution";
import {
  Execution,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

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

function splitExecutionsFor(game: Game): TribeSplitExecution[] {
  // executions() lives on GameImpl, not the Game interface the harness returns.
  const all = (game as unknown as { executions(): Execution[] }).executions();
  return all.filter(
    (e): e is TribeSplitExecution => e instanceof TribeSplitExecution,
  );
}

/** Run the owner's PlayerExecution long enough to pass the split-check cadence. */
function runSplitChecks(game: Game, exec: PlayerExecution, ticks: number) {
  exec.init(game, 0);
  for (let t = 0; t < ticks; t++) {
    exec.tick(t);
  }
}

describe("Primitive auto-split is packs-only", () => {
  test("an ordinary primitive bot over the threshold does NOT split", async () => {
    const info = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe");
    const game = await setup("big_plains", {}, [info]);
    const bot = game.player(info.id);

    const threshold = game.config().tribeAutoSplitTiles();
    conquerBlock(game, bot, 1, 1, 30, 30); // 900 tiles, well past the threshold
    expect(bot.numTilesOwned()).toBeGreaterThan(threshold);
    expect(bot.isAnimalPack()).toBe(false);

    runSplitChecks(game, new PlayerExecution(bot), 400);

    // A tribe that can be carved in half at 220 tiles can never bank the gold
    // for an age advance, which is what froze the whole world in the Primitive era.
    expect(splitExecutionsFor(game)).toHaveLength(0);
  });

  test("an animal pack over the threshold still divides", async () => {
    const info = new PlayerInfo("pack", PlayerType.Bot, null, "pack");
    info.setIsAnimalPack(true);
    const game = await setup("big_plains", {}, [info]);
    const pack = game.player(info.id);

    conquerBlock(game, pack, 1, 1, 30, 30);
    expect(pack.isAnimalPack()).toBe(true);
    expect(pack.numTilesOwned()).toBeGreaterThan(
      game.config().tribeAutoSplitTiles(),
    );

    runSplitChecks(game, new PlayerExecution(pack), 400);

    expect(splitExecutionsFor(game).length).toBeGreaterThan(0);
  });

  test("a pack under the threshold is left alone", async () => {
    const info = new PlayerInfo("small", PlayerType.Bot, null, "small");
    info.setIsAnimalPack(true);
    const game = await setup("big_plains", {}, [info]);
    const pack = game.player(info.id);

    conquerBlock(game, pack, 1, 1, 5, 5); // 25 tiles
    expect(pack.numTilesOwned()).toBeLessThan(
      game.config().tribeAutoSplitTiles(),
    );

    runSplitChecks(game, new PlayerExecution(pack), 400);

    expect(splitExecutionsFor(game)).toHaveLength(0);
  });

  test("a human is never carved up, pack flag or not", async () => {
    const info = new PlayerInfo("human", PlayerType.Human, null, "human");
    const game = await setup("big_plains", {}, [info]);
    const human = game.player(info.id);

    conquerBlock(game, human, 1, 1, 30, 30);
    expect(human.numTilesOwned()).toBeGreaterThan(
      game.config().tribeAutoSplitTiles(),
    );

    runSplitChecks(game, new PlayerExecution(human), 400);

    expect(splitExecutionsFor(game)).toHaveLength(0);
  });
});
