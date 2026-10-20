import { biomeAt } from "../game/Biome";
import {
  Execution,
  Game,
  Player,
  PlayerType,
  ResourceKind,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import {
  anchoredByBuilding,
  buildingAnchors,
  primitivePlayerVariability,
  primitiveTerrainAdjustedCapacity,
  SupportAnchor,
} from "./PrimitiveSupport";

interface MigrationFrame {
  centerX: number;
  centerY: number;
  dirX: number;
  dirY: number;
  velocityX: number;
  velocityY: number;
  nextCenterX: number;
  nextCenterY: number;
  majorRadius: number;
  minorRadius: number;
}

interface FrontierChoice {
  tile: TileRef;
  frame: MigrationFrame;
}

interface ProjectedPoint {
  forward: number;
  lateral: number;
  ellipse: number;
  dist2: number;
}

export class PrimitiveMigrationExecution implements Execution {
  private active = true;
  private mg: Game;
  private map: GameMap;

  constructor(
    private player: Player,
    private target: TileRef,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    this.mg = mg;
    this.map = mg.map();
    // Claim the newest clicked destination. This SUPERSEDES any older migration
    // (executions added earlier see a different migrationTarget() next tick and
    // step aside), so the blob follows the LATEST click instead of being tugged
    // toward several stale targets at once.
    this.player.beginMigration(this.target);
  }

  tick(): void {
    // A Classical kingdom shifts its borders 6x more slowly than a primitive
    // band. Applied as a stride rather than by scaling tiles-per-tick, because
    // that rate is already only 2-3 and would round away.
    const stride = this.mg.config().migrationTickStride(this.player.age());
    if (stride > 1 && this.mg.ticks() % stride !== 0) {
      return;
    }
    if (
      !this.player.isAlive() ||
      !this.mg.config().roamsByMigration(this.player.age()) ||
      !this.map.isLand(this.target)
    ) {
      this.finish();
      return;
    }

    // Superseded by a newer migration click → step aside WITHOUT clearing the
    // newer destination (the newer execution owns it now).
    if (this.player.migrationTarget() !== this.target) {
      this.active = false;
      return;
    }

    if (this.map.ownerID(this.target) === this.player.smallID()) {
      this.finish();
      return;
    }

    // Human-built camps deliberately anchor extra land. Primitive NPC camps are
    // different: their "expansion" is camp relocation, so old encampments do not
    // get to pin a second patch behind the roaming blob.
    const anchors =
      this.player.type() === PlayerType.Human
        ? buildingAnchors(this.player, this.map, this.mg.config())
        : [];
    // Perf: bots roam on alternate ticks with doubled steps — same net speed,
    // half the per-tick frontier scanning across ~400 bots. Humans stay
    // every-tick for input responsiveness. (ticks + smallID) is identical on
    // every lockstep peer, so the stagger is deterministic.
    const isBot = this.player.type() !== PlayerType.Human;
    if (isBot && (this.mg.ticks() + this.player.smallID()) % 2 !== 0) {
      this.recordMigrationStep(null);
      return;
    }
    // Bots do NOT get doubled steps on their active tick: per-step frontier
    // scanning dominates, so halving their tick cadence must genuinely halve
    // the work. Half-speed roam is fine for NPCs.
    const steps = this.migrationSteps(anchors);
    // Trim ONCE per tick (not per conquer) with a bounded shed budget so a
    // terrain-driven capacity drop eases off gradually — see trimToCapacity.
    const glide = this.mg.config().primitiveMigrationMaxShrinkPerTick();
    let moved = false;
    let added = 0;
    let lastFrame: MigrationFrame | null = null;
    for (let i = 0; i < steps; i++) {
      const choice = this.bestFrontierTile(anchors);
      if (choice === null) {
        // Blocked (no enterable frontier this tick): ease size if we moved, stop.
        if (moved) {
          this.trimToCapacity(anchors, added + glide);
        }
        this.finish();
        return;
      }

      const tile = choice.tile;
      lastFrame = choice.frame;
      this.player.conquer(tile);
      this.applyTerrainAttrition(tile);
      added++;
      // Pocket healing is a human-facing fix (misclick donuts); running it for
      // 400 roaming bots was a measured sim hotspot. Bots tolerate rare holes.
      if (this.player.type() === PlayerType.Human) {
        this.fillEnclosedPockets(tile);
      }
      moved = true;

      if (this.map.ownerID(this.target) === this.player.smallID()) {
        this.trimToCapacity(anchors, added + glide);
        this.recordMigrationStep(lastFrame);
        this.finish();
        return;
      }
    }

    if (moved) {
      this.trimToCapacity(anchors, added + glide);
      // Tell the passive rewild we are actively roaming this tick so it defers to
      // us (and refresh the grace window).
      this.recordMigrationStep(lastFrame);
    } else {
      this.finish();
    }
  }

  // Stop this execution and, if we still own the active destination, clear it so
  // the passive rewild resumes (gentle re-compaction at the new location). A
  // superseding execution keeps the destination, so only the final owner clears.
  private finish(): void {
    this.active = false;
    if (this.player.migrationTarget() === this.target) {
      this.player.endMigration();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  private bestFrontierTile(
    anchors: readonly SupportAnchor[],
  ): FrontierChoice | null {
    const frame = this.migrationFrame(anchors);
    if (frame === null) {
      return null;
    }
    const config = this.mg.config();
    const bands = config.biomeLatitudeBands();
    const personalFavorability = primitivePlayerVariability(
      this.player,
      "favorability",
    );
    let best: TileRef | null = null;
    let bestScore = Infinity;
    for (const border of this.player.borderTiles()) {
      for (const neighbor of this.map.neighbors(border)) {
        if (!this.canEnter(neighbor)) {
          continue;
        }
        const ownedNeighbors = this.ownedNeighborCount(neighbor);
        const projected = this.projectFromNextCenter(neighbor, frame);
        const outside = Math.max(0, projected.ellipse - 0.98);
        const insideCore = Math.max(0, 0.5 - projected.ellipse);
        const tooFarAhead = Math.max(
          0,
          projected.forward - frame.majorRadius * 0.82,
        );
        const tooFarBack = Math.max(
          0,
          -projected.forward - frame.majorRadius * 0.45,
        );
        const tooWide = Math.max(
          0,
          Math.abs(projected.lateral) - frame.minorRadius * 0.98,
        );
        const edgeTarget =
          0.82 +
          this.edgeRipple(neighbor, frame) *
            this.mg.config().primitiveMigrationBlobRoughness();
        const terrain = this.map.terrainType(neighbor);
        const resource = this.mg.resourceAt(neighbor);
        const tileIce = config.climateTileIceFractionAtTick(
          this.map,
          neighbor,
          this.mg.ticks(),
        );
        const friction =
          config.primitiveTerrainMigrationFriction(terrain) *
          config.climateIceMigrationFrictionMult(tileIce);
        const biome = biomeAt(this.map, neighbor, bands);
        const biomeFavorability =
          config.primitiveBiomeMigrationFavorability(biome) *
          personalFavorability;
        const resourceRelief =
          resource.kind === ResourceKind.None
            ? 0
            : config.primitiveResourceMigrationFrictionRelief(resource.kind);
        const terrainPenalty = Math.max(0, friction - 1 - resourceRelief);
        const icePenalty = tileIce * 1600;
        const biomePenalty = Math.max(0, 1 - biomeFavorability);
        const biomePull = Math.max(0, biomeFavorability - 1);
        // Resource attraction: a wild node ON the frontier tile strongly pulls
        // the advancing face onto it (owner direction 2026-07-04: tribes should
        // "fluidly roam the land looking for resources"). Base pull raised
        // 70->180 so a rich stand out-scores staying maximally compact — the
        // blob bends toward and settles on resources instead of ignoring them.
        const resourcePull =
          resource.kind === ResourceKind.None
            ? 0
            : Math.min(12, resource.quantity) *
              (180 + config.climateIceResourcePull(tileIce));
        // Owner direction (2026-07-02 refined 2026-07-04): the blob TRANSLATES
        // as a coherent mass (the ellipse walls do the heavy shaping) but must
        // not clump into a rigid brick — compactness was dominating so hard
        // (4200/neighbour) that resource and biome pulls could never bend the
        // frontier. Lowered 4200->1800 so the ellipse still keeps the face
        // together while resources/biome/terrain steer WHERE it flows: fluid
        // foraging, not an insanely bunched disc.
        const score =
          outside * outside * 140000 +
          insideCore * insideCore * 12000 +
          tooWide * tooWide * 34000 +
          tooFarAhead * tooFarAhead * 26000 +
          tooFarBack * tooFarBack * 24000 +
          Math.abs(projected.ellipse - edgeTarget) * 2400 +
          terrainPenalty * 3600 +
          icePenalty -
          biomePull * 2600 +
          biomePenalty * 4200 -
          resourcePull +
          projected.dist2 * 35 -
          projected.forward * 420 -
          ownedNeighbors * 1800;
        if (score < bestScore) {
          best = neighbor;
          bestScore = score;
        } else if (score === bestScore && best !== null && neighbor < best) {
          best = neighbor;
        }
      }
    }
    return best === null ? null : { tile: best, frame };
  }

  // A roaming blob must stay SOLID: the frontier scorer can route around a
  // tile (e.g. a resource node) and seal it in as an unowned enclave — the
  // player then "reaches" a resource only to own a donut around it (owner bug
  // report 2026-07-02). After each conquest step, flood any adjacent unowned
  // land pocket; if it is small and bounded ONLY by our land and/or water, it
  // is annexed. Deterministic (index-ordered BFS, no RNG), lockstep-safe.
  private static readonly HOLE_ANNEX_MAX = 16;

  private fillEnclosedPockets(around: TileRef): void {
    const myID = this.player.smallID();
    this.map.forEachNeighbor(around, (seed) => {
      if (
        !this.map.isLand(seed) ||
        this.map.ownerID(seed) !== 0 ||
        this.map.hasFallout(seed)
      ) {
        return;
      }
      const pocket: TileRef[] = [seed];
      const inPocket = new Set<TileRef>([seed]);
      let enclosed = true;
      for (let i = 0; i < pocket.length; i++) {
        if (pocket.length > PrimitiveMigrationExecution.HOLE_ANNEX_MAX) {
          enclosed = false;
          break;
        }
        this.map.forEachNeighbor(pocket[i], (n) => {
          if (!enclosed || inPocket.has(n)) return;
          if (!this.map.isLand(n)) return; // water bounds the pocket
          const o = this.map.ownerID(n);
          if (o === myID) return; // our land bounds it
          if (o !== 0 || this.map.hasFallout(n)) {
            enclosed = false; // foreign land / fallout: not an enclave of ours
            return;
          }
          // Open-field early abort: a genuine enclave tile always has SOME of
          // our land within its own neighbourhood. A tile with zero owned
          // neighbours means we are flooding open wilderness — bail before
          // burning the full pocket budget on every ordinary frontier step.
          let touchesUs = false;
          this.map.forEachNeighbor(n, (nn) => {
            if (this.map.ownerID(nn) === myID) touchesUs = true;
          });
          if (!touchesUs) {
            enclosed = false;
            return;
          }
          inPocket.add(n);
          pocket.push(n);
        });
        if (!enclosed) break;
      }
      if (enclosed) {
        for (const t of pocket) {
          this.player.conquer(t);
        }
      }
    });
  }

  private canEnter(tile: TileRef): boolean {
    return (
      this.map.isLand(tile) &&
      this.map.ownerID(tile) === 0 &&
      !this.map.hasFallout(tile)
    );
  }

  private migrationSteps(anchors: readonly SupportAnchor[]): number {
    let base = Math.max(
      1,
      Math.floor(this.mg.config().primitiveMigrationTilesPerTick(this.player)),
    );
    // Owner direction 2026-07-04: "territory should move 2x faster when clicking
    // terrain." A human-clicked migration is the responsive, input-driven case —
    // double its per-tick translation so the blob chases the click briskly. Bots
    // keep their (perf-tuned, half-cadence) roam speed unchanged.
    if (this.player.type() === PlayerType.Human) {
      base *= 2;
    }
    const capacity = this.migrationCapacity(anchors);
    const roving = this.rovingTileCount(anchors);
    if (roving >= capacity) {
      base = Math.min(base, 2);
    }
    const deficit = Math.max(0, capacity - roving);
    if (deficit <= 0) {
      return base;
    }
    return base + Math.min(10, Math.ceil(deficit / 6));
  }

  private rovingTileCount(anchors: readonly SupportAnchor[]): number {
    let count = 0;
    for (const tile of this.player.tilesRef()) {
      if (!anchoredByBuilding(tile, this.map, anchors)) {
        count++;
      }
    }
    return count;
  }

  private migrationCapacity(anchors: readonly SupportAnchor[]): number {
    return primitiveTerrainAdjustedCapacity(
      this.mg.config().primitiveMigrationCapacity(this.player),
      this.player,
      this.map,
      this.mg.config(),
      anchors,
      this.mg.ticks(),
    );
  }

  private applyTerrainAttrition(tile: TileRef): void {
    const config = this.mg.config();
    const terrain = this.map.terrainType(tile);
    const biome = biomeAt(this.map, tile, config.biomeLatitudeBands());
    const tileIce = config.climateTileIceFractionAtTick(
      this.map,
      tile,
      this.mg.ticks(),
    );
    let loss =
      config.primitiveTerrainMigrationAttrition(terrain) +
      config.primitiveBiomeMigrationAttrition(biome) +
      config.climateIceMigrationAttrition(tileIce);
    loss *= primitivePlayerVariability(this.player, "attrition");
    if (loss <= 0) {
      return;
    }
    const resource = this.mg.resourceAt(tile);
    if (resource.kind !== ResourceKind.None) {
      loss *=
        1 -
        Math.min(
          0.85,
          config.primitiveResourceMigrationAttritionRelief(resource.kind) +
            config.climateIceResourceAttritionRelief(tileIce),
        );
    }
    const rounded = Math.floor(loss);
    if (rounded > 0) {
      this.player.removeTroops(rounded);
    }
  }

  private recordMigrationStep(frame: MigrationFrame | null): void {
    if (frame === null) {
      this.player.recordMigrationStep();
      return;
    }
    this.player.recordMigrationStep(frame.velocityX, frame.velocityY);
  }

  // Trim the roving band back to its capacity. Owner-directed model: moving NEVER
  // gains land, so the band is a fixed-size (irregular) patch — but ONLY the
  // UNANCHORED roving tiles count toward the cap. Building-held land is carried on
  // top, untouched, until the building expires. So a tribe roaming AWAY from its Hut
  // leaves the Hut's claimed patch behind instead of shedding it (which is what made
  // the old roam feel like attrition). Shed from the tail of the travel vector,
  // balanced by lateral band, not farthest from the exact clicked tile, so off-axis
  // clicks translate the patch instead of shaving it into a line.
  private trimToCapacity(
    anchors: readonly SupportAnchor[],
    maxShed: number = Number.POSITIVE_INFINITY,
  ): void {
    const capacity = this.migrationCapacity(anchors);
    // Count only the unanchored roving blob — anchored land does not count.
    let roving = this.rovingTileCount(anchors);
    // maxShed bounds how much the blob may shrink THIS tick. The caller passes
    // (tiles added this tick + a small glide budget): pure translation sheds
    // exactly what it added (size held), but a terrain-driven capacity DROP is
    // only bled off `glide` tiles/tick, so harsher ground shrinks the tribe as
    // gradual attrition instead of a one-tick snap (owner direction 2026-07-04).
    let shed = 0;
    while (roving > capacity && shed < maxShed) {
      const frame = this.migrationFrame(anchors);
      if (frame === null) {
        return;
      }
      const tile = this.bestTailTile(anchors, frame);
      if (tile === null) {
        return;
      }
      this.player.relinquish(tile);
      roving--;
      shed++;
    }
  }

  // The unanchored border tile farthest behind the travel vector. Skips structure
  // tiles and any building-anchored tile — held land is never shed by a roam, only
  // by the building expiring. Distance from the next center is only a tie-breaker:
  // the primary rule must be directional, or a compact patch can delete its own
  // newly added front and stall.
  private bestTailTile(
    anchors: readonly SupportAnchor[],
    frame: MigrationFrame,
  ): TileRef | null {
    const structureTiles = new Set(
      this.player.units().map((unit) => unit.tile()),
    );
    let best: TileRef | null = null;
    let bestScore = -Infinity;
    for (const tile of this.player.borderTiles()) {
      if (structureTiles.has(tile)) {
        continue;
      }
      if (anchoredByBuilding(tile, this.map, anchors)) {
        continue;
      }
      const dx = this.map.x(tile) - frame.nextCenterX;
      const dy = this.map.y(tile) - frame.nextCenterY;
      const projected = this.projectFromNextCenter(tile, frame);
      const edgeHold = this.edgeRipple(tile, frame);
      const outside = Math.max(0, projected.ellipse - 0.98);
      const tooWide = Math.max(
        0,
        Math.abs(projected.lateral) - frame.minorRadius * 0.9,
      );
      const tailDepth = Math.max(
        0,
        -projected.forward - frame.majorRadius * 0.25,
      );
      const frontProtection = Math.max(0, projected.forward);
      const ownedNeighbors = this.ownedNeighborCount(tile);
      const score =
        outside * outside * 90000 +
        tooWide * tooWide * 28000 +
        tailDepth * tailDepth * 22000 -
        frontProtection * 2400 +
        -edgeHold * 2200 +
        (dx * dx + dy * dy) * 120 -
        ownedNeighbors * 550;
      if (score > bestScore) {
        best = tile;
        bestScore = score;
      } else if (score === bestScore && best !== null && tile > best) {
        best = tile;
      }
    }
    return best;
  }

  private migrationFrame(
    anchors: readonly SupportAnchor[],
  ): MigrationFrame | null {
    const rovingTiles: TileRef[] = [];
    let fallbackSumX = 0;
    let fallbackSumY = 0;
    let fallbackCount = 0;
    for (const tile of this.player.tilesRef()) {
      const x = this.map.x(tile);
      const y = this.map.y(tile);
      fallbackSumX += x;
      fallbackSumY += y;
      fallbackCount++;
      if (!anchoredByBuilding(tile, this.map, anchors)) {
        rovingTiles.push(tile);
      }
    }
    if (fallbackCount === 0) {
      return null;
    }

    let centerX: number;
    let centerY: number;
    if (rovingTiles.length > 0) {
      let sumX = 0;
      let sumY = 0;
      for (const tile of rovingTiles) {
        sumX += this.map.x(tile);
        sumY += this.map.y(tile);
      }
      centerX = sumX / rovingTiles.length;
      centerY = sumY / rovingTiles.length;
    } else {
      centerX = fallbackSumX / fallbackCount;
      centerY = fallbackSumY / fallbackCount;
    }

    const targetX = this.map.x(this.target);
    const targetY = this.map.y(this.target);
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) {
      return null;
    }
    const targetDirX = dx / len;
    const targetDirY = dy / len;
    const previous = this.player.migrationHeading();
    let velocityX = targetDirX;
    let velocityY = targetDirY;
    if (previous !== null) {
      const inertia = this.mg.config().primitiveMigrationHeadingInertia();
      const steer = 1 - inertia;
      velocityX = previous.x * inertia + targetDirX * steer;
      velocityY = previous.y * inertia + targetDirY * steer;
    }
    const velocityLen = Math.sqrt(
      velocityX * velocityX + velocityY * velocityY,
    );
    const dirX = velocityLen < 0.001 ? targetDirX : velocityX / velocityLen;
    const dirY = velocityLen < 0.001 ? targetDirY : velocityY / velocityLen;

    const frameTileCount =
      rovingTiles.length > 0 ? rovingTiles.length : this.player.numTilesOwned();
    const area = Math.max(frameTileCount, this.migrationCapacity(anchors));
    const baseRadius = Math.sqrt(area / Math.PI);
    const majorRadius = Math.max(3.2, baseRadius * 1.22);
    const minorRadius = Math.max(2.8, baseRadius * 0.92);

    return {
      centerX,
      centerY,
      dirX,
      dirY,
      velocityX,
      velocityY,
      nextCenterX: centerX + dirX,
      nextCenterY: centerY + dirY,
      majorRadius,
      minorRadius,
    };
  }

  private projectFromNextCenter(
    tile: TileRef,
    frame: MigrationFrame,
  ): ProjectedPoint {
    const dx = this.map.x(tile) - frame.nextCenterX;
    const dy = this.map.y(tile) - frame.nextCenterY;
    const forward = dx * frame.dirX + dy * frame.dirY;
    const lateral = dx * -frame.dirY + dy * frame.dirX;
    const forwardNorm = forward / frame.majorRadius;
    const lateralNorm = lateral / frame.minorRadius;
    return {
      forward,
      lateral,
      ellipse: forwardNorm * forwardNorm + lateralNorm * lateralNorm,
      dist2: dx * dx + dy * dy,
    };
  }

  private ownedNeighborCount(tile: TileRef): number {
    let count = 0;
    const ownerID = this.player.smallID();
    for (const neighbor of this.map.neighbors(tile)) {
      if (this.map.ownerID(neighbor) === ownerID) {
        count++;
      }
    }
    return count;
  }

  private edgeRipple(tile: TileRef, frame: MigrationFrame): number {
    const x = this.map.x(tile);
    const y = this.map.y(tile);
    const axis =
      Math.round(frame.dirX * 17) * 73856093 +
      Math.round(frame.dirY * 17) * 19349663;
    let h =
      (x * 1103515245) ^
      (y * 12345) ^
      (this.player.smallID() * 2654435761) ^
      axis;
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return ((h >>> 0) / 0xffffffff) * 2 - 1;
  }
}
