import { biomeAt } from "../game/Biome";
import {
  Biome,
  Execution,
  Game,
  ResourceKind,
  TerrainType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { isPoissonSample, rand2, valueNoise, worley } from "../pcg";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";

// ResourceSeedExecution — one-shot, init-phase seeding of the per-tile wood/rock
// node layer. Runs ONCE per game in GameRunner.init() (via seedResources()).
//
// PLACEMENT MODEL (docs/PRIMITIVE_ERA_REDESIGN.md §12.1 — the "proper system"):
// resources are placed as realistic, terrain-logical, clustered STANDS/RANGES,
// not salt-and-pepper per-tile rolls. Per eligible land tile we layer:
//   1. terrain/biome GATE — wood only in wooded biomes; rock anywhere, denser on
//      Mountain/Highland.
//   2. Worley CELL richness — only "rich" patch-cells bear the resource ⇒ discrete
//      stands/ranges (not uniform scatter).
//   3. value-noise DENSITY + patch-core falloff — feathered, denser cores.
//   4. Poisson blue-noise SPACING — individual nodes keep a min distance ⇒ a stand
//      reads like a stand (gaps, no stacking, no speckle).
//
// DETERMINISM (non-negotiable — lockstep, every client re-runs this): all layers
// are pure functions of (tileX, tileY, integer seed) from `simpleHash(gameID)`, so
// results are identical on every client yet differ every game. Hash-based, NO
// transcendentals in the math (see src/core/pcg/Hash.ts), NO Math.random/Date.now.
// Tiles are still walked in TileRef order so the setResource delta order is stable.
export class ResourceSeedExecution implements Execution {
  private active = true;
  private readonly seedBase: number;

  // --- Tuning (docs §12.1; first-pass, tuned at render-verify on mini-2018) ---
  // Patch (cell) size in tiles — bigger ⇒ larger, fewer stands/ranges.
  // Owner tuning: larger cells + fewer stands + wider spacing ⇒ resources are
  // LESS FREQUENT and more AGGLOMERATED into distinct clumps (not a polka-dot
  // carpet). | tuned at render-verify on mini-2018.
  private static readonly WOOD_CELL = 26;
  private static readonly ROCK_CELL = 36;
  // Fraction of patch-cells that bear the resource (richness), before biome/terrain
  // modulation. Worley value is uniform [0,1), so value < frac ≈ that fraction of cells.
  private static readonly WOOD_STAND_FRAC = 0.18;
  private static readonly ROCK_STAND_FRAC = 0.08;
  private static readonly FISH_CELL = 22;
  private static readonly FISH_SHOAL_FRAC = 0.16;
  // Within-stand density gate: place only where value-noise exceeds this (sparser
  // toward edges); plus a patch-core radius so cell borders feather out.
  private static readonly WOOD_DENSITY = 0.64;
  private static readonly WOOD_CORE = 0.78;
  private static readonly ROCK_DENSITY = 0.68;
  private static readonly ROCK_CORE = 0.82;
  private static readonly FISH_DENSITY = 0.62;
  private static readonly FISH_CORE = 0.86;
  // Blue-noise spacing between individual nodes (tiles).
  private static readonly WOOD_SPACING = 5;
  private static readonly ROCK_SPACING = 7;
  private static readonly FISH_SPACING = 5;
  // Density-field frequency (lattice cells per tile) — smaller ⇒ broader blobs.
  private static readonly DENSITY_FREQ = 0.08;

  // Distinct integer seeds per kind so adding/removing a kind never perturbs another.
  private readonly seedWood: number;
  private readonly seedRock: number;
  private readonly seedFish: number;

  constructor(gameID: GameID) {
    this.seedBase = simpleHash(gameID);
    this.seedWood = (this.seedBase ^ 0x5f3a1c7b) >>> 0;
    this.seedRock = (this.seedBase ^ 0xa17c93e5) >>> 0;
    this.seedFish = (this.seedBase ^ 0x46d3c1a9) >>> 0;
  }

  activeDuringSpawnPhase(): boolean {
    // Seed before the spawn phase ends so nodes exist the moment play begins.
    return true;
  }

  init(mg: Game, ticks: number): void {
    const config = mg.config();
    const bands = config.biomeLatitudeBands();
    const C = ResourceSeedExecution;

    mg.forEachTile((tile: TileRef) => {
      // Inland water can carry fish shoals; ocean is still ignored for resources.
      const x = mg.x(tile);
      const y = mg.y(tile);
      if (!mg.isLand(tile)) {
        if (!mg.isOcean(tile)) {
          const f = worley(x, y, this.seedFish, C.FISH_CELL);
          if (
            f.value < C.FISH_SHOAL_FRAC &&
            f.dist < C.FISH_CORE &&
            valueNoise(x, y, this.seedFish, C.DENSITY_FREQ) > C.FISH_DENSITY &&
            isPoissonSample(x, y, this.seedFish, C.FISH_SPACING)
          ) {
            mg.setResource(
              tile,
              ResourceKind.Fish,
              this.quantity(x, y, this.seedFish),
            );
          }
        }
        return;
      }

      const b: Biome = biomeAt(mg, tile, bands);
      const ice = config.climateTileIceFractionAtTick(mg, tile, ticks);

      // --- WOOD: forest stands in wooded biomes ---
      // woodChanceForBiome is 0 on Cold/Arid/Sandy and scales density by biome
      // (Forest/Jungle dense, Green sparse); reuse it as the biome richness weight.
      const woodWeight = config.woodChanceForBiome(b);
      if (woodWeight > 0) {
        const biomeMul = Math.min(1, woodWeight / 0.1); // 1.0 Forest/Jungle, 0.2 Green
        const w = worley(x, y, this.seedWood, C.WOOD_CELL);
        if (
          w.value < C.WOOD_STAND_FRAC * biomeMul && // this cell is a stand
          w.dist < C.WOOD_CORE && // inside the stand core (feathered edge)
          valueNoise(x, y, this.seedWood, C.DENSITY_FREQ) > C.WOOD_DENSITY &&
          isPoissonSample(x, y, this.seedWood, C.WOOD_SPACING)
        ) {
          mg.setResource(
            tile,
            ResourceKind.Wood,
            this.quantity(x, y, this.seedWood),
          );
          return; // one node per tile — wood wins the forest tile
        }
      }

      // --- ROCK: ranges, concentrated on Mountain/Highland ---
      const tt = mg.terrainType(tile);
      const rockMul =
        tt === TerrainType.Mountain || tt === TerrainType.Highland
          ? config.rockMountainMult()
          : 1;
      const iceRockMul =
        rockMul * (1 + ice * (config.iceAgeRockRichnessMult() - 1));
      const r = worley(x, y, this.seedRock, C.ROCK_CELL);
      if (
        r.value < Math.min(0.9, C.ROCK_STAND_FRAC * iceRockMul) &&
        r.dist < C.ROCK_CORE &&
        valueNoise(x, y, this.seedRock, C.DENSITY_FREQ) > C.ROCK_DENSITY &&
        isPoissonSample(x, y, this.seedRock, C.ROCK_SPACING)
      ) {
        mg.setResource(
          tile,
          ResourceKind.Rock,
          Math.min(
            63,
            this.quantity(x, y, this.seedRock) + Math.floor(ice * 8),
          ),
        );
      }
    });

    this.active = false;
  }

  /** Deterministic node quantity 8..39 from the tile + kind seed (6-bit pack-safe). */
  private quantity(x: number, y: number, seed: number): number {
    return 8 + Math.floor(rand2(x, y, (seed ^ 0x00c0ffee) >>> 0) * 32);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }
}
