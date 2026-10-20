import { Execution, Game, Player, Tick, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { EonSiteExecution } from "./EonSiteExecution";
import { FactoryExecution } from "./FactoryExecution";
import { FarmExecution } from "./FarmExecution";
import { HutExecution } from "./HutExecution";
import { TradeOutpostExecution } from "./TradeOutpostExecution";
import { MirvExecution } from "./MIRVExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { NukeExecution } from "./NukeExecution";
import { PortExecution } from "./PortExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";
import { ScoutExecution } from "./ScoutExecution";
import { WarshipExecution } from "./WarshipExecution";

export class ConstructionExecution implements Execution {
  private structure: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
    private rocketDirectionUp?: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (this.mg.config().isUnitDisabled(this.constructionType)) {
      console.warn(
        `cannot build construction ${this.constructionType} because it is disabled`,
      );
      this.active = false;
      return;
    }

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`cannot build construction invalid tile ${this.tile}`);
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    if (this.structure === null) {
      const info = this.mg.unitInfo(this.constructionType);
      // For non-structure units (nukes/warship), charge once and delegate to specialized executions.
      const isStructure = this.isStructure(this.constructionType);
      if (!isStructure) {
        // Defer validation and gold deduction to the specific execution
        this.completeConstruction();
        this.active = false;
        return;
      }

      // Structures: build real unit and mark under construction
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      this.structure = this.player.buildUnit(
        this.constructionType,
        spawnTile,
        {},
      );
      const duration = info.constructionDuration ?? 0;
      if (duration > 0) {
        this.structure.setUnderConstruction(true);
        this.ticksUntilComplete = duration;
        return;
      }
      // No construction time
      this.completeConstruction();
      // Every structure (Hut included) is done once built — a Hut's lifespan is
      // owned by HutExecution (added in completeConstruction), not this timer.
      this.active = false;
      return;
    }

    if (!this.structure.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.structure.owner()) {
      this.player = this.structure.owner();
    }

    if (this.ticksUntilComplete === 0) {
      this.player = this.structure.owner();
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    if (this.structure) {
      this.structure.setUnderConstruction(false);
    }
    const player = this.player;
    switch (this.constructionType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        this.mg.addExecution(
          new NukeExecution(
            this.constructionType,
            player,
            this.tile,
            null,
            -1,
            0,
            this.rocketDirectionUp,
          ),
        );
        break;
      case UnitType.MIRV:
        this.mg.addExecution(new MirvExecution(player, this.tile));
        break;
      case UnitType.Warship:
        this.mg.addExecution(
          new WarshipExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(this.structure!));
        break;
      case UnitType.MissileSilo:
        this.mg.addExecution(new MissileSiloExecution(this.structure!));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(this.structure!));
        break;
      case UnitType.SAMLauncher:
        this.mg.addExecution(
          new SAMLauncherExecution(player, null, this.structure!),
        );
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(this.structure!));
        break;
      case UnitType.Hut:
        // Temporary Primitive settlement: ages out + self-destructs (HutExecution).
        this.mg.addExecution(new HutExecution(this.structure!));
        break;
      case UnitType.PrimitiveFarm:
        // Temporary primitive factory: drips internal gold, then ages out (FarmExecution).
        this.mg.addExecution(new FarmExecution(this.structure!));
        break;
      case UnitType.TradeOutpost:
        // Temporary economy structure: speeds resource→gold while it stands, then
        // ages out (TradeOutpostExecution).
        this.mg.addExecution(new TradeOutpostExecution(this.structure!));
        break;
      case UnitType.ScoutLookout:
        // Temporary Primitive scout post: reveals nearby resources, then ages
        // out + self-destructs (ScoutExecution).
        this.mg.addExecution(new ScoutExecution(this.structure!));
        break;
      case UnitType.Factory:
        this.mg.addExecution(new FactoryExecution(this.structure!));
        break;
      case UnitType.EonSite:
        // Trickle node: grants techPoints to its current owner each tick.
        this.mg.addExecution(new EonSiteExecution(this.structure!));
        break;
      case UnitType.ArtilleryFort:
      case UnitType.Airbase:
      case UnitType.SupplyDepot:
      case UnitType.Wonder:
        // ArtilleryFort/Airbase: TODO(eonfront): ranged/air projectile combat
        // (Module B). SupplyDepot relief is queried via owned-depot count +
        // Config.supplyDepotReliefPerDepot() by the attrition/integration modules.
        // Wonder renown is applied via Config.renownPerTick (Module G picks it up).
        // For now all behave as fortified structures (DefensePost defensive path)
        // so they are placeable, gated, and contribute defense.
        this.mg.addExecution(new DefensePostExecution(this.structure!));
        break;
      case UnitType.Palisade:
      case UnitType.Granary:
      case UnitType.Harbor:
        // Passive structures: no per-tick execution needed. Palisade defense is
        // applied via the structure's presence (DefensePost defense path),
        // Granary is counted by techPointsPerTick, Harbor income by goldAdditionRate.
        break;
      default:
        console.warn(
          `unit type ${this.constructionType} cannot be constructed`,
        );
        break;
    }
  }

  private isStructure(type: UnitType): boolean {
    switch (type) {
      case UnitType.Port:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Hut:
      case UnitType.ScoutLookout:
      case UnitType.Factory:
      case UnitType.Palisade:
      case UnitType.Granary:
      case UnitType.ArtilleryFort:
      case UnitType.Harbor:
      case UnitType.Airbase:
      case UnitType.SupplyDepot:
      case UnitType.Wonder:
      case UnitType.EonSite:
      case UnitType.PrimitiveFarm:
      case UnitType.TradeOutpost:
        return true;
      default:
        return false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
