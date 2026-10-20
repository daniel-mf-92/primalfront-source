import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  GameModeSelector,
  getRecommendedLobby,
} from "../../src/client/GameModeSelector";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import type { PublicGameInfo, PublicGames } from "../../src/core/Schemas";

function lobby(
  publicGameType: PublicGameInfo["publicGameType"],
  gameID: string,
): PublicGameInfo {
  return {
    gameID,
    numClients: 0,
    publicGameType,
    gameConfig: {
      gameMap: GameMapType.World,
      gameMode: GameMode.FFA,
      maxPlayers: 20,
      publicGameModifiers: {},
    } as PublicGameInfo["gameConfig"],
  };
}

function games(
  ffa: PublicGameInfo[] = [],
  special: PublicGameInfo[] = [],
  team: PublicGameInfo[] = [],
): PublicGames {
  return {
    serverTime: 0,
    games: { ffa, special, team },
  };
}

describe("getRecommendedLobby", () => {
  it("prioritizes the standard free-for-all match for first-time players", () => {
    const ffa = lobby("ffa", "ffa-game");
    const special = lobby("special", "special-game");
    const team = lobby("team", "team-game");

    expect(getRecommendedLobby(games([ffa], [special], [team]))).toBe(ffa);
  });

  it("falls back to another public match when free-for-all is unavailable", () => {
    const special = lobby("special", "special-game");
    const team = lobby("team", "team-game");

    expect(getRecommendedLobby(games([], [special], [team]))).toBe(special);
    expect(getRecommendedLobby(games([], [], [team]))).toBe(team);
  });

  it("returns null while lobbies are unavailable or empty", () => {
    expect(getRecommendedLobby(null)).toBeNull();
    expect(getRecommendedLobby(games())).toBeNull();
  });

  it("features one recommended battle without duplicating it in alternatives", async () => {
    const selector = new GameModeSelector();
    Object.assign(selector, {
      lobbies: games(
        [lobby("ffa", "ffa-game")],
        [lobby("special", "special-game")],
        [lobby("team", "team-game")],
      ),
    });
    const container = document.createElement("div");

    render(selector.render(), container);
    await Promise.resolve();

    const quickPlay =
      container.querySelector<HTMLElement>("#quick-play-button");
    const alternativeLobbies = [
      ...container.querySelectorAll<HTMLElement>(".pf-lobby-card"),
    ];
    const firstAlternative = alternativeLobbies[0];
    const practice = container.querySelector('[data-play-path="solo"]');
    const cardActions = container.querySelectorAll(".pf-lobby-card__action");

    expect(quickPlay).not.toBeNull();
    expect(quickPlay?.dataset.gameId).toBe("ffa-game");
    expect(alternativeLobbies.map((card) => card.dataset.gameId)).toEqual([
      "special-game",
      "team-game",
    ]);
    expect(practice).not.toBeNull();
    expect(
      quickPlay!.compareDocumentPosition(firstAlternative) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      firstAlternative.compareDocumentPosition(practice!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cardActions).toHaveLength(2);
  });

  it("keeps the featured entry actionable while public lobbies load", async () => {
    const selector = new GameModeSelector();
    const container = document.createElement("div");

    render(selector.render(), container);
    await Promise.resolve();

    const quickPlay =
      container.querySelector<HTMLButtonElement>("#quick-play-button");

    expect(quickPlay).not.toBeNull();
    expect(quickPlay?.disabled).toBe(false);
    expect(quickPlay?.dataset.playPath).toBe("solo");
    expect(quickPlay?.textContent).toMatch(/practice/i);
  });
});
