import { Biome } from "./Game";
import { GameMap, TileRef } from "./GameMap";

// Biome is DERIVED, not stored — the terrain byte has no biome/temperature
// field (only land/shoreline/ocean/magnitude). We approximate it from latitude
// (map row) the way real climate bands work, with elevation pushing colder.
// Pure + deterministic: same (map, tile) always yields the same biome.
//
// latFromEquator: 0 at the map's middle row (equator), 1 at the top/bottom
// rows (poles). Bands (from config.biomeLatitudeBands()) are thresholds on that
// value, from pole to equator:
//   poles→Cold (ice), boreal→Forest, temperate→Green (plains),
//   sub-tropic dry→Arid, sub-tropic desert belt→Sandy, equatorial→Jungle.

// Latitude-fraction thresholds shared by the engine + renderer biome derivation.
// Each threshold is the LOWER edge (toward the equator) of that band; a tile
// belongs to the first band whose threshold its |lat| clears, pole→equator.
export type BiomeBands = {
  cold: number;
  forest: number;
  green: number;
  arid: number;
  sandy: number;
};

// --- Deterministic band-warp noise (de-stripes the latitude bands) ---
// Pure integer-hash value-noise so biome boundaries UNDULATE instead of running
// in perfectly horizontal latitude stripes. Lockstep-safe: integer hash + a
// polynomial (smoothstep) blend, NO transcendentals (sin/exp/pow diverge across
// platforms and would desync). Same (map row/col) ⇒ same warp, every client.
const BAND_WARP_CELL = 26; // lattice spacing (tiles) — coarse, smooth undulations
const BAND_WARP_AMPLITUDE = 0.13; // how far (in lat-fraction) a boundary can bend

// 32-bit integer hash of a lattice node → [0,1). Mixed enough to look random.
function latticeHash(ix: number, iy: number): number {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

// Smooth 2D value-noise in [0,1) at (x,y), bilinear over the lattice with a
// smoothstep (3t²−2t³) blend so there are no hard cell edges.
function bandWarpNoise(x: number, y: number): number {
  const gx = x / BAND_WARP_CELL;
  const gy = y / BAND_WARP_CELL;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = latticeHash(ix, iy);
  const n10 = latticeHash(ix + 1, iy);
  const n01 = latticeHash(ix, iy + 1);
  const n11 = latticeHash(ix + 1, iy + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

export function biomeAt(map: GameMap, tile: TileRef, bands: BiomeBands): Biome {
  const mag = map.magnitude(tile);
  // High elevation reads cold regardless of latitude (snow-capped highland).
  if (mag >= 24) return Biome.Cold;

  const h = map.height();
  let lat = h > 1 ? Math.abs(map.y(tile) / (h - 1) - 0.5) * 2 : 0;
  // De-stripe: bend the effective latitude up/down with smooth value-noise so the
  // band boundaries wander naturally instead of forming dead-straight horizontal
  // lines. ±BAND_WARP_AMPLITUDE in lat-fraction; clamped to [0,1].
  lat +=
    (bandWarpNoise(map.x(tile), map.y(tile)) - 0.5) * 2 * BAND_WARP_AMPLITUDE;
  // Highlands sit one band colder than their latitude would suggest.
  if (mag >= 16) lat += 0.15;
  lat = Math.max(0, Math.min(1, lat));

  if (lat >= bands.cold) return Biome.Cold;
  if (lat >= bands.forest) return Biome.Forest;
  if (lat >= bands.green) return Biome.Green;
  if (lat >= bands.arid) return Biome.Arid;
  if (lat >= bands.sandy) return Biome.Sandy;
  return Biome.Jungle;
}

// Woodland = the wooded climate bands (Forest = cool/wet woodland, Jungle =
// equatorial rainforest). Capturing woodland tiles costs extra population but
// yields the Primitive `wood` resource (see Config wood knobs + AttackExecution).
export function isWoodlandBiome(biome: Biome): boolean {
  return biome === Biome.Forest || biome === Biome.Jungle;
}

// Is this land tile woodland? Pure + deterministic (latitude/elevation only).
export function woodlandAt(
  map: GameMap,
  tile: TileRef,
  bands: BiomeBands,
): boolean {
  return map.isLand(tile) && isWoodlandBiome(biomeAt(map, tile, bands));
}

// Aesthetic tint per biome (multiplicative hint for renderers / minimap and a
// fallback when a biome/era-specific sprite asset does not yet exist).
export function biomeTint(biome: Biome): readonly [number, number, number] {
  switch (biome) {
    case Biome.Cold:
      return [210, 225, 235]; // pale icy blue-white
    case Biome.Forest:
      return [70, 140, 108]; // deep blue-pine
    case Biome.Green:
      return [120, 170, 90]; // verdant temperate mid-green
    case Biome.Arid:
      return [200, 170, 110]; // dry tan
    case Biome.Sandy:
      return [225, 205, 150]; // desert sand
    case Biome.Jungle:
      return [56, 175, 140]; // tropical teal-green
  }
}

// Stable lowercase slug per biome, used by the client to set [data-climate] on
// the document root so HUD CSS can recolor its accent to the player's climate.
// Indexed by enum VALUE (Cold=0..Jungle=5), not latitude order.
const BIOME_SLUGS = [
  "cold",
  "green",
  "arid",
  "sandy",
  "forest",
  "jungle",
] as const;

export function biomeSlug(biome: Biome): string {
  return BIOME_SLUGS[biome] ?? "green";
}
