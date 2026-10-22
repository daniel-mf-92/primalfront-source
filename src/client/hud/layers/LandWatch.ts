import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Age, UnitType } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

// Losing land used to be a small red line in the corner feed (real-screen
// audit 2026-10-22: a Hut wore away, its land went back to the wild, and the
// player only noticed the shrinking blob). This layer watches the three ways
// a tribe loses ground and says so in ONE banner at the top of the map, in
// the atlas style, BEFORE it happens where it can:
//
//   - HUT WEAR: a Hut is a temporary camp (Config.hutLifespanTicks). The
//     banner warns HUT_WARN_TICKS ahead with a countdown, then marks the loss.
//   - ATTACK: land shrinking while a rival's attack is coming in.
//   - REWILD: land shrinking with no attack, i.e. the Stone Age frontier
//     falling back to the wild because no Hut holds it.
//
// Pure client read of replicated state; nothing here touches the sim.

/** How early the Hut warning shows (30 s at 10 ticks/s). */
export const HUT_WARN_TICKS = 300;
/** Land is sampled this often and compared with LAND_WINDOW samples ago. */
const LAND_SAMPLE_TICKS = 10;
const LAND_WINDOW = 5;
/** How long a "you lost / are losing" banner stays after the last trigger. */
const BANNER_HOLD_TICKS = 50;

/**
 * Pure: a meaningful land drop over the window, not border noise. At least
 * 12 tiles AND 4% of what the tribe held.
 */
export function isLandLoss(before: number, now: number): boolean {
  const lost = before - now;
  return lost >= 12 && lost >= before * 0.04;
}

/**
 * Tracks when each Hut started its life, so the HUD can count down to the
 * moment HutExecution removes it (first live tick + hutLifespanTicks).
 * Estimated from when this client first saw the Hut finished, which is the
 * same tick in normal play.
 */
export class HutWearTracker {
  private bornAt = new Map<number, number>();
  private syncedTick = -1;

  constructor(private readonly game: GameView) {}

  /** Refresh from my current Huts (once per tick, however many callers). */
  sync(): void {
    const ticks = this.game.ticks();
    if (ticks === this.syncedTick) return;
    this.syncedTick = ticks;
    const me = this.game.myPlayer();
    const live = new Set<number>();
    if (me !== null) {
      for (const hut of me.units(UnitType.Hut)) {
        if (hut.isUnderConstruction()) continue;
        live.add(hut.id());
        if (!this.bornAt.has(hut.id())) this.bornAt.set(hut.id(), ticks);
      }
    }
    for (const id of this.bornAt.keys()) {
      if (!live.has(id)) this.bornAt.delete(id);
    }
  }

  /** Ticks until this Hut wears away, or null if it is not one of mine. */
  remainingTicks(unitID: number): number | null {
    this.sync();
    const born = this.bornAt.get(unitID);
    if (born === undefined) return null;
    const lifespan = this.game.config().hutLifespanTicks();
    return Math.max(0, born + lifespan - this.game.ticks());
  }

  /** The Hut that goes first: its id and ticks left. */
  soonest(): { id: number; ticks: number } | null {
    this.sync();
    let best: { id: number; ticks: number } | null = null;
    for (const id of this.bornAt.keys()) {
      const ticks = this.remainingTicks(id);
      if (ticks === null) continue;
      if (best === null || ticks < best.ticks) best = { id, ticks };
    }
    return best;
  }
}

const trackers = new WeakMap<GameView, HutWearTracker>();

export function hutWearFor(game: GameView): HutWearTracker {
  let tracker = trackers.get(game);
  if (tracker === undefined) {
    tracker = new HutWearTracker(game);
    trackers.set(game, tracker);
  }
  return tracker;
}

/** "1:05", "0:09". */
export function formatClock(ticks: number): string {
  const seconds = Math.max(0, Math.ceil(ticks / 10));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type BannerKind = "attack" | "hut_gone" | "hut_wear" | "rewild";

interface Banner {
  kind: BannerKind;
  kicker: string;
  message: string;
  /** 0..1 for the countdown strip (Hut wear only). */
  fraction?: number;
}

@customElement("land-watch")
export class LandWatch extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private banner: Banner | null = null;

  private landSamples: number[] = [];
  private lastSampleTick = -1;
  private lossUntilTick = -1;
  private lossKind: "attack" | "rewild" = "rewild";
  private lossAttacker = "";
  private warnedHuts = new Set<number>();
  private lastSoonest: { id: number; ticks: number } | null = null;
  private hutGoneUntilTick = -1;

  createRenderRoot() {
    return this;
  }

  tick() {
    const me = this.game?.myPlayer();
    if (!me || !me.isAlive() || !me.hasSpawned() || this.game.inSpawnPhase()) {
      this.banner = null;
      return;
    }
    const ticks = this.game.ticks();
    const tracker = hutWearFor(this.game);
    tracker.sync();

    // Hut that just went: it was about to wear away and now it is gone.
    const soonest = tracker.soonest();
    if (
      this.lastSoonest !== null &&
      this.lastSoonest.ticks <= 20 &&
      (soonest === null || soonest.id !== this.lastSoonest.id)
    ) {
      this.hutGoneUntilTick = ticks + BANNER_HOLD_TICKS * 2;
      this.eventBus?.emit(new PlaySoundEffectEvent("great-work-setback"));
    }
    this.lastSoonest = soonest;
    if (
      soonest !== null &&
      soonest.ticks <= HUT_WARN_TICKS &&
      !this.warnedHuts.has(soonest.id)
    ) {
      this.warnedHuts.add(soonest.id);
      this.eventBus?.emit(new PlaySoundEffectEvent("message"));
    }

    // Land trend.
    if (ticks - this.lastSampleTick >= LAND_SAMPLE_TICKS) {
      this.lastSampleTick = ticks;
      this.landSamples.push(me.numTilesOwned());
      if (this.landSamples.length > LAND_WINDOW + 1) this.landSamples.shift();
      const before = this.landSamples[0];
      const now = this.landSamples[this.landSamples.length - 1];
      if (this.landSamples.length > 1 && isLandLoss(before, now)) {
        const attack = me
          .incomingAttacks()
          .filter((a) => !a.retreating)
          .sort((a, b) => b.troops - a.troops)[0];
        const wasLosing = this.lossUntilTick > ticks;
        this.lossKind = attack !== undefined ? "attack" : "rewild";
        this.lossAttacker = "";
        if (attack !== undefined) {
          try {
            const attacker = this.game.playerBySmallID(attack.attackerID);
            this.lossAttacker = attacker.isPlayer()
              ? attacker.displayName()
              : "";
          } catch {
            this.lossAttacker = "";
          }
        }
        this.lossUntilTick = ticks + BANNER_HOLD_TICKS;
        if (!wasLosing) {
          this.eventBus?.emit(new PlaySoundEffectEvent("great-work-setback"));
        }
      }
    }

    this.banner = this.chooseBanner(ticks, soonest, me.age());
  }

  private chooseBanner(
    ticks: number,
    soonest: { id: number; ticks: number } | null,
    age: Age,
  ): Banner | null {
    if (this.lossUntilTick > ticks && this.lossKind === "attack") {
      return {
        kind: "attack",
        kicker: translateText("land_watch.attack_kicker"),
        message:
          this.lossAttacker !== ""
            ? translateText("land_watch.attack", { name: this.lossAttacker })
            : translateText("land_watch.attack_unknown"),
      };
    }
    if (this.hutGoneUntilTick > ticks) {
      return {
        kind: "hut_gone",
        kicker: translateText("land_watch.hut_gone_kicker"),
        message: translateText("land_watch.hut_gone"),
      };
    }
    if (soonest !== null && soonest.ticks <= HUT_WARN_TICKS) {
      return {
        kind: "hut_wear",
        kicker: translateText("land_watch.hut_wear_kicker"),
        message: translateText("land_watch.hut_wear", {
          time: formatClock(soonest.ticks),
        }),
        fraction: soonest.ticks / HUT_WARN_TICKS,
      };
    }
    if (this.lossUntilTick > ticks && age === Age.Primitive) {
      return {
        kind: "rewild",
        kicker: translateText("land_watch.rewild_kicker"),
        message: translateText("land_watch.rewild"),
      };
    }
    return null;
  }

  render() {
    const b = this.banner;
    if (b === null) return html``;
    return html`
      <div
        class="tc-land-watch tc-land-watch--${b.kind}"
        role="status"
        aria-live="polite"
        data-land-watch=${b.kind}
      >
        <div class="tc-land-watch__kicker">${b.kicker}</div>
        <div class="tc-land-watch__msg">${b.message}</div>
        ${b.fraction !== undefined
          ? html`<div class="tc-land-watch__wear" aria-hidden="true">
              <div style="width: ${Math.round(b.fraction * 100)}%"></div>
            </div>`
          : ""}
      </div>
    `;
  }
}
