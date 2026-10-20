/**
 * LoopVitals — the game loop's vital signs, not its wall-clock cost.
 *
 * FullGamePerf answers "is the sim fast enough". This answers the question that
 * actually decides whether the game is worth playing: does anything in a match
 * ever RESOLVE? It runs a full headless game on a production map and reports:
 *
 *   1. Time to the first elimination, and the elimination curve after it.
 *   2. Land changing hands between players (conquest) versus land claimed from
 *      nobody (colonisation). A match that is all colonisation has no contest.
 *   3. When unowned land runs out — the moment the map is forced to be contested.
 *   4. Concentration: what share the leader holds over time.
 *
 * Ownership is sampled on a stride so the diff stays cheap on a full map; the
 * conquest/colonisation split is therefore a consistent estimate over the same
 * sampled tiles, not an exact tile count. Reported as rates, which is what the
 * design question needs.
 *
 * Usage:
 *   npx tsx tests/perf/fullgame/LoopVitals.ts [--map world] [--ticks 12000]
 *                                             [--bots 133] [--every 200]
 */
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../../src/core/configuration/Config";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { createNationsForGame } from "../../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../../src/core/GameRunner";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../../../src/core/Schemas";
import { simpleHash } from "../../../src/core/Util";
import { NodeGameMapLoader } from "./NodeGameMapLoader";

const PROJECT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const TICKS_PER_SECOND = 10;

interface Options {
  map: GameMapType;
  size: GameMapSize;
  ticks: number;
  bots: number;
  every: number;
  stride: number;
  seed: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    map: GameMapType.World,
    size: GameMapSize.Normal,
    ticks: 12000,
    bots: 133,
    every: 200,
    stride: 7,
    seed: "vitals-1",
  };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--map":
        opts.map = next() as GameMapType;
        break;
      case "--size":
        opts.size =
          next().toLowerCase() === "compact"
            ? GameMapSize.Compact
            : GameMapSize.Normal;
        break;
      case "--ticks":
        opts.ticks = parseInt(next(), 10);
        break;
      case "--bots":
        opts.bots = parseInt(next(), 10);
        break;
      case "--every":
        opts.every = parseInt(next(), 10);
        break;
      case "--stride":
        opts.stride = parseInt(next(), 10);
        break;
      case "--seed":
        opts.seed = next();
        break;
    }
  }
  return opts;
}

const mmss = (ticks: number) => {
  const s = Math.floor(ticks / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

interface Sample {
  tick: number;
  alive: number;
  dead: number;
  ownedPct: number;
  leaderPct: number;
  conquered: number;
  colonised: number;
  maxAge: number;
  advanced: number;
  canAfford: number;
  richest: number;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {};

  const gameConfig: GameConfig = {
    gameMap: opts.map,
    gameMapSize: opts.size,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: opts.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  };
  const gameStart: GameStartInfo = {
    gameID: opts.seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };

  console.log(
    `LoopVitals: map=${opts.map}/${opts.size} bots=${opts.bots} ticks=${opts.ticks} ` +
      `(${mmss(opts.ticks)} of game time), sampling every ${opts.every} ticks`,
  );

  const config = new Config(gameConfig, null, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    gameConfig.gameMap,
    gameConfig.gameMapSize,
    mapLoader,
  );
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    0,
    random,
  );
  const game = createGame(
    [],
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  let fatal: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (gu) => {
      if ("errMsg" in gu) fatal = gu.errMsg;
    },
  );
  runner.init();

  let turn = 0;
  const tickOnce = (): boolean => {
    runner.addTurn({ turnNumber: turn++, intents: [] });
    return runner.executeNextTick() && fatal === undefined;
  };

  while (game.inSpawnPhase()) {
    if (turn > 5000) throw new Error("spawn phase never ended");
    if (!tickOnce()) throw new Error(`errored in spawn phase: ${fatal}`);
  }
  const spawnedAt = game.ticks();
  const spawned = game.allPlayers().filter((p: Player) => p.isAlive()).length;
  console.log(
    `Spawn phase ended at tick ${spawnedAt}: ${spawned} tribes alive.`,
  );

  // Sampled tile set — a fixed stride so every sample compares like for like.
  const tiles: number[] = [];
  for (let x = 0; x < game.width(); x += opts.stride) {
    for (let y = 0; y < game.height(); y += opts.stride) {
      const ref = game.ref(x, y);
      if (game.isLand(ref)) tiles.push(ref);
    }
  }
  console.log(
    `Sampling ${tiles.length} land tiles (stride ${opts.stride}) of ` +
      `${game.numLandTiles()} total.\n`,
  );

  let prevOwner = new Int32Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) prevOwner[i] = game.ownerID(tiles[i]);

  const samples: Sample[] = [];
  let firstDeathTick: number | null = null;
  let allLandClaimedTick: number | null = null;
  let peakAlive = spawned;

  console.log(
    "  time   alive  dead   land%  lead%   maxAge  advanced  canAfford  richestGold",
  );
  console.log(
    "  -----  -----  -----  -----  -----   ------  --------  ---------  -----------",
  );

  while (game.ticks() < opts.ticks) {
    if (!tickOnce()) {
      console.log(
        `\nGame ended or errored at tick ${game.ticks()}: ${fatal ?? "win"}`,
      );
      break;
    }
    if (game.ticks() % opts.every !== 0) continue;

    // AI-NOTE: allPlayers(), never players() — GameImpl.players() is ALREADY
    // filtered to the living, so a dead count derived from it is always zero and
    // the instrument can never see the thing it exists to measure | evidence:
    // 2026-08-03, a 9-minute run reported 0 deaths while alive fell by 438
    const players = game.allPlayers();
    const alive = players.filter((p: Player) => p.isAlive());
    const dead = players.length - alive.length;
    if (firstDeathTick === null && dead > 0) firstDeathTick = game.ticks();
    if (alive.length > peakAlive) peakAlive = alive.length;

    let owned = 0;
    let conquered = 0;
    let colonised = 0;
    const byOwner = new Map<number, number>();
    const next = new Int32Array(tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      const o = game.ownerID(tiles[i]);
      next[i] = o;
      if (o !== 0) {
        owned++;
        byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
      }
      const was = prevOwner[i];
      if (o !== was) {
        // From nobody to somebody is colonisation; somebody to somebody else is
        // the only movement that means two tribes actually fought over ground.
        if (was === 0 && o !== 0) colonised++;
        else if (was !== 0 && o !== 0) conquered++;
      }
    }
    prevOwner = next;

    const ownedPct = (owned / tiles.length) * 100;
    if (allLandClaimedTick === null && ownedPct >= 97) {
      allLandClaimedTick = game.ticks();
    }
    // Age progression: the Primitive era is MEANT to be sparse and roaming, so
    // territory is the wrong scoreboard for it. What matters is whether anyone
    // ever escapes it. Also counts who could even afford the toll.
    let maxAge = 0;
    let advanced = 0;
    let canAfford = 0;
    let richest = 0n;
    const tollGold = 8000n;
    for (const p of alive) {
      const age = p.age() as unknown as number;
      if (age > maxAge) maxAge = age;
      if (age > 0) advanced++;
      const g = p.gold();
      if (g >= tollGold) canAfford++;
      if (g > richest) richest = g;
    }

    let leader = 0;
    for (const n of byOwner.values()) if (n > leader) leader = n;
    const leaderPct = (leader / tiles.length) * 100;

    const minutes = opts.every / TICKS_PER_SECOND / 60;
    const sample: Sample = {
      tick: game.ticks(),
      alive: alive.length,
      dead,
      ownedPct,
      leaderPct,
      conquered: conquered / minutes,
      colonised: colonised / minutes,
      maxAge,
      advanced,
      canAfford,
      richest: Number(richest),
    };
    samples.push(sample);

    console.log(
      `  ${mmss(sample.tick).padStart(5)}  ` +
        `${String(sample.alive).padStart(5)}  ` +
        `${String(sample.dead).padStart(5)}  ` +
        `${sample.ownedPct.toFixed(1).padStart(5)}  ` +
        `${sample.leaderPct.toFixed(1).padStart(5)}   ` +
        `${String(sample.maxAge).padStart(6)}  ` +
        `${String(sample.advanced).padStart(8)}  ` +
        `${String(sample.canAfford).padStart(9)}  ` +
        `${sample.richest.toFixed(0).padStart(11)}`,
    );
  }

  // ── Verdict ──
  const last = samples[samples.length - 1];
  const totalConquered = samples.reduce((a, s) => a + s.conquered, 0);
  const totalColonised = samples.reduce((a, s) => a + s.colonised, 0);
  const contestShare =
    totalConquered + totalColonised > 0
      ? (totalConquered / (totalConquered + totalColonised)) * 100
      : 0;

  console.log("\n── VITALS ──────────────────────────────────────────────");
  console.log(`tribes at spawn:            ${peakAlive}`);
  console.log(
    `first elimination:          ${
      firstDeathTick === null
        ? `NEVER (within ${mmss(opts.ticks)})`
        : `${mmss(firstDeathTick)}`
    }`,
  );
  console.log(
    `eliminated by end:          ${last?.dead ?? 0} of ${peakAlive} ` +
      `(${(((last?.dead ?? 0) / peakAlive) * 100).toFixed(1)}%)`,
  );
  console.log(
    `all land claimed:           ${
      allLandClaimedTick === null
        ? `NOT within ${mmss(opts.ticks)} (ended at ${last?.ownedPct.toFixed(1)}%)`
        : mmss(allLandClaimedTick)
    }`,
  );
  console.log(
    `leader's share at end:      ${last?.leaderPct.toFixed(1) ?? "?"}% of land`,
  );
  console.log(
    `contested share of change:  ${contestShare.toFixed(1)}% ` +
      `(land taken FROM a tribe vs claimed from nobody)`,
  );
  const humanish = game
    .allPlayers()
    .filter((p: Player) => p.type() !== PlayerType.Bot);
  console.log(`non-bot players in run:     ${humanish.length}`);
  console.log("────────────────────────────────────────────────────────");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
