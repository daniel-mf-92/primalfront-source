import { expect, test } from "vitest";
import { AdvanceAgeExecution } from "../src/core/execution/AdvanceAgeExecution";
import { Age, PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Primal-meta (docs/PRIMAL_META.md): era advance is a GREAT WORK — a public,
// interruptible ritual. These tests drive the real AdvanceAgeExecution against
// the real sim: escrow at start, tick-by-tick progress, raid setbacks (see
// PrimalMeta.test.ts), gate-loss failure, and the Golden Age on completion.

async function settledPlayer(name: string) {
  const info = new PlayerInfo(name, PlayerType.Human, name, name);
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player(name);
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      player.conquer(game.ref(50 + dx, 50 + dy));
    }
  }
  // Neutralize the ice-age cost ramp so the City is buildable immediately.
  game.config().climateMeltTicks = () => 0;
  player.addGold(2_000_000n);
  const spot = player.canBuild(UnitType.City, game.ref(50, 50));
  expect(spot).not.toBe(false);
  player.buildUnit(UnitType.City, spot as number, {});
  expect(player.meetsAdvanceCriteria()).toBe(true);
  return { game, player };
}

test("great work: starting the ritual escrows the gold toll", async () => {
  const { game, player } = await settledPlayer("gw-escrow");
  const toll = game.config().advanceAgeCost(player)!.gold;
  const goldBefore = player.gold();

  game.addExecution(new AdvanceAgeExecution(player));
  game.executeNextTick(); // init(): startGreatWork + escrow

  const gw = player.greatWork();
  expect(gw).not.toBeNull();
  expect(gw!.targetAge).toBe(Age.Classical);
  expect(gw!.required).toBe(
    game.config().greatWorkTicks(Age.Primitive, player.eraTriumphCount()),
  );
  expect(player.gold()).toBe(goldBefore - toll); // toll locked in escrow
  expect(player.age()).toBe(Age.Primitive); // not advanced yet
});

test("great work: completes after its duration and grants the first-mover Golden Age", async () => {
  const { game, player } = await settledPlayer("gw-complete");
  const toll = game.config().advanceAgeCost(player)!.gold;
  const goldBefore = player.gold();

  game.addExecution(new AdvanceAgeExecution(player));
  const required = game
    .config()
    .greatWorkTicks(Age.Primitive, player.eraTriumphCount());
  for (let i = 0; i < required + 5 && player.age() === Age.Primitive; i++) {
    game.executeNextTick();
  }

  expect(player.age()).toBe(Age.Classical);
  expect(player.greatWork()).toBeNull();
  // Net spend is exactly the toll (escrow released into the real advance).
  expect(player.gold()).toBe(goldBefore - toll);
  // First in the world to Classical → Golden Age burst is running.
  expect(player.goldenAgeActive()).toBe(true);
  expect(game.eraReached(Age.Classical)).toBe(true);
  expect(game.worldFirstAdvanceTick()).not.toBeNull();
});

test("great work: losing the settlement gate collapses the ritual with a partial refund", async () => {
  const { game, player } = await settledPlayer("gw-collapse");
  const toll = game.config().advanceAgeCost(player)!.gold;
  const goldBefore = player.gold();

  game.addExecution(new AdvanceAgeExecution(player));
  game.executeNextTick(); // ritual open, toll escrowed
  expect(player.greatWork()).not.toBeNull();

  // Sack the settlement anchoring the work.
  const city = player.units(UnitType.City)[0];
  city.delete(false);
  game.executeNextTick(); // gate check fails → failGreatWork

  expect(player.greatWork()).toBeNull();
  expect(player.age()).toBe(Age.Primitive);
  // Half the escrow (greatWorkFailRefundBps = 5000) came back; half is sunk.
  const refund = (toll * 5000n) / 10000n;
  expect(player.gold()).toBe(goldBefore - toll + refund);
});

test("great work: direct advanceAge() stays instant (internal/test path)", async () => {
  const { player } = await settledPlayer("gw-direct");
  expect(player.advanceAge()).toBe(true);
  expect(player.age()).toBe(Age.Classical);
});

test("golden age: only the FIRST player in the world to an age gets the burst", async () => {
  const p1 = new PlayerInfo(
    "gw-first",
    PlayerType.Human,
    "gw-first",
    "gw-first",
  );
  const p2 = new PlayerInfo(
    "gw-second",
    PlayerType.Human,
    "gw-second",
    "gw-second",
  );
  const game = await setup("big_plains", { infiniteTroops: true }, [p1, p2]);
  game.config().climateMeltTicks = () => 0;
  const first = game.player("gw-first");
  const second = game.player("gw-second");
  for (const [player, cx] of [
    [first, 30],
    [second, 70],
  ] as const) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        player.conquer(game.ref(cx + dx, 50 + dy));
      }
    }
    player.addGold(2_000_000n);
    const spot = player.canBuild(UnitType.City, game.ref(cx, 50));
    expect(spot).not.toBe(false);
    player.buildUnit(UnitType.City, spot as number, {});
  }

  expect(first.advanceAge()).toBe(true);
  expect(first.goldenAgeActive()).toBe(true);
  expect(second.advanceAge()).toBe(true);
  expect(second.goldenAgeActive()).toBe(false); // late to Classical — no burst
});
