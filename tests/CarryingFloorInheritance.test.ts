/**
 * The carrying-capacity law is deliberately kept (owner direction 2026-08-03:
 * "carrying capacity logic important in primitive era"). What changes is that
 * its subsistence floor is INHERITED on conquest instead of evaporating.
 *
 * Why it matters, measured: world capacity is `carryingBaseTiles x tribes +
 * troops / carryingPopPerTile`. The floor is granted per tribe, so absorbing a
 * tribe used to delete 90 tiles of world capacity — the winner then shed the
 * land it had just taken, conquest was net-negative, and land claimed fell from
 * 66.8% to 38.7% across a match as 2,885 tribes died (LoopVitals).
 */
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

async function twoTribes(): Promise<[Game, Player, Player]> {
  const aInfo = new PlayerInfo("a", PlayerType.Bot, null, "a");
  const bInfo = new PlayerInfo("b", PlayerType.Bot, null, "b");
  const game = await setup("big_plains", {}, [aInfo, bInfo]);
  return [game, game.player(aInfo.id), game.player(bInfo.id)];
}

describe("carrying-capacity floor is inherited, not destroyed", () => {
  test("a fresh tribe still gets exactly one subsistence floor", async () => {
    const [game, a] = await twoTribes();
    expect(a.absorbedTribes()).toBe(0);
    expect(game.config().carryingBaseTiles(a)).toBe(90);
  });

  test("the law keeps its shape: base plus population", async () => {
    const [game, a] = await twoTribes();
    a.setTroops(15_000);
    const config = game.config();
    expect(config.populationCarryingCapacityTiles(a)).toBe(
      config.carryingBaseTiles(a) +
        Math.floor(15_000 / config.carryingPopPerTile()),
    );
  });

  test("absorbing a tribe carries its floor across", async () => {
    const [game, a, b] = await twoTribes();
    game.conquerPlayer(a, b);
    expect(a.absorbedTribes()).toBe(1);
    expect(game.config().carryingBaseTiles(a)).toBe(180);
  });

  test("a chain of conquests conserves world capacity", async () => {
    const [game, a, b] = await twoTribes();
    // b had already swallowed two tribes before a swallowed b.
    b.absorbTribes(2);
    game.conquerPlayer(a, b);
    // 1 (b itself) + 2 (what b held) = 3 inherited, plus a's own floor.
    expect(a.absorbedTribes()).toBe(3);
    expect(game.config().carryingBaseTiles(a)).toBe(360);
  });

  test("conquest is no longer net-negative on capacity", async () => {
    const [game, a, b] = await twoTribes();
    const config = game.config();
    a.setTroops(10_000);
    b.setTroops(10_000);
    const before =
      config.populationCarryingCapacityTiles(a) +
      config.populationCarryingCapacityTiles(b);

    game.conquerPlayer(a, b);
    a.addTroops(10_000); // the absorbed population

    // The winner can hold at least what the two tribes held between them;
    // previously this lost a whole 90-tile floor and the land was shed back.
    expect(config.populationCarryingCapacityTiles(a)).toBeGreaterThanOrEqual(
      before,
    );
  });
});
