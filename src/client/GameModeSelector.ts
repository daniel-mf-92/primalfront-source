import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { trackAnalyticsEvent } from "./Analytics";
import "./components/IOSAddToHomeScreenBanner";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { Challenge, parseChallenge } from "./HomeChallenge";
import { HostLobbyModal } from "./HostLobbyModal";
import {
  formatDuration,
  formatTiles,
  romanNumeral,
  TICKS_PER_SECOND,
} from "./hud/layers/MatchResult";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import type { JoinLobbyEvent } from "./Main";
import { launchPractice } from "./PracticeLaunch";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getMapName,
  getModifierLabels,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "./Utils";

const CARD_BG = "bg-surface";

/**
 * The featured lobby: the one the pointer is resting on while it is still
 * joinable, otherwise the recommended one.
 */
export function pinnedOrRecommended(
  lobbies: PublicGames | null,
  pinnedGameID: string | null,
): PublicGameInfo | null {
  if (lobbies !== null && pinnedGameID !== null) {
    const pinned = Object.values(lobbies.games ?? {})
      .flat()
      .find((lobby) => lobby.gameID === pinnedGameID);
    if (pinned !== undefined) return pinned;
  }
  return getRecommendedLobby(lobbies);
}

export function getRecommendedLobby(
  lobbies: PublicGames | null,
): PublicGameInfo | null {
  if (!lobbies) return null;

  return (
    lobbies.games?.["ffa"]?.[0] ??
    lobbies.games?.["special"]?.[0] ??
    lobbies.games?.["team"]?.[0] ??
    Object.values(lobbies.games ?? {}).flat()[0] ??
    null
  );
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private mapAspectRatios: Map<GameMapType, number> = new Map();
  @state() private inputValid: boolean = true;
  // The featured battle under the pointer stays put. Lobbies roll over every
  // few seconds, and the hero map swapping under the cursor read as the page
  // moving away from the click (audit 2026-10-22).
  private pinnedGameID: string | null = null;
  /**
   * A result someone shared. Read once from the URL: this is the whole reason a
   * first-time visitor is on the page, so it outranks the generic pitch.
   */
  private readonly challenge: Challenge | null =
    typeof window === "undefined"
      ? null
      : parseChallenge(window.location.search);
  private serverTimeOffset: number = 0;
  private defaultLobbyTime: number = 0;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  // Silent backstop; the buttons are already disabled while input is invalid.
  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    this.defaultLobbyTime = ClientEnv.gameCreationRate() / 1000;
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
  }

  disconnectedCallback() {
    this.stop();
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  public stop() {
    this.lobbySocket.stop();
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    this.requestUpdate();

    const allGames = Object.values(lobbies.games ?? {}).flat();
    for (const game of allGames) {
      const mapType = game.gameConfig?.gameMap as GameMapType;
      if (mapType && !this.mapAspectRatios.has(mapType)) {
        // New Map reference triggers Lit reactivity; placeholder ratio 1 lets
        // has() guard against duplicate in-flight fetches.
        this.mapAspectRatios = new Map(this.mapAspectRatios).set(mapType, 1);
        terrainMapFileLoader
          .getMapData(mapType)
          .manifest()
          .then((m: any) => {
            if (m?.map?.width && m?.map?.height) {
              this.mapAspectRatios = new Map(this.mapAspectRatios).set(
                mapType,
                m.map.width / m.map.height,
              );
            }
          })
          .catch((e) =>
            console.error(`Failed to load manifest for ${mapType}`, e),
          );
      }
    }
  }

  render() {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];
    const recommendedLobby = pinnedOrRecommended(
      this.lobbies,
      this.pinnedGameID,
    );
    const isOnCrazyGames = crazyGamesSDK.isOnCrazyGames();
    const alternativeLobbies = [special, teams, ffa]
      .filter(
        (lobby): lobby is PublicGameInfo =>
          lobby !== undefined && lobby !== recommendedLobby,
      )
      .slice(0, 2);

    return html`
      <div class="pf-match-browser">
        ${this.renderPitch()} ${this.renderFeaturedMatch(recommendedLobby)}
        ${alternativeLobbies.length > 0
          ? html`
              <div class="pf-match-browser__section-heading">
                <span>${translateText("mode_selector.other_battles")}</span>
              </div>
              <div class="pf-alternative-matches">
                ${alternativeLobbies.map((lobby) =>
                  this.renderLobbyCard(lobby, this.getLobbyTitle(lobby)),
                )}
              </div>
            `
          : nothing}

        <div class="pf-match-browser__section-heading">
          <span>${translateText("mode_selector.more_ways_to_play")}</span>
        </div>
        <div class="pf-mode-tools ${isOnCrazyGames ? "is-three" : ""}">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "is-secondary",
            "create_lobby",
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.practice"),
            this.openSinglePlayerModal,
            "is-secondary",
            "solo",
          )}
          ${!isOnCrazyGames
            ? this.renderSmallActionCard(
                translateText("mode_selector.ranked_title"),
                this.openRankedMenu,
                "is-secondary",
                "ranked",
              )
            : nothing}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "is-secondary",
            "join_lobby",
          )}
        </div>

        <ios-add-to-home-screen-banner></ios-add-to-home-screen-banner>
      </div>
    `;
  }

  private openRankedMenu = () => {
    if (!this.validateUsername()) return;
    trackAnalyticsEvent("play_intent", { entry_point: "ranked" });
    window.showPage?.("page-ranked");
  };

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    trackAnalyticsEvent("play_intent", { entry_point: "solo" });
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  // The sharer's exact match, one tap away. Without a setup in the link the
  // button still works: it opens practice on the default map.
  private acceptChallenge = () => {
    if (!this.validateUsername()) return;
    const challenge = this.challenge;
    trackAnalyticsEvent("play_intent", { entry_point: "challenge" });
    if (challenge?.map === undefined) {
      (
        document.querySelector("single-player-modal") as SinglePlayerModal
      )?.open();
      return;
    }
    void launchPractice(this, {
      map: challenge.map,
      difficulty: challenge.difficulty ?? Difficulty.Easy,
      compact: challenge.compact === true,
    });
  };

  private openHostLobby = () => {
    if (!this.validateUsername()) return;
    trackAnalyticsEvent("play_intent", { entry_point: "create_lobby" });
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoinLobby = () => {
    if (!this.validateUsername()) return;
    trackAnalyticsEvent("play_intent", { entry_point: "join_lobby" });
    (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open();
  };

  private renderFeaturedMatch(lobby: PublicGameInfo | null) {
    if (this.lobbies === null) {
      return html`
        <button
          id="quick-play-button"
          type="button"
          @click=${this.openSinglePlayerModal}
          ?disabled=${!this.inputValid}
          data-play-path="solo"
          class="pf-featured-match is-loading"
        >
          <span class="pf-featured-match__loading-copy">
            <span class="pf-featured-match__eyebrow">
              ${translateText("mode_selector.finding_match")}
            </span>
            <span class="pf-featured-match__loading-title">
              ${translateText("public_lobby.connecting")}
            </span>
          </span>
          <span class="pf-featured-match__action">
            <span>${translateText("mode_selector.practice")}</span>
            <span aria-hidden="true">&#8594;</span>
          </span>
          <span class="pf-featured-match__spinner" aria-hidden="true"></span>
        </button>
      `;
    }

    if (!lobby) {
      return html`
        <button
          id="quick-play-button"
          type="button"
          @click=${this.openSinglePlayerModal}
          ?disabled=${!this.inputValid}
          data-play-path="solo"
          class="pf-featured-match is-empty ${!this.inputValid
            ? "is-disabled"
            : ""}"
        >
          <span class="pf-featured-match__empty-copy">
            <span class="pf-featured-match__eyebrow">
              ${translateText("mode_selector.no_public_matches")}
            </span>
            <span class="pf-featured-match__empty-title">
              ${translateText("mode_selector.play_solo_now")}
            </span>
          </span>
          <span class="pf-featured-match__action">
            <span>${translateText("main.play")}</span>
            <span aria-hidden="true">&#8594;</span>
          </span>
        </button>
      `;
    }

    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const aspectRatio = this.mapAspectRatios.get(mapType);
    const useContain =
      aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);
    const mapName = getMapName(lobby.gameConfig?.gameMap);
    const timing = this.getLobbyTiming(lobby);
    const startLabel = timing.isStarting
      ? timing.display
      : translateText("public_lobby.starting_in", {
          time: timing.display,
        });
    const modifierLabels = getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    ).slice(0, 3);
    const maxPlayers = lobby.gameConfig?.maxPlayers;
    const currentPlayers =
      maxPlayers === undefined
        ? lobby.numClients
        : Math.min(lobby.numClients, maxPlayers);
    const playerLabel =
      currentPlayers === 0 || maxPlayers === undefined
        ? translateText("public_lobby.open_seats")
        : translateText("mode_selector.players_joined", {
            current: String(currentPlayers),
            max: String(maxPlayers),
          });

    return html`
      <button
        id="quick-play-button"
        type="button"
        @click=${() => this.validateAndJoin(lobby, "quick_play")}
        ?disabled=${!this.inputValid}
        data-play-path="quick_play"
        data-game-id=${lobby.gameID}
        @pointerenter=${() => {
          this.pinnedGameID = lobby.gameID;
        }}
        @pointerleave=${() => {
          this.pinnedGameID = null;
          this.requestUpdate();
        }}
        class="pf-featured-match ${!this.inputValid ? "is-disabled" : ""}"
      >
        <span class="pf-featured-match__media" aria-hidden="true">
          ${mapImageSrc
            ? html`<img
                src=${mapImageSrc}
                alt=""
                draggable="false"
                class=${useContain ? "is-contained" : ""}
              />`
            : nothing}
        </span>
        <span class="pf-featured-match__shade" aria-hidden="true"></span>

        <span class="pf-featured-match__topline">
          <span class="pf-featured-match__eyebrow">
            <span class="pf-featured-match__live-dot" aria-hidden="true"></span>
            ${translateText("mode_selector.featured_eyebrow")}
          </span>
          <span class="pf-featured-match__timer num">${startLabel}</span>
        </span>

        <span class="pf-featured-match__content">
          <span class="pf-featured-match__copy">
            ${modifierLabels.length > 0
              ? html`<span class="pf-featured-match__tags">
                  ${modifierLabels.map(
                    (label) =>
                      html`<span class="pf-pill pf-pill--accent"
                        >${label}</span
                      >`,
                  )}
                </span>`
              : nothing}
            <span class="pf-featured-match__map">
              ${mapName ?? lobby.gameConfig?.gameMap}
            </span>
            <span class="pf-featured-match__facts">
              <span>${this.getLobbyTitle(lobby)}</span>
              <span aria-hidden="true">/</span>
              <span>${playerLabel}</span>
            </span>
          </span>
          <span class="pf-featured-match__action">
            <span>${translateText("mode_selector.join_battle")}</span>
            <span aria-hidden="true">&#8594;</span>
          </span>
        </span>
      </button>
    `;
  }

  /**
   * What this is, for someone who has never played. Deliberately two lines and
   * pinned above the match browser: a returning player must still see the join
   * CTA without scrolling, so this buys its space with brevity.
   */
  private renderPitch(): TemplateResult {
    const challenge = this.challenge;
    const pitch = html`<p class="pf-pitch__line">
      ${translateText("mode_selector.pitch")}
    </p>`;
    if (challenge === null) {
      // Practice used to live only under "More ways to play", below the fold
      // at 1080p (audit 2026-10-22). It is the safest first game, so it sits
      // up here beside the pitch, one click from the top of the page.
      return html`
        <div class="pf-pitch pf-pitch--with-cta">
          <div class="pf-pitch__copy">
            <span class="pf-pitch__kicker"
              >${translateText("mode_selector.pitch_kicker")}</span
            >
            ${pitch}
          </div>
          <button
            type="button"
            class="pf-pitch__practice"
            data-play-path="solo_hero"
            ?disabled=${!this.inputValid}
            @click=${this.openSinglePlayerModal}
          >
            <span>${translateText("mode_selector.play_solo_now")}</span>
            <span aria-hidden="true">&#8594;</span>
          </button>
        </div>
      `;
    }
    const values = {
      era: romanNumeral(challenge.era),
      tiles: formatTiles(challenge.tiles),
      outlasted: String(challenge.outlasted),
      rivals: String(challenge.rivals),
      time: formatDuration(challenge.seconds * TICKS_PER_SECOND),
    };
    return html`
      <div class="pf-pitch pf-pitch--challenge">
        <span class="pf-pitch__kicker"
          >${translateText("mode_selector.challenge_kicker")}</span
        >
        <p class="pf-pitch__line pf-pitch__line--challenge">
          ${translateText(
            challenge.rivals > 0
              ? "mode_selector.challenge_line"
              : "mode_selector.challenge_line_solo",
            values,
          )}
        </p>
        <button
          type="button"
          class="pf-challenge-accept"
          data-play-path="challenge"
          ?disabled=${!this.inputValid}
          @click=${this.acceptChallenge}
        >
          <span>
            ${challenge.map !== undefined
              ? translateText("mode_selector.challenge_accept", {
                  map: getMapName(challenge.map) ?? challenge.map,
                  difficulty: translateText(
                    `difficulty.${(challenge.difficulty ?? Difficulty.Easy).toLowerCase()}`,
                  ),
                })
              : translateText("mode_selector.challenge_accept_generic")}
          </span>
          <span aria-hidden="true">&#8594;</span>
        </button>
        ${pitch}
      </div>
    `;
  }

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = CARD_BG,
    playPath: string = "secondary",
  ) {
    return html`
      <button
        type="button"
        @click=${onClick}
        ?disabled=${!this.inputValid}
        data-play-path=${playPath}
        class="pf-action-card ${bgClass} flex items-center justify-center w-full h-full text-sm lg:text-base font-display font-semibold uppercase text-center ${!this
          .inputValid
          ? "is-disabled"
          : ""}"
      >
        ${title}
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const aspectRatio = this.mapAspectRatios.get(mapType);
    // Use object-contain for extreme aspect ratios (e.g. Amazon River ~20:1) so
    // the full map is visible instead of being cropped by object-cover.
    const useContain =
      aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);
    const timing = this.getLobbyTiming(lobby);

    const mapName = getMapName(lobby.gameConfig?.gameMap);

    const modifierLabels = getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    // Sort by length for visual consistency (shorter labels first)
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    // The server can briefly report more clients than seats (e.g. "8/5" on a
    // 5-max lobby — 2026-07-10 home audit). Clamp the display: a full lobby
    // reads "5/5", never an over-capacity count that looks like a bug.
    const cardMaxPlayers = lobby.gameConfig?.maxPlayers;
    const cardClients =
      cardMaxPlayers !== undefined
        ? Math.min(lobby.numClients, cardMaxPlayers)
        : lobby.numClients;

    return html`
      <button
        type="button"
        @click=${() => this.validateAndJoin(lobby, "lobby_card")}
        ?disabled=${!this.inputValid}
        data-play-path="lobby_card"
        data-game-id=${lobby.gameID}
        class="pf-lobby-card group relative w-full text-white uppercase ${!this
          .inputValid
          ? "is-disabled"
          : ""}"
      >
        <!-- Image clipped separately so overflow-hidden doesn't block absolute children.
             Ocean backing: map webps have transparent water, so without a sea
             tone behind them the ocean reads as black holes (2026-07-02 UX). -->
        <div
          class="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none"
          style="background: radial-gradient(120% 90% at 50% 40%, #17293e 0%, #0e1b2c 62%, #0a1420 100%);"
        >
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
                draggable="false"
                class="absolute inset-0 w-full h-full ${useContain
                  ? "object-contain"
                  : "object-cover object-center scale-[1.05]"} [image-rendering:auto]"
              />`
            : null}
        </div>
        <!-- Top row: modifiers + timer -->
        <div
          class="absolute inset-x-2 top-2 flex items-start justify-between gap-2"
        >
          ${modifierLabels.length > 0
            ? html`<div class="flex flex-col items-start gap-1 mt-[2px]">
                ${modifierLabels.map(
                  (label) =>
                    html`<span class="pf-pill pf-pill--accent">${label}</span>`,
                )}
              </div>`
            : html`<div></div>`}
          <div class="shrink-0">
            <span
              class="pf-pill pf-pill--timer num ${timing.isStarting
                ? "uppercase"
                : "normal-case"}"
              >${timing.display}</span
            >
          </div>
        </div>
        <!-- Bottom bar: map name + mode, with player count floating above -->
        <div
          class="pf-lobby-card__bar absolute bottom-0 left-0 right-0 flex flex-row items-end justify-between gap-2 px-3 py-2"
          style="overflow: visible;"
        >
          <span
            class="pf-lobby-card__count num absolute bottom-full right-2 mb-1 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded"
          >
            ${cardClients === 0
              ? translateText("public_lobby.open_seats")
              : html`${cardClients}/${cardMaxPlayers}`}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 inline-block"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
              ></path>
            </svg>
          </span>
          <span class="pf-lobby-card__details">
            ${mapName
              ? html`<span
                  class="pf-lobby-card__map block font-display text-sm sm:text-base font-bold uppercase text-left leading-tight"
                >
                  ${mapName}
                </span>`
              : ""}
            <span
              class="pf-lobby-card__title block text-xs uppercase text-left"
            >
              ${titleContent}
            </span>
          </span>
          <span class="pf-lobby-card__action">
            ${translateText("main.play")}
          </span>
        </div>
      </button>
    `;
  }

  private getLobbyTiming(lobby: PublicGameInfo): {
    display: string;
    isStarting: boolean;
  } {
    const timeRemaining = lobby.startsAt
      ? getSecondsUntilServerTimestamp(lobby.startsAt, this.serverTimeOffset)
      : undefined;

    if (timeRemaining === undefined) {
      return {
        display: renderDuration(this.defaultLobbyTime),
        isStarting: false,
      };
    }
    if (timeRemaining > 0) {
      return { display: renderDuration(timeRemaining), isStarting: false };
    }
    return {
      display: translateText("public_lobby.starting_game"),
      isStarting: true,
    };
  }

  private validateAndJoin(
    lobby: PublicGameInfo,
    entryPoint: "quick_play" | "lobby_card",
  ) {
    if (!this.validateUsername()) return;

    trackAnalyticsEvent("play_intent", {
      entry_point: entryPoint,
      public_game_type: lobby.publicGameType,
      map: lobby.gameConfig?.gameMap,
    });

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          entryPoint,
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private getLobbyTitle(lobby: PublicGameInfo): string {
    const config = lobby.gameConfig!;
    if (config.gameMode === GameMode.FFA) {
      return translateText("game_mode.ffa");
    }

    if (config?.gameMode === GameMode.Team) {
      const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
      const formatTeamsOf = (
        teamCount: number | undefined,
        playersPerTeam: number | undefined,
        label?: string,
      ) => {
        if (!teamCount)
          return label ?? translateText("mode_selector.teams_title");
        const baseTitle = playersPerTeam
          ? translateText("mode_selector.teams_of", {
              teamCount: String(teamCount),
              playersPerTeam: String(playersPerTeam),
            })
          : translateText("mode_selector.teams_count", {
              teamCount: String(teamCount),
            });
        return `${baseTitle}${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 2)
            : undefined;
          return formatTeamsOf(teamCount, 2);
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 3)
            : undefined;
          return formatTeamsOf(teamCount, 3);
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 4)
            : undefined;
          return formatTeamsOf(teamCount, 4);
        }
        case HumansVsNations: {
          const humanSlots = config.maxPlayers ?? lobby.numClients;
          return humanSlots
            ? translateText("public_lobby.teams_hvn_detailed", {
                num: String(humanSlots),
              })
            : translateText("public_lobby.teams_hvn");
        }
        default:
          if (typeof config.playerTeams === "number") {
            const teamCount = config.playerTeams;
            const playersPerTeam =
              totalPlayers && teamCount > 0
                ? Math.floor(totalPlayers / teamCount)
                : undefined;
            return formatTeamsOf(teamCount, playersPerTeam);
          }
      }
    }

    return "";
  }
}
