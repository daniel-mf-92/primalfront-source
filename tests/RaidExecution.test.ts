import { expect, test } from "vitest";
import { RaidExecution } from "../src/core/execution/RaidExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { setup } from "./util/Setup";

// Build a 2-player game with the attacker/defender given tiles, gold and troops.
// Returns the live game + both players. Deterministic: same args ⇒ same world.
async function raidWorld(opts: {
  attackerGold?: bigint;
  defenderGold?: bigint;
  attackerTroops?: number;
  defenderTroops?: number;
  defenderIsPack?: boolean;
}): Promise<{ game: Game; attacker: Player; defender: Player }> {
  const aInfo = new PlayerInfo("att", PlayerType.Human, "att_c", "att");
  const dInfo = new PlayerInfo("def", PlayerType.Human, "def_c", "def");
  if (opts.defenderIsPack) {
    dInfo.setIsAnimalPack(true);
  }
  const game = await setup("plains", { infiniteTroops: false }, [aInfo, dInfo]);
  const attacker = game.player("att");
  const defender = game.player("def");

  // Give each a small, disjoint owned blob so power() has tiles to count.
  for (let x = 5; x < 10; x++) attacker.conquer(game.ref(x, 5));
  for (let x = 40; x < 45; x++) defender.conquer(game.ref(x, 40));

  if (opts.attackerGold !== undefined) attacker.addGold(opts.attackerGold);
  if (opts.defenderGold !== undefined) defender.addGold(opts.defenderGold);
  if (opts.attackerTroops !== undefined)
    attacker.setTroops(opts.attackerTroops);
  if (opts.defenderTroops !== undefined)
    defender.setTroops(opts.defenderTroops);
  // The pack flag is set on dInfo above; PlayerImpl reads it at construction, so
  // `defender.isAnimalPack()` is already true here — no setter call needed.

  return { game, attacker, defender };
}

test("RaidExecution: deterministic — identical worlds yield identical outcomes", async () => {
  const run = async () => {
    const { game, attacker, defender } = await raidWorld({
      attackerGold: 1000n,
      defenderGold: 10_000n,
      attackerTroops: 5000,
      defenderTroops: 1000,
    });
    game.addExecution(new RaidExecution(attacker, defender.id()));
    game.executeNextTick();
    return {
      attGold: attacker.gold(),
      defGold: defender.gold(),
      attTroops: attacker.troops(),
      defTroops: defender.troops(),
    };
  };
  const a = await run();
  const b = await run();
  // Same replicated state (tick + smallIDs) ⇒ byte-identical resolution.
  expect(a).toEqual(b);
});

test("RaidExecution: never captures a tile (no land transfer either way)", async () => {
  const { game, attacker, defender } = await raidWorld({
    attackerGold: 1000n,
    defenderGold: 10_000n,
    attackerTroops: 9999,
    defenderTroops: 1,
  });
  const attTilesBefore = attacker.numTilesOwned();
  const defTilesBefore = defender.numTilesOwned();
  game.addExecution(new RaidExecution(attacker, defender.id()));
  game.executeNextTick();
  // Raid extracts wealth only — tile counts on BOTH sides are unchanged.
  expect(attacker.numTilesOwned()).toBe(attTilesBefore);
  expect(defender.numTilesOwned()).toBe(defTilesBefore);
  // Defender is never conquered/eliminated by a raid.
  expect(defender.isAlive()).toBe(true);
});

test("RaidExecution: a successful raid conserves gold (attacker gain == defender loss)", async () => {
  // Overwhelming attacker → success probability clamps to the max (0.9); over
  // repeated independent worlds at least one resolves to success, and whenever
  // gold moves the transfer is exactly conserved (integer basis points).
  let sawSuccess = false;
  for (let seed = 0; seed < 8; seed++) {
    const { game, attacker, defender } = await raidWorld({
      attackerGold: 0n,
      defenderGold: 10_000n + BigInt(seed), // vary state to vary the roll
      attackerTroops: 100_000,
      defenderTroops: 1,
    });
    const attGoldBefore = attacker.gold();
    const defGoldBefore = defender.gold();
    game.addExecution(new RaidExecution(attacker, defender.id()));
    game.executeNextTick();
    const attGain = attacker.gold() - attGoldBefore;
    const defLoss = defGoldBefore - defender.gold();
    // Conservation invariant holds on every run (gain == loss, ≥ 0).
    expect(attGain).toBe(defLoss);
    expect(attGain >= 0n).toBe(true);
    if (attGain > 0n) {
      sawSuccess = true;
      // On success exactly raidLootFraction (25%) of the defender's gold moves.
      const expectedLoot =
        (defGoldBefore *
          BigInt(Math.round(game.config().raidLootFraction() * 10000))) /
        10000n;
      expect(attGain).toBe(expectedLoot);
    }
  }
  expect(sawSuccess).toBe(true);
});

test("RaidExecution: raiding an animal pack grants MEAT, never gold-only", async () => {
  // Force a high-probability success against a pack and confirm meat accrues on
  // the (frequent) successful runs; meat is granted to the raider's pile.
  let sawMeat = false;
  for (let seed = 0; seed < 8; seed++) {
    const { game, attacker, defender } = await raidWorld({
      attackerGold: 0n,
      defenderGold: 5_000n + BigInt(seed),
      attackerTroops: 100_000,
      defenderTroops: 1,
      defenderIsPack: true,
    });
    const meatBefore = attacker.meat();
    game.addExecution(new RaidExecution(attacker, defender.id()));
    game.executeNextTick();
    if (attacker.meat() > meatBefore) {
      sawMeat = true;
      expect(attacker.gold()).toBeGreaterThanOrEqual(0n);
    }
  }
  expect(sawMeat).toBe(true);
});

test("RaidExecution: cannot raid self (no-op)", async () => {
  const { game, attacker } = await raidWorld({
    attackerGold: 5_000n,
    defenderGold: 5_000n,
  });
  const goldBefore = attacker.gold();
  game.addExecution(new RaidExecution(attacker, attacker.id()));
  game.executeNextTick();
  expect(attacker.gold()).toBe(goldBefore);
});

test("RaidExecution: both sides are told, and the victim hears how much gold left", async () => {
  const { game, attacker, defender } = await raidWorld({
    attackerGold: 1000n,
    defenderGold: 10_000n,
    attackerTroops: 50_000,
    defenderTroops: 100,
  });
  game.addExecution(new RaidExecution(attacker, defender.id()));
  const updates = game.executeNextTick();
  const events = updates[GameUpdateType.DisplayEvent] ?? [];
  const toDefender = events.filter((e) => e.playerID === defender.smallID());
  const toAttacker = events.filter((e) => e.playerID === attacker.smallID());
  // Whichever way the roll went, each side got exactly one line about it.
  expect(
    toDefender.filter((e) =>
      /^events_display\.raid(ed_by|_repelled)$/.test(e.message),
    ),
  ).toHaveLength(1);
  expect(
    toAttacker.filter((e) =>
      /^events_display\.raid_(success|failed)$/.test(e.message),
    ),
  ).toHaveLength(1);
  const raided = toDefender.find(
    (e) => e.message === "events_display.raided_by",
  );
  if (raided !== undefined) {
    // The gold on the message is the gold that actually left the victim.
    expect(raided.goldAmount).toBe(10_000n - defender.gold());
    expect(raided.goldAmount).toBeGreaterThan(0n);
    expect(raided.params?.name).toBe(attacker.displayName());
    expect(raided.focusPlayerID).toBe(attacker.smallID());
  }
});
