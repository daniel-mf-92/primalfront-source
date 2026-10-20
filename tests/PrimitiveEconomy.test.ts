import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { primitivePlayerVariability } from "../src/core/execution/PrimitiveSupport";
import {
  Biome,
  Game,
  PlayerInfo,
  PlayerType,
  TerrainType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Module §7/§11 — primitive conquest economy (no conquest-gold, slaves/sacrifice),
// population carrying-capacity, gappy repopulation, and mammoth-herd climate.

let game: Game;
beforeEach(async () => {
  game = await setup("plains");
});

describe("Mammoth herds — reward + ice-recession extinction", () => {
  test("mammoths are 50% more rewarding than a normal hunt", () => {
    expect(game.config().mammothHuntRewardMult()).toBeCloseTo(1.5, 5);
  });

  test("mammoth climate uses the unified ice clock and is monotonic", () => {
    const c = game.config();
    const melt = c.climateMeltTicks();
    expect(c.climateIceFractionAtTick(0)).toBeCloseTo(1, 5);
    expect(c.climateIceFractionAtTick(melt)).toBe(0);
    expect(c.climateIceFractionAtTick(melt + 5000)).toBe(0);
    // Same clock as Neanderthals/primitive economy; no separate extinction timer.
    const mid = c.climateIceFractionAtTick(melt / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(c.climateIceFractionAtTick(50)).toBeGreaterThanOrEqual(
      c.climateIceFractionAtTick(melt - 50),
    );
  });

  test("respawn is slow + herd count stays bounded wilderness", () => {
    const c = game.config();
    expect(c.mammothRespawnChancePerCheck()).toBeLessThan(0.25); // rarer than game
    expect(c.mammothBaseHerds(1_000_000)).toBeLessThanOrEqual(18); // capped
    expect(c.mammothBaseHerds(100)).toBeGreaterThanOrEqual(5); // a floor
  });
});

describe("Primitive conquest economy — slaves/sacrifice", () => {
  test("extermination is very intensive (steep ratio)", () => {
    expect(game.config().primitiveExterminationRatio()).toBeGreaterThanOrEqual(
      3,
    );
  });

  test("slaves scale with the exterminated tribe; convert to gold slowly", () => {
    const c = game.config();
    const small = c.slavesPerExtermination(1000, 10);
    const big = c.slavesPerExtermination(50000, 80);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
    // Conversion is a slow trickle (a fraction per tick), and gold per slave > 0.
    expect(c.slavesConvertedPerTick(1000)).toBeLessThan(1000);
    expect(c.slavesConvertedPerTick(1000)).toBeGreaterThan(0);
    expect(c.slavesConvertedPerTick(0)).toBe(0);
    expect(c.slaveGoldValue()).toBeGreaterThan(0n);
  });

  test("slaves pile: add/remove clamps at 0 and never negative", () => {
    const p = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot-slaves"),
    );
    expect(p.slaves()).toBe(0);
    p.addSlaves(100);
    expect(p.slaves()).toBe(100);
    expect(p.removeSlaves(30)).toBe(30);
    expect(p.slaves()).toBe(70);
    expect(p.removeSlaves(999)).toBe(70); // only what's there
    expect(p.slaves()).toBe(0);
    p.addSlaves(-50); // clamps, never negative
    expect(p.slaves()).toBe(0);
  });
});

describe("R13 — unified resource pool", () => {
  test("wood, fish and slaves all add into the ONE shared pool", () => {
    const p = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot-pool"),
    );
    expect(p.resources()).toBe(0);

    p.addWood(10);
    expect(p.resources()).toBe(10);
    p.addFish(5);
    expect(p.resources()).toBe(15);
    p.addSlaves(20);
    expect(p.resources()).toBe(35);
    p.addRocks(3);
    expect(p.resources()).toBe(38);
    p.addMeat(2);
    expect(p.resources()).toBe(40);

    // The per-kind aliases all surface the same unified total now.
    expect(p.wood()).toBe(40);
    expect(p.rocks()).toBe(40);
    expect(p.meat()).toBe(40);
    expect(p.fish()).toBe(40);
    expect(p.slaves()).toBe(40);

    // Removers draw from the same pile regardless of which one is called.
    expect(p.removeFish(15)).toBe(15);
    expect(p.resources()).toBe(25);
    expect(p.removeSlaves(25)).toBe(25);
    expect(p.resources()).toBe(0);
  });

  test("the single resources→gold conversion drains the unified pool", async () => {
    const p1 = new PlayerInfo("p1", PlayerType.Human, "p1", "p1");
    const g = await setup("plains", { infiniteTroops: true }, [p1]);
    const player = g.player("p1");
    player.conquer(g.ref(50, 50));
    // Fill the pool via a NON-wood adder to prove the conversion drains the
    // unified pile, not a wood-specific counter.
    player.addSlaves(100);
    const poolBefore = player.resources();
    const goldBefore = player.gold();
    expect(poolBefore).toBe(100);

    g.addExecution(new PlayerExecution(player));
    for (let i = 0; i < 6; i++) g.executeNextTick();

    expect(player.resources()).toBeLessThan(poolBefore); // unified pool drained
    expect(player.gold()).toBeGreaterThan(goldBefore); // gold minted once
  });
});

describe("Population carrying capacity caps territory", () => {
  test("cap grows with population (and is bounded for a fresh tribe)", () => {
    const c = game.config();
    const p = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot-cap"),
    );
    const capBefore = c.carryingCapacityTiles(p);
    // No settlements yet: cap = base + troops/popPerTile.
    expect(capBefore).toBe(
      c.carryingBaseTiles(p) + Math.floor(p.troops() / c.carryingPopPerTile()),
    );
    p.addTroops(10000);
    expect(c.carryingCapacityTiles(p)).toBeGreaterThan(capBefore);
  });

  test("primitive terrain tuning makes harsh land costly but resource-rich", () => {
    const c = game.config();
    expect(c.primitiveTerrainCapacityMult(TerrainType.Plains)).toBeGreaterThan(
      c.primitiveTerrainCapacityMult(TerrainType.Mountain),
    );
    expect(
      c.primitiveTerrainMigrationAttrition(TerrainType.Mountain),
    ).toBeGreaterThan(
      c.primitiveTerrainMigrationAttrition(TerrainType.Highland),
    );
    expect(c.rockMountainMult()).toBeGreaterThan(1);
    expect(c.iceAgeRockRichnessMult()).toBeGreaterThan(1);
  });

  test("primitive biome tuning makes snow, sand, and arid land less favorable", () => {
    const c = game.config();
    expect(c.primitiveBiomeCapacityMult(Biome.Green)).toBeGreaterThan(
      c.primitiveBiomeCapacityMult(Biome.Sandy),
    );
    expect(c.primitiveBiomeMigrationFavorability(Biome.Green)).toBeGreaterThan(
      c.primitiveBiomeMigrationFavorability(Biome.Arid),
    );
    expect(c.primitiveBiomeMigrationAttrition(Biome.Cold)).toBeGreaterThan(
      c.primitiveBiomeMigrationAttrition(Biome.Green),
    );
  });

  test("primitive player variability is deterministic and capped to five percent", () => {
    const p = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot-variance"),
    );
    for (const kind of ["capacity", "attrition", "favorability"] as const) {
      const factor = primitivePlayerVariability(p, kind);
      expect(factor).toBe(primitivePlayerVariability(p, kind));
      expect(factor).toBeGreaterThanOrEqual(0.95);
      expect(factor).toBeLessThanOrEqual(1.05);
    }
  });
});

describe("Gappy repopulation — low, land-scaled density", () => {
  test("floor < ceiling and density is deliberately sparse", () => {
    const c = game.config();
    expect(c.primitiveMinTribes()).toBeLessThan(c.primitiveMaxTribes());
    expect(c.primitiveTilesPerTribe()).toBeGreaterThan(1000); // gappy
    // Packs favour the extra-gappy wilderness (higher pack chance there).
    expect(c.primitiveRepopPackRatioWild()).toBeGreaterThan(
      c.primitiveRepopPackRatio(),
    );
  });
});
