import { Execution, Game, Player, Unit, UnitType } from "../game/Game";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private cost: bigint;

  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.structure = mg.unit(this.unitId);
    if (this.structure && this.structure.owner() !== this.player) {
      console.warn(`structure not owned by player`);
      this.structure = undefined;
    }

    if (this.structure === undefined) {
      console.warn(`structure is undefined`);
      return;
    }

    // A Hut is never upgraded; "upgrading" one of my Huts renews it (full
    // lifespan again, for a fraction of a new Hut's price).
    if (this.structure.type() === UnitType.Hut) {
      this.player.renewHut(this.structure);
      return;
    }

    if (!this.player.canUpgradeUnit(this.structure)) {
      console.warn(
        `[UpgradeStructureExecution] unit type ${this.structure.type()} cannot be upgraded`,
      );
      return;
    }
    this.player.upgradeUnit(this.structure);
    return;
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
