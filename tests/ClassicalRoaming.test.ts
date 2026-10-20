/**
 * Owner direction 2026-08-03: "map should not fill at 12 minute mark. whole
 * primitive era should be roaming. next era after that should not fill map
 * neither, simply larger carrying capacity 3x and 6x slower to move borders by
 * clicking."
 *
 * The mobile-camp mechanic used to END at Primitive — PrimitiveMigrationExecution
 * bailed on `age() !== Age.Primitive` — so advancing dropped a player into
 * ordinary conquest expansion and the map snapped full within two minutes of the
 * first advance (measured: 11% at minute 13 -> 39.8% by minute 20).
 *
 * Classical now still roams. It is simply 3x larger and 6x more ponderous.
 */
import { Age, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

describe("Classical still roams", () => {
  test("the migration mechanic covers Primitive and Classical, and stops after", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", {}, [info]);
    const config = game.config();

    expect(config.roamsByMigration(Age.Primitive)).toBe(true);
    expect(config.roamsByMigration(Age.Classical)).toBe(true);
    // Imperial and beyond hold fixed borders and expand by conquest.
    expect(config.roamsByMigration(Age.Imperial)).toBe(false);
  });

  test("a Classical band holds exactly 3x the ground of a primitive one", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", {}, [info]);
    const player = game.player(info.id);
    const config = game.config();

    player.setTroops(20_000);
    player.setAge(Age.Primitive);
    const primitive = config.primitiveMigrationCapacity(player);
    player.setAge(Age.Classical);
    const classical = config.primitiveMigrationCapacity(player);

    expect(Number.isFinite(primitive)).toBe(true);
    expect(classical).toBe(primitive * 3);
  });

  test("a Classical band shifts its borders 6x more slowly", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", {}, [info]);
    const config = game.config();

    expect(config.migrationTickStride(Age.Primitive)).toBe(1);
    expect(config.migrationTickStride(Age.Classical)).toBe(6);
  });

  test("Imperial has no roaming capacity cap, so it expands normally", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", {}, [info]);
    const player = game.player(info.id);
    player.setTroops(20_000);
    player.setAge(Age.Imperial);

    expect(game.config().primitiveMigrationCapacity(player)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(game.config().primitiveMigrationTilesPerTick(player)).toBe(0);
  });

  test("the frontier still trims in both roaming ages, so neither snaps full", async () => {
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    const game = await setup("big_plains", {}, [info]);
    const config = game.config();
    // rewildEnabled already covered both; assert it stays in step with the
    // roaming rule, or a 3x Classical kingdom would grow and never shed.
    expect(config.rewildEnabled(Age.Primitive)).toBe(
      config.roamsByMigration(Age.Primitive),
    );
    expect(config.rewildEnabled(Age.Classical)).toBe(
      config.roamsByMigration(Age.Classical),
    );
  });
});
