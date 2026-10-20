import { Execution, Game, Unit } from "../game/Game";

// A Scout Lookout is a TEMPORARY Primitive structure (docs §9). Placed at the
// territory edge, it reveals nearby resources (handled client-side in
// GameView.isResourceVisible, which checks the player's live ScoutLookout units)
// while it stands, then ages out and self-destructs — like a Hut. It is never
// upgradeable. This execution owns only the lifespan; the reveal is pure
// presentation and never mutates sim state.
//
// Deterministic: lifespan is a fixed tick count from the scout's first live tick.
export class ScoutExecution implements Execution {
  private mg: Game;
  private active = true;
  private expireTick = -1;

  constructor(private scout: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.scout.isActive()) {
      this.active = false;
      return;
    }
    if (this.expireTick < 0) {
      this.expireTick = ticks + this.mg.config().scoutLifespanTicks();
      return;
    }
    if (ticks >= this.expireTick) {
      this.scout.delete();
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
