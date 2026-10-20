import { ResourceKind, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import { Controller } from "../Controller";
import type { ObjectiveID } from "../hud/layers/ObjectiveRail";
import {
  chooseObjective,
  computeAgeGates,
  computePrimitiveGoldPipeline,
} from "../hud/layers/ObjectiveRail";
import { MapRenderer } from "../render/gl";
import { GameView } from "../view";
import type { PlayerView } from "../view/PlayerView";

export type DirectorTargetKind = "economy" | "resource" | "settlement";

export interface DirectorTargetCandidate {
  tile: TileRef;
  kind: DirectorTargetKind;
  distance2: number;
}

const RESOURCE_OBJECTIVES: ReadonlySet<ObjectiveID> = new Set([
  "build_economy",
  "convert_resources",
  "find_resources",
]);

const SETTLEMENT_OBJECTIVES: ReadonlySet<ObjectiveID> = new Set([
  "advance_age",
  "found_city",
  "save_advance_toll",
]);

const ECONOMY_OBJECTIVES: ReadonlySet<ObjectiveID> = new Set([
  "build_keystone",
  "expand_defend",
  "generate_tech",
]);

export function chooseDirectorTarget(
  objective: ObjectiveID,
  candidates: readonly DirectorTargetCandidate[],
): TileRef | null {
  const preferredKinds = preferredTargetKinds(objective);
  for (const kind of preferredKinds) {
    const target = nearestCandidate(candidates, kind);
    if (target !== null) {
      return target.tile;
    }
  }
  return nearestCandidate(candidates, null)?.tile ?? null;
}

export class MapDirectorController implements Controller {
  constructor(
    private readonly game: GameView,
    private readonly view: MapRenderer,
  ) {}

  getTickIntervalMs(): number {
    return 1400;
  }

  tick(): void {
    if (this.game.inSpawnPhase()) return;

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) return;

    const objective = chooseObjective(
      player,
      this.game.config(),
      computeAgeGates(player, this.game.config()),
      computePrimitiveGoldPipeline(player, this.game.config()),
    );
    const anchor = this.findAnchor(player);
    if (anchor === null) return;

    const target = chooseDirectorTarget(
      objective.id,
      this.collectCandidates(player, anchor),
    );
    if (target === null) return;

    this.view.showMoveIndicator(
      this.game.x(target),
      this.game.y(target),
      player.smallID(),
    );
  }

  private collectCandidates(
    player: PlayerView,
    anchor: TileRef,
  ): DirectorTargetCandidate[] {
    const candidates: DirectorTargetCandidate[] = [];
    for (const type of [
      UnitType.City,
      UnitType.Hut,
      UnitType.PrimitiveFarm,
      UnitType.TradeOutpost,
      UnitType.Granary,
      UnitType.Factory,
      UnitType.Port,
    ]) {
      for (const unit of player.units(type)) {
        if (unit.isUnderConstruction()) continue;
        candidates.push({
          tile: unit.tile(),
          kind:
            type === UnitType.City || type === UnitType.Hut
              ? "settlement"
              : "economy",
          distance2: this.game.euclideanDistSquared(anchor, unit.tile()),
        });
      }
    }

    this.game.forEachTile((tile) => {
      const node = this.game.resourceAt(tile);
      if (node.kind === ResourceKind.None || node.quantity <= 0) return;
      if (!this.game.isResourceVisible(tile)) return;
      candidates.push({
        tile,
        kind: "resource",
        distance2: this.game.euclideanDistSquared(anchor, tile),
      });
    });

    return candidates;
  }

  private findAnchor(player: PlayerView): TileRef | null {
    for (const type of [
      UnitType.City,
      UnitType.Hut,
      UnitType.PrimitiveFarm,
      UnitType.TradeOutpost,
      UnitType.ScoutLookout,
      UnitType.TransportShip,
    ]) {
      const unit = player.units(type).find((u) => u.isActive());
      if (unit !== undefined) {
        return unit.tile();
      }
    }

    let ownedTile: TileRef | null = null;
    this.game.forEachTile((tile) => {
      if (ownedTile !== null) return;
      if (this.game.ownerID(tile) === player.smallID()) {
        ownedTile = tile;
      }
    });
    return ownedTile;
  }
}

function preferredTargetKinds(
  objective: ObjectiveID,
): readonly DirectorTargetKind[] {
  if (RESOURCE_OBJECTIVES.has(objective)) {
    return ["resource", "economy", "settlement"];
  }
  if (SETTLEMENT_OBJECTIVES.has(objective)) {
    return ["settlement", "economy", "resource"];
  }
  if (ECONOMY_OBJECTIVES.has(objective)) {
    return ["economy", "settlement", "resource"];
  }
  return ["settlement", "economy", "resource"];
}

function nearestCandidate(
  candidates: readonly DirectorTargetCandidate[],
  kind: DirectorTargetKind | null,
): DirectorTargetCandidate | null {
  let best: DirectorTargetCandidate | null = null;
  for (const candidate of candidates) {
    if (kind !== null && candidate.kind !== kind) continue;
    if (best === null || candidate.distance2 < best.distance2) {
      best = candidate;
    }
  }
  return best;
}
