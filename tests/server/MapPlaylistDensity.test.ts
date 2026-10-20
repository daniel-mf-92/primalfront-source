import { describe, expect, it } from "vitest";
import { GameMode, GameMapType } from "../../src/core/game/Game";
import { TeamCountConfig } from "../../src/core/Schemas";
import {
  MapPlaylist,
  PUBLIC_COMPACT_BOTS,
  PUBLIC_MAX_PLAYER_COUNT,
  PUBLIC_NORMAL_BOTS,
} from "../../src/server/MapPlaylist";

describe("MapPlaylist primitive-era density", () => {
  it("uses one-third bot density for generated public games", async () => {
    const playlist = new MapPlaylist();

    const ffa = await playlist.gameConfig("ffa");
    const team = await playlist.gameConfig("team");
    const special = await playlist.gameConfig("special");
    const duel = playlist.get1v1Config();

    for (const config of [ffa, team, special, duel]) {
      expect([PUBLIC_COMPACT_BOTS, PUBLIC_NORMAL_BOTS]).toContain(config.bots);
    }
  });

  it("caps generated human slots at the sparse primitive density", async () => {
    const playlist = new MapPlaylist() as unknown as {
      lobbyMaxPlayers: (
        map: GameMapType,
        mode: GameMode,
        teams: TeamCountConfig | undefined,
        compact?: boolean,
      ) => Promise<number>;
    };

    const normal = await playlist.lobbyMaxPlayers(
      GameMapType.World,
      GameMode.FFA,
      undefined,
      false,
    );
    const compact = await playlist.lobbyMaxPlayers(
      GameMapType.World,
      GameMode.FFA,
      undefined,
      true,
    );

    expect(normal).toBeLessThanOrEqual(PUBLIC_MAX_PLAYER_COUNT);
    expect(compact).toBeLessThanOrEqual(PUBLIC_MAX_PLAYER_COUNT);
    expect(compact).toBeLessThan(normal);
  });
});
