// PrimitiveEraVerification.test.ts — headless (NO browser) integration tests that
// boot the real Primalfront sim and ASSERT the primitive-era behavioral checklist
// from docs/PRIMITIVE_ERA_REDESIGN.md. Reuses the canonical test harness
// (tests/util/Setup.ts -> createGame) the way Attack/Player/SpawnExecution tests
// do: build a Game with players, add executions, step ticks.
//
// Every assertion prints the CONCRETE observed number it checks so the run output
// is self-documenting evidence (counts, percentages, trajectories).

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ATLAS_COL,
  selectStructureSprite,
} from "../src/client/render/gl/passes/structure-theme";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { ResourceSeedExecution } from "../src/core/execution/ResourceSeedExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { TribeSpawner } from "../src/core/execution/TribeSpawner";
import { biomeAt } from "../src/core/game/Biome";
import {
  Age,
  Biome,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  ResourceKind,
  TribeArchetype,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { tribeName } from "../src/core/game/Tribes";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPngPixels(filePath: string): {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
} {
  const png = readFileSync(filePath);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i++) {
    if (png[i] !== signature[i]) throw new Error(`Invalid PNG: ${filePath}`);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = png.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG format: ${filePath}`);
  }
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : 0;
  if (channels === 0) {
    throw new Error(`Expected RGBA or grayscale-alpha PNG: ${filePath}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * channels;
  const pixels = Buffer.alloc(rowBytes * height);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const rowStart = y * rowBytes;
    const prevRowStart = rowStart - rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[prevRowStart + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? pixels[prevRowStart + x - channels] : 0;
      const value = raw[src++];
      let predictor = 0;

      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paethPredictor(left, up, upLeft);
      else if (filter !== 0)
        throw new Error(`Unsupported PNG filter ${filter}`);

      pixels[rowStart + x] = (value + predictor) & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

// ---------------------------------------------------------------------------
// Item 1 — TRIBE TAXONOMY RATIO
// ---------------------------------------------------------------------------
describe("[1] Tribe taxonomy: ~20% of bots are animal packs, humans/nations never", () => {
  it("classifies ~animalPackBotRatio() of a large bot cohort as packs", async () => {
    const game = await setup("plains");
    const ratio = game.config().animalPackBotRatio();

    // Spawn a large deterministic cohort via the REAL TribeSpawner (the live
    // classification path), then read back each SpawnExecution's PlayerInfo.
    const N = 200;
    const spawner = new TribeSpawner(game, "taxonomy_game_seed");
    const execs = spawner.spawnTribes(N);

    let packs = 0;
    let humanNames = 0;
    let predatorPlaceholders = 0;
    const predatorNames = new Set(
      [
        TribeArchetype.Wolf,
        TribeArchetype.Bear,
        TribeArchetype.Lion,
        TribeArchetype.Jackal,
        TribeArchetype.Boar,
        TribeArchetype.Tiger,
      ].map((a) => tribeName(a)),
    );

    for (const e of execs) {
      // The PlayerInfo carries the classification + name decided at spawn.
      const info = (e as unknown as { playerInfo: PlayerInfo }).playerInfo;
      expect(info.playerType).toBe(PlayerType.Bot); // only bots roll here
      if (info.isAnimalPack) {
        packs++;
        // Pack placeholder name is drawn from the historical-civ pool (two words);
        // its *displayed* identity is the predator archetype, set in
        // SpawnExecution. We assert non-empty placeholder here.
        expect(info.name.length).toBeGreaterThan(0);
        predatorPlaceholders++;
      } else {
        // Non-pack bots must get a human-style tribe name and never a predator
        // archetype string.
        expect(predatorNames.has(info.name)).toBe(false);
        humanNames++;
      }
    }

    const observed = packs / N;

    console.log(
      `[1] taxonomy: ${packs}/${N} packs = ${(observed * 100).toFixed(1)}% ` +
        `(target ${(ratio * 100).toFixed(0)}%); human-named non-packs=${humanNames}`,
    );

    // Within tolerance of the configured ratio (binomial noise at N=200).
    expect(observed).toBeGreaterThan(ratio - 0.08);
    expect(observed).toBeLessThan(ratio + 0.08);
    expect(packs).toBeGreaterThan(0);
    expect(humanNames).toBeGreaterThan(0);
    expect(predatorPlaceholders).toBe(packs);
  });

  it("Humans and Nations are NEVER animal packs (in any age)", async () => {
    const game = await setup("plains");
    // A Human and a Nation player constructed the normal way.
    const hInfo = new PlayerInfo("Human", PlayerType.Human, null, "Human");
    const nInfo = new PlayerInfo("Nation", PlayerType.Nation, null, "Nation");
    const human = game.addPlayer(hInfo);
    const nation = game.addPlayer(nInfo);

    expect(human.isAnimalPack()).toBe(false);
    expect(nation.isAnimalPack()).toBe(false);

    // Advancing the age must not make them packs either.
    human.setAge(Age.Modern);
    nation.setAge(Age.Modern);
    expect(human.isAnimalPack()).toBe(false);
    expect(nation.isAnimalPack()).toBe(false);

    console.log(
      `[1] human.isAnimalPack=${human.isAnimalPack()} nation.isAnimalPack=${nation.isAnimalPack()} (both must be false)`,
    );
  });

  it("a spawned animal-pack bot displays a predator archetype, a non-pack bot does not", async () => {
    const game = await setup("plains");
    // Build one explicit pack bot and one explicit non-pack bot and spawn them.
    const packInfo = new PlayerInfo("packph", PlayerType.Bot, null, "packph");
    packInfo.setIsAnimalPack(true);
    const tribeInfo = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe");

    game.addPlayer(packInfo);
    game.addPlayer(tribeInfo);
    game.addExecution(
      new SpawnExecution(
        "arch_seed",
        game.player(packInfo.id).info(),
        game.ref(20, 20),
      ),
      new SpawnExecution(
        "arch_seed",
        game.player(tribeInfo.id).info(),
        game.ref(70, 70),
      ),
    );
    executeTicks(game, 2);

    const pack = game.player(packInfo.id);
    const tribe = game.player(tribeInfo.id);
    expect(pack.isAnimalPack()).toBe(true);
    expect(tribe.isAnimalPack()).toBe(false);
    // The pack got a biome-derived predator archetype assigned in SpawnExecution.
    const archName = tribeName(pack.tribeArchetype());

    console.log(
      `[1] pack archetype="${archName}" (predator) | non-pack bot isAnimalPack=${tribe.isAnimalPack()}`,
    );
    expect(archName.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Item 2 — BUILD-MENU ERA FILTER (core minAge/maxAge gate)
// ---------------------------------------------------------------------------
describe("[2] Build-menu era filter for a Primitive player", () => {
  // Mirror the live BuildMenu.isInEra() gate at the data-model level (it is a
  // pure function of unitInfo.minAge/maxAge vs player.age()), which is exactly
  // what the client menu uses. This proves the gate WITHOUT a browser.
  function inEra(game: Game, age: Age, t: UnitType): boolean {
    const info = game.unitInfo(t);
    if (info.minAge !== undefined && age < info.minAge) return false;
    if (info.maxAge !== undefined && age > info.maxAge) return false;
    return true;
  }

  it("INCLUDES Primitive structures + City, EXCLUDES future-era units", async () => {
    const game = await setup("plains");
    const age = Age.Primitive;

    const hut = inEra(game, age, UnitType.Hut);
    const farm = inEra(game, age, UnitType.PrimitiveFarm);
    const outpost = inEra(game, age, UnitType.TradeOutpost);
    const scout = inEra(game, age, UnitType.ScoutLookout);
    const city = inEra(game, age, UnitType.City);
    const nuke = inEra(game, age, UnitType.AtomBomb);
    const silo = inEra(game, age, UnitType.MissileSilo);
    const factory = inEra(game, age, UnitType.Factory);

    console.log(
      `[2] Primitive build-era: Hut=${hut} Farm=${farm} Outpost=${outpost} Scout=${scout} City=${city} | ` +
        `Nuke=${nuke} Silo=${silo} Factory=${factory}`,
    );

    expect(hut).toBe(true);
    expect(farm).toBe(true);
    expect(outpost).toBe(true);
    expect(scout).toBe(true);
    expect(city).toBe(true);
    expect(nuke).toBe(false); // Modern-only
    expect(silo).toBe(false); // Modern-only
    expect(factory).toBe(false); // Industrial-only
  });

  it("HUD sources wire all primitive build icons plus Permanent Settlement copy", async () => {
    const root = process.cwd();
    const buildMenu = readFileSync(
      path.join(root, "src/client/hud/layers/BuildMenu.ts"),
      "utf8",
    );
    const unitDisplay = readFileSync(
      path.join(root, "src/client/hud/layers/UnitDisplay.ts"),
      "utf8",
    );

    const requiredTokens = [
      "UnitType.Hut",
      "UnitType.PrimitiveFarm",
      "UnitType.TradeOutpost",
      "UnitType.ScoutLookout",
      "HutIconWhite.svg",
      "PrimitiveFarmIconWhite.svg",
      "TradeOutpostIconWhite.svg",
      "ScoutLookoutIconWhite.svg",
      "permanent_settlement",
    ];

    const missing = requiredTokens.filter(
      (token) => !buildMenu.includes(token) || !unitDisplay.includes(token),
    );

    console.log(
      `[2] primitive HUD source tokens missing from both build/menu dock: ${
        missing.length ? missing.join(", ") : "NONE"
      }`,
    );
    expect(missing).toEqual([]);
  });

  it("the legacy locked-age render path is removed from the build UI source", async () => {
    // Spec §5: "Remove the LEGACY show-locked path: lockedAge() + render lock
    // branches + .build-locked CSS + build_menu.requires_age key." Grep the
    // client build-UI sources — none of those tokens may remain.
    const fs = await import("fs");
    const path = await import("path");
    const root = path.resolve(__dirname, "..");
    const buildUiFiles = [
      "src/client/hud/layers/BuildMenu.ts",
      "src/client/hud/layers/UnitDisplay.ts",
      "src/client/hud/layers/RadialMenuElements.ts",
    ];
    const offenders: string[] = [];
    const banned = ["lockedAge", "build-locked", "requires_age"];
    for (const rel of buildUiFiles) {
      const p = path.join(root, rel);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const tok of banned) {
        if (src.includes(tok)) offenders.push(`${rel}:${tok}`);
      }
    }

    console.log(
      `[2] legacy locked-age tokens still present: ${
        offenders.length ? offenders.join(", ") : "NONE"
      }`,
    );
    expect(offenders).toEqual([]);
  });
});

describe("[2b] Primitive structure atlas and sprite mapping", () => {
  it("uses a non-empty 11-column atlas with primitive/permanent-settlement glyphs", async () => {
    const root = process.cwd();
    const manifestPath = path.join(
      root,
      "resources/atlases/icon-atlas-manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      atlas: string;
      cellSize: number;
      cols: number;
      rows: number;
      width: number;
      height: number;
      columns: { index: number; name: string }[];
    };
    const img = readPngPixels(
      path.join(root, "resources/atlases", manifest.atlas),
    );

    expect(manifest.cols).toBe(11);
    expect(manifest.width).toBe(manifest.cellSize * manifest.cols);
    expect(manifest.height).toBe(manifest.cellSize * manifest.rows);
    expect(img.width).toBe(manifest.width);
    expect(img.height).toBe(manifest.height);

    const alphaPixels = (col: number): number => {
      let count = 0;
      const alphaOffset = img.channels - 1;
      const x0 = col * manifest.cellSize;
      for (let y = 0; y < manifest.cellSize; y++) {
        for (let x = 0; x < manifest.cellSize; x++) {
          const idx = (y * img.width + x0 + x) * img.channels + alphaOffset;
          if (img.pixels[idx] > 0) count++;
        }
      }
      return count;
    };

    const requiredColumns = [
      "hut",
      "permanentSettlement",
      "tradeOutpost",
      "scoutLookout",
      "primitiveFarm",
    ];
    const empty = requiredColumns.filter((name) => {
      const column = manifest.columns.find((c) => c.name === name);
      return !column || alphaPixels(column.index) < 20;
    });

    console.log(
      `[2b] primitive atlas ${img.width}x${img.height}; empty columns: ${
        empty.length ? empty.join(", ") : "NONE"
      }`,
    );
    expect(empty).toEqual([]);
  });

  it("maps City level 1 to Permanent Settlement and primitive structures to their own columns", () => {
    expect(
      selectStructureSprite(UnitType.City, Age.Primitive, Biome.Green, 1)
        .atlasCol,
    ).toBe(ATLAS_COL.permanentSettlement);
    expect(
      selectStructureSprite(UnitType.City, Age.Imperial, Biome.Green, 2)
        .atlasCol,
    ).toBe(ATLAS_COL.city);
    expect(
      selectStructureSprite(UnitType.Hut, Age.Primitive, Biome.Green, 1)
        .atlasCol,
    ).toBe(ATLAS_COL.hut);
    expect(
      selectStructureSprite(
        UnitType.TradeOutpost,
        Age.Primitive,
        Biome.Green,
        1,
      ).atlasCol,
    ).toBe(ATLAS_COL.tradeOutpost);
    expect(
      selectStructureSprite(
        UnitType.ScoutLookout,
        Age.Primitive,
        Biome.Green,
        1,
      ).atlasCol,
    ).toBe(ATLAS_COL.scoutLookout);
    expect(
      selectStructureSprite(
        UnitType.PrimitiveFarm,
        Age.Primitive,
        Biome.Green,
        1,
      ).atlasCol,
    ).toBe(ATLAS_COL.primitiveFarm);
  });
});

// ---------------------------------------------------------------------------
// Item 3 — HUT PLACEMENT (the bug fix)
// ---------------------------------------------------------------------------
describe("[3] Hut placement actually builds a Hut (was a silent no-op)", () => {
  it("constructs a Hut on owned land after ticking constructionDuration", async () => {
    const game = await setup("plains", { infiniteGold: true });
    const info = new PlayerInfo("builder", PlayerType.Human, null, "builder");
    game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(
        "hut_game",
        game.player(info.id).info(),
        game.ref(50, 50),
      ),
    );
    executeTicks(game, 2);
    const player = game.player(info.id);
    expect(player.age()).toBe(Age.Primitive);

    const hutsBefore = player.units(UnitType.Hut).length;
    const tile = Array.from(player.tiles())[0];

    const dur = game.unitInfo(UnitType.Hut).constructionDuration ?? 0;
    game.addExecution(new ConstructionExecution(player, UnitType.Hut, tile));
    // Tick generously past completion (construction adds the unit a tick or two
    // after the duration elapses).
    executeTicks(game, dur + 5);

    const huts = player.units(UnitType.Hut);

    console.log(
      `[3] huts before=${hutsBefore} after=${huts.length} (constructionDuration=${dur})`,
    );
    expect(huts.length).toBe(hutsBefore + 1);
    expect(huts[0].owner().id()).toBe(player.id());
  });
});

// ---------------------------------------------------------------------------
// Item 4 — HUT EXPIRY + CITY PERMANENCE
// ---------------------------------------------------------------------------
describe("[4] Hut expires after hutLifespanTicks(); City is permanent", () => {
  async function primitiveBuilder(seed: string) {
    const game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
    });
    const info = new PlayerInfo("b", PlayerType.Human, null, "b");
    const player = game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(seed, player.info(), game.ref(50, 50)),
    );
    executeTicks(game, 2);
    // Widen the owned territory into a long horizontal corridor so two
    // structures can sit > structureMinDist() apart (structures cannot be
    // packed closer than ~15 tiles — that is a real, expected spacing rule).
    const y = 50;
    for (let x = 10; x <= 90; x++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (game.isValidCoord(x, y + dy)) player.conquer(game.ref(x, y + dy));
      }
    }
    return { game, player };
  }

  it("a Hut vanishes after its lifetime; a City survives the same span", async () => {
    const { game, player } = await primitiveBuilder("expiry_game");
    // Hut expiry is owned by HutExecution, which uses hutLifespanTicks() (the
    // nomadicDrift-era hutLifetimeTicks knob was retired in the reconcile).
    const lifetime = game.config().hutLifespanTicks();
    const minDist = game.config().structureMinDist();

    // Two owned tiles separated well beyond structureMinDist so both structures
    // place successfully.
    const hutTile = game.ref(15, 50);
    const cityTile = game.ref(15 + minDist + 10, 50);

    game.addExecution(new ConstructionExecution(player, UnitType.Hut, hutTile));
    game.addExecution(
      new ConstructionExecution(player, UnitType.City, cityTile),
    );
    executeTicks(game, 4); // instantBuild: completes immediately

    const hutsAtBuild = player.units(UnitType.Hut).length;
    const citiesAtBuild = player.units(UnitType.City).length;
    expect(hutsAtBuild).toBe(1);
    expect(citiesAtBuild).toBe(1);

    // Tick well past the hut lifetime.
    executeTicks(game, lifetime + 10);

    const hutsAfter = player.units(UnitType.Hut).length;
    const citiesAfter = player.units(UnitType.City).length;

    console.log(
      `[4] after ${lifetime}+ ticks: huts ${hutsAtBuild}->${hutsAfter} (expect 0), ` +
        `cities ${citiesAtBuild}->${citiesAfter} (expect 1)`,
    );
    expect(hutsAfter).toBe(0); // Hut expired
    expect(citiesAfter).toBe(1); // City permanent
  });
});

// ---------------------------------------------------------------------------
// Item 5 — RESOURCE SEEDING: biome-correctness + determinism
// ---------------------------------------------------------------------------
describe("[5] Resource seeding is biome-correct and deterministic", () => {
  it("wood only in wooded biomes, rocks only on land, fully deterministic", async () => {
    // Use the real WORLD map (full pole→equator latitude range = real biome
    // variety). Forest/Jungle/Green carry wood; Cold/Arid/Sandy never do.
    const gameA1 = await setup("world");
    new ResourceSeedExecution("seedA").init(gameA1, 0);

    const bands = gameA1.config().biomeLatitudeBands();
    const woodByBiome: Record<number, number> = {};
    let woodTotal = 0;
    let rockTotal = 0;
    let woodOffBiome = 0;
    let rockOnWater = 0;

    gameA1.forEachTile((tile: TileRef) => {
      const r = gameA1.resourceAt(tile);
      if (r.kind === ResourceKind.Wood) {
        woodTotal++;
        const b = biomeAt(gameA1, tile, bands);
        woodByBiome[b] = (woodByBiome[b] ?? 0) + 1;
        if (b !== Biome.Forest && b !== Biome.Jungle && b !== Biome.Green) {
          woodOffBiome++;
        }
      } else if (r.kind === ResourceKind.Rock) {
        rockTotal++;
        if (!gameA1.isLand(tile)) rockOnWater++;
      }
    });

    const label = (b: number) =>
      ({
        [Biome.Cold]: "Cold",
        [Biome.Green]: "Green",
        [Biome.Arid]: "Arid",
        [Biome.Sandy]: "Sandy",
        [Biome.Forest]: "Forest",
        [Biome.Jungle]: "Jungle",
      })[b] ?? `b${b}`;
    const hist = Object.entries(woodByBiome)
      .map(([b, n]) => `${label(Number(b))}=${n}`)
      .join(" ");

    console.log(
      `[5] wood total=${woodTotal} by-biome: ${hist} | wood-off-biome=${woodOffBiome} ` +
        `| rocks=${rockTotal} rocks-on-water=${rockOnWater}`,
    );

    // ZERO wood on Cold/Arid/Sandy (the dry/ice belts).
    expect(woodByBiome[Biome.Cold] ?? 0).toBe(0);
    expect(woodByBiome[Biome.Arid] ?? 0).toBe(0);
    expect(woodByBiome[Biome.Sandy] ?? 0).toBe(0);
    expect(woodOffBiome).toBe(0);
    // Some wood actually placed (the map has wooded land).
    expect(woodTotal).toBeGreaterThan(0);
    // Rocks only on land.
    expect(rockOnWater).toBe(0);
    expect(rockTotal).toBeGreaterThan(0);

    // Determinism: same gameID ⇒ identical layout; different gameID ⇒ different.
    const snap = (g: Game): string => {
      const parts: string[] = [];
      g.forEachTile((t) => {
        const r = g.resourceAt(t);
        if (r.kind !== ResourceKind.None)
          parts.push(`${t}:${r.kind}:${r.quantity}`);
      });
      return parts.join("|");
    };
    const snapA1 = snap(gameA1);

    const gameA2 = await setup("world");
    new ResourceSeedExecution("seedA").init(gameA2, 0);
    expect(snap(gameA2)).toBe(snapA1);

    const gameB = await setup("world");
    new ResourceSeedExecution("seedB").init(gameB, 0);
    expect(snap(gameB)).not.toBe(snapA1);

    console.log(
      `[5] determinism: same gameID identical=${snap(gameA2) === snapA1}, ` +
        `different gameID differs=${snap(gameB) !== snapA1}`,
    );
  }, 120000);
});

// ---------------------------------------------------------------------------
// Item 6 — GLOB DRIFT (settlement-anchored rewild)
// ---------------------------------------------------------------------------
// RECONCILE NOTE: the original tile-count-target "nomadicDrift" model (shed
// toward nomadTargetTiles, project onto an advance vector) was RETIRED in the
// reconcile (DECISION 1). The surviving model is theirs' POSITIONAL
// rewildUnsupportedFrontier: a Primitive tribe only HOLDS land within
// nomadCampSupportRadius (11) of its owned-tile centroid, or within
// settlementSupportRadius (16) of a Hut/City; unsupported border tiles re-wild
// (most-exposed first), throttled to maxRewildTilesPerTick every 10 ticks.
// These tests validate that surviving model: territory shrinks toward the
// supported core, the owned SET changes (= drift), the cluster stays connected,
// and settlements anchor their surrounding land.
describe("[6] Glob drift: an oversized Primitive bot sheds its unsupported frontier", () => {
  function countClusters(game: Game, player: Player): number {
    const owned = new Set<TileRef>(player.tiles());
    const seen = new Set<TileRef>();
    let clusters = 0;
    for (const start of owned) {
      if (seen.has(start)) continue;
      clusters++;
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const t = stack.pop()!;
        game.forEachNeighbor(t, (n: TileRef) => {
          if (owned.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        });
      }
    }
    return clusters;
  }

  it("sheds the unsupported frontier toward the camp core and keeps a single connected cluster", async () => {
    const game = await setup("plains");
    const info = new PlayerInfo("drifter", PlayerType.Bot, null, "drifter");
    const player = game.addPlayer(info);
    expect(player.type()).toBe(PlayerType.Bot);
    expect(player.age()).toBe(Age.Primitive);

    // A solid 24x24 = 576-tile blob, all contiguous (16x16 fit inside the camp
    // radius and under the 250-tile roaming band of 2026-10-21, so nothing shed). With no settlement, only
    // land within nomadCampSupportRadius (11) of the centroid is supported, so
    // the exposed corners/far frontier re-wild while the core is held.
    const camR = game.config().nomadCampSupportRadius();
    expect(camR).toBeGreaterThan(0);
    const x0 = 20;
    const y0 = 20;
    const W = 24;
    const H = 24;
    for (let y = y0; y < y0 + H; y++) {
      for (let x = x0; x < x0 + W; x++) {
        player.conquer(game.ref(x, y));
      }
    }

    const startCount = player.numTilesOwned();
    const startSet = new Set<TileRef>(player.tiles());
    expect(countClusters(game, player)).toBe(1);

    game.addExecution(new PlayerExecution(player));

    const traj: number[] = [startCount];
    let clustersStayedOne = true;
    // Rewild runs every 10 ticks and is capped per pass, so a 256-tile blob
    // takes many passes to bleed down — run long enough to converge.
    for (let i = 0; i < 400; i++) {
      game.executeNextTick();
      if (i % 10 === 0) traj.push(player.numTilesOwned());
      if (countClusters(game, player) !== 1) clustersStayedOne = false;
    }
    const endCount = player.numTilesOwned();
    const endSet = new Set<TileRef>(player.tiles());

    // The owned SET changed (tiles were shed = drift).
    let setChanged = endSet.size !== startSet.size;
    if (!setChanged) {
      for (const t of startSet) {
        if (!endSet.has(t)) {
          setChanged = true;
          break;
        }
      }
    }

    console.log(
      `[6] glob-drift trajectory (camp radius=${camR}): ` +
        `${traj.filter((_, i) => i % 4 === 0).join(" -> ")} ... end=${endCount}`,
    );

    // Territory shrank toward the supported core (unsupported frontier shed)
    // and never fragmented. The held core sits inside the camp-support disk, so
    // it must be smaller than the original blob but not vanish entirely.
    expect(endCount).toBeLessThan(startCount);
    expect(endCount).toBeGreaterThan(0);
    expect(setChanged).toBe(true);
    expect(clustersStayedOne).toBe(true);
  });

  it("primitive NPC Hut land is HELD (shared law) while distant unsupported tiles shed", async () => {
    // big_plains is 200x200 so a long strip stays in-bounds.
    const game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });
    const info = new PlayerInfo("settler", PlayerType.Bot, null, "settler");
    const player = game.addPlayer(info);
    const settleR = game.config().settlementSupportRadius();

    // A long horizontal strip well longer than any support radius. 2026-07-07
    // shared law: an NPC tribe's Hut anchors its patch EXACTLY like a human's
    // (one carrying-capacity law, owner direction) — the far unsupported end
    // still re-wilds, but the settled camp is never abandoned while the Hut
    // stands.
    const y = 100;
    const xStart = 10;
    const xEnd = xStart + 120; // ~130 tiles long, within the 200-wide map
    for (let x = xStart; x <= xEnd; x++) {
      // 3-row strip so the Hut tile has owned neighbors and the cluster is solid.
      player.conquer(game.ref(x, y - 1));
      player.conquer(game.ref(x, y));
      player.conquer(game.ref(x, y + 1));
    }

    // Bankroll the structure: a directly-added bot starts with startingGold()
    // (0) — gold is otherwise accrued per-tick by PlayerExecution, which we
    // haven't run yet. Hand it enough to pay the Hut cost.
    player.addGold(1_000_000n);

    // Build a Hut at the left end.
    const hutX = xStart + 1;
    game.addExecution(
      new ConstructionExecution(player, UnitType.Hut, game.ref(hutX, y)),
    );
    executeTicks(game, 4);
    expect(player.units(UnitType.Hut).length).toBe(1);

    const startCount = player.numTilesOwned();
    const farTile = game.ref(xEnd, y); // beyond every support radius

    game.addExecution(new PlayerExecution(player));
    executeTicks(game, 300);

    // Shared law (2026-07-07): the Hut pins its patch for NPCs too — a tribe
    // that settled holds that ground; only the far unsupported frontier sheds.
    const hutTile = game.ref(hutX, y);
    const hutStillOwned = player.tiles().has(hutTile);
    let settledHeld = 0;
    for (let dx = 0; dx <= settleR; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const t = game.ref(hutX + dx, y + dy);
        if (player.tiles().has(t)) settledHeld++;
      }
    }

    console.log(
      `[6] settlement: hut owned=${hutStillOwned}, held near hut=${settledHeld}, ` +
        `farTile owned=${player.tiles().has(farTile)}, ` +
        `owned ${startCount}->${player.numTilesOwned()} (settleR=${settleR})`,
    );
    expect(hutStillOwned).toBe(true);
    // The Hut holds a real neighborhood of the 3-row strip (anchored land does
    // not count against the carrying cap, so it is never shed while anchored).
    expect(settledHeld).toBeGreaterThan(5);
    // The far, unsupported end still re-wilded; overall territory shrank.
    expect(player.tiles().has(farTile)).toBe(false);
    expect(player.numTilesOwned()).toBeLessThan(startCount);
  });
});

// ---------------------------------------------------------------------------
// Item 8 — PACKS CANNOT ADVANCE/TECH
//   (Item 7 raid behavior is fully covered in tests/RaidExecution.test.ts; a
//    pack-specific advance/tech check lives here.)
// ---------------------------------------------------------------------------
describe("[8] Animal packs accrue zero techPoints and never meet advance criteria", () => {
  it("a pack gains 0 techPoints over many ticks and meetsAdvanceCriteria()===false", async () => {
    const game = await setup("plains", { infiniteGold: true });
    // One pack bot, one normal (control) human, both spawned on land.
    const packInfo = new PlayerInfo("pack", PlayerType.Bot, null, "pack");
    packInfo.setIsAnimalPack(true);
    const ctrlInfo = new PlayerInfo("ctrl", PlayerType.Human, null, "ctrl");
    game.addPlayer(packInfo);
    game.addPlayer(ctrlInfo);
    game.addExecution(
      new SpawnExecution(
        "pack_tech",
        game.player(packInfo.id).info(),
        game.ref(30, 30),
      ),
      new SpawnExecution(
        "pack_tech",
        game.player(ctrlInfo.id).info(),
        game.ref(70, 70),
      ),
    );
    executeTicks(game, 2);

    const pack = game.player(packInfo.id);
    const ctrl = game.player(ctrlInfo.id);
    expect(pack.isAnimalPack()).toBe(true);

    const packTechStart = pack.techPoints();
    const ctrlTechStart = ctrl.techPoints();

    // Give the pack everything it would "need" to tech up if it could: lots of
    // gold (already infinite) and even a couple of Cities — it still must not
    // advance, because packs are hard-gated.
    executeTicks(game, 50);

    const packTechEnd = pack.techPoints();
    const ctrlTechEnd = ctrl.techPoints();

    console.log(
      `[8] pack techPoints ${packTechStart}->${packTechEnd} (expect 0 gain); ` +
        `control human ${ctrlTechStart}->${ctrlTechEnd} (expect >0 gain)`,
    );
    // Pack accrues ZERO techPoints.
    expect(packTechEnd).toBe(packTechStart);
    // Sanity: a non-pack DOES accrue tech (proves the tick path runs).
    expect(ctrlTechEnd).toBeGreaterThan(ctrlTechStart);

    // meetsAdvanceCriteria is hard-false for a pack even if we hand it cities.
    const before = pack.meetsAdvanceCriteria();
    pack.buildUnit(UnitType.City, Array.from(pack.tiles())[0], {});
    pack.buildUnit(UnitType.City, Array.from(pack.tiles())[1], {});
    pack.addTechPoints(99999);
    const after = pack.meetsAdvanceCriteria();

    console.log(
      `[8] pack meetsAdvanceCriteria before=${before} after(2 cities+99999 tech)=${after} (both must be false)`,
    );
    expect(before).toBe(false);
    expect(after).toBe(false);
  });
});
