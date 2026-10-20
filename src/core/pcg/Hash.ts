/**
 * Deterministic integer hashing for procedural generation.
 *
 * LOCKSTEP-SAFE: every function here is pure integer arithmetic (via `Math.imul`
 * and `>>> 0`) plus a single final divide. No `Math.random`, no `Date.now`, and
 * crucially NO transcendentals (`sin`/`exp`/`pow`) — those can differ in the last
 * ULP across platforms/engines and would desync an OpenFront lockstep sim. Seed
 * every call from a replicated value (e.g. `simpleHash(gameID)+offset`).
 *
 * AI-NOTE: keep this module transcendental-free — it feeds the SIM (resource
 * seeding, herd drift), not just the renderer. Fancy trig belongs in shaders. |
 * evidence: lockstep determinism (see docs/PRIMITIVE_ERA_REDESIGN.md §12.1)
 */

// 32-bit avalanche finalizer (MurmurHash3 fmix-style). Input/output uint32.
export function fmix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash a 2D integer coordinate + seed → uint32. */
export function hash2i(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = (Math.imul(h ^ (x | 0), 0x27d4eb2f) + 0x9e3779b9) >>> 0;
  h = (Math.imul(h ^ (y | 0), 0x165667b1) + 0x85ebca6b) >>> 0;
  return fmix32(h);
}

/** Hash a 1D integer + seed → uint32. */
export function hash1i(x: number, seed: number): number {
  return fmix32(
    (Math.imul((x | 0) ^ (seed >>> 0), 0x27d4eb2f) + 0x9e3779b9) >>> 0,
  );
}

const INV_2_32 = 1 / 4294967296; // 1 / 2^32

/** Uniform float in [0,1) from a 2D coord + seed. */
export function rand2(x: number, y: number, seed: number): number {
  return hash2i(x, y, seed) * INV_2_32;
}

/** Uniform float in [0,1) from a 1D index + seed. */
export function rand1(x: number, seed: number): number {
  return hash1i(x, seed) * INV_2_32;
}
