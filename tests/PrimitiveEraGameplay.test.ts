import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { PrimitiveMigrationExecution } from "../src/core/execution/PrimitiveMigrationExecution";
import {
  buildingAnchors,
  primitiveTerrainAdjustedCapacity,
} from "../src/core/execution/PrimitiveSupport";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  ResourceKind,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

function conquerBlock(
  game: Game,
  player: Player,
  startX: number,
  startY: number,
  width: number,
  height: number,
) {
  for (let y = startY; y < startY + height; y++) {
    for (let x = startX; x < startX + width; x++) {
      player.conquer(game.ref(x, y));
    }
  }
}

function setLandMagnitude(game: Game, magnitude: number) {
  game.forEachTile((tile) => {
    if (game.isLand(tile)) {
      game.map().setMagnitude(tile, magnitude);
    }
  });
}

function closestOwnedDistance(
  game: Game,
  player: Player,
  target: TileRef,
): number {
  let closest = Infinity;
  for (const tile of player.tiles()) {
    closest = Math.min(closest, game.manhattanDist(tile, target));
  }
  return closest;
}

function runExecution(game: Game, execution: PrimitiveMigrationExecution) {
  game.addExecution(execution);
  game.executeNextTick();
  game.executeNextTick();
}

function effectiveMigrationCapacity(game: Game, player: Player): number {
  const anchors =
    player.type() === PlayerType.Human
      ? buildingAnchors(player, game.map(), game.config())
      : [];
  return primitiveTerrainAdjustedCapacity(
    game.config().primitiveMigrationCapacity(player),
    player,
    game.map(),
    game.config(),
    anchors,
    game.ticks(),
  );
}

function distinctRowsNearLeadingEdge(game: Game, player: Player): number {
  let maxX = -Infinity;
  for (const tile of player.tiles()) {
    maxX = Math.max(maxX, game.x(tile));
  }
  const rows = new Set<number>();
  for (const tile of player.tiles()) {
    if (game.x(tile) >= maxX - 3) {
      rows.add(game.y(tile));
    }
  }
  return rows.size;
}

function territoryBounds(game: Game, player: Player) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const rowCounts = new Map<number, number>();
  for (const tile of player.tiles()) {
    const x = game.x(tile);
    const y = game.y(tile);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    rowCounts.set(y, (rowCounts.get(y) ?? 0) + 1);
  }
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    maxRowLength: Math.max(...rowCounts.values()),
    fillRatio: player.numTilesOwned() / ((maxX - minX + 1) * (maxY - minY + 1)),
  };
}

describe("Primitive Era gameplay", () => {
  test("migration moves the primitive blob toward a clicked target without free growth", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 10, 5);

    const target = game.ref(70, 42);
    const beforeTiles = player.numTilesOwned();
    const beforeDistance = closestOwnedDistance(game, player, target);

    runExecution(game, new PrimitiveMigrationExecution(player, target));

    // A blob under capacity may legitimately GROW into spare capacity while
    // roaming (capacity was raised 2026-07-02); the no-free-growth invariant
    // is the migration capacity itself, never exceeded.
    expect(player.numTilesOwned()).toBeLessThanOrEqual(
      Math.max(beforeTiles, effectiveMigrationCapacity(game, player)),
    );
    expect(player.numTilesOwned()).toBeLessThanOrEqual(
      effectiveMigrationCapacity(game, player),
    );
    expect(closestOwnedDistance(game, player, target)).toBeLessThan(
      beforeDistance,
    );
  });

  test("migration translates a compact blob instead of drawing a single-file trail", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 10, 5);

    const target = game.ref(120, 42);
    const beforeDistance = closestOwnedDistance(game, player, target);

    game.addExecution(new PrimitiveMigrationExecution(player, target));
    for (let i = 0; i < 80; i++) {
      game.executeNextTick();
    }

    expect(player.numTilesOwned()).toBe(
      effectiveMigrationCapacity(game, player),
    );
    expect(closestOwnedDistance(game, player, target)).toBeLessThan(
      beforeDistance,
    );
    expect(distinctRowsNearLeadingEdge(game, player)).toBeGreaterThanOrEqual(3);
  });

  test("migration heals small enclosed pockets instead of leaving donut holes", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 10, 5);

    // A near-sealed ring ahead of the blob (a resource-node donut in the
    // making): every neighbour of `hole` is ours except the gap the roam is
    // about to close. Sealing the gap must annex the pocket, never leave an
    // unowned enclave on the clicked resource (owner bug report 2026-07-02).
    const hole = game.ref(52, 42);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (dx === -1 && dy === 0) continue; // the gap
        player.conquer(game.ref(52 + dx, 42 + dy));
      }
    }
    expect(player.tiles().has(hole)).toBe(false);

    game.addExecution(
      new PrimitiveMigrationExecution(player, game.ref(70, 42)),
    );
    // The gap must be sealed AND the sealed pocket annexed — never left as an
    // unowned donut inside our land. With the faster nomadic roam (2026-07-04)
    // the tribe may later shed this whole trailing patch as it moves on; that is
    // fine. What must NEVER happen is an unowned tile ringed on all sides by our
    // territory. So assert the invariant every tick, and that the heal did fire.
    let healed = false;
    for (let i = 0; i < 40; i++) {
      game.executeNextTick();
      if (player.tiles().has(hole)) healed = true;
      let ring = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (player.tiles().has(game.ref(52 + dx, 42 + dy))) ring++;
        }
      }
      // No donut: the hole is never unowned while fully ringed by our tiles.
      expect(!player.tiles().has(hole) && ring === 8).toBe(false);
    }
    expect(healed).toBe(true);
  });

  test("off-axis migration keeps a compact patch instead of collapsing onto the clicked target line", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 10, 5);

    game.addExecution(
      new PrimitiveMigrationExecution(player, game.ref(120, 20)),
    );
    for (let i = 0; i < 100; i++) {
      game.executeNextTick();
    }

    const bounds = territoryBounds(game, player);
    const cap = effectiveMigrationCapacity(game, player);
    expect(player.numTilesOwned()).toBe(cap);
    // Compactness bounds scale with capacity (raised 2026-07-02): a compact
    // cap-sized patch has span ~sqrt(cap / fillRatio), not a fixed 18.
    // +2: integer-lattice slack — a cap-sized patch's bounding box can round
    // a couple of tiles past the ideal sqrt(cap/fillRatio) span.
    const maxSpan = Math.ceil(Math.sqrt(cap / 0.45)) + 2;
    expect(bounds.height).toBeGreaterThanOrEqual(4);
    expect(bounds.width).toBeLessThanOrEqual(maxSpan);
    expect(bounds.maxRowLength).toBeLessThanOrEqual(maxSpan);
    expect(bounds.fillRatio).toBeGreaterThanOrEqual(0.45);
  });

  test("primitive bot wilderness expansion uses migration instead of attack heartbeat", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      UseRealAttackLogic,
    );
    const info = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const bot = game.addPlayer(info);
    conquerBlock(game, bot, 40, 40, 10, 5);

    const behavior = new AiAttackBehavior(
      new PseudoRandom(7),
      game,
      bot,
      0.5,
      0.35,
      0.15,
    );
    expect(behavior.sendAttack(game.terraNullius())).toBe(true);

    game.executeNextTick();
    const target = bot.migrationTarget();
    expect(target).not.toBeNull();
    if (target === null) {
      throw new Error("expected primitive bot migration target");
    }
    expect(bot.outgoingAttacks()).toHaveLength(0);
    const distanceAfterStart = closestOwnedDistance(game, bot, target);

    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
    }

    expect(
      bot.tiles().has(target) ||
        closestOwnedDistance(game, bot, target) < distanceAfterStart,
    ).toBe(true);
    expect(bot.numTilesOwned()).toBe(effectiveMigrationCapacity(game, bot));
  });

  test("primitive nation wilderness expansion uses migration instead of old static growth", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      UseRealAttackLogic,
    );
    const info = new PlayerInfo("nation", PlayerType.Nation, null, "nation");
    const nation = game.addPlayer(info);
    conquerBlock(game, nation, 40, 40, 10, 5);

    const behavior = new AiAttackBehavior(
      new PseudoRandom(9),
      game,
      nation,
      0.5,
      0.35,
      0.15,
    );
    behavior.forceSendAttack(game.terraNullius());

    game.executeNextTick();
    const target = nation.migrationTarget();
    expect(target).not.toBeNull();
    expect(nation.outgoingAttacks()).toHaveLength(0);
    expect(nation.numTilesOwned()).toBeLessThanOrEqual(
      game.config().primitiveMigrationCapacity(nation),
    );
  });

  test("primitive bots keep the same basic roaming floor as humans after settling", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      UseRealAttackLogic,
    );
    const info = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const bot = game.addPlayer(info);
    bot.setTroops(600);
    // Seed ABOVE the roaming floor (capacity raised 2026-07-02) so the
    // shed-never-below-floor invariant is actually exercised on the way down.
    conquerBlock(game, bot, 34, 34, 16, 14);

    const base = effectiveMigrationCapacity(game, bot);
    game.addExecution(new PlayerExecution(bot));
    game.addExecution(new PrimitiveMigrationExecution(bot, game.ref(70, 42)));

    let minOwned = bot.numTilesOwned();
    // Bots roam on alternate ticks and advance as a compact face
    // (2026-07-02) — give the journey a proportionally longer window.
    for (let i = 0; i < 340; i++) {
      game.executeNextTick();
      minOwned = Math.min(minOwned, bot.numTilesOwned());
    }

    expect(bot.migrationTarget()).toBeNull();
    expect(minOwned).toBeGreaterThanOrEqual(base);
    expect(bot.numTilesOwned()).toBeGreaterThanOrEqual(base);
  });

  test("primitive bot encampment movement does not stack old Hut land behind the roam", async () => {
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      UseRealAttackLogic,
    );
    const info = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const bot = game.addPlayer(info);
    conquerBlock(game, bot, 40, 40, 8, 6);
    const hutTile = game.ref(43, 42);
    const oldCampTile = game.ref(41, 41);
    bot.buildUnit(UnitType.Hut, hutTile, {});

    const target = game.ref(110, 42);
    const startDistance = closestOwnedDistance(game, bot, target);

    game.addExecution(new PlayerExecution(bot));
    game.addExecution(new PrimitiveMigrationExecution(bot, target));
    for (let i = 0; i < 100; i++) {
      game.executeNextTick();
    }

    expect(closestOwnedDistance(game, bot, target)).toBeLessThan(startDistance);
    expect(bot.numTilesOwned()).toBeLessThanOrEqual(
      effectiveMigrationCapacity(game, bot),
    );
    expect(bot.tiles().has(oldCampTile)).toBe(false);
  });

  test("temporary settlement capacity allows migration growth", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    const centerY = Math.floor(game.height() / 2);
    conquerBlock(game, player, 40, centerY - 2, 10, 5);
    player.buildUnit(UnitType.Granary, game.ref(40, centerY), {});

    const target = game.ref(70, centerY);
    const beforeTiles = player.numTilesOwned();

    for (let i = 0; i < 4; i++) {
      runExecution(game, new PrimitiveMigrationExecution(player, target));
    }

    expect(effectiveMigrationCapacity(game, player)).toBeGreaterThan(
      beforeTiles,
    );
    expect(player.numTilesOwned()).toBeGreaterThan(beforeTiles);
    expect(player.numTilesOwned()).toBeLessThanOrEqual(
      effectiveMigrationCapacity(game, player),
    );
  });

  test("integration debt digestion does not rewild primitive frontier tiles", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 12, 10);
    player.setIntegrationDebt(500);

    const beforeTiles = player.numTilesOwned();
    game.addExecution(new PlayerExecution(player));
    game.executeNextTick();
    game.executeNextTick();

    expect(player.numTilesOwned()).toBe(beforeTiles);
    expect(player.integrationDebt()).toBeLessThan(500);
  });

  test("a newer migration click supersedes the older one (no tug-of-war)", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 10, 5);

    const east = game.ref(78, 42);
    const west = game.ref(8, 42);

    // The passive rewild runs alongside migration in real games — register it so
    // the test exercises the true co-running scenario (it must defer, not shear).
    game.addExecution(new PlayerExecution(player));

    // Start roaming EAST.
    const toEast = new PrimitiveMigrationExecution(player, east);
    game.addExecution(toEast);
    for (let i = 0; i < 6; i++) {
      game.executeNextTick();
    }
    const westDistAfterEast = closestOwnedDistance(game, player, west);

    // Now click WEST — this must SUPERSEDE the eastward roam, not stack with it.
    const toWest = new PrimitiveMigrationExecution(player, west);
    game.addExecution(toWest);
    // More ticks than the pre-2026-07-02 tuning: an under-capacity blob spends
    // its first ticks GROWING with heading inertia before the westward
    // translation shows up in closest-owned distance.
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
    }

    // Only the newest destination drives the tribe; the stale eastward execution
    // stepped aside.
    expect(player.migrationTarget()).toBe(west);
    expect(toEast.isActive()).toBe(false);
    // The blob actually moved toward the new (west) target.
    expect(closestOwnedDistance(game, player, west)).toBeLessThan(
      westDistAfterEast,
    );
    // Still capacity-bound: growth into spare capacity is allowed (raised cap
    // 2026-07-02), but never beyond it, and the co-running rewild did not
    // shear the roaming blob.
    expect(player.numTilesOwned()).toBeLessThanOrEqual(
      effectiveMigrationCapacity(game, player),
    );
  });

  test("a reverse migration click keeps a little previous heading inertia", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    conquerBlock(game, player, 40, 40, 10, 5);

    const east = game.ref(90, 42);
    const west = game.ref(8, 42);
    game.addExecution(new PrimitiveMigrationExecution(player, east));
    for (let i = 0; i < 12; i++) {
      game.executeNextTick();
    }
    expect(player.migrationHeading()?.x ?? 0).toBeGreaterThan(0);

    game.addExecution(new PrimitiveMigrationExecution(player, west));
    game.executeNextTick();
    expect(player.migrationHeading()?.x ?? 0).toBeGreaterThan(0);

    for (let i = 0; i < 4; i++) {
      game.executeNextTick();
    }
    expect(player.migrationHeading()?.x ?? 0).toBeLessThan(0);
  });

  test("harsh terrain shrinks primitive roaming capacity and costs population", async () => {
    const plainsInfo = new PlayerInfo("plains", PlayerType.Human, null, "p");
    const plains = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [plainsInfo],
      undefined,
      UseRealAttackLogic,
    );
    const plainsPlayer = plains.player(plainsInfo.id);
    plainsPlayer.setTroops(20_000);
    conquerBlock(plains, plainsPlayer, 40, 40, 10, 5);
    plains.addExecution(
      new PrimitiveMigrationExecution(plainsPlayer, plains.ref(120, 42)),
    );
    // Longer run (capacity raised 2026-07-02): the blob must actually REACH
    // its cap before terrain differentiation is observable.
    for (let i = 0; i < 260; i++) {
      plains.executeNextTick();
    }

    const mountainInfo = new PlayerInfo(
      "mountain",
      PlayerType.Human,
      null,
      "m",
    );
    const mountain = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [mountainInfo],
      undefined,
      UseRealAttackLogic,
    );
    setLandMagnitude(mountain, 24);
    const mountainPlayer = mountain.player(mountainInfo.id);
    mountainPlayer.setTroops(20_000);
    conquerBlock(mountain, mountainPlayer, 40, 40, 10, 5);
    mountain.setResource(mountain.ref(52, 42), ResourceKind.Rock, 20);
    mountain.addExecution(
      new PrimitiveMigrationExecution(mountainPlayer, mountain.ref(120, 42)),
    );
    for (let i = 0; i < 260; i++) {
      mountain.executeNextTick();
    }

    // With the raised terrain-independent population floor (2026-07-02), both
    // blobs can settle on the same floor tile-count — the terrain squeeze is
    // asserted on the terrain-adjusted roaming capacity itself, plus the
    // population cost of harsh ground.
    expect(
      effectiveMigrationCapacity(mountain, mountainPlayer),
    ).toBeLessThanOrEqual(effectiveMigrationCapacity(plains, plainsPlayer));
    expect(mountainPlayer.numTilesOwned()).toBeLessThanOrEqual(
      plainsPlayer.numTilesOwned(),
    );
    expect(mountainPlayer.troops()).toBeLessThan(plainsPlayer.troops());
  });

  test("a primitive human's blob is never shorn below its migration capacity", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    // Low troops → the raw population carrying-cap sits below the migration
    // capacity floor. Seed a compact blob ABOVE the floor (capacity raised
    // 2026-07-02) so it must ease DOWN to the floor without dipping below.
    player.setTroops(600);
    conquerBlock(game, player, 40, 40, 15, 14);

    const startOwned = player.numTilesOwned();
    const base = effectiveMigrationCapacity(game, player);
    game.addExecution(new PlayerExecution(player));
    // Run several rewild boundaries (ticks % 10 === 0) with NO active migration.
    // A Primitive human settles GENTLY (a few tiles/tick) rather than snap-shedding
    // the whole overage at once. 2026-07-07 shared-law spec: capacity is
    // POPULATION-driven, and troops regenerate during the run — so the blob
    // eases DOWN while over-cap, then stabilises the moment the growing
    // population legitimately supports the remaining land. It must shed while
    // over-cap and must NEVER dip below the migration-capacity floor.
    let minOwned = player.numTilesOwned();
    for (let i = 0; i < 320; i++) {
      game.executeNextTick();
      minOwned = Math.min(minOwned, player.numTilesOwned());
    }

    // Shed happened (the over-cap seed blob contracted)…
    expect(player.numTilesOwned()).toBeLessThan(startOwned);
    // …the settle point is supported by the (regen-grown) population cap…
    expect(player.numTilesOwned()).toBeLessThanOrEqual(
      effectiveMigrationCapacity(game, player) + 5,
    );
    // …and it was never shorn below the migration-capacity floor on the way.
    expect(minOwned).toBeGreaterThanOrEqual(base);
  });

  test("the Hut anchors a larger hold-radius than any other building", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const c = game.config();
    const hut = c.buildingSupportRadius(UnitType.Hut);
    // The Hut is the Primitive era's dedicated land-holder, so it must out-reach
    // every other building (else there is no reason to build one).
    for (const type of [
      UnitType.City,
      UnitType.PrimitiveFarm,
      UnitType.TradeOutpost,
      UnitType.ScoutLookout,
    ]) {
      expect(hut).toBeGreaterThan(c.buildingSupportRadius(type));
    }
  });

  test("roaming away from a Hut keeps the Hut's anchored land (held by buildings, not by moving)", async () => {
    const info = new PlayerInfo("player", PlayerType.Human, null, "player");
    const game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      undefined,
      UseRealAttackLogic,
    );
    const player = game.player(info.id);
    // A home camp with a Hut planted in it.
    conquerBlock(game, player, 40, 40, 8, 6);
    const hutTile = game.ref(43, 42);
    player.buildUnit(UnitType.Hut, hutTile, {});
    // A home tile snug to the Hut. With the OLD roam (trim the tile farthest from
    // the target, ignoring settlements) this would be the FIRST land shed as the
    // band marched east. It must now survive — the Hut holds it.
    const homeTile = game.ref(41, 41);
    expect(player.tiles().has(homeTile)).toBe(true);

    const target = game.ref(110, 42);
    const startDist = closestOwnedDistance(game, player, target);

    game.addExecution(new PrimitiveMigrationExecution(player, target));
    for (let i = 0; i < 80; i++) {
      game.executeNextTick();
    }

    // The roving band actually marched toward the far target...
    expect(closestOwnedDistance(game, player, target)).toBeLessThan(startDist);
    // ...yet the Hut and its anchored home patch are STILL held — moving did not
    // trade them away (the old "attrition" feel).
    expect(player.tiles().has(hutTile)).toBe(true);
    expect(player.tiles().has(homeTile)).toBe(true);
    // Anchored land rides ON TOP of the roving cap, so the tribe holds more than the
    // bare migration capacity — the held home patch plus the fixed-size roving band.
    expect(player.numTilesOwned()).toBeGreaterThan(
      game.config().primitiveMigrationBaseCapacity(),
    );
  });
});
