import { Execution, Game, Player, Unit } from "../game/Game";

// A Primitive Farm is a TEMPORARY "primitive factory" (docs/ICE_AGE_ECONOMY.md §B):
// it mints a slow, flat trickle of internal gold each tick to its owner, then ages
// out and self-destructs (never upgradeable), like a Hut. It is sized so that —
// IF it survives its full lifespan — total payout ≈ 130% of its build cost (a
// +30% return; see Config.primitiveFarmGoldPerTick). Because payout is a flat
// per-tick drip, cumulative output only crosses break-even at ~1/1.3 ≈ 77% of its
// life, so a farm that is RAIDED/CONQUERED (deleted) early has paid out LESS than
// it cost → a net loss. Thus "raid it and it's quickly loss-making" is emergent
// from early destruction — no separate damage state needed.
//
// Deterministic: fixed per-tick gold (integer bigint), lifespan a fixed tick count
// from the farm's first live tick. No RNG, no wall-clock.
export class FarmExecution implements Execution {
  private mg: Game;
  private active = true;
  private expireTick = -1;

  constructor(private farm: Unit) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.farm.isActive()) {
      this.active = false;
      return;
    }
    // Anchor the lifespan to the farm's first live tick (construction is already
    // complete by the time this execution runs), mirroring HutExecution.
    if (this.expireTick < 0) {
      this.expireTick = ticks + this.mg.config().primitiveFarmLifespanTicks();
    }

    // Factory output: a slow internal-gold drip to the current owner. (For a
    // Neanderthal owner addGold is a no-op — they "never any money".)
    const owner = this.farm.owner() as Player;
    const perTick = this.mg.config().primitiveFarmGoldPerTick();
    if (perTick > 0n) {
      owner.addGold(perTick);
      this.mg.stats().goldWork(owner, perTick);
    }

    if (ticks >= this.expireTick) {
      // The farm is worked out and returns to the wild.
      this.farm.delete();
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
