import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { ClientID } from "../../../core/Schemas";
import { Config } from "../../../core/configuration/Config";
import { biomeSlug } from "../../../core/game/Biome";
import {
  Age,
  GameMode,
  GameType,
  Gold,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendAdvanceAgeIntentEvent,
  SendFormCoalitionIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import {
  getGamesPlayed,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import { ageNames } from "./BuildMenu";
import type {
  DramaCueID,
  DramaCueMeta,
  DramaCueTone,
  DramaSnapshot,
} from "./DramaDirector";
import {
  collectDramaCues,
  dramaCueMeta,
  isRepeatableDramaCue,
} from "./DramaDirector";
import {
  AgeGate,
  ERA_PROFILES,
  EraTriumphStatus,
  ObjectiveRailItem,
  PrimitiveGoldPipeline,
  canAdvanceFromGates,
  chooseObjective,
  computeAgeGates,
  computeEraStanding,
  computeEraTriumphs,
  computePrimitiveGoldPipeline,
  countBuiltUnits,
} from "./ObjectiveRail";
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const soldierIcon = assetUrl("images/SoldierIcon.svg");
const swordIcon = assetUrl("images/SwordIcon.svg");
// Q5 — laurel wreath flanks the "Found a Permanent Settlement" objective so it
// reads as a special prize. Tinted gold via CSS filter (.tc-laurel) since the
// asset ships with a fixed red internal fill that an <img> cannot override.
const laurelIcon = assetUrl("flags/custom/laurel_wreath.svg");

interface HudDramaEvent extends DramaCueMeta {
  id: string;
  cue: DramaCueID;
}

// The era ladder's depth is deliberately NOT surfaced: how many ages exist, and
// how far you are from the last one, is meant to stay unknown. So the era reads
// as a numeral ("Era IV"), never as a fraction of a known total.
const ROMAN = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

function romanNumeral(n: number): string {
  return ROMAN[n] ?? String(n);
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

@customElement("control-panel")
export class ControlPanel extends LitElement implements Controller {
  public game: GameView;
  public clientID: ClientID;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private _maxTroops: number;

  @state()
  private troopRate: number;

  @state()
  private _troops: number;

  @state()
  private _isVisible = false;

  @state()
  private _notification: { type: "warning" | "info"; message: string } | null =
    null;

  @state()
  private _gold: Gold;

  @state()
  private _age: Age = Age.Primitive;

  // Tactical Command "regime change" beat: true for one --dur-age window right
  // after the local player advances an age, driving the HUD age-up flourish.
  @state()
  private _ageUp: boolean = false;
  private _ageUpTimeoutId: ReturnType<typeof setTimeout> | null = null;

  @state()
  private _techPoints: number = 0;

  // Module §4 — one harvested resource pile surfaced beside the tech readout.
  // Wood, rocks, meat, fish and captives all feed this same player-facing pool.
  @state()
  private _resources: number = 0;

  @state()
  private _objective: ObjectiveRailItem | null = null;

  @state()
  private _ageGates: AgeGate[] = [];

  @state()
  private _eraTriumphs: EraTriumphStatus[] = [];

  @state()
  private _transitionCostBps = 10000;

  @state()
  private _transitionRitualSeconds = 0;

  @state()
  private _transitionPenaltySeconds = 0;

  @state()
  private _primitivePipeline: PrimitiveGoldPipeline | null = null;

  @state()
  private _dramaEvents: HudDramaEvent[] = [];

  @state()
  private _ceremony: HudDramaEvent | null = null;
  private _ceremonyTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Primal-meta: my active Great Work (era-advance ritual) + Golden Age flag.
  private _greatWork: {
    targetAge: number;
    progress: number;
    required: number;
  } | null = null;
  private _goldenAge = false;
  // Transient .tc-gw-setback flourish while a raid knockback is fresh.
  private _gwSetback = false;
  private _gwSetbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Whether the era runway's reference copy is expanded. Persisted, defaults
  // closed — see UserSettings.eraDetailsOpen().
  @state()
  private _detailsOpen: boolean = new UserSettings().eraDetailsOpen();

  // Where my era sits against everyone else's, e.g. "Highest" / "3rd highest".
  // This replaces a completion fraction: the ladder's length is a mystery, so
  // the only meaningful reading of "how far along am I" is relative to the
  // table — which is also information worth acting on, unlike "1/8".
  @state()
  private _eraStanding: string | null = null;
  private _eraStandingTick = 0;

  // Next-age cost (null at Modern Age) + whether the player can afford to advance.
  @state()
  private _advanceCost: { gold: bigint; techPoints: number } | null = null;

  @state()
  private _canAdvanceAge: boolean = false;

  // M9 — visible "Advancing" (age-up vulnerability) state for my player.
  @state()
  private _advancing: boolean = false;

  // M4 — overextension / integration-debt "unrest" indicator (0..1).
  @state()
  private _unrest: number = 0;

  // NTH (Module H) — shared Armageddon clock (remaining launches, max budget).
  @state()
  private _armageddonRemaining: number = 0;
  @state()
  private _armageddonMax: number = 0;

  // M5 — the current highest-threat ("threat leader") player, if one stands out.
  @state()
  private _threatLeaderName: string | null = null;
  @state()
  private _threatLeaderID: string | null = null;
  // True when *I* am the threat leader (no Form-Coalition button for myself).
  @state()
  private _isThreatLeader: boolean = false;

  // threatScore must clear this bar before a player is flagged as threat leader.
  private static readonly THREAT_LEADER_THRESHOLD = 0.6;

  @state()
  private _attackingTroops: number = 0;

  @state()
  private _goldGain: bigint | null = null;
  @state()
  private _goldGainPulseId: number = 0;
  private _goldGainTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate: number;

  private _lastDramaSnapshot: DramaSnapshot | null = null;
  private _seenDramaCues: Set<DramaCueID> = new Set();

  // Border detection cache
  private _nearbyPlayerIDs: Set<number> = new Set();
  private _borderRefreshCounter: number = 0;
  private _borderTilesPromise: Promise<void> | null = null;
  // Track last attack tick per target player (for 15-second threshold)
  private _lastAttackTickByTarget: Map<number, number> = new Map();
  private static readonly BORDER_REFRESH_INTERVAL = 10; // recompute every 1s
  private static readonly ATTACK_THRESHOLD_TICKS = 15 * 10; // 15 seconds

  init() {
    this.attackRatio = new UserSettings().attackRatio();
    this.uiState.attackRatio = this.attackRatio;
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio = this.attackRatio + event.attackRatio / 100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });
  }

  tick() {
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    this.updateTroopIncrease();
    this.syncScrollFade();
    this.updateEraStanding(player);

    const config = this.game.config();
    this._maxTroops = config.maxTroops(player);
    this._gold = player.gold();
    this._troops = player.troops();
    this._attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    this.troopRate = config.troopIncreaseRate(player) * 10;

    const prevAge = this._age;
    this._age = player.age();
    // Tactical Command age-accent system: mirror the local player's current
    // age onto the document root so --age-accent (CSS) tracks progression and
    // the HUD recolors at age-up. Numeric index (0..7) matches the
    // :root[data-age="N"] selectors in styles/core/variables.css.
    if (
      document.documentElement.getAttribute("data-age") !== String(this._age)
    ) {
      document.documentElement.setAttribute("data-age", String(this._age));
      // Advancing (not the initial spawn assignment) fires the regime-change
      // flourish: a one-shot accent bloom + age-badge pulse over the dock.
      if (this._age > prevAge) {
        this.triggerAgeUp();
      }
    }
    // Climate-accent system: mirror the local player's dominant biome onto the
    // document root as [data-climate] so the HUD's --climate-accent (CSS)
    // subtly recolors the tactical dock to match the player's terrain/climate
    // (icy / pine / tan / sand / jungle-green). Slug matches the
    // :root[data-climate="..."] selectors in styles/core/variables.css.
    const climate = biomeSlug(player.dominantBiome());
    if (document.documentElement.getAttribute("data-climate") !== climate) {
      document.documentElement.setAttribute("data-climate", climate);
    }
    this._techPoints = Math.floor(player.techPoints());
    this._resources = Math.floor(player.resources());
    this._advanceCost = config.advanceAgeCost(player);
    this._ageGates = computeAgeGates(player, config);
    this._eraTriumphs = computeEraTriumphs(player, config);
    const triumphCount = this._eraTriumphs.filter(
      (triumph) => triumph.complete,
    ).length;
    this._transitionCostBps = config.eraTransitionCostBps(triumphCount);
    this._transitionRitualSeconds =
      this._age >= Age.Alien
        ? 0
        : Math.ceil(config.greatWorkTicks(this._age, triumphCount) / 10);
    this._transitionPenaltySeconds =
      this._age >= Age.Alien
        ? 0
        : Math.ceil(config.advancePenaltyTicks(triumphCount) / 10);
    this._primitivePipeline =
      this._age === Age.Primitive
        ? computePrimitiveGoldPipeline(player, config)
        : null;
    this._objective = chooseObjective(
      player,
      config,
      this._ageGates,
      this._primitivePipeline ?? undefined,
    );
    this._canAdvanceAge = canAdvanceFromGates(this._ageGates);

    // M9 — am I currently in the advance-age vulnerability window?
    this._advancing = player.advancePenaltyActive();

    // Primal-meta — my active Great Work (era-advance ritual) + Golden Age.
    const prevGreatWork = this._greatWork;
    this._greatWork = player.greatWork();
    this._goldenAge = player.goldenAgeActive();
    // One-shot sabotage flourish: progress moved BACKWARD (a raid landed) —
    // flash the ritual chip red so the hit is visible at the HUD, not just
    // in the feed. Mirrors the _ageUp transient-class pattern.
    if (
      prevGreatWork !== null &&
      this._greatWork !== null &&
      this._greatWork.progress < prevGreatWork.progress
    ) {
      this._gwSetback = true;
      if (this._gwSetbackTimeoutId !== null) {
        clearTimeout(this._gwSetbackTimeoutId);
      }
      this._gwSetbackTimeoutId = setTimeout(() => {
        this._gwSetback = false;
        this._gwSetbackTimeoutId = null;
        this.requestUpdate();
      }, 700);
    }

    // M4 — integration debt is on a 0..capacity scale (capacity is 50+), so we
    // scale by overextensionCapacity before clamping; otherwise a single tile of
    // debt pegs the "unrest" reading at 100%. Reads 0 with no debt and only
    // climbs as the player overextends past their administrative capacity.
    this._unrest = Math.max(
      0,
      Math.min(
        1,
        player.integrationDebt() /
          Math.max(1, config.overextensionCapacity(player)),
      ),
    );
    // Module H — shared Armageddon clock.
    this._armageddonRemaining = this.game.armageddonRemaining();
    this._armageddonMax = config.armageddonBudget();

    // M5 — find the highest-threat living player above the threshold.
    this.updateThreatLeader(player);
    this.updateDramaFeed(player);

    const helpEnabled = new UserSettings().helpMessages();

    // Don't target veteran players
    if (helpEnabled && getGamesPlayed() < 20) {
      // Track outgoing attacks for 15-second threshold
      this.trackOutgoingAttacks(player);

      // Refresh border detection cache periodically
      this.refreshNearbyPlayers(player);

      // Compute notification
      this._notification = this.computeNotification(player, config);
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      const myID = player.id();
      const bonusEvents = updates[GameUpdateType.BonusEvent];
      if (bonusEvents) {
        for (const ev of bonusEvents) {
          if (ev.player === myID && ev.gold > 0) {
            this.addGoldGain(BigInt(ev.gold));
          }
        }
      }
      const conquestEvents = updates[GameUpdateType.ConquestEvent];
      if (conquestEvents) {
        for (const ev of conquestEvents) {
          if (ev.conquerorId === myID && ev.gold > 0n) {
            this.addGoldGain(ev.gold);
          }
        }
      }
      const donateEvents = updates[GameUpdateType.DonateEvent];
      if (donateEvents) {
        for (const ev of donateEvents) {
          if (
            ev.donationType === "gold" &&
            ev.recipientId === myID &&
            ev.amount > 0n
          ) {
            this.addGoldGain(ev.amount);
          }
        }
      }
    }

    this.requestUpdate();
  }

  // Last-wins: when multiple gold events arrive in one tick, the pip shows
  // only the most recent amount (not a sum) — each gain restarts the pulse.
  private addGoldGain(amount: bigint) {
    this._goldGain = amount;
    this._goldGainPulseId++;
    if (this._goldGainTimeoutId !== null) {
      clearTimeout(this._goldGainTimeoutId);
    }
    this._goldGainTimeoutId = setTimeout(() => {
      this._goldGain = null;
      this._goldGainTimeoutId = null;
      this.requestUpdate();
    }, 2000);
  }

  private trackOutgoingAttacks(player: PlayerView) {
    const currentTick = this.game.ticks();
    for (const attack of player.outgoingAttacks()) {
      if (attack.targetID !== 0 && !attack.retreating) {
        this._lastAttackTickByTarget.set(attack.targetID, currentTick);
      }
    }
    // Clean up old entries
    for (const [playerID, tick] of this._lastAttackTickByTarget.entries()) {
      if (currentTick - tick > ControlPanel.ATTACK_THRESHOLD_TICKS * 2) {
        this._lastAttackTickByTarget.delete(playerID);
      }
    }
  }

  private refreshNearbyPlayers(player: PlayerView) {
    this._borderRefreshCounter++;
    if (
      this._borderRefreshCounter < ControlPanel.BORDER_REFRESH_INTERVAL ||
      this._borderTilesPromise !== null
    ) {
      return;
    }
    this._borderRefreshCounter = 0;
    this._borderTilesPromise = player.borderTiles().then((bt) => {
      this._borderTilesPromise = null;
      const myID = player.smallID();
      const nearby = new Set<number>();
      for (const tile of bt.borderTiles) {
        for (const neighbor of this.game.neighbors(tile as TileRef)) {
          const ownerID = this.game.ownerID(neighbor);
          if (ownerID !== 0 && ownerID !== myID) {
            nearby.add(ownerID);
          }
        }
      }
      this._nearbyPlayerIDs = nearby;
    });
  }

  private computeNotification(
    player: PlayerView,
    config: Config,
  ): { type: "warning" | "info"; message: string } | null {
    const currentTick = this.game.ticks();

    // Army limit warning
    const { gameMode, gameType } = config.gameConfig();
    const isPublicTeamGame =
      gameMode === GameMode.Team && gameType === GameType.Public;
    const canDonateTroops = config.donateTroops();
    if (isPublicTeamGame && canDonateTroops) {
      const ratio = this._troops / Math.max(this._maxTroops, 1);
      if (ratio >= config.armyLimitWarningThreshold()) {
        return {
          type: "warning",
          message: "control_panel.army_limit_warning",
        };
      }
    }

    // Low troops (Less than 1k) warning
    if (this._troops < 10000 && this._troops > 0) {
      return { type: "warning", message: "control_panel.low_troops_warning" };
    }

    // Info messages: check nearby players for traitors, AFK allies, AFK teammates
    for (const nearbyID of this._nearbyPlayerIDs) {
      let other;
      try {
        other = this.game.playerBySmallID(nearbyID);
      } catch {
        continue;
      }
      if (!other.isPlayer() || !other.isAlive()) continue;

      const lastAttackTick = this._lastAttackTickByTarget.get(nearbyID) ?? -1;
      const secondsSinceAttack = (currentTick - lastAttackTick) / 10;
      const hasNotAttackedRecently =
        lastAttackTick < 0 || secondsSinceAttack > 15;

      if (!hasNotAttackedRecently) continue;

      if (other.isTraitor() && player.isAlliedWith(other)) {
        return { type: "info", message: "control_panel.traitor_neighbor_info" };
      }
      if (other.isDisconnected() && player.isAlliedWith(other)) {
        return {
          type: "info",
          message: "control_panel.allied_afk_neighbor_info",
        };
      }
      if (other.isDisconnected() && player.isOnSameTeam(other)) {
        return {
          type: "info",
          message: "control_panel.teammate_afk_neighbor_info",
        };
      }
    }

    return null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("scroll", this.onPanelScroll);
    // Revert to the neutral menu accent when leaving the game.
    document.documentElement.removeAttribute("data-age");
    document.documentElement.removeAttribute("data-climate");
    if (this._goldGainTimeoutId !== null) {
      clearTimeout(this._goldGainTimeoutId);
      this._goldGainTimeoutId = null;
    }
    if (this._ageUpTimeoutId !== null) {
      clearTimeout(this._ageUpTimeoutId);
      this._ageUpTimeoutId = null;
    }
    if (this._ceremonyTimeoutId !== null) {
      clearTimeout(this._ceremonyTimeoutId);
      this._ceremonyTimeoutId = null;
    }
    if (this._gwSetbackTimeoutId !== null) {
      clearTimeout(this._gwSetbackTimeoutId);
      this._gwSetbackTimeoutId = null;
    }
  }

  private updateTroopIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const troopIncreaseRate = this.game.config().troopIncreaseRate(player);
    this._troopRateIsIncreasing =
      troopIncreaseRate >= this._lastTroopIncreaseRate;
    this._lastTroopIncreaseRate = troopIncreaseRate;
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  // One-shot age-up flourish: set _ageUp so the dock gets .tc-age-up (radial
  // accent bloom + badge pulse), then clear it after the age-transition window.
  private triggerAgeUp() {
    this._ageUp = true;
    if (this._ageUpTimeoutId !== null) {
      clearTimeout(this._ageUpTimeoutId);
    }
    this._ageUpTimeoutId = setTimeout(() => {
      this._ageUp = false;
      this._ageUpTimeoutId = null;
      this.requestUpdate();
    }, 650);
  }

  private onAdvanceAge() {
    if (!this._canAdvanceAge) return;
    this.eventBus.emit(new SendAdvanceAgeIntentEvent());
  }

  // M5 — pick the living player with the highest threatScore over the
  // threshold; that player is glowing-red "threat leader" the table can
  // coalition against.
  private updateThreatLeader(myPlayer: PlayerView) {
    if (!this.canRespondToThreat(myPlayer)) {
      this.clearThreatLeader();
      return;
    }

    let leader: PlayerView | null = null;
    let best = ControlPanel.THREAT_LEADER_THRESHOLD;
    for (const p of this.game.playerViews()) {
      if (!p.isAlive()) continue;
      const t = p.threatScore();
      if (t >= best) {
        best = t;
        leader = p;
      }
    }
    if (leader === null) {
      this.clearThreatLeader();
      return;
    }
    this._threatLeaderName = leader.displayName();
    this._threatLeaderID = leader.id();
    this._isThreatLeader = leader === myPlayer;
  }

  private canRespondToThreat(player: PlayerView): boolean {
    return (
      player.age() > Age.Primitive ||
      this._canAdvanceAge ||
      countBuiltUnits(player, UnitType.City) > 0 ||
      countBuiltUnits(player, UnitType.PrimitiveFarm) > 0 ||
      countBuiltUnits(player, UnitType.TradeOutpost) > 0 ||
      (this._primitivePipeline?.totalGoldPerSecond ?? 0n) > 0n
    );
  }

  private clearThreatLeader() {
    this._threatLeaderName = null;
    this._threatLeaderID = null;
    this._isThreatLeader = false;
  }

  private updateDramaFeed(player: PlayerView) {
    const snapshot = this.createDramaSnapshot(player);
    const cues = collectDramaCues(
      this._lastDramaSnapshot,
      snapshot,
      this._seenDramaCues,
    );
    for (const cue of cues) {
      if (!isRepeatableDramaCue(cue)) {
        this._seenDramaCues.add(cue);
      }
      this.addDramaCue(cue);
    }
    this._lastDramaSnapshot = snapshot;
  }

  private createDramaSnapshot(player: PlayerView): DramaSnapshot {
    return {
      age: player.age(),
      canAdvanceAge: this._canAdvanceAge,
      cityCount: countBuiltUnits(player, UnitType.City),
      farmCount: countBuiltUnits(player, UnitType.PrimitiveFarm),
      outpostCount: countBuiltUnits(player, UnitType.TradeOutpost),
      pipelineGoldPerSecond: this._primitivePipeline?.totalGoldPerSecond ?? 0n,
      threatLeaderID: this._threatLeaderID,
      isThreatLeader: this._isThreatLeader,
    };
  }

  private addDramaCue(cue: DramaCueID) {
    const meta = dramaCueMeta(cue);
    const event: HudDramaEvent = {
      ...meta,
      cue,
      id: `${cue}-${this.game.ticks()}-${this._dramaEvents.length}`,
    };
    this._dramaEvents = [
      event,
      ...this._dramaEvents.filter((drama) => drama.cue !== cue),
    ].slice(0, 3);

    if (cue === "age_up" || cue === "age_ready" || cue === "first_city") {
      this.showCeremony(event);
    }
  }

  private showCeremony(event: HudDramaEvent) {
    this._ceremony = event;
    if (this._ceremonyTimeoutId !== null) {
      clearTimeout(this._ceremonyTimeoutId);
    }
    this._ceremonyTimeoutId = setTimeout(() => {
      this._ceremony = null;
      this._ceremonyTimeoutId = null;
      this.requestUpdate();
    }, 2400);
  }

  private onFormCoalition() {
    if (this._threatLeaderID === null || this._isThreatLeader) return;
    this.eventBus.emit(new SendFormCoalitionIntentEvent(this._threatLeaderID));
  }

  private toneClass(tone: DramaCueTone): string {
    switch (tone) {
      case "age":
        return "border-age-accent/60 bg-age-accent/15 text-age-accent";
      case "danger":
        return "border-red-500/70 bg-red-500/15 text-red-300";
      case "economy":
        return "border-gain/60 bg-gain/10 text-gain";
      case "settlement":
        return "border-amber-400/70 bg-amber-400/10 text-amber-300";
    }
  }

  private renderCeremony() {
    if (this._ceremony === null) {
      return html``;
    }
    // One line, not a three-line card: the icon already says "drama", so the
    // "DRAMA" kicker above the title was a label captioning a label, and the
    // detail sentence is flavour — both move to the tooltip. This box sits over
    // the battlefield; a ceremony must not cost three rows of map.
    return html`
      <div
        class="mb-1 flex items-center gap-2 rounded-md border px-2 py-1 ${this.toneClass(
          this._ceremony.tone,
        )}"
        title=${translateText(this._ceremony.detailKey)}
        translate="no"
      >
        <span class="shrink-0 text-sm font-black leading-4"
          >${this._ceremony.icon}</span
        >
        <div class="min-w-0 truncate text-sm font-extrabold text-text-hi">
          ${translateText(this._ceremony.titleKey)}
        </div>
      </div>
    `;
  }

  private renderDramaFeed() {
    if (
      this._dramaEvents.length === 0 ||
      this._objective?.id === "find_resources"
    ) {
      return html``;
    }
    return html`
      <div
        class="tc-drama-feed mt-1 grid gap-1"
        aria-live="polite"
        translate="no"
      >
        ${this._dramaEvents.slice(0, 1).map(
          (event) => html`
            <div
              class="tc-drama-item flex items-center gap-1.5 rounded-md border px-2 py-1 ${this.toneClass(
                event.tone,
              )}"
              title=${translateText(event.detailKey)}
            >
              <span class="shrink-0 text-sm font-black leading-4"
                >${event.icon}</span
              >
              <div class="min-w-0 truncate text-xs font-bold text-text-hi">
                ${translateText(event.titleKey)}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  // M5 + M4 + M9 + Module H telegraphing row: threat leader / coalition,
  // unrest indicator, advancing state, and the Armageddon clock.
  private renderTelegraphRow() {
    const hasLeader = this._threatLeaderID !== null;
    const showUnrest = this._unrest > 0.01;
    // Module H: only surface the shared doomsday clock once WMDs are actually
    // in play. WMDs (Atom/Hydrogen bomb, MIRV, Missile Silo) are minAge: Modern,
    // so before any player reaches the Modern age nobody can launch and the
    // "12/12" badge is meaningless noise from the Stone Age on. Reveal it when
    // this player reaches Modern (nukes become buildable) OR once any launch has
    // already burned the shared budget (so a pre-Modern player still sees MAD
    // closing in). armageddonRemaining only ever decreases, so once shown it stays.
    const showArmageddon =
      this._armageddonMax > 0 &&
      (this._age >= Age.Modern ||
        this._armageddonRemaining < this._armageddonMax);
    if (!hasLeader && !showUnrest && !this._advancing && !showArmageddon) {
      return html``;
    }
    return html`
      <div class="flex items-center flex-wrap gap-1.5 mt-1" translate="no">
        ${this._advancing
          ? html`<span
              class="flex items-center gap-1 shrink-0 border border-purple-400/70 rounded-md text-purple-300 font-bold text-xs py-0.5 px-1.5 animate-pulse"
              title=${translateText("control_panel.advancing_tooltip")}
              >⏫ ${translateText("control_panel.advancing")}</span
            >`
          : ""}
        ${showUnrest
          ? html`<span
              class="flex items-center gap-1 shrink-0 border border-orange-400/70 rounded-md text-orange-300 font-bold text-xs py-0.5 px-1.5"
              title=${translateText("control_panel.unrest_tooltip")}
              >🔥 ${translateText("control_panel.unrest")}
              ${Math.round(this._unrest * 100)}%</span
            >`
          : ""}
        ${showArmageddon
          ? html`<span
              class="flex items-center gap-1 shrink-0 border rounded-md font-bold text-xs py-0.5 px-1.5 ${this
                ._armageddonRemaining <=
              this._armageddonMax / 3
                ? "border-red-500/80 text-red-400"
                : "border-rose-400/60 text-rose-300"}"
              title=${translateText("control_panel.armageddon_tooltip")}
              >☢ ${translateText("control_panel.armageddon")}
              ${this._armageddonRemaining}/${this._armageddonMax}</span
            >`
          : ""}
        ${hasLeader
          ? this._isThreatLeader
            ? html`<span
                class="flex items-center gap-1 shrink-0 text-red-400 font-bold text-xs"
                title=${translateText("control_panel.threat_leader")}
                >☠ ${translateText("control_panel.threat_leader")}</span
              >`
            : html`<button
                class="flex items-center gap-1 shrink-0 text-red-300 font-bold text-xs cursor-pointer hover:underline transition-colors"
                title=${translateText("control_panel.form_coalition_tooltip")}
                @click=${() => this.onFormCoalition()}
              >
                ☠ ${translateText("control_panel.form_coalition")} —
                ${this._threatLeaderName}
              </button>`
          : ""}
      </div>
    `;
  }

  // Module §4 — primitive pile readout. The sim may remember tile kinds, but the
  // player-facing economy is one Resources pool plus separate Gold.
  private renderResourcePile() {
    if (this._resources <= 0) {
      return html``;
    }
    return html`
      <div class="tc-chip text-sm" translate="no">
        <span class="tc-num" title="Resources"
          >◆ ${renderNumber(this._resources)}</span
        >
      </div>
    `;
  }

  private gateLabel(gate: AgeGate): string {
    if (gate.labelValue !== undefined) {
      return translateText(gate.labelKey, { unit: gate.labelValue });
    }
    return translateText(gate.labelKey);
  }

  private gateValue(value: number | bigint, kind: "gold" | "number"): string {
    return kind === "gold" ? renderNumber(value) : renderNumber(Number(value));
  }

  private missingGateReason(): string {
    const missing = this._ageGates.filter((gate) => !gate.complete);
    if (missing.length === 0) {
      return "";
    }
    return translateText("control_panel.advance_age_need_gates", {
      gates: missing.map((gate) => this.gateLabel(gate)).join(", "),
    });
  }

  private renderAgeCostSummary() {
    const goldGate = this._ageGates.find((gate) => gate.id === "gold");
    const techGate = this._ageGates.find((gate) => gate.id === "tech");
    if (!goldGate && !techGate) {
      return html``;
    }
    return html`
      ${goldGate
        ? html`${renderNumber(goldGate.target)}
            <img
              src=${goldCoinIcon}
              width="11"
              height="11"
              class="inline align-middle"
            />`
        : ""}
      ${techGate ? html` / ${renderNumber(techGate.target)} ⚙` : ""}
    `;
  }

  private renderAgeGates() {
    if (this._ageGates.length === 0) {
      return html``;
    }
    return html`
      <div class="flex-wrap gap-1 mt-1 hidden lg:flex" translate="no">
        ${this._ageGates.map(
          (gate) => html`
            <span
              class="shrink-0 border rounded-md text-xs py-0.5 px-1.5 ${gate.complete
                ? "border-gain/60 text-gain bg-gain/10"
                : "border-hairline text-text-mid bg-surface-0/40"}"
              title=${this.gateLabel(gate)}
            >
              <span>${this.gateLabel(gate)}</span>
              <span class="tc-num ml-1"
                >${this.gateValue(gate.current, gate.kind)}/${this.gateValue(
                  gate.target,
                  gate.kind,
                )}</span
              >
            </span>
          `,
        )}
      </div>
    `;
  }

  private renderEraTriumphs() {
    if (this._eraTriumphs.length === 0) {
      return html``;
    }
    const completed = this._eraTriumphs.filter(
      (triumph) => triumph.complete,
    ).length;
    return html`
      <div class="tc-triumphs" translate="no">
        <div class="tc-triumphs-heading">
          <span class="tc-label"
            >${translateText("control_panel.triumphs")}</span
          >
          <span class="tc-num">${completed}/${this._eraTriumphs.length}</span>
        </div>
        <div class="tc-triumph-list">
          ${this._eraTriumphs.map(
            (triumph) => html`
              <div
                class="tc-triumph ${triumph.complete
                  ? "tc-triumph--complete"
                  : ""} ${triumph.blocked ? "tc-triumph--blocked" : ""}"
                title="${translateText(triumph.detailKey)} · ${this.gateValue(
                  triumph.current,
                  triumph.kind,
                )}/${this.gateValue(triumph.target, triumph.kind)}"
              >
                <span class="tc-triumph-mark" aria-hidden="true"
                  >${triumph.complete ? "✓" : ""}</span
                >
                <span>${translateText(triumph.labelKey)}</span>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderTransitionTempo() {
    if (this._age >= Age.Alien) return html``;
    const deltaPct = Math.abs(
      Math.round((this._transitionCostBps - 10000) / 100),
    );
    const tempo =
      this._transitionCostBps > 10000
        ? translateText("control_panel.transition_hasty", {
            percent: deltaPct,
          })
        : this._transitionCostBps < 10000
          ? translateText("control_panel.transition_mastered", {
              percent: deltaPct,
            })
          : translateText("control_panel.transition_balanced");
    return html`
      <div class="tc-transition-tempo">
        <span class="tc-transition-grade">${tempo}</span>
        <span class="tc-transition-timing"
          >${translateText("control_panel.transition_timing", {
            ritual: this._transitionRitualSeconds,
            penalty: this._transitionPenaltySeconds,
          })}</span
        >
      </div>
    `;
  }

  // Objectives get their OWN container (owner direction 2026-07-04: "separate
  // container for objectives") — a distinct elevated card that sits ABOVE the
  // command readouts instead of being crammed into the same tight stack.
  private isFirstTurnObjective(): boolean {
    const objective = this._objective;
    return objective?.id === "find_resources" && objective.progress === 0;
  }

  private renderPrimitiveRoadmap() {
    const player = this.game?.myPlayer();
    if (!player || player.age() !== Age.Primitive) return html``;

    const cityGate = this._ageGates.find((gate) => gate.id === "city");
    const economyBuildings =
      countBuiltUnits(player, UnitType.PrimitiveFarm) +
      countBuiltUnits(player, UnitType.TradeOutpost);
    const frontierComplete =
      player.resources() > 0 ||
      (this._primitivePipeline?.totalGoldPerSecond ?? 0n) > 0n ||
      economyBuildings > 0 ||
      (cityGate?.complete ?? false);
    const economyComplete =
      economyBuildings > 0 || (cityGate?.complete ?? false);
    const settlementComplete = cityGate?.complete ?? false;
    const steps = [
      {
        id: "frontier",
        label: translateText("control_panel.roadmap_frontier"),
        complete: frontierComplete,
      },
      {
        id: "economy",
        label: translateText("control_panel.roadmap_economy"),
        complete: economyComplete,
      },
      {
        id: "settlement",
        label: translateText("control_panel.roadmap_settlement"),
        complete: settlementComplete,
      },
      {
        id: "advance",
        label: translateText("control_panel.roadmap_advance"),
        complete: player.age() > Age.Primitive,
      },
    ];
    const activeIndex = steps.findIndex((step) => !step.complete);

    return html`
      <div
        class="tc-objective-roadmap"
        aria-label=${translateText("control_panel.roadmap_label")}
      >
        ${steps.map(
          (step, index) => html`
            <span
              class="tc-roadmap-step ${step.complete
                ? "tc-roadmap-step--complete"
                : index === activeIndex
                  ? "tc-roadmap-step--active"
                  : ""}"
              data-roadmap-step=${step.id}
              ?aria-current=${index === activeIndex ? "step" : undefined}
            >
              <span class="tc-roadmap-index"
                >${step.complete ? "✓" : index + 1}</span
              >
              <span>${step.label}</span>
            </span>
          `,
        )}
      </div>
    `;
  }

  private renderObjectiveRail() {
    if (this._objective === null) {
      return html``;
    }
    const progress = Math.round(this._objective.progress * 100);
    const isFirstMove =
      this._objective.id === "find_resources" && progress === 0;
    // The permanent-settlement objective is the headline PRIZE of the Primitive
    // era; mark its title with a gold laurel wreath and a gold glow so it reads
    // as the aspirational goal, clearly set apart from the routine objectives.
    const isPrize = this._objective.id === "found_city";
    // The objective's explanatory sentence is tutorial copy. It earns a real row
    // on the very first move (the player genuinely does not know what to do) and
    // whenever the era expander is open — that toggle is the one control for "show
    // me the explanatory copy", and it is also the only way this text is reachable
    // on touch, where title= tooltips never fire.
    const detail = translateText(this._objective.detailKey);
    return html`
      <div
        class="tc-objective-card ${isPrize
          ? "tc-objective-card--prize"
          : ""} ${isFirstMove ? "tc-objective-card--first-turn" : ""}"
        data-objective-id=${this._objective.id}
        title=${detail}
        aria-live="polite"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 flex items-center gap-1.5">
            ${isPrize
              ? html`<img
                  class="tc-laurel tc-laurel--lg shrink-0"
                  src=${laurelIcon}
                  alt=""
                  aria-hidden="true"
                  width="22"
                  height="22"
                />`
              : ""}
            <div class="min-w-0">
              <span class="tc-label"
                >${translateText(
                  isFirstMove
                    ? "control_panel.first_move"
                    : "control_panel.objective_label",
                )}</span
              >
              <div class="font-bold text-text-hi truncate leading-tight">
                ${translateText(this._objective.titleKey)}
              </div>
            </div>
          </div>
          <span class="tc-num text-sm text-age-accent shrink-0"
            >${progress}%</span
          >
        </div>
        ${html`<div
          class="tc-objective-detail text-xs text-text-mid mt-1 lg:mt-0.5 ${isFirstMove ||
          this._detailsOpen
            ? ""
            : "tc-objective-detail--mobile"}"
        >
          ${detail}
        </div>`}
        ${this.renderPrimitiveRoadmap()}
        <div
          class="mt-1.5 h-1.5 rounded-full bg-white/15 overflow-hidden"
          aria-hidden="true"
        >
          <div
            class="h-full bg-age-accent transition-[width] duration-200"
            style="width: ${progress}%;"
          ></div>
        </div>
      </div>
    `;
  }

  private renderPrimitivePipeline() {
    if (
      this._age !== Age.Primitive ||
      this._primitivePipeline === null ||
      this._objective?.id === "find_resources"
    ) {
      return html``;
    }
    const pipe = this._primitivePipeline;
    const hasFlow = pipe.totalGoldPerSecond > 0n;
    // Q6 declutter: one compact line, no boxes. Show "Gold flow +N/s" then a
    // single plain inline breakdown of the contributing sources; collapse to the
    // empty-state hint when nothing is flowing yet.
    const breakdown: string[] = [];
    if (pipe.resourceGoldPerSecond > 0n) {
      breakdown.push(`◆ +${renderNumber(pipe.resourceGoldPerSecond)}/s`);
    }
    if (pipe.farmGoldPerSecond > 0n) {
      breakdown.push(
        `${translateText("control_panel.pipeline_farms")} +${renderNumber(
          pipe.farmGoldPerSecond,
        )}/s`,
      );
    }
    // The per-source breakdown is a diagnostic, not a live-play readout — the
    // total is what you act on. Keep the total inline, put the sources in the
    // tooltip so this stays ONE short line at every flow level.
    return html`
      <div
        class="mt-1 items-center flex-wrap gap-x-1.5 text-xs text-text-mid hidden lg:flex"
        title=${breakdown.length > 0 ? breakdown.join(", ") : ""}
        translate="no"
      >
        <span class="tc-label"
          >${translateText("control_panel.pipeline_label")}</span
        >
        <span class="tc-num ${hasFlow ? "!text-gain" : ""}"
          >+${renderNumber(pipe.totalGoldPerSecond)}/s</span
        >
        ${!hasFlow
          ? html`<span class="opacity-70"
              >${translateText("control_panel.pipeline_empty")}</span
            >`
          : ""}
      </div>
    `;
  }

  // Shared Age + Advance-Age UI for both desktop and mobile layouts.
  // Rank my era against every other living player. Recomputed on a ~1s cadence
  // (this walks every player, and the answer only changes on an age-up).
  private updateEraStanding(me: PlayerView) {
    if (++this._eraStandingTick % 10 !== 0) return;
    const standing = computeEraStanding(me, this.game.playerViews());
    if (standing === null) {
      this._eraStanding = null;
      return;
    }
    this._eraStanding =
      standing.ahead === 0
        ? translateText("control_panel.era_standing_highest")
        : translateText("control_panel.era_standing_rank", {
            ordinal: ordinal(standing.rank),
          });
  }

  private toggleEraDetails() {
    this._detailsOpen = !this._detailsOpen;
    new UserSettings().setEraDetailsOpen(this._detailsOpen);
    this.syncScrollFade();
  }

  // The panel is height-capped, so content can sit below the fold. Without a cue
  // the cut looks like a rendering bug (a half-drawn chip) rather than "there is
  // more here"; this drives a bottom fade mask, and clears it at the end of the
  // scroll so nothing is dimmed once you have actually reached the bottom.
  //
  // Throttled because reading scrollHeight forces a synchronous layout and tick()
  // runs at the sim's cadence.
  private _scrollFadeTick = 0;
  private syncScrollFade(force = false) {
    if (!force && ++this._scrollFadeTick % 5 !== 0) return;
    const overflowing = this.scrollHeight > this.clientHeight + 4;
    const atBottom = this.scrollHeight - this.scrollTop - this.clientHeight < 4;
    this.toggleAttribute("data-scroll-fade", overflowing && !atBottom);
  }

  private onPanelScroll = () => this.syncScrollFade(true);

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("scroll", this.onPanelScroll, { passive: true });
  }

  private renderAgePanel() {
    const atMax = this._age >= Age.Alien || this._advanceCost === null;
    const profile = ERA_PROFILES[this._age];
    const nextAge = Math.min(Age.Alien, this._age + 1) as Age;
    const reason = atMax
      ? translateText("control_panel.advance_age_max")
      : !this._canAdvanceAge
        ? this.missingGateReason()
        : "";
    // What survives a collapse is what you need DURING a fight: which era you
    // are in, what the next one is, and the button that buys it. The era
    // tagline / focus / unlock blurbs and the Triumph checklist are reference
    // copy you read between fights, so they hide behind the expander by default
    // instead of permanently costing ~6 rows of battlefield.
    const open = this._detailsOpen;
    return html`
      <div
        class="tc-era-runway ${open ? "" : "tc-era-runway--compact"}"
        translate="no"
      >
        <div class="tc-era-identity">
          <div class="tc-era-kicker">
            ${translateText("control_panel.era_number", {
              numeral: romanNumeral(this._age + 1),
            })}${this._eraStanding !== null
              ? html`<span class="tc-era-standing"
                  >· ${this._eraStanding}</span
                >`
              : ""}
          </div>
          <div class="tc-era-title-row">
            <div class="tc-era-title">${ageNames[this._age]}</div>
            <button
              class="tc-era-expander"
              aria-expanded=${open ? "true" : "false"}
              title=${translateText(
                open
                  ? "control_panel.era_details_hide"
                  : "control_panel.era_details_show",
              )}
              aria-label=${translateText(
                open
                  ? "control_panel.era_details_hide"
                  : "control_panel.era_details_show",
              )}
              @click=${() => this.toggleEraDetails()}
            >
              ${open ? "▴" : "▾"}
            </button>
          </div>
          ${open
            ? html`<div class="tc-era-tagline">
                ${translateText(profile.taglineKey)}
              </div>`
            : ""}
        </div>
        ${open
          ? html`<div class="tc-era-focus">
                <span class="tc-label"
                  >${translateText("control_panel.era_focus")}</span
                >
                <span>${translateText(profile.focusKey)}</span>
                <span class="tc-era-unlock"
                  >${translateText(profile.unlockKey)}</span
                >
              </div>
              ${this.renderEraTriumphs()}`
          : ""}
        <div class="tc-era-transition">
          ${atMax
            ? html`<div class="tc-era-final">
                <span class="tc-label"
                  >${translateText("control_panel.final_age")}</span
                >
                <span>${reason}</span>
              </div>`
            : html`
                <div class="tc-era-next">
                  <span class="tc-label"
                    >${translateText("control_panel.next_age")}</span
                  >
                  <strong>${ageNames[nextAge]}</strong>
                </div>
                ${open ? this.renderTransitionTempo() : ""}
                ${this._greatWork !== null
                  ? this.renderGreatWork(this._greatWork)
                  : html`<button
                      class="tc-advance-btn text-sm"
                      ?disabled=${!this._canAdvanceAge}
                      title=${reason}
                      @click=${() => this.onAdvanceAge()}
                    >
                      <span
                        >${translateText(
                          "control_panel.begin_great_work",
                        )}</span
                      >
                      <span class="tc-cost"
                        >${this.renderAgeCostSummary()}</span
                      >
                    </button>`}
              `}
        </div>
      </div>
      <div class="tc-era-resources" translate="no">
        <div class="tc-chip tc-chip--tech text-sm">
          <span class="tc-label"
            >${translateText("control_panel.tech_points")}</span
          >
          <span class="tc-num">${renderNumber(this._techPoints)}</span>
        </div>
        ${this.renderResourcePile()}
        ${this._goldenAge
          ? html`<div class="tc-chip tc-chip--golden text-sm">
              <span class="tc-label"
                >${translateText("control_panel.golden_age")}</span
              >
            </div>`
          : ""}
      </div>
      ${this.renderAgeGates()} ${this.renderPrimitivePipeline()}
    `;
  }

  // Primal-meta: my Great Work in progress — the advance button becomes a
  // live progress bar (the ritual is public; raids knock it back).
  private renderGreatWork(gw: {
    targetAge: number;
    progress: number;
    required: number;
  }) {
    const pct = Math.max(
      0,
      Math.min(100, Math.floor((gw.progress * 100) / Math.max(1, gw.required))),
    );
    const secondsLeft = Math.max(
      0,
      Math.ceil((gw.required - gw.progress) / 10),
    );
    // Single-row chip so it sits flush with its dock siblings; the ritual
    // name lives in the tooltip and the progress bar hugs the bottom edge.
    return html`<div
      class="tc-chip tc-gw-chip text-sm ${this._gwSetback
        ? "tc-gw-setback"
        : ""}"
      title="${translateText("control_panel.great_work", {
        age: ageNames[gw.targetAge as Age] ?? "",
      })} — ${translateText("control_panel.great_work_tooltip")}"
    >
      <span class="tc-label" style="white-space: nowrap">⚒</span>
      <span class="tc-num" style="white-space: nowrap"
        >${pct}% · ${secondsLeft}s</span
      >
      <div class="tc-gw-bar">
        <div class="tc-gw-fill" style="width: ${pct}%"></div>
      </div>
    </div>`;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  private handleRatioSliderInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = Number(input.value);
    this.attackRatio = value / 100;
    this.onAttackRatioChange(this.attackRatio);
  }

  private handleRatioSliderPointerUp(e: Event) {
    (e.target as HTMLInputElement).blur();
  }

  private calculateTroopBar(): { greenPercent: number; orangePercent: number } {
    const base = Math.max(this._maxTroops, 1);
    const greenPercentRaw = (this._troops / base) * 100;
    const orangePercentRaw = (this._attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return { greenPercent, orangePercent };
  }

  private renderMobileTroopBar() {
    const { greenPercent, orangePercent } = this.calculateTroopBar();
    return html`
      <div
        class="w-full h-6 border border-hairline rounded-md bg-surface-0/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${greenPercent > 0
            ? html`<div
                class="h-full bg-age-accent transition-[width] duration-200"
                style="width: ${greenPercent}%;"
              ></div>`
            : ""}
          ${orangePercent > 0
            ? html`<div
                class="h-full bg-ember transition-[width] duration-200"
                style="width: ${orangePercent}%;"
              ></div>`
            : ""}
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 text-xs font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(this._troops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(this._maxTroops)}</span
          >
        </div>
        <div
          class="absolute inset-0 flex items-center justify-center gap-0.5 pointer-events-none"
          translate="no"
        >
          <img
            src=${soldierIcon}
            alt=""
            aria-hidden="true"
            width="12"
            height="12"
            class="brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
          />
          <span
            class="text-[10px] font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${this
              ._troopRateIsIncreasing
              ? "text-green-400"
              : "text-orange-400"}"
            >+${renderTroops(this.troopRate)}/s</span
          >
        </div>
      </div>
    `;
  }

  private renderDesktopTroopBar() {
    const { greenPercent, orangePercent } = this.calculateTroopBar();
    return html`
      <div
        class="w-full h-6 border border-hairline rounded-md bg-surface-0/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${greenPercent > 0
            ? html`<div
                class="h-full bg-age-accent transition-[width] duration-200"
                style="width: ${greenPercent}%;"
              ></div>`
            : ""}
          ${orangePercent > 0
            ? html`<div
                class="h-full bg-ember transition-[width] duration-200"
                style="width: ${orangePercent}%;"
              ></div>`
            : ""}
        </div>
        <div
          class="absolute inset-0 flex items-center text-lg font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="flex-1 flex justify-end h-full items-center pr-0.5">
            <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
              >${renderTroops(this._troops)}</span
            >
          </span>
          <span
            class="h-full flex items-center px-0.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >/</span
          >
          <span
            class="flex-1 flex justify-start h-full items-center pl-0.5 gap-0.5"
          >
            <span
              class="text-white tabular-nums w-[3.5rem] drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
              >${renderTroops(this._maxTroops)}</span
            >
            <img
              src=${soldierIcon}
              alt=""
              aria-hidden="true"
              width="22"
              height="22"
              class="shrink-0 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ml-1.5"
            />
          </span>
        </div>
      </div>
    `;
  }

  private renderNotification() {
    if (!this._notification) return html``;
    const isWarning = this._notification.type === "warning";
    return html`
      <div
        class="flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-xs font-medium mb-1 ${isWarning
          ? "border-ember/60 bg-ember/10 text-ember"
          : "border-age-accent/60 bg-age-accent/10 text-age-accent"}"
      >
        <span class="shrink-0">${isWarning ? "⚠" : "ℹ"}</span>
        <span>${translateText(this._notification.message)}</span>
      </div>
    `;
  }

  private renderDesktop() {
    const isFirstTurn = this.isFirstTurnObjective();
    return html`
      ${this.renderCeremony()} ${this.renderNotification()}
      ${this.renderDramaFeed()}
      <!-- Row 1: troop rate | troop bar | gold -->
      <div class="flex gap-2 items-center mb-2">
        <!-- Troop rate -->
        <div
          class="tc-chip text-sm w-[5.5rem] ${this._troopRateIsIncreasing
            ? "!border-gain/50"
            : "!border-ember/50"}"
          translate="no"
        >
          <img
            src=${soldierIcon}
            alt=""
            aria-hidden="true"
            width="13"
            height="13"
            class="shrink-0"
            style="filter: ${this._troopRateIsIncreasing
              ? "brightness(0) saturate(100%) invert(74%) sepia(44%) saturate(500%) hue-rotate(83deg) brightness(103%)"
              : "brightness(0) saturate(100%) invert(65%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(105%)"}"
          />
          <span
            class="tc-num ${this._troopRateIsIncreasing
              ? "!text-gain"
              : "!text-ember"}"
            >+${renderTroops(this.troopRate)}/s</span
          >
        </div>
        <!-- Troop bar -->
        <div class="flex-1">${this.renderDesktopTroopBar()}</div>
        <!-- Gold -->
        <div
          class="tc-chip tc-chip--gold text-sm w-[4.5rem] relative"
          translate="no"
        >
          ${this._goldGain !== null
            ? keyed(
                this._goldGainPulseId,
                html`<span
                  class="gold-gain-pop absolute -top-5 right-[5px] min-[1015px]:right-[9px] text-gain text-sm font-extrabold tabular-nums whitespace-nowrap pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
                  >+${renderNumber(this._goldGain)}</span
                >`,
              )
            : ""}
          <img src=${goldCoinIcon} width="13" height="13" class="shrink-0" />
          <span class="tc-num">${renderNumber(this._gold)}</span>
        </div>
      </div>
      <!-- Row 2: attack ratio | slider -->
      <div class="flex items-center gap-2 mb-0.5" translate="no">
        <div class="tc-chip text-sm w-[8rem]">
          <img
            src=${swordIcon}
            alt=""
            aria-hidden="true"
            width="12"
            height="12"
            style="filter: brightness(0) invert(1);"
          />
          <span class="tc-label"
            >${translateText("control_panel.attack_label")}</span
          >
          <span class="tc-num"
            >${(this.attackRatio * 100).toFixed(0)}%
            (${renderTroops(
              (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
            )})</span
          >
        </div>
        <input
          type="range"
          min="1"
          max="100"
          .value=${String(Math.round(this.attackRatio * 100))}
          @input=${(e: Event) => this.handleRatioSliderInput(e)}
          @pointerup=${(e: Event) => this.handleRatioSliderPointerUp(e)}
          class="tc-attack-slider flex-1"
          title=${translateText("user_setting.attack_ratio_controls")}
          aria-label=${translateText("user_setting.attack_ratio_controls")}
        />
      </div>
      <!-- Row 3: Age + Advance Age -->
      ${isFirstTurn ? html`` : this.renderAgePanel()}
      <!-- Row 4: threat / coalition / unrest / advancing / armageddon -->
      ${isFirstTurn ? html`` : this.renderTelegraphRow()}
    `;
  }

  private renderMobile() {
    const isFirstTurn = this.isFirstTurnObjective();
    return html`
      ${this.renderCeremony()} ${this.renderNotification()}
      ${this.renderDramaFeed()}
      <div class="flex gap-2 items-center">
        <!-- Gold -->
        <div
          class="tc-chip tc-chip--gold justify-center text-xs w-1/5 shrink-0 relative"
          translate="no"
        >
          ${this._goldGain !== null
            ? keyed(
                this._goldGainPulseId,
                html`<span
                  class="gold-gain-pop absolute -top-5 right-[5px] min-[1015px]:right-[9px] text-gain text-xs font-extrabold tabular-nums whitespace-nowrap pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
                  >+${renderNumber(this._goldGain)}</span
                >`,
              )
            : ""}
          <img src=${goldCoinIcon} width="13" height="13" />
          <span class="tc-num px-0.5">${renderNumber(this._gold)}</span>
        </div>
        <!-- Troop bar -->
        <div class="w-[40%] shrink-0 flex items-center">
          ${this.renderMobileTroopBar()}
        </div>
        <!-- Sword + % label -->
        <div
          class="flex flex-col items-center shrink-0 gap-0.5 w-8"
          translate="no"
        >
          <img
            src=${swordIcon}
            alt=""
            aria-hidden="true"
            width="10"
            height="10"
            style="filter: brightness(0) invert(1);"
          />
          <span class="text-white text-xs font-bold tabular-nums"
            >${(this.attackRatio * 100).toFixed(0)}%</span
          >
        </div>
        <!-- Attack ratio slider -->
        <div class="flex-1" translate="no">
          <input
            type="range"
            min="1"
            max="100"
            .value=${String(Math.round(this.attackRatio * 100))}
            @input=${(e: Event) => this.handleRatioSliderInput(e)}
            @pointerup=${(e: Event) => this.handleRatioSliderPointerUp(e)}
            class="tc-attack-slider w-full"
            title=${translateText("user_setting.attack_ratio_controls")}
            aria-label=${translateText("user_setting.attack_ratio_controls")}
          />
        </div>
      </div>
      ${isFirstTurn ? html`` : this.renderAgePanel()}
      ${isFirstTurn ? html`` : this.renderTelegraphRow()}
    `;
  }

  render() {
    return html`
      <style>
        @keyframes gold-gain-pop {
          0% {
            transform: translateY(4px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .gold-gain-pop {
          animation: gold-gain-pop 0.25s ease-out;
        }
        /* Q5 — gold-tint the laurel wreath flanking the settlement objective.
           The asset has a fixed red internal fill, so we remap it to gold with a
           color filter. Kept vertically centred to balance the title. */
        .tc-laurel {
          display: inline-block;
          width: 0.95em;
          height: 0.95em;
          vertical-align: -0.15em;
          opacity: 0.95;
          filter: brightness(0) saturate(100%) invert(78%) sepia(52%)
            saturate(520%) hue-rotate(1deg) brightness(95%) contrast(90%);
        }
        .tc-laurel--lg {
          width: 1.4rem;
          height: 1.4rem;
          vertical-align: middle;
          filter: brightness(0) saturate(100%) invert(78%) sepia(52%)
            saturate(520%) hue-rotate(1deg) brightness(100%) contrast(92%)
            drop-shadow(0 0 4px rgba(217, 180, 74, 0.55));
        }
        .tc-laurel-r {
          transform: scaleX(-1);
        }
        /* Objectives live in their OWN elevated container above the readouts. */
        .tc-objective-card {
          border: 1px solid
            color-mix(in srgb, var(--age-accent) 45%, var(--hairline));
          border-left: 3px solid var(--age-accent);
          border-radius: var(--radius-md, 0.5rem);
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--age-accent) 15%, var(--surface-2)) 0%,
            color-mix(in srgb, var(--age-accent) 6%, var(--surface-2)) 100%
          );
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.35),
            inset 0 0 0 1px
              color-mix(in srgb, var(--age-accent) 12%, transparent);
          padding: 8px 12px;
        }
        /* The permanent-settlement PRIZE objective: warm gold framing + glow. */
        .tc-objective-card--prize {
          border-color: color-mix(in srgb, #d9b44a 70%, var(--age-accent));
          border-left-color: #d9b44a;
          box-shadow:
            0 2px 16px color-mix(in srgb, #d9b44a 32%, transparent),
            inset 0 0 0 1px color-mix(in srgb, #d9b44a 18%, transparent);
        }
        .tc-objective-card--first-turn {
          border-left-width: 5px;
          border-color: color-mix(
            in srgb,
            var(--age-accent) 72%,
            var(--hairline)
          );
          box-shadow:
            0 3px 18px color-mix(in srgb, var(--age-accent) 22%, transparent),
            inset 0 0 0 1px
              color-mix(in srgb, var(--age-accent) 20%, transparent);
        }
        .tc-objective-card--first-turn .tc-objective-detail {
          color: var(--text);
        }
        .tc-objective-detail {
          line-height: 1.35;
        }
        .tc-objective-roadmap {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 4px;
          margin-top: 7px;
        }
        .tc-roadmap-step {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 4px;
          padding: 3px 4px;
          border: 1px solid var(--hairline);
          border-radius: 4px;
          color: var(--text-lo);
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          line-height: 1.1;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .tc-roadmap-step > span:last-child {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tc-roadmap-index {
          color: var(--text-mid);
          font-family: var(--font-mono);
          font-size: 0.62rem;
        }
        .tc-roadmap-step--active {
          border-color: color-mix(
            in srgb,
            var(--age-accent) 65%,
            var(--hairline)
          );
          background: color-mix(in srgb, var(--age-accent) 12%, transparent);
          color: var(--text-hi);
        }
        .tc-roadmap-step--active .tc-roadmap-index {
          color: var(--age-accent);
        }
        .tc-roadmap-step--complete {
          border-color: color-mix(in srgb, var(--gain) 42%, var(--hairline));
          color: var(--gain);
        }
        .tc-roadmap-step--complete .tc-roadmap-index {
          color: var(--gain);
        }
        .tc-objective-detail--mobile {
          display: none;
        }
        @media (max-width: 767px) {
          .tc-objective-card {
            padding: 7px 10px;
          }
          .tc-objective-roadmap {
            gap: 3px;
            margin-top: 6px;
          }
          .tc-roadmap-step {
            gap: 2px;
            padding: 3px 2px;
            font-size: 0.48rem;
            letter-spacing: 0.03em;
          }
          .tc-objective-detail--mobile {
            display: block;
          }
          .tc-objective-detail {
            display: -webkit-box;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            font-size: 0.72rem;
          }
          .tc-drama-item {
            min-height: 36px;
            align-items: center;
          }
          .tc-drama-detail {
            display: none;
          }
        }
      </style>
      <div
        class="relative pointer-events-auto overflow-hidden ${this._ageUp
          ? "tc-age-up"
          : ""} ${this.isFirstTurnObjective()
          ? "tc-control-panel--first-turn"
          : ""} ${this._isVisible ? "block w-full text-sm" : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this._objective !== null
          ? html`<div class="px-2 pt-2">${this.renderObjectiveRail()}</div>`
          : ""}
        <div class="px-3 py-2">
          <div class="lg:hidden">${this.renderMobile()}</div>
          <div class="hidden lg:block">${this.renderDesktop()}</div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
