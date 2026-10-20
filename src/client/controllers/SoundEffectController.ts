import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { PlaySoundEffectEvent, SoundEffect } from "../sound/Sounds";
import type { PlayerView } from "../view";
import { GameView, UnitView } from "../view";

export class SoundEffectController implements Controller {
  private lastLocalAge: number | null = null;
  private lastResourcePileTotal: number | null = null;
  private lastResourceSoundTick = -Infinity;
  // Units whose death cue (interception / warship loss) has already played, so a
  // unit lingering in the dead state can't replay the sound every tick.
  private readonly deadAnnounced = new Set<number>();

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  tick(): void {
    const myPlayer = this.game.myPlayer();
    if (myPlayer !== null) {
      this.handleLocalPlayerPulse(myPlayer);
    }

    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      this.handleUnit(unit);
    }

    if (myPlayer === null) return;
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId === myPlayer.id()) {
        this.emit("ka-ching");
      }
    }
  }

  private handleUnit(unit: UnitView): void {
    if (unit.isActive() && unit.createdAt() === this.game.ticks()) {
      this.onCreated(unit);
    }
    switch (unit.type()) {
      case UnitType.AtomBomb:
      case UnitType.MIRVWarhead:
        this.onNukeOutcome(unit, "atom-hit");
        break;
      case UnitType.HydrogenBomb:
        this.onNukeOutcome(unit, "hydrogen-hit");
        break;
      case UnitType.Warship:
        this.onWarshipUpdate(unit);
        break;
    }
  }

  private onCreated(unit: UnitView): void {
    const myPlayer = this.game.myPlayer();
    switch (unit.type()) {
      case UnitType.AtomBomb:
        this.emit("atom-launch");
        break;
      case UnitType.HydrogenBomb:
        this.emit("hydrogen-launch");
        break;
      case UnitType.MIRV:
        this.emit("mirv-launch");
        break;
      case UnitType.Warship:
        if (unit.owner() === myPlayer) this.emit("build-warship");
        break;
      case UnitType.City:
        if (unit.owner() === myPlayer) this.emit("build-city");
        break;
      case UnitType.Hut:
      case UnitType.PrimitiveFarm:
      case UnitType.ScoutLookout:
      case UnitType.Palisade:
      case UnitType.Granary:
      case UnitType.ArtilleryFort:
      case UnitType.Factory:
      case UnitType.Airbase:
      case UnitType.SupplyDepot:
      case UnitType.Wonder:
      case UnitType.EonSite:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.TradeOutpost:
      case UnitType.Harbor:
        if (unit.owner() === myPlayer) this.emit("build-port");
        break;
      case UnitType.Port:
        if (unit.owner() === myPlayer) this.emit("build-port");
        break;
      case UnitType.DefensePost:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.SAMLauncher:
        if (unit.owner() === myPlayer) this.emit("sam-built");
        break;
      case UnitType.MissileSilo:
        if (unit.owner() === myPlayer) this.emit("silo-built");
        break;
    }
  }

  private handleLocalPlayerPulse(player: PlayerView): void {
    const age = player.age();
    if (this.lastLocalAge !== null && age > this.lastLocalAge) {
      this.emit("era-advance");
    }
    this.lastLocalAge = age;

    // AI-NOTE: post-R13 all per-kind getters (wood/rocks/meat/fish/slaves) alias the SAME unified
    // _resources pool, so summing them would 5x the pool and fire ka-ching spuriously. Read the pool
    // once via a single getter. | evidence: PlayerImpl _resources aliases; integration fix 2026-06-21
    // | expires: when per-kind getters diverge again (they will not under the unified-pool model)
    const resourcePileTotal = player.wood();
    if (
      this.lastResourcePileTotal !== null &&
      resourcePileTotal > this.lastResourcePileTotal &&
      this.game.ticks() - this.lastResourceSoundTick >= 15
    ) {
      this.emit("ka-ching");
      this.lastResourceSoundTick = this.game.ticks();
    }
    this.lastResourcePileTotal = resourcePileTotal;
  }

  private onNukeOutcome(unit: UnitView, detonationSound: SoundEffect): void {
    if (unit.isActive()) return;
    if (unit.reachedTarget()) {
      this.emit(detonationSound);
      return;
    }
    // Inactive without reaching its target = intercepted (e.g. by a SAM).
    // Announce once per unit so a lingering dead unit can't replay the cue.
    if (this.deadAnnounced.has(unit.id())) return;
    this.deadAnnounced.add(unit.id());
    this.emit("sam-hit");
  }

  private onWarshipUpdate(unit: UnitView): void {
    if (unit.isActive()) return;
    if (unit.owner() !== this.game.myPlayer()) return;
    if (this.deadAnnounced.has(unit.id())) return;
    this.deadAnnounced.add(unit.id());
    this.emit("warship-lost");
  }

  private emit(sound: SoundEffect): void {
    this.eventBus.emit(new PlaySoundEffectEvent(sound));
  }
}
