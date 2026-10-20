import { Execution, Game, Unit } from "../game/Game";

// A Trade Outpost is a TEMPORARY Primitive economy structure (docs/ICE_AGE_ECONOMY.md
// §B). While it stands it SPEEDS the owner's passive resource→gold internal economy
// (see PlayerExecution.convertResourcesToGold, which reads the owner's owned-outpost
// count, capped at config.tradeOutpostMaxCount()). It ages out and self-destructs
// like a Hut — it is never upgradeable. The outpost has no per-tick logic of its own;
// its effect is entirely the conversion multiplier applied elsewhere, so this
// execution only owns the lifespan/expiry (cloned from HutExecution).
//
// Deterministic: lifespan is a fixed tick count from the outpost's first live tick.
export class TradeOutpostExecution implements Execution {
  private mg: Game;
  private active = true;
  private expireTick = -1;

  constructor(private outpost: Unit) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.outpost.isActive()) {
      this.active = false;
      return;
    }
    if (this.expireTick < 0) {
      this.expireTick = ticks + this.mg.config().tradeOutpostLifespanTicks();
      return;
    }
    if (ticks >= this.expireTick) {
      this.outpost.delete();
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
