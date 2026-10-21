import { biomeAt } from "../game/Biome";
import {
  Execution,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  SpawnArea,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { tribeForBiome } from "../game/Tribes";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { PlayerExecution } from "./PlayerExecution";
import { ensureStarterStand, wantsStarterStand } from "./StarterStand";
import { TribeExecution } from "./TribeExecution";
import { getSpawnTiles } from "./Util";

// Initial territory claim radius (tiles). Raised 4->9 (2026-07-02, owner
// direction: territories START larger) to match the raised Primitive carrying
// floor — ~250 tiles instead of ~50. Spawn-location VALIDATION stays at the
// default radius 4 so placement is no harder to find than before. Scaled down
// on tiny (test/micro) maps so a spawn never swallows a whole island.
function spawnClaimRadius(gm: GameMap): number {
  const minDim = Math.min(gm.width(), gm.height());
  return minDim >= 120 ? 9 : 4;
}

type Spawn = { center: TileRef; tiles: TileRef[] };

export class SpawnExecution implements Execution {
  private random: PseudoRandom;
  active: boolean = true;
  private mg: Game;
  private static readonly MAX_SPAWN_TRIES = 1_000;

  constructor(
    gameID: GameID,
    private playerInfo: PlayerInfo,
    public tile?: TileRef,
  ) {
    this.random = new PseudoRandom(
      simpleHash(playerInfo.id) + simpleHash(gameID),
    );
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    this.active = false;

    let player: Player | null = null;
    if (this.mg.hasPlayer(this.playerInfo.id)) {
      player = this.mg.player(this.playerInfo.id);
    } else {
      player = this.mg.addPlayer(this.playerInfo);
    }

    // Security: If random spawn is enabled, prevent players from re-rolling their spawn location
    if (this.mg.config().isRandomSpawn() && player.hasSpawned()) {
      return;
    }

    player.tiles().forEach((t) => player.relinquish(t));
    const spawn = this.getSpawn(this.tile);

    if (!spawn) {
      console.warn(`SpawnExecution: cannot spawn ${this.playerInfo.name}`);
      return;
    }

    spawn.tiles.forEach((t) => {
      player.conquer(t);
    });

    if (!player.hasSpawned()) {
      this.mg.addExecution(new PlayerExecution(player));
      if (player.type() === PlayerType.Bot) {
        this.mg.addExecution(new TribeExecution(player));
      }
    }

    player.setSpawnTile(spawn.center);

    // A fresh human tribe always has a wood stand within one short walk (see
    // StarterStand.ts). Seeded from this execution's own PseudoRandom, so every
    // lockstep peer places the same nodes.
    if (wantsStarterStand(this.mg, this.playerInfo.playerType)) {
      ensureStarterStand(this.mg, spawn.center, this.random, ticks);
    }

    // Module §1 taxonomy — ONLY animal-pack bots take a predator-tribe identity
    // (the biome flavor is kept for them: Cold→Wolf, Green→Bear, …). Normal
    // tribes (non-pack Bots, Humans, Nations) are NOT packs and show their
    // human tribe name, so they get no archetype here. `isAnimalPack` is set on
    // the PlayerInfo at classification time (TribeSpawner) / inherited on split
    // (TribeSplitExecution); Humans/Nations never roll, so this is pack-only.
    // Pure + deterministic: biomeAt is a function of (map, tile) only. `Game`
    // extends `GameMap`, so `this.mg` is the map argument.
    if (player.isAnimalPack()) {
      player.setTribeArchetype(
        tribeForBiome(
          biomeAt(this.mg, spawn.center, this.mg.config().biomeLatitudeBands()),
        ),
      );
    }

    if (
      this.mg.config().gameConfig().gameType === GameType.Singleplayer &&
      this.playerInfo.playerType === PlayerType.Human
    ) {
      // In singleplayer, spawn ends when player selects
      // a spawn location.
      this.mg.endSpawnPhase();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  private getSpawn(center?: TileRef): Spawn | undefined {
    if (center !== undefined) {
      const tiles = getSpawnTiles(
        this.mg,
        center,
        false,
        spawnClaimRadius(this.mg),
      );

      if (!tiles.length) {
        return;
      }

      return { center, tiles };
    }

    const spawnArea = this.getTeamSpawnArea();
    let tries = 0;

    while (tries < SpawnExecution.MAX_SPAWN_TRIES) {
      tries++;

      const center = this.randTile(spawnArea);

      if (
        !this.mg.isLand(center) ||
        this.mg.hasOwner(center) ||
        this.mg.isBorder(center)
      ) {
        continue;
      }

      const isOtherPlayerSpawnedNearby = this.mg
        .allPlayers()
        .filter((player) => player.id() !== this.playerInfo.id)
        .some((player) => {
          const spawnTile = player.spawnTile();

          if (spawnTile === undefined) {
            return false;
          }

          return (
            this.mg.manhattanDist(spawnTile, center) <
            this.mg.config().minDistanceBetweenPlayers()
          );
        });

      if (isOtherPlayerSpawnedNearby) {
        continue;
      }

      const tiles = getSpawnTiles(this.mg, center, true);
      if (!tiles) {
        // if some of the spawn tile is outside of the land, we want to find another spawn tile
        continue;
      }

      // Validated at the strict default radius; the actual CLAIM is the larger
      // spawn patch (invalid/owned tiles simply filtered out at the fringe).
      return {
        center,
        tiles: getSpawnTiles(this.mg, center, false, spawnClaimRadius(this.mg)),
      };
    }

    return;
  }

  private randTile(area?: SpawnArea): TileRef {
    if (area) {
      const x = this.random.nextInt(area.x, area.x + area.width);
      const y = this.random.nextInt(area.y, area.y + area.height);
      return this.mg.ref(x, y);
    }
    const x = this.random.nextInt(0, this.mg.width());
    const y = this.random.nextInt(0, this.mg.height());
    return this.mg.ref(x, y);
  }

  private getTeamSpawnArea(): SpawnArea | undefined {
    const player = this.mg.player(this.playerInfo.id);
    const team = player.team();
    if (team === null) {
      return undefined;
    }
    return this.mg.teamSpawnArea(team);
  }
}
