import { Execution, Game, Unit } from "../game/Game";

// EonSite: a trickle node granting techPoints to whoever currently holds it.
// Deterministic — a flat per-tick techPoint grant to the current owner; no RNG.
export class EonSiteExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  constructor(private site: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.site.isActive()) {
      this.active = false;
      return;
    }
    // No trickle while still being built.
    if (this.site.isUnderConstruction()) {
      return;
    }
    // Grant techPoints to the current owner (transfers with capture).
    this.site
      .owner()
      .addTechPoints(this.mg.config().eonSiteTechPointsPerTick());
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
