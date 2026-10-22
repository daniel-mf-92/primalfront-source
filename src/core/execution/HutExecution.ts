import { Execution, Game, MessageType, Unit } from "../game/Game";

// A Hut is a TEMPORARY Primitive settlement (an outpost camp). It slowly ages
// and then SELF-DESTRUCTS — it is never upgradeable (its Config unit info is
// `upgradable: false`). To permanently anchor land and advance the era you must
// build a House (City), not nurse a hut. While it stands, a hut anchors nearby
// land against the Primitive rewild (see PlayerExecution.rewildUnsupportedFrontier).
//
// SEIZURE (owner-directed): when a hut is attacked and its tile is conquered the
// hut is CAPTURED by the new tile owner (PlayerExecution captures structures), and
// what happens next depends on WHO seized it:
//   - an ANIMAL PACK razes the camp → instant self-destruct;
//   - NEANDERTHALS cannot maintain a permanent camp → it degrades far faster (its
//     remaining lifespan is cut by config.neanderthalSeizedDecayFactor());
//   - a HUMAN TRIBE inherits the camp → the normal decline cycle continues.
//
// Deterministic: lifespan is a fixed tick count from the hut's first live tick;
// seizure handling keys off the replicated owner smallID — no RNG.
export class HutExecution implements Execution {
  private mg: Game;
  private active = true;
  private expireTick = -1;
  // Last owner renewal seen (Unit.renewedAt); a newer one restarts the clock.
  private renewedAt: number | null = null;
  // smallID of the hut's current owner; a change means it was seized. Anchored to
  // the BUILDER at construction (the hut is owned by its builder the moment it is
  // built) so a seizure is detected regardless of when this execution first ticks.
  private lastOwnerID: number;

  constructor(private hut: Unit) {
    this.lastOwnerID = hut.owner().smallID();
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.hut.isActive()) {
      this.active = false;
      return;
    }
    const owner = this.hut.owner();
    // Anchor the lifespan to the hut's first live tick (construction is already
    // complete by the time this execution runs). lastOwnerID is set in the ctor,
    // so a seizure that lands before this first tick is still caught below.
    if (this.expireTick < 0) {
      this.expireTick = ticks + this.mg.config().hutLifespanTicks();
      this.renewedAt = this.hut.renewedAt();
      return;
    }

    // Renewed by its owner: a full lifespan again from the renewal tick.
    const renewed = this.hut.renewedAt();
    if (renewed !== null && renewed !== this.renewedAt) {
      this.renewedAt = renewed;
      this.expireTick = renewed + this.mg.config().hutLifespanTicks();
    }

    // Seized since the last tick (territory conquered → structure captured).
    if (owner.smallID() !== this.lastOwnerID) {
      this.lastOwnerID = owner.smallID();
      if (owner.isAnimalPack()) {
        // Animals raid and raze the camp — it returns to the wild immediately.
        this.hut.delete();
        this.active = false;
        return;
      }
      if (owner.isNeanderthal()) {
        // Neanderthals can't hold a settled camp — accelerate its decline.
        const remaining = Math.max(0, this.expireTick - ticks);
        const factor = this.mg.config().neanderthalSeizedDecayFactor();
        this.expireTick = ticks + Math.floor(remaining * factor);
      }
      // A human tribe inherits the normal decline cycle — expireTick unchanged.
    }

    if (ticks >= this.expireTick) {
      // The camp is abandoned and returns to the wild. Say so: a Hut that
      // silently vanished, taking its land with it, read as a bug.
      if (owner.isPlayer() && !owner.isAnimalPack()) {
        this.mg.displayMessage(
          "events_display.hut_worn_away",
          MessageType.UNIT_DESTROYED,
          owner.id(),
        );
      }
      this.hut.delete();
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
