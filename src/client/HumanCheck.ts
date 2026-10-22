import { GameEnv } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";

/**
 * Pure: does joining this lobby need the Cloudflare human check? Never for
 * practice / singleplayer (it runs in the browser; the server never sees a
 * token) and never in dev; always for public and private multiplayer, where
 * the server verifies it (Worker.ts). Playtest 2026-10-22: a "Verify you are
 * human" box sat over Play again in a practice game.
 */
export function needsHumanCheck(
  env: GameEnv,
  lobby: {
    source?: string;
    gameStartInfo?: { config: { gameType: GameType } };
  },
): boolean {
  if (env === GameEnv.Dev) return false;
  if (lobby.source === "singleplayer") return false;
  return lobby.gameStartInfo?.config.gameType !== GameType.Singleplayer;
}
