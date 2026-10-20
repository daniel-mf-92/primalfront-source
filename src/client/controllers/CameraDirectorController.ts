/**
 * CameraDirectorController — the "event director" of the cinematic camera.
 *
 * It watches the sim→view deltas for INVOLUNTARY combat drama aimed at the
 * local tribe (someone nuking you, a naval invasion inbound, a fresh land
 * raid) and briefly flies the camera to the highest-salience one so the
 * player is shown "shit happening" instead of missing it off-screen.
 *
 * Design guardrails (why this controller is shaped the way it is):
 *  - NEVER pings on the player's OWN orders/actions (their outgoing attacks,
 *    attack requests, conquests). Auto-jumping the camera on your own build/
 *    attack is the hated Northgard anti-pattern — we only react to things done
 *    TO the tribe. The importance table below is an allowlist of victim-side
 *    events; outgoingAttacks() is never even read.
 *  - SALIENCE gating: each candidate scores importance × recency × proximity;
 *    only the single highest candidate, and only above a threshold, ever pings.
 *  - COOLDOWN: a hard minimum gap between auto-pings so the camera can't be
 *    yanked around every tick during a sustained assault.
 *  - LOCK toggle: setEnabled(false) turns the whole thing off (default ON).
 *  - The user's hand always wins: a manual pan/zoom already interrupts any GoTo
 *    via TransformHandler.clearTarget()/suspendFollow(); we do nothing to fight
 *    that.
 *
 * Purely a sim→presentation reaction: it reads GameView + emits a client
 * GoToPositionEvent; it never mutates deterministic sim state.
 */
import { EventBus } from "../../core/EventBus";
import { MessageType, NameViewData } from "../../core/game/Game";
import {
  DisplayMessageUpdate,
  GameUpdateType,
  UnitIncomingUpdate,
} from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { GoToPositionEvent, TransformHandler } from "../TransformHandler";
import { GameView } from "../view";

// ── Tuning (exported so ⑤/tests can reference without magic numbers) ──────────

/** Minimum wall-clock gap between two auto-pings. */
export const AUTO_PING_COOLDOWN_MS = 6000;
/**
 * How long after a ping we hold follow OFF before handing control back to the
 * follow-cam. Must be long enough for the GoTo ease to actually arrive at the
 * drama (roughly matches TransformHandler.FOLLOW_REENGAGE_IDLE_MS) — restore
 * too early and the 16ms follow loop yanks the view straight back to the tribe.
 */
export const FOLLOW_RESTORE_DELAY_MS = 2600;
/** Salience floor — candidates below this never ping (kills far/minor noise). */
export const SALIENCE_THRESHOLD = 0.35;
/**
 * Distance (game tiles) at which proximity weight decays to its floor. Drama
 * landing right on the tribe scores ~1.0; drama this far away scores the floor.
 */
export const PROXIMITY_FALLOFF_TILES = 320;
/** Never fully zero out a distant event — huge drama (a nuke) can still win. */
export const MIN_PROXIMITY_WEIGHT = 0.15;

/**
 * Involuntary "shit happening to YOU" message types → base importance (0..1).
 * These are exactly the victim-side events; anything not in this map (attack
 * requests, your own conquest, alliances, donations, chat, trade) is ignored,
 * which is how we avoid pinging on the player's own orders.
 */
const DRAMA_IMPORTANCE: Partial<Record<MessageType, number>> = {
  // Inbound strategic weapons — maximum drama.
  [MessageType.HYDROGEN_BOMB_INBOUND]: 1.0,
  [MessageType.MIRV_INBOUND]: 1.0,
  [MessageType.NUKE_INBOUND]: 0.9,
  // A nuke actually detonating on you.
  [MessageType.NUKE_DETONATED]: 0.95,
  // A transport fleet landing on your coast.
  [MessageType.NAVAL_INVASION_INBOUND]: 0.7,
};

/** Base importance of a land raid, before the per-attack troop bonus. */
const RAID_BASE_IMPORTANCE = 0.45;
/** Extra importance a very large raid can add on top of the base. */
const RAID_TROOP_BONUS_CAP = 0.35;

interface DramaCandidate {
  x: number;
  y: number;
  /** Base importance (0..1) before proximity weighting. */
  importance: number;
}

export class CameraDirectorController implements Controller {
  private enabled = true;

  /** performance.now() of the last auto-ping (-Inf = never pinged yet). */
  private lastPingAt = Number.NEGATIVE_INFINITY;

  /**
   * Incoming-attack ids we've already reacted to. Rebuilt every tick from the
   * live incoming set so an attack that ends and later restarts (new id) can
   * ping again, while a sustained attack pings only once.
   */
  private seenAttacks = new Set<string>();

  /** Pending "hand follow back" timer; non-null means a ping is settling. */
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether follow was engaged when the (still-settling) ping started. */
  private followWasEngaged = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
  ) {}

  // ── Public lock (camera-lock toggle) ────────────────────────────────────

  /** Enable/disable auto-pinging. Default ON. Disabling mid-ping restores follow. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.restoreTimer !== null) {
      // We forced follow off for an in-flight ping; hand it straight back so
      // disabling the director never strands the camera out of follow mode.
      this.restoreFollow();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── Per-tick drama scan ─────────────────────────────────────────────────

  tick(): void {
    if (!this.enabled) return;

    const me = this.game.myPlayer();
    if (me === null || !me.isAlive()) return;
    // No drama pings during the spawn/placement phase.
    if (this.game.inSpawnPhase()) return;

    const myLoc = me.nameLocation();
    const candidates: DramaCandidate[] = [];

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      // Inbound threats (nuke / MIRV / H-bomb / naval invasion) aimed at us.
      for (const u of (updates[GameUpdateType.UnitIncoming] ??
        []) as UnitIncomingUpdate[]) {
        if (u.playerID !== me.smallID()) continue;
        const importance = DRAMA_IMPORTANCE[u.messageType];
        if (importance === undefined) continue;
        const pos = this.unitPos(u.unitID);
        if (pos !== null) candidates.push({ ...pos, importance });
      }

      // Display events addressed to us (e.g. a nuke detonating on the tribe).
      for (const d of (updates[GameUpdateType.DisplayEvent] ??
        []) as DisplayMessageUpdate[]) {
        if (d.playerID !== me.smallID()) continue;
        const importance = DRAMA_IMPORTANCE[d.messageType];
        if (importance === undefined) continue;
        const pos = this.displayEventPos(d);
        if (pos !== null) candidates.push({ ...pos, importance });
      }
    }

    // Fresh land raids on the tribe (involuntary by definition — these are
    // attacks TARGETING us). outgoingAttacks() is deliberately never read.
    const currentAttackIds = new Set<string>();
    for (const atk of me.incomingAttacks()) {
      currentAttackIds.add(atk.id);
      if (this.seenAttacks.has(atk.id)) continue; // already reacted to this raid
      const pos = this.raidPos(atk.attackerID, myLoc);
      if (pos !== null) {
        candidates.push({ ...pos, importance: raidImportance(atk.troops) });
      }
    }
    // Remember ongoing raids, forget ended ones (so a re-raid can ping again).
    this.seenAttacks = currentAttackIds;

    if (candidates.length === 0) return;

    // Salience = importance × proximity-to-tribe. (Recency is implicit: every
    // candidate here surfaced on THIS tick, so all are maximally recent.)
    let best: DramaCandidate | null = null;
    let bestSalience = 0;
    for (const c of candidates) {
      const salience = c.importance * this.proximityWeight(c.x, c.y, myLoc);
      if (best === null || salience > bestSalience) {
        best = c;
        bestSalience = salience;
      }
    }
    if (best === null || bestSalience < SALIENCE_THRESHOLD) return;

    const now = this.now();
    if (now - this.lastPingAt < AUTO_PING_COOLDOWN_MS) return; // cooldown gate

    this.ping(best.x, best.y, now);
  }

  // ── Ping / follow hand-off ──────────────────────────────────────────────

  private ping(x: number, y: number, now: number): void {
    this.lastPingAt = now;

    // AI-NOTE: setFollow(false) MUST precede the GoToPositionEvent — ①'s follow
    // loop re-asserts the camera every 16ms and would instantly override the
    // ping otherwise. Do not "simplify" by dropping/moving this call. |
    // evidence: tests/client/controllers/CameraDirectorController.test.ts
    // (setFollow(false) asserted before ping) + ①'s follow-cam gotcha.
    if (this.restoreTimer === null) {
      // Capture pre-drama follow state once; chained pings keep the original.
      this.followWasEngaged = this.transformHandler.isFollowing();
    } else {
      clearTimeout(this.restoreTimer);
    }

    this.transformHandler.setFollow(false);
    this.eventBus.emit(new GoToPositionEvent(x, y));

    this.restoreTimer = setTimeout(
      () => this.restoreFollow(),
      FOLLOW_RESTORE_DELAY_MS,
    );
  }

  /** Hand control back to the follow-cam once the ping has settled. */
  private restoreFollow(): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    // Only re-engage follow if it was engaged before we pinged — never force
    // follow ON in an age where the player had it off.
    if (this.followWasEngaged) {
      this.transformHandler.setFollow(true);
    }
  }

  /** Release the pending restore timer. Optional teardown hook for ⑤. */
  dispose(): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  // ── Position resolution helpers ─────────────────────────────────────────

  private unitPos(unitID: number): { x: number; y: number } | null {
    const unit = this.game.unit(unitID);
    if (unit === undefined) return null;
    const tile = unit.lastTile();
    return { x: this.game.x(tile), y: this.game.y(tile) };
  }

  private displayEventPos(
    d: DisplayMessageUpdate,
  ): { x: number; y: number } | null {
    if (d.unitID !== undefined) {
      const p = this.unitPos(d.unitID);
      if (p !== null) return p;
    }
    if (d.focusPlayerID !== undefined) {
      const pv = this.game.playerBySmallID(d.focusPlayerID);
      if (pv.isPlayer()) {
        const loc = pv.nameLocation();
        if (loc !== undefined && loc.size > 0) return { x: loc.x, y: loc.y };
      }
    }
    return null;
  }

  /**
   * Approximate where a raid reads as "happening": the midpoint between the
   * tribe centroid and the attacker's centroid (the front line lands between
   * them). Falls back to whichever centroid is known. We use this synchronous
   * proxy instead of the async attackClusteredPositions() worker round-trip so
   * the director stays a cheap, testable per-tick reaction.
   */
  private raidPos(
    attackerID: number,
    myLoc: NameViewData | undefined,
  ): { x: number; y: number } | null {
    const attacker = this.game.playerBySmallID(attackerID);
    const attackerLoc = attacker.isPlayer() ? attacker.nameLocation() : undefined;
    const meKnown = myLoc !== undefined && myLoc.size > 0;
    const atkKnown = attackerLoc !== undefined && attackerLoc.size > 0;
    if (meKnown && atkKnown) {
      return {
        x: (myLoc!.x + attackerLoc!.x) / 2,
        y: (myLoc!.y + attackerLoc!.y) / 2,
      };
    }
    if (atkKnown) return { x: attackerLoc!.x, y: attackerLoc!.y };
    if (meKnown) return { x: myLoc!.x, y: myLoc!.y };
    return null;
  }

  private proximityWeight(
    x: number,
    y: number,
    myLoc: NameViewData | undefined,
  ): number {
    if (myLoc === undefined || myLoc.size <= 0) return 1; // unknown center → neutral
    const dist = Math.hypot(x - myLoc.x, y - myLoc.y);
    const w = 1 - dist / PROXIMITY_FALLOFF_TILES;
    return Math.max(MIN_PROXIMITY_WEIGHT, Math.min(1, w));
  }

  /** Injection seam for deterministic tests. */
  protected now(): number {
    return performance.now();
  }
}

/** Land-raid importance: a base plus a gentle log-scaled troop bonus. */
export function raidImportance(troops: number): number {
  const bonus = Math.min(
    RAID_TROOP_BONUS_CAP,
    Math.log10(Math.max(1, troops)) / 15,
  );
  return RAID_BASE_IMPORTANCE + bonus;
}
