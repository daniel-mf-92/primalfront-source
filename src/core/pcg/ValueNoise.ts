/**
 * Seeded value noise — smooth [0,1) field used for resource DENSITY gradients
 * (dense patch core → feathered sparse edge). Bilinear interpolation of a hashed
 * lattice with a smoothstep fade. Deterministic & transcendental-free (see Hash.ts).
 */

import { rand2 } from "./Hash";

// smoothstep fade 6t^5-15t^4+10t^3 would need pow; cheap C1 cubic is enough here.
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Value noise in [0,1). `freq` = lattice cells per tile (smaller ⇒ smoother,
 * broader features). Sample at world tile coords (x,y).
 */
export function valueNoise(
  x: number,
  y: number,
  seed: number,
  freq: number,
): number {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = fade(fx - x0);
  const sy = fade(fy - y0);

  const v00 = rand2(x0, y0, seed);
  const v10 = rand2(x0 + 1, y0, seed);
  const v01 = rand2(x0, y0 + 1, seed);
  const v11 = rand2(x0 + 1, y0 + 1, seed);

  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

/**
 * Fractal value noise (fBm) in [0,1): sum of octaves at rising frequency / falling
 * amplitude. Good for natural-looking abundance fields.
 */
export function fbm(
  x: number,
  y: number,
  seed: number,
  freq: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amp = 1;
  let f = freq;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, (seed + o * 0x9e3779b9) >>> 0, f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
