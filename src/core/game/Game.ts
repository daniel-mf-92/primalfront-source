import { Config } from "../configuration/Config";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import { AllPlayersStats, ClientID } from "../Schemas";
import { formatPlayerDisplayName } from "../Util";
import { GameMap, TileRef } from "./GameMap";
import {
  GameUpdate,
  GameUpdateType,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { MotionPlanRecord } from "./MotionPlans";
import { RailNetwork } from "./RailNetwork";
import { Stats } from "./Stats";
import { UnitPredicate } from "./UnitGrid";

function isEnumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
}

export type PlayerID = string;
export type Tick = number;
export type Gold = bigint;

export type WarshipState = {
  state: "patrolling" | "retreating" | "docked";
  patrolTile?: TileRef;
  retreatPort?: TileRef;
  isInCombat?: boolean;
  lastCombatTick: number;
};

export type TransportShipState = {
  isRetreating: boolean;
  troops: number;
};

export const AllPlayers = "AllPlayers" as const;

// export type GameUpdates = Record<GameUpdateType, GameUpdate[]>;
// Create a type that maps GameUpdateType to its corresponding update type
type UpdateTypeMap<T extends GameUpdateType> = Extract<GameUpdate, { type: T }>;

// Then use it to create the record type
export type GameUpdates = {
  [K in GameUpdateType]: UpdateTypeMap<K>[];
};

export interface MapPos {
  x: number;
  y: number;
}

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}
export const isDifficulty = (value: unknown): value is Difficulty =>
  isEnumValue(Difficulty, value);

export type Team = string;

export interface SpawnArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TeamGameSpawnAreas = Record<string, SpawnArea[]>;

export const Duos = "Duos" as const;
export const Trios = "Trios" as const;
export const Quads = "Quads" as const;
export const HumansVsNations = "Humans Vs Nations" as const;

export const ColoredTeams: Record<string, Team> = {
  Red: "Red",
  Blue: "Blue",
  Teal: "Teal",
  Purple: "Purple",
  Yellow: "Yellow",
  Orange: "Orange",
  Green: "Green",
  Bot: "Bot",
  Humans: "Humans",
  Nations: "Nations",
} as const;

// GameMapType and the maps list are generated from
// map-generator/assets/maps/<map>/info.json by the map-generator
// (`npm run gen-maps`).
export {
  GameMapType,
  mapCategoryOrder,
  maps,
  type GameMapName,
  type MapCategory,
  type MapInfo,
} from "./Maps.gen";

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}
export const isGameType = (value: unknown): value is GameType =>
  isEnumValue(GameType, value);

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export enum RankedType {
  OneVOne = "1v1",
}

export const isGameMode = (value: unknown): value is GameMode =>
  isEnumValue(GameMode, value);

export enum GameMapSize {
  Compact = "Compact",
  Normal = "Normal",
}

export interface PublicGameModifiers {
  isCompact?: boolean;
  isRandomSpawn?: boolean;
  isCrowded?: boolean;
  isHardNations?: boolean;
  startingGold?: number;
  goldMultiplier?: number;
  isAlliancesDisabled?: boolean;
  isPortsDisabled?: boolean;
  isNukesDisabled?: boolean;
  isSAMsDisabled?: boolean;
  isPeaceTime?: boolean;
  isWaterNukes?: boolean;
}

export interface UnitInfo {
  cost: (game: Game, player: Player) => Gold;
  maxHealth?: number;
  damage?: number;
  constructionDuration?: number;
  upgradable?: boolean;
  minAge?: Age;
  // Highest Age this unit may be built in (inclusive). Mirrors `minAge`.
  // Used to hide/disable era-obsolete units (e.g. the Primitive-only Hut).
  maxAge?: Age;
}

function unitTypeGroup<T extends readonly UnitType[]>(types: T) {
  return {
    types,
    has(type: UnitType): type is T[number] {
      return (types as readonly UnitType[]).includes(type);
    },
  };
}

export enum UnitType {
  TransportShip = "Transport",
  Warship = "Warship",
  Shell = "Shell",
  SAMMissile = "SAMMissile",
  Port = "Port",
  AtomBomb = "Atom Bomb",
  HydrogenBomb = "Hydrogen Bomb",
  TradeShip = "Trade Ship",
  MissileSilo = "Missile Silo",
  DefensePost = "Defense Post",
  SAMLauncher = "SAM Launcher",
  City = "City",
  Hut = "Hut",
  MIRV = "MIRV",
  MIRVWarhead = "MIRV Warhead",
  Train = "Train",
  Factory = "Factory",
  Palisade = "Palisade",
  Granary = "Granary",
  ArtilleryFort = "Artillery Fort",
  Harbor = "Harbor",
  Airbase = "Airbase",
  SupplyDepot = "Supply Depot",
  Wonder = "Wonder",
  EonSite = "Eon Site",
  ScoutLookout = "Scout Lookout",
  PrimitiveFarm = "Primitive Farm",
  TradeOutpost = "Trade Outpost",
}

export enum TrainType {
  Engine = "Engine",
  TailEngine = "TailEngine",
  Carriage = "Carriage",
}

export const Nukes = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.MIRV,
] as const);

export const BuildableAttacks = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.Warship,
] as const);

export const Structures = unitTypeGroup([
  UnitType.City,
  UnitType.Hut,
  UnitType.ScoutLookout,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Port,
  UnitType.Factory,
  UnitType.Palisade,
  UnitType.Granary,
  UnitType.ArtilleryFort,
  UnitType.Harbor,
  UnitType.Airbase,
  UnitType.SupplyDepot,
  UnitType.Wonder,
  UnitType.EonSite,
  UnitType.PrimitiveFarm,
  UnitType.TradeOutpost,
] as const);

export const BuildMenus = unitTypeGroup([
  ...Structures.types,
  ...BuildableAttacks.types,
] as const);

export const PlayerBuildable = unitTypeGroup([
  ...BuildMenus.types,
  UnitType.TransportShip,
] as const);

export type PlayerBuildableUnitType = (typeof PlayerBuildable.types)[number];

export interface OwnerComp {
  owner: Player;
}

export type TrajectoryTile = {
  tile: TileRef;
  targetable: boolean;
};
export interface UnitParamsMap {
  [UnitType.TransportShip]: {
    troops?: number;
    targetTile?: TileRef;
  };

  [UnitType.Warship]: {
    patrolTile: TileRef;
  };

  [UnitType.Shell]: Record<string, never>;

  [UnitType.SAMMissile]: Record<string, never>;

  [UnitType.Port]: Record<string, never>;

  [UnitType.AtomBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.HydrogenBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.TradeShip]: {
    targetUnit: Unit;
    lastSetSafeFromPirates?: number;
  };

  [UnitType.Train]: {
    trainType: TrainType;
    targetUnit?: Unit;
    loaded?: boolean;
  };

  [UnitType.Factory]: Record<string, never>;

  [UnitType.MissileSilo]: Record<string, never>;

  [UnitType.DefensePost]: Record<string, never>;

  [UnitType.SAMLauncher]: Record<string, never>;

  [UnitType.City]: Record<string, never>;

  [UnitType.Hut]: Record<string, never>;
  [UnitType.PrimitiveFarm]: Record<string, never>;
  [UnitType.TradeOutpost]: Record<string, never>;
  [UnitType.ScoutLookout]: Record<string, never>;

  [UnitType.Palisade]: Record<string, never>;

  [UnitType.Granary]: Record<string, never>;

  [UnitType.ArtilleryFort]: Record<string, never>;

  [UnitType.Harbor]: Record<string, never>;

  [UnitType.Airbase]: Record<string, never>;

  [UnitType.SupplyDepot]: Record<string, never>;

  [UnitType.Wonder]: Record<string, never>;

  [UnitType.EonSite]: Record<string, never>;

  [UnitType.MIRV]: {
    targetTile?: number;
  };

  [UnitType.MIRVWarhead]: {
    targetTile?: number;
  };
}

// Type helper to get params type for a specific unit type
export type UnitParams<T extends UnitType> = UnitParamsMap[T];

export type AllUnitParams = UnitParamsMap[keyof UnitParamsMap];

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

// AI-NOTE: the enum ORDER is the progression order — advanceAge() does `_age++`
// (PlayerImpl), so a new era MUST be inserted at its progression position and the
// later values renumbered, NOT appended at the end. Three RAW-INTEGER age-indexed
// structures shadow these values and were reshuffled in lockstep when Classical
// was inserted: ERA_MUSIC_URLS (SoundManager.ts), INTEGRATION_DEBT_PER_CAPTURE and
// ATTACK_TILES_PER_TICK_AGE_MULT (Config.ts), plus AGE_IMPERIAL in structure-theme.ts.
// Everything else compares by enum NAME and is renumber-safe. | evidence: tests/ClassicalEra.test.ts
export enum Age {
  Primitive = 0,
  Classical = 1, // settled "Kingdom" era — post-glacial agrarian realms (see docs/CLASSICAL_ERA.md)
  Imperial = 2,
  Feudal = 3,
  Enlightened = 4,
  Industrial = 5,
  Modern = 6,
  Alien = 7,
}

// Optional accomplishments earned while living through an era. They are a
// soft anti-beeline system: rushing remains legal, but each Triumph earned
// makes the next transition cheaper, faster, and less vulnerable.
export enum EraTriumph {
  Ingenuity = 1 << 0,
  Prosperity = 1 << 1,
  Dominion = 1 << 2,
  Legacy = 1 << 3,
}

// Primal-meta: the public, interruptible era-advance ritual. progress/required
// are ticks; escrow is the gold toll locked in at start (refunded into the
// advance on completion, partially refunded on failure). Replicated to
// PlayerView (progress bar + "raid to stop them" target).
export interface GreatWork {
  targetAge: Age;
  progress: number;
  required: number;
  escrow: Gold;
}

// Era-scaled polity title prefixed to a civilized player's display name (e.g.
// "Tribe of Daniel" → "Kingdom of Daniel" → "Empire of Daniel" as they advance).
// Animal packs are NOT civilizations and keep their raw archetype name, so this
// is applied in PlayerImpl.displayName() gated on !isAnimalPack(). English only
// (display names are proper nouns); keyed by enum, renumber-safe.
const ERA_TITLES: Record<Age, string> = {
  [Age.Primitive]: "Tribe of",
  [Age.Classical]: "Kingdom of",
  [Age.Imperial]: "Empire of",
  [Age.Feudal]: "Dominion of",
  [Age.Enlightened]: "Republic of",
  [Age.Industrial]: "Union of",
  [Age.Modern]: "Federation of",
  [Age.Alien]: "Ascendancy of",
};

export function eraTitle(age: Age): string {
  return ERA_TITLES[age] ?? "";
}

// Latitude-derived terrain biome (the map has no biome byte — see Module D).
// Green = temperate / plains. Forest = cool/wet woodland, Jungle = equatorial
// rainforest. New members are APPENDED (Forest=4, Jungle=5) so the existing
// wire values for Cold/Green/Arid/Sandy stay stable — the latitude ordering of
// the bands lives in Biome.ts, not the enum's numeric order.
export enum Biome {
  Cold = 0,
  Green = 1,
  Arid = 2,
  Sandy = 3,
  Forest = 4,
  Jungle = 5,
}

// Primitive-era predator tribe identity (Module F). Paired with a biome:
// Wolf↔Cold, Bear↔Green, Lion↔Arid, Jackal↔Sandy, Boar↔Forest, Tiger↔Jungle.
export enum TribeArchetype {
  Wolf = 0,
  Bear = 1,
  Lion = 2,
  Jackal = 3,
  Boar = 4,
  Tiger = 5,
}

export class Nation {
  constructor(
    public readonly spawnCell: Cell | undefined,
    public readonly playerInfo: PlayerInfo,
  ) {}
}

export class Cell {
  public index: number;

  private strRepr: string;

  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    this.strRepr = `Cell[${this.x},${this.y}]`;
  }

  pos(): MapPos {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString(): string {
    return this.strRepr;
  }
}

export enum TerrainType {
  Plains,
  Highland,
  Mountain,
  Ocean,
}

// Per-tile harvestable resource type (Module §4). Stored in the low 2 bits of
// the GameMap resourceMap byte (quantity in bits 2-7). The 2-bit tile-kind field
// holds the TILE-STORED kinds None/Wood/Rock/Fish (0..3); Meat is pile-only (never
// tile-seeded — granted from raiding/killing animal packs and hunting game herds),
// so it sits LAST at 4 and never touches the tile byte. AI-NOTE: keep the
// tile-stored kinds in 0..3 — RESOURCE_KIND_MASK is 0x3, so a kind ≥4 written to a
// tile would be masked to None. | evidence: GameMap.RESOURCE_KIND_MASK
export enum ResourceKind {
  None = 0,
  Wood = 1,
  Rock = 2,
  Fish = 3,
  Meat = 4,
}

export enum PlayerType {
  Bot = "BOT",
  Human = "HUMAN",
  Nation = "NATION",
}

export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
}

export interface Attack {
  id(): string;
  retreating(): boolean;
  retreated(): boolean;
  orderRetreat(): void;
  executeRetreat(): void;
  target(): Player | TerraNullius;
  attacker(): Player;
  troops(): number;
  setTroops(troops: number): void;
  isActive(): boolean;
  delete(): void;
  // The tile the attack originated from, mostly used for boat attacks.
  sourceTile(): TileRef | null;
  addBorderTile(tile: TileRef): void;
  removeBorderTile(tile: TileRef): void;
  clearBorder(): void;
  borderSize(): number;
  clusteredPositions(): TileRef[];
}

export interface AllianceRequest {
  accept(): void;
  reject(): void;
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  status(): "pending" | "accepted" | "rejected";
}

export interface Alliance {
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  expiresAt(): Tick;
  other(player: Player): Player;
}

export interface MutableAlliance extends Alliance {
  expire(): void;
  other(player: Player): Player;
  bothAgreedToExtend(): boolean;
  addExtensionRequest(player: Player): void;
  id(): number;
  extend(): void;
  onlyOneAgreedToExtend(): boolean;

  agreedToExtend(player: Player): boolean;
}

export class PlayerInfo {
  public readonly displayName: string;

  // Animal-pack flag (Module §1 taxonomy). Optional + defaulting false so the
  // ~dozen existing `new PlayerInfo(...)` call sites keep compiling. Only Bots
  // that roll into a predator pack get this set true (via setIsAnimalPack);
  // Humans/Nations stay false forever.
  private _isAnimalPack = false;

  // Neanderthal flag (Module §7 taxonomy). A primitive NPC tribe distinct from
  // both human tribes and animal packs: starts with the most population, hunts
  // mammoths, is strong vs predator packs — but can NEVER hold money (no trade),
  // so it can never advance past the Primitive era and dies off by the end of
  // it (climate attrition + admixture). Set true only on the Bots that roll
  // Neanderthal in TribeSpawner (mutually exclusive with _isAnimalPack);
  // Humans/Nations stay false forever.
  private _isNeanderthal = false;

  constructor(
    public readonly name: string,
    public readonly playerType: PlayerType,
    // null if tribe.
    public readonly clientID: ClientID | null,
    // TODO: make player id the small id
    public readonly id: PlayerID,
    public readonly isLobbyCreator: boolean = false,
    public readonly clanTag: string | null = null,
    public readonly friends: ClientID[] = [],
  ) {
    this.displayName = formatPlayerDisplayName(this.name, this.clanTag);
  }

  get isAnimalPack(): boolean {
    return this._isAnimalPack;
  }

  setIsAnimalPack(v: boolean): void {
    this._isAnimalPack = v;
  }

  get isNeanderthal(): boolean {
    return this._isNeanderthal;
  }

  setIsNeanderthal(v: boolean): void {
    this._isNeanderthal = v;
  }
}

export function isUnit(unit: unknown): unit is Unit {
  return (
    unit &&
    typeof unit === "object" &&
    "isUnit" in unit &&
    typeof unit.isUnit === "function" &&
    unit.isUnit()
  );
}

export interface Unit {
  isUnit(): this is Unit;

  // Common properties.
  id(): number;
  type(): UnitType;
  owner(): Player;
  info(): UnitInfo;
  isMarkedForDeletion(): boolean;
  markForDeletion(): void;
  isOverdueDeletion(): boolean;
  delete(displayMessage?: boolean, destroyer?: Player): void;
  tile(): TileRef;
  lastTile(): TileRef;
  move(tile: TileRef): void;
  isActive(): boolean;
  setOwner(owner: Player): void;
  touch(): void;
  hash(): number;
  toUpdate(): UnitUpdate;
  hasTrainStation(): boolean;
  setTrainStation(trainStation: boolean): void;
  wasDestroyedByEnemy(): boolean;
  destroyer(): Player | undefined;

  // Train
  trainType(): TrainType | undefined;
  isLoaded(): boolean | undefined;
  setLoaded(loaded: boolean): void;

  // Targeting
  setTargetTile(cell: TileRef | undefined): void;
  targetTile(): TileRef | undefined;
  setTrajectoryIndex(i: number): void;
  trajectoryIndex(): number;
  trajectory(): TrajectoryTile[];
  setTargetUnit(unit: Unit | undefined): void;
  targetUnit(): Unit | undefined;
  setTargetedBySAM(targeted: boolean): void;
  targetedBySAM(): boolean;
  setReachedTarget(): void;
  reachedTarget(): boolean;
  isTargetable(): boolean;
  setTargetable(targetable: boolean): void;

  // Health
  hasHealth(): boolean;
  warshipState(): WarshipState;
  updateWarshipState(update: Partial<WarshipState>): void;
  transportShipState(): TransportShipState;
  updateTransportShipState(update: Partial<TransportShipState>): void;
  health(): number;
  modifyHealth(delta: number, attacker?: Player): void;

  // Troops
  setTroops(troops: number): void;
  troops(): number;

  // --- UNIT SPECIFIC ---

  // SAMs & Missile Silos
  launch(): void;
  reloadMissile(): void;
  isInCooldown(): boolean;
  missileTimerQueue(): number[];

  // Trade Ships
  setSafeFromPirates(): void; // Only for trade ships
  isSafeFromPirates(): boolean; // Only for trade ships

  // Construction phase on structures
  isUnderConstruction(): boolean;
  setUnderConstruction(underConstruction: boolean): void;

  // Upgradable Structures
  level(): number;
  increaseLevel(): void;
  decreaseLevel(destroyer?: Player): void;
}

export interface TerraNullius {
  isPlayer(): false;
  id(): null;
  clientID(): ClientID;
  smallID(): number;
}

export interface Embargo {
  createdAt: Tick;
  isTemporary: boolean;
  target: Player;
}

export interface Player {
  // Basic Info
  smallID(): number;
  info(): PlayerInfo;
  name(): string;
  displayName(): string;
  clientID(): ClientID | null;
  id(): PlayerID;
  type(): PlayerType;
  isPlayer(): this is Player;
  toString(): string;
  isLobbyCreator(): boolean;

  // State & Properties
  isAlive(): boolean;
  isTraitor(): boolean;
  markTraitor(): void;
  largestClusterBoundingBox: { min: Cell; max: Cell } | null;
  lastTileChange(): Tick;

  isDisconnected(): boolean;
  markDisconnected(isDisconnected: boolean): void;

  hasSpawned(): boolean;
  setSpawnTile(spawnTile: TileRef): void;
  spawnTile(): TileRef | undefined;

  // Territory
  tiles(): ReadonlySet<TileRef>;
  // Live read-only view of the owned-tile set — NO defensive copy. For hot
  // read-only scans only; never conquer/relinquish while iterating it.
  tilesRef(): ReadonlySet<TileRef>;
  borderTiles(): ReadonlySet<TileRef>;
  numTilesOwned(): number;
  conquer(tile: TileRef): void;
  relinquish(tile: TileRef): void;

  // Resources & Troops
  gold(): Gold;
  addGold(toAdd: Gold, tile?: TileRef): void;
  removeGold(toRemove: Gold): Gold;
  troops(): number;
  setTroops(troops: number): void;
  addTroops(troops: number): void;
  removeTroops(troops: number): number;

  // R13 — UNIFIED resource pool (Module §4): wood, rocks, meat, fish and slaves
  // all flow into ONE shared integer pile (`resources()`). The per-kind methods
  // below are transitional aliases that all return the same unified total so
  // existing callers compile until the unified Resources HUD lands; gold stays a
  // separate bigint.
  resources(): number;
  wood(): number;
  rocks(): number;
  meat(): number;
  fish(): number;
  // Slaves/sacrifice taken by exterminating a tribe (Module §7) — converts to
  // gold over time; the sole conquest payoff in the Primitive era.
  slaves(): number;
  addWood(n: number): void;
  addRocks(n: number): void;
  addMeat(n: number): void;
  addFish(n: number): void;
  removeFish(n: number): number;
  addSlaves(n: number): void;
  removeSlaves(n: number): number;
  addResource(kind: ResourceKind, amount: number): void;

  // Animal-pack identity (Module §1). True only for the ~20% of Bots that roll
  // into a predator pack; Humans/Nations are always false.
  isAnimalPack(): boolean;

  // Neanderthal identity (Module §7). True only for the Bots that roll
  // Neanderthal at spawn; Humans/Nations/packs are always false. Drives the
  // no-money / no-advance / mammoth-hunt / climate-extinction behaviour.
  isNeanderthal(): boolean;
  setIsNeanderthal(v: boolean): void;

  // Age / tech progression
  age(): Age;
  setAge(a: Age): void;
  techPoints(): number;
  addTechPoints(n: number): void;
  // Remove up to n tech points (clamped at 0), returning what was actually
  // taken. Primal-meta: raided tech (RaidExecution loots knowledge from a
  // more advanced victim).
  removeTechPoints(n: number): number;
  // Wood: a Primitive-era resource harvested by capturing woodland (forest /
  // jungle) tiles. Spent on canoes (the Primitive boat). See Config wood knobs.
  wood(): number;
  addWood(n: number): void;
  removeWood(n: number): number;
  threatScore(): number;
  setThreatScore(n: number): void;
  advancePenaltyActive(): boolean;
  setAdvancePenalty(endTick: Tick): void;
  eraTriumphMask(): number;
  /** Subsistence floors inherited by absorbing other tribes. */
  absorbedTribes(): number;
  absorbTribes(count: number): void;
  eraTriumphCount(): number;
  eraRenownEarned(): number;
  refreshEraTriumphs(): void;
  canAdvanceAge(): boolean;
  advanceAge(): boolean;
  // True when this player satisfies the (money-free) criteria to advance to the
  // next Age (keystone structure + diffusion-discounted tech). See Module B.
  meetsAdvanceCriteria(): boolean;

  // --- Primal-meta: the Great Work (public, interruptible era advance) ---
  // Era advance is a RITUAL, not an instant purchase: startGreatWork() escrows
  // the gold toll and opens a timed work whose progress every player can see;
  // successful raids set it back (setbackGreatWork); losing the advance gates
  // (settlement/keystone) fails it (failGreatWork, partial refund); completion
  // performs the real advanceAge(). Driven by AdvanceAgeExecution.
  greatWork(): GreatWork | null;
  startGreatWork(): boolean;
  setGreatWorkProgress(n: number): void;
  setbackGreatWork(ticks: number): boolean;
  failGreatWork(refundBps: number): void;
  completeGreatWork(): boolean;
  // Structural half of meetsAdvanceCriteria (settlement/keystone only, no
  // gold/tech) — the condition a Great Work must HOLD while under way.
  holdsAdvanceGates(): boolean;
  // Primal-meta: Golden Age — the first player in the world to reach an Age
  // gets a temporary burst (regen/gold/attack). See Config goldenAge* knobs.
  goldenAgeActive(): boolean;

  // Era / biome / tribe identity (Foundation state; modules fill behavior).
  // Biome the bulk of the player's owned land sits in (Module D recomputes it).
  dominantBiome(): Biome;
  setDominantBiome(b: Biome): void;
  // Primitive predator-tribe identity (Module F assigns at spawn from biome).
  tribeArchetype(): TribeArchetype;
  setTribeArchetype(t: TribeArchetype): void;
  // Diffusion credit (0..1) toward the next Age — earned when others advance
  // (Module B). Reduces the effective tech threshold; reset to 0 on advance.
  ageAdvanceCredit(): number;
  setAgeAdvanceCredit(n: number): void;
  addAgeAdvanceCredit(n: number): void;

  // Anti-snowball state (modules fill behavior; foundation declares + serializes)
  integrationDebt(): number; // ungoverned recently-captured tiles
  setIntegrationDebt(n: number): void;
  addIntegrationDebt(n: number): void;
  recordCapture(tile: TileRef): void; // for frontier-revolt ordering
  recentCaptures(): readonly TileRef[];
  forgetCapture(tile: TileRef): void;
  // Capture-grace bookkeeping: when a tile was taken FROM another player, so
  // rewild/carrying-cap shedding can spare fresh conquests (captureGraceTicks).
  markCaptureTick(tile: TileRef, tick: number): void;
  captureTick(tile: TileRef): number | undefined;
  attritionLevel(): number; // per-attacker escalation
  setAttritionLevel(n: number): void;
  renown(): number; // cumulative score
  addRenown(n: number): void;

  // Primitive migration coordination (sim-only; NOT mirrored to PlayerView).
  // The migration system (PrimitiveMigrationExecution) and the passive rewild
  // (PlayerExecution.rewildUnsupportedFrontier) share this so they stop fighting
  // over the roaming blob: only the NEWEST clicked destination drives the tribe,
  // and the passive shed defers to the migration while a roam is in flight.
  // Deterministic tick/TileRef state — no RNG, lockstep-safe.
  beginMigration(target: TileRef): void; // claim the newest destination
  migrationTarget(): TileRef | null; // active destination (null = idle)
  migrationHeading(): { x: number; y: number } | null; // recent raw travel vector
  recordMigrationStep(dirX?: number, dirY?: number): void; // stamp "moved this tick"
  endMigration(): void; // clear the destination
  isMigrating(): boolean; // active destination + a recent step

  // Coalition-against-the-leader (Module E, anti-snowball social layer).
  // A player may join a time-boxed coalition targeting the current high-threat
  // leader; members gain a modest deterministic buff + mutual non-aggression.
  coalitionTargetID(): PlayerID | null; // who this player is coalitioned against, or null
  joinCoalition(targetID: PlayerID, endTick: Tick): void;
  leaveCoalition(): void;
  inActiveCoalition(): boolean; // member of a non-expired coalition right now
  // True if both this player and `other` are in the same active coalition
  // (same target) — used for the mutual non-aggression lock among members.
  isCoalitionPartner(other: Player): boolean;
  // True if this player is the target of `other`'s active coalition.
  isCoalitionTargetOf(other: Player): boolean;

  // Units
  units(...types: UnitType[]): Unit[];
  unitCount(type: UnitType): number;
  unitsConstructed(type: UnitType): number;
  unitsOwned(type: UnitType): number;
  buildableUnits(
    tile: TileRef | null,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[];
  canBuild(
    type: UnitType,
    targetTile: TileRef,
    validTiles?: TileRef[] | null,
  ): TileRef | false;
  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit;

  // Returns the existing unit that can be upgraded,
  // or false if it cannot be upgraded.
  // New units of the same type can upgrade existing units.
  // e.g. if a place a new city here, can it upgrade an existing city?
  findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false;
  canUpgradeUnit(unit: Unit): boolean;
  upgradeUnit(unit: Unit): void;
  captureUnit(unit: Unit): void;

  // Relations & Diplomacy
  nearby(): (Player | TerraNullius)[];
  sharesBorderWith(other: Player | TerraNullius): boolean;
  relation(other: Player): Relation;
  allRelationsSorted(): { player: Player; relation: Relation }[];
  updateRelation(other: Player, delta: number): void;
  decayRelations(): void;
  isOnSameTeam(other: Player): boolean;
  // Either allied or on same team.
  isFriendly(other: Player, treatAFKFriendly?: boolean): boolean;
  team(): Team | null;
  incomingAllianceRequests(): AllianceRequest[];
  outgoingAllianceRequests(): AllianceRequest[];
  alliances(): MutableAlliance[];
  expiredAlliances(): Alliance[];
  allies(): Player[];
  isAlliedWith(other: Player): boolean;
  allianceWith(other: Player): MutableAlliance | null;
  allianceInfo(other: Player): AllianceInfo | null;
  canSendAllianceRequest(other: Player): boolean;
  breakAlliance(alliance: Alliance): void;
  removeAllAlliances(): void;
  createAllianceRequest(recipient: Player): AllianceRequest | null;
  betrayals(): number;

  // Targeting
  canTarget(other: Player): boolean;
  target(other: Player): void;
  targets(): Player[];
  transitiveTargets(): Player[];

  // Communication
  canSendEmoji(recipient: Player | typeof AllPlayers): boolean;
  outgoingEmojis(): EmojiMessage[];
  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void;
  canSendQuickChat(recipient: Player): boolean;
  recordQuickChat(recipient: Player): void;

  // Donation
  canDonateGold(recipient: Player): boolean;
  canDonateTroops(recipient: Player): boolean;
  donateTroops(recipient: Player, troops: number): boolean;
  donateGold(recipient: Player, gold: Gold): boolean;
  canDeleteUnit(): boolean;
  recordDeleteUnit(): void;
  canEmbargoAll(): boolean;
  recordEmbargoAll(): void;

  // Embargo
  hasEmbargoAgainst(other: Player): boolean;
  tradingPartners(): Player[];
  addEmbargo(other: Player, isTemporary: boolean): void;
  getEmbargoes(): Embargo[];
  stopEmbargo(other: Player): void;
  endTemporaryEmbargo(other: Player): void;
  canTrade(other: Player): boolean;

  // Attacking.
  canAttack(tile: TileRef): boolean;
  canAttackPlayer(player: Player, treatAFKFriendly?: boolean): boolean;
  isImmune(): boolean;

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack;
  outgoingAttacks(): Attack[];
  incomingAttacks(): Attack[];
  orderRetreat(attackID: string): void;
  executeRetreat(attackID: string): void;

  // Misc
  toUpdate(
    statsOut?: number[],
    attackTroopsOut?: number[],
  ): PlayerUpdate | null;
  playerProfile(): PlayerProfile;
  // WARNING: this operation is expensive.
  bestTransportShipSpawn(tile: TileRef): TileRef | false;
}

export interface Game extends GameMap {
  // Map & Dimensions
  isOnMap(cell: Cell): boolean;
  width(): number;
  height(): number;
  map(): GameMap;
  miniMap(): GameMap;
  forEachTile(fn: (tile: TileRef) => void): void;
  // Zero-allocation neighbor iteration (cardinal only) to avoid creating arrays
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void;
  // Zero-allocation neighbor iteration for performance-critical cluster calculation
  // Alternative to neighborsWithDiag() that returns arrays
  // Avoids creating intermediate arrays and uses a callback for better performance
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void;
  // Woodland = a land tile in the Forest/Jungle climate band. Capturing it costs
  // extra population but yields `wood`. Pure/deterministic (latitude-derived).
  isWoodland(tile: TileRef): boolean;

  // Player Management
  player(id: PlayerID): Player;
  players(): Player[];
  allPlayers(): Player[];
  playerByClientID(id: ClientID): Player | null;
  playerBySmallID(id: number): Player | TerraNullius;
  hasPlayer(id: PlayerID): boolean;
  addPlayer(playerInfo: PlayerInfo): Player;
  terraNullius(): TerraNullius;
  owner(ref: TileRef): Player | TerraNullius;

  teams(): Team[];
  teamSpawnArea(team: Team): SpawnArea | undefined;

  // Alliances
  expireAlliance(alliance: Alliance): void;

  // Immunity timer
  isSpawnImmunityActive(): boolean;
  isNationSpawnImmunityActive(): boolean;
  elapsedGameSeconds(): number;

  // Game State
  ticks(): Tick;
  inSpawnPhase(): boolean;
  // Shared doomsday launch budget (Module H wires decrement + everyone-loses).
  armageddonRemaining(): number;
  decrementArmageddon(n: number): void;
  endSpawnPhase(): void;
  executeNextTick(): GameUpdates;
  drainPackedTileUpdates(): Uint32Array;
  // Resource-layer deltas (Module §7) — `[tileRef, resourceByte]` uint32 pairs.
  // Carries the seeded snapshot on the first drain, harvest deltas thereafter.
  drainPackedResourceUpdates(): Uint32Array;
  recordMotionPlan(record: MotionPlanRecord): void;
  drainPackedMotionPlans(): Uint32Array | null;
  drainPackedPlayerUpdates(): Float64Array | null;
  drainPackedAttackUpdates(): Float64Array | null;
  setWinner(winner: Player | Team, allPlayersStats: AllPlayersStats): void;
  getWinner(): Player | Team | null;
  config(): Config;
  isPaused(): boolean;
  setPaused(paused: boolean): void;

  // Units
  unit(id: number): Unit | undefined;
  units(...types: UnitType[]): Unit[];
  unitCount(type: UnitType): number;
  unitInfo(type: UnitType): UnitInfo;
  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }>;

  addExecution(...exec: Execution[]): void;
  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void;
  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void;

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void;

  // Nations
  nations(): Nation[];

  numTilesWithFallout(): number;
  stats(): Stats;

  addUpdate(update: GameUpdate): void;
  railNetwork(): RailNetwork;
  conquerPlayer(conqueror: Player, conquered: Player): void;
  // Broadcast technology diffusion when `advancer` reaches `toAge`: every other
  // player gains `ageAdvanceCredit` toward `toAge` (contiguous-landmass players
  // near-free, distant ones a distance-decayed sliver). Implemented in GameImpl
  // (Module B); declared here so PlayerImpl.advanceAge can call it.
  grantEraDiffusion(advancer: Player, toAge: Age): void;
  // --- Primal-meta world-era bookkeeping (GameImpl) ---
  // Record that `p` reached `age`; returns true iff p is the FIRST player in
  // the world to reach it (drives the Golden Age burst). Also stamps
  // worldFirstAdvanceTick on the first-ever advance.
  recordEraReached(p: Player, age: Age): boolean;
  // Has ANY player already reached `age`?
  eraReached(age: Age): boolean;
  // Tick of the first era advance in this game, or null while the whole world
  // is still Primitive. Drives Config.worldPressureMult (primitive arms slowly
  // obsolesce once civilization exists).
  worldFirstAdvanceTick(): Tick | null;
  miniWaterHPA(): PathFinder<number> | null;
  miniWaterGraph(): AbstractGraph | null;
  getWaterComponent(tile: TileRef): number | null;
  hasWaterComponent(tile: TileRef, component: number): boolean;
  /**
   * Returns the set of water components that `player` shares with at least one
   * valid trade partner (cached). Used by nation AI for port-placement
   * heuristics. `null` means no usable water body for ports.
   */
  sharedWaterComponents(player: Player): Set<number> | null;
  /** Incremented each time the water navigation graph is rebuilt (e.g. after nuke terrain change). */
  waterGraphVersion(): number;

  /** Queue a land tile for conversion to water (batched every few ticks). Tile must be unowned. */
  queueWaterConversion(tile: TileRef): void;
}

export interface PlayerActions {
  canAttack: boolean;
  buildableUnits: BuildableUnit[];
  canSendEmojiAllPlayers: boolean;
  canEmbargoAll?: boolean;
  interaction?: PlayerInteraction;
}

export interface BuildableUnit {
  canBuild: TileRef | false;
  // unit id of the existing unit that can be upgraded, or false if it cannot be upgraded.
  canUpgrade: number | false;
  type: PlayerBuildableUnitType;
  cost: Gold;
  overlappingRailroads: TileRef[];
  ghostRailPaths: TileRef[][];
}

export interface PlayerProfile {
  relations: Record<number, Relation>;
  alliances: number[];
}

export interface PlayerBorderTiles {
  borderTiles: ReadonlySet<TileRef>;
}

export interface AllianceInfo {
  expiresAt: Tick;
  inExtensionWindow: boolean;
  myPlayerAgreedToExtend: boolean;
  otherAgreedToExtend: boolean;
  canExtend: boolean;
}

export interface PlayerInteraction {
  sharedBorder: boolean;
  canSendEmoji: boolean;
  canSendAllianceRequest: boolean;
  canBreakAlliance: boolean;
  canTarget: boolean;
  canDonateGold: boolean;
  canDonateTroops: boolean;
  canEmbargo: boolean;
  allianceInfo?: AllianceInfo;
}

export interface EmojiMessage {
  message: string;
  senderID: number;
  recipientID: number | typeof AllPlayers;
  createdAt: Tick;
}

export enum MessageType {
  ATTACK_FAILED,
  ATTACK_CANCELLED,
  ATTACK_REQUEST,
  CONQUERED_PLAYER,
  MIRV_INBOUND,
  NUKE_INBOUND,
  NUKE_DETONATED,
  HYDROGEN_BOMB_INBOUND,
  NAVAL_INVASION_INBOUND,
  SAM_MISS,
  SAM_HIT,
  CAPTURED_ENEMY_UNIT,
  UNIT_DESTROYED,
  ALLIANCE_ACCEPTED,
  ALLIANCE_REJECTED,
  ALLIANCE_REQUEST,
  ALLIANCE_BROKEN,
  ALLIANCE_EXPIRED,
  DONATION_SENT,
  DONATION_RECEIVED,
  CHAT,
  RENEW_ALLIANCE,
  // Primal-meta era drama (Great Work ritual + first-mover Golden Age)
  GREAT_WORK_STARTED,
  GREAT_WORK_SETBACK,
  GREAT_WORK_FAILED,
  ERA_ADVANCED,
  GOLDEN_AGE,
  // Raids move gold without moving borders, so the victim saw nothing at all:
  // these are the only trace a raid leaves (UX audit 2026-10-21, item 6).
  RAID_SUCCESS,
  RAID_FAILED,
  RAID_SUFFERED,
  RAID_REPELLED,
}

// Message categories used for filtering events in the EventsDisplay
export enum MessageCategory {
  ATTACK = "ATTACK",
  NUKE = "NUKE",
  ALLIANCE = "ALLIANCE",
  TRADE = "TRADE",
  CHAT = "CHAT",
}

// Ensures that all message types are included in a category
export const MESSAGE_TYPE_CATEGORIES: Record<MessageType, MessageCategory> = {
  [MessageType.ATTACK_FAILED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_CANCELLED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_REQUEST]: MessageCategory.ATTACK,
  [MessageType.CONQUERED_PLAYER]: MessageCategory.ATTACK,
  [MessageType.MIRV_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_DETONATED]: MessageCategory.NUKE,
  [MessageType.HYDROGEN_BOMB_INBOUND]: MessageCategory.NUKE,
  [MessageType.NAVAL_INVASION_INBOUND]: MessageCategory.ATTACK,
  [MessageType.SAM_MISS]: MessageCategory.ATTACK,
  [MessageType.SAM_HIT]: MessageCategory.ATTACK,
  [MessageType.CAPTURED_ENEMY_UNIT]: MessageCategory.ATTACK,
  [MessageType.UNIT_DESTROYED]: MessageCategory.ATTACK,
  [MessageType.ALLIANCE_ACCEPTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REJECTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REQUEST]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_BROKEN]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_EXPIRED]: MessageCategory.ALLIANCE,
  [MessageType.RENEW_ALLIANCE]: MessageCategory.ALLIANCE,
  [MessageType.DONATION_SENT]: MessageCategory.TRADE,
  [MessageType.DONATION_RECEIVED]: MessageCategory.TRADE,
  [MessageType.CHAT]: MessageCategory.CHAT,
  // Primal-meta era drama reads as world-war news, not trade chatter.
  [MessageType.GREAT_WORK_STARTED]: MessageCategory.ATTACK,
  [MessageType.GREAT_WORK_SETBACK]: MessageCategory.ATTACK,
  [MessageType.GREAT_WORK_FAILED]: MessageCategory.ATTACK,
  [MessageType.ERA_ADVANCED]: MessageCategory.ATTACK,
  [MessageType.GOLDEN_AGE]: MessageCategory.ATTACK,
  // A raid is combat with no border change; it belongs with the attacks.
  [MessageType.RAID_SUCCESS]: MessageCategory.ATTACK,
  [MessageType.RAID_FAILED]: MessageCategory.ATTACK,
  [MessageType.RAID_SUFFERED]: MessageCategory.ATTACK,
  [MessageType.RAID_REPELLED]: MessageCategory.ATTACK,
} as const;

/**
 * Get the category of a message type
 */
export function getMessageCategory(messageType: MessageType): MessageCategory {
  return MESSAGE_TYPE_CATEGORIES[messageType];
}

export interface NameViewData {
  x: number;
  y: number;
  size: number;
}
