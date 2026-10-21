import { Config } from "../configuration/Config";
import { biomeAt } from "../game/Biome";
import {
  Age,
  Biome,
  Cell,
  Execution,
  Game,
  Player,
  PlayerType,
  Structures,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";
import { atPrimitiveTribeCeiling } from "./PrimitiveDensity";
import {
  anchoredByBuilding,
  buildingAnchors,
  primitiveTerrainAdjustedCapacity,
  SupportAnchor,
} from "./PrimitiveSupport";
import { TribeSplitExecution } from "./TribeSplitExecution";

// Out-of-sync brake: renown multiplier for a player a full Age ahead of the
// alive-player median (Humankind-style "tempo, not score").
const AGE_AHEAD_RENOWN_BRAKE = 0.25;

// How many owned tiles to sample at most when recomputing dominant biome. Beyond
// this we step through a deterministically-sorted tile list every Nth tile so the
// tally stays O(SAMPLE) on huge empires while remaining replay-stable.
const MAX_BIOME_SAMPLE_TILES = 512;

interface ClusterTraversalState {
  visited: Uint32Array;
  gen: number;
}

// Per-game traversal state used by calculateClusters() to avoid per-player buffers.
const traversalStates = new WeakMap<Game, ClusterTraversalState>();

export class PlayerExecution implements Execution {
  private readonly ticksPerClusterCalc = 20;

  private readonly ticksPerThreatCalc = 20;

  // How often (ticks) to test whether a Primitive tribe has outgrown the
  // auto-split threshold. Coarse on purpose: splitting is a rare structural
  // event and the check should not run every tick on every player.
  private readonly ticksPerSplitCheck = 30;

  private config: Config;
  private lastCalc = 0;
  private lastThreatCalc = 0;
  private lastSplitCheck = 0;
  // Debounce: a TribeSplitExecution we enqueued is still pending. Cleared once
  // the tile count drops back to or below the threshold (the split landed, or
  // the tribe shrank on its own), so we never stack duplicate split executions.
  private splitPending = false;
  // Debounce for the Classical civil-war secession (mirrors splitPending). Cleared
  // once the debt ratio drops back under the civil-war threshold so a kingdom that
  // overexpands again can fracture again.
  private secessionPending = false;
  // Last owned-tile centroid seen by rewildUnsupportedFrontier, used to derive the
  // camp's drift direction so shedding trails the movement (directional drift, not
  // a symmetric pulse). NaN until the first rewild pass. Per-execution = per-client
  // identical in lockstep.
  private lastCampX = NaN;
  private lastCampY = NaN;
  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;
  private active = true;
  // Reusable neighbor buffer to avoid closures/allocation in cluster checks.
  private nbuf: TileRef[] = [0, 0, 0, 0];

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.map = mg.map();
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerClusterCalc);
    this.lastThreatCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerThreatCalc);
    // Stagger split checks across players (and off the cluster cadence) so the
    // occasional split test doesn't bunch up on one tick.
    this.lastSplitCheck =
      ticks + (simpleHash(this.player.name()) % this.ticksPerSplitCheck);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    for (const u of this.player.units()) {
      if (!Structures.has(u.type())) {
        continue;
      }

      const owner = this.mg!.owner(u.tile());
      if (!owner?.isPlayer()) {
        u.delete();
        continue;
      }
      if (owner === this.player) {
        continue;
      }

      const captor = this.mg!.player(owner.id());
      if (u.type() === UnitType.DefensePost) {
        u.delete(true, captor);
      } else {
        captor.captureUnit(u);
      }
    }

    if (!this.player.isAlive()) {
      this.removeOnDeath();
      this.active = false;
      this.mg.stats().playerKilled(this.player, ticks);
      return;
    }

    const troopInc = this.config.troopIncreaseRate(this.player);
    this.player.addTroops(troopInc);
    const goldFromWorkers = this.config.goldAdditionRate(this.player);
    this.player.addGold(goldFromWorkers);

    // Record stats
    this.mg.stats().goldWork(this.player, goldFromWorkers);

    // R13: ONE unified resources→gold conversion per tick. Wood and slaves both
    // alias the single _resources pool now, so the old TWO conversions
    // (convertResourcesToGold draining wood + a separate slaves→gold drip) would
    // DOUBLE-DRAIN the same pile. They are collapsed into convertResourcesToGold,
    // which drains the unified pool once and credits gold. This is the un-freeze
    // income source (the designed caravan trade was never built). See
    // docs/ICE_AGE_ECONOMY.md §B. (For a Neanderthal, addGold is a no-op, so this
    // still yields nothing — they "never any money".)
    // R14 will retune this to a trickle + caravans.
    this.convertResourcesToGold();

    // Tech point accrual (Eonfront age system). Module §2 — animal packs are
    // non-teching nomadic predators: they gain ZERO techPoints and so can never
    // meet an advance criterion (meetsAdvanceCriteria also rejects packs).
    if (!this.player.isAnimalPack()) {
      this.player.addTechPoints(this.config.techPointsPerTick(this.player));
    }

    // Module §7 — Neanderthal lifecycle: mammoth hunting (a Primitive-era meat
    // resource), a troop-regen BOOM while herds last that collapses as they are
    // hunted out, and escalating climate-decline attrition. Net arc: Neanderthals
    // dominate the early Primitive era then die off by its end. Deterministic
    // (pure functions of the tick + state; no RNG). `troopInc` is the generic
    // bot regen already added above, which this scales/claws-back.
    if (this.player.isNeanderthal()) {
      this.processNeanderthalLifecycle(ticks, troopInc);
    }

    // Overextension / integration debt (Eonfront anti-snowball, Module C).
    // Conquest must be expensive to KEEP: digest debt each tick (Age-gated
    // throughput, eased by SupplyDepots), and deterministically revolt the
    // most-recently-captured frontier tiles when debt overflows capacity. In the
    // Primitive era the tile-loss side is handled instead by
    // rewildUnsupportedFrontier() below — digestion still runs, it just never
    // relinquishes there.
    this.digestIntegrationDebt();

    // Primitive "glob that drifts": shed frontier land that no settlement (or
    // the mobile camp) supports. Primitive-only; throttled to ~1/s so the bleed
    // reads as a slow drift, not a collapse. Replaces the old debt-revolt, which
    // removed the NEWEST captures and so fought the drift direction. Animal packs
    // drift FASTER (rewildUnsupportedFrontier scales its budget + shrinks support
    // radii when isAnimalPack), so a pack roams more swiftly than a settled tribe.
    if (ticks % 10 === 0) {
      this.rewildUnsupportedFrontier();
    }

    // Renown accrual (Eonfront scoring). Anti-snowball brake: a player a full
    // Age ahead of the alive-player median earns reduced renown (tempo, not
    // score), so a runaway tech lead converts into pace rather than points.
    let renownGain = this.config.renownPerTick(this.player);
    if (this.player.age() - this.medianAliveAge() >= 1) {
      renownGain *= AGE_AHEAD_RENOWN_BRAKE;
    }
    this.player.addRenown(renownGain);
    // Era Triumphs are sticky once earned. Refresh after economy, tech, debt,
    // territory, and renown have all advanced for this tick.
    this.player.refreshEraTriumphs();

    // Recompute the player's threat score (dominance) periodically.
    if (ticks - this.lastThreatCalc >= this.ticksPerThreatCalc) {
      this.lastThreatCalc = ticks;
      this.recomputeThreatScore();
    }

    // Module H1 — Primitive predator-pack auto-split. A Primitive (animal)
    // tribe whose owned land outgrows config.tribeAutoSplitTiles() divides like
    // a pack: enqueue a TribeSplitExecution that carves off ~half its range to a
    // new tribe. Civilized (non-Primitive) players never split. Throttled +
    // debounced so we never stack split executions or run the test every tick.
    if (ticks - this.lastSplitCheck >= this.ticksPerSplitCheck) {
      this.lastSplitCheck = ticks;
      this.maybeEnqueueTribeSplit();
      // Classical (Kingdom) civil war: a kingdom whose integration debt overflows
      // its administrative capacity past the civil-war ratio fractures — a
      // province secedes to a rebel kingdom. Shares the split-check cadence.
      this.maybeEnqueueSecession();
    }

    for (const alliance of this.player.alliances()) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    for (const embargo of this.player.getEmbargoes()) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    if (
      ticks - this.lastCalc > this.ticksPerClusterCalc ||
      this.player.numTilesOwned() < 100
    ) {
      if (this.player.lastTileChange() >= this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        // Dominant biome tracks the terrain composition of owned land and is
        // recomputed on the same periodic cadence as the cluster pass (only
        // when tiles have changed), so it stays current as the empire shifts.
        this.recomputeDominantBiome();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  // Module §7 — the Neanderthal boom-then-extinction lifecycle, run each tick for
  // a Neanderthal player. `baseRegen` is the generic bot troop regen already
  // applied this tick (so we adjust around it). All math is deterministic
  // (functions of the replicated tick + player state); no RNG, no Date/random.
  private processNeanderthalLifecycle(ticks: number, baseRegen: number): void {
    // Ride the SAME ice-recession clock as the on-map mammoth herds and primitive
    // economy: 1 under full ice → 0 once receded, so Neanderthals and megafauna
    // wane together without a second hidden timer.
    const iceFraction = this.config.climateIceFractionAtTick(ticks);

    // Mammoth hunting — a Primitive-era meat resource. Neanderthals harvest meat
    // into the general pile while herds last; the yield tapers with abundance.
    // R13/S6: addMeat now writes the unified pool (meat is no longer a distinct
    // counter); the boom/bust regen below is driven by iceFraction, not by reading
    // meat, so behavior is preserved.
    if (iceFraction > 0) {
      this.player.addMeat(this.config.mammothMeatPerHuntTick() * iceFraction);
    }

    // Prosperity / collapse: scale the base regen by the mammoth-fed multiplier.
    // mult > 1 while herds are plentiful (boom) → add the extra (capped at
    // maxTroops); mult < 1 once hunted out (bust) → claw back part of the base
    // regen so net growth nearly stops. The boom is what lets them snowball
    // early; the collapse is what lets attrition finish them.
    const mult = this.config.neanderthalRegenMult(iceFraction);
    const extra = baseRegen * (mult - 1);
    if (extra > 0) {
      const cap = this.config.maxTroops(this.player);
      const room = Math.max(0, cap - this.player.troops());
      const add = Math.min(extra, room);
      if (add > 0) this.player.addTroops(add);
    } else if (extra < 0) {
      this.player.removeTroops(Math.min(-extra, this.player.troops()));
    }

    // Climate-decline attrition — trivial for a long time, escalating with the
    // tick (knee ≈ the first Primitive escape). A fraction of current troops is
    // lost each tick; once mammoths are gone (regen floored) this dominates and
    // drives the tribe to extinction by the end of the Primitive era.
    const attritionFrac = this.config.neanderthalAttritionForIce(iceFraction);
    if (attritionFrac > 0) {
      const loss = Math.floor(this.player.troops() * attritionFrac);
      if (loss > 0) this.player.removeTroops(loss);
    }
  }

  // Tally the player's owned tiles by derived biome and store the most common as
  // the dominant biome. On large empires we sample at most MAX_BIOME_SAMPLE_TILES
  // tiles by stepping through a numerically-sorted tile list every Nth tile — a
  // deterministic, replay-stable subset independent of Set insertion order. If
  // the player owns no tiles, the dominant biome is left unchanged.
  private recomputeDominantBiome() {
    const owned = this.player.tiles();
    if (owned.size === 0) {
      return;
    }

    // Sort numerically so sampling is deterministic regardless of how/when tiles
    // were captured (Set iteration order = insertion order, which churns).
    const tileList = Array.from(owned);
    tileList.sort((a, b) => a - b);

    const total = tileList.length;
    const step =
      total > MAX_BIOME_SAMPLE_TILES
        ? Math.ceil(total / MAX_BIOME_SAMPLE_TILES)
        : 1;

    const bands = this.config.biomeLatitudeBands();
    // Counts indexed by Biome enum value (Cold=0, Green=1, Arid=2, Sandy=3,
    // Forest=4, Jungle=5).
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < total; i += step) {
      const b = biomeAt(this.map, tileList[i], bands);
      counts[b]++;
    }

    // Most common biome; ties resolved by lowest enum value (stable/deterministic).
    let best: Biome = Biome.Cold;
    let bestCount = counts[Biome.Cold];
    for (let b = 1; b < counts.length; b++) {
      if (counts[b] > bestCount) {
        bestCount = counts[b];
        best = b as Biome;
      }
    }
    this.player.setDominantBiome(best);
  }

  // Overextension digestion: drain integration debt each tick (Age-gated
  // throughput, eased by owned SupplyDepots), then — if debt still overflows
  // capacity past the revolt threshold — deterministically flip the most-
  // recently-captured frontier tiles back to neutral. No RNG: throughput and
  // tile choice are stable functions of state + capture order.
  private digestIntegrationDebt() {
    const debt = this.player.integrationDebt();
    if (debt <= 0) {
      return;
    }

    // SupplyDepot relief boosts effective digestion throughput (caps at +100%).
    const depots = this.player.units(UnitType.SupplyDepot).length;
    const relief = Math.min(
      1,
      depots * this.config.supplyDepotReliefPerDepot(),
    );
    const throughput =
      this.config.integrationThroughputPerTick(this.player) * (1 + relief);

    const newDebt = Math.max(0, debt - throughput);
    this.player.setIntegrationDebt(newDebt);
    // Tile loss is NO LONGER driven by debt overflow. In the Primitive era the
    // settlement-anchored rewild pass (rewildUnsupportedFrontier) owns all
    // territory shedding — it sheds border land no settlement/camp supports,
    // which subsumes the old debt-overflow revolt. Outside Primitive, tribes-
    // turned-empires hold their land freely (rewildEnabled is false there). So
    // digestion just drains debt; it never relinquishes here, in any age.
  }

  // Primitive "glob that drifts" (settlement-anchored rewild). A Primitive tribe
  // only HOLDS land that is "supported": within settlementSupportRadius of one
  // of its settlements (Hut/City), or within nomadCampSupportRadius of its
  // mobile camp (the owned-tile centroid). Border tiles outside every support
  // zone re-wild to neutral, most-exposed first, capped per call. Net feel: the
  // edge you push toward stays (the camp follows your land) while the unsupported
  // trailing edge sheds — a settlement-less tribe drifts as a roving blob, and
  // settlements are the ONLY way to anchor land and actually grow. Deterministic
  // (distances + TileRef tie-break, no RNG). Primitive-only.
  //
  // ANIMAL PACKS DRIFT FASTER (Module §3 graft): a pack is a smaller, swifter
  // roamer, so its support radii SHRINK (it anchors less land) and its per-tick
  // rewild budget GROWS — both scaled by config.animalPackNomadMult(). Net: a
  // pack holds a tighter blob and sheds it faster, so it roves more quickly than
  // a settled human tribe. The scaling is a pure function of state (no RNG), so
  // it stays byte-identical on every client.
  private rewildUnsupportedFrontier() {
    if (!this.config.rewildEnabled(this.player.age())) {
      return;
    }
    // While the player is actively migrating (roaming to a clicked destination),
    // the migration execution OWNS the blob's size + position via its own
    // trim-to-capacity. The passive drift / carrying-cap shed below would fight
    // it — shedding the very leading edge the player is steering toward, most-
    // exposed-first — so defer entirely while a roam is in flight. The shed
    // resumes (gentle re-compaction at the new location) the moment the roam
    // ends. Migration's own trim still bounds the tribe, so this is not an
    // unbounded-growth hole. Deterministic; lockstep-safe.
    if (this.player.isMigrating()) {
      return;
    }
    const mySmallID = this.player.smallID();

    // Pack-faster-drift scaling. A pack shrinks both support radii (anchors less)
    // and widens its shed budget, both by animalPackNomadMult(). Integer-floored
    // radii (min 1) keep the support test deterministic and well-defined.
    const isPack = this.player.isAnimalPack();
    const mult = this.config.animalPackNomadMult();

    // Mobile-camp centroid (deterministic mean of owned-tile coords).
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const t of this.player.tilesRef()) {
      sumX += this.map.x(t);
      sumY += this.map.y(t);
      count++;
    }
    if (count === 0) {
      return;
    }
    const campX = sumX / count;
    const campY = sumY / count;

    // Packs anchor LESS land: shrink both the camp + building radii by the pack
    // multiplier (floored to ≥1 so a pack still holds a minimal core).
    // Classical (Kingdom) era anchors MORE land than a Primitive nomad: cities
    // project a wider hinterland, so widen both. (Packs shrink them instead — a
    // pack/Classical state are mutually exclusive: packs stay Primitive.)
    // Nomadic attrition gradient: every age before Modern holds a radius and
    // sheds at a rate set per age (Config.supportRadiusMult / rewildBudgetMult);
    // Primitive is the 1x reference, Classical the old 2x / 0.4x kingdom.
    const age = this.player.age();
    const ageRadiusMult = this.config.supportRadiusMult(age);
    let campRadius = this.config.nomadCampSupportRadius();
    const radiusFor = (r: number): number => {
      if (isPack) {
        return Math.max(1, Math.floor(r / mult));
      }
      return Math.round(r * ageRadiusMult);
    };
    if (isPack) {
      campRadius = Math.max(1, Math.floor(campRadius / mult));
    } else {
      campRadius = Math.round(campRadius * ageRadiusMult);
    }
    const campR2 = campRadius ** 2;

    // Building hold-zones, per-type radius (Hut largest). ONE law for every
    // Primitive player (owner direction 2026-07-07): NPC tribes' settlements
    // anchor land exactly like a human camp's — a tribe that built a Hut holds
    // that patch when it roams, same as you. (Packs never build, so their
    // nomadic feel is unchanged; buildingAnchors is cheap when unit-less.)
    const anchors: SupportAnchor[] = buildingAnchors(
      this.player,
      this.map,
      this.config,
      radiusFor,
    );

    const isSupported = (tile: TileRef): boolean => {
      const tx = this.map.x(tile);
      const ty = this.map.y(tile);
      const dcx = tx - campX;
      const dcy = ty - campY;
      if (dcx * dcx + dcy * dcy <= campR2) {
        return true;
      }
      return anchoredByBuilding(tile, this.map, anchors);
    };

    // Directional drift: shed the TRAILING edge — the tiles most BEHIND the camp's
    // recent movement — so the blob MOVES in a direction instead of pulsing in
    // place. Drift = how the owned-tile centroid shifted since the last rewild
    // pass (deterministic; stored per-execution, identical on every client). On
    // the first pass (or a stationary camp) fall back to most-exposed-first.
    const driftX = Number.isNaN(this.lastCampX) ? 0 : campX - this.lastCampX;
    const driftY = Number.isNaN(this.lastCampY) ? 0 : campY - this.lastCampY;
    this.lastCampX = campX;
    this.lastCampY = campY;
    const drifting = driftX * driftX + driftY * driftY > 1e-6;

    // Capture-grace: land freshly taken FROM another player is exempt from
    // shedding for captureGraceTicks — without this, conquered frontier was
    // always the most-exposed land and evaporated the same second it was won
    // (owner complaint 2026-07-07 "attacking tribes does nothing"). Expired
    // entries are pruned lazily as they are encountered.
    // (No pruning here: the capture-tick map is bounded with insertion-order
    // eviction, and forgetCapture would also mutate the revolt-ordering ring.)
    const nowTick = this.mg.ticks();
    const graceTicks = this.config.captureGraceTicks();
    const inCaptureGrace = (tile: TileRef): boolean => {
      const captured = this.player.captureTick(tile);
      return captured !== undefined && nowTick - captured <= graceTicks;
    };

    const candidates: { tile: TileRef; score: number }[] = [];
    for (const tile of this.player.borderTiles()) {
      if (
        this.map.ownerID(tile) !== mySmallID ||
        isSupported(tile) ||
        inCaptureGrace(tile)
      ) {
        continue;
      }
      const dx = this.map.x(tile) - campX;
      const dy = this.map.y(tile) - campY;
      // Drifting: score = projection onto the drift direction; the most NEGATIVE
      // projection is farthest behind → shed first. Stationary: score = distance²
      // from camp → most-exposed shed first. (No normalization — order preserved.)
      const score = drifting ? dx * driftX + dy * driftY : dx * dx + dy * dy;
      candidates.push({ tile, score });
    }
    // Deterministic order. Drifting: ascending (most-behind first). Stationary:
    // descending (most-exposed first). TileRef tie-break either way. An empty list
    // ⇒ the budget loop below is a no-op; carrying-capacity enforcement still runs
    // after (do NOT early-return here, or the §7 cap would be skipped).
    if (drifting) {
      candidates.sort((a, b) => a.score - b.score || a.tile - b.tile);
    } else {
      candidates.sort((a, b) => b.score - a.score || a.tile - b.tile);
    }

    // Packs shed FASTER: widen the per-tick rewild budget by the pack multiplier.
    // Packs shed FASTER (wider budget); a Classical kingdom sheds SLOWER (settled
    // land trims gently, it does not pulse like a nomad camp).
    let budget = this.config.maxRewildTilesPerTick();
    if (isPack) {
      budget = Math.max(1, Math.round(budget * mult));
    } else {
      budget = Math.max(
        1,
        Math.round(budget * this.config.rewildBudgetMult(age)),
      );
    }
    for (let i = 0; i < candidates.length && i < budget; i++) {
      const tile = candidates[i].tile;
      if (this.map.ownerID(tile) !== mySmallID) {
        continue;
      }
      this.player.relinquish(tile);
      this.player.forgetCapture(tile);
      if (this.player.integrationDebt() > 0) {
        this.player.setIntegrationDebt(this.player.integrationDebt() - 1);
      }
    }

    // Module §7 — POPULATION CARRYING CAPACITY. Even fully-supported land is
    // bounded by the population (and settlements) that can hold it. If owned
    // tiles exceed the cap, shed the MOST-EXPOSED border tiles (supported or
    // not) toward the cap, at the same gentle per-tick budget as the drift
    // bleed — so the Primitive map cannot be filled/held by force, only by
    // growing population and planting settlements. Deterministic; no RNG.
    // Ice-age tightening (climate clock): the caps shrink how much land ANYONE can
    // hold in the deep ice age (climateLandScale 0.6× under full ice → 1.0× once
    // receded) on TOP of the §7 population cap, so the map is tight early and
    // "thaws" open over time. Floored to the subsistence base so a tribe never
    // drops below a roving blob. Pure fn of game.ticks() → lockstep-safe.
    // ONE capacity law for every Primitive player (owner direction 2026-07-07):
    // NPC tribes use the same population+settlement carrying capacity as
    // humans — the migration-capacity floor below applies to all Primitive
    // roamers, so the old NPC-only fixed-blob path is gone.
    // Each age multiplies what population + settlements can hold
    // (landCapacityMult); the two nomadic ages also get the roaming floor below.
    const rawCarryingCapacity =
      this.config.carryingCapacityTiles(this.player) *
      this.config.landCapacityMult(age);
    const terrainAdjustedCarryingCapacity = this.config.roamsByMigration(
      this.player.age(),
    )
      ? primitiveTerrainAdjustedCapacity(
          rawCarryingCapacity,
          this.player,
          this.map,
          this.config,
          anchors,
          this.mg.ticks(),
        )
      : rawCarryingCapacity;
    let cap = Math.max(
      this.config.carryingBaseTiles(this.player),
      Math.floor(
        terrainAdjustedCarryingCapacity * this.config.climateLandScale(this.mg),
      ),
    );
    // A Primitive roamer holds a coherent patch sized by the migration system;
    // never let the population / ice carrying-cap trim BELOW that migration
    // capacity, or the band would shear the instant a roam ends (and disagree with
    // the migration HUD readout). Building-anchored land does NOT count against
    // the cap — it is held separately until the building EXPIRES — so add the
    // anchored-tile count to the cap. ONE law (owner direction 2026-07-07):
    // NPC tribes get the same allowance; a tribe's Hut holds its patch exactly
    // like yours does. Skip the scan entirely when there are no anchors (packs
    // and most bots), so the common case stays cheap.
    const isPrimitiveRoamer = this.config.roamsByMigration(this.player.age());
    if (isPrimitiveRoamer) {
      const migrationCapacity = primitiveTerrainAdjustedCapacity(
        this.config.primitiveMigrationCapacity(this.player),
        this.player,
        this.map,
        this.config,
        anchors,
        this.mg.ticks(),
      );
      cap = Math.max(cap, migrationCapacity);
      if (anchors.length > 0) {
        let anchoredOwned = 0;
        for (const t of this.player.tilesRef()) {
          if (anchoredByBuilding(t, this.map, anchors)) {
            anchoredOwned++;
          }
        }
        cap += anchoredOwned;
      }
    }
    let owned = this.player.numTilesOwned();
    if (owned > cap) {
      // Building-anchored land is NEVER shed by the cap (held until the building
      // expires); only camp-radius / unsettled land sheds down to the cap, most-
      // exposed first.
      const overCandidates: { tile: TileRef; d2: number }[] = [];
      for (const tile of this.player.borderTiles()) {
        if (this.map.ownerID(tile) !== mySmallID) continue;
        if (anchoredByBuilding(tile, this.map, anchors)) {
          continue;
        }
        // A wood stand is why the tribe came: the cap sheds plain land first.
        if (this.map.resourceAt(tile).quantity > 0) {
          continue;
        }
        // Fresh conquests are spared (capture-grace): the cap sheds OLD
        // trailing land instead, so fighting for ground relocates the blob
        // toward the front rather than reverting the battle.
        if (inCaptureGrace(tile)) {
          continue;
        }
        const dx = this.map.x(tile) - campX;
        const dy = this.map.y(tile) - campY;
        overCandidates.push({ tile, d2: dx * dx + dy * dy });
      }
      overCandidates.sort((a, b) => b.d2 - a.d2 || a.tile - b.tile);
      // Non-Primitive bots hold the cap HARD (shed the full overage, bounded) so
      // fast expansion can't balloon them into mass auto-splits. Primitive roamers
      // settle GENTLY instead (a few tiles/tick) so a roam that ends slightly
      // over-cap eases back into shape rather than snap-popping a chunk of land.
      // The band TRANSLATES: whatever an attack adds at the front beyond the
      // cap is shed from the back at the same order of speed - proportional to
      // the overage, bounded by nomadShedPerPass - so a tribe walks instead of
      // swelling, and a slightly over-cap roam still eases back without a snap.
      // Later ages scale it down by their shed multiplier.
      const gentle =
        isPrimitiveRoamer || this.player.type() === PlayerType.Human;
      const capBudget = gentle
        ? Math.max(
            1,
            Math.round(
              Math.min(
                Math.max(this.config.maxRewildTilesPerTick(), owned - cap),
                this.config.nomadShedPerPass(),
              ) * this.config.rewildBudgetMult(age),
            ),
          )
        : Math.max(
            this.config.maxRewildTilesPerTick(),
            Math.min(owned - cap, this.config.maxCarryingShedPerTick()),
          );
      let shed = 0;
      for (const c of overCandidates) {
        if (owned <= cap || shed >= capBudget) break;
        if (this.map.ownerID(c.tile) !== mySmallID) continue;
        this.player.relinquish(c.tile);
        this.player.forgetCapture(c.tile);
        if (this.player.integrationDebt() > 0) {
          this.player.setIntegrationDebt(this.player.integrationDebt() - 1);
        }
        owned--;
        shed++;
      }
    }
  }

  // R13: Slowly mint gold from the player's UNIFIED resource pool (wood, rocks,
  // meat, fish and slaves all share one pile now — the old separate wood and
  // slaves conversions are merged here so we never double-drain). A bounded
  // fraction is converted each tick — the passive "internal economy" income that
  // lets a developing tribe save toward a City. Deterministic (integer math, no
  // RNG; removeWood clamps the unified pool so it can't underflow).
  // R14 will retune this to a trickle + caravans.
  private convertResourcesToGold() {
    const pool = this.player.resources();
    if (pool <= 0) {
      return;
    }
    let take = Math.floor(pool * this.config.internalEconomyFraction());
    if (take < this.config.internalEconomyMinPerTick()) {
      take = Math.min(pool, this.config.internalEconomyMinPerTick());
    }
    take = Math.min(take, this.config.internalEconomyMaxPerTick());
    if (take <= 0) {
      return;
    }
    const removed = this.player.removeWood(take);
    // AI-NOTE: floor the product HERE, not only inside the outpost branch
    // below. removeWood() can return a FRACTIONAL pool remainder (_resources
    // accumulates float regen), so removed * resourceGoldValue() is not
    // integer-safe. Without this floor the no-outpost path reaches
    // BigInt(gold) with e.g. 4.269499999999974 and throws RangeError,
    // hard-crashing the lockstep tick. | evidence:
    // tests/client/graphics/layers/ObjectiveRail.test.ts (fractional-pile
    // cases) | expires: when _resources is an integer-only pile
    let gold = Math.floor(removed * this.config.resourceGoldValue());
    // Trade Outposts SPEED the conversion: each owned outpost adds a flat percent,
    // capped at tradeOutpostMaxCount(). Integer math (× then ÷100) keeps gold an
    // exact integer so the bigint cast stays lockstep-deterministic — no float, no
    // transcendentals. units(TradeOutpost) is a bounded scan (cap = 3 outposts).
    const outposts = Math.min(
      this.player.units(UnitType.TradeOutpost).length,
      this.config.tradeOutpostMaxCount(),
    );
    if (outposts > 0) {
      const bonusPct = outposts * this.config.tradeOutpostConversionBonusPct();
      gold = Math.floor((gold * (100 + bonusPct)) / 100);
    }
    // Primal-meta: the TWILIGHT OF THE WILD. Once the ice has fully receded,
    // the wild thins out and the PRIMITIVE forage/trade economy decays toward
    // its floor (primitiveTwilightMult 1 → 0.35) — staying primitive is a
    // power CURVE, not a plateau, so the "everyone waits forever" standoff
    // cannot be the optimum. Civilized eras (their real economy is
    // goldAdditionRate) are untouched. Integer basis points → lockstep-safe.
    if (this.player.age() === Age.Primitive) {
      const bps = Math.floor(
        this.config.primitiveTwilightMult(this.mg) * 10000,
      );
      gold = Math.floor((gold * bps) / 10000);
    }
    if (gold > 0) {
      this.player.addGold(BigInt(gold));
    }
  }

  // Median Age across all currently-alive players. Deterministic (integer ages,
  // stable sort on numbers). Used by the anti-snowball renown brake.
  // The median is identical for every player within a tick, but was being
  // recomputed per PlayerExecution per tick — O(players^2) (measured hotspot,
  // FullGamePerf 2026-07-02). One shared compute per (game, tick).
  private static medianAgeCache: {
    game: unknown;
    tick: number;
    value: number;
  } | null = null;

  private medianAliveAge(): number {
    const c = PlayerExecution.medianAgeCache;
    if (c !== null && c.game === this.mg && c.tick === this.mg.ticks()) {
      return c.value;
    }
    const value = this.computeMedianAliveAge();
    PlayerExecution.medianAgeCache = {
      game: this.mg,
      tick: this.mg.ticks(),
      value,
    };
    return value;
  }

  private computeMedianAliveAge(): number {
    const ages: number[] = [];
    for (const p of this.mg.players()) {
      if (!p.isAlive()) continue;
      ages.push(p.age());
    }
    if (ages.length === 0) return 0;
    ages.sort((a, b) => a - b);
    const mid = ages.length >> 1;
    if (ages.length % 2 === 1) return ages[mid];
    return (ages[mid - 1] + ages[mid]) / 2;
  }

  // threat = clamp01( (mine - mean) / (max - mean) ), 0 if denom <= 0.
  private recomputeThreatScore() {
    let sum = 0;
    let max = 0;
    let count = 0;
    for (const p of this.mg.players()) {
      if (!p.isAlive()) continue;
      const t = p.numTilesOwned();
      sum += t;
      if (t > max) max = t;
      count++;
    }
    if (count === 0) {
      this.player.setThreatScore(0);
      return;
    }
    const mean = sum / count;
    const denom = max - mean;
    if (denom <= 0) {
      this.player.setThreatScore(0);
      return;
    }
    const mine = this.player.numTilesOwned();
    let threat = (mine - mean) / denom;
    if (threat < 0) threat = 0;
    if (threat > 1) threat = 1;
    this.player.setThreatScore(threat);
  }

  // Module H1 trigger. Enqueue ONE TribeSplitExecution when a Primitive tribe is
  // genuinely over the auto-split threshold; the execution itself performs the
  // partition (and re-arms the parent + arms the child afterwards). Debounced via
  // splitPending so a player sitting over the threshold for several checks before
  // the enqueued split runs doesn't stack duplicate executions. The flag clears
  // the moment the tile count is back to/under the threshold (split landed, or
  // the tribe shrank on its own), re-arming for any future regrowth.
  private maybeEnqueueTribeSplit() {
    // Only Primitive (animal) tribes split. Bots only — humans/nations are not
    // packs. (A human stays in the Primitive era only briefly and should never
    // have their land yanked into an AI tribe.)
    if (this.player.type() !== PlayerType.Bot) {
      return;
    }
    if (this.player.age() !== Age.Primitive) {
      this.splitPending = false;
      return;
    }
    // AI-NOTE: packs only — without this gate EVERY primitive bot fissions at
    // tribeAutoSplitTiles (220), so no tribe can ever bank the 8k gold for its
    // first age advance and the world never leaves the Primitive era. Measured:
    // 133 bots became 3,646 tribes and the map leader held 0.2% of the land for
    // eleven straight minutes | evidence: tests/perf/fullgame/LoopVitals.ts,
    // tests/TribeSplit.test.ts
    if (!this.player.isAnimalPack()) {
      this.splitPending = false;
      return;
    }
    // A pack divides only while the world has room for another tribe. Without
    // this, splitting is an unbounded tribe factory: each half regrows to the
    // threshold and divides again, so the population compounds and no tribe can
    // ever become significant. Same ceiling the repopulation system uses.
    if (atPrimitiveTribeCeiling(this.mg)) {
      this.splitPending = false;
      return;
    }

    const over =
      this.player.numTilesOwned() > this.config.tribeAutoSplitTiles();
    if (!over) {
      // Back at/under threshold — clear the debounce so future overgrowth can
      // trigger another split.
      this.splitPending = false;
      return;
    }
    if (this.splitPending) {
      return;
    }

    this.splitPending = true;
    this.mg.addExecution(new TribeSplitExecution(this.player));
  }

  // Classical (Kingdom) civil-war secession trigger. Unlike the pack split this
  // applies to ANY Classical player — including the human: a kingdom that grabs
  // more land than it can govern fractures, the core "overexpansion → civil war"
  // pressure that keeps the map from filling. A contiguous province breaks away
  // to a new rebel kingdom (TribeSplitExecution "secession" mode). Debounced via
  // secessionPending so we never stack secessions while one is queued.
  private maybeEnqueueSecession() {
    if (this.player.age() !== Age.Classical) {
      this.secessionPending = false;
      return;
    }
    const capacity = Math.max(
      1,
      this.config.overextensionCapacity(this.player),
    );
    const ratio = this.player.integrationDebt() / capacity;
    if (ratio < this.config.civilWarDebtRatio()) {
      // Back under the threshold — clear the debounce so a future overflow can
      // fracture the realm again.
      this.secessionPending = false;
      return;
    }
    if (this.secessionPending) {
      return;
    }

    this.secessionPending = true;
    this.mg.addExecution(new TribeSplitExecution(this.player, "secession"));
  }

  private removeClusters() {
    const clusters = this.calculateClusters();

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    // Find the largest cluster with a single linear scan (O(n)).
    let largestIndex = 0;
    let largestSize = clusters[0].size;
    for (let i = 1; i < clusters.length; i++) {
      const size = clusters[i].size;
      if (size > largestSize) {
        largestSize = size;
        largestIndex = i;
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const largestClusterBox = calculateBoundingBox(this.mg, largestCluster);
    this.player.largestClusterBoundingBox = largestClusterBox;
    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      largestClusterBox,
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(largestCluster);
    }

    // Process remaining clusters
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster);
      }
    }
  }

  private surroundedBySamePlayer(
    cluster: Set<TileRef>,
    clusterBox: { min: Cell; max: Cell },
  ): false | Player {
    const enemies = new Set<number>();

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const tile of cluster) {
      if (map.isOceanShore(tile) || map.isOnEdgeOfMap(tile)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId === 0) {
          // Unowned neighbor: the cluster is not fully surrounded.
          return false;
        }
        if (ownerId !== mySmallID) {
          enemies.add(ownerId);
          const px = map.x(n);
          const py = map.y(n);
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
      }
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }

    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    const localEnemyBox = {
      min: new Cell(minX, minY),
      max: new Cell(maxX, maxY),
    };
    if (inscribed(localEnemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    let hasEnemy = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const tr of cluster) {
      if (map.isShore(tr) || map.isOnEdgeOfMap(tr)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tr, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId !== 0 && ownerId !== mySmallID) {
          hasEnemy = true;
          const x = map.x(n);
          const y = map.y(n);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!hasEnemy) {
      return false;
    }
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    const enemyBox = { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: Set<TileRef>) {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster.values().next().value;
    if (!firstTile) {
      return;
    }

    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      [firstTile],
      (tile, cb) => this.mg.forEachNeighbor(tile, cb),
      (tile) => this.mg.ownerID(tile) === this.player.smallID(),
    );

    if (this.player.numTilesOwned() === tiles.size) {
      // Renown on kill: award the conqueror for eliminating this player.
      capturing.addRenown(this.config.renownOnKill(this.player));
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
    const neighbors = new Map<Player, number>();
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const t of cluster) {
      const numNeighbors = map.neighbors4(t, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const ownerId = map.ownerID(this.nbuf[i]);
        if (ownerId === 0 || ownerId === mySmallID) {
          continue;
        }
        const owner = this.mg.playerBySmallID(ownerId) as Player;
        if (!owner.isFriendly(this.player)) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      }
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const [neighbor] of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // There are no ongoing attacks, so find the enemy with the largest border.
    return getMode(neighbors);
  }

  private calculateClusters(): Set<TileRef>[] {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0) return [];

    const state = this.traversalState();
    const currentGen = this.bumpGeneration();
    const visited = state.visited;

    const clusters: Set<TileRef>[] = [];

    for (const startTile of borderTiles) {
      if (visited[startTile] === currentGen) continue;

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        (tile, cb) => this.mg.forEachNeighborWithDiag(tile, cb),
        (tile) => borderTiles.has(tile),
      );
      clusters.push(cluster);
    }
    return clusters;
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  private traversalState(): ClusterTraversalState {
    const totalTiles = this.mg.width() * this.mg.height();
    let state = traversalStates.get(this.mg);
    if (!state || state.visited.length < totalTiles) {
      state = {
        visited: new Uint32Array(totalTiles),
        gen: 0,
      };
      traversalStates.set(this.mg, state);
    }
    return state;
  }

  private bumpGeneration(): number {
    const state = this.traversalState();
    state.gen++;
    if (state.gen === 0xffffffff) {
      state.visited.fill(0);
      state.gen = 1;
    }
    return state.gen;
  }

  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    neighborFn: (tile: TileRef, callback: (neighbor: TileRef) => void) => void,
    includeFn: (tile: TileRef) => boolean,
  ): Set<TileRef> {
    const result = new Set<TileRef>();
    const stack: TileRef[] = [];

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.add(start);
      stack.push(start);
    }

    const visit = (neighbor: TileRef) => {
      if (visited[neighbor] === currentGen) {
        return;
      }
      if (!includeFn(neighbor)) {
        return;
      }
      visited[neighbor] = currentGen;
      result.add(neighbor);
      stack.push(neighbor);
    };

    while (stack.length > 0) {
      const tile = stack.pop()!;
      neighborFn(tile, visit);
    }

    return result;
  }

  private removeOnDeath(): void {
    // Player (bot, human, nation) has no tiles
    // Delete any remaining gold, non-nuke units and alliances
    const gold = this.player.gold();
    this.player.removeGold(gold);

    this.player.units().forEach((u) => {
      if (
        u.type() !== UnitType.AtomBomb &&
        u.type() !== UnitType.HydrogenBomb &&
        u.type() !== UnitType.MIRVWarhead &&
        u.type() !== UnitType.MIRV
      ) {
        u.delete();
      }
    });

    this.player.removeAllAlliances();
  }
}
