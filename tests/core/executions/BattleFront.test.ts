/**
 * Battles read as battles (Marta 2026-10-22: "battle dynamics suck, don't
 * make too much sense"). Measured before the fix on two Stone Age bands side
 * by side: a click on the neighbour drove a five-tile spike toward the click
 * while the rest of the shared border never moved, the attacker's own
 * carrying-cap shed ate the won wedge ten seconds later, peaceful neighbours
 * shed the very tiles they touched (a strip of wild ground opened between
 * them) and an attack that ran out of troops just vanished with no word.
 */
import { Config } from "../../../src/core/configuration/Config";
import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TerraNullius,
} from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { setup } from "../../util/Setup";
import { UseRealAttackLogic } from "../../util/TestConfig";

/** Real combat AND real attack speed (the shared test config pins speed). */
class RealBattleConfig extends UseRealAttackLogic {
  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    return Config.prototype.attackTilesPerTick.call(
      this,
      attackTroops,
      attacker,
      defender,
      numAdjacentTilesWithEnemy,
    );
  }
}

const Y0 = 90;
const ROWS = 20;
const AX0 = 70; // attacker block x 70..84
const BX0 = 85; // defender block x 85..99
const WIDTH = 15;

async function twoBands(
  aTroops: number,
  bTroops: number,
  bWidth = WIDTH,
  bType = PlayerType.Bot,
): Promise<{ game: Game; a: Player; b: Player }> {
  const ai = new PlayerInfo("attacker", PlayerType.Human, null, "attacker");
  const bi = new PlayerInfo("defender", bType, null, "defender");
  const game = await setup(
    "big_plains",
    {},
    [ai, bi],
    undefined,
    RealBattleConfig,
  );
  const a = game.player(ai.id);
  const b = game.player(bi.id);
  for (let y = Y0; y < Y0 + ROWS; y++) {
    for (let x = AX0; x < AX0 + WIDTH; x++) a.conquer(game.ref(x, y));
    for (let x = BX0; x < BX0 + bWidth; x++) b.conquer(game.ref(x, y));
  }
  a.setTroops(aTroops);
  b.setTroops(bTroops);
  game.addExecution(new PlayerExecution(a));
  game.addExecution(new PlayerExecution(b));
  game.executeNextTick();
  return { game, a, b };
}

/** Tiles of `p` with a 4-neighbour owned by `q`. */
function touching(game: Game, p: Player, q: Player): Set<number> {
  const out = new Set<number>();
  for (const t of p.borderTiles()) {
    for (const n of game.neighbors(t)) {
      if (game.owner(n) === q) {
        out.add(t);
        break;
      }
    }
  }
  return out;
}

describe("a battle is a front, not a spike", () => {
  test("a click on the neighbour pushes the whole shared border", async () => {
    const { game, a, b } = await twoBands(25_000, 10_000);
    const click = game.ref(BX0 + 7, Y0 + 10);
    game.addExecution(new AttackExecution(5000, a, b.id(), null, true, click));
    for (let i = 0; i < 120; i++) game.executeNextTick();
    let advanced = 0;
    const fronts: number[] = [];
    for (let y = Y0; y < Y0 + ROWS; y++) {
      let maxX = -1;
      for (let x = AX0; x < BX0 + WIDTH; x++) {
        if (game.owner(game.ref(x, y)) === a) maxX = x;
      }
      if (maxX >= BX0) advanced++;
      // The band's open corners may shed to the wild; judge the shared line.
      if (maxX >= BX0 - 1) fronts.push(maxX);
    }
    // Before: 6 of 20 rows (a wedge at the click). A front: most of them.
    expect(advanced).toBeGreaterThanOrEqual(14);
    // And it is a line, not a comb: no row sticks out 3+ tiles past the
    // rows next to it.
    for (let i = 1; i < fronts.length; i++) {
      expect(Math.abs(fronts[i] - fronts[i - 1])).toBeLessThanOrEqual(2);
    }
  });

  test("a wilderness walk still follows the click tightly", async () => {
    const config = (await twoBands(1, 1)).game.config();
    expect(config.attackFocusWeight()).toBeGreaterThan(
      config.attackFocusWeightVsPlayer() * 3,
    );
  });
});

describe("the line two tribes fight over is never shed", () => {
  test("no contested tile goes wild during a battle", async () => {
    // Both bands far over their Stone Age carrying capacity, so both shed
    // hard every pass while the battle runs.
    const { game, a, b } = await twoBands(150_000, 150_000, 40);
    game.addExecution(
      new AttackExecution(
        30_000,
        a,
        b.id(),
        null,
        true,
        game.ref(BX0 + 5, Y0 + 10),
      ),
    );
    let contestedShed = 0;
    let battleTicks = 0;
    for (let i = 0; i < 200; i++) {
      const atWar = a.outgoingAttacks().length > 0;
      const aFront = touching(game, a, b);
      const bFront = touching(game, b, a);
      game.executeNextTick();
      if (!atWar) continue;
      battleTicks++;
      for (const t of aFront) if (!game.hasOwner(t)) contestedShed++;
      for (const t of bFront) if (!game.hasOwner(t)) contestedShed++;
    }
    expect(battleTicks).toBeGreaterThan(10);
    expect(contestedShed).toBe(0);
  });

  test("peaceful neighbours shed open ground first and keep touching", async () => {
    const { game, a, b } = await twoBands(100_000, 40_000, 25);
    const before = touching(game, a, b).size;
    for (let i = 0; i < 300; i++) game.executeNextTick();
    // Both bands were over capacity and shed hundreds of tiles - from the
    // open side, not from the border they share.
    expect(a.numTilesOwned()).toBeLessThan(WIDTH * ROWS);
    expect(touching(game, a, b).size).toBeGreaterThanOrEqual(before - 2);
  });
});

describe("an attack ends with a stated reason", () => {
  test("running out of troops is announced to both sides", async () => {
    const { game, a, b } = await twoBands(25_000, 60_000);
    game.addExecution(new AttackExecution(3000, a, b.id(), null, true, null));
    const messages: { playerID: number | null; message: string }[] = [];
    for (let i = 0; i < 200; i++) {
      const updates = game.executeNextTick();
      for (const e of updates[GameUpdateType.DisplayEvent] ?? []) {
        messages.push(e);
      }
    }
    expect(a.outgoingAttacks()).toHaveLength(0);
    expect(
      messages.filter(
        (m) =>
          m.playerID === a.smallID() &&
          m.message === "events_display.attack_spent",
      ),
    ).toHaveLength(1);
    expect(
      messages.filter(
        (m) =>
          m.playerID === b.smallID() &&
          m.message === "events_display.attack_held_off",
      ),
    ).toHaveLength(1);
  });
});
