import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameMapSize, GameType, RankedType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { getUserMe } from "../../Api";
import "../../components/CosmeticButton";
import { Controller } from "../../Controller";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
} from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { buildChallengeUrl } from "../../HomeChallenge";
import { Platform } from "../../Platform";
import { SendWinnerEvent } from "../../Transport";
import { getMapName } from "../../Utils";
import { GameView } from "../../view";
import {
  computeMatchOutcome,
  formatDuration,
  formatShareText,
  formatTiles,
  MatchOutcome,
  prefersNativeShare,
  TICKS_PER_SECOND,
} from "./MatchResult";

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;

  @state()
  isVisible = false;

  @state()
  showButtons = false;

  @state()
  private isWin = false;

  @state()
  private isRankedGame = false;

  @state()
  private isSinglePlayer = false;

  @state()
  private patternContent: TemplateResult | null = null;

  @state()
  private outcome: MatchOutcome | null = null;

  @state()
  private copied = false;

  // Territory is read every tick because the final count is usually zero: a
  // player who was conquered owns nothing at the moment the modal opens, and
  // "0 tiles" is not the match they played.
  private peakTiles = 0;
  private spawnTick: number | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  private _title: string;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    return html`
      ${this.isVisible
        ? html`<div class="win-modal-backdrop" aria-hidden="true"></div>`
        : ""}
      <div
        class="${this.isVisible
          ? `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-6 shrink-0 rounded-lg z-[10010] text-white w-87.5 max-w-[90%] md:w-175 win-modal-enter ${
              this.isWin ? "win-modal--win" : "win-modal--lose"
            }`
          : "hidden"}"
      >
        <div class="win-modal-kicker">
          ${translateText(
            this.isWin ? "win_modal.victory_label" : "win_modal.defeat_label",
          )}
        </div>
        <h2 class="m-0 mb-4 text-[26px] text-center text-white">
          ${this._title || ""}
        </h2>
        ${this.renderResultSummary()} ${this.renderResultStrip()}
        ${this.innerHtml()}
        <div class="${this.showButtons ? "flex flex-col gap-2.5" : "hidden"}">
          <o-button
            variant="primary"
            width="block"
            class="win-modal-share ${this.copied ? "is-copied" : ""}"
            .title=${this.copied
              ? translateText("win_modal.copied")
              : translateText("win_modal.share")}
            @click=${this._handleShare}
          ></o-button>
          <div class="grid grid-cols-2 gap-2.5 md:flex md:justify-between">
            <o-button
              variant="secondary"
              width="block"
              class="flex-1"
              translationKey="win_modal.exit"
              @click=${this._handleExit}
            ></o-button>
            ${this.canPlayAgain()
              ? html`
                  <o-button
                    variant="secondary"
                    width="block"
                    class="flex-1"
                    translationKey="win_modal.requeue"
                    @click=${this._handleRequeue}
                  ></o-button>
                `
              : null}
            ${this.canPractice()
              ? html`
                  <o-button
                    variant="secondary"
                    width="block"
                    class="flex-1"
                    translationKey="win_modal.practice"
                    @click=${this._handlePractice}
                  ></o-button>
                `
              : null}
            ${this.isSinglePlayer
              ? html`
                  <o-button
                    variant="secondary"
                    width="block"
                    class="flex-1 win-modal-friends"
                    translationKey="win_modal.play_with_friend"
                    @click=${this._handlePlayWithFriend}
                  ></o-button>
                `
              : null}
            <o-button
              variant="secondary"
              width="block"
              class="flex-1"
              .title=${this.game?.myPlayer()?.isAlive()
                ? translateText("win_modal.keep")
                : translateText("win_modal.spectate")}
              @click=${this.hide}
            ></o-button>
          </div>
        </div>
      </div>
    `;
  }

  innerHtml() {
    return this.renderPatternButton();
  }

  /**
   * The four numbers a player would actually repeat. Peak territory rather than
   * final, because a conquered player owns nothing by the time this opens.
   */
  private renderResultStrip(): TemplateResult | null {
    const outcome = this.outcome;
    if (outcome === null) return null;
    const stats: Array<[string, string]> = [
      [translateText("win_modal.stat_era"), outcome.eraNumeral],
      [
        translateText("win_modal.stat_territory"),
        formatTiles(outcome.peakTiles),
      ],
    ];
    // Same rule as the share line: a zero here reads as a failure the player
    // did not have, so the strip shows three stats instead of four.
    if (outcome.outlasted > 0) {
      stats.push([
        translateText("win_modal.stat_outlasted"),
        translateText("win_modal.stat_outlasted_value", {
          outlasted: String(outcome.outlasted),
          rivals: String(outcome.rivals),
        }),
      ]);
    }
    stats.push([
      translateText("win_modal.stat_survived"),
      formatDuration(outcome.survivedTicks),
    ]);
    return html`
      <div class="win-modal-stats">
        ${stats.map(
          ([label, value]) => html`
            <div class="win-stat">
              <div class="win-stat__value num">${value}</div>
              <div class="win-stat__label">${label}</div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderResultSummary(): TemplateResult | null {
    const outcome = this.outcome;
    if (outcome === null) return null;
    return html`
      <p class="win-modal-summary">
        ${translateText(
          outcome.won
            ? "win_modal.result_summary_win"
            : "win_modal.result_summary_loss",
          {
            era: outcome.eraNumeral,
            tiles: formatTiles(outcome.peakTiles),
          },
        )}
      </p>
    `;
  }

  renderPatternButton() {
    // A store block with nothing in it is worse than no store block: on builds
    // without a cosmetics backend this rendered "Support Primalfront!" over an
    // empty box at the emotional peak of the match.
    if (this.patternContent === null) return null;
    return html`
      <div class="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 class="text-xl font-semibold text-white mb-3">
          ${translateText("win_modal.support_primalfront")}
        </h3>
        <p class="text-white mb-3">
          ${translateText("win_modal.territory_pattern")}
        </p>
        <div class="flex justify-center">${this.patternContent}</div>
      </div>
    `;
  }

  async loadPatternContent() {
    const me = await getUserMe();
    const cosmetics = await fetchCosmetics();

    const purchasable = resolveCosmetics(cosmetics, me, null).filter(
      (r) => r.type === "pattern" && r.relationship === "purchasable",
    );

    if (purchasable.length === 0) {
      this.patternContent = null;
      return;
    }

    // Shuffle the array and take patterns based on screen size
    const shuffled = [...purchasable].sort(() => Math.random() - 0.5);
    const maxPatterns = Platform.isMobileWidth ? 1 : 3;
    const selected = shuffled.slice(0, Math.min(maxPatterns, shuffled.length));

    this.patternContent = html`
      <div class="flex gap-4 flex-wrap justify-start">
        ${selected.map(
          (r) => html`
            <cosmetic-button
              .resolved=${r}
              .onPurchase=${purchaseCosmetic}
            ></cosmetic-button>
          `,
        )}
      </div>
    `;
  }

  async show() {
    crazyGamesSDK.gameplayStop();
    await this.loadPatternContent();
    // Check if this is a ranked game
    this.isRankedGame =
      this.game.config().gameConfig().rankedType === RankedType.OneVOne;
    this.isSinglePlayer =
      this.game.config().gameConfig().gameType === GameType.Singleplayer;
    this.captureOutcome(this.isWin);
    this.isVisible = true;
    this.requestUpdate();
    // Long enough that the entrance animation can't be clicked through, short
    // enough that the modal doesn't read as frozen.
    setTimeout(() => {
      this.showButtons = true;
      this.requestUpdate();
    }, 1200);
  }

  /** Freeze the match into the numbers worth showing and sharing. */
  private captureOutcome(won: boolean): void {
    const me = this.game?.myPlayer();
    if (!me) {
      this.outcome = null;
      return;
    }
    this.outcome = computeMatchOutcome(me, this.game.players(), {
      won,
      peakTiles: Math.max(this.peakTiles, me.numTilesOwned()),
      survivedTicks: this.game.ticks() - (this.spawnTick ?? 0),
    });
  }

  /** Only offer a replay where one click can actually start another match. */
  private canPlayAgain(): boolean {
    return this.isRankedGame || this.isSinglePlayer;
  }

  private canPractice(): boolean {
    return !this.isSinglePlayer;
  }

  private async _handleShare() {
    if (this.outcome === null) return;
    const gameConfig = this.game.config().gameConfig();
    const text = formatShareText(this.outcome, getMapName(gameConfig.gameMap));
    // The link carries the result AND the setup, so whoever opens it lands on
    // the score they were sent with a one-tap way to play the same match.
    const url = buildChallengeUrl(window.location.origin, {
      era: this.outcome.era,
      tiles: this.outcome.peakTiles,
      outlasted: this.outcome.outlasted,
      rivals: this.outcome.rivals,
      seconds: Math.floor(this.outcome.survivedTicks / TICKS_PER_SECOND),
      ...(this.isSinglePlayer
        ? {
            map: gameConfig.gameMap,
            difficulty: gameConfig.difficulty,
            compact: gameConfig.gameMapSize === GameMapSize.Compact,
          }
        : {}),
    });
    const nav = navigator as Navigator & {
      share?: (data: {
        title: string;
        text: string;
        url: string;
      }) => Promise<void>;
    };
    const useNativeSheet = prefersNativeShare(
      typeof nav.share === "function",
      (query) => window.matchMedia(query).matches,
    );
    if (useNativeSheet && nav.share !== undefined) {
      try {
        await nav.share({ title: "Primalfront", text, url });
        return;
      } catch (err) {
        // A dismissed share sheet is a decision, not a failure — don't then
        // silently write to their clipboard behind their back.
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      this.markCopied();
    } catch {
      // Clipboard unavailable (insecure context or denied permission). Leave
      // the button labelled as-is rather than claiming a copy that never was.
    }
  }

  private markCopied(): void {
    this.copied = true;
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copied = false;
      this.copiedTimer = null;
    }, 2200);
  }

  hide() {
    this.isVisible = false;
    this.showButtons = false;
    this.requestUpdate();
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  private _handleRequeue() {
    this.hide();
    if (this.isRankedGame) {
      // Navigate to homepage and open matchmaking modal
      window.location.href = "/?requeue";
      return;
    }
    // Practice restarts in one click: single-player is a registered modal route.
    window.location.href = "/#modal=single-player";
  }

  private _handlePractice() {
    this.hide();
    window.location.href = "/#modal=single-player";
  }

  // From a solo match to a private lobby in one tap: the home page opens the
  // host-lobby flow, which creates the lobby and copies the invite link.
  private _handlePlayWithFriend() {
    this.hide();
    window.location.href = "/?friends";
  }

  init() {}

  tick() {
    const myPlayer = this.game.myPlayer();
    if (myPlayer !== null) {
      if (this.spawnTick === null && myPlayer.hasSpawned()) {
        this.spawnTick = this.game.ticks();
      }
      const owned = myPlayer.numTilesOwned();
      if (owned > this.peakTiles) this.peakTiles = owned;
    }
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_team", {
            team: wu.winner[1],
          });
          this.isWin = false;
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
          crazyGamesSDK.happytime();
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.displayName(),
          });
          this.isWin = false;
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }
}
