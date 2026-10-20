import {
  Age,
  Execution,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { humanTribeName, tribeName } from "../game/Tribes";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { PlayerExecution } from "./PlayerExecution";
import { TribeExecution } from "./TribeExecution";

// Module H1 — territory split (two modes, one carve engine).
//
// "pack" mode — Primitive predator-pack division. When a PRIMITIVE (animal)
// tribe's owned-tile count grows past `config.tribeAutoSplitTiles()`, the pack
// divides: its range is partitioned into two spatially-coherent halves and one
// contiguous half is handed to a brand-new independent AI tribe (same
// archetype/biome). Result: two packs, neither holding massive land.
//
// "secession" mode — Classical (Kingdom) civil war (docs/CLASSICAL_ERA.md). When
// a CLASSICAL kingdom's integration debt stays at/above
// `config.civilWarDebtRatio()` × its administrative capacity (severe, sustained
// overexpansion), a contiguous province breaks away to a brand-new independent
// rebel KINGDOM — the child inherits the parent's Classical age (so it renders as
// a rival "Kingdom of …"), and the parent's debt is reset to a fraction of
// capacity (relief + lingering unrest). This caps kingdom size and keeps the map
// from filling: grab too much land and it fractures into civil war.
//
// ONLY Primitive packs auto-split, and ONLY Classical kingdoms secede. Imperial+
// civilizations hold territory freely (advancing past Classical is the reward for
// consolidating a stable realm).
//
// Determinism: the split picks its halves purely from tile geometry (longer
// bounding-box axis + median coordinate, ties broken by tile ref order). The
// only randomness is the child tribe's PlayerInfo id, drawn from a PseudoRandom
// seeded on the parent id + a salt — replay-stable, never Math.random/Date.now.
//
// Feasibility: runtime player creation is supported by the engine. `addPlayer`
// allocates the next smallID and registers the player; `PlayerImpl.toUpdate`
// emits a full snapshot on first serialization (lastSentUpdate === undefined),
// and `GameView` explicitly constructs a new `PlayerView` for a first-emission
// player. `GameRunner` re-places every player's name within 30 ticks. So a
// tribe appearing mid-game serializes and renders correctly.

// Salt mixed into the child-id PRNG seed so a child's id never collides with the
// PRNG streams used by SpawnExecution / TribeSpawner / Executor (all keyed off
// the gameID, not a parent player id).
const CHILD_ID_SALT = 0x5b17;

// Minimum tiles a split must hand to each side. If a tribe is over the
// threshold but the geometry can't carve a half with at least this many tiles
// on BOTH sides (e.g. a degenerate single-row strip), we skip — there is no
// meaningful "half" to give away and we let the gentle Primitive rewild handle
// it instead. Keeps the split a real pack-division, not a token sliver.
const MIN_TILES_PER_SIDE = 8;

// Hard ceiling on player smallIDs: ownership is stored in 12 bits of the tile
// state (GameMapImpl.PLAYER_ID_MASK = 0xfff), so smallID must stay ≤ 4095 or
// `setOwnerID` throws. smallIDs are sequential and never freed, so the NEXT one
// allocated is `allPlayers().length + 1`. We refuse to mint a child that would
// breach this (with a small margin) — a degenerate runaway split chain falls
// back to the gentle Primitive rewild instead of crashing the game.
const MAX_PLAYER_SMALL_ID = 0xfff;
const SMALL_ID_SAFETY_MARGIN = 4;

export class TribeSplitExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private parent: Player,
    private mode: "pack" | "secession" = "pack",
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    // One-shot: this execution performs at most one split, then deactivates.
    // A fresh TribeSplitExecution is registered for both halves afterwards so a
    // pack that re-grows past the threshold can divide again.
    this.active = false;

    const parent = this.parent;
    if (!parent.isAlive()) {
      return;
    }

    // Gate depends on mode. "pack": a Primitive tribe over the tile threshold.
    // "secession": a Classical kingdom whose integration debt has overflowed its
    // administrative capacity past the civil-war ratio. Anything else: no split.
    if (this.mode === "pack") {
      if (parent.age() !== Age.Primitive) {
        return;
      }
      if (parent.numTilesOwned() <= this.mg.config().tribeAutoSplitTiles()) {
        return;
      }
    } else {
      if (parent.age() !== Age.Classical) {
        return;
      }
      const config = this.mg.config();
      const capacity = Math.max(1, config.overextensionCapacity(parent));
      const ratio = parent.integrationDebt() / capacity;
      if (ratio < config.civilWarDebtRatio()) {
        return;
      }
    }

    // Feasibility bound: don't mint a child whose smallID would overflow the
    // 12-bit owner field. Next smallID = allPlayers().length + 1 (sequential,
    // never freed). Leave a margin and bail to rewild if we're near the ceiling.
    const nextSmallID = this.mg.allPlayers().length + 1;
    if (nextSmallID > MAX_PLAYER_SMALL_ID - SMALL_ID_SAFETY_MARGIN) {
      return;
    }

    this.split(parent, ticks);
  }

  private split(parent: Player, ticks: number): void {
    // Snapshot the parent's tiles (we mutate ownership while iterating, so copy).
    const tiles: TileRef[] = Array.from(parent.tiles());
    if (tiles.length === 0) {
      return;
    }

    // Bounding box of the owned land — choose the longer axis to cut across so
    // the two halves are as compact as possible.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      const x = this.mg.x(t);
      const y = this.mg.y(t);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const cutAlongX = maxX - minX >= maxY - minY;

    // Project each tile onto the cut axis. Sort by (axis coord, tileRef) so the
    // ordering — and therefore the median split point — is fully deterministic,
    // independent of Set iteration order.
    const coord = (t: TileRef): number =>
      cutAlongX ? this.mg.x(t) : this.mg.y(t);
    tiles.sort((a, b) => {
      const ca = coord(a);
      const cb = coord(b);
      if (ca !== cb) return ca - cb;
      return a - b;
    });

    // The "far half" is the upper half along the cut axis — a contiguous,
    // spatially-coherent block on one side of the median, handed to the new
    // tribe. Roughly half the tiles by count.
    const half = tiles.length >> 1;
    const keepCount = half; // parent keeps the lower half
    const giveCount = tiles.length - keepCount; // child gets the upper half
    if (keepCount < MIN_TILES_PER_SIDE || giveCount < MIN_TILES_PER_SIDE) {
      // Geometry too degenerate to carve a real half — leave it to rewild.
      return;
    }

    const childTiles = tiles.slice(keepCount); // upper-half slice, contiguous

    // Mint the new independent tribe. Same archetype/biome as the parent (a pack
    // that splits stays the same kind of animal). The child id is drawn from a
    // PRNG seeded on (parent id, split tick, salt): deterministic + replay-stable
    // (tick is part of game state, not wall-clock), and distinct across repeated
    // splits of the same parent (a different tick each time). PlayerType.Bot so
    // it gets the bot AI + bot-team handling.
    const random = new PseudoRandom(
      simpleHash(parent.id()) + CHILD_ID_SALT + ticks * 7919,
    );
    const childInfo = new PlayerInfo(
      this.childName(parent, random, ticks),
      PlayerType.Bot,
      null,
      random.nextID(),
    );
    // Module §1 — the child INHERITS the parent's taxonomy: a pack splits into
    // packs, a human tribe into human tribes. Set the flag on the PlayerInfo
    // BEFORE addPlayer so PlayerImpl copies it into the new player's state.
    if (parent.isAnimalPack()) {
      childInfo.setIsAnimalPack(true);
    }
    const child = this.mg.addPlayer(childInfo);
    child.setTribeArchetype(parent.tribeArchetype());
    child.setDominantBiome(parent.dominantBiome());
    // Secession: the breakaway is a rival CIVILIZATION, not a fresh Primitive
    // tribe — it inherits the parent's (Classical) age so it renders as a rival
    // "Kingdom of …" and behaves like a developed realm, not a nomad band.
    if (this.mode === "secession") {
      child.setAge(parent.age());
    }

    // Transfer the upper half: relinquish from the parent then conquer for the
    // child. `conquer` on a tile owned by the parent reassigns ownership and
    // updates both border sets; relinquishing first keeps the transfer explicit
    // and avoids any reliance on conquer's previous-owner bookkeeping for a
    // same-tick double mutation.
    let transferred = 0;
    let childSpawn: TileRef | undefined;
    for (const t of childTiles) {
      // Re-check: nothing else mutates ownership within this synchronous loop,
      // but guard anyway so a future caller can't double-relinquish.
      if (this.mg.ownerID(t) !== parent.smallID()) {
        continue;
      }
      parent.relinquish(t);
      child.conquer(t);
      childSpawn ??= t;
      transferred++;
    }

    if (transferred === 0 || childSpawn === undefined) {
      // Nothing actually moved (all tiles already gone) — abandon the child.
      // It owns no tiles, so its PlayerExecution will reap it as dead; we still
      // register that execution so the reaper runs.
      this.mg.addExecution(new PlayerExecution(child));
      return;
    }

    // A spawnTile makes hasSpawned() true so GameRunner places the child's name
    // (placeName, not placeSpawnName) and the HUD treats it as a live player.
    child.setSpawnTile(childSpawn);

    // Secession relieves the parent's overextension: it shed the ungovernable
    // province, so reset its integration debt to a fraction of capacity — enough
    // breathing room that it won't immediately re-secede on the next check, but
    // lingering unrest remains. (Deterministic: pure function of state.)
    if (this.mode === "secession") {
      const config = this.mg.config();
      const capacity = config.overextensionCapacity(parent);
      parent.setIntegrationDebt(
        Math.floor(capacity * config.civilWarDebtResetFraction()),
      );
    }

    // Bring the child to life: gold/troop/cluster upkeep + the auto-split trigger
    // (PlayerExecution) and the bot AI (TribeExecution). The child's own
    // PlayerExecution debounces and re-arms further splits if IT outgrows the
    // threshold, exactly as the parent's does — so a lineage can keep dividing
    // without any self-re-arm bookkeeping here.
    this.mg.addExecution(new PlayerExecution(child), new TribeExecution(child));

    // The PARENT is re-armed by ITS OWN PlayerExecution: once the shed leaves it
    // at/under the threshold the debounce clears, and any future regrowth past
    // the threshold enqueues a fresh split. No re-arm needed here.
  }

  // Flavorful, deterministic child name. A PACK child takes its parent's
  // predator-archetype label plus a short hash suffix so lineage members are
  // distinguishable (the display layer shows the archetype name for packs
  // anyway). A HUMAN-tribe child takes a fresh human tribe name. Both draw only
  // from deterministic sources (the seeded child PRNG / a pure hash of the
  // parent id), so the split is replay-stable. (PlayerInfo.id — the real
  // identity — is already unique via the PRNG.)
  private childName(
    parent: Player,
    random: PseudoRandom,
    ticks: number,
  ): string {
    if (!parent.isAnimalPack()) {
      return humanTribeName(random);
    }
    const base = tribeName(parent.tribeArchetype());
    const suffix = (simpleHash(parent.id() + ":" + ticks) % 1000)
      .toString()
      .padStart(3, "0");
    return `${base} ${suffix}`;
  }

  isActive(): boolean {
    return this.active;
  }
}
