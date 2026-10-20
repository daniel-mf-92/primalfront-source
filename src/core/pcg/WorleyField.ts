/**
 * Seeded Worley / cellular field — the CLUSTERING layer for resource placement.
 *
 * Tile space is partitioned into coarse cells of `cellSize` tiles; each cell owns
 * one feature point (deterministically jittered inside it). For a tile we find the
 * nearest feature across the 3×3 neighbourhood and return the normalised distance
 * plus that cell's stable `value` ∈ [0,1). Gating on `value < richnessThreshold`
 * yields discrete resource STANDS / RANGES / FISHING-GROUNDS rather than uniform
 * speckle. Deterministic & transcendental-free except one `Math.sqrt` (exact &
 * platform-stable in IEEE-754, unlike sin/exp). See docs §12.1.
 */

import { rand2 } from "./Hash";

export interface WorleyResult {
  /** Distance to the nearest feature, in cell units (0 at a feature, ~1 at a border). */
  dist: number;
  /** Integer cell coords of the owning feature (stable per game) — a patch id. */
  cellX: number;
  cellY: number;
  /** Stable [0,1) value of the owning cell — gate on this for richness. */
  value: number;
}

const VAL_SEED_XOR = 0x85ebca6b;
const JIT_Y_SEED_XOR = 0x9e3779b9;

/**
 * Worley sample at tile (x,y). `cellSize` = tiles per coarse cell (bigger ⇒ bigger
 * patches, fewer of them).
 */
export function worley(
  x: number,
  y: number,
  seed: number,
  cellSize: number,
): WorleyResult {
  const cs = cellSize > 0 ? cellSize : 1;
  const cx = Math.floor(x / cs);
  const cy = Math.floor(y / cs);

  let best = Infinity;
  let bcx = cx;
  let bcy = cy;
  let bval = 0;

  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox;
      const gy = cy + oy;
      // Feature point: cell origin + jitter ∈ [0,1) per axis.
      const jx = (gx + rand2(gx, gy, seed)) * cs;
      const jy = (gy + rand2(gx, gy, (seed ^ JIT_Y_SEED_XOR) >>> 0)) * cs;
      const dx = x - jx;
      const dy = y - jy;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bcx = gx;
        bcy = gy;
        bval = rand2(gx, gy, (seed ^ VAL_SEED_XOR) >>> 0);
      }
    }
  }

  return { dist: Math.sqrt(best) / cs, cellX: bcx, cellY: bcy, value: bval };
}
