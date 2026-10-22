import { describe, expect, it } from "vitest";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Playtest 2026-10-22: Huts lasted 2 minutes, so land kept reverting while
// 17-36K gold sat unspent. A Hut now lasts 3 minutes, and placing a Hut on
// one of your standing Huts (or "Renew" on the wear banner) restarts its full
// lifespan for a fraction of a new Hut's price.
async function tribeWithHut() {
  const game = await setup("plains", { instantBuild: true });
  const player = game.addPlayer(
    new PlayerInfo("r", PlayerType.Human, null, "r"),
  );
  game.addExecution(
    new SpawnExecution("renew", player.info(), game.ref(50, 50)),
  );
  executeTicks(game, 2);
  for (let x = 15; x <= 85; x++) {
    for (let y = 40; y <= 60; y++) player.conquer(game.ref(x, y));
  }
  player.addGold(1_000_000n);
  game.addExecution(
    new ConstructionExecution(player, UnitType.Hut, game.ref(50, 50)),
  );
  executeTicks(game, 4);
  const hut = player.units(UnitType.Hut)[0];
  expect(hut).toBeDefined();
  return { game, player, hut };
}

describe("Hut lifespan and renewal", () => {
  it("a Hut stands 3 minutes", async () => {
    const { game } = await tribeWithHut();
    expect(game.config().hutLifespanTicks()).toBe(1800);
  });

  it("a Hut ghost on my standing Hut offers a cheap renewal, not a refusal", async () => {
    const { game, player, hut } = await tribeWithHut();
    const [bu] = player.buildableUnits(game.ref(52, 51), [UnitType.Hut]);
    expect(bu.canUpgrade).toBe(hut.id());
    expect(bu.canBuild).toBe(false);
    const full = game.unitInfo(UnitType.Hut).cost(game, player);
    expect(bu.cost).toBe(player.hutRenewCost());
    expect(bu.cost).toBeLessThan(full);
    expect(bu.cost).toBeGreaterThan(0n);
    // Far from any Hut it is an ordinary new Hut at full price.
    const [far] = player.buildableUnits(game.ref(20, 50), [UnitType.Hut]);
    expect(far.canUpgrade).toBe(false);
    expect(far.cost).toBe(full);
  });

  it("renewing restarts the full lifespan and charges the renewal price", async () => {
    const { game, player, hut } = await tribeWithHut();
    const life = game.config().hutLifespanTicks();
    executeTicks(game, life - 100); // close to wearing away
    expect(hut.isActive()).toBe(true);
    const gold = player.gold();
    const price = player.hutRenewCost();
    game.addExecution(new UpgradeStructureExecution(player, hut.id()));
    executeTicks(game, 2);
    expect(hut.renewedAt()).not.toBeNull();
    expect(player.gold()).toBeLessThanOrEqual(gold - price);
    expect(hut.level()).toBe(1); // renewal is not an upgrade
    // Past the original end of life: still standing.
    executeTicks(game, 300);
    expect(hut.isActive()).toBe(true);
    // A full lifespan after the renewal it wears away.
    executeTicks(game, life);
    expect(hut.isActive()).toBe(false);
  });

  it("cannot renew without the gold, or someone else's Hut", async () => {
    const { game, player, hut } = await tribeWithHut();
    player.removeGold(player.gold());
    expect(player.canRenewHut(hut)).toBe(false);
    const [bu] = player.buildableUnits(game.ref(52, 51), [UnitType.Hut]);
    expect(bu.canUpgrade).toBe(false);
    const other = game.addPlayer(
      new PlayerInfo("o", PlayerType.Human, null, "o"),
    );
    other.addGold(1_000_000n);
    expect(other.canRenewHut(hut)).toBe(false);
  });
});
