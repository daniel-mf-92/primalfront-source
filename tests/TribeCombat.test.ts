/**
 * 2026-07-07 owner direction: "attacking tribes does nothing" + "tribes don't
 * share the same carrying capacity based on terrain logic".
 *
 * Encodes the new spec so it can't silently regress:
 *  1. ONE capacity law — bot tribes and humans with the same population get
 *     the same carrying capacity and the same migration capacity.
 *  2. Attacking a tribe PAYS incrementally — captives per captured tile, not
 *     only on a full extermination.
 *  3. Capture-grace — land taken from a tribe is not shed back by the
 *     carrying-cap the same second it was won.
 *  4. The extermination gate is population-relative — a bloodied tribe is
 *     easier to wipe than a full-strength one.
 */
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

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

describe("Tribe combat & shared carrying-capacity law", () => {
  test("bot tribes and humans share ONE capacity law at equal population", async () => {
    const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human");
    const botInfo = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const game = await setup("big_plains", {}, [humanInfo, botInfo]);
    const human = game.player(humanInfo.id);
    const bot = game.player(botInfo.id);

    human.setTroops(12_000);
    bot.setTroops(12_000);

    const config = game.config();
    expect(config.carryingCapacityTiles(bot)).toEqual(
      config.carryingCapacityTiles(human),
    );
    expect(config.primitiveMigrationCapacity(bot)).toEqual(
      config.primitiveMigrationCapacity(human),
    );
    expect(config.carryingBaseTiles(bot)).toEqual(
      config.carryingBaseTiles(human),
    );
  });

  test("capturing a tribe's tiles pays captives incrementally and marks capture-grace", async () => {
    const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human");
    const botInfo = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const game = await setup(
      "big_plains",
      { infiniteTroops: true },
      [humanInfo, botInfo],
      undefined,
      UseRealAttackLogic,
    );
    const human = game.player(humanInfo.id);
    const bot = game.player(botInfo.id);

    // Adjacent blobs: the human borders the tribe's land directly.
    conquerBlock(game, human, 40, 40, 10, 10);
    conquerBlock(game, bot, 50, 40, 20, 20);
    human.setTroops(500_000);
    bot.setTroops(2_000);

    const tilesBefore = bot.numTilesOwned();
    const slavesBefore = human.slaves();
    game.addExecution(new AttackExecution(400_000, human, bot.id()));
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
    }

    const tilesTaken = tilesBefore - bot.numTilesOwned();
    expect(tilesTaken).toBeGreaterThan(0);
    // Incremental payoff arrived while the tribe still LIVES (or as it fell) —
    // at least the per-tile rate for what was taken.
    expect(human.slaves() - slavesBefore).toBeGreaterThanOrEqual(
      tilesTaken * game.config().primitiveTileCaptureSlaves() * 0.5,
    );
    // Conquered land is under capture-grace: some captured frontier tile is
    // marked with a recent capture tick.
    let graced = 0;
    for (const t of human.tilesRef()) {
      const tick = human.captureTick(t);
      if (tick !== undefined && game.ticks() - tick <= 100) graced++;
    }
    expect(graced).toBeGreaterThan(0);
  });

  test("capture-grace: conquered land is NOT shed back by the carrying-cap during grace", async () => {
    const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human");
    const game = await setup("big_plains", {}, [humanInfo]);
    const human = game.player(humanInfo.id);
    human.setTroops(600); // tiny population → low cap → over-cap blob below

    // A blob well over the (low-troops) cap, then "conquer" a fresh strip and
    // mark it captured this tick, exactly like AttackExecution does.
    conquerBlock(game, human, 40, 40, 14, 14);
    const captured: number[] = [];
    for (let y = 40; y < 54; y++) {
      const tile = game.ref(54, y);
      human.conquer(tile);
      human.markCaptureTick(tile, game.ticks());
      captured.push(tile);
    }

    game.addExecution(new PlayerExecution(human));
    // Within the grace window (100 ticks), rewild/cap shedding runs several
    // passes — the freshly captured strip must survive them all.
    for (let i = 0; i < 60; i++) {
      game.executeNextTick();
    }
    for (const tile of captured) {
      expect(game.owner(tile)).toBe(human);
    }
  });

  test("extermination gate is population-relative: bloodied tribes are easier to wipe", async () => {
    const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human");
    const botInfo = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const game = await setup("big_plains", {}, [humanInfo, botInfo]);
    const bot = game.player(botInfo.id);
    const config = game.config();

    conquerBlock(game, bot, 50, 40, 10, 10);

    // Near max strength → gate near the steep ceiling.
    bot.setTroops(config.maxTroops(bot));
    const fullGate = config.primitiveExterminationRatio(bot);
    expect(fullGate).toBeGreaterThan(3.9);

    // Bloodied/starved → the gate falls toward the 1.5 floor.
    bot.setTroops(Math.floor(config.maxTroops(bot) * 0.1));
    const starvedGate = config.primitiveExterminationRatio(bot);
    expect(starvedGate).toBeLessThan(2.0);
    expect(starvedGate).toBeGreaterThanOrEqual(1.5);

    // No defender → legacy steep constant (call-compat).
    expect(config.primitiveExterminationRatio()).toBe(4.0);
  });
});
