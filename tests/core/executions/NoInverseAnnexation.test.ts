import { beforeEach, describe, expect, test } from "vitest";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Age,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let largePlayer: Player;
let smallPlayer: Player;

describe("PlayerExecution Annexation Bug", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("large", PlayerType.Human, "client1", "large_id"),
        new PlayerInfo("small", PlayerType.Human, "client2", "small_id"),
      ],
    );

    largePlayer = game.player("large_id");
    smallPlayer = game.player("small_id");
    // This exercises annexation at empire scale (one player owns most of the
    // map). That is a civilized-age scenario; keep both out of the Primitive
    // era so the Primitive-only settlement rewild doesn't shed frontier tiles.
    largePlayer.setAge(Age.Imperial);
    smallPlayer.setAge(Age.Imperial);

    game.addExecution(new PlayerExecution(largePlayer));
    game.addExecution(new PlayerExecution(smallPlayer));
  });

  test("A large player is not reverse-annexed by surrounded smaller player", () => {
    // Cluster A
    smallPlayer.conquer(game.ref(50, 50));
    smallPlayer.conquer(game.ref(50, 51));
    smallPlayer.conquer(game.ref(51, 50));
    smallPlayer.conquer(game.ref(51, 51));
    // Cluster B
    smallPlayer.conquer(game.ref(10, 10));
    smallPlayer.conquer(game.ref(90, 90));

    // Larger player gets the rest
    game.map().forEachTile((tile) => {
      if (game.ownerID(tile) !== smallPlayer.smallID()) {
        largePlayer.conquer(tile);
      }
    });

    const initialLargeTiles = largePlayer.numTilesOwned();
    expect(largePlayer.numTilesOwned()).toBe(initialLargeTiles);
    expect(smallPlayer.numTilesOwned()).toBeGreaterThan(0);

    // Keep ticksPerClusterCalc and lastTileChange in mind
    executeTicks(game, 20);
    largePlayer.conquer(game.ref(49, 49));
    smallPlayer.conquer(game.ref(50, 50));

    // Annexation happens here
    executeTicks(game, 50);
    expect(largePlayer.numTilesOwned()).toBeGreaterThan(initialLargeTiles);
    expect(smallPlayer.numTilesOwned()).toBe(0);
  });
});
