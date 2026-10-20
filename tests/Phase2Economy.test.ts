import { expect, test } from "vitest";
import { FarmExecution } from "../src/core/execution/FarmExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Phase 2 economy (docs/ICE_AGE_ECONOMY.md §B): Primitive Farm (slow internal gold,
// +30% over full lifetime, raid/early-destruction → loss) + Trade Outpost (cap 3,
// speeds the resource→gold conversion).

// Find an owned tile where `type` can be built (mirrors TribeExecution.tryBuild).
function buildableTile(player: any, game: any, type: UnitType): number | null {
  for (const t of player.tiles()) {
    const spawn = player.canBuild(type, t);
    if (spawn !== false) return spawn as number;
  }
  return null;
}

test("Primitive Farm config nets ~+30% over a full lifespan, break-even well before end", () => {
  return setup("big_plains", {}, []).then((game) => {
    const c = game.config();
    const total =
      c.primitiveFarmGoldPerTick() * BigInt(c.primitiveFarmLifespanTicks());
    // Full-lifespan payout is at least 130% of the build cost.
    expect(total).toBeGreaterThanOrEqual(
      (BigInt(c.primitiveFarmCost()) * 130n) / 100n,
    );
    // Break-even (cost / perTick) lands well before the lifespan ends — so a farm
    // destroyed early (raided/conquered) has paid out less than it cost = a loss.
    const breakEven = Number(
      BigInt(c.primitiveFarmCost()) / c.primitiveFarmGoldPerTick(),
    );
    expect(breakEven).toBeLessThan(c.primitiveFarmLifespanTicks());
  });
});

test("Primitive Farm drips internal gold to its owner each tick", async () => {
  const bot = new PlayerInfo("farmer", PlayerType.Bot, null, "farmer");
  const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
  const player = game.player("farmer");
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) player.conquer(game.ref(50 + dx, 50 + dy));
  }
  player.addGold(200_000n);
  const spawn = buildableTile(player, game, UnitType.PrimitiveFarm);
  expect(spawn).not.toBeNull();
  const farm = player.buildUnit(UnitType.PrimitiveFarm, spawn as number, {});
  game.addExecution(new FarmExecution(farm));

  const afterBuild = player.gold();
  for (let i = 0; i < 50; i++) game.executeNextTick();
  const minted = player.gold() - afterBuild;
  const perTick = game.config().primitiveFarmGoldPerTick();
  expect(minted).toBeGreaterThan(0n); // it pays out
  expect(minted).toBeGreaterThanOrEqual(perTick * 40n); // ~50 ticks of drip (tolerance)
});

test("Trade Outpost is hard-capped at 3 per tribe", async () => {
  const bot = new PlayerInfo("trader", PlayerType.Bot, null, "trader");
  const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
  const player = game.player("trader");
  for (let dx = -6; dx <= 6; dx++) {
    for (let dy = -6; dy <= 6; dy++) player.conquer(game.ref(50 + dx, 50 + dy));
  }
  player.addGold(1_000_000n);
  const cap = game.config().tradeOutpostMaxCount();
  // Sanity: below the cap an outpost IS buildable.
  expect(player.canBuild(UnitType.TradeOutpost, game.ref(50, 50))).not.toBe(
    false,
  );
  // Reach the cap by building directly.
  const owned = Array.from(player.tiles());
  for (let i = 0; i < cap; i++) {
    player.buildUnit(UnitType.TradeOutpost, owned[i * 7], {});
  }
  expect(player.unitsOwned(UnitType.TradeOutpost)).toBe(cap);
  // At the cap, canBuild refuses a 4th anywhere (the chokepoint cap in
  // canBuildUnitType). This is what stops a tribe ever exceeding 3.
  expect(player.canBuild(UnitType.TradeOutpost, game.ref(50, 50))).toBe(false);
});

test("Trade Outposts speed the resource→gold internal economy", async () => {
  const setupPlayer = async (id: string, outposts: number) => {
    const bot = new PlayerInfo(id, PlayerType.Bot, null, id);
    const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
    const player = game.player(id);
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -6; dy <= 6; dy++) {
        player.conquer(game.ref(50 + dx, 50 + dy));
      }
    }
    player.addGold(1_000_000n);
    for (let i = 0; i < outposts; i++) {
      const spawn = buildableTile(player, game, UnitType.TradeOutpost);
      player.buildUnit(UnitType.TradeOutpost, spawn as number, {});
    }
    player.addWood(500);
    const before = player.gold();
    game.addExecution(new PlayerExecution(player));
    for (let i = 0; i < 8; i++) game.executeNextTick();
    return player.gold() - before;
  };

  const none = await setupPlayer("noout", 0);
  const three = await setupPlayer("threeout", 3);
  // With 3 outposts the wood→gold conversion yields strictly more gold.
  expect(three).toBeGreaterThan(none);
});
