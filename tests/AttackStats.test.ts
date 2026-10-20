import { AttackExecution } from "../src/core/execution/AttackExecution";
import {
  Age,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { GOLD_INDEX_WAR, GOLD_INDEX_WORK } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
const player1Info = new PlayerInfo(
  "player1",
  PlayerType.Human,
  "player1",
  "player1",
);
const player2Info = new PlayerInfo(
  "player2",
  PlayerType.Human,
  "player2",
  "player2",
);

describe("AttackStats", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteTroops: true }, [
      player1Info,
      player2Info,
    ]);

    player1 = game.player("player1");
    player2 = game.player("player2");
    player1.conquer(game.ref(50, 50));
    player2.conquer(game.ref(50, 51));
    player2.addGold(100n);
    game.stats().goldWork(player2, 100n);
  });

  test("should increase war gold stat when a player is eliminated", () => {
    // Plunder-for-gold on a kill is now an empire-era mechanic (Module §7): the
    // Primitive era yields slaves/sacrifice instead of conquest gold, so exercise
    // the plunder+conquest war-gold accounting at Imperial age (mirrors the
    // annexation test below).
    player1.setAge(Age.Imperial);
    player2.setAge(Age.Imperial);
    expect(player1.sharesBorderWith(player2)).toBeTruthy();
    // Player2 must attack to be considered active (otherwise gold won't transfer)
    game.addExecution(
      new AttackExecution(1, player2, game.terraNullius().id()),
    );
    game.executeNextTick();
    performAttack(game, player1, player2);
    expectWarGoldStatIsIncreasedAfterKill(game, player1, player2);
  });

  test("should NOT increase war gold stat when a inactive player is eliminated", () => {
    expect(player1.sharesBorderWith(player2)).toBeTruthy();

    const attackerStatsBefore = game.stats().stats()[player1.clientID()!];
    const warGoldBefore = attackerStatsBefore?.gold?.[GOLD_INDEX_WAR] ?? 0n;

    performAttack(game, player1, player2);

    const attackerStatsAfter = game.stats().stats()[player1.clientID()!];
    const warGoldAfter = attackerStatsAfter?.gold?.[GOLD_INDEX_WAR] ?? 0n;

    expect(warGoldAfter).toBe(warGoldBefore);
  });

  test("should increase war gold stat when elimination occurs via territory annexation", () => {
    // Whole-territory annexation (border flood) is an empire-era mechanic. In
    // the Primitive era expansion is deliberate path-claim (no flood), so this
    // annexation scenario is exercised at Imperial age.
    player1.setAge(Age.Imperial);
    player2.setAge(Age.Imperial);
    // Player2 must attack to be considered active (otherwise gold won't transfer)
    game.addExecution(
      new AttackExecution(1, player2, game.terraNullius().id()),
    );
    game.executeNextTick();

    // Mark every tile on the map as owned by player1
    for (let x = 0; x < game.map().width(); x++) {
      for (let y = 0; y < game.map().height(); y++) {
        player1.conquer(game.ref(x, y));
      }
    }
    // Place tiles of player2 in the center of the map
    const centerX = Math.round(game.map().width() / 2);
    const centerY = Math.round(game.map().height() / 2);
    for (let x = -20; x < 20; x++) {
      for (let y = -20; y < 20; y++) {
        player2.conquer(game.ref(centerX + x, centerY + y));
      }
    }

    performAttack(game, player1, player2);
    expectWarGoldStatIsIncreasedAfterKill(game, player1, player2);
  });
});

function expectWarGoldStatIsIncreasedAfterKill(
  game: Game,
  attacker: Player,
  defender: Player,
) {
  // Verify that the defender was killed as a result of the attack
  expect(attacker.isAlive()).toBeTruthy();
  expect(defender.isAlive()).toBeFalsy();

  const attackerStats = game.stats().stats()[attacker.clientID()!];
  const defenderStats = game.stats().stats()[defender.clientID()!];

  // War gold to the conqueror has two deterministic parts, both recorded as
  // war gold: (1) plunder seizes plunderFraction (50%) of the victim's banked
  // gold on the kill, then (2) conquerPlayer transfers conquerGoldAmount (50%)
  // of what remains. For a human total of G that is G/2 + (G/2)/2 = 3G/4.
  const defenderTotal =
    defenderStats?.gold?.reduce((acc, g) => acc + g, 0n) ?? 0n;
  const plunder = defenderTotal / 2n;
  const conquest = (defenderTotal - plunder) / 2n;
  expect(attackerStats?.gold?.[GOLD_INDEX_WAR]).toBeDefined();
  expect(defenderStats?.gold?.[GOLD_INDEX_WORK]).toBeDefined();
  expect(attackerStats?.gold?.[GOLD_INDEX_WAR]).toBe(plunder + conquest);
}

function performAttack(game: Game, attacker: Player, defender: Player) {
  // Execute the attack
  game.addExecution(
    new AttackExecution(attacker.troops(), attacker, defender.id()),
  );
  // Wait for the attack to complete
  do {
    game.executeNextTick();
  } while (attacker.outgoingAttacks().length > 0);
}
