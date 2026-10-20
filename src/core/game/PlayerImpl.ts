import { PseudoRandom } from "../PseudoRandom";
import { ClientID } from "../Schemas";
import {
  assertNever,
  findClosestBy,
  minInt,
  simpleHash,
  toInt,
  within,
} from "../Util";
import { AttackImpl } from "./AttackImpl";
import {
  Age,
  Alliance,
  AllianceInfo,
  AllianceRequest,
  AllPlayers,
  Attack,
  Biome,
  BuildableUnit,
  Cell,
  ColoredTeams,
  Embargo,
  EmojiMessage,
  eraTitle,
  EraTriumph,
  GameMode,
  Gold,
  GreatWork,
  MessageType,
  MutableAlliance,
  Player,
  PlayerBuildable,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Relation,
  ResourceKind,
  Structures,
  Team,
  TerraNullius,
  Tick,
  TribeArchetype,
  Unit,
  UnitParams,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { andFN, manhattanDistFN, TileRef } from "./GameMap";
import {
  ATTACK_DELTA_INCOMING,
  ATTACK_DELTA_OUTGOING,
  diffPlayerUpdate,
  packAttackTroopDeltas,
} from "./GameUpdateUtils";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "./GameUpdates";
import {
  bestShoreDeploymentSource,
  canBuildTransportShip,
} from "./TransportShipUtils";
import { UnitImpl } from "./UnitImpl";

interface Target {
  tick: Tick;
  target: Player;
}

class Donation {
  constructor(
    public readonly recipient: Player,
    public readonly tick: Tick,
  ) {}
}

// Shared singletons for empty collections in toFullUpdate. Sharing
// references lets diffPlayerUpdate's `a === b` fast paths skip structural
// comparison and avoids per-player-per-tick allocations. The arrays are
// frozen so accidental in-worker mutation throws instead of silently
// corrupting every player's updates; updates crossing to the main thread
// are structured-cloned (clones are mutable). Sets cannot be frozen
// (Set.add ignores freeze) — EMPTY_EMBARGOES must never be mutated.
// Cap on the recently-captured tile ring used for frontier-revolt ordering.
const MAX_RECENT_CAPTURES = 256;
// Cap on the capture-tick map used for capture-grace (rewild exemption).
const MAX_CAPTURE_TICK_ENTRIES = 4096;

const EMPTY_NUMBER_ARRAY: number[] = [];
const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_ATTACK_UPDATES: AttackUpdate[] = [];
const EMPTY_ALLIANCE_VIEWS: AllianceView[] = [];
const EMPTY_EMOJIS: EmojiMessage[] = [];
const EMPTY_EMBARGOES = new Set<string>();
Object.freeze(EMPTY_NUMBER_ARRAY);
Object.freeze(EMPTY_STRING_ARRAY);
Object.freeze(EMPTY_ATTACK_UPDATES);
Object.freeze(EMPTY_ALLIANCE_VIEWS);
Object.freeze(EMPTY_EMOJIS);

export class PlayerImpl implements Player {
  public _lastTileChange: number = 0;
  public _pseudo_random: PseudoRandom;

  private _gold: bigint;
  private _troops: bigint;

  private _age: Age = Age.Primitive;
  private _techPoints = 0;
  private _threatScore = 0;
  private _advancePenaltyEndTick: Tick = 0;

  // R13 — UNIFIED resource pool (Daniel: "all goes into same resources pool").
  // Wood, rocks, meat, fish and slaves used to be five separate integer counters;
  // they are now ONE shared integer pile. Everything harvested from tiles/water,
  // granted from raiding/killing/hunting packs, or taken as slaves from
  // exterminating a tribe flows into _resources; the Primitive canoe wood-sink
  // and the resources→gold internal economy draw from the same pile. Gold stays a
  // SEPARATE bigint. Plain integer counter (clamped >=0 so a spend can't
  // underflow); fractional grants (e.g. mammoth meat) floor only on serialization,
  // matching the old per-kind behavior.
  private _resources = 0;

  // Animal-pack identity (Module §1). Initialized from the PlayerInfo flag in
  // the constructor; only Bots that rolled into a predator pack are true.
  private _isAnimalPack = false;

  // Neanderthal identity (Module §7). Initialized from the PlayerInfo flag in
  // the constructor; only Bots that rolled Neanderthal at spawn are true.
  private _isNeanderthal = false;

  private _integrationDebt = 0;
  private _attritionLevel = 0;
  private _renown = 0;

  // Era-overhaul Foundation state (Module 0).
  // Biome the bulk of this player's owned land sits in (Module D recomputes).
  private _dominantBiome: Biome = Biome.Green;
  // Primitive predator-tribe identity (Module F assigns at spawn from biome).
  private _tribeArchetype: TribeArchetype = TribeArchetype.Wolf;
  // Diffusion credit (0..1) toward the next Age (Module B); reset on advance.
  private _ageAdvanceCredit = 0;
  // Soft anti-beeline progression. Triumphs are sticky within the current era;
  // advancing resets the mask and the renown baseline for the next era.
  private _eraTriumphMask = 0;
  // Subsistence floors inherited by absorbing other tribes. The carrying-cap
  // grants every tribe a base allowance; without inheriting it, conquering a
  // tribe DESTROYS that allowance and the winner cannot hold the land it just
  // took. See Config.carryingBaseTiles.
  private _absorbedTribes = 0;
  private _eraStartRenown = 0;
  // Primal-meta: the active Great Work (public era-advance ritual), if any.
  private _greatWork: GreatWork | null = null;
  // Primal-meta: Golden Age burst window (first in the world to an Age).
  private _goldenAgeEndTick: Tick = 0;

  // Coalition-against-the-leader (Module E). Membership is a single time-boxed
  // pact: the target player id we are coalitioned against, and the tick it
  // auto-expires. CoalitionExecution keeps these valid (clears them the moment
  // the target stops being a genuine high-threat leader). No RNG — pure tick state.
  private _coalitionTargetID: PlayerID | null = null;
  private _coalitionEndTick: Tick = 0;

  // Ring of most-recently-captured tiles (capture order), used to pick frontier
  // tiles to revolt when integration debt overflows. Bounded so it can't grow
  // unboundedly on a long conquest streak; deterministic (FIFO, no RNG).
  private _recentCaptures: TileRef[] = [];

  // Tick each tile was captured FROM another player — capture-grace source for
  // the rewild/carrying-cap shedders. Bounded, insertion-order evicted.
  private _captureTickByTile: Map<TileRef, number> = new Map();

  markedTraitorTick = -1;
  private _betrayalCount: number = 0;

  // Primitive migration coordination (see Player interface). _migrationTarget is
  // the newest clicked destination (null = idle); _migrationStepTick is the last
  // tick a migration step ran, so the passive rewild can tell an active roam from
  // an idle camp. _migrationHeading* is a short-lived raw travel vector used by
  // new clicks to steer instead of snapping. Sim-only (no PlayerView mirror), pure
  // tick state, no RNG.
  private _migrationTarget: TileRef | null = null;
  private _migrationStepTick: Tick = -1;
  private _migrationHeadingX = 0;
  private _migrationHeadingY = 0;
  private _migrationHeadingTick: Tick = -1;

  private embargoes = new Map<PlayerID, Embargo>();

  public _borderTiles: Set<TileRef> = new Set();

  public _units: Unit[] = [];
  public _tiles: Set<TileRef> = new Set();

  public pastOutgoingAllianceRequests: AllianceRequest[] = [];
  private _expiredAlliances: Alliance[] = [];

  private targets_: Target[] = [];

  private outgoingEmojis_: EmojiMessage[] = [];
  private outgoingQuickChats_ = new Map<number, Tick>();

  private sentDonations: Donation[] = [];

  private relations = new Map<Player, number>();

  private lastDeleteUnitTick: Tick = -1;
  private lastEmbargoAllTick: Tick = -1;

  public _incomingAttacks: Attack[] = [];
  public _outgoingAttacks: Attack[] = [];
  public _outgoingLandAttacks: Attack[] = [];

  public _alliances: MutableAlliance[] = [];

  private _spawnTile: TileRef | undefined;
  private _isDisconnected = false;

  /**
   * Last PlayerUpdate emitted for this player on the worker→main channel.
   * Used by GameImpl's tick loop to compute field-level diffs. Undefined on
   * first emission (full snapshot sent).
   */
  public lastSentUpdate: PlayerUpdate | undefined;

  constructor(
    private mg: GameImpl,
    private _smallID: number,
    private readonly playerInfo: PlayerInfo,
    startTroops: number,
    private readonly _team: Team | null,
  ) {
    this._troops = toInt(startTroops);
    this._gold = mg.config().startingGold(playerInfo);
    this._pseudo_random = new PseudoRandom(simpleHash(this.playerInfo.id));
    this._isAnimalPack = playerInfo.isAnimalPack;
    this._isNeanderthal = playerInfo.isNeanderthal;
  }

  largestClusterBoundingBox: { min: Cell; max: Cell } | null;

  /**
   * Build a PlayerUpdate for the worker→main wire.
   *
   * The first call for a player returns the full snapshot. Subsequent calls
   * return only fields that changed since the previous call (a partial
   * `{ type, id, ...changedFields }`), or `null` if nothing changed.
   *
   * tilesOwned / gold / troops are excluded from partial updates (they churn
   * for every alive player every tick): when any of them changed, a
   * `[smallID, tilesOwned, gold, troops]` quad is pushed to `statsOut`
   * instead, which GameImpl drains into the transferable
   * `packedPlayerUpdates` buffer. Attack troop counts likewise go to
   * `attackTroopsOut` as `[smallID, direction, index, troops]` quads
   * (→ `packedAttackUpdates`) instead of re-sending whole attack arrays.
   *
   * `lastSentUpdate` is updated to the full snapshot on every call.
   */
  toUpdate(
    statsOut?: number[],
    attackTroopsOut?: number[],
  ): PlayerUpdate | null {
    const full = this.toFullUpdate();
    const prev = this.lastSentUpdate;
    this.lastSentUpdate = full;
    if (prev === undefined) return full;
    if (
      statsOut !== undefined &&
      (prev.tilesOwned !== full.tilesOwned ||
        prev.gold !== full.gold ||
        prev.troops !== full.troops)
    ) {
      statsOut.push(
        full.smallID!,
        full.tilesOwned!,
        Number(full.gold),
        full.troops!,
      );
    }
    if (attackTroopsOut !== undefined) {
      packAttackTroopDeltas(
        prev.outgoingAttacks,
        full.outgoingAttacks,
        full.smallID!,
        ATTACK_DELTA_OUTGOING,
        attackTroopsOut,
      );
      packAttackTroopDeltas(
        prev.incomingAttacks,
        full.incomingAttacks,
        full.smallID!,
        ATTACK_DELTA_INCOMING,
        attackTroopsOut,
      );
    }
    return diffPlayerUpdate(prev, full);
  }

  private toFullUpdate(): PlayerUpdate {
    // Empty collections reuse shared singletons (EMPTY_*) so
    // diffPlayerUpdate's reference fast paths hit and nothing is allocated.
    // This runs for every player every tick; most collections are empty for
    // most players. The singletons are never mutated — updates are
    // structured-cloned before leaving the worker.
    let outgoingAllianceRequests = EMPTY_STRING_ARRAY;
    for (const ar of this.mg.allianceRequests) {
      if (ar.requestor() === this) {
        if (outgoingAllianceRequests === EMPTY_STRING_ARRAY) {
          outgoingAllianceRequests = [];
        }
        outgoingAllianceRequests.push(ar.recipient().id());
      }
    }

    const alliances = this.alliances();
    let allies = EMPTY_NUMBER_ARRAY;
    let allianceViews = EMPTY_ALLIANCE_VIEWS;
    if (alliances.length > 0) {
      allies = alliances.map((a) => a.other(this).smallID());
      const extensionCutoff =
        this.mg.ticks() + this.mg.config().allianceExtensionPromptOffset();
      allianceViews = alliances.map(
        (a) =>
          ({
            id: a.id(),
            other: a.other(this).id(),
            createdAt: a.createdAt(),
            expiresAt: a.expiresAt(),
            hasExtensionRequest: a.expiresAt() <= extensionCutoff,
          }) satisfies AllianceView,
      );
    }

    let embargoes = EMPTY_EMBARGOES;
    if (this.embargoes.size > 0) {
      embargoes = new Set<string>();
      for (const id of this.embargoes.keys()) {
        embargoes.add(id.toString());
      }
    }

    let targets = EMPTY_NUMBER_ARRAY;
    if (this.targets_.length > 0) {
      const t = this.targets();
      if (t.length > 0) {
        targets = t.map((p) => p.smallID());
      }
    }

    let outgoingEmojis = EMPTY_EMOJIS;
    if (this.outgoingEmojis_.length > 0) {
      const e = this.outgoingEmojis();
      if (e.length > 0) {
        outgoingEmojis = e;
      }
    }

    const outgoingAttacks =
      this._outgoingAttacks.length === 0
        ? EMPTY_ATTACK_UPDATES
        : this._outgoingAttacks.map((a) => {
            return {
              attackerID: a.attacker().smallID(),
              targetID: a.target().smallID(),
              troops: a.troops(),
              id: a.id(),
              retreating: a.retreating(),
            } satisfies AttackUpdate;
          });

    let incomingAttacks = EMPTY_ATTACK_UPDATES;
    if (this._incomingAttacks.length > 0) {
      const incoming = this.incomingAttacks();
      if (incoming.length > 0) {
        incomingAttacks = incoming.map((a) => {
          return {
            attackerID: a.attacker().smallID(),
            targetID: a.target().smallID(),
            troops: a.troops(),
            id: a.id(),
            retreating: a.retreating(),
          } satisfies AttackUpdate;
        });
      }
    }

    return {
      type: GameUpdateType.Player,
      clientID: this.clientID(),
      name: this.name(),
      displayName: this.displayName(),
      id: this.id(),
      team: this.team() ?? undefined,
      smallID: this.smallID(),
      playerType: this.type(),
      isAlive: this.isAlive(),
      isDisconnected: this.isDisconnected(),
      tilesOwned: this.numTilesOwned(),
      gold: this._gold,
      troops: this.troops(),
      age: this._age,
      techPoints: Math.floor(this._techPoints),
      // R13: all per-kind fields now mirror the single unified pool so existing
      // PlayerView/HUD readers stay consistent until the unified Resources
      // display lands in the integration pass.
      wood: Math.floor(this._resources),
      rocks: Math.floor(this._resources),
      meat: Math.floor(this._resources),
      fish: Math.floor(this._resources),
      slaves: Math.floor(this._resources),
      isAnimalPack: this._isAnimalPack,
      isNeanderthal: this._isNeanderthal,
      threatScore: this._threatScore,
      dominantBiome: this._dominantBiome,
      tribeArchetype: this._tribeArchetype,
      ageAdvanceCredit: this._ageAdvanceCredit,
      eraTriumphMask: this._eraTriumphMask,
      absorbedTribes: this._absorbedTribes,
      eraStartRenown: Math.floor(this._eraStartRenown),
      integrationDebt: this._integrationDebt,
      attritionLevel: this._attritionLevel,
      renown: Math.floor(this._renown),
      advancing: this.advancePenaltyActive(),
      goldenAge: this.goldenAgeActive(),
      // Great Work replication: required === 0 encodes "no active work" (keeps
      // the delta-diff numeric — no undefined-vs-cleared ambiguity).
      greatWorkTargetAge: this._greatWork?.targetAge ?? 0,
      greatWorkProgress: this._greatWork?.progress ?? 0,
      greatWorkRequired: this._greatWork?.required ?? 0,
      coalitionTargetID: this.coalitionTargetID(),
      allies: allies,
      embargoes: embargoes,
      isTraitor: this.isTraitor(),
      traitorRemainingTicks: this.getTraitorRemainingTicks(),
      targets: targets,
      outgoingEmojis: outgoingEmojis,
      outgoingAttacks: outgoingAttacks,
      incomingAttacks: incomingAttacks,
      outgoingAllianceRequests: outgoingAllianceRequests,
      alliances: allianceViews,
      hasSpawned: this.hasSpawned(),
      spawnTile: this._spawnTile,
      betrayals: this._betrayalCount,
      lastDeleteUnitTick: this.lastDeleteUnitTick,
      isLobbyCreator: this.isLobbyCreator(),
    };
  }

  smallID(): number {
    return this._smallID;
  }

  name(): string {
    return this.playerInfo.name;
  }
  displayName(): string {
    // Era-scaled polity title: "Tribe of X" (Primitive) → "Kingdom of X"
    // (Classical) → "Empire of X" (Imperial) … as the player advances. Animal
    // packs are nomadic predators, not civilizations — they keep their raw
    // archetype name. The prefixed value flows to the map labels + HUD + events
    // via toUpdate(), and to the client PlayerView, since both read displayName().
    if (this._isAnimalPack) {
      return this.playerInfo.displayName;
    }
    return `${eraTitle(this._age)} ${this.playerInfo.displayName}`;
  }

  clientID(): ClientID | null {
    return this.playerInfo.clientID;
  }

  id(): PlayerID {
    return this.playerInfo.id;
  }

  type(): PlayerType {
    return this.playerInfo.playerType;
  }

  units(...types: UnitType[]): Unit[] {
    const len = types.length;
    if (len === 0) {
      return this._units;
    }

    // Fast paths for common small arity calls to avoid Set allocation.
    if (len === 1) {
      const t0 = types[0]!;
      const out: Unit[] = [];
      for (const u of this._units) {
        if (u.type() === t0) out.push(u);
      }
      return out;
    }

    if (len === 2) {
      const t0 = types[0]!;
      const t1 = types[1]!;
      if (t0 === t1) {
        const out: Unit[] = [];
        for (const u of this._units) {
          if (u.type() === t0) out.push(u);
        }
        return out;
      }
      const out: Unit[] = [];
      for (const u of this._units) {
        const t = u.type();
        if (t === t0 || t === t1) out.push(u);
      }
      return out;
    }

    if (len === 3) {
      const t0 = types[0]!;
      const t1 = types[1]!;
      const t2 = types[2]!;
      // Keep semantics identical for duplicates in types by using direct comparisons.
      const out: Unit[] = [];
      for (const u of this._units) {
        const t = u.type();
        if (t === t0 || t === t1 || t === t2) out.push(u);
      }
      return out;
    }

    const ts = new Set(types);
    const out: Unit[] = [];
    for (const u of this._units) {
      if (ts.has(u.type())) out.push(u);
    }
    return out;
  }

  private numUnitsConstructed: Partial<Record<UnitType, number>> = {};
  private recordUnitConstructed(type: UnitType): void {
    if (this.numUnitsConstructed[type] !== undefined) {
      this.numUnitsConstructed[type]++;
    } else {
      this.numUnitsConstructed[type] = 1;
    }
  }

  // Count of units built by the player, including construction
  unitsConstructed(type: UnitType): number {
    const built = this.numUnitsConstructed[type] ?? 0;
    let constructing = 0;
    for (const unit of this._units) {
      if (unit.type() !== type) continue;
      if (!unit.isUnderConstruction()) continue;
      constructing++;
    }
    const total = constructing + built;
    return total;
  }

  // Count of units owned by the player, not including construction
  unitCount(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        total += unit.level();
      }
    }
    return total;
  }

  // Count of units owned by the player, including construction
  unitsOwned(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        if (unit.isUnderConstruction()) {
          total++;
        } else {
          total += unit.level();
        }
      }
    }
    return total;
  }

  sharesBorderWith(other: Player | TerraNullius): boolean {
    for (const border of this._borderTiles) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().ownerID(neighbor) === other.smallID()) {
          return true;
        }
      }
    }
    return false;
  }

  numTilesOwned(): number {
    return this._tiles.size;
  }

  tiles(): ReadonlySet<TileRef> {
    return new Set(this._tiles.values()) as Set<TileRef>;
  }

  // AI-NOTE: tiles() defensively COPIES the whole set per call — measured at
  // 24% of sim self-time once blobs grew (FullGamePerf 2026-07-02). tilesRef
  // is the no-copy view for read-only hot loops; callers must not mutate
  // ownership mid-iteration | evidence: FullGamePerf profile 2026-07-02
  // | expires: never
  tilesRef(): ReadonlySet<TileRef> {
    return this._tiles as ReadonlySet<TileRef>;
  }

  borderTiles(): ReadonlySet<TileRef> {
    return this._borderTiles;
  }

  nearby(): (Player | TerraNullius)[] {
    const ns: Set<Player | TerraNullius> = new Set();
    for (const border of this.borderTiles()) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().isLand(neighbor)) {
          const owner = this.mg.map().ownerID(neighbor);
          if (owner !== this.smallID()) {
            ns.add(
              this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
            );
          }
        }
      }
    }
    for (const n of this.shoreReachableNeighbors()) {
      ns.add(n);
    }
    return Array.from(ns);
  }

  // Samples every 10th border tile for shore tiles, checks the tile 5 steps
  // away in each cardinal direction that immediately enters water, to detect
  // players separated by a small river (up to 4 water tiles wide)
  private shoreReachableNeighbors(): Set<Player | TerraNullius> {
    const ns: Set<Player | TerraNullius> = new Set();
    const map = this.mg.map();
    const shores = Array.from(this.borderTiles()).filter((t) => map.isShore(t));
    const directions: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];

    for (let i = 0; i < shores.length; i += 10) {
      const border = shores[i];

      const bx = map.x(border);
      const by = map.y(border);

      for (const [dx, dy] of directions) {
        // Only follow directions that immediately enter water; land-adjacent
        // directions are already covered by the direct neighbors() loop.
        const x1 = bx + dx;
        const y1 = by + dy;
        if (!map.isValidCoord(x1, y1) || !map.isWater(map.ref(x1, y1)))
          continue;

        const nx = bx + dx * 5;
        const ny = by + dy * 5;
        if (!map.isValidCoord(nx, ny)) continue;
        const tile = map.ref(nx, ny);
        if (!map.isLand(tile)) continue;
        if (!map.hasOwner(tile) && map.hasFallout(tile)) continue;
        const owner = map.ownerID(tile);
        if (owner !== this.smallID()) {
          ns.add(
            this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
          );
        }
      }
    }

    return ns;
  }

  isPlayer(): this is Player {
    return true as const;
  }
  setTroops(troops: number) {
    this._troops = toInt(troops);
  }
  conquer(tile: TileRef) {
    this.mg.conquer(this, tile);
  }
  orderRetreat(id: string) {
    const attack = this._outgoingAttacks.find((attack) => attack.id() === id);
    if (!attack) {
      console.warn(`Didn't find outgoing attack with id ${id}`);
      return;
    }
    attack.orderRetreat();
  }
  executeRetreat(id: string): void {
    const attack = this._outgoingAttacks.find((attack) => attack.id() === id);
    // Execution is delayed so it's not an error that the attack does not exist.
    if (!attack) {
      return;
    }
    attack.executeRetreat();
  }
  relinquish(tile: TileRef) {
    if (this.mg.owner(tile) !== this) {
      throw new Error(`Cannot relinquish tile not owned by this player`);
    }
    this.mg.relinquish(tile);
  }

  // --- Primitive migration coordination (see Player interface) ---
  beginMigration(target: TileRef): void {
    this._migrationTarget = target;
    this._migrationStepTick = this.mg.ticks();
  }
  migrationTarget(): TileRef | null {
    return this._migrationTarget;
  }
  migrationHeading(): { x: number; y: number } | null {
    if (
      this._migrationHeadingTick < 0 ||
      this.mg.ticks() - this._migrationHeadingTick >
        this.mg.config().primitiveMigrationHeadingMemoryTicks()
    ) {
      return null;
    }
    return { x: this._migrationHeadingX, y: this._migrationHeadingY };
  }
  recordMigrationStep(dirX?: number, dirY?: number): void {
    this._migrationStepTick = this.mg.ticks();
    if (
      dirX !== undefined &&
      dirY !== undefined &&
      Number.isFinite(dirX) &&
      Number.isFinite(dirY) &&
      dirX * dirX + dirY * dirY > 1e-6
    ) {
      this._migrationHeadingX = dirX;
      this._migrationHeadingY = dirY;
      this._migrationHeadingTick = this.mg.ticks();
    }
  }
  endMigration(): void {
    this._migrationTarget = null;
  }
  isMigrating(): boolean {
    return (
      this._migrationTarget !== null &&
      this.mg.ticks() - this._migrationStepTick <=
        this.mg.config().primitiveMigrationGraceTicks()
    );
  }
  info(): PlayerInfo {
    return this.playerInfo;
  }

  isLobbyCreator(): boolean {
    return this.playerInfo.isLobbyCreator;
  }

  isAlive(): boolean {
    return this._tiles.size > 0;
  }

  hasSpawned(): boolean {
    return this._spawnTile !== undefined;
  }

  setSpawnTile(spawnTile: TileRef): void {
    this._spawnTile = spawnTile;
  }

  spawnTile(): TileRef | undefined {
    return this._spawnTile;
  }

  incomingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.recipient() === this);
  }

  outgoingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.requestor() === this);
  }

  alliances(): MutableAlliance[] {
    return this._alliances;
  }

  expiredAlliances(): Alliance[] {
    return [...this._expiredAlliances];
  }

  allies(): Player[] {
    return this.alliances().map((a) => a.other(this));
  }

  isAlliedWith(other: Player): boolean {
    if (other === this) {
      return false;
    }
    return this.allianceWith(other) !== null;
  }

  allianceWith(other: Player): MutableAlliance | null {
    if (other === this) {
      return null;
    }
    return (
      this.alliances().find(
        (a) => a.recipient() === other || a.requestor() === other,
      ) ?? null
    );
  }

  allianceInfo(other: Player): AllianceInfo | null {
    const alliance = this.allianceWith(other);
    if (!alliance) {
      return null;
    }
    const inExtensionWindow =
      alliance.expiresAt() <=
      this.mg.ticks() + this.mg.config().allianceExtensionPromptOffset();
    const canExtend =
      !this.isDisconnected() &&
      !other.isDisconnected() &&
      this.isAlive() &&
      other.isAlive() &&
      inExtensionWindow &&
      !alliance.agreedToExtend(this);
    return {
      expiresAt: alliance.expiresAt(),
      inExtensionWindow,
      myPlayerAgreedToExtend: alliance.agreedToExtend(this),
      otherAgreedToExtend: alliance.agreedToExtend(other),
      canExtend,
    };
  }

  canSendAllianceRequest(other: Player): boolean {
    if (this.mg.config().disableAlliances()) {
      return false;
    }
    if (other === this) {
      return false;
    }
    if (this.isDisconnected() || other.isDisconnected()) {
      // Disconnected players are marked as not-friendly even if they are allies,
      // so we need to return early if either player is disconnected.
      // Otherwise we could end up sending an alliance request to someone
      // we are already allied with.
      return false;
    }
    if (this.isFriendly(other) || !this.isAlive()) {
      return false;
    }

    const hasPending = this.outgoingAllianceRequests().some(
      (ar) => ar.recipient() === other,
    );

    if (hasPending) {
      return false;
    }

    const hasIncoming = this.incomingAllianceRequests().some(
      (ar) => ar.requestor() === other,
    );

    if (hasIncoming) {
      return true;
    }

    const recent = this.pastOutgoingAllianceRequests
      .filter((ar) => ar.recipient() === other)
      .sort((a, b) => b.createdAt() - a.createdAt());

    if (recent.length === 0) {
      return true;
    }

    const delta = this.mg.ticks() - recent[0].createdAt();

    return delta >= this.mg.config().allianceRequestCooldown();
  }

  breakAlliance(alliance: MutableAlliance): void {
    this.mg.breakAlliance(this, alliance);
  }

  removeAllAlliances(): void {
    this.mg.removeAlliancesByPlayerSilently(this);
  }

  isTraitor(): boolean {
    return this.getTraitorRemainingTicks() > 0;
  }

  getTraitorRemainingTicks(): number {
    if (this.markedTraitorTick < 0) return 0;
    const elapsed = this.mg.ticks() - this.markedTraitorTick;
    const duration = this.mg.config().traitorDuration();
    const remaining = duration - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  markTraitor(): void {
    this.markedTraitorTick = this.mg.ticks();
    this._betrayalCount++; // Keep count for Nations too

    // Record stats (only for real Humans)
    this.mg.stats().betray(this);
  }

  betrayals(): number {
    return this._betrayalCount;
  }

  createAllianceRequest(recipient: Player): AllianceRequest | null {
    if (this.isAlliedWith(recipient)) {
      throw new Error(`cannot create alliance request, already allies`);
    }
    return this.mg.createAllianceRequest(this, recipient satisfies Player);
  }

  relation(other: Player): Relation {
    if (other === this) {
      throw new Error(`cannot get relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    return this.relationFromValue(relation);
  }

  private relationFromValue(relationValue: number): Relation {
    if (relationValue < -50) {
      return Relation.Hostile;
    }
    if (relationValue < 0) {
      return Relation.Distrustful;
    }
    if (relationValue < 50) {
      return Relation.Neutral;
    }
    return Relation.Friendly;
  }

  allRelationsSorted(): { player: Player; relation: Relation }[] {
    return Array.from(this.relations, ([k, v]) => ({ player: k, relation: v }))
      .filter((r) => r.player.isAlive())
      .sort((a, b) => a.relation - b.relation)
      .map((r) => ({
        player: r.player,
        relation: this.relationFromValue(r.relation),
      }));
  }

  updateRelation(other: Player, delta: number): void {
    if (other === this) {
      throw new Error(`cannot update relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    const newRelation = within(relation + delta, -100, 100);
    this.relations.set(other, newRelation);
  }

  decayRelations() {
    this.relations.forEach((r: number, p: Player) => {
      const sign = -1 * Math.sign(r);
      const delta = 0.05;
      r += sign * delta;
      if (Math.abs(r) < delta * 2) {
        r = 0;
      }
      this.relations.set(p, r);
    });
  }

  canTarget(other: Player): boolean {
    if (this === other) {
      return false;
    }
    if (this.isFriendly(other)) {
      return false;
    }
    for (const t of this.targets_) {
      if (this.mg.ticks() - t.tick < this.mg.config().targetCooldown()) {
        return false;
      }
    }
    return true;
  }

  target(other: Player): void {
    this.targets_.push({ tick: this.mg.ticks(), target: other });
    this.mg.target(this, other);
  }

  targets(): Player[] {
    return this.targets_
      .filter(
        (t) => this.mg.ticks() - t.tick < this.mg.config().targetDuration(),
      )
      .map((t) => t.target);
  }

  transitiveTargets(): Player[] {
    const ts = this.alliances()
      .map((a) => a.other(this))
      .flatMap((ally) => ally.targets());
    ts.push(...this.targets());
    return [...new Set(ts)] satisfies Player[];
  }

  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void {
    if (recipient === this) {
      throw Error(`Cannot send emoji to oneself: ${this}`);
    }
    const msg: EmojiMessage = {
      message: emoji,
      senderID: this.smallID(),
      recipientID: recipient === AllPlayers ? recipient : recipient.smallID(),
      createdAt: this.mg.ticks(),
    };
    this.outgoingEmojis_.push(msg);
    this.mg.sendEmojiUpdate(msg);
  }

  outgoingEmojis(): EmojiMessage[] {
    return this.outgoingEmojis_
      .filter(
        (e) =>
          this.mg.ticks() - e.createdAt <
          this.mg.config().emojiMessageDuration(),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  canSendEmoji(recipient: Player | typeof AllPlayers): boolean {
    if (recipient === this) {
      return false;
    }
    const recipientID =
      recipient === AllPlayers ? AllPlayers : recipient.smallID();
    const prevMsgs = this.outgoingEmojis_.filter(
      (msg) => msg.recipientID === recipientID,
    );
    for (const msg of prevMsgs) {
      if (
        this.mg.ticks() - msg.createdAt <
        this.mg.config().emojiMessageCooldown()
      ) {
        return false;
      }
    }
    return true;
  }

  canSendQuickChat(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    const lastSentAt = this.outgoingQuickChats_.get(recipient.smallID());
    return (
      lastSentAt === undefined ||
      this.mg.ticks() - lastSentAt >= this.mg.config().quickChatCooldown()
    );
  }

  recordQuickChat(recipient: Player): void {
    this.outgoingQuickChats_.set(recipient.smallID(), this.mg.ticks());
  }

  canDonateGold(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    if (
      !this.isAlive() ||
      !recipient.isAlive() ||
      !this.isFriendly(recipient)
    ) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().donateGold() === false
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
        if (
          this.mg.ticks() - donation.tick <
          this.mg.config().donateCooldown()
        ) {
          return false;
        }
      }
    }
    return true;
  }

  canDonateTroops(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    if (
      !this.isAlive() ||
      !recipient.isAlive() ||
      !this.isFriendly(recipient)
    ) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().donateTroops() === false
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
        if (
          this.mg.ticks() - donation.tick <
          this.mg.config().donateCooldown()
        ) {
          return false;
        }
      }
    }
    return true;
  }

  donateTroops(recipient: Player, troops: number): boolean {
    // Defense-in-depth: canDonateTroops already checks this, but guard here too
    // to prevent self-donation if the method is called directly.
    if (recipient === this) return false;
    if (troops <= 0) return false;
    const removed = this.removeTroops(troops);
    if (removed === 0) return false;
    recipient.addTroops(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType: "troops",
      senderId: this.id(),
      recipientId: recipient.id(),
      amount: BigInt(removed),
    });
    return true;
  }

  donateGold(recipient: Player, gold: Gold): boolean {
    // Defense-in-depth: canDonateGold already checks this, but guard here too
    // to prevent self-donation if the method is called directly.
    if (recipient === this) return false;
    if (gold <= 0n) return false;
    const removed = this.removeGold(gold);
    if (removed === 0n) return false;
    recipient.addGold(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType: "gold",
      senderId: this.id(),
      recipientId: recipient.id(),
      amount: removed,
    });
    return true;
  }

  canDeleteUnit(): boolean {
    return (
      this.mg.ticks() - this.lastDeleteUnitTick >=
      this.mg.config().deleteUnitCooldown()
    );
  }

  recordDeleteUnit(): void {
    this.lastDeleteUnitTick = this.mg.ticks();
  }

  canEmbargoAll(): boolean {
    // Cooldown gate
    if (
      this.mg.ticks() - this.lastEmbargoAllTick <
      this.mg.config().embargoAllCooldown()
    ) {
      return false;
    }
    // At least one eligible player exists
    for (const p of this.mg.players()) {
      if (p.id() === this.id()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (this.isOnSameTeam(p)) continue;
      return true;
    }
    return false;
  }

  recordEmbargoAll(): void {
    this.lastEmbargoAllTick = this.mg.ticks();
  }

  hasEmbargoAgainst(other: Player): boolean {
    return this.embargoes.has(other.id());
  }

  canTrade(other: Player): boolean {
    const embargo =
      other.hasEmbargoAgainst(this) || this.hasEmbargoAgainst(other);
    return !embargo && other.id() !== this.id();
  }

  getEmbargoes(): Embargo[] {
    return [...this.embargoes.values()];
  }

  addEmbargo(other: Player, isTemporary: boolean): void {
    const embargo = this.embargoes.get(other.id());
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.mg.addUpdate({
      type: GameUpdateType.EmbargoEvent,
      event: "start",
      playerID: this.smallID(),
      embargoedID: other.smallID(),
    });

    this.embargoes.set(other.id(), {
      createdAt: this.mg.ticks(),
      isTemporary: isTemporary,
      target: other,
    });
  }

  stopEmbargo(other: Player): void {
    this.embargoes.delete(other.id());
    this.mg.addUpdate({
      type: GameUpdateType.EmbargoEvent,
      event: "stop",
      playerID: this.smallID(),
      embargoedID: other.smallID(),
    });
  }

  endTemporaryEmbargo(other: Player): void {
    const embargo = this.embargoes.get(other.id());
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.stopEmbargo(other);
  }

  tradingPartners(): Player[] {
    return this.mg
      .players()
      .filter((other) => other !== this && this.canTrade(other));
  }

  team(): Team | null {
    return this._team;
  }

  isOnSameTeam(other: Player): boolean {
    if (other === this) {
      return false;
    }
    if (this.team() === null || other.team() === null) {
      return false;
    }
    if (this.team() === ColoredTeams.Bot || other.team() === ColoredTeams.Bot) {
      return false;
    }
    return this._team === other.team();
  }

  isFriendly(other: Player, treatAFKFriendly: boolean = false): boolean {
    if (other === this) {
      return true;
    }
    if (other.isDisconnected() && !treatAFKFriendly) {
      return false;
    }
    return this.isOnSameTeam(other) || this.isAlliedWith(other);
  }

  gold(): Gold {
    return this._gold;
  }

  addGold(toAdd: Gold, tile?: TileRef): void {
    // Module §7 — Neanderthals NEVER hold money. They cannot trade, so every
    // gold source (passive income, plunder, raid loot, donations) is voided at
    // the sink. With zero gold they can never pay an advance toll and so are
    // permanently locked in the Primitive era. AI-NOTE: this no-op is the
    // load-bearing root of the Neanderthal extinction arc — paired with the
    // isNeanderthal gate in meetsAdvanceCriteria; removing either lets them
    // bank wealth and advance, breaking the boom-bust. | evidence:
    // tests/Neanderthal.test.ts
    if (this._isNeanderthal) {
      return;
    }
    this._gold += toAdd;
    if (tile) {
      this.mg.addUpdate({
        type: GameUpdateType.BonusEvent,
        player: this.id(),
        tile,
        gold: Number(toAdd),
        troops: 0,
      });
    }
  }

  removeGold(toRemove: Gold): Gold {
    if (toRemove <= 0n) {
      return 0n;
    }
    const actualRemoved = minInt(this._gold, toRemove);
    this._gold -= actualRemoved;
    return actualRemoved;
  }

  troops(): number {
    return Number(this._troops);
  }

  addTroops(troops: number): void {
    if (troops < 0) {
      this.removeTroops(-1 * troops);
      return;
    }
    this._troops += toInt(troops);
  }
  removeTroops(troops: number): number {
    if (troops <= 0) {
      return 0;
    }
    const toRemove = minInt(this._troops, toInt(troops));
    this._troops -= toRemove;
    return Number(toRemove);
  }

  age(): Age {
    return this._age;
  }

  setAge(a: Age): void {
    if (a !== this._age) {
      this._eraTriumphMask = 0;
      this._eraStartRenown = this._renown;
    }
    this._age = a;
  }

  techPoints(): number {
    return this._techPoints;
  }

  addTechPoints(n: number): void {
    this._techPoints += n;
  }

  // Primal-meta: raided knowledge. Clamp at 0 and return what was taken so a
  // raid transfer is conserved (mirror removeGold semantics).
  removeTechPoints(n: number): number {
    if (n <= 0) return 0;
    const removed = Math.min(this._techPoints, n);
    this._techPoints -= removed;
    return removed;
  }

  // --- Unified resource pool (Module §4 / R13) ---
  // The canonical accessor for the single shared pile.
  resources(): number {
    return this._resources;
  }

  // AI-NOTE: transitional aliases -> unified _resources pool (R13); per-kind HUD display unified in integration pass | expires: when HUD shows single Resources total
  wood(): number {
    return this._resources;
  }

  rocks(): number {
    return this._resources;
  }

  meat(): number {
    return this._resources;
  }

  fish(): number {
    return this._resources;
  }

  slaves(): number {
    return this._resources;
  }

  // R13: every adder writes the ONE shared pool. All CLAMP at 0 (the wood-sink
  // invariant extended to the whole pile): the pool can never go negative, so a
  // spend can't underflow it. addResource routes through the same clamp.
  addWood(n: number): void {
    this._resources = Math.max(0, this._resources + n);
  }

  // Spend up to `n` from the unified pool; returns the amount actually removed
  // (never negative). Used by the Primitive canoe (TransportShip) wood sink.
  removeWood(n: number): number {
    const removed = Math.min(this._resources, Math.max(0, n));
    this._resources -= removed;
    return removed;
  }

  addRocks(n: number): void {
    this._resources = Math.max(0, this._resources + n);
  }

  addMeat(n: number): void {
    this._resources = Math.max(0, this._resources + n);
  }

  addFish(n: number): void {
    this._resources = Math.max(0, this._resources + n);
  }

  // Spend up to `n` from the unified pool; returns the amount actually removed.
  removeFish(n: number): number {
    const removed = Math.min(this._resources, Math.max(0, n));
    this._resources -= removed;
    return removed;
  }

  addSlaves(n: number): void {
    this._resources = Math.max(0, this._resources + n);
  }

  // Spend up to `n` from the unified pool; returns the amount actually removed.
  // Used by the resources→gold conversion in PlayerExecution.
  removeSlaves(n: number): number {
    const removed = Math.min(this._resources, Math.max(0, n));
    this._resources -= removed;
    return removed;
  }

  addResource(kind: ResourceKind, amount: number): void {
    switch (kind) {
      case ResourceKind.Wood:
        this.addWood(amount);
        break;
      case ResourceKind.Rock:
        this.addRocks(amount);
        break;
      case ResourceKind.Meat:
        this.addMeat(amount);
        break;
      case ResourceKind.Fish:
        this.addFish(amount);
        break;
      case ResourceKind.None:
        break;
    }
  }

  isAnimalPack(): boolean {
    return this._isAnimalPack;
  }

  setIsAnimalPack(v: boolean): void {
    this._isAnimalPack = v;
  }

  isNeanderthal(): boolean {
    return this._isNeanderthal;
  }

  setIsNeanderthal(v: boolean): void {
    this._isNeanderthal = v;
  }

  threatScore(): number {
    return this._threatScore;
  }

  setThreatScore(n: number): void {
    this._threatScore = n;
  }

  dominantBiome(): Biome {
    return this._dominantBiome;
  }

  setDominantBiome(b: Biome): void {
    this._dominantBiome = b;
  }

  tribeArchetype(): TribeArchetype {
    return this._tribeArchetype;
  }

  setTribeArchetype(t: TribeArchetype): void {
    this._tribeArchetype = t;
  }

  ageAdvanceCredit(): number {
    return this._ageAdvanceCredit;
  }

  setAgeAdvanceCredit(n: number): void {
    // Clamp to [0,1]: it is a diffusion discount fraction.
    this._ageAdvanceCredit = n < 0 ? 0 : n > 1 ? 1 : n;
  }

  addAgeAdvanceCredit(n: number): void {
    this.setAgeAdvanceCredit(this._ageAdvanceCredit + n);
  }

  integrationDebt(): number {
    return this._integrationDebt;
  }

  setIntegrationDebt(n: number): void {
    this._integrationDebt = n < 0 ? 0 : n;
  }

  addIntegrationDebt(n: number): void {
    if (n <= 0) {
      return;
    }
    this._integrationDebt += n;
  }

  // Record a newly captured tile for frontier-revolt ordering (most recent last).
  // Bounded ring so a long streak can't grow this unboundedly.
  recordCapture(tile: TileRef): void {
    this._recentCaptures.push(tile);
    if (this._recentCaptures.length > MAX_RECENT_CAPTURES) {
      this._recentCaptures.shift();
    }
  }

  // Recently-captured tiles in capture order (oldest first, newest last).
  recentCaptures(): readonly TileRef[] {
    return this._recentCaptures;
  }

  // Drop a tile from the recent-capture ring (e.g. after it revolts or is lost).
  forgetCapture(tile: TileRef): void {
    const idx = this._recentCaptures.indexOf(tile);
    if (idx !== -1) {
      this._recentCaptures.splice(idx, 1);
    }
    this._captureTickByTile.delete(tile);
  }

  // Capture-grace bookkeeping. Re-insert to refresh insertion order so the
  // eviction below always drops the OLDEST entry; Map iteration order is
  // insertion order, identical on every lockstep peer → deterministic.
  markCaptureTick(tile: TileRef, tick: number): void {
    this._captureTickByTile.delete(tile);
    this._captureTickByTile.set(tile, tick);
    if (this._captureTickByTile.size > MAX_CAPTURE_TICK_ENTRIES) {
      const oldest = this._captureTickByTile.keys().next().value;
      if (oldest !== undefined) {
        this._captureTickByTile.delete(oldest);
      }
    }
  }

  captureTick(tile: TileRef): number | undefined {
    return this._captureTickByTile.get(tile);
  }

  attritionLevel(): number {
    return this._attritionLevel;
  }

  setAttritionLevel(n: number): void {
    this._attritionLevel = n;
  }

  renown(): number {
    return this._renown;
  }

  addRenown(n: number): void {
    this._renown += n;
  }

  coalitionTargetID(): PlayerID | null {
    // An expired pact reports no target (membership lapses automatically).
    if (this._coalitionTargetID === null) {
      return null;
    }
    if (this.mg.ticks() >= this._coalitionEndTick) {
      return null;
    }
    return this._coalitionTargetID;
  }

  joinCoalition(targetID: PlayerID, endTick: Tick): void {
    this._coalitionTargetID = targetID;
    this._coalitionEndTick = endTick;
  }

  leaveCoalition(): void {
    this._coalitionTargetID = null;
    this._coalitionEndTick = 0;
  }

  inActiveCoalition(): boolean {
    return this.coalitionTargetID() !== null;
  }

  isCoalitionPartner(other: Player): boolean {
    if (other === this) {
      return false;
    }
    const mine = this.coalitionTargetID();
    if (mine === null) {
      return false;
    }
    return other.coalitionTargetID() === mine;
  }

  isCoalitionTargetOf(other: Player): boolean {
    if (other === this) {
      return false;
    }
    return other.coalitionTargetID() === this.id();
  }

  advancePenaltyActive(): boolean {
    return this.mg.ticks() < this._advancePenaltyEndTick;
  }

  setAdvancePenalty(endTick: Tick): void {
    this._advancePenaltyEndTick = endTick;
  }

  absorbedTribes(): number {
    return this._absorbedTribes;
  }

  absorbTribes(count: number): void {
    if (count > 0) this._absorbedTribes += Math.floor(count);
  }

  eraTriumphMask(): number {
    return this._eraTriumphMask;
  }

  eraTriumphCount(): number {
    let mask = this._eraTriumphMask;
    let count = 0;
    while (mask !== 0) {
      count += mask & 1;
      mask >>>= 1;
    }
    return count;
  }

  eraRenownEarned(): number {
    return Math.max(0, this._renown - this._eraStartRenown);
  }

  refreshEraTriumphs(): void {
    if (this._age >= Age.Alien || this._isAnimalPack || this._isNeanderthal) {
      return;
    }
    const config = this.mg.config();
    const baseCost = config.baseAdvanceAgeCost(this._age);
    if (baseCost === null) return;

    let mask = this._eraTriumphMask;
    const effectiveBaseTech = Math.ceil(
      baseCost.techPoints * (1 - this._ageAdvanceCredit),
    );
    if (
      this._techPoints >=
      Math.ceil(effectiveBaseTech * config.eraIngenuityTargetMult())
    ) {
      mask |= EraTriumph.Ingenuity;
    }
    if (this._gold >= config.eraProsperityTarget(this._age)) {
      mask |= EraTriumph.Prosperity;
    }
    const debtRatio =
      this._integrationDebt / Math.max(1, config.overextensionCapacity(this));
    if (
      this.numTilesOwned() >= config.eraDominionTarget(this._age) &&
      debtRatio <= config.eraDominionMaxDebtRatio()
    ) {
      mask |= EraTriumph.Dominion;
    }
    if (this.eraRenownEarned() >= config.eraLegacyTarget(this._age)) {
      mask |= EraTriumph.Legacy;
    }
    this._eraTriumphMask = mask;
  }

  // Era-overhaul: advancement is CRITERIA-based, no gold spend (Module B).
  // - Primitive→Imperial: own ≥1 permanent settlement (City). Settling IS the
  //   criterion — no tech/gold gate for the first step.
  // - Later ages: own that age's keystone structure AND have techPoints ≥ a
  //   threshold whose effective value is cut by diffusion (ageAdvanceCredit).
  meetsAdvanceCriteria(): boolean {
    if (this._age >= Age.Alien) {
      return false;
    }
    // Module §6 — animal packs are nomadic predators: they never tech up and
    // stay Primitive forever (they also accrue ZERO techPoints in
    // PlayerExecution). This is the authoritative gate.
    if (this._isAnimalPack) {
      return false;
    }
    // Module §7 — Neanderthals can never advance past Primitive. They hold no
    // money (addGold is a no-op for them) so the Primitive→Imperial gold gate
    // below already blocks them; this explicit gate makes the intent
    // authoritative and robust even if an advance cost is ever zero.
    if (this._isNeanderthal) {
      return false;
    }
    this.refreshEraTriumphs();
    const config = this.mg.config();
    const cost = config.advanceAgeCost(this);
    if (cost === null) {
      return false;
    }
    if (!this.holdsAdvanceGates()) {
      return false;
    }
    if (this._age !== Age.Primitive) {
      // Diffusion discount: each unit of ageAdvanceCredit (0..1) waives that
      // fraction of the tech requirement.
      const effectiveTech = cost.techPoints * (1 - this._ageAdvanceCredit);
      if (this._techPoints < effectiveTech) {
        return false;
      }
    }
    // Module §6 — advancement now also costs gold (deducted in advanceAge);
    // block it if the player cannot afford the toll.
    return this._gold >= cost.gold;
  }

  // Primal-meta: the STRUCTURAL half of the advance criteria (settlement /
  // keystone only — no gold, no tech). This is what a Great Work must keep
  // holding while under way: lose the gate and the ritual fails.
  holdsAdvanceGates(): boolean {
    if (this._age === Age.Primitive) {
      // Primitive→next gate: own ≥1 permanent settlement (City). AI-NOTE: was
      // ≥2 Cities (= 250k gold) which, with the gutted Primitive income + no
      // trade economy, was unreachable and froze every tribe in Primitive.
      // Lowered to 1 so a developing tribe can actually advance; tunable
      // (Phase 3 climate ramp re-adds early-game harshness). | evidence:
      // docs/ICE_AGE_ECONOMY.md §A, tests/Unfreeze.test.ts
      return (
        this.unitsOwned(UnitType.City) >= this.mg.config().citiesToAdvance()
      );
    }
    const keystone = this.mg.config().advanceKeystone(this._age);
    return keystone === null || this.unitsOwned(keystone) >= 1;
  }

  canAdvanceAge(): boolean {
    return this.meetsAdvanceCriteria();
  }

  advanceAge(): boolean {
    if (!this.canAdvanceAge()) {
      return false;
    }
    // Module §6 — advancing an Age now actually COSTS wealth (it no longer
    // spends nothing). Deduct the gold toll for the current age and consume the
    // tech investment. meetsAdvanceCriteria already verified affordability, so
    // removeGold here always seizes the full toll. advanceAgeCost() returns the
    // {gold, techPoints} table from Config (~1147). AI-NOTE: the gold deduction
    // MUST stay paired with the `this._gold >= cost.gold` check in
    // meetsAdvanceCriteria — removing either lets players advance for free
    // again. | evidence: tests/AdvanceAge*.test.ts
    const config = this.mg.config();
    const triumphCount = this.eraTriumphCount();
    const cost = config.advanceAgeCost(this);
    if (cost !== null) {
      this.removeGold(cost.gold);
      // Consume the diffusion-adjusted tech investment spent reaching this age
      // (Primitive carries no tech threshold, so this is a no-op there).
      const techSpent = cost.techPoints * (1 - this._ageAdvanceCredit);
      this._techPoints = Math.max(0, this._techPoints - techSpent);
    }
    this._age++;
    this.setAdvancePenalty(
      this.mg.ticks() + config.advancePenaltyTicks(triumphCount),
    );
    // Diffusion credit is spent on advancing — reset toward the next age.
    this._ageAdvanceCredit = 0;
    this._eraTriumphMask = 0;
    this._eraStartRenown = this._renown;
    // Primal-meta: the FIRST player in the world to reach an Age enters a
    // GOLDEN AGE — the first-mover burst that makes eating the advance premium
    // (and arming rivals via diffusion below) worth the timing gamble.
    if (this.mg.recordEraReached(this, this._age)) {
      this._goldenAgeEndTick = this.mg.ticks() + config.goldenAgeTicks();
      this.mg.displayMessage(
        "events_display.golden_age",
        MessageType.GOLDEN_AGE,
        null,
        undefined,
        { player: this.displayName(), age: Age[this._age] },
      );
    } else {
      // Not a world first — tell the advancing player only (avoids 100+ bot
      // advances spamming everyone's event feed).
      this.mg.displayMessage(
        "events_display.era_advanced",
        MessageType.ERA_ADVANCED,
        this.id(),
        undefined,
        { player: this.displayName(), age: Age[this._age] },
      );
    }
    // Broadcast technology diffusion to every other player (GameImpl, Module B).
    this.mg.grantEraDiffusion(this, this._age);
    return true;
  }

  // --- Primal-meta: Great Work lifecycle (state only — the ritual flow is ---
  // --- driven by AdvanceAgeExecution; raids call setbackGreatWork). --------

  greatWork(): GreatWork | null {
    return this._greatWork;
  }

  // Open a Great Work toward the next Age: validates the full advance criteria
  // (gates + tech + gold) and ESCROWS the gold toll so the treasury can't be
  // spent out from under the ritual (and so raiders see a committed target).
  startGreatWork(): boolean {
    if (this._greatWork !== null) return false;
    if (!this.meetsAdvanceCriteria()) return false;
    const cost = this.mg.config().advanceAgeCost(this);
    if (cost === null) return false;
    const escrow = this.removeGold(cost.gold);
    this._greatWork = {
      targetAge: (this._age + 1) as Age,
      progress: 0,
      required: this.mg
        .config()
        .greatWorkTicks(this._age, this.eraTriumphCount()),
      escrow,
    };
    return true;
  }

  setGreatWorkProgress(n: number): void {
    if (this._greatWork === null) return;
    this._greatWork.progress = Math.max(0, n);
  }

  // Knock progress back (successful raid). Returns true iff a work was hit.
  setbackGreatWork(ticks: number): boolean {
    if (this._greatWork === null || ticks <= 0) return false;
    this._greatWork.progress = Math.max(0, this._greatWork.progress - ticks);
    return true;
  }

  // The ritual collapses (gate lost / owner died): refund refundBps basis
  // points of the escrow, the rest is sunk into the ruins.
  failGreatWork(refundBps: number): void {
    if (this._greatWork === null) return;
    const bps = Math.max(0, Math.min(10000, Math.floor(refundBps)));
    const refund = (this._greatWork.escrow * BigInt(bps)) / 10000n;
    if (refund > 0n) {
      this.addGold(refund);
    }
    this._greatWork = null;
  }

  // Attempt completion: release the escrow back into the treasury and run the
  // real advanceAge() (which re-validates and deducts). If the advance cannot
  // fire (e.g. tech was raided below the threshold mid-ritual), RE-escrow and
  // report false — the work stalls at full progress until criteria recover.
  completeGreatWork(): boolean {
    if (this._greatWork === null) return false;
    const escrow = this._greatWork.escrow;
    if (escrow > 0n) {
      this.addGold(escrow);
    }
    if (this.advanceAge()) {
      this._greatWork = null;
      return true;
    }
    this._greatWork.escrow = this.removeGold(escrow);
    return false;
  }

  goldenAgeActive(): boolean {
    return this.mg.ticks() < this._goldenAgeEndTick;
  }

  captureUnit(unit: Unit): void {
    if (unit.owner() === this) {
      throw new Error(`Cannot capture unit, ${this} already owns ${unit}`);
    }
    unit.setOwner(this);
  }

  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit {
    if (this.mg.config().isUnitDisabled(type)) {
      throw new Error(
        `Attempted to build disabled unit ${type} at tile ${spawnTile} by player ${this.name()}`,
      );
    }

    const cost = this.mg.unitInfo(type).cost(this.mg, this);
    const b = new UnitImpl(
      type,
      this.mg,
      spawnTile,
      this.mg.nextUnitID(),
      this,
      params,
    );
    this._units.push(b);
    this.recordUnitConstructed(type);
    this.removeGold(cost);
    this.removeTroops("troops" in params ? (params.troops ?? 0) : 0);
    this.mg.addUpdate(b.toUpdate());
    this.mg.addUnit(b);

    return b;
  }

  public findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false {
    const unit = this.findExistingUnitToUpgrade(type, targetTile);
    if (unit === false || !this.canUpgradeUnit(unit)) {
      return false;
    }
    return unit;
  }

  private findExistingUnitToUpgrade(
    type: UnitType,
    targetTile: TileRef,
  ): Unit | false {
    const closest = findClosestBy(
      this.mg.nearbyUnits(
        targetTile,
        this.mg.config().structureMinDist(),
        type,
        undefined,
        true,
      ),
      (entry) => entry.distSquared,
    );

    return closest?.unit ?? false;
  }

  private canBuildUnitType(
    unitType: UnitType,
    knownCost: Gold | null = null,
  ): boolean {
    if (this.mg.config().isUnitDisabled(unitType)) {
      return false;
    }
    const cost = knownCost ?? this.mg.unitInfo(unitType).cost(this.mg, this);
    if (this._gold < cost) {
      return false;
    }
    if (unitType !== UnitType.MIRVWarhead && !this.isAlive()) {
      return false;
    }
    const info = this.mg.unitInfo(unitType);
    if (info.minAge !== undefined && this.age() < info.minAge) {
      return false;
    }
    // Era-overhaul: reject units obsolete past their maxAge (e.g. the Hut after
    // Primitive). buildableUnits() routes through here, so it is honored there.
    if (info.maxAge !== undefined && this.age() > info.maxAge) {
      return false;
    }
    // Trade Outpost hard cap (≤ tradeOutpostMaxCount per tribe). THE single build
    // chokepoint — every path (bot tryBuild, build menu, ConstructionExecution's
    // re-check) routes here, so a player can never exceed the cap. unitsOwned
    // counts under-construction units, so two queued builds can't both slip past.
    if (
      unitType === UnitType.TradeOutpost &&
      this.unitsOwned(UnitType.TradeOutpost) >=
        this.mg.config().tradeOutpostMaxCount()
    ) {
      return false;
    }
    return true;
  }

  private canUpgradeUnitType(unitType: UnitType): boolean {
    return Boolean(this.mg.config().unitInfo(unitType).upgradable);
  }

  private isUnitValidToUpgrade(unit: Unit): boolean {
    if (unit.isUnderConstruction()) {
      return false;
    }
    if (unit.isMarkedForDeletion()) {
      return false;
    }
    if (unit.owner() !== this) {
      return false;
    }
    return true;
  }

  public canUpgradeUnit(unit: Unit): boolean {
    if (!this.canUpgradeUnitType(unit.type())) {
      return false;
    }
    if (!this.canBuildUnitType(unit.type())) {
      return false;
    }
    if (!this.isUnitValidToUpgrade(unit)) {
      return false;
    }
    return true;
  }

  upgradeUnit(unit: Unit) {
    const cost = this.mg.unitInfo(unit.type()).cost(this.mg, this);
    this.removeGold(cost);
    unit.increaseLevel();
    this.recordUnitConstructed(unit.type());
  }

  public buildableUnits(
    tile: TileRef | null,
    units: readonly PlayerBuildableUnitType[] = PlayerBuildable.types,
  ): BuildableUnit[] {
    const mg = this.mg;
    const config = mg.config();
    const rail = mg.railNetwork();
    const inSpawnPhase = mg.inSpawnPhase();

    const validTiles =
      tile !== null && units.some((u) => Structures.has(u))
        ? this.validStructureSpawnTiles(tile)
        : [];

    const len = units.length;
    const result = new Array<BuildableUnit>(len);

    for (let i = 0; i < len; i++) {
      const u = units[i];

      const cost = config.unitInfo(u).cost(mg, this);
      let canUpgrade: number | false = false;
      let canBuild: TileRef | false = false;

      if (tile !== null && this.canBuildUnitType(u, cost) && !inSpawnPhase) {
        if (this.canUpgradeUnitType(u)) {
          const existingUnit = this.findExistingUnitToUpgrade(u, tile);
          if (
            existingUnit !== false &&
            this.isUnitValidToUpgrade(existingUnit)
          ) {
            canUpgrade = existingUnit.id();
          }
        }
        canBuild = this.canSpawnUnitType(u, tile, validTiles);
      }

      const buildNew = canBuild !== false && canUpgrade === false;

      result[i] = {
        type: u,
        canBuild,
        canUpgrade,
        cost,
        overlappingRailroads: buildNew
          ? rail.overlappingRailroads(canBuild as TileRef)
          : [],
        ghostRailPaths: buildNew
          ? rail.computeGhostRailPaths(u, canBuild as TileRef)
          : [],
      };
    }

    return result;
  }

  canBuild(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    if (!this.canBuildUnitType(unitType)) {
      return false;
    }

    return this.canSpawnUnitType(unitType, targetTile, validTiles);
  }

  private canSpawnUnitType(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null,
  ): TileRef | false {
    switch (unitType) {
      case UnitType.MIRV:
        if (!this.mg.hasOwner(targetTile)) {
          return false;
        }
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.MIRVWarhead:
        return targetTile;
      case UnitType.Port:
        return this.portSpawn(targetTile, validTiles);
      case UnitType.Warship:
        return this.warshipSpawn(targetTile);
      case UnitType.Shell:
      case UnitType.SAMMissile:
        return targetTile;
      case UnitType.TransportShip:
        return canBuildTransportShip(this.mg, this, targetTile);
      case UnitType.TradeShip:
        return this.tradeShipSpawn(targetTile);
      case UnitType.Train:
        return this.landBasedUnitSpawn(targetTile);
      case UnitType.Hut:
        return this.hutSpawn(targetTile, validTiles);
      case UnitType.ScoutLookout:
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.Palisade:
      case UnitType.Granary:
      case UnitType.ArtilleryFort:
      case UnitType.Airbase:
      case UnitType.SupplyDepot:
      case UnitType.Wonder:
      case UnitType.EonSite:
      case UnitType.PrimitiveFarm:
      case UnitType.TradeOutpost:
        return this.landBasedStructureSpawn(targetTile, validTiles);
      case UnitType.Harbor:
        // TODO(eonfront): coastal placement. Treated as a land-based structure
        // for now so it is placeable & gated.
        return this.landBasedStructureSpawn(targetTile, validTiles);
      default:
        assertNever(unitType);
    }
  }

  nukeSpawn(tile: TileRef, nukeType: UnitType): TileRef | false {
    const mg = this.mg;
    if (mg.isSpawnImmunityActive()) {
      return false;
    }
    const owner = this.mg.owner(tile);
    // Allow nuking teammates after the game is over (aftergame fun)
    const gameOver = mg.getWinner() !== null;
    if (owner.isPlayer()) {
      if (this.isOnSameTeam(owner) && !gameOver) {
        return false;
      }
    }
    const config = mg.config();

    // Prevent launching nukes that would hit teammate structures (only in team games).
    // Disabled after game-over so players can nuke teammates in the aftergame.
    if (
      config.gameConfig().gameMode === GameMode.Team &&
      nukeType !== UnitType.MIRV &&
      !gameOver
    ) {
      const magnitude = config.nukeMagnitudes(nukeType);
      const wouldHitTeammate = mg.anyUnitNearby(
        tile,
        magnitude.outer,
        Structures.types,
        (unit) => unit.owner().isPlayer() && this.isOnSameTeam(unit.owner()),
      );
      if (wouldHitTeammate) {
        return false;
      }
    }

    // only get missilesilos that are not on cooldown and not under construction
    const bestSilo = findClosestBy(
      this.units(UnitType.MissileSilo),
      (silo) => mg.manhattanDist(silo.tile(), tile),
      (silo) =>
        silo.isActive() && !silo.isInCooldown() && !silo.isUnderConstruction(),
    );

    return bestSilo?.tile() ?? false;
  }

  portSpawn(tile: TileRef, validTiles: TileRef[] | null): TileRef | false {
    const spawns = Array.from(
      this.mg.bfs(
        tile,
        manhattanDistFN(tile, this.mg.config().radiusPortSpawn()),
      ),
    )
      .filter((t) => this.mg.owner(t) === this && this.mg.isShore(t))
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a, tile) - this.mg.manhattanDist(b, tile),
      );
    const validTileSet = new Set(
      validTiles ?? this.validStructureSpawnTiles(tile),
    );
    for (const t of spawns) {
      if (validTileSet.has(t)) {
        return t;
      }
    }
    return false;
  }

  warshipSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isWater(tile)) {
      return false;
    }

    const tileComponent = this.mg.getWaterComponent(tile);
    const bestPort = findClosestBy(
      this.units(UnitType.Port),
      (port) => this.mg.manhattanDist(port.tile(), tile),
      (port) =>
        port.isActive() &&
        !port.isUnderConstruction() &&
        tileComponent !== null &&
        this.mg.hasWaterComponent(port.tile(), tileComponent),
    );

    return bestPort?.tile() ?? false;
  }

  landBasedUnitSpawn(tile: TileRef): TileRef | false {
    return this.mg.isLand(tile) ? tile : false;
  }

  landBasedStructureSpawn(
    tile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    const tiles = validTiles ?? this.validStructureSpawnTiles(tile);
    if (tiles.length === 0) {
      return false;
    }
    return tiles[0];
  }

  // A Hut is a temporary camp; you cannot cluster them. Beyond the generic
  // structure spacing, reject a hut placed within hutMinSpacing tiles of an
  // existing one so each tribe scatters its outposts.
  private hutSpawn(
    tile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    const spawn = this.landBasedStructureSpawn(tile, validTiles);
    if (spawn === false) {
      return false;
    }
    const minDistSquared = this.mg.config().hutMinSpacing() ** 2;
    for (const hut of this.units(UnitType.Hut)) {
      if (this.mg.euclideanDistSquared(hut.tile(), spawn) < minDistSquared) {
        return false;
      }
    }
    return spawn;
  }

  private validStructureSpawnTiles(tile: TileRef): TileRef[] {
    if (this.mg.owner(tile) !== this) {
      return [];
    }
    const searchRadius = 15;
    const searchRadiusSquared = searchRadius ** 2;

    const nearbyUnits = this.mg.nearbyUnits(
      tile,
      searchRadius * 2,
      Structures.types,
      undefined,
      true,
    );
    const nearbyTiles = this.mg.bfs(tile, (gm, t) => {
      return (
        this.mg.euclideanDistSquared(tile, t) < searchRadiusSquared &&
        gm.ownerID(t) === this.smallID()
      );
    });
    const validSet: Set<TileRef> = new Set(nearbyTiles);

    const minDistSquared = this.mg.config().structureMinDist() ** 2;
    for (const t of nearbyTiles) {
      for (const { unit } of nearbyUnits) {
        if (this.mg.euclideanDistSquared(unit.tile(), t) < minDistSquared) {
          validSet.delete(t);
          break;
        }
      }
    }
    const valid = Array.from(validSet);
    valid.sort(
      (a, b) =>
        this.mg.euclideanDistSquared(a, tile) -
        this.mg.euclideanDistSquared(b, tile),
    );
    return valid;
  }

  tradeShipSpawn(targetTile: TileRef): TileRef | false {
    return this.units(UnitType.Port).find((u) => u.tile() === targetTile)
      ? targetTile
      : false;
  }
  lastTileChange(): Tick {
    return this._lastTileChange;
  }

  isDisconnected(): boolean {
    return this._isDisconnected;
  }

  markDisconnected(isDisconnected: boolean): void {
    this._isDisconnected = isDisconnected;
  }

  hash(): number {
    return (
      simpleHash(this.id()) * (this.troops() + this.numTilesOwned()) +
      this._units.reduce((acc, unit) => acc + unit.hash(), 0)
    );
  }
  toString(): string {
    return `Player:{name:${this.info().name},clientID:${
      this.info().clientID
    },isAlive:${this.isAlive()},troops:${
      this._troops
    },numTileOwned:${this.numTilesOwned()}}]`;
  }

  public playerProfile(): PlayerProfile {
    const rel = {
      relations: Object.fromEntries(
        this.allRelationsSorted().map(({ player, relation }) => [
          player.smallID(),
          relation,
        ]),
      ),
      alliances: this.alliances().map((a) => a.other(this).smallID()),
    };
    return rel;
  }

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack {
    const attack = new AttackImpl(
      this._pseudo_random.nextID(),
      target,
      this,
      troops,
      sourceTile,
      border,
      this.mg,
    );
    this._outgoingAttacks.push(attack);
    if (target.isPlayer()) {
      (target as PlayerImpl)._incomingAttacks.push(attack);
    }
    return attack;
  }
  outgoingAttacks(): Attack[] {
    return this._outgoingAttacks;
  }
  incomingAttacks(): Attack[] {
    return this._incomingAttacks.filter((a) => a.attacker().isAlive());
  }

  public isImmune(): boolean {
    if (this.type() === PlayerType.Human) {
      return this.mg.isSpawnImmunityActive();
    }
    if (this.type() === PlayerType.Nation) {
      return this.mg.isNationSpawnImmunityActive();
    }
    return false;
  }

  public canAttackPlayer(
    player: Player,
    treatAFKFriendly: boolean = false,
  ): boolean {
    // Coalition non-aggression: members of the same active coalition (same
    // target) cannot attack one another while the pact stands (Module E).
    if (this.isCoalitionPartner(player)) {
      return false;
    }
    if (this.type() === PlayerType.Bot) {
      // Bots are not affected by immunity
      return !this.isFriendly(player, treatAFKFriendly);
    }
    // Humans and Nations respect immunity
    return !player.isImmune() && !this.isFriendly(player, treatAFKFriendly);
  }

  public canAttack(tile: TileRef): boolean {
    const owner = this.mg.owner(tile);
    if (owner === this) {
      return false;
    }

    if (owner.isPlayer() && !this.canAttackPlayer(owner)) {
      return false;
    }

    if (!this.mg.isLand(tile)) {
      return false;
    }
    if (this.mg.hasOwner(tile)) {
      return this.sharesBorderWith(owner);
    } else {
      for (const t of this.mg.bfs(
        tile,
        andFN(
          (gm, t) => !gm.hasOwner(t) && gm.isLand(t),
          manhattanDistFN(tile, 200),
        ),
      )) {
        for (const n of this.mg.neighbors(t)) {
          if (this.mg.owner(n) === this) {
            return true;
          }
        }
      }
      return false;
    }
  }

  bestTransportShipSpawn(targetTile: TileRef): TileRef | false {
    return bestShoreDeploymentSource(this.mg, this, targetTile) ?? false;
  }
}
