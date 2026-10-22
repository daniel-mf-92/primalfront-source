import { expect, test } from "vitest";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  Age,
  eraTitle,
  PlayerInfo,
  PlayerType,
  polityName,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// --- Renumber invariant -----------------------------------------------------
// advanceAge() does `_age++`, so the Age enum ORDER must be the progression
// order. Classical was inserted between Primitive and Imperial; if anyone
// re-appends it (or forgets to renumber) these break.
test("Classical sits between Primitive and Imperial in progression order", () => {
  expect(Age.Primitive).toBe(0);
  expect(Age.Classical).toBe(1);
  expect(Age.Imperial).toBe(2);
  // The +1 progression (advanceAge) walks Primitive → Classical → Imperial.
  expect(Age.Primitive + 1).toBe(Age.Classical);
  expect(Age.Classical + 1).toBe(Age.Imperial);
});

test("advance-cost table defines the Primitive→Classical→Imperial rungs", async () => {
  const p1 = new PlayerInfo("alice", PlayerType.Human, "alice", "alice");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const player = game.player("alice");
  const config = game.config();

  player.setAge(Age.Primitive);
  expect(config.advanceAgeCost(player)).not.toBeNull(); // → Classical
  player.setAge(Age.Classical);
  expect(config.advanceAgeCost(player)).not.toBeNull(); // → Imperial
  player.setAge(Age.Alien);
  expect(config.advanceAgeCost(player)).toBeNull(); // no era past Alien
});

// --- Era-scaled polity titles ----------------------------------------------
test("eraTitle maps each era to its polity prefix", () => {
  expect(eraTitle(Age.Primitive)).toBe("Tribe of");
  expect(eraTitle(Age.Classical)).toBe("Kingdom of");
  expect(eraTitle(Age.Imperial)).toBe("Empire of");
});

test("a Stone Age group name is not prefixed twice", () => {
  expect(polityName(Age.Primitive, "Flint Tribe")).toBe("Flint Tribe");
  expect(polityName(Age.Primitive, "Reed Band")).toBe("Reed Band");
  expect(polityName(Age.Primitive, "Shanidar Neanderthals")).toBe(
    "Shanidar Neanderthals",
  );
  expect(polityName(Age.Primitive, "Finland")).toBe("Tribe of Finland");
  expect(polityName(Age.Classical, "Flint Tribe")).toBe(
    "Kingdom of Flint Tribe",
  );
});

test("displayName gains an era title for civilized players, not animal packs", async () => {
  const human = new PlayerInfo("Daniel", PlayerType.Human, "daniel", "daniel");
  const packInfo = new PlayerInfo("Wolves", PlayerType.Bot, null, "wolves");
  packInfo.setIsAnimalPack(true);
  const game = await setup("plains", { infiniteTroops: true }, [
    human,
    packInfo,
  ]);

  const player = game.player("daniel");
  player.setAge(Age.Primitive);
  expect(player.displayName().startsWith("Tribe of ")).toBe(true);
  player.setAge(Age.Classical);
  expect(player.displayName().startsWith("Kingdom of ")).toBe(true);
  player.setAge(Age.Imperial);
  expect(player.displayName().startsWith("Empire of ")).toBe(true);

  // An animal pack is not a civilization — it keeps its raw archetype name.
  const pack = game.player("wolves");
  pack.setAge(Age.Primitive);
  expect(pack.displayName().includes("Tribe of")).toBe(false);
});

// --- Limited conquest + overextension penalty in Classical ------------------
test("Classical conquers only a little faster than Primitive (limited conquest)", async () => {
  const p1 = new PlayerInfo("alice", PlayerType.Human, "alice", "alice");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const config = game.config();
  const prim = config.attackTilesPerTickAgeMult(Age.Primitive);
  const classical = config.attackTilesPerTickAgeMult(Age.Classical);
  const imperial = config.attackTilesPerTickAgeMult(Age.Imperial);
  // Strictly between Primitive and Imperial, and closer to Primitive (limited).
  expect(classical).toBeGreaterThan(prim);
  expect(classical).toBeLessThan(imperial);
});

test("overextension penalty now bites in Classical (was Primitive-only), harder than Primitive", async () => {
  const p1 = new PlayerInfo("alice", PlayerType.Human, "alice", "alice");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const player = game.player("alice");
  const config = game.config();
  player.conquer(game.ref(50, 50));
  player.setIntegrationDebt(100000); // far past capacity → ratio clamps to 1

  player.setAge(Age.Primitive);
  const prim = config.overextensionPenalty(player).goldMult;
  player.setAge(Age.Classical);
  const classical = config.overextensionPenalty(player).goldMult;
  player.setAge(Age.Imperial);
  const imperial = config.overextensionPenalty(player).goldMult;

  expect(prim).toBeLessThan(1); // Primitive still penalized
  expect(classical).toBeLessThan(prim); // Classical bites harder
  expect(imperial).toBe(1); // Imperial+ hold land freely
});

// --- Headline: Classical civil-war secession --------------------------------
test("an overextended Classical kingdom fractures: a rebel kingdom secedes", async () => {
  const p1 = new PlayerInfo("alice", PlayerType.Human, "alice", "alice");
  const game = await setup("big_plains", { infiniteTroops: true }, [p1]);
  const player = game.player("alice");

  // A compact, well-supported realm of ~40 tiles (enough to carve two halves
  // each ≥ the minimum, mostly inside the camp support radius so the gentle
  // Classical rewild doesn't shed it out from under the test).
  for (let x = 40; x < 48; x++) {
    for (let y = 48; y < 53; y++) {
      player.conquer(game.ref(x, y));
    }
  }
  player.setAge(Age.Classical);

  const tilesBefore = player.numTilesOwned();
  const playersBefore = game.allPlayers().length;
  expect(tilesBefore).toBeGreaterThan(30);

  // Severe, sustained overexpansion: debt far past the civil-war ratio.
  player.setIntegrationDebt(100000);
  game.addExecution(new PlayerExecution(player));

  // Run past the staggered split-check cadence (ticksPerSplitCheck = 30 + hash
  // stagger) plus a tick for the enqueued secession to execute.
  for (let i = 0; i < 75; i++) {
    game.executeNextTick();
    if (game.allPlayers().length > playersBefore) break;
  }

  // A breakaway rebel kingdom now exists, the parent shed a chunk of its realm,
  // and its debt was reset to a fraction of capacity (relief + lingering unrest).
  expect(game.allPlayers().length).toBe(playersBefore + 1);
  expect(player.numTilesOwned()).toBeLessThan(tilesBefore);
  expect(player.integrationDebt()).toBeLessThan(100000);
});

test("a stable Classical kingdom does NOT secede; Imperial empires never secede", async () => {
  const p1 = new PlayerInfo("alice", PlayerType.Human, "alice", "alice");
  const game = await setup("big_plains", { infiniteTroops: true }, [p1]);
  const player = game.player("alice");
  for (let x = 40; x < 48; x++) {
    for (let y = 48; y < 53; y++) {
      player.conquer(game.ref(x, y));
    }
  }
  const playersBefore = game.allPlayers().length;

  // Massively overextended, but IMPERIAL → empires hold land freely, no civil war.
  player.setAge(Age.Imperial);
  player.setIntegrationDebt(100000);
  game.addExecution(new PlayerExecution(player));
  for (let i = 0; i < 75; i++) game.executeNextTick();
  expect(game.allPlayers().length).toBe(playersBefore);
});
