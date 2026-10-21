import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderTroops, translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { Controller } from "../../Controller";
import { GoToPlayerEvent } from "../../TransformHandler";
import { formatPercentage, renderNumber } from "../../Utils";
import { GameView, PlayerView } from "../../view";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  renown: string;
  // M5 — true for the highest-threat player (glowing-red threat leader).
  isThreatLeader: boolean;
  // Primal-meta — true while this player is running a Great Work ritual
  // (public information: rituals are raidable, so the board flags the target).
  isGreatWorking: boolean;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
  player: PlayerView;
}

@customElement("leader-board")
export class Leaderboard extends LitElement implements Controller {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  players: Entry[] = [];

  @property({ type: Boolean }) visible = false;
  private showTopFive = true;
  // Compact by default: rank / player / owned only. The expand toggle reveals
  // the full stats matrix (gold / max troops / renown) plus every player —
  // the spreadsheet is opt-in, not the minute-zero default (2026-07-02 UX).
  @state()
  private compact = true;

  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" | "renown" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  // threatScore must clear this bar before a player is the "threat leader".
  private static readonly THREAT_LEADER_THRESHOLD = 0.6;

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {}

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("visible") && this.visible) {
      this.updateLeaderboard();
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this.visible) return;
    this.updateLeaderboard();
  }

  private setSort(key: "tiles" | "gold" | "maxtroops" | "renown") {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateLeaderboard();
  }

  private updateLeaderboard() {
    if (this.game === null) throw new Error("Not initialized");
    const myPlayer = this.game.myPlayer();

    let sorted = this.game.playerViews();

    const compare = (a: number, b: number) =>
      this._sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);

    switch (this._sortKey) {
      case "gold":
        sorted = sorted.sort((a, b) =>
          compare(Number(a.gold()), Number(b.gold())),
        );
        break;
      case "maxtroops":
        sorted = sorted.sort((a, b) => compare(maxTroops(a), maxTroops(b)));
        break;
      case "renown":
        sorted = sorted.sort((a, b) => compare(a.renown(), b.renown()));
        break;
      default:
        sorted = sorted.sort((a, b) =>
          compare(a.numTilesOwned(), b.numTilesOwned()),
        );
    }

    // M5 — highest-threat living player over the threshold is the threat leader.
    let threatLeader: PlayerView | null = null;
    let bestThreat = Leaderboard.THREAT_LEADER_THRESHOLD;
    for (const p of this.game.playerViews()) {
      if (!p.isAlive()) continue;
      const t = p.threatScore();
      if (t >= bestThreat) {
        bestThreat = t;
        threatLeader = p;
      }
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    const alivePlayers = sorted.filter((player) => player.isAlive());
    const playersToShow = this.showTopFive
      ? alivePlayers.slice(0, 5)
      : alivePlayers;

    this.players = playersToShow.map((player, index) => {
      const maxTroops = this.game!.config().maxTroops(player);
      return {
        name: player.displayName(),
        position: index + 1,
        score: formatPercentage(
          player.numTilesOwned() / numTilesWithoutFallout,
        ),
        gold: renderNumber(player.gold()),
        maxTroops: renderTroops(maxTroops),
        renown: renderNumber(player.renown()),
        isThreatLeader: player === threatLeader,
        isGreatWorking: player.greatWork() !== null,
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        player: player,
      };
    });

    if (
      myPlayer !== null &&
      this.players.find((p) => p.isMyPlayer) === undefined
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p === myPlayer) {
          break;
        }
      }

      if (myPlayer.isAlive()) {
        const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
        this.players.pop();
        this.players.push({
          name: myPlayer.displayName(),
          position: place,
          score: formatPercentage(
            myPlayer.numTilesOwned() / this.game.numLandTiles(),
          ),
          gold: renderNumber(myPlayer.gold()),
          maxTroops: renderTroops(myPlayerMaxTroops),
          renown: renderNumber(myPlayer.renown()),
          isThreatLeader: myPlayer === threatLeader,
          isGreatWorking: myPlayer.greatWork() !== null,
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
    }

    this.requestUpdate();
  }

  private handleRowClickPlayer(player: PlayerView) {
    if (this.eventBus === null) return;
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  render() {
    if (!this.visible) {
      return html``;
    }
    return html`
      <div
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh] mt-2 ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="grid bg-surface-1/85 border border-hairline w-full text-xs md:text-xs lg:text-sm rounded-lg overflow-hidden"
          style="grid-template-columns: ${this.compact
            ? "minmax(24px, 30px) minmax(90px, 160px) minmax(50px, 80px)"
            : "minmax(24px, 30px) minmax(60px, 100px) minmax(45px, 70px) minmax(40px, 55px) minmax(55px, 105px) minmax(45px, 70px)"};"
        >
          <div
            class="contents font-bold [&>div]:bg-surface-2/70 [&>div]:text-text-dim [&>div]:uppercase [&>div]:tracking-wider [&>div]:text-[0.72rem]"
          >
            <div class="py-1 md:py-2 text-center border-b border-hairline">
              #
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-hairline truncate"
            >
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-hairline cursor-pointer whitespace-nowrap truncate"
              @click=${() => this.setSort("tiles")}
            >
              ${translateText("leaderboard.owned")}
              ${this._sortKey === "tiles"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
            ${this.compact
              ? ""
              : html` <div
                    class="py-1 md:py-2 text-center border-b border-hairline cursor-pointer whitespace-nowrap truncate"
                    @click=${() => this.setSort("gold")}
                  >
                    ${translateText("leaderboard.gold")}
                    ${this._sortKey === "gold"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="py-1 md:py-2 text-center border-b border-hairline cursor-pointer whitespace-nowrap truncate"
                    @click=${() => this.setSort("maxtroops")}
                  >
                    ${translateText("leaderboard.maxtroops")}
                    ${this._sortKey === "maxtroops"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="py-1 md:py-2 text-center border-b border-hairline cursor-pointer whitespace-nowrap truncate"
                    @click=${() => this.setSort("renown")}
                  >
                    ${translateText("leaderboard.renown")}
                    ${this._sortKey === "renown"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>`}
          </div>

          ${repeat(
            this.players,
            (p) => p.player.id(),
            (player, index) => html`
              <div
                class="contents [&>div]:hover:bg-surface-2/60 ${player.isMyPlayer
                  ? "[&>div]:bg-age-accent/15 [&>div]:text-text font-bold [&>div]:!border-age-accent/40"
                  : ""} ${player.isOnSameTeam
                  ? "font-semibold"
                  : ""} ${player.isThreatLeader
                  ? "[&>div]:bg-loss/15 [&>div]:text-loss"
                  : ""} cursor-pointer"
                @click=${() => this.handleRowClickPlayer(player.player)}
              >
                <div
                  class="tc-num py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-hairline"
                    : ""}"
                >
                  ${player.position}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-hairline"
                    : ""} truncate"
                >
                  ${player.isThreatLeader ? "☠ " : ""}${player.isGreatWorking
                    ? html`<span
                        class="tc-gw-marker"
                        title=${translateText("leaderboard.great_work_marker")}
                        >⚒
                      </span>`
                    : ""}${player.name}
                </div>
                <div
                  class="tc-num py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-hairline"
                    : ""}"
                >
                  ${player.score}
                </div>
                ${this.compact
                  ? ""
                  : html` <div
                        class="tc-num py-1 md:py-2 text-center ${index <
                        this.players.length - 1
                          ? "border-b border-hairline"
                          : ""}"
                      >
                        ${player.gold}
                      </div>
                      <div
                        class="tc-num py-1 md:py-2 text-center ${index <
                        this.players.length - 1
                          ? "border-b border-hairline"
                          : ""}"
                      >
                        ${player.maxTroops}
                      </div>
                      <div
                        class="tc-num py-1 md:py-2 text-center ${index <
                        this.players.length - 1
                          ? "border-b border-hairline"
                          : ""}"
                      >
                        ${player.renown}
                      </div>`}
              </div>
            `,
          )}
        </div>
      </div>

      <button
        class="mt-2 p-0.5 px-1.5 md:px-2 text-xs md:text-xs lg:text-sm
        border rounded-md border-hairline hover:border-hairline-strong transition-colors
        text-text mx-auto block hover:bg-surface-2/60 bg-surface-2/40"
        @click=${() => {
          this.compact = !this.compact;
          this.showTopFive = this.compact;
          this.updateLeaderboard();
        }}
      >
        ${this.compact ? "+" : "−"}
      </button>
    `;
  }
}
