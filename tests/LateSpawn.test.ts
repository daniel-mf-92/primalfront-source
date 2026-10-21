import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// The client now sends a spawn for a player who missed the spawn phase (slow load);
// the simulation must accept it and give them a living tribe.
describe("late spawn", () => {
  test("a player spawning after the spawn phase gets a living tribe", async () => {
    const game = await setup("plains", {});
    const info = new PlayerInfo(
      "late joiner",
      PlayerType.Human,
      null,
      "late_id",
    );
    game.addPlayer(info);
    while (game.inSpawnPhase()) game.executeNextTick();

    game.addExecution(
      new SpawnExecution(
        "game_id",
        game.player(info.id).info(),
        game.ref(Math.floor(game.width() / 2), Math.floor(game.height() / 2)),
      ),
    );
    for (let i = 0; i < 20; i++) game.executeNextTick();

    const player = game.player(info.id);
    expect(player.hasSpawned()).toBe(true);
    expect(player.isAlive()).toBe(true);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });
});
