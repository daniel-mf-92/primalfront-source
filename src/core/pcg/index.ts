/**
 * Deterministic procedural-generation core (lockstep-safe).
 *
 * One tested PCG toolkit, many consumers: static resource seeding
 * (`ResourceSeedExecution` — wood/rock/fish stands) and dynamic life
 * (`HerdManager`/`FishField` drift). See docs/PRIMITIVE_ERA_REDESIGN.md §12.
 *
 * Layered placement recipe:
 *   eligible(terrain) × inRichCell(worley) × density(valueNoise) × spaced(isPoissonSample)
 */

export { fmix32, hash1i, hash2i, rand1, rand2 } from "./Hash";
export { isPoissonSample } from "./PoissonGrid";
export { fbm, valueNoise } from "./ValueNoise";
export { worley, type WorleyResult } from "./WorleyField";
