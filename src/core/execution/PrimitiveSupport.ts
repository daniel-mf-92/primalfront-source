import { Config } from "../configuration/Config";
import { biomeAt } from "../game/Biome";
import { Player, UnitType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { simpleHash } from "../Util";

// Shared, deterministic notion of "land a Primitive tribe HOLDS via a building".
// Both the active roam (PrimitiveMigrationExecution) and the idle settling pass
// (PlayerExecution.rewildUnsupportedFrontier) must agree byte-for-byte on which
// owned tiles are building-anchored, or the two systems disagree over the blob and
// you get the glitchy attrition feel. So they share THIS one helper.
//
// Design (owner-directed): you do NOT gain land by moving — the roving band stays a
// fixed-size irregular blob. Human tribes can hold extra ground by planting a
// primitive building, and that ground is held until the building EXPIRES (Huts and
// the temporary settlements self-destruct on a timer; once the unit is gone it is
// no longer in player.units(), so its tiles stop being anchored and re-wild). The
// HUT anchors the LARGEST area of any building (see Config.buildingSupportRadius) —
// it is the era's dedicated human land-holder. Primitive NPC callers may pass no
// anchors so their encampments relocate instead of leaving pinned patches behind.
//
// All integer / squared-distance math on replicated tile coordinates → lockstep-safe
// (no RNG, no transcendentals).

export interface SupportAnchor {
  x: number;
  y: number;
  r2: number;
}

export type PrimitiveVarianceKind = "capacity" | "attrition" | "favorability";

export function primitivePlayerVariability(
  player: Player,
  kind: PrimitiveVarianceKind,
): number {
  const hash = simpleHash(`${kind}:${player.id()}`);
  return 0.95 + (hash % 10001) / 100000;
}

// Collect every building the player owns as a {center, radius²} hold-zone, using
// the per-type radius. `radiusFor` lets a caller scale the base radius
// deterministically (animal-pack shrink / Classical widen); it defaults to identity
// (the Primitive-human roam case). Radii are floored to ≥1 so a zone is well-defined.
export function buildingAnchors(
  player: Player,
  map: GameMap,
  config: Config,
  radiusFor: (r: number) => number = (r) => r,
): SupportAnchor[] {
  const anchors: SupportAnchor[] = [];
  for (const type of [
    UnitType.Hut,
    UnitType.City,
    UnitType.ScoutLookout,
    UnitType.TradeOutpost,
    UnitType.PrimitiveFarm,
  ]) {
    const r = Math.max(
      1,
      Math.round(radiusFor(config.buildingSupportRadius(type))),
    );
    const r2 = r * r;
    for (const u of player.units(type)) {
      const t = u.tile();
      anchors.push({ x: map.x(t), y: map.y(t), r2 });
    }
  }
  return anchors;
}

// True if `tile` lies inside any building's hold-zone — i.e. it is anchored land the
// roam and the carrying-cap must NOT shed while that building stands.
export function anchoredByBuilding(
  tile: TileRef,
  map: GameMap,
  anchors: readonly SupportAnchor[],
): boolean {
  if (anchors.length === 0) {
    return false;
  }
  const tx = map.x(tile);
  const ty = map.y(tile);
  for (const a of anchors) {
    const dx = tx - a.x;
    const dy = ty - a.y;
    if (dx * dx + dy * dy <= a.r2) {
      return true;
    }
  }
  return false;
}

// Terrain scale drifts slowly as a blob roams; recomputing it on every
// migration step for 400+ bots was a measured hotspot. Anchor-less calls
// (all bots) are cached for 10 ticks per player — identical call sequences on
// every lockstep peer produce identical cache behaviour.
const terrainScaleCache = new WeakMap<Player, { tick: number; value: number }>();

export function primitiveTerrainCapacityScale(
  player: Player,
  map: GameMap,
  config: Config,
  anchors: readonly SupportAnchor[] = [],
  ticks = 0,
): number {
  const cacheable = anchors.length === 0;
  if (cacheable) {
    const hit = terrainScaleCache.get(player);
    if (hit !== undefined && ticks >= hit.tick && ticks - hit.tick < 10) {
      return hit.value;
    }
  }
  const value = computeTerrainCapacityScale(player, map, config, anchors, ticks);
  if (cacheable) {
    terrainScaleCache.set(player, { tick: ticks, value });
  }
  return value;
}

function computeTerrainCapacityScale(
  player: Player,
  map: GameMap,
  config: Config,
  anchors: readonly SupportAnchor[] = [],
  ticks = 0,
): number {
  let sum = 0;
  let count = 0;
  const bands = config.biomeLatitudeBands();
  // Perf: this runs per player per tick and blobs are large (capacity raised
  // 2026-07-02) — stride-sample to a bounded tile count. Set iteration order
  // is insertion order, which the lockstep sim reproduces identically on
  // every peer, so the sample (and therefore the scale) stays deterministic.
  const tiles = player.tilesRef();
  const MAX_SAMPLE = 128;
  const stride = tiles.size > MAX_SAMPLE ? Math.ceil(tiles.size / MAX_SAMPLE) : 1;
  let i = 0;
  for (const tile of tiles) {
    if (i++ % stride !== 0) {
      continue;
    }
    if (anchoredByBuilding(tile, map, anchors)) {
      continue;
    }
    const ice = config.climateTileIceFractionAtTick(map, tile, ticks);
    sum +=
      config.primitiveTerrainCapacityMult(map.terrainType(tile)) *
      config.primitiveBiomeCapacityMult(biomeAt(map, tile, bands)) *
      config.climateIceCapacityMult(ice);
    count++;
  }
  return count === 0 ? 1 : sum / count;
}

export function primitiveTerrainAdjustedCapacity(
  rawCapacity: number,
  player: Player,
  map: GameMap,
  config: Config,
  anchors: readonly SupportAnchor[] = [],
  ticks = 0,
): number {
  if (!Number.isFinite(rawCapacity)) {
    return rawCapacity;
  }
  return Math.max(
    config.carryingBaseTiles(player),
    Math.round(
      rawCapacity *
        primitiveTerrainCapacityScale(player, map, config, anchors, ticks) *
        primitivePlayerVariability(player, "capacity"),
    ),
  );
}
