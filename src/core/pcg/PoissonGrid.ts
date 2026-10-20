/**
 * Deterministic blue-noise / Poisson-disk spacing on a tile grid.
 *
 * `isPoissonSample` accepts a tile iff its hashed priority is the strict maximum
 * among all tiles within `minDist` (a "local maximum of a random field" — a known
 * deterministic blue-noise approximation). This guarantees no two accepted samples
 * are closer than `minDist` AND that they're evenly spread, so a resource stand
 * reads like a real stand (gaps, no stacking, no salt-and-pepper). Stateless,
 * order-independent, fully deterministic — ideal for lockstep. Keep `minDist`
 * small (cost is O(minDist²) per query). See docs §12.1.
 */

import { rand2 } from "./Hash";

/**
 * Is tile (x,y) a blue-noise sample at spacing `minDist` for this `seed`?
 * Ties (astronomically rare with 32-bit hashes) break by lexicographic position
 * so exactly one of a tied pair wins — never both, never neither.
 */
export function isPoissonSample(
  x: number,
  y: number,
  seed: number,
  minDist: number,
): boolean {
  if (minDist <= 1) return true; // every tile is its own sample
  const p = rand2(x, y, seed);
  const r = Math.ceil(minDist);
  const r2 = minDist * minDist;
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      if (ox === 0 && oy === 0) continue;
      if (ox * ox + oy * oy > r2) continue; // circular neighbourhood
      const q = rand2(x + ox, y + oy, seed);
      if (q > p) return false;
      if (q === p) {
        // Deterministic tie-break: the lexicographically-smaller neighbour wins,
        // so this tile loses (returns false) only if such a neighbour exists.
        if (oy < 0 || (oy === 0 && ox < 0)) return false;
      }
    }
  }
  return true;
}
