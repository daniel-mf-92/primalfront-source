import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { generateID } from "../core/Util";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import type { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { getBotsForCompactMap } from "./utilities/GameConfigHelpers";

/** The three choices a shared result carries; everything else is default. */
export interface PracticeSetup {
  map: GameMapType;
  difficulty: Difficulty;
  compact: boolean;
}

/** The practice modal's own defaults, so a one-tap start plays the same game. */
export const DEFAULT_PRACTICE_BOTS = 133;

/**
 * Start a practice match straight from a setup, with no form in between. Used
 * when a visitor accepts a shared result: they land on the exact map and
 * difficulty the sharer played, which is the whole point of the link.
 */
export async function launchPractice(
  host: HTMLElement,
  setup: PracticeSetup,
): Promise<void> {
  const clientID = generateID();
  const gameID = generateID();
  const usernameInput = document.querySelector(
    "username-input",
  ) as UsernameInput | null;
  await crazyGamesSDK.requestMidgameAd();
  host.dispatchEvent(
    new CustomEvent("join-lobby", {
      detail: {
        gameID,
        gameStartInfo: {
          gameID,
          players: [
            {
              clientID,
              username: usernameInput?.getUsername() ?? "",
              clanTag: usernameInput?.getClanTag() ?? null,
              cosmetics: await getPlayerCosmetics(),
            },
          ],
          config: {
            gameMap: setup.map,
            gameMapSize: setup.compact
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            gameType: GameType.Singleplayer,
            gameMode: GameMode.FFA,
            playerTeams: 2,
            difficulty: setup.difficulty,
            bots: getBotsForCompactMap(DEFAULT_PRACTICE_BOTS, setup.compact),
            infiniteGold: false,
            donateGold: false,
            donateTroops: false,
            infiniteTroops: false,
            instantBuild: false,
            randomSpawn: false,
            disabledUnits: [],
            nations: "default",
          },
          lobbyCreatedAt: Date.now(),
        },
        source: "singleplayer",
      } satisfies JoinLobbyEvent,
      bubbles: true,
      composed: true,
    }),
  );
}
