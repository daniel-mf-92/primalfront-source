import { Age, Execution, Game, Player, ResourceKind } from "../game/Game";
import { TileRef } from "../game/GameMap";

// Per-harvest yield: how much of a node a single click extracts. Kept as a
// module constant (not Config) to avoid touching the shared Config.ts in this
// wave; the node is decremented and the player's pile grows by the amount
// actually taken (which is min(yield, remaining quantity)).
const YIELD_PER_HARVEST = 5;

// Module §8.3 — gathering always costs POPULATION: each resource unit harvested
// draws this many troops from the pile, so resources are never free (you trade
// people for materials). Clamped by removeTroops — a tribe with no troops simply
// can't gather. Tunable at balance.
const POP_COST_PER_HARVEST_UNIT = 5;

// HarvestExecution — single-shot, AUTHORITATIVE harvest of a wood/rock node
// (Module §4). Constructed from a client "harvest" intent ({player, tile}); the
// client controller's adjacency check is only a UX pre-filter — this execution
// NEVER trusts it and re-validates everything server-side before granting any
// resource.
//
// DETERMINISM: resolves entirely in init() with NO randomness — the outcome is
// a pure function of replicated map/player state, so every client computes the
// identical result. No per-tick work, no Math.random / Date.now.
export class HarvestExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    // Resolve once, then deactivate regardless of outcome (single-shot).
    this.active = false;

    // --- Server-side revalidation (reject silently on any failure) ---

    // Animal packs cannot gather resources (Module §1/§2).
    if (this.player.isAnimalPack()) return;
    // Primitive tribes gather by occupying/roaming over natural resources.
    if (this.player.age() === Age.Primitive) return;

    if (!mg.isValidRef(this.tile)) return;

    // Node must exist and be non-empty.
    const node = mg.resourceAt(this.tile);
    if (node.kind === ResourceKind.None || node.quantity <= 0) return;
    if (node.kind === ResourceKind.Fish) return;

    // Harvestable iff the player owns the node's tile OR owns any of its 8
    // neighbors (so a tribe can chop adjacent wilderness wood without first
    // capturing the tile). Re-derived here from authoritative ownership — never
    // from the client's claim.
    const mySmallID = this.player.smallID();
    let harvestable = mg.ownerID(this.tile) === mySmallID;
    if (!harvestable) {
      mg.forEachNeighborWithDiag(this.tile, (n: TileRef) => {
        if (mg.ownerID(n) === mySmallID) harvestable = true;
      });
    }
    if (!harvestable) return;

    // --- Grant ---
    const kind = node.kind;
    const got = mg.harvestResource(this.tile, YIELD_PER_HARVEST);
    if (got <= 0) return;
    this.player.addResource(kind, got);
    // Gathering costs population (Module §8.3): trade troops for materials.
    this.player.removeTroops(got * POP_COST_PER_HARVEST_UNIT);
    // No explicit recordResourceUpdate() needed: harvestResource() ->
    // setResource() already pushes the resource-tile delta (and clears the node
    // to None at 0) onto the renderer's drain queue, so a depleted node
    // disappears for the ResourceNodePass without a separate broadcast.
    // (recordResourceUpdate is an impl-only method, not on the GameMap
    // interface, so it is intentionally not called through `mg` here.)
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }
}
