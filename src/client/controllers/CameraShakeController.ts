import { EventBus } from "../../core/EventBus";
import { GameUpdates, UnitType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import {
  ScreenFlashEvent,
  ScreenShakeEvent,
  ZoomPunchEvent,
} from "../render/ScreenShake";
import { SendRaidIntentEvent } from "../Transport";
import { GameView, PlayerView, UnitView } from "../view";

// Trauma per nuke type on detonation. H-bomb is the heaviest jolt, atom the
// lightest. Tuned to read as "weight", not to obscure the map. This is the
// reference band (0.55–1.0) the primitive-era combat traumas are balanced
// against: routine warfare must rumble UNDER a nuke, never louder.
const NUKE_SHAKE: Partial<Record<UnitType, number>> = {
  [UnitType.AtomBomb]: 0.55,
  [UnitType.MIRVWarhead]: 0.7,
  [UnitType.HydrogenBomb]: 1.0,
};

// Full-screen wash per nuke type on detonation: a warm blast tint whose peak
// intensity follows the shake band. Single decay, capped renderer-side.
const NUKE_FLASH_ALPHA: Partial<Record<UnitType, number>> = {
  [UnitType.AtomBomb]: 0.14,
  [UnitType.MIRVWarhead]: 0.18,
  [UnitType.HydrogenBomb]: 0.26,
};
const NUKE_FLASH_RGB = [1.0, 0.82, 0.6] as const;
const NUKE_FLASH_DURATION_MS = 550;

// Conquest washes: being wiped reads as a red slam; wiping someone as a brief
// warm triumph. Both far below the readability cap.
const CONQUERED_SELF_FLASH = {
  rgb: [0.9, 0.16, 0.1] as const,
  alpha: 0.22,
  durationMs: 900,
};
const CONQUEROR_SELF_FLASH = {
  rgb: [1.0, 0.85, 0.4] as const,
  alpha: 0.12,
  durationMs: 500,
};

// --- Primitive-era combat trauma -------------------------------------------
// Deliberately below the nuke band, and every value hard-capped, so a busy
// battle jolts the world without ever nauseating. Each source funnels into a
// channel with a cooldown + aggregation so a burst (e.g. 40 tiles lost in one
// tick, or five raids at once) collapses into ONE jolt, not a seizure.
//
// Cooldowns are in SIM TICKS (~10Hz), so 4 ticks ≈ 0.4s.

// Being attacked: a NEW incoming land attack on the local player. A base jolt
// so even a probing attack registers, plus a gentle troop-scaled bump.
const ATTACK_TRAUMA_BASE = 0.12;
const ATTACK_TRAUMA_PER_TROOP = 0.0004;
const ATTACK_TRAUMA_MAX = 0.4;
const ATTACK_COOLDOWN_TICKS = 4;

// The local player LAUNCHES a raid (Module §6). An aggressive, satisfying jolt
// — a touch smaller than being hit, since it's our own doing. A raid landing on
// the DEFENDER emits no client signal (RaidExecution is single-shot, no attack
// object, no DisplayEvent), so this outgoing intent is the only reliable raid
// hook — see SendRaidIntentEvent in Transport.ts.
const RAID_LAUNCH_TRAUMA = 0.18;
const RAID_COOLDOWN_TICKS = 4;

// Losing tiles: per-tile trauma, SUMMED over the cooldown window so a 40-tile
// collapse in one tick — or a slow bleed across ticks — folds into one jolt.
const TILE_LOSS_TRAUMA_PER_TILE = 0.012;
const TILE_LOSS_TRAUMA_MAX = 0.35;
const TILE_LOSS_COOLDOWN_TICKS = 6;

// Conquest involving the local player (proximity to distant conquests isn't
// cheaply knowable client-side, so we shake only for conquests that are clearly
// about us — our tribe, or a tribe we just wiped).
const CONQUERED_SELF_TRAUMA = 0.85; // our tribe is wiped — heaviest combat jolt
const CONQUEROR_SELF_TRAUMA = 0.45; // we wiped someone — triumphant
const CONQUEST_COOLDOWN_TICKS = 3;

/** How a channel folds many events in one window into a single jolt. */
type Aggregate = "sum" | "max";

/**
 * A cooldown-gated, aggregating shake source. Events add trauma into `pending`;
 * `flush` emits at most one ScreenShakeEvent per `cooldownTicks`, sized by the
 * accumulated pending and clamped to `cap`. This is what stops a burst of
 * simultaneous combat events from turning into a screen-destroying seizure.
 */
interface ShakeChannel {
  readonly cooldownTicks: number;
  readonly cap: number;
  readonly aggregate: Aggregate;
  pending: number;
  lastEmitTick: number;
}

function makeChannel(
  cooldownTicks: number,
  cap: number,
  aggregate: Aggregate,
): ShakeChannel {
  return { cooldownTicks, cap, aggregate, pending: 0, lastEmitTick: -Infinity };
}

/**
 * Emits ScreenShakeEvents as a purely presentational reaction to sim events —
 * it reads GameView and emits a client event, never mutating sim state.
 *
 * Two families:
 *  - Nuke detonations: an immediate, per-unit-deduped jolt (mirrors
 *    SoundEffectController's detonation detection).
 *  - Primitive-era combat: being attacked, launching a raid, losing tiles, and
 *    conquests involving the local player. Each runs through a cooldown +
 *    aggregation channel so bursts collapse into single, bounded jolts.
 */
export class CameraShakeController implements Controller {
  private readonly shaken = new Set<number>();

  // Incoming-attack IDs already jolted, so a persistent attack only shakes once
  // when it first appears; pruned as attacks end so the set can't grow forever.
  private readonly seenIncomingAttacks = new Set<string>();
  private lastTilesOwned: number | null = null;

  private readonly attackChannel = makeChannel(
    ATTACK_COOLDOWN_TICKS,
    ATTACK_TRAUMA_MAX,
    "max",
  );
  private readonly raidChannel = makeChannel(
    RAID_COOLDOWN_TICKS,
    RAID_LAUNCH_TRAUMA,
    "max",
  );
  private readonly tileLossChannel = makeChannel(
    TILE_LOSS_COOLDOWN_TICKS,
    TILE_LOSS_TRAUMA_MAX,
    "sum",
  );
  private readonly conquestChannel = makeChannel(
    CONQUEST_COOLDOWN_TICKS,
    1,
    "max",
  );

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {
    // The local player launching a raid is a client-only UI action (radial
    // menu), so this is inherently local — no owner check needed.
    this.eventBus.on(SendRaidIntentEvent, () => {
      this.add(this.raidChannel, RAID_LAUNCH_TRAUMA);
    });
  }

  tick(): void {
    const tick = this.game.ticks();
    const updates = this.game.updatesSinceLastTick();

    if (updates) {
      for (const u of updates[GameUpdateType.Unit] ?? []) {
        const unit = this.game.unit(u.id);
        if (unit === undefined) continue;
        this.maybeShakeNuke(unit);
      }
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer !== null) {
      this.detectIncomingAttacks(myPlayer);
      this.detectTileLoss(myPlayer);
      if (updates) this.detectConquest(myPlayer, updates);
    }

    // Flush every channel unconditionally (even on an empty tick) so pending
    // trauma held back by a cooldown is released once the window elapses.
    this.flush(this.attackChannel, tick);
    this.flush(this.raidChannel, tick);
    this.flush(this.tileLossChannel, tick);
    this.flush(this.conquestChannel, tick);
  }

  // --- Nuke path (immediate, unchanged behaviour) --------------------------

  private maybeShakeNuke(unit: UnitView): void {
    const magnitude = NUKE_SHAKE[unit.type()];
    if (magnitude === undefined) return;
    // A detonation is an inactive warhead that reached its target (an
    // intercepted nuke goes inactive without reaching — no shake).
    if (unit.isActive()) return;
    if (!unit.reachedTarget()) return;
    if (this.shaken.has(unit.id())) return;
    this.shaken.add(unit.id());
    this.eventBus.emit(new ScreenShakeEvent(magnitude));
    // Correlated channels: the jolt lands with a punch-in and a blast wash,
    // so a detonation is felt in camera, zoom and light at once.
    this.eventBus.emit(new ZoomPunchEvent(magnitude * 0.8));
    const flashAlpha = NUKE_FLASH_ALPHA[unit.type()];
    if (flashAlpha !== undefined) {
      this.eventBus.emit(
        new ScreenFlashEvent(
          NUKE_FLASH_RGB[0],
          NUKE_FLASH_RGB[1],
          NUKE_FLASH_RGB[2],
          flashAlpha,
          NUKE_FLASH_DURATION_MS,
        ),
      );
    }
  }

  // --- Combat detection (channelled) ---------------------------------------

  private detectIncomingAttacks(myPlayer: PlayerView): void {
    const incoming = myPlayer.incomingAttacks();
    const live = new Set<string>();
    for (const atk of incoming) {
      live.add(atk.id);
      if (this.seenIncomingAttacks.has(atk.id)) continue;
      this.seenIncomingAttacks.add(atk.id);
      const trauma = Math.min(
        ATTACK_TRAUMA_MAX,
        ATTACK_TRAUMA_BASE + atk.troops * ATTACK_TRAUMA_PER_TROOP,
      );
      this.add(this.attackChannel, trauma);
    }
    // Forget attacks that ended so the set stays bounded over a long game.
    for (const id of this.seenIncomingAttacks) {
      if (!live.has(id)) this.seenIncomingAttacks.delete(id);
    }
  }

  private detectTileLoss(myPlayer: PlayerView): void {
    const tiles = myPlayer.numTilesOwned();
    if (this.lastTilesOwned !== null && tiles < this.lastTilesOwned) {
      const lost = this.lastTilesOwned - tiles;
      this.add(this.tileLossChannel, lost * TILE_LOSS_TRAUMA_PER_TILE);
    }
    this.lastTilesOwned = tiles;
  }

  private detectConquest(myPlayer: PlayerView, updates: GameUpdates): void {
    const myID = myPlayer.id();
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conqueredId === myID) {
        this.add(this.conquestChannel, CONQUERED_SELF_TRAUMA);
        this.eventBus.emit(new ZoomPunchEvent(0.55));
        this.eventBus.emit(
          new ScreenFlashEvent(
            CONQUERED_SELF_FLASH.rgb[0],
            CONQUERED_SELF_FLASH.rgb[1],
            CONQUERED_SELF_FLASH.rgb[2],
            CONQUERED_SELF_FLASH.alpha,
            CONQUERED_SELF_FLASH.durationMs,
          ),
        );
      } else if (c.conquerorId === myID) {
        this.add(this.conquestChannel, CONQUEROR_SELF_TRAUMA);
        this.eventBus.emit(new ZoomPunchEvent(0.3));
        this.eventBus.emit(
          new ScreenFlashEvent(
            CONQUEROR_SELF_FLASH.rgb[0],
            CONQUEROR_SELF_FLASH.rgb[1],
            CONQUEROR_SELF_FLASH.rgb[2],
            CONQUEROR_SELF_FLASH.alpha,
            CONQUEROR_SELF_FLASH.durationMs,
          ),
        );
      }
    }
  }

  // --- Channel plumbing ----------------------------------------------------

  private add(ch: ShakeChannel, trauma: number): void {
    if (!(trauma > 0)) return;
    ch.pending =
      ch.aggregate === "sum"
        ? ch.pending + trauma
        : Math.max(ch.pending, trauma);
  }

  private flush(ch: ShakeChannel, tick: number): void {
    if (ch.pending <= 0) return;
    if (tick - ch.lastEmitTick < ch.cooldownTicks) return;
    this.eventBus.emit(new ScreenShakeEvent(Math.min(ch.cap, ch.pending)));
    ch.pending = 0;
    ch.lastEmitTick = tick;
  }
}
