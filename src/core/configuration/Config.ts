import { z } from "zod";
import { PlayerView } from "../../client/view";
import { AssetManifest } from "../AssetUrls";
import {
  Age,
  Biome,
  Difficulty,
  Game,
  GameMode,
  GameType,
  Gold,
  Player,
  PlayerInfo,
  PlayerType,
  ResourceKind,
  Structures,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, toInt, within } from "../Util";

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      instanceId?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

/** SAM launcher construction duration in ticks (non-instant-build). */
export const SAM_CONSTRUCTION_TICKS = 30 * 10;

export class Config {
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
  ) {}

  isReplay(): boolean {
    return this._isReplay;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  cityTroopIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }
  msPerTick(): number {
    return 100;
  }
  SAMCooldown(): number {
    return 90;
  }
  SiloCooldown(): number {
    return 90;
  }

  defensePostRange(): number {
    return 30;
  }

  defensePostDefenseBonus(): number {
    return 5;
  }

  defensePostSpeedBonus(): number {
    return 3;
  }

  palisadeDefenseBonus(): number {
    return 1.8;
  }

  palisadeSpeedBonus(): number {
    return 1.4;
  }

  artilleryFortDefenseBonus(): number {
    return 6.5;
  }

  artilleryFortSpeedBonus(): number {
    return 3.5;
  }

  private structureDefenseBonus(unitType: UnitType): {
    defense: number;
    speed: number;
  } {
    switch (unitType) {
      case UnitType.Palisade:
        return {
          defense: this.palisadeDefenseBonus(),
          speed: this.palisadeSpeedBonus(),
        };
      case UnitType.ArtilleryFort:
        return {
          defense: this.artilleryFortDefenseBonus(),
          speed: this.artilleryFortSpeedBonus(),
        };
      case UnitType.DefensePost:
        return {
          defense: this.defensePostDefenseBonus(),
          speed: this.defensePostSpeedBonus(),
        };
      default:
        return { defense: 1, speed: 1 };
    }
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    return this._gameConfig.disableAlliances ?? false;
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  goldMultiplier(): number {
    return this._gameConfig.goldMultiplier ?? 1;
  }
  startingGold(playerInfo: PlayerInfo): Gold {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return this.startingGoldFor(playerInfo);
  }

  trainSpawnRate(numPlayerFactories: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    return (numPlayerFactories + 10) * 15;
  }
  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 35_000;
        break;
      case "team":
      case "other":
        baseGold = 25_000;
        break;
      case "self":
        baseGold = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(5000, baseGold - distPenalty);
    return toInt(gold * this.goldMultiplierFor(player));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 110;
  }
  railroadMaxSize(): number {
    return this.trainStationMaxRange();
  }

  tradeShipGold(dist: number, player: Player | PlayerView): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold =
      75_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    const decayRate = Math.LN2 / 50;

    // Approaches 0 as numTradeShips increase
    const baseSpawnRate = 1 - sigmoid(numTradeShips, decayRate, 400);

    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.floor((100 * rejectionModifier) / baseSpawnRate);
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.TransportShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Warship:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Warship,
          ),
          maxHealth: 1000,
          // Naval warfare is not a Primitive concern — tribes cross water by
          // canoe (wood-costed TransportShip), not warships. Unlocks Imperial+.
          minAge: Age.Imperial,
        };
        break;
      case UnitType.Shell:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.SAMMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Port:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
          // Ports (trade + warship docks) are a civilized institution — hidden
          // for Primitive tribes, who use wood canoes instead. Unlocks Imperial+.
          minAge: Age.Imperial,
        };
        break;
      case UnitType.AtomBomb:
        info = {
          cost: this.costWrapper(() => 750_000, UnitType.AtomBomb),
          minAge: Age.Modern,
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          cost: this.costWrapper(() => 5_000_000, UnitType.HydrogenBomb),
          minAge: Age.Modern,
        };
        break;
      case UnitType.MIRV:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            return 25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
          },
          minAge: Age.Modern,
        };
        break;
      case UnitType.MIRVWarhead:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.MissileSilo:
        info = {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
          minAge: Age.Modern,
        };
        break;
      case UnitType.DefensePost:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
            UnitType.DefensePost,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          minAge: Age.Feudal,
        };
        break;
      case UnitType.SAMLauncher:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.SAMLauncher,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : SAM_CONSTRUCTION_TICKS,
          upgradable: true,
          minAge: Age.Modern,
        };
        break;
      case UnitType.City: {
        // 2026-06-16 — the permanent settlement (era gate) costs 20× a TEMPORARY
        // building (Hut/Outpost/Scout). With zero passive Primitive income, you
        // must grind that out of risky caravan trade — so breaking into Imperial
        // is slow and uncertain (docs §6 addendum). Still doubles per extra City,
        // capped at 1M.
        const baseCost = this.costWrapper(
          (numUnits: number) =>
            Math.min(1_000_000, Math.pow(2, numUnits) * 20 * this.hutCost()),
          UnitType.City,
        );
        info = {
          // Prohibitive under full ice, falling to baseline as the caps recede
          // (climateSettlementCostMult) — the affordability ramp that finally lets
          // a tribe settle + advance. See docs/ICE_AGE_ECONOMY.md §B.
          cost: (game: Game, player: Player) =>
            this.applyClimateMult(
              this.applyAgeCostMult(baseCost(game, player), player),
              this.climateSettlementCostMult(game),
            ),
          // Slower than a hut and not "instant" (was 2*10 ≈ 2s).
          constructionDuration: this.instantBuild() ? 0 : 8 * 10,
          upgradable: true,
        };
        break;
      }
      case UnitType.Hut: {
        // Cheap, temporary Primitive settlement (outpost). Upgrade a Hut to a
        // City (the permanent House) to satisfy the Primitive→Classical criterion
        // — founding your first City is what turns a tribe into a Kingdom.
        const baseCost = this.costWrapper(() => this.hutCost(), UnitType.Hut);
        info = {
          // 3× baseline under full ice, declining to 1× as the caps recede
          // (climateBuildCostMult) — building is a real cost in the deep ice age.
          cost: (game: Game, player: Player) =>
            this.applyClimateMult(
              baseCost(game, player),
              this.climateBuildCostMult(game),
            ),
          // No longer near-instant (was 1*10 ≈ 1s, which read as "free + instant").
          constructionDuration: this.instantBuild() ? 0 : 3 * 10,
          minAge: Age.Primitive,
          maxAge: Age.Primitive,
          upgradable: false,
        };
        break;
      }
      case UnitType.PrimitiveFarm: {
        // Temporary "primitive factory" — drips internal gold (FarmExecution),
        // ages out, never upgradeable. Primitive-only (auto-hidden later).
        const baseCost = this.costWrapper(
          () => this.primitiveFarmCost(),
          UnitType.PrimitiveFarm,
        );
        info = {
          // 3× baseline under full ice → 1× as the caps recede (like every
          // primitive building — docs/ICE_AGE_ECONOMY.md §B).
          cost: (game: Game, player: Player) =>
            this.applyClimateMult(
              baseCost(game, player),
              this.climateBuildCostMult(game),
            ),
          constructionDuration: this.instantBuild() ? 0 : 1 * 10,
          minAge: Age.Primitive,
          maxAge: Age.Primitive,
          upgradable: false,
        };
        break;
      }
      case UnitType.TradeOutpost: {
        // Temporary economy structure — speeds the resource→gold internal economy
        // while it stands (capped 3/tribe). Ages out, never upgradeable.
        const baseCost = this.costWrapper(
          () => this.tradeOutpostCost(),
          UnitType.TradeOutpost,
        );
        info = {
          cost: (game: Game, player: Player) =>
            this.applyClimateMult(
              baseCost(game, player),
              this.climateBuildCostMult(game),
            ),
          constructionDuration: this.instantBuild() ? 0 : 1 * 10,
          minAge: Age.Primitive,
          maxAge: Age.Primitive,
          upgradable: false,
        };
        break;
      }
      case UnitType.ScoutLookout:
        // Temporary Primitive scout post: placed at the territory edge, it
        // reveals nearby resources (fog §9) while it stands, then ages out
        // (ScoutExecution). Cheap and disposable, like a Hut.
        info = {
          cost: this.costWrapper(() => this.scoutCost(), UnitType.ScoutLookout),
          constructionDuration: this.instantBuild() ? 0 : 1 * 10,
          minAge: Age.Primitive,
          maxAge: Age.Primitive,
          upgradable: false,
        };
        break;
      case UnitType.Factory: {
        const baseCost = this.costWrapper(
          (numUnits: number) =>
            Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
          UnitType.Factory,
          UnitType.Port,
        );
        info = {
          cost: (game: Game, player: Player) =>
            this.applyAgeCostMult(baseCost(game, player), player),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
          minAge: Age.Industrial,
        };
        break;
      }
      case UnitType.Palisade:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(100_000, (numUnits + 1) * 20_000),
            UnitType.Palisade,
          ),
          constructionDuration: this.instantBuild() ? 0 : 3 * 10,
          minAge: Age.Primitive,
        };
        break;
      case UnitType.Granary:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(300_000, (numUnits + 1) * 75_000),
            UnitType.Granary,
          ),
          constructionDuration: this.instantBuild() ? 0 : 4 * 10,
          minAge: Age.Primitive,
        };
        break;
      case UnitType.ArtilleryFort:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(500_000, (numUnits + 1) * 150_000),
            UnitType.ArtilleryFort,
          ),
          constructionDuration: this.instantBuild() ? 0 : 6 * 10,
          minAge: Age.Enlightened,
        };
        break;
      case UnitType.Harbor:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Harbor,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          minAge: Age.Imperial,
        };
        break;
      case UnitType.Airbase:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.Airbase,
          ),
          constructionDuration: this.instantBuild() ? 0 : 8 * 10,
          minAge: Age.Modern,
        };
        break;
      case UnitType.SupplyDepot:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 200_000),
            UnitType.SupplyDepot,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          minAge: Age.Imperial,
          // TODO(eonfront): suppresses attacker attrition within radius (Module B).
        };
        break;
      case UnitType.Wonder:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(10_000_000, (numUnits + 1) * 5_000_000),
            UnitType.Wonder,
          ),
          constructionDuration: this.instantBuild() ? 0 : 30 * 10,
          minAge: Age.Feudal,
          // TODO(eonfront): globally-unique power-spike / Wonder victory (Module G).
        };
        break;
      case UnitType.EonSite:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(500_000, (numUnits + 1) * 100_000),
            UnitType.EonSite,
          ),
          constructionDuration: this.instantBuild() ? 0 : 3 * 10,
          // EonSite is the Modern→Alien keystone; it must NOT appear in the
          // Primitive build menu (was mis-tagged Primitive and leaked in).
          minAge: Age.Modern,
          // TODO(eonfront): map-objective trickle node w/ contest-pauses-timer (Module G).
        };
        break;
      case UnitType.Train:
        info = {
          cost: () => 0n,
        };
        break;
      default:
        assertNever(type);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteGoldFor(player: Player | PlayerView): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  private hasInfiniteTroopsFor(player: Player | PlayerView): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: Player | PlayerView): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: Player): Gold {
    if (
      captured.type() === PlayerType.Bot ||
      captured.type() === PlayerType.Nation
    ) {
      return captured.gold();
    } else {
      return captured.gold() / 2n;
    }
  }

  private startingGoldFor(playerInfo: PlayerInfo): Gold {
    const base = BigInt(this._gameConfig.startingGold ?? 0);
    const hc = this._gameConfig.hostCheats;
    if (hc?.startingGold && playerInfo.isLobbyCreator) {
      return base + BigInt(hc.startingGold);
    }
    return base;
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      if (
        player.type() === PlayerType.Human &&
        this.hasInfiniteGoldFor(player)
      ) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits));
    };
  }

  private applyAgeCostMult(cost: bigint, player: Player): bigint {
    if (cost === 0n) return 0n;
    return BigInt(Math.floor(Number(cost) * this.ageExpansionCostMult(player)));
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  quickChatCooldown(): Tick {
    return 3 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  armyLimitWarningThreshold(): number {
    return 0.8;
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 300;
  }
  numBots(): number {
    return this.bots();
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag;
    let speed;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.Plains:
        mag = 80;
        speed = 16.5;
        break;
      case TerrainType.Highland:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.Mountain:
        mag = 120;
        speed = 25;
        break;
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    if (defender.isPlayer()) {
      let defenseMult = 1;
      let speedMult = 1;
      for (const entry of gm.nearbyUnits(
        tileToConquer,
        gm.config().defensePostRange(),
        [UnitType.DefensePost, UnitType.Palisade, UnitType.ArtilleryFort],
      )) {
        if (entry.unit.owner() !== defender) {
          continue;
        }
        const bonus = this.structureDefenseBonus(entry.unit.type());
        defenseMult = Math.max(defenseMult, bonus.defense);
        speedMult = Math.max(speedMult, bonus.speed);
      }
      mag *= defenseMult;
      speed *= speedMult;
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (defender.isDisconnected() && attacker.isOnSameTeam(defender)) {
        // No troop loss if defender is disconnected and on same team
        mag = 0;
      }
      if (
        (attacker.type() === PlayerType.Human ||
          attacker.type() === PlayerType.Nation) &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.7;
      }
      // Cross-age obsolescence: a higher-age attacker punches through, a
      // lower-age attacker bleeds harder (and crawls slower).
      const ageMult = this.ageCombatMult(attacker.age(), defender.age());
      mag /= ageMult;
      speed *= ageMult;

      // Module §7 — Neanderthals are STRONG vs predator packs (apex hunters).
      // A Neanderthal striking a pack takes less loss and presses faster; a pack
      // striking a Neanderthal bleeds harder against a tough defender. (mag drives
      // attacker troop loss, so divide to favour the Neanderthal, multiply to
      // punish the pack.) Mutually exclusive flags, so at most one branch fires.
      const packBonus = this.neanderthalVsPackCombatBonus();
      if (attacker.isNeanderthal() && defender.isAnimalPack()) {
        mag /= packBonus;
        speed *= packBonus;
      } else if (defender.isNeanderthal() && attacker.isAnimalPack()) {
        mag *= packBonus;
      }

      // Primitive ambushes make early terrain matter: highland/mountain
      // defenders force bloodier, slower pushes until later ages out-tech them.
      const ambush = this.primitiveTerrainAmbush(type, defender.age());
      mag *= ambush.defense;
      speed *= ambush.speed;

      if (defender.advancePenaltyActive()) {
        mag *= this.advancePenaltyDefenseMult();
      }

      // Primal-meta: WORLD PRESSURE. Once the first player in the world has
      // broken into a civilized age, primitive arms slowly obsolesce — the
      // cross-age gap widens over worldPressureRampTicks(). mag drives
      // attacker loss (higher = bloodier); speed is budget consumed per tile
      // (higher = slower). Keeps the "everyone waits forever" standoff from
      // re-forming after the first advance.
      const pressure = this.worldPressureMult(gm);
      if (pressure > 1) {
        if (
          attacker.age() === Age.Primitive &&
          defender.age() > attacker.age()
        ) {
          mag *= pressure;
          speed *= pressure;
        } else if (
          defender.age() === Age.Primitive &&
          attacker.age() > defender.age()
        ) {
          mag /= pressure;
          speed /= pressure;
        }
      }

      // Primal-meta: a Golden Age attacker (first in the world to their Age)
      // hits harder and faster for the burst window.
      if (attacker.goldenAgeActive()) {
        mag /= this.goldenAgeAttackMult();
        speed /= this.goldenAgeAttackMult();
      }

      // Coalition-against-the-leader (Module E). Modest, capped, and only valid
      // vs/from the genuine threat leader (CoalitionExecution keeps membership
      // legitimate). A member striking the coalition target hits harder; a member
      // defending against the target holds harder. Both directions can't apply at
      // once (a player can't be both a member and the shared target).
      if (defender.isCoalitionTargetOf(attacker)) {
        // Attacker is a coalition member hitting the target: less attacker loss.
        mag /= this.coalitionAttackBonus();
      } else if (attacker.isCoalitionTargetOf(defender)) {
        // Target is attacking a coalition member: member defends harder.
        mag *= this.coalitionDefenseBonus();
      }
    }

    if (defender.isPlayer()) {
      const defenseSig =
        1 -
        sigmoid(
          defender.numTilesOwned(),
          DEFENSE_DEBUFF_DECAY_RATE,
          DEFENSE_DEBUFF_MIDPOINT,
        );

      const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
      const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

      let largeAttackBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackBonus = Math.sqrt(100_000 / attacker.numTilesOwned()) ** 0.7;
      }
      let largeAttackerSpeedBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackerSpeedBonus = (100_000 / attacker.numTilesOwned()) ** 0.6;
      }

      const defenderTroopLoss = defender.troops() / defender.numTilesOwned();
      const traitorMod = defender.isTraitor() ? this.traitorDefenseDebuff() : 1;
      const currentAttackerLoss =
        within(defender.troops() / attackTroops, 0.6, 2) *
        mag *
        0.8 *
        largeDefenderAttackDebuff *
        largeAttackBonus *
        traitorMod;
      const altAttackerLoss =
        1.3 * defenderTroopLoss * (mag / 100) * traitorMod;
      const attackerTroopLoss =
        (0.6 * currentAttackerLoss + 0.4 * altAttackerLoss) *
        this.defenderAdvantage();

      return {
        attackerTroopLoss,
        defenderTroopLoss,
        tilesPerTickUsed:
          within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
          speed *
          largeDefenderSpeedDebuff *
          largeAttackerSpeedBonus *
          (defender.isTraitor() ? this.traitorSpeedDebuff() : 1),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() === PlayerType.Bot ? mag / 10 : mag / 5,
        defenderTroopLoss: 0,
        tilesPerTickUsed: within(
          (2000 * Math.max(10, speed)) / attackTroops,
          5,
          100,
        ),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    // Era ramp: a Primitive tribe creeps; later empires sweep. Multiplier is
    // very low in Primitive and climbs by Age (deliberate slow start).
    const ageMult = this.attackTilesPerTickAgeMult(attacker.age());
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3 *
        ageMult
      );
    } else {
      return numAdjacentTilesWithEnemy * 2 * ageMult;
    }
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  tradeShipShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      // Module §7 — Neanderthals start with the MOST population of any tribe.
      // They are the dominant people of the early Primitive era; their decline
      // comes later (no money → no advance → climate attrition + admixture),
      // not from a weak start. 10k bot base × the Neanderthal multiplier.
      if (playerInfo.isNeanderthal) {
        return Math.round(10_000 * this.neanderthalStartTroopMult());
      }
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    return this.hasInfiniteTroopsForInfo(playerInfo) ? 1_000_000 : 25_000;
  }

  maxTroops(player: Player | PlayerView): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
        ? 1_000_000_000
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          player
            .units(UnitType.City)
            .filter((u) => !u.isUnderConstruction())
            .map((city) => city.level())
            .reduce((a, b) => a + b, 0) *
            this.cityTroopIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxTroops / 3;
    }

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  troopIncreaseRate(player: Player | PlayerView): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + Math.pow(player.troops(), 0.73) / 4;

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    toAdd *= this.ageTroopRegenMult(player);
    if (player.advancePenaltyActive()) {
      toAdd *= this.advancePenaltyRegenMult();
    }
    // Primal-meta: Golden Age (first in the world to an Age) — regen burst.
    if (player.goldenAgeActive()) {
      toAdd *= this.goldenAgeRegenMult();
    }

    // Overextension: troop regen throttles while integration debt is high.
    toAdd *= this.overextensionPenalty(player).regenMult;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.5;
    }

    if (player.type() === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          toAdd *= 1; // Like humans
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }

    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  goldAdditionRate(player: Player | PlayerView): Gold {
    // 2026-06-16 — ZERO passive income in the Primitive era. Primitive gold is not
    // automatic: it comes ONLY from converting harvested resources via caravan
    // trade (docs §8) and from raids/conquest (docs §6). Nothing drips in until a
    // permanent settlement carries the tribe into the Imperial age.
    if (player.age() === Age.Primitive) return 0n;
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    // Module §6 — kill passive "random" income. Wealth must come from raids /
    // trade / conquest, not a flat per-tick drip. The base income term is cut
    // ~85% from the legacy 100n (human) / 50n (bot) toward upkeep-only; bots can
    // still bank toward a Hut (5000g) over time but money no longer floods in.
    // Upkeep / leaderTax / coalition / harbor / overextension terms below are
    // left UNTOUCHED so nothing else in the economy shifts. (Legacy 100n/50n is
    // retained only as a stale upper bound in tests/economy/ConstructionGold.)
    if (player.type() === PlayerType.Bot) {
      baseRate = 8n;
    } else {
      baseRate = 15n;
    }
    let income = Number(baseRate) * multiplier;
    // Primal-meta: Golden Age (first in the world to an Age) — income burst.
    if (player.goldenAgeActive()) {
      income = Math.floor(income * this.goldenAgeGoldMult());
    }

    // Building + border upkeep. Recomputed each call (simplest, bounded by the
    // per-tick unit iteration that already happens in PlayerExecution).
    let upkeep = 0;
    for (const u of player.units()) {
      upkeep += this.buildingUpkeepPerTick(u.type());
    }
    // Backend Player exposes borderTiles() as a synchronous Set; PlayerView
    // returns a Promise (used only for client display estimates), so fall back
    // to the owned-tile count there.
    const border = player.borderTiles();
    const borderTileCount =
      border instanceof Set ? border.size : player.numTilesOwned();
    upkeep += this.borderUpkeepPerTile() * borderTileCount;

    // Harbor flat gold income (negative upkeep). Counted as a building bonus.
    const harborIncome =
      this.harborIncomePerTick() * player.units(UnitType.Harbor).length;

    // Dominant-leader gold tax.
    const tax = income * this.leaderTaxRate(player);

    // Overextension: gold income throttles while integration debt is high.
    const overextensionMult = this.overextensionPenalty(player).goldMult;

    // Coalition rally: active members get a small, capped income bonus while the
    // pact stands. CoalitionExecution clears membership the moment the target
    // stops being a genuine threat leader, so this can't be farmed.
    const coalitionMult = player.inActiveCoalition()
      ? this.coalitionIncomeBonus()
      : 1;

    const net =
      (income + harborIncome - upkeep - tax) *
      overextensionMult *
      coalitionMult;
    if (net <= 0) {
      return 0n;
    }
    return BigInt(Math.floor(net));
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  defaultNukeSpeed(): number {
    return 8;
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultSamRange(): number {
    return 70;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  defaultSamMissileSpeed(): number {
    return 12;
  }

  // Humans can be soldiers, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.MIRVWarhead) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - Math.exp(-steepness * normalizedExcess));
  }

  structureMinDist(): number {
    return 15;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  warshipDockingRange(): number {
    return 5;
  }

  warshipPortHealingBonusPerLevel(): number {
    return 5;
  }

  warshipRetreatHealthThreshold(): number {
    return 750;
  }

  warshipPassiveHealing(): number {
    return 1;
  }

  warshipPassiveHealingRange(): number {
    return 150;
  }

  warshipPortSwitchThreshold(): number {
    return 0.75;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }

  // Cost to advance from the player's current Age to the next one.
  // Returns null when the player is already at the final (Alien) Age.
  advanceAgeCost(
    p: Player | PlayerView,
  ): { gold: bigint; techPoints: number } | null {
    const base = this.baseAdvanceAgeCost(p.age());
    if (base === null) return null;
    const bps = this.eraTransitionCostBps(p.eraTriumphCount());
    return {
      gold: (base.gold * BigInt(bps) + 9999n) / 10000n,
      techPoints: Math.ceil((base.techPoints * bps) / 10000),
    };
  }

  // Unmodified transition cost. Era Triumph targets are based on this stable
  // table so earning a Triumph cannot move its own goalposts.
  // Tech is the clock for every era after the Stone Age. Owner direction
  // (2026-08-04 "lead player's progress from classical to imperial should be
  // min 10 mins like first tech upgrade; discounted once the first person moves
  // up, but still spenny"; 2026-10-21 "eras equal length, avoid incentives to
  // beeline"): every era needs the SAME tech, tech accrues at most
  // techPointsPerTickCap() per tick whatever you build, it resets to zero on
  // advancing (PlayerImpl.advanceAge) and banks at most techPointBankMult() x
  // the requirement (PlayerImpl.addTechPoints). So the leader needs
  // 9000 / 1.5 = 6000 ticks = 10 min per era, and nothing can beeline it;
  // same-landmass followers get the diffusion discount on tech only and still
  // pay the full gold toll. The Stone Age is paced by the ice clock instead
  // (climateMeltTicks).
  baseAdvanceAgeCost(age: Age): { gold: bigint; techPoints: number } | null {
    switch (age) {
      case Age.Primitive: // -> Classical (found your first City = become a Kingdom)
        return { gold: 8000n, techPoints: 200 };
      case Age.Classical: // -> Imperial (consolidate a stable kingdom into an empire)
        // 28500 was bisected against the pre-2026-10-21 income (Imperial at
        // 15:20 vs 14:00); the denser wood of the lovable-opening retune pays
        // ~2x faster, so the toll scales with it to keep a kingdom a kingdom
        // for a while (LoopVitals 2026-10-21, world/133 x3 seeds + compact/33:
        // Classical 10:00-11:40, Imperial 12:00-17:20, dwell 1:20-6:00).
        return { gold: 60000n, techPoints: 9000 };
      case Age.Imperial: // -> Feudal
        return { gold: 18000n, techPoints: 9000 };
      case Age.Feudal: // -> Enlightened
        return { gold: 35000n, techPoints: 9000 };
      case Age.Enlightened: // -> Industrial
        return { gold: 60000n, techPoints: 9000 };
      case Age.Industrial: // -> Modern
        return { gold: 95000n, techPoints: 9000 };
      case Age.Modern: // -> Alien
        return { gold: 150000n, techPoints: 9000 };
      default: // Alien: no next age
        return null;
    }
  }

  // How much tech a player may bank relative to the current era's requirement.
  // 1.5x leaves room for the Ingenuity triumph (eraIngenuityTargetMult, 1.25x)
  // while stopping a long Stone Age from pre-paying every later era.
  techPointBankMult(): number {
    return 1.5;
  }

  techPointCap(age: Age): number {
    const base = this.baseAdvanceAgeCost(age);
    if (base === null) return Number.POSITIVE_INFINITY;
    return Math.ceil(base.techPoints * this.techPointBankMult());
  }

  // Basis-point multiplier for the next transition. Zero-Triumph beelining is
  // allowed but expensive; broad era play progressively beats the old flat toll.
  eraTransitionCostBps(triumphCount: number): number {
    return ERA_TRANSITION_COST_BPS[
      Math.max(0, Math.min(4, Math.floor(triumphCount)))
    ];
  }

  eraIngenuityTargetMult(): number {
    return 1.25;
  }

  eraProsperityTarget(age: Age): bigint {
    const base = this.baseAdvanceAgeCost(age);
    return base === null ? 0n : (base.gold * 3n) / 2n;
  }

  eraDominionTarget(age: Age): number {
    return ERA_DOMINION_TARGET[age] ?? ERA_DOMINION_TARGET[Age.Alien];
  }

  eraDominionMaxDebtRatio(): number {
    return 0.6;
  }

  eraLegacyTarget(age: Age): number {
    return ERA_LEGACY_TARGET[age] ?? ERA_LEGACY_TARGET[Age.Alien];
  }

  // --- Eonfront era-overhaul knobs (Module 0 Foundation; values tunable) ---

  // Cost of a Hut: a cheap, temporary Primitive settlement (outpost).
  hutCost(): number {
    return 5_000;
  }

  // Cost of the permanent settlement ("House"/City upgrade target, the "X").
  // Owning one is the Primitive→Imperial advance criterion. This is the baseline
  // (ice-fully-receded) floor = 20× a primitive building (20 × hutCost 5,000).
  // Phase 3 climate clock ramps it ABOVE this during the ice age (prohibitively
  // high) and declines it back to this floor as the caps recede. See
  // docs/ICE_AGE_ECONOMY.md. AI-NOTE: was 125_000n — unreachable with the gutted
  // Primitive income + no trade economy, which froze every tribe in Primitive
  // forever. Lowered to the 20×-building design floor so settlement is reachable.
  permanentSettlementCost(): bigint {
    return 100_000n;
  }

  // Permanent settlements (Cities) a Primitive tribe must own to advance to
  // Imperial. Lowered 2→1 alongside permanentSettlementCost (see meetsAdvanceCriteria).
  citiesToAdvance(): number {
    return 1;
  }

  // --- Ice-age climate clock (docs/ICE_AGE_ECONOMY.md §B/§D) ---
  //
  // The world starts in a FULL ICE AGE and the caps recede over climateMeltTicks().
  // Everything ice-gated — build cost, settlement cost, carrying capacity — is a
  // pure function of the REPLICATED game.ticks(): no new state, no RNG, no
  // transcendentals (only +,-,*,/ and Math.floor, like applyAgeCostMult), so it
  // stays byte-identical on every client in lockstep. iceFraction is 1.0 at world
  // start (heavy ice) and 0.0 once the caps have fully receded — the longer the
  // world runs, the cheaper and easier the Primitive era. The clock IS the
  // progression unlock. AI-NOTE: keep this transcendental-free (no sin/exp/pow) —
  // those diverge across platforms and desync the lockstep sim. | evidence:
  // docs/ICE_AGE_ECONOMY.md §D

  // Ticks for the ice caps to fully recede (~10 min at 10 ticks/s). Tunable.
  // The melt is the Stone Age clock (settlement price 8x -> 1x over the melt):
  // 6000 puts the first exits at 10:00-11:40 (LoopVitals 2026-10-21, three
  // world seeds + compact). Owner direction 2026-08-04 and 2026-10-21: every
  // era about ten minutes for the leader, the Stone Age included; a 15-minute
  // melt was tried and judged too slow to keep players.
  climateMeltTicks(): Tick {
    return 6000;
  }

  // 1.0 under full ice → 0.0 once receded. Integer basis points first (deterministic
  // integer math), then a single divide into [0,1].
  climateIceFractionAtTick(t: number): number {
    const melt = this.climateMeltTicks();
    if (melt <= 0 || t >= melt) return 0;
    const bp = Math.floor(((melt - t) * 10000) / melt);
    return bp / 10000;
  }
  // Stone Age exit gate: a Permanent Settlement can only be founded once the
  // ice covers at most this fraction of its full-ice reach (0.1 of a 10-minute
  // melt = from minute 9). Added 2026-10-21 with the nomadic-attrition
  // gradient: bands that expand by attack gather gold faster, and a price ramp
  // alone let the first tribe out at 5:00-6:40 against the 10-minute target.
  settlementMaxIceFraction(): number {
    return 0.1;
  }

  climateIceFraction(game: Game): number {
    return this.climateIceFractionAtTick(game.ticks());
  }

  // Max latitude fraction (from EACH pole) the ice sheets cover at full ice. This
  // is shared by sim + render: the caps start near the map centre with an
  // equatorial corridor left open, then recede back toward the poles.
  climateIcePoleReach(): number {
    // 0.42 iced over everything but a thin equatorial band at game start, so
    // a tribe spawning in Europe or North America spent its first five
    // minutes frozen (3x hut cost, 8x settlement, heavy migration friction)
    // with nothing to do. The sheet now starts over the polar fifth of the
    // map and still recedes to nothing over climateMeltTicks().
    return 0.26;
  }

  // Feather width for the sheet edge, expressed as latitude fraction. Tiles deep
  // inside the cap are fully icy; tiles in this edge band are partially icy, so
  // capacity/attrition ramp smoothly as the front passes over them.
  climateIceEdgeWidth(): number {
    return 0.08;
  }

  climateIceExtentAtTick(t: number): number {
    return this.climateIcePoleReach() * this.climateIceFractionAtTick(t);
  }

  private climateIceHash(ix: number, iy: number, salt: number): number {
    let n =
      Math.imul(ix, 374761393) ^
      Math.imul(iy, 668265263) ^
      Math.imul(salt, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  private climateIceValueNoise(
    x: number,
    y: number,
    cell: number,
    salt: number,
  ): number {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = this.climateIceHash(ix, iy, salt);
    const n10 = this.climateIceHash(ix + 1, iy, salt);
    const n01 = this.climateIceHash(ix, iy + 1, salt);
    const n11 = this.climateIceHash(ix + 1, iy + 1, salt);
    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;
    return nx0 + (nx1 - nx0) * sy;
  }

  private climateIceFrontWarp(map: GameMap, tile: TileRef): number {
    const x = map.x(tile);
    const y = map.y(tile);
    const w = Math.max(1, map.width());
    const lobeCell = Math.max(18, Math.floor(w / 5));
    const shelfCell = Math.max(12, Math.floor(w / 9));
    const fineCell = Math.max(7, Math.floor(w / 18));
    const lobes = this.climateIceValueNoise(x, y, lobeCell, 0x7151ce) - 0.5;
    const shelf = this.climateIceValueNoise(x, y, shelfCell, 0x51e1f) - 0.5;
    const fine = this.climateIceValueNoise(x, y, fineCell, 0x1ce4) - 0.5;
    let warp = lobes * 0.09 + shelf * 0.055 + fine * 0.025;
    const mag = map.magnitude(tile);
    if (mag >= 24) warp += 0.022;
    else if (mag >= 16) warp += 0.012;
    if (map.isWater(tile)) warp -= 0.012;
    const maxWarp = 0.495 - this.climateIcePoleReach();
    return Math.max(-0.09, Math.min(maxWarp, warp));
  }

  // climateIceFrontWarp is pure in (map, tile) — tick-independent — and was
  // the #1 sim hotspot (called per owned tile per player per tick through the
  // capacity/attrition paths). Cache it per map; identical code on every
  // lockstep peer computes identical cached values, so this is behaviour-exact.
  private iceWarpCache = new WeakMap<GameMap, Float32Array>();

  private climateIceFrontWarpCached(map: GameMap, tile: TileRef): number {
    let cache = this.iceWarpCache.get(map);
    if (cache === undefined) {
      cache = new Float32Array(map.width() * map.height()).fill(NaN);
      this.iceWarpCache.set(map, cache);
    }
    let v = cache[tile];
    if (Number.isNaN(v)) {
      v = Math.fround(this.climateIceFrontWarp(map, tile));
      cache[tile] = v;
    }
    return v;
  }

  // Per-tile ice strength, 1.0 under solid ice, 0.0 outside the current sheet.
  // Pure map coords + tick: deterministic and safe for lockstep callers. The
  // front is warped by integer value-noise, so the sheet forms lobes and retreats
  // through bays/fingers instead of cutting a straight latitude band.
  climateTileIceFractionAtTick(map: GameMap, tile: TileRef, t: number): number {
    const extent = this.climateIceExtentAtTick(t);
    if (extent <= 0) return 0;
    const ice = this.climateIceFractionAtTick(t);
    const h = map.height();
    const y = h > 1 ? map.y(tile) / (h - 1) : 0.5;
    const distFromPole = Math.min(y, 1 - y);
    const localExtent = Math.max(
      0,
      Math.min(0.495, extent + this.climateIceFrontWarpCached(map, tile) * ice),
    );
    if (distFromPole >= localExtent) return 0;
    const edge = Math.max(0.0001, this.climateIceEdgeWidth());
    const solid = Math.max(0, localExtent - edge);
    if (distFromPole <= solid) return 1;
    const bp = Math.floor(((localExtent - distFromPole) * 10000) / edge);
    return Math.max(0, Math.min(1, bp / 10000));
  }

  climateTileIceFraction(game: Game, tile: TileRef): number {
    return this.climateTileIceFractionAtTick(game.map(), tile, game.ticks());
  }

  // Primitive building (Hut/Scout) cost multiplier: 3× under full ice → 1× receded.
  climateBuildCostMult(game: Game): number {
    return 1 + 0.5 * this.climateIceFraction(game);
  }

  // Permanent-settlement (City) cost multiplier: prohibitive under full ice (8×,
  // which with the 20×-hut base pins toward the 1,000,000 cap = unaffordable in the
  // deep ice age) declining to 1× as the caps recede.
  // AI-NOTE: this ramp is the Stone Age exit CLOCK, keep it steep. The 2026-10-21
  // lovable-opening retune briefly cut it to 2× and the first tribe left the
  // Stone Age at 7:40 instead of ~13:00 (LoopVitals, world/133/vitals-1) against
  // the owner's 8-14 min target; a gold-only gate (200K City) was seed-dependent
  // (seed 2 and the compact practice map never left Primitive at all). The
  // clock makes the window seed-independent. The HUT ramp (climateBuildCostMult)
  // stays gentle so the first minutes have something to build. | evidence:
  // docs/PRIMAL_META.md, tests/IceAgeClimate.test.ts
  climateSettlementCostMult(game: Game): number {
    // 1+15 (was 1+7) since the nomadic-attrition gradient of 2026-10-21: bands
    // that expand by attack hold more wood, and 1+7 let the first tribe out at
    // 5:00-9:00 (LoopVitals world/133 seeds 1-3) against the 10-minute target.
    return 1 + 15 * this.climateIceFraction(game);
  }

  // The ice caps cap how much land ANYONE can hold: 0.6× the §7 carrying capacity
  // under full ice, "thawing" open to 1.0× as they recede. Pure fn of game.ticks().
  climateLandScale(game: Game): number {
    return 1 - 0.4 * this.climateIceFraction(game);
  }

  // Local tile pressure from the ice sheet. The global climateLandScale() keeps
  // the whole era tight early; these per-tile values make the polar sheet itself
  // harsh to hold and cross until the front recedes.
  climateIceCapacityMult(tileIceFraction: number): number {
    const ice = Math.max(0, Math.min(1, tileIceFraction));
    return 1 - 0.45 * ice;
  }

  climateIceMigrationFrictionMult(tileIceFraction: number): number {
    const ice = Math.max(0, Math.min(1, tileIceFraction));
    return 1 + 0.85 * ice;
  }

  climateIceMigrationAttrition(tileIceFraction: number): number {
    const ice = Math.max(0, Math.min(1, tileIceFraction));
    return 14 * ice;
  }

  // Resource nodes inside the ice sheet partially offset the danger. They do not
  // make ice safe; they make it worth raiding briefly for rock/wood/fish nodes.
  climateIceResourceAttritionRelief(tileIceFraction: number): number {
    const ice = Math.max(0, Math.min(1, tileIceFraction));
    return 0.2 * ice;
  }

  climateIceResourcePull(tileIceFraction: number): number {
    const ice = Math.max(0, Math.min(1, tileIceFraction));
    return 50 * ice;
  }

  // A Hut seized by Neanderthals (who cannot maintain a permanent camp) degrades
  // far faster: its REMAINING lifespan is cut to this fraction at the moment of
  // seizure. (Animal-pack seizure razes it instantly; a human tribe inherits the
  // normal decline.) See HutExecution.
  neanderthalSeizedDecayFactor(): number {
    return 0.34;
  }

  private applyClimateMult(cost: bigint, mult: number): bigint {
    if (cost === 0n) return 0n;
    return BigInt(Math.floor(Number(cost) * mult));
  }

  // --- Primal-meta (docs/PRIMAL_META.md): the primitive power CURVE, the ---
  // --- Great Work advance ritual, the Golden Age burst, world pressure.  ---
  //
  // Design: staying Primitive must be a real strategy (strong early, decaying
  // late), and advancing must be a dramatic, well-timed public gamble (it arms
  // rivals via diffusion but pays a first-mover Golden Age). Everything here is
  // a pure function of replicated state (game.ticks(), player fields) using
  // only +,-,*,/ and Math.floor — lockstep-safe, no transcendentals, no RNG.

  // Ticks AFTER full melt over which the primitive wild thins out (the
  // "twilight of the wild", ~8 min at 10 ticks/s).
  primitiveTwilightTicks(): Tick {
    return 4800;
  }

  // Floor the primitive forage/trade economy decays TO once the twilight has
  // fully run its course.
  primitiveTwilightFloor(): number {
    return 0.35;
  }

  // 1.0 while the ice age lasts; once the ice has fully receded, decays
  // linearly to primitiveTwilightFloor() over primitiveTwilightTicks(). Scales
  // the Primitive internal economy (wood→gold conversion) and woodland harvest,
  // so the primitive lifestyle is a power curve that erodes — waiting forever
  // is no longer strictly optimal. Integer basis points → single divide.
  primitiveTwilightMult(game: Game): number {
    const melt = this.climateMeltTicks();
    const t = game.ticks();
    if (t <= melt) return 1;
    const span = this.primitiveTwilightTicks();
    const floor = this.primitiveTwilightFloor();
    if (span <= 0) return floor;
    const over = Math.min(t - melt, span);
    const bp = Math.floor((over * 10000) / span);
    return 1 - ((1 - floor) * bp) / 10000;
  }

  // Once the FIRST player in the world advances out of Primitive, primitive
  // arms slowly obsolesce: this multiplier ramps 1 → worldPressureMaxMult()
  // over worldPressureRampTicks() from that moment, widening the cross-age
  // combat gap (applied in attackLogic). 1.0 while the whole world is wild.
  worldPressureRampTicks(): Tick {
    return 4800;
  }

  worldPressureMaxMult(): number {
    return 1.35;
  }

  worldPressureMult(game: Game): number {
    const first = game.worldFirstAdvanceTick();
    if (first === null) return 1;
    const ramp = this.worldPressureRampTicks();
    const max = this.worldPressureMaxMult();
    if (ramp <= 0) return max;
    const over = Math.min(Math.max(0, game.ticks() - first), ramp);
    const bp = Math.floor((over * 10000) / ramp);
    return 1 + ((max - 1) * bp) / 10000;
  }

  // --- Golden Age: the first-mover burst. The FIRST player in the world to ---
  // reach an Age gets goldenAgeTicks() of boosted regen/income/attack — the
  // payoff for eating the advance premium and arming rivals via diffusion.
  goldenAgeTicks(): Tick {
    return 600; // ~60s
  }

  goldenAgeRegenMult(): number {
    return 1.4;
  }

  goldenAgeGoldMult(): number {
    return 1.5;
  }

  goldenAgeAttackMult(): number {
    return 1.15;
  }

  // --- Great Work: era advance is a public, interruptible ritual. ---
  // Ticks of uninterrupted work needed to complete the advance FROM `age`.
  // Scales up the ladder: a tribal settlement rite is quick, an Eon ascension
  // is a long, raidable commitment.
  greatWorkTicks(age: Age, triumphCount: number = 2): number {
    const base = (30 + 10 * age) * 10; // Primitive 30s → Alien-bound 90s
    const bps =
      ERA_TRANSITION_DURATION_BPS[
        Math.max(0, Math.min(4, Math.floor(triumphCount)))
      ];
    return Math.ceil((base * bps) / 10000);
  }

  // Progress ticks knocked off a defender's Great Work by one successful raid.
  greatWorkRaidSetbackTicks(): number {
    return 100; // 10s per successful raid
  }

  // Basis points of the escrowed gold toll refunded when a Great Work FAILS
  // (the advance gate — settlement/keystone — was lost mid-ritual).
  greatWorkFailRefundBps(): number {
    return 5000; // half is sunk into the ruins
  }

  // --- Primitive raid toys (RaidExecution): raiding a MORE ADVANCED victim ---
  // steals knowledge and spreads unrest — the primal world fights back.
  // Fraction of the victim's tech points looted by a lower-age raider.
  raidTechLootFraction(): number {
    return 0.12;
  }

  // Integration debt (unrest) a PRIMITIVE raider injects into a civilized
  // victim's realm, as a fraction of the victim's overextension capacity.
  raidUnrestDebt(defender: Player | PlayerView): number {
    return Math.floor(this.overextensionCapacity(defender) * 0.15);
  }

  // How territory expands by Age. A Primitive tribe spreads as a contiguous
  // GLOB (front), but unsupported frontier RE-WILDS each tick (see the
  // settlement-anchored rewild knobs below), so the blob DRIFTS rather than
  // balloons. Imperial & Feudal push a FRONT; later ages SWEEP. (The old narrow
  // "path"/corridor mode is retired — straight-line trails read badly.)
  expansionStyle(age: Age): "path" | "front" | "sweep" {
    switch (age) {
      case Age.Primitive:
      case Age.Classical:
      case Age.Imperial:
      case Age.Feudal:
        return "front";
      default:
        return "sweep";
    }
  }

  // --- Nomadic attrition gradient (owner direction, Marta 2026-10-21) ---
  // Expansion is OpenFront's click-to-attack in EVERY age, humans and tribes
  // alike (the old "click = the whole camp drifts over" migration is retired).
  // What changes per age is how much land a player can KEEP: the early ages
  // shed whatever lies beyond their carrying capacity, most-exposed first, so a
  // tribe that pushes forward leaves its tail to the wild (nomads); each age
  // multiplies that capacity, widens the held radius and slows the shed; from
  // the Modern age on land is held indefinitely with no attrition at all,
  // exactly like OpenFront. Applied in PlayerExecution.rewildUnsupportedFrontier.
  rewildEnabled(age: Age): boolean {
    return age < Age.Modern;
  }

  // The roaming-floor machinery (terrain-adjusted capacity, the subsistence
  // floor, the migration capacity readout) still shapes the two nomadic ages;
  // later ages are bounded by the plain carrying capacity times landCapacityMult.
  roamsByMigration(age: Age): boolean {
    return age === Age.Primitive || age === Age.Classical;
  }

  /** Carrying-capacity multiplier per age. Primitive 1x, Classical 3x (owner
   * direction 2026-08-03), then it keeps climbing; Modern+ is unbounded. */
  landCapacityMult(age: Age): number {
    switch (age) {
      case Age.Primitive:
        return 1;
      case Age.Classical:
        return 3;
      case Age.Imperial:
        return 8;
      case Age.Feudal:
        return 20;
      case Age.Enlightened:
        return 50;
      case Age.Industrial:
        return 120;
      default:
        return Number.POSITIVE_INFINITY;
    }
  }

  /** A Classical band holds 3x the ground a primitive one does (same table). */
  migrationCapacityMult(age: Age): number {
    return this.landCapacityMult(age);
  }

  /** Legacy camp-migration stride (only the retired migration execution reads
   * it; kept so old replays still resolve). */
  migrationTickStride(age: Age): number {
    return age === Age.Classical ? 6 : 1;
  }

  /** How far from the camp centroid / each building land counts as held. */
  supportRadiusMult(age: Age): number {
    switch (age) {
      case Age.Primitive:
        return 1;
      case Age.Classical:
        return 2;
      case Age.Imperial:
        return 3;
      case Age.Feudal:
        return 4.5;
      case Age.Enlightened:
        return 6;
      default:
        return 8;
    }
  }

  /** Per-pass shed budget multiplier: the later the age, the gentler the trim.
   * Zero from Modern on (rewild is off there anyway). */
  rewildBudgetMult(age: Age): number {
    switch (age) {
      case Age.Primitive:
        return 1;
      case Age.Classical:
        return 0.4;
      case Age.Imperial:
        return 0.25;
      case Age.Feudal:
        return 0.15;
      case Age.Enlightened:
        return 0.1;
      case Age.Industrial:
        return 0.05;
      default:
        return 0;
    }
  }

  /** Directed expansion: priority cost per tile of distance between a tile
   * under attack and the tile the player clicked (AttackExecution). Higher =
   * the front follows the click more tightly; 0 = OpenFront's even spread. */
  attackFocusWeight(): number {
    // Measured 2026-10-21 (big_plains, 4000 troops, 200 ticks): 1.5 barely
    // moves the camp, 3 draws a five-wide spike; 2.5 walks as a compact wedge.
    return 2.5;
  }
  attackFocusMaxDist(): number {
    return 80;
  }

  /** Most tiles the carrying-cap shed removes per pass (every 10 ticks) from
   * a roaming band that is over capacity: 4 tiles/tick, about an attack's
   * pace, so the front can advance while the back goes wild. */
  nomadShedPerPass(): number {
    return 40;
  }

  /** A roaming-age wilderness attack stops (troops come home) once the band
   * holds this many times its carrying capacity; the back then goes wild, so
   * the band walks rather than swells. */
  nomadOvershootMult(): number {
    return 1.25;
  }

  classicalSupportRadiusMult(): number {
    return this.supportRadiusMult(Age.Classical);
  }
  classicalRewildBudgetMult(): number {
    return this.rewildBudgetMult(Age.Classical);
  }

  // --- Classical (Kingdom) civil war / secession (docs/CLASSICAL_ERA.md) ---
  // When a Classical kingdom's integration debt stays at or above this multiple
  // of its administrative capacity, a contiguous province secedes to a brand-new
  // independent rebel kingdom (a real civil war). This is what caps kingdom size
  // and keeps the map from filling: grab too much and it fractures. Imperial+
  // never secede (advancing past Classical is the reward — empires hold freely).
  civilWarDebtRatio(): number {
    return 1.5;
  }
  // After a secession the parent's debt is reset to this fraction of its capacity
  // — relief (it shed the overextended land) but lingering unrest, so it cannot
  // immediately re-secede on the next check.
  civilWarDebtResetFraction(): number {
    return 0.5;
  }

  // --- Primitive settlement-anchored rewild (the "glob that drifts") ---
  //
  // In the Primitive era a tribe can only HOLD land that is "supported" — close
  // to one of its settlements (Hut/City) or to its mobile camp (the owned-tile
  // centroid). Border tiles outside every support radius re-wild back to neutral
  // each tick (capped). Net feel: push the frontier one way and the unsupported
  // far edge sheds, so the territory MOVES more than it GROWS; settlements are
  // the only way to anchor land and actually accumulate.

  // Radius (tiles) of held land a settlement anchors around itself. Generic
  // fallback; prefer buildingSupportRadius(type) for the per-type value.
  settlementSupportRadius(): number {
    return 16;
  }

  // Per-building land-hold radius. The HUT anchors the LARGEST area of any
  // building — it is the Primitive era's dedicated land-holder, so planting one
  // must hold more ground than anything else (otherwise a hut has no purpose).
  // A City is the era-gate keystone (its value is the carrying-cap bonus + the
  // path to advancement, not reach); Farms/Outposts/Scouts hold a small utility
  // hinterland. Land inside a building's radius is held until the building
  // EXPIRES — you don't gain land by moving, only by settling.
  buildingSupportRadius(type: UnitType): number {
    switch (type) {
      case UnitType.Hut:
        return 22;
      case UnitType.City:
        return 16;
      case UnitType.PrimitiveFarm:
        return 14;
      case UnitType.TradeOutpost:
      case UnitType.ScoutLookout:
        return 13;
      default:
        return this.settlementSupportRadius();
    }
  }

  // Radius (tiles) the tribe's mobile camp (owned-tile centroid) holds with no
  // settlement at all — small, so a settlement-less tribe keeps only a roving blob.
  nomadCampSupportRadius(): number {
    return 11;
  }

  // Max frontier tiles a Primitive tribe re-wilds per tick (a gentle bleed).
  maxRewildTilesPerTick(): number {
    return 6;
  }

  // --- Population carrying capacity (Module §7 — owner direction) ---
  //
  // In the Primitive era you CANNOT fill/conquer the map by normal mechanics:
  // the territory a tribe can hold is bounded by the POPULATION that occupies it,
  // and only TEMPORARY/permanent settlements raise that ceiling. Land beyond the
  // cap re-wilds (most-exposed first), on top of the support-zone drift above.
  // Pure function of state (troops + owned settlements); deterministic, no RNG.
  carryingCapacityTiles(player: Player | PlayerView): number {
    const populationCapacity = this.populationCarryingCapacityTiles(player);
    // Temporary settlements (Hut / Scout Lookout / Trade Outpost / Primitive
    // Farm) raise the cap SOMEWHAT; a permanent City (the era gate) raises it
    // much more — settling is how a tribe earns the right to hold more land.
    const temp =
      player.units(UnitType.Hut).length +
      player.units(UnitType.ScoutLookout).length +
      player.units(UnitType.TradeOutpost).length +
      player.units(UnitType.PrimitiveFarm).length;
    const cities = player
      .units(UnitType.City)
      .filter((u) => !u.isUnderConstruction()).length;
    const fromSettlements =
      temp * this.carryingTempSettlementBonus() +
      cities * this.carryingCityBonus();
    return populationCapacity + fromSettlements;
  }
  populationCarryingCapacityTiles(player: Player | PlayerView): number {
    return (
      this.carryingBaseTiles(player) +
      Math.floor(player.troops() / this.carryingPopPerTile())
    );
  }
  // Subsistence floor: the minimal roving-blob territory ANY tribe holds with
  // no population surplus and no settlements. ONE shared law (owner direction
  // 2026-07-07: tribes and humans live under the same terrain-based carrying
  // capacity — the old 160-human/70-bot split was a perf hack that made tribes
  // fixed-size stickers). Size differences now come from POPULATION: humans
  // start at 25k manpower (~+166 tiles via carryingPopPerTile), bots at 10k
  // (~+66), so human homelands stay large without a special-cased floor.
  // Kept ≤90 so 150+ bots don't blow the 100ms tick budget the way the old
  // uniform-160 floor did (FullGamePerf 2026-07-02).
  carryingBaseTiles(_p?: Player | PlayerView): number {
    // AI-NOTE: the floor is granted PER TRIBE, so world capacity is
    // 90 x tribes + troops/150. Without inheriting it on conquest, absorbing a
    // tribe deletes 90 tiles of capacity and the winner sheds the land it just
    // took - conquest is net-negative and no empire can form | evidence:
    // land claimed fell 66.8% -> 38.7% as 2,885 tribes died (LoopVitals)
    // 250 (was 90) since the nomadic-attrition gradient of 2026-10-21: with
    // expansion by attack, this floor IS the roaming band. A spawn blob is
    // ~250 tiles; a floor below that trimmed a fresh tribe - and the wood
    // stand it had just claimed - in its first minute.
    return 250 * (1 + (_p?.absorbedTribes() ?? 0));
  }
  // Max tiles the carrying-cap sheds per tick (bounds iteration; high enough to
  // HOLD the cap against fast expansion so tribes stay small roving blobs).
  maxCarryingShedPerTick(): number {
    return 200;
  }
  // Population needed to "hold" one extra tile beyond the base (higher = gappier;
  // a tribe must be populous to sprawl). 600->300->150 (2026-07-02, owner
  // direction x2): with Primitive starts ~10k-35k troops this yields ~230-390
  // tiles — a serious homeland; cities remain the real expansion lever.
  carryingPopPerTile(): number {
    // 600 (was 150): a 150K-troop Primitive band holds ~500 tiles, not ~1,100.
    // Measured 2026-10-21 with attack-based expansion: at 150 the World map was
    // 88% claimed by minute 40 (baseline 39-46%) and the leader held 19%.
    return 600;
  }
  // Extra cap tiles per temporary settlement (Hut / Scout Lookout).
  carryingTempSettlementBonus(): number {
    return 18;
  }
  // Extra cap tiles per permanent City (the era-advance keystone).
  carryingCityBonus(): number {
    return 60;
  }

  // Terrain pressure for Primitive territory. Plains are the hospitable baseline;
  // highlands/mountains hold fewer people per tile, so roving territory can
  // shrink as the blob climbs into harsher ground and grow back on easier land.
  primitiveTerrainCapacityMult(terrainType: TerrainType): number {
    switch (terrainType) {
      case TerrainType.Plains:
        return 1;
      case TerrainType.Highland:
        return 0.86;
      case TerrainType.Mountain:
        return 0.68;
      case TerrainType.Ocean:
        return 0;
      default:
        assertNever(terrainType);
    }
  }

  // Biome pressure for Primitive carrying capacity. `terrainType` captures
  // elevation/rockiness; biome captures climate (snow, desert, arid, forest,
  // jungle). Keeping both means a flat desert and a flat green plain are no
  // longer equally hospitable.
  primitiveBiomeCapacityMult(biome: Biome): number {
    switch (biome) {
      case Biome.Green:
        return 1.04;
      case Biome.Forest:
        return 1.02;
      case Biome.Jungle:
        return 0.96;
      case Biome.Arid:
        return 0.84;
      case Biome.Cold:
        return 0.78;
      case Biome.Sandy:
        return 0.74;
      default:
        assertNever(biome);
    }
  }

  // Harsh terrain slows primitive roaming frontier choice. Resource nodes offset
  // some of that friction in PrimitiveMigrationExecution, so a rocky mountain is
  // costly but still attractive.
  primitiveTerrainMigrationFriction(terrainType: TerrainType): number {
    switch (terrainType) {
      case TerrainType.Plains:
        return 0.92;
      case TerrainType.Highland:
        return 1.12;
      case TerrainType.Mountain:
        return 1.38;
      case TerrainType.Ocean:
        return Number.POSITIVE_INFINITY;
      default:
        assertNever(terrainType);
    }
  }

  // Biome preference for primitive roaming. Values above 1 pull a tribe toward
  // favorable climates; values below 1 make snow/arid/sandy tiles less attractive
  // even when the elevation class is still plain.
  primitiveBiomeMigrationFavorability(biome: Biome): number {
    switch (biome) {
      case Biome.Green:
        return 1.05;
      case Biome.Forest:
        return 1.03;
      case Biome.Jungle:
        return 0.98;
      case Biome.Arid:
        return 0.88;
      case Biome.Cold:
        return 0.82;
      case Biome.Sandy:
        return 0.8;
      default:
        assertNever(biome);
    }
  }

  // Population lost when a Primitive roaming blob claims a tile in harsh ground.
  // Plains cost nothing; highlands/mountains are attritional.
  primitiveTerrainMigrationAttrition(terrainType: TerrainType): number {
    switch (terrainType) {
      case TerrainType.Plains:
        return 0;
      case TerrainType.Highland:
        return 4;
      case TerrainType.Mountain:
        return 10;
      case TerrainType.Ocean:
        return 0;
      default:
        assertNever(terrainType);
    }
  }

  // Climate attrition layered on top of elevation attrition. A plains tile in
  // snow/desert can now hurt, while green plains remain free to enter.
  primitiveBiomeMigrationAttrition(biome: Biome): number {
    switch (biome) {
      case Biome.Green:
        return 0;
      case Biome.Forest:
        return 1;
      case Biome.Jungle:
        return 2;
      case Biome.Arid:
        return 4;
      case Biome.Sandy:
        return 6;
      case Biome.Cold:
        return 7;
      default:
        assertNever(biome);
    }
  }

  primitiveResourceMigrationFrictionRelief(kind: ResourceKind): number {
    switch (kind) {
      case ResourceKind.Rock:
        return 0.2;
      case ResourceKind.Wood:
      case ResourceKind.Fish:
        return 0.08;
      case ResourceKind.Meat:
      case ResourceKind.None:
        return 0;
      default:
        assertNever(kind);
    }
  }

  primitiveResourceMigrationAttritionRelief(kind: ResourceKind): number {
    switch (kind) {
      case ResourceKind.Rock:
        return 0.45;
      case ResourceKind.Wood:
      case ResourceKind.Fish:
        return 0.2;
      case ResourceKind.Meat:
      case ResourceKind.None:
        return 0;
      default:
        assertNever(kind);
    }
  }

  // --- Primitive repopulation (Module §7 — keep the map gappy) ---
  // The early map should be mostly empty wilderness with only a few roaming
  // tribes. PrimitiveRepopulationExecution tops up tribes/packs into big gaps
  // when the count is low — a floor/top-up, never a fill.
  primitiveRepopIntervalTicks(): number {
    return 100; // ~10s @10Hz between checks
  }
  // Below this many alive Bot tribes, always top up (the gappy FLOOR).
  primitiveMinTribes(): number {
    return 3;
  }
  // Hard ceiling on alive Bot tribes regardless of map size (keeps it gappy).
  primitiveMaxTribes(): number {
    return 14;
  }
  // Land tiles per tribe — LARGE, so density stays low (gappy). The effective
  // ceiling is min(primitiveMaxTribes, land/this), floored at primitiveMinTribes.
  primitiveTilesPerTribe(): number {
    return 3500;
  }
  // Stop repopulating once any alive player reaches this age (era has moved on).
  primitiveRepopMaxAge(): Age {
    return Age.Feudal;
  }
  // Neutral-land samples examined per check (bounded scan).
  primitiveRepopSamplesPerCheck(): number {
    return 12;
  }
  // Probe-ring radius (tiles) used to score how empty a candidate site is.
  primitiveRepopGapRadius(): number {
    return 22;
  }
  // Fraction of the probe ring that must be empty for a "big gap" top-up when
  // already above the floor (1.0 = deep wilderness).
  primitiveRepopGapThreshold(): number {
    return 0.85;
  }
  // Chance a top-up is a predator PACK rather than a human tribe: higher in deep
  // wilderness (packs favour the extra-gappy parts), lower in settled-ish gaps.
  primitiveRepopPackRatio(): number {
    return 0.15;
  }
  primitiveRepopPackRatioWild(): number {
    return 0.5;
  }

  // --- Hut lifecycle (temporary Primitive settlement) ---

  // Ticks a Hut survives before it self-destructs (≈ ticks/s is 10). A Hut is a
  // TEMPORARY camp: it decays and vanishes, it is never upgradeable. Build a
  // permanent House (City) to actually advance the era.
  hutLifespanTicks(): number {
    return 120 * 10; // ~2 minutes
  }

  // --- Phase 2 economy structures (docs/ICE_AGE_ECONOMY.md §B) ---
  // PRIMITIVE FARM — a temporary "primitive factory" that drips internal gold.
  // Sized so a full-lifespan farm pays out ≈130% of its cost (a +30% return), but
  // a flat per-tick drip ⇒ break-even only at ~77% of life ⇒ a farm raided/
  // destroyed early is a net loss (the "raid it → loss-making" property, emergent).
  // Cost 6000 / lifespan 780 ⇒ perTick = ceil(1.30·6000/780) = 10 ⇒ total 7800 = 1.30×.
  primitiveFarmCost(): number {
    return 6_000;
  }
  primitiveFarmLifespanTicks(): number {
    return 780; // ~78s
  }
  // Flat internal gold per tick. Derived from cost × 1.30 ÷ lifespan so the +30%-
  // over-lifetime invariant holds. Integer bigint (gold is lockstep-deterministic).
  primitiveFarmGoldPerTick(): bigint {
    return BigInt(
      Math.ceil(
        (1.3 * this.primitiveFarmCost()) / this.primitiveFarmLifespanTicks(),
      ),
    );
  }

  // TRADE OUTPOST — temporary; while it stands it SPEEDS the resource→gold internal
  // economy. Capped at tradeOutpostMaxCount() per tribe (enforced in canBuildUnitType
  // + the bot build logic). Each owned outpost adds tradeOutpostConversionBonusPct()
  // to the conversion (integer percent so the multiply stays integer).
  tradeOutpostCost(): number {
    return this.hutCost(); // cheap, like a Hut
  }
  tradeOutpostLifespanTicks(): number {
    return 100 * 10; // ~100s
  }
  tradeOutpostMaxCount(): number {
    return 3;
  }
  tradeOutpostConversionBonusPct(): number {
    return 25; // +25% per outpost → +75% at the 3-outpost cap
  }

  // --- Scout Lookout (temporary Primitive scout post; docs §9) ---
  // Cheap, like a Hut. Reveals resources within scoutRange() while it stands,
  // then ages out (a bit shorter-lived than a Hut).
  scoutCost(): number {
    return this.hutCost();
  }
  scoutLifespanTicks(): number {
    return 90 * 10; // ~1.5 minutes
  }
  // Radius (tiles) of resources a Scout Lookout reveals. Placed at the territory
  // edge, this reads as a forward scout into the unexplored wild.
  scoutRange(): number {
    return 60;
  }

  // No second Hut may be placed within this many tiles of an existing Hut.
  hutMinSpacing(): number {
    return 24;
  }

  // --- Wood + woodland (Primitive resource economy) ---

  // Every human spawn gets a small wood stand within a short walk when none is
  // nearby (StarterStand.ts), so the first objective is always reachable.
  primitiveStarterStand(): boolean {
    return true;
  }

  // Wood gained for each woodland (forest/jungle) tile a player captures.
  woodPerWoodlandTile(): number {
    return 6;
  }

  // Extra attacker troops consumed when capturing a woodland tile (dense woods
  // cost population to clear) — on top of the normal attack troop loss.
  woodlandCaptureTroopCost(): number {
    return 4;
  }

  // Wood required to launch a Primitive canoe (a wood-built TransportShip). The
  // canoe needs no Port — just a lot of wood. Later ages launch boats freely.
  canoeWoodCost(): number {
    return 50;
  }

  // A Primitive predator tribe that grows past this many owned tiles splits its
  // territory roughly in half (a pack dividing) — reinforces that tribes can't
  // hold massive land. Civilized (non-Primitive) players never auto-split.
  tribeAutoSplitTiles(): number {
    return 220;
  }

  // --- Animal-pack taxonomy (Module §1/§2) ---

  // Fraction of Bots that deterministically roll into an ANIMAL PACK at spawn
  // (the rest become normal human tribes). Humans/Nations are never packs.
  animalPackBotRatio(): number {
    return 0.2;
  }

  // Animal packs drift faster: their nomad target-tile count and per-tick
  // shed/gain are scaled by this multiplier (Module §3).
  animalPackNomadMult(): number {
    return 2.0;
  }

  // An animal pack is only fully conquered when the attacker commits troops at
  // least this many times the pack's strength; weaker attacks merely push/damage
  // them (they rewild away). (Module §2.)
  animalPackConquerRatio(): number {
    return 3.0;
  }

  // ===================================================================
  // Neanderthals (Module §7) — a primitive NPC people, distinct from human
  // tribes and animal packs. They boom early (most population, mammoth-fed,
  // strong vs predators) then go extinct by the end of the Primitive era: they
  // can never hold money (no trade ⇒ no advance) and suffer escalating climate
  // attrition + admixture absorption.
  // ===================================================================

  // Fraction of Bots that roll Neanderthal at spawn. The animal-pack roll is
  // drawn FIRST and wins ties of intent (mutually exclusive); only a non-pack
  // bot can then roll Neanderthal. Humans/Nations never roll.
  neanderthalBotRatio(): number {
    return 0.12;
  }

  // Neanderthals start with this multiple of the base bot manpower — the MOST
  // population of any tribe type, so they dominate the early Primitive era.
  neanderthalStartTroopMult(): number {
    return 3.0;
  }

  // Neanderthals are STRONG vs predator packs. When a Neanderthal attacks a
  // pack their attacker troop loss is divided by this; when a pack attacks a
  // Neanderthal the Neanderthal defends harder by the same factor.
  neanderthalVsPackCombatBonus(): number {
    return 1.75;
  }

  // A Neanderthal needs to commit only this multiple of a pack's strength to
  // fully conquer it (vs the generic animalPackConquerRatio of 3.0) — they are
  // the apex hunters of the early era.
  neanderthalPackConquerRatio(): number {
    return 1.5;
  }

  // --- Mammoths + Neanderthals ride the UNIFIED ice-age climate clock ---
  // "Mammoth abundance" and the Neanderthal regen boom ARE climateIceFraction(game)
  // (1.0 under full ice → 0.0 once the caps recede): mammoths are plentiful and
  // Neanderthals thrive in the deep ice age, and BOTH wane as the ice recedes — a
  // SINGLE clock (the same one that thaws prices, §B/§D), not separate timers.
  // Callers pass climateIceFractionAtTick(ticks) in as the ice fraction.

  // Meat added to a Neanderthal's pile per tick from mammoth hunting, scaled by
  // the current ice fraction (tapers to 0 as the herds vanish with the ice).
  mammothMeatPerHuntTick(): number {
    return 3;
  }
  // Neanderthal troop-regen MULTIPLIER as a function of ice fraction: a big boom
  // while the ice age/mammoths last, collapsing toward a near-zero floor once the
  // caps and megafauna are gone. Returns the full multiplier applied to base regen.
  neanderthalRegenMult(iceFraction: number): number {
    const floor = 0.1; // near-zero regen once mammoths are gone
    const peak = 3.0; // strong regen while herds are plentiful
    const a = Math.max(0, Math.min(1, iceFraction));
    return floor + (peak - floor) * a;
  }

  // --- Mammoth HERDS (Module §11 — the on-map huntable resource) ---
  // Roaming neutral herds in cold/woodland wilderness. A Primitive tribe whose
  // land touches a herd hunts it for MEAT — mammoths are 50% MORE rewarding than
  // a normal hunt/gather (mammothHuntRewardMult). Herds RESPAWN slowly (rarer
  // than ordinary game) up to a cap that RECEDES with the ice on the same climate
  // clock that kills the Neanderthals, so they go extinct together.

  // Base herd count, scaled by land area (kept low — wilderness, not a farm).
  mammothBaseHerds(landTiles: number): number {
    return Math.max(5, Math.min(18, Math.floor(landTiles / 5000)));
  }
  mammothHerdStartSize(): number {
    return 40;
  }
  mammothDriftIntervalTicks(): number {
    return 20; // herds drift/are-hunted on this cadence (~2s @10Hz)
  }
  // Meat a normal hunt/gather yields — the baseline mammoths beat by 50%.
  mammothBaseHuntMeat(): number {
    return 8;
  }
  // Mammoths are 50% MORE rewarding than other hunts/gathers (owner direction).
  mammothHuntRewardMult(): number {
    return 1.5;
  }
  // Herd size consumed per hunt tick.
  mammothHuntDepletion(): number {
    return 3;
  }
  // Natural size loss per check as the ice recedes (scaled by 1 - iceFraction).
  mammothClimateSizeDecayPerCheck(): number {
    return 4;
  }
  // SLOW respawn (deliberately rarer than ordinary game) up toward the climate
  // cap; once the cap reaches 0 (ice fully receded) they never return.
  mammothRespawnChancePerCheck(): number {
    return 0.12;
  }
  // --- Climate-decline attrition (Module §7) ---
  // Neanderthals slowly die out as the ice recedes. Attrition is zero under full
  // ice and escalates convexly as the same climate clock approaches 0.0; no
  // separate mammoth/Neanderthal timers are allowed here, or the systems drift.
  // Returns the fraction of CURRENT troops lost this tick.
  neanderthalMaxAttritionFraction(): number {
    return 0.05; // 5% of current troops per tick once the ice is gone
  }
  neanderthalBaselineAttritionFraction(): number {
    return 0.0003; // faint pressure while the thaw is still early
  }
  neanderthalAttritionForIce(iceFraction: number): number {
    const ice = Math.max(0, Math.min(1, iceFraction));
    const thaw = 1 - ice;
    if (thaw <= 0) return 0;
    // Convex, deterministic, and intentionally no Math.pow: same constraint as
    // the climate clock.
    const ramp = thaw * thaw;
    const baseline = this.neanderthalBaselineAttritionFraction() * thaw;
    return (
      baseline + (this.neanderthalMaxAttritionFraction() - baseline) * ramp
    );
  }

  // --- Admixture (Module §7) ---
  // A raid/conquest of Neanderthals by a NON-Neanderthal can become admixture
  // (interbreeding) instead of a clean kill: the victor absorbs a share of the
  // Neanderthal population as bonus troops. (The historical echo: non-African
  // humans still carry Neanderthal DNA.)
  // Chance that ELIMINATING a Neanderthal tribe yields admixture population.
  admixtureConquerChance(): number {
    return 0.6;
  }
  // Fraction of the Neanderthal's troops gained as admixture population on
  // conquest (on top of normal plunder).
  admixtureConquerTroopFraction(): number {
    return 0.5;
  }
  // Chance a successful RAID on a Neanderthal yields admixture population.
  admixtureRaidChance(): number {
    return 0.3;
  }
  // Fraction of the Neanderthal's troops gained as admixture population on raid.
  admixtureRaidTroopFraction(): number {
    return 0.15;
  }

  // ===================================================================
  // Primitive conquest economy (Module §7 — owner direction):
  // In the Primitive era there is NO conventional conquest-for-gold. Tribes are
  // very hard to EXTERMINATE; when one is exterminated the victor takes
  // SLAVES/sacrifice (a pile resource) which slowly converts to gold — the sole,
  // costly conquest payoff. Outside Primitive, normal plunder applies.
  // ===================================================================

  // A Primitive-era tribe is only fully exterminated when the attacker commits
  // troops at least this many times the defender's strength — otherwise the
  // attack just bloodies/pushes it (it survives and drifts). POPULATION-
  // RELATIVE (owner direction 2026-07-07 "attacking tribes does nothing"): a
  // tribe at full strength keeps the steep 4x wall, but a bloodied/starved
  // tribe (troops well below its tile-derived maxTroops) becomes progressively
  // wipeable, flooring at 1.5x — so grinding a tribe down MEANS something and
  // the kill is earnable. Deterministic: pure function of replicated state.
  // (Animal packs keep their own animalPackConquerRatio; this governs normal
  // Primitive tribes.)
  primitiveExterminationRatio(defender?: Player | PlayerView): number {
    const CEIL = 4.0;
    if (defender === undefined) {
      return CEIL;
    }
    const max = this.maxTroops(defender);
    if (max <= 0) {
      return 1.5;
    }
    const fill = Math.max(0, Math.min(1, defender.troops() / max));
    return 1.5 + 2.5 * fill;
  }

  // Slaves seized PER TILE captured from a living Primitive tribe (non-pack).
  // Incremental conquest payoff (owner direction 2026-07-07): raiding a tribe's
  // land pays as you fight, not only on a full extermination. Fractional is
  // fine — slaves ride the unified float resource pile; every consumer floors
  // at source (see slavesConvertedPerTick AI-NOTE).
  primitiveTileCaptureSlaves(): number {
    // AI-NOTE: kept LOW on purpose. Slaves alias the same _resources pile that
    // harvested wood/rock feed, so a high value makes conquest the era's income
    // engine - which forces a crowded map and contradicts a roaming Primitive
    // era | evidence: sparse map cut richest gold 309,009 -> 4,043 (LoopVitals)
    return 0.1;
  }

  // Ticks a freshly CAPTURED tile is exempt from rewild/carrying-cap shedding.
  // Without this, land conquered from a tribe was the most-exposed-from-camp
  // land and got shed back the same second — attacks were net-zero (owner
  // complaint 2026-07-07). With it, conquest RELOCATES the blob toward the
  // battlefront: the cap sheds old trailing land instead while the grace holds.
  captureGraceTicks(): number {
    return 100;
  }

  // Once a Primitive tribe is down to this many tiles, its CORE resists capture
  // entirely unless the attacker arrives with overwhelming force (the ratio
  // above) — so a marginal attack can't whittle it to death; it stalls and the
  // tribe drifts away. Only an overwhelming strike takes the core, which is what
  // triggers the slaves/sacrifice payoff. Makes extermination "very intensive".
  primitiveExterminationFloorTiles(): number {
    return 12;
  }

  // Slaves taken when a Primitive tribe is exterminated: a base plus a share of
  // the victim's population and territory (a bigger tribe yields more captives).
  slavesPerExtermination(victimTroops: number, victimTiles: number): number {
    return Math.floor(5 + victimTroops * 0.0005 + victimTiles * 0.5);
  }

  // Slaves→gold conversion (the costly, indirect Primitive income). Each tick a
  // fraction of held slaves is "worked off" into gold at slaveGoldValue each.
  // Slow by design: amassing the ~225k to plant a permanent settlement and leave
  // Primitive is a long grind even after a successful extermination.
  slavesConvertedPerTick(heldSlaves: number): number {
    // AI-NOTE: floor — slaves()/wood()/resources() all alias ONE float
    // unified pile (R13), so heldSlaves can be fractional. Without flooring
    // this returns a fractional slave count that BigInt() throws on in the
    // ObjectiveRail HUD. Whole slaves only. | evidence:
    // tests/client/graphics/layers/ObjectiveRail.test.ts (fractional-pile
    // cases) | expires: when slaves is an integer-only counter
    return Math.floor(
      Math.min(heldSlaves, Math.max(0, Math.ceil(heldSlaves * 0.02))),
    );
  }
  slaveGoldValue(): bigint {
    return 25n;
  }

  // --- Raid (extract wealth, no land — Module §6) ---

  // Fraction of the defender's gold transferred to the attacker on a successful
  // raid (integer basis points are derived from this; never float-cast bigint).
  raidLootFraction(): number {
    return 0.25;
  }

  // Raid power coefficients: power(p) = tiles + troopWeight·troops +
  // devWeight·(cityCount·cityDev + age·ageDev).
  raidTroopWeight(): number {
    return 0.01;
  }
  raidDevWeight(): number {
    return 1.0;
  }
  raidCityDev(): number {
    return 50;
  }
  raidAgeDev(): number {
    return 25;
  }

  // Clamp bounds on a raid's success probability.
  raidSuccessMin(): number {
    return 0.1;
  }
  raidSuccessMax(): number {
    return 0.9;
  }

  // --- Resource seeding densities (Module §4) ---

  // Per-land-tile chance a Wood node seeds, by biome. Wood only in wooded biomes
  // (Forest/Jungle dense, Green sparse); zero on Cold-ice / Arid / Sandy.
  // SCARCITY (docs/ICE_AGE_ECONOMY.md §B): resources are deliberately scarce so
  // building is a challenge and a search across the map — you are NOT surrounded
  // by plenty.
  woodChanceForBiome(biome: Biome): number {
    switch (biome) {
      case Biome.Forest:
      case Biome.Jungle:
        return 0.06;
      case Biome.Green:
        return 0.012;
      case Biome.Cold:
      case Biome.Arid:
      case Biome.Sandy:
      default:
        return 0;
    }
  }

  // Base per-land-tile chance a Rock node seeds (any land), multiplied by
  // rockMountainMult() on Mountain/Highland terrain. Scarcified 0.03→0.01 with
  // rock clustering harder onto rocky ground. See woodChanceForBiome.
  rockChanceBase(): number {
    return 0.006;
  }
  rockMountainMult(): number {
    return 4;
  }
  // Glacial action exposes richer rock ranges in the ice sheet. Resource seeding
  // uses this as a deterministic richness multiplier at tick 0, making icy land
  // worth probing despite the attrition risk.
  iceAgeRockRichnessMult(): number {
    return 1.7;
  }

  // --- Primitive internal economy (docs/ICE_AGE_ECONOMY.md §B) ---
  // population → harvest → resources → gold, converted SLOWLY by a passive
  // internal economy (faster via Trade Outposts / Primitive Farms in Phase 2).
  // This is the income that lets a developing tribe bank toward a permanent
  // settlement (the un-freeze income source — the designed caravan trade was
  // never built). Pure rates; the conversion + resource spend happen in
  // PlayerExecution.tick (Config never mutates a player).

  // Gold minted per unit of resource (wood) converted by the internal economy.
  resourceGoldValue(): number {
    return 25;
  }
  // Fraction of the stockpile converted to gold each tick (slow drip), plus a
  // small flat floor so even a tiny stockpile trickles. Bounded per tick.
  internalEconomyFraction(): number {
    return 0.02;
  }
  internalEconomyMinPerTick(): number {
    return 1;
  }
  internalEconomyMaxPerTick(): number {
    return 40;
  }

  resourceTerritoryFlowIntervalTicks(): number {
    return 20;
  }
  forestSustainableQuantity(): number {
    return 14;
  }
  // Nomadic Stone Age (Marta 2026-10-22): stands run OUT so a tribe must move; same total yield, ~3x faster.
  primitiveForestSustainableQuantity(): number {
    return 0;
  }
  forestMaxQuantity(): number {
    return 44;
  }
  forestUsePerFlow(): number {
    return 1;
  }
  // Nomadic Stone Age (Marta 2026-10-22): stands run OUT so a tribe must move; same total yield, ~3x faster.
  primitiveForestUsePerFlow(): number {
    return 3;
  }
  forestRegrowPerFlow(): number {
    return 2;
  }
  forestClearYieldPerFlow(): number {
    return 3;
  }
  // Nomadic Stone Age (Marta 2026-10-22): stands run OUT so a tribe must move; same total yield, ~3x faster.
  primitiveForestClearYieldPerFlow(): number {
    return 24;
  }
  forestTrickleYieldPerFlow(): number {
    return 1;
  }
  // Nomadic Stone Age (Marta 2026-10-22): stands run OUT so a tribe must move; same total yield, ~3x faster.
  primitiveForestTrickleYieldPerFlow(): number {
    return 0;
  }
  rockMineYieldPerFlow(): number {
    return 2;
  }
  // Nomadic Stone Age (Marta 2026-10-22): stands run OUT so a tribe must move; same total yield, ~3x faster.
  primitiveRockMineYieldPerFlow(): number {
    return 6;
  }
  fishMaxQuantity(): number {
    return 36;
  }
  fishRegrowPerFlow(): number {
    return 1;
  }
  primitiveFishSustainableQuantity(): number {
    return 5;
  }
  primitiveFishUsePerFlow(): number {
    return 2;
  }
  primitiveFishClearYieldPerFlow(): number {
    return 2;
  }
  primitiveFishTrickleYieldPerFlow(): number {
    return 1;
  }

  // --- Era diffusion (EU4-style technology spread) ---

  // Credit granted to a player on the SAME contiguous landmass as an advancer
  // (Module §6: lowered 0.9→0.4 so neighbors can't coast to free ages — a
  // contiguous neighbor still gets a meaningful head start but must accrue the
  // remaining ~60% of the tech threshold itself).
  diffusionContiguousDiscount(): number {
    return 0.4;
  }

  // Per-tile decay of diffusion credit with distance to the advancer (global
  // term for unconnected islands). credit ≈ falloff ^ distanceTiles.
  diffusionDistanceFalloff(): number {
    return 0.985;
  }

  // Beyond this many tiles, global diffusion credit is treated as zero.
  diffusionMaxRange(): number {
    return 400;
  }

  // Latitude-fraction thresholds (|lat| measured from the equator, 0..1) used by
  // Module D to derive biome from a tile's row. Pole→equator the six bands are:
  // Cold (ice) ≥ cold, Forest (boreal/temperate woodland) ≥ forest, Green
  // (temperate plains) ≥ green, Arid (dry sub-tropic) ≥ arid, Sandy (subtropical
  // desert belt) ≥ sandy, and equatorial Jungle (rainforest) below `sandy`.
  biomeLatitudeBands(): {
    cold: number;
    forest: number;
    green: number;
    arid: number;
    sandy: number;
  } {
    return { cold: 0.78, forest: 0.55, green: 0.38, arid: 0.22, sandy: 0.1 };
  }

  // Keystone structure each Age must own to advance to the next Age (Module B).
  // Primitive→Imperial uses the permanent City (handled in meetsAdvanceCriteria),
  // so it is intentionally absent here.
  advanceKeystone(age: Age): UnitType | null {
    return ADVANCE_KEYSTONE[age] ?? null;
  }

  // Multiplier on attackTilesPerTick by Age — Primitive crawls, later ages
  // expand fast. Indexed by Age (Primitive..Alien).
  attackTilesPerTickAgeMult(age: Age): number {
    return ATTACK_TILES_PER_TICK_AGE_MULT[age] ?? 1.0;
  }

  // Duration of the troop-regen penalty after advancing an Age (~45s at 10 ticks/s).
  advancePenaltyTicks(triumphCount: number = 2): number {
    const bps =
      ERA_TRANSITION_PENALTY_BPS[
        Math.max(0, Math.min(4, Math.floor(triumphCount)))
      ];
    return Math.ceil((ADVANCE_PENALTY_TICKS * bps) / 10000);
  }

  // Troop regen multiplier applied while the post-advance penalty window is active.
  advancePenaltyRegenMult(): number {
    return 0.5;
  }

  // Expansion/structure cost multiplier by Age (cheaper early, dearer late).
  ageExpansionCostMult(p: Player | PlayerView): number {
    return AGE_EXPANSION_COST_MULT[p.age()] ?? 1.0;
  }

  // Troop regen multiplier by Age (faster early, slower late).
  ageTroopRegenMult(p: Player | PlayerView): number {
    return AGE_TROOP_REGEN_MULT[p.age()] ?? 1.0;
  }

  // Tech points gained per tick: base + per-City + per-Granary bonuses.
  // Hard ceiling on tech per tick: with the flat 9000-point era requirement it
  // sets the minimum era length (9000 / 1.5 = 6000 ticks = 10 min). Buildings
  // get a kingdom to the ceiling, never past it, so building more cannot
  // beeline the ladder (owner direction 2026-08-04 / 2026-10-21).
  techPointsPerTickCap(): number {
    return 1.5;
  }

  techPointsPerTick(p: Player | PlayerView): number {
    let pts = 1;
    pts += 0.5 * p.units(UnitType.City).length;
    pts += 1.0 * p.units(UnitType.Granary).length;
    pts += this.eonSiteTechPointsPerTick() * p.units(UnitType.EonSite).length;
    return Math.min(this.techPointsPerTickCap(), pts);
  }

  primitiveMigrationBaseCapacity(): number {
    return PRIMITIVE_MIGRATION_BASE_CAPACITY;
  }

  primitiveMigrationCapacity(p: Player | PlayerView): number {
    if (!this.roamsByMigration(p.age())) {
      return Number.POSITIVE_INFINITY;
    }
    // ONE law for every Primitive player (owner direction 2026-07-07): the
    // roving cap is the shared subsistence base or the population/settlement
    // capacity, whichever is larger, plus the same structure bonuses for
    // everyone. No human/bot branches — a populous tribe roams as wide as a
    // populous human band, and structures anchor either equally.
    const populationCapacity = Math.max(
      PRIMITIVE_MIGRATION_BASE_CAPACITY,
      this.carryingCapacityTiles(p),
    );
    return (
      (populationCapacity +
        p.units(UnitType.Palisade).length * PRIMITIVE_CAPACITY_PER_PALISADE +
        p.units(UnitType.Granary).length * PRIMITIVE_CAPACITY_PER_GRANARY +
        p.units(UnitType.EonSite).length * PRIMITIVE_CAPACITY_PER_EON_SITE) *
      this.migrationCapacityMult(p.age())
    );
  }

  primitiveMigrationTilesPerTick(p: Player | PlayerView): number {
    if (!this.roamsByMigration(p.age())) {
      return 0;
    }
    // Move 2 tiles/tick whether the blob is still GROWING into spare capacity or
    // already TRANSLATING at capacity — a roaming tribe should feel responsive,
    // not crawl one tile at a time. Bounded by trimToCapacity, so this is roam
    // SPEED, not unbounded growth.
    return this.primitiveMigrationCapacity(p) > p.numTilesOwned() ? 3 : 2;
  }

  primitiveMigrationHeadingInertia(): number {
    return 0.72;
  }

  // Max tiles the ACTIVE migration sheds per tick BEYOND what it just added.
  // During pure translation the trim sheds exactly the tiles conquered this tick
  // (size held); when the terrain-adjusted capacity DROPS (blob roams onto
  // mountains / harsher biome) the surplus is bled off only this many tiles/tick
  // so territory eases down as time attrition instead of snap-shrinking a chunk
  // the instant the ground changes (owner direction 2026-07-04: "based on terrain
  // type territory size suddenly changes — should be more gradual with attrition").
  primitiveMigrationMaxShrinkPerTick(): number {
    return 4;
  }

  primitiveMigrationHeadingMemoryTicks(): number {
    return 90;
  }

  primitiveMigrationBlobRoughness(): number {
    return 0.16;
  }

  // How long (ticks) a Primitive tribe is treated as "actively migrating" after
  // its last migration step. While this window is live the passive
  // rewild (PlayerExecution.rewildUnsupportedFrontier) DEFERS to the migration
  // so the two systems stop fighting over the blob. The migration records a step
  // every tick it is active, so this only has to bridge the ~10-tick rewild
  // cadence; it also defensively auto-expires a stale target. Deterministic.
  primitiveMigrationGraceTicks(): number {
    return 20;
  }

  // Per-tick gold upkeep cost of a building type.
  buildingUpkeepPerTick(unitType: UnitType): number {
    return BUILDING_UPKEEP_PER_TICK[unitType as string] ?? 0;
  }

  // Per-tick gold upkeep per owned border tile (small).
  borderUpkeepPerTile(): number {
    return 0.02;
  }

  // Per-tick flat gold income contributed by each Harbor.
  harborIncomePerTick(): number {
    return 20;
  }

  // --- Foundation structure knobs (Module D-structures) ---

  // SupplyDepot relief: per-depot fractional reduction to integration attrition /
  // boost to effective integration throughput, consumed by the overextension /
  // combat-attrition modules (e.g. Module B/C read this via the depot count
  // `player.units(UnitType.SupplyDepot).length`). Returns the per-depot relief
  // fraction (0.05 = 5% relief per owned depot).
  supplyDepotReliefPerDepot(): number {
    return 0.05;
  }

  // Wonder prestige: steady Renown bonus per owned Wonder per tick, picked up by
  // the scoring module (G) in its renown accrual. Wonder is gated unique-per-player.
  wonderRenownBonus(): number {
    return 0.05;
  }

  // EonSite trickle: techPoints granted per tick to the owner of each held EonSite.
  eonSiteTechPointsPerTick(): number {
    return 0.75;
  }

  // Gold-income tax rate applied to the dominant leader (up to 30%).
  leaderTaxRate(p: Player | PlayerView): number {
    return p.threatScore() * 0.3;
  }

  // --- Coalition-against-the-leader (Module E) ---

  // How long a coalition pact lasts before auto-expiring (also re-validated every
  // tick against the live threat leader).
  coalitionDuration(): Tick {
    return COALITION_DURATION_TICKS;
  }

  // Minimum threatScore for a player to be a valid coalition TARGET. Below this,
  // forming/holding a coalition against them is illegitimate (abuse guard).
  coalitionThreatThreshold(): number {
    return COALITION_THREAT_THRESHOLD;
  }

  // Combat strength multiplier a coalition member gets when ATTACKING the target
  // (capped, modest). Applied as a divisor on attacker loss in attackLogic.
  coalitionAttackBonus(): number {
    return 1.15;
  }

  // Defensive multiplier a coalition member gets when DEFENDING against the
  // target (capped, modest). Amplifies the target's attacker loss.
  coalitionDefenseBonus(): number {
    return 1.15;
  }

  // Gold-income multiplier for an active coalition member (small economic rally).
  coalitionIncomeBonus(): number {
    return 1.1;
  }

  // --- Anti-snowball tuning (modules wire behavior; foundation defaults here) ---

  primitiveTerrainAmbush(
    terrainType: TerrainType,
    defenderAge: Age,
  ): { defense: number; speed: number } {
    if (defenderAge !== Age.Primitive) {
      return { defense: 1, speed: 1 };
    }
    switch (terrainType) {
      case TerrainType.Plains:
        return { defense: 0.95, speed: 0.95 };
      case TerrainType.Highland:
        return { defense: 1.15, speed: 1.1 };
      case TerrainType.Mountain:
        return { defense: 1.3, speed: 1.18 };
      case TerrainType.Ocean:
        return { defense: 1, speed: 1 };
      default:
        assertNever(terrainType);
    }
  }

  advancePenaltyDefenseMult(): number {
    return 0.85;
  }

  // Defender's advantage: attacker pays ~this many times the defender's loss.
  defenderAdvantage(): number {
    return 2.0;
  }

  // Cross-age combat multiplier (obsolescence). Higher age beats lower age.
  // ~1.0 same age, ~+12% per age ahead and ~-10% per age behind, clamped ±3 ages.
  ageCombatMult(attackerAge: Age, defenderAge: Age): number {
    const diff = clampAgeDiff(attackerAge - defenderAge);
    return AGE_COMBAT_MULT[diff + 3] ?? 1.0;
  }

  // Fraction of a victim's banked gold/troops transferred to the conqueror.
  plunderFraction(): number {
    return 0.5;
  }

  // Integration debt digested per tick (scales up with Age — Modern digests fast).
  integrationThroughputPerTick(p: Player | PlayerView): number {
    return INTEGRATION_THROUGHPUT_PER_TICK[p.age()] ?? 1.0;
  }

  // Penalty multipliers as integration debt grows past a capacity = f(tiles, cities).
  // Worse (toward ~0.6) as debt approaches/exceeds capacity; 1.0 when fully integrated.
  overextensionPenalty(p: Player | PlayerView): {
    goldMult: number;
    regenMult: number;
  } {
    // Era-overhaul: the keep-cost penalty applies in the Primitive AND Classical
    // (Kingdom) eras. Imperial+ hold territory freely — outside these eras the
    // penalty was so harsh that nuking land before settling was optimal. A young
    // Classical kingdom, by contrast, SHOULD buckle under overexpansion (the "big
    // internal dissent penalty"), the soft pressure that precedes a civil war.
    if (p.age() !== Age.Primitive && p.age() !== Age.Classical) {
      return { goldMult: 1.0, regenMult: 1.0 };
    }
    const debt = p.integrationDebt();
    if (debt <= 0) {
      return { goldMult: 1.0, regenMult: 1.0 };
    }
    const capacity = this.overextensionCapacity(p);
    // ratio in [0,1]: 0 = no debt, 1 = debt >= capacity.
    const ratio = Math.min(1, debt / Math.max(1, capacity));
    // Classical bites harder than Primitive (a kingdom's dissent, not a tribe's
    // mild bleed) — but still never a reason to nuke-first.
    const maxPenalty =
      p.age() === Age.Classical
        ? OVEREXTENSION_MAX_PENALTY_CLASSICAL
        : OVEREXTENSION_MAX_PENALTY;
    const goldMult = 1 - maxPenalty * ratio;
    const regenMult = 1 - maxPenalty * ratio;
    return { goldMult, regenMult };
  }

  // Integration debt incurred per tile captured by conquest (raw land-grab is
  // dearer to KEEP than to take). Slightly higher in earlier Ages to model weak
  // administration; Modern empires absorb territory more readily.
  integrationDebtPerCapture(p: Player | PlayerView): number {
    return INTEGRATION_DEBT_PER_CAPTURE[p.age()] ?? 1.0;
  }

  // Integration debt a player can hold before penalties bite hard. Grows with
  // Cities (administrative capacity). Used by overextensionPenalty and the
  // frontier-revolt check.
  overextensionCapacity(p: Player | PlayerView): number {
    return (
      OVEREXTENSION_BASE_CAPACITY +
      p.units(UnitType.City).length * OVEREXTENSION_CAPACITY_PER_CITY
    );
  }

  // Small cumulative score gained per tick (from tiles + tech + structures).
  renownPerTick(p: Player | PlayerView): number {
    let r = RENOWN_PER_TILE * p.numTilesOwned();
    r += RENOWN_PER_TECH_POINT * p.techPoints();
    r += RENOWN_PER_STRUCTURE * p.units(...Structures.types).length;
    // Wonder prestige: steady renown per owned Wonder (gated unique-per-player).
    r += this.wonderRenownBonus() * p.units(UnitType.Wonder).length;
    return r;
  }

  // Renown awarded to the killer when a victim player is eliminated.
  renownOnKill(victim: Player | PlayerView): number {
    return (
      RENOWN_ON_KILL_BASE + RENOWN_ON_KILL_PER_TILE * victim.numTilesOwned()
    );
  }

  // Shared global doomsday launch budget (RoN Armageddon Clock).
  armageddonBudget(): number {
    return 12;
  }
}

// Indexed by Age (8 ages: Primitive..Alien). Cheaper early, dearer late.
const AGE_EXPANSION_COST_MULT = [0.6, 0.8, 0.95, 1.1, 1.3, 1.6, 2.0, 2.4];
// Indexed by Age. Faster regen early, slower late.
const AGE_TROOP_REGEN_MULT = [1.6, 1.35, 1.15, 1.0, 0.9, 0.8, 0.7, 0.6];
const BUILDING_UPKEEP_PER_TICK: Record<string, number> = {
  [UnitType.Factory]: 15,
  [UnitType.Airbase]: 25,
  [UnitType.MissileSilo]: 20,
  [UnitType.SAMLauncher]: 10,
  [UnitType.ArtilleryFort]: 8,
  [UnitType.Harbor]: 0, // income (handled elsewhere)
  [UnitType.DefensePost]: 2,
};

const ADVANCE_PENALTY_TICKS = 45 * 10; // ~45 seconds at 10 ticks/sec
const ERA_TRANSITION_COST_BPS = [15000, 12500, 10000, 9000, 8250];
const ERA_TRANSITION_DURATION_BPS = [15000, 12000, 10000, 8500, 7000];
const ERA_TRANSITION_PENALTY_BPS = [15000, 12000, 10000, 7000, 4000];

// Optional Triumph targets. Dominion asks for a stable realm rather than raw
// paint; Legacy is renown earned since entering the current era.
const ERA_DOMINION_TARGET = [140, 220, 320, 460, 640, 850, 1100, 1400];
const ERA_LEGACY_TARGET = [120, 250, 450, 750, 1200, 1800, 2600, 3600];

// Primitive migration capacity floor — SHARED by every player type (owner
// direction 2026-07-07: one carrying-capacity law). Actual roaming capacity
// grows from the population carrying-capacity first, then structure bonuses;
// population differences (human 25k vs bot 10k start) are what make human
// bands roam wider than tribes now, not a special-cased constant.
const PRIMITIVE_MIGRATION_BASE_CAPACITY = 110;
const PRIMITIVE_CAPACITY_PER_PALISADE = 18;
const PRIMITIVE_CAPACITY_PER_GRANARY = 35;
const PRIMITIVE_CAPACITY_PER_EON_SITE = 20;

// Coalition-against-the-leader (Module E) tuning. A coalition is a time-boxed
// pact the table forms against the dominant threat leader; members get a modest
// capped buff + mutual non-aggression. Kept small + abuse-resistant: only a
// genuine high-threat leader is a valid target, and the buffs are flat caps.
const COALITION_DURATION_TICKS = 90 * 10; // ~90 seconds at 10 ticks/sec
const COALITION_THREAT_THRESHOLD = 0.6; // target must be this dominant to be valid

// Cross-age combat multiplier, indexed by clampAgeDiff(attackerAge - defenderAge) + 3,
// i.e. [-3, -2, -1, 0, +1, +2, +3]. Higher age beats lower (obsolescence):
// ~+12% per age ahead, ~-10% per age behind, clamped at ±3 ages.
const AGE_COMBAT_MULT = [0.7, 0.8, 0.9, 1.0, 1.12, 1.24, 1.36];
const clampAgeDiff = (d: number): number => Math.max(-3, Math.min(3, d));

// Integration-debt digestion per tick by Age (Primitive chokes, late ages digest fast).
const INTEGRATION_THROUGHPUT_PER_TICK = [1.0, 1.5, 2.0, 2.75, 3.5, 4.25, 5.0];

// Integration debt added per captured tile by Age (Primitive over-grabber chokes,
// later ages absorb land more readily).
// Integration debt incurred per captured tile, indexed by RAW Age integer
// (Primitive..Alien). AI-NOTE: Classical inserted at index 1 — keep aligned with
// the Age enum. Classical (young kingdoms, weak central administration) holds raw
// land almost as dearly as a Primitive tribe (0.92); Imperial onward absorbs land
// progressively more readily. | evidence: tests/ClassicalEra.test.ts
const INTEGRATION_DEBT_PER_CAPTURE = [
  1.0, 0.92, 0.85, 0.7, 0.6, 0.5, 0.4, 0.35,
];

// Overextension capacity (debt the player can hold before penalties bite hard).
// Era-overhaul: penalty/revolt apply in the Primitive AND Classical (Kingdom)
// eras — a young kingdom that grabs too much land fractures (overextensionPenalty
// + the Classical civil-war secession). Imperial+ hold massive land freely.
const OVEREXTENSION_BASE_CAPACITY = 50;
const OVEREXTENSION_CAPACITY_PER_CITY = 25;
// Primitive bleed is mild (0.2 — a tribal flavor, never "nuke-first" optimal).
const OVEREXTENSION_MAX_PENALTY = 0.2; // up to ~20% income/regen reduction
// Classical (Kingdom) overextension bites HARDER — the "big internal dissent
// penalty" that makes a sprawling young kingdom buckle before it civil-wars.
const OVEREXTENSION_MAX_PENALTY_CLASSICAL = 0.4; // up to ~40% income/regen reduction

// Keystone structure required to advance OUT of each Age (Module B). Indexed by
// Age. Primitive→Classical is the permanent City (special-cased in
// meetsAdvanceCriteria), and Classical→Imperial gates on tech+gold only — so both
// are absent here.
const ADVANCE_KEYSTONE: Partial<Record<Age, UnitType>> = {
  [Age.Imperial]: UnitType.Harbor, // → Feudal
  [Age.Feudal]: UnitType.Wonder, // → Enlightened
  [Age.Enlightened]: UnitType.Factory, // → Industrial
  [Age.Industrial]: UnitType.Airbase, // → Modern
  [Age.Modern]: UnitType.EonSite, // → Alien
};

// attackTilesPerTick multiplier by Age (Primitive crawls; Modern/Alien sweep).
// Indexed by RAW Age integer (Primitive..Alien). AI-NOTE: Classical inserted at
// index 1 — keep aligned with the Age enum. Classical (0.38) conquers only a
// little faster than a Primitive tribe: a young kingdom has "limited ability to
// conquer" by design (overexpansion triggers civil war). | evidence: tests/ClassicalEra.test.ts
const ATTACK_TILES_PER_TICK_AGE_MULT = [
  0.25, 0.38, 0.45, 0.65, 0.85, 1.1, 1.4, 1.7,
];

// Renown accrual weights.
const RENOWN_PER_TILE = 0.001;
const RENOWN_PER_TECH_POINT = 0.0005;
const RENOWN_PER_STRUCTURE = 0.01;
const RENOWN_ON_KILL_BASE = 100;
const RENOWN_ON_KILL_PER_TILE = 0.5;
