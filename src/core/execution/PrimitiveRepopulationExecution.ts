import { Age, Execution, Game, PlayerInfo, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { humanTribeName } from "../game/Tribes";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { primitiveTribeCeiling } from "./PrimitiveDensity";
import { SpawnExecution } from "./SpawnExecution";

// Module §7 — PRIMITIVE REPOPULATION (owner direction). The Primitive era should
// feel GAPPY: most of the map is empty wilderness and only a few tribes roam it.
// This long-lived execution maintains that — every interval it checks the world
// and, if the tribe count is below a low floor OR a big empty gap has opened,
// drops a single new Bot tribe (or, in deep wilderness, a predator pack) into the
// emptiest sampled region. It is a FLOOR/top-up, never a fill: a land-scaled
// ceiling keeps overall density low, and it stops once the world leaves the
// Primitive era. Combined with the population carrying-capacity (small blobs),
// this keeps the early map sparse and roving.
//
// DETERMINISM (lockstep): a single seeded PseudoRandom (`simpleHash(gameID)+6`,
// disjoint from base +0 / Executor +1 / TribeSpawner +2 / resources +3 /
// animal-pack +4 / Neanderthal +5). A FIXED number of rng draws per check (two
// per sample), then the spawn decision is a pure function of replicated state, so
// every client samples identical tiles and reaches the identical outcome. No
// Math.random / Date.now. The per-check scan is bounded (samples × 8 probes).
export class PrimitiveRepopulationExecution implements Execution {
  private active = true;
  private mg: Game;
  private rng: PseudoRandom;
  private lastCheck = 0;

  // 8-point probe ring offsets (unit directions), scaled by the gap radius.
  private static readonly RING: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  constructor(private gameID: GameID) {
    this.rng = new PseudoRandom(simpleHash(gameID) + 6);
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastCheck = ticks;
  }

  isActive(): boolean {
    return this.active;
  }

  tick(ticks: number): void {
    const config = this.mg.config();
    if (ticks - this.lastCheck < config.primitiveRepopIntervalTicks()) {
      return;
    }
    this.lastCheck = ticks;

    // Census of the living world.
    let maxAge: Age = Age.Primitive;
    let aliveBots = 0;
    for (const p of this.mg.players()) {
      if (!p.isAlive()) continue;
      if (p.age() > maxAge) maxAge = p.age();
      if (p.type() === PlayerType.Bot) aliveBots++;
    }
    // Stop once the world clearly leaves the Primitive era — repopulating a
    // civilized map with stone-age tribes would be incongruous.
    if (maxAge >= config.primitiveRepopMaxAge()) {
      return;
    }

    // Gappy ceiling: a LOW tribe count scaled by land area. Never fill past it.
    // Shared with the pack-split gate so the two can never disagree about how
    // many tribes the world should hold.
    const ceiling = primitiveTribeCeiling(this.mg);
    if (aliveBots >= ceiling) {
      return;
    }
    const lowCount = aliveBots < config.primitiveMinTribes();

    // Sample neutral land tiles and score each by how empty its surroundings are
    // (a probe ring). Pick the emptiest. Fixed draw count (2 per sample) keeps
    // the rng stream identical on every client.
    const samples = config.primitiveRepopSamplesPerCheck();
    const probeR = config.primitiveRepopGapRadius();
    const w = this.mg.width();
    const h = this.mg.height();
    let best: { tile: TileRef; empty: number } | null = null;
    for (let i = 0; i < samples; i++) {
      const x = this.rng.nextInt(0, w);
      const y = this.rng.nextInt(0, h);
      const tile = this.mg.ref(x, y);
      if (!this.mg.isLand(tile) || this.mg.owner(tile).isPlayer()) {
        continue; // must seed onto neutral land
      }
      let unowned = 0;
      let humanNear = false;
      const probes = PrimitiveRepopulationExecution.RING.length;
      for (const [ox, oy] of PrimitiveRepopulationExecution.RING) {
        const px = x + ox * probeR;
        const py = y + oy * probeR;
        if (px < 0 || py < 0 || px >= w || py >= h) {
          unowned++; // off-map reads as empty wilderness
          continue;
        }
        const pt = this.mg.ref(px, py);
        const owner = this.mg.owner(pt);
        if (!this.mg.isLand(pt) || !owner.isPlayer()) {
          unowned++;
        } else if (owner.type() === PlayerType.Human) {
          humanNear = true;
        }
      }
      // Never respawn a tribe on a HUMAN player's doorstep — a cleared frontier
      // must STAY cleared (owner direction 2026-07-07: victories over tribes
      // should not be silently undone by top-up spawns next door). The low-count
      // floor still refills the world, just somewhere out in the wilderness.
      if (humanNear) {
        continue;
      }
      const empty = unowned / probes;
      if (
        best === null ||
        empty > best.empty ||
        (empty === best.empty && tile < best.tile)
      ) {
        best = { tile, empty };
      }
    }
    if (best === null) {
      return; // no neutral land found this check
    }

    // Spawn ALWAYS when below the floor (low-count top-up); otherwise only into a
    // genuinely BIG gap (deep wilderness).
    const bigGap = best.empty >= config.primitiveRepopGapThreshold();
    if (!lowCount && !bigGap) {
      return;
    }

    // Predator packs favour the EXTRA-gappy wilderness; settled-ish gaps get a
    // normal human tribe. Never a Neanderthal — they are an early-era starting
    // people that goes extinct, not a thing that respawns mid-game.
    const wild = best.empty >= 0.999;
    const packChance = wild
      ? config.primitiveRepopPackRatioWild()
      : config.primitiveRepopPackRatio();
    const isPack = this.rng.next() < packChance;

    const info = new PlayerInfo(
      // Packs render their biome archetype name (assigned in SpawnExecution); for
      // them this is just a never-shown placeholder. Tribes show this name.
      humanTribeName(this.rng),
      PlayerType.Bot,
      null,
      this.rng.nextID(),
    );
    if (isPack) {
      info.setIsAnimalPack(true);
    }

    this.mg.addExecution(new SpawnExecution(this.gameID, info, best.tile));
  }
}
