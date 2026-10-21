import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { GameMode, Team } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { themeProvider } from "../../theme/ThemeProvider";
import { getTranslatedPlayerTeamLabel, translateText } from "../../Utils";
import { GameView } from "../../view";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
const leaderboardRegularIcon = assetUrl(
  "images/LeaderboardIconRegularWhite.svg",
);
const leaderboardSolidIcon = assetUrl("images/LeaderboardIconSolidWhite.svg");
const teamRegularIcon = assetUrl("images/TeamIconRegularWhite.svg");
const teamSolidIcon = assetUrl("images/TeamIconSolidWhite.svg");

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Controller {
  @state()
  private isLeaderboardShow = false;
  @state()
  private isTeamLeaderboardShow = false;
  @state()
  private isVisible = false;
  @state()
  private isPlayerTeamLabelVisible = false;
  @state()
  private playerTeam: Team | null = null;
  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;

  private playerColor: Colord = new Colord("#FFFFFF");
  public game: GameView;
  public eventBus: EventBus;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    this.requestUpdate();
  }

  tick() {
    if (!this.playerTeam && this.game.myPlayer()?.team()) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = themeProvider.current().teamColor(this.playerTeam);
        this.requestUpdate();
      }
    }

    if (!this.game.inSpawnPhase() && this.isPlayerTeamLabelVisible) {
      this.isPlayerTeamLabelVisible = false;
      this.requestUpdate();
    }
  }

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private toggleLeaderboard(): void {
    this.isLeaderboardShow = !this.isLeaderboardShow;
  }

  private toggleTeamLeaderboard(): void {
    this.isTeamLeaderboardShow = !this.isTeamLeaderboardShow;
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  render() {
    return html`
      <aside
        class=${`tc-hud-dock fixed top-0 min-[1200px]:top-4 left-0 min-[1200px]:left-4 z-900 flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 min-[1200px]:rounded-lg rounded-br-lg ${this.isLeaderboardShow || this.isTeamLeaderboardShow ? "max-[400px]:w-full max-[400px]:rounded-none" : ""} transition-all duration-300 ease-out transform ${
          this.isVisible ? "translate-x-0" : "hidden"
        }`}
        style="margin-top: ${this.barOffset}px;"
      >
        <div class="flex items-center gap-2 text-text">
          <button
            type="button"
            class="tc-hud-icon-btn"
            @click=${this.toggleLeaderboard}
            aria-label=${translateText("help_modal.ui_leaderboard")}
            title=${translateText("help_modal.ui_leaderboard")}
            aria-expanded=${this.isLeaderboardShow ? "true" : "false"}
          >
            <img
              src=${this.isLeaderboardShow
                ? leaderboardSolidIcon
                : leaderboardRegularIcon}
              alt=${translateText("help_modal.icon_alt_player_leaderboard") ||
              "Player Leaderboard Icon"}
              width="20"
              height="20"
            />
          </button>
          ${this.isTeamGame
            ? html`
                <button
                  type="button"
                  class="tc-hud-icon-btn"
                  @click=${this.toggleTeamLeaderboard}
                  aria-label=${translateText(
                    "help_modal.icon_alt_team_leaderboard",
                  )}
                  title=${translateText("help_modal.icon_alt_team_leaderboard")}
                  aria-expanded=${this.isTeamLeaderboardShow ? "true" : "false"}
                >
                  <img
                    src=${this.isTeamLeaderboardShow
                      ? teamSolidIcon
                      : teamRegularIcon}
                    alt=${translateText(
                      "help_modal.icon_alt_team_leaderboard",
                    ) || "Team Leaderboard Icon"}
                    width="20"
                    height="20"
                  />
                </button>
              `
            : null}
          ${this.isLeaderboardShow || this.isTeamLeaderboardShow
            ? html`<span
                class="ml-auto text-[11px] text-slate-400 select-all leading-none self-start"
                title=${translateText("help_modal.game_id_tooltip")}
                >#${this.game?.gameID() ?? ""}</span
              >`
            : null}
        </div>
        ${this.isPlayerTeamLabelVisible
          ? html`
              <div
                class="flex items-center w-full text-white mt-2"
                @contextmenu=${(e: Event) => e.preventDefault()}
              >
                ${translateText("help_modal.ui_your_team")}
                <span
                  style="--color: ${this.playerColor.toRgbString()}"
                  class="text-(--color)"
                >
                  &nbsp;${getTranslatedPlayerTeamLabel(this.playerTeam)}
                  &#10687;
                </span>
              </div>
            `
          : null}
        <div
          class=${`block lg:flex flex-wrap overflow-x-auto min-w-0 w-full ${this.isLeaderboardShow && this.isTeamLeaderboardShow ? "gap-2" : ""}`}
        >
          <leader-board .visible=${this.isLeaderboardShow}></leader-board>
          <team-stats
            class="flex-1"
            .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
          ></team-stats>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}
