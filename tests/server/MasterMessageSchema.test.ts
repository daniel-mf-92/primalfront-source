import { describe, expect, it } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { MasterMessageSchema } from "../../src/server/IPCBridgeSchema";

describe("MasterMessageSchema", () => {
  it("accepts generated public games with 400 bots", () => {
    const result = MasterMessageSchema.safeParse({
      type: "createGame",
      gameID: "public-400-bot-game",
      publicGameType: "ffa",
      gameConfig: {
        donateGold: false,
        donateTroops: false,
        gameMap: GameMapType.World,
        maxPlayers: 200,
        gameType: GameType.Public,
        gameMapSize: GameMapSize.Normal,
        difficulty: Difficulty.Medium,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        nations: "default",
        gameMode: GameMode.FFA,
        bots: 400,
        disabledUnits: [],
        disableClanTags: true,
      },
    });

    expect(result.success).toBe(true);
  });
});
