import { BiomeBands, biomeAt } from "../game/Biome";
import { Age, Biome, Execution, Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";

// Module §7/§11 — MAMMOTHS as a Primitive-era huntable resource (owner direction).
// Mammoth herds roam the cold/woodland wilderness. A Primitive tribe whose land
// touches a herd HUNTS it for MEAT — mammoths are 50% MORE rewarding than a
// normal hunt/gather. Herds RESPAWN slowly (less aggressively than ordinary game)
// up to a cap that RECEDES with the ice on the SAME climate clock that kills off
// the Neanderthals — so the megafauna go extinct by the end of the Primitive era,
// and the Neanderthals that depended on them go with them.
//
// Lightweight neutral entities (tile + size), NOT players/units — kept in this
// long-lived execution. (An on-map sprite is a follow-up render pass; the herd is
// gameplay-live without it.)
//
// DETERMINISM (lockstep): single seeded PseudoRandom (`simpleHash(gameID)+7`,
// disjoint from the other streams). Herds iterate in array order; scans are
// bounded (herd tile + its immediate neighbours); rng draws follow a fixed
// pattern per check. No Math.random / Date.now.

/**
 * Module §11 — huntable prey species. Mammoths are the ice-age megafauna that go
 * extinct as the caps recede; deer and bison are ordinary terrain-appropriate
 * game that persist through the era, so a roaming tribe always has something to
 * follow once the mammoths are gone.
 */
export enum HerdSpecies {
  Mammoth = 0,
  Deer = 1,
  Bison = 2,
}

interface SpeciesTraits {
  /** Scales the base herd count for this species. */
  abundance: number;
  /** Meat multiplier relative to mammothBaseHuntMeat(). */
  reward: number;
  /** True only for ice-age megafauna: cap and size follow climateIceFraction. */
  climateBound: boolean;
}

const SPECIES: Record<HerdSpecies, SpeciesTraits> = {
  [HerdSpecies.Mammoth]: { abundance: 1, reward: 1.5, climateBound: true },
  // Woodland game: the steady staple once the ice has gone.
  [HerdSpecies.Deer]: { abundance: 1.6, reward: 0.7, climateBound: false },
  // Plains game: fewer, larger herds out on the open grass.
  [HerdSpecies.Bison]: { abundance: 1.1, reward: 1.0, climateBound: false },
};

/**
 * Pure habitat rule per species, so it is testable without a Game. `ice` is the
 * tile's ice fraction (1 under full caps, 0 once receded).
 */
export function speciesAllowsBiome(
  species: HerdSpecies,
  biome: Biome,
  ice: number,
): boolean {
  switch (species) {
    case HerdSpecies.Mammoth:
      // Ice-age megafauna: anywhere the caps still reach except jungle, and
      // afterwards only the cold/forest refugia.
      if (ice > 0) return biome !== Biome.Jungle;
      return biome === Biome.Cold || biome === Biome.Forest;
    // Elk and deer cluster in woodland.
    case HerdSpecies.Deer:
      return (
        biome === Biome.Forest ||
        biome === Biome.Jungle ||
        biome === Biome.Green
      );
    // Bison range the open grass, never forest or ice.
    case HerdSpecies.Bison:
      return biome === Biome.Green || biome === Biome.Arid;
  }
}

/** True only for ice-age megafauna, whose cap and size follow the climate. */
export function speciesIsClimateBound(species: HerdSpecies): boolean {
  return SPECIES[species].climateBound;
}

interface MammothHerd {
  tile: TileRef;
  size: number;
  species: HerdSpecies;
}

export class MammothHerdExecution implements Execution {
  private active = true;
  private mg: Game;
  private rng: PseudoRandom;
  private herds: MammothHerd[] = [];
  private seeded = false;
  private lastCheck = 0;

  constructor(private gameID: GameID) {
    this.rng = new PseudoRandom(simpleHash(gameID) + 7);
  }

  activeDuringSpawnPhase(): boolean {
    // Seed before play begins so herds exist from tick 0.
    return true;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastCheck = ticks;
  }

  isActive(): boolean {
    return this.active;
  }

  // Ice-age megafauna habitat: current ice-sheet land + cold/cool refugia. This
  // keeps mammoths valuable in the dangerous icy map parts while the global herd
  // cap still collapses as climateIceFraction approaches 0.
  private isMammothHabitat(
    tile: TileRef,
    ticks: number,
    bands: BiomeBands,
  ): boolean {
    return this.isHabitat(HerdSpecies.Mammoth, tile, ticks, bands);
  }

  /** Terrain-appropriate range for each species. */
  private isHabitat(
    species: HerdSpecies,
    tile: TileRef,
    ticks: number,
    bands: BiomeBands,
  ): boolean {
    const b = biomeAt(this.mg, tile, bands);
    const ice = this.mg
      .config()
      .climateTileIceFractionAtTick(this.mg, tile, ticks);
    return speciesAllowsBiome(species, b, ice);
  }

  private seedHerds(ticks: number): void {
    const config = this.mg.config();
    const bands = config.biomeLatitudeBands();
    const w = this.mg.width();
    const h = this.mg.height();
    const base = config.mammothBaseHerds(this.mg.numLandTiles());
    // Seed each species into its own terrain, in a fixed species order so the
    // rng draw sequence is identical on every client.
    for (const species of [
      HerdSpecies.Mammoth,
      HerdSpecies.Deer,
      HerdSpecies.Bison,
    ]) {
      const target = Math.max(1, Math.round(base * SPECIES[species].abundance));
      let placed = 0;
      // Bounded rejection sampling for suitable land tiles (fixed attempt budget
      // so the draw count is identical on every client).
      const attempts = target * 40;
      for (let i = 0; i < attempts && placed < target; i++) {
        const x = this.rng.nextInt(0, w);
        const y = this.rng.nextInt(0, h);
        const tile = this.mg.ref(x, y);
        if (!this.mg.isLand(tile)) continue;
        if (!this.isHabitat(species, tile, ticks, bands)) continue;
        this.herds.push({
          tile,
          size: config.mammothHerdStartSize(),
          species,
        });
        placed++;
      }
    }
    this.seeded = true;
  }

  tick(ticks: number): void {
    if (!this.seeded) {
      this.seedHerds(ticks);
    }
    // Publish the herd snapshot to the client every tick (≤10 herds, cheap) so
    // the on-map sprites track positions; the renderer fog-gates them per player.
    this.mg.addUpdate({
      type: GameUpdateType.MammothHerd,
      herds: this.herds.map((h) => ({
        tile: h.tile,
        size: Math.round(h.size),
        species: h.species,
      })),
    });
    const config = this.mg.config();
    if (ticks - this.lastCheck < config.mammothDriftIntervalTicks()) {
      return;
    }
    this.lastCheck = ticks;

    const climate = config.climateIceFractionAtTick(ticks); // 1 full ice → 0 receded
    const bands = config.biomeLatitudeBands();
    const w = this.mg.width();
    const h = this.mg.height();

    // --- Drift, hunt, and climate-decay each herd (deterministic order) ---
    for (const herd of this.herds) {
      // Drift one tile toward a seeded-random adjacent land tile (herds wander,
      // pulling the tribes that follow them). Stay put if the step leaves land.
      const neighbors: TileRef[] = [];
      this.mg.forEachNeighbor(herd.tile, (n) => {
        if (this.mg.isLand(n)) neighbors.push(n);
      });
      if (neighbors.length > 0) {
        herd.tile = neighbors[this.rng.nextInt(0, neighbors.length)];
      }

      // Hunt: a PRIMITIVE tribe whose land is the herd tile or an immediate
      // neighbour harvests meat (mammoths are 50% more rewarding than normal),
      // depleting the herd. Lowest-smallID owner hunts (deterministic).
      let hunter = this.ownerHunter(herd.tile);
      if (hunter === null) {
        this.mg.forEachNeighbor(herd.tile, (n) => {
          const cand = this.ownerHunter(n);
          if (cand !== null && (hunter === null || cand < hunter)) {
            hunter = cand;
          }
        });
      }
      if (hunter !== null && herd.size > 0) {
        const p = this.mg.playerBySmallID(hunter);
        if (p.isPlayer()) {
          const meat = Math.max(
            1,
            Math.round(
              config.mammothBaseHuntMeat() * SPECIES[herd.species].reward,
            ),
          );
          p.addMeat(meat);
          herd.size -= config.mammothHuntDepletion();
        }
      }

      // Climate decay: only the ice-age megafauna dwindle as the caps recede.
      // Deer and bison are the staple that outlives them.
      if (speciesIsClimateBound(herd.species)) {
        herd.size -= config.mammothClimateSizeDecayPerCheck() * (1 - climate);
      }
    }

    // Remove dead herds.
    this.herds = this.herds.filter((herd) => herd.size > 0);

    // --- Cull over the receding cap, then SLOW respawn up toward it ---
    const base = config.mammothBaseHerds(this.mg.numLandTiles());
    const capFor = (species: HerdSpecies) =>
      Math.max(
        0,
        Math.round(
          base *
            SPECIES[species].abundance *
            (SPECIES[species].climateBound ? climate : 1),
        ),
      );
    // Cull surplus herds (smallest first) as each habitat shrinks. Only the
    // climate-bound species actually shrink; the others hold their cap.
    for (const species of [
      HerdSpecies.Mammoth,
      HerdSpecies.Deer,
      HerdSpecies.Bison,
    ]) {
      const cap = capFor(species);
      let living = this.herds.filter((x) => x.species === species);
      while (living.length > cap) {
        let minIdx = 0;
        for (let i = 1; i < living.length; i++) {
          if (living[i].size < living[minIdx].size) minIdx = i;
        }
        const victim = living[minIdx];
        this.herds.splice(this.herds.indexOf(victim), 1);
        living = living.filter((x) => x !== victim);
      }
    }
    // Respawn: slow (rarer than ordinary game) and only while the climate cap
    // allows — once the ice has receded (climate→0, cap→0) they never come back.
    for (const species of [
      HerdSpecies.Mammoth,
      HerdSpecies.Deer,
      HerdSpecies.Bison,
    ]) {
      const cap = capFor(species);
      const count = this.herds.filter((x) => x.species === species).length;
      if (count >= cap) continue;
      if (this.rng.next() >= config.mammothRespawnChancePerCheck()) continue;
      const attempts = 30;
      for (let i = 0; i < attempts; i++) {
        const x = this.rng.nextInt(0, w);
        const y = this.rng.nextInt(0, h);
        const tile = this.mg.ref(x, y);
        if (!this.mg.isLand(tile)) continue;
        if (!this.isHabitat(species, tile, ticks, bands)) continue;
        this.herds.push({
          tile,
          size: config.mammothHerdStartSize(),
          species,
        });
        break;
      }
    }
  }

  // The smallID of a PRIMITIVE player owning `tile`, or null. Mammoth hunting is
  // a Primitive-era activity; civilized players ignore the herds.
  private ownerHunter(tile: TileRef): number | null {
    const o = this.mg.owner(tile);
    if (!o.isPlayer()) return null;
    if (o.age() !== Age.Primitive) return null;
    return o.smallID();
  }
}
