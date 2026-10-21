import { expect, test } from "vitest";
import { HutExecution } from "../src/core/execution/HutExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  primitiveTerrainAdjustedCapacity,
  primitiveTerrainCapacityScale,
} from "../src/core/execution/PrimitiveSupport";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// Coverage for the ice-age climate clock + climate-tightened carrying capacity +
// hut seizure mechanics (docs/ICE_AGE_ECONOMY.md §B; owner-directed 2026-06-16).
// Layered on top of master's §7 population carrying-capacity.

test("climate clock: ice fraction + mults recede with game.ticks()", async () => {
  const p = new PlayerInfo("p", PlayerType.Bot, null, "p");
  const game = await setup("plains", {}, [p]);
  const config = game.config();

  expect(config.climateIceFraction(game)).toBeCloseTo(1, 5);
  expect(config.climateBuildCostMult(game)).toBeCloseTo(1.5, 5);
  // 8x under full ice is the Stone Age exit clock (see the AI-NOTE on
  // climateSettlementCostMult): a 2x ramp let the first tribe leave at 7:40.
  expect(config.climateSettlementCostMult(game)).toBeCloseTo(8, 5);
  expect(config.climateLandScale(game)).toBeCloseTo(0.6, 5);

  // Tick-based variant (used by the render overlay) matches the game-based one,
  // and the pole reach keeps a central equatorial band ice-free.
  expect(config.climateIceFractionAtTick(0)).toBeCloseTo(1, 5);
  expect(config.climateIceFractionAtTick(game.ticks())).toBe(
    config.climateIceFraction(game),
  );
  expect(config.climateIcePoleReach()).toBeGreaterThan(0.2);
  expect(config.climateIcePoleReach()).toBeLessThan(0.5); // equator stays ice-free
  expect(config.climateIceExtentAtTick(0)).toBeCloseTo(
    config.climateIcePoleReach(),
    5,
  );

  const north = game.ref(Math.floor(game.width() / 2), 1);
  const south = game.ref(Math.floor(game.width() / 2), game.height() - 2);
  const center = game.ref(
    Math.floor(game.width() / 2),
    Math.floor(game.height() / 2),
  );
  expect(config.climateTileIceFractionAtTick(game.map(), north, 0)).toBe(1);
  expect(config.climateTileIceFractionAtTick(game.map(), south, 0)).toBe(1);
  expect(config.climateTileIceFractionAtTick(game.map(), center, 0)).toBe(0);

  const melt = config.climateMeltTicks();
  expect(config.climateIceExtentAtTick(melt / 2)).toBeLessThan(
    config.climateIceExtentAtTick(0),
  );
  while (game.ticks() <= melt) game.executeNextTick();
  expect(config.climateIceFraction(game)).toBe(0);
  expect(config.climateIceFractionAtTick(melt)).toBe(0);
  expect(config.climateTileIceFractionAtTick(game.map(), north, melt)).toBe(0);
  expect(config.climateBuildCostMult(game)).toBe(1);
  expect(config.climateSettlementCostMult(game)).toBe(1);
  expect(config.climateLandScale(game)).toBe(1);
});

test("climate clock: ice sheet front is warped, not a straight latitude line", async () => {
  const p = new PlayerInfo("p", PlayerType.Bot, null, "p");
  const game = await setup("big_plains", {}, [p]);
  const config = game.config();
  const sampleXs: number[] = [];
  for (let i = 0; i < 18; i++) {
    sampleXs.push(Math.floor(((i + 0.5) * game.width()) / 18));
  }

  let mixedFrontRow = false;
  for (let y = 1; y < Math.floor(game.height() / 2); y++) {
    const strengths = sampleXs.map((x) =>
      config.climateTileIceFractionAtTick(game.map(), game.ref(x, y), 0),
    );
    const frozen = strengths.some((ice) => ice > 0.55);
    const clear = strengths.some((ice) => ice === 0);
    if (frozen && clear) {
      mixedFrontRow = true;
      break;
    }
  }

  expect(mixedFrontRow).toBe(true);
});

test("climate clock: a Hut costs 1.5× under full ice and 1× once receded", async () => {
  const p = new PlayerInfo("p", PlayerType.Bot, null, "p");
  const game = await setup("plains", {}, [p]);
  const player = game.player("p");
  const hutInfo = game.unitInfo(UnitType.Hut);

  const iceCost = Number(hutInfo.cost(game, player));
  expect(iceCost).toBe(Math.floor(1.5 * game.config().hutCost()));

  const melt = game.config().climateMeltTicks();
  while (game.ticks() <= melt) game.executeNextTick();
  const thawCost = Number(hutInfo.cost(game, player));
  expect(thawCost).toBe(game.config().hutCost());
  expect(thawCost).toBeLessThan(iceCost); // prices come DOWN as the ice recedes
});

test("carrying capacity: the ice age tightens the §7 cap, thawing open over time", async () => {
  const bot = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
  const config = game.config();
  const tribe = game.player("tribe");
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) tribe.conquer(game.ref(50 + dx, 50 + dy));
  }

  const base = config.carryingCapacityTiles(tribe);
  const capIce = Math.floor(base * config.climateLandScale(game)); // tick 0
  const melt = config.climateMeltTicks();
  while (game.ticks() <= melt) game.executeNextTick();
  const capThaw = Math.floor(base * config.climateLandScale(game)); // receded

  expect(capIce).toBeLessThan(capThaw); // tight early, opens up over time
  expect(capThaw).toBe(base); // full cap once the ice is gone
});

test("carrying capacity: icy territory itself thaws open tile-by-tile", async () => {
  const bot = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe");
  const game = await setup("big_plains", { infiniteTroops: true }, [bot]);
  const config = game.config();
  const tribe = game.player("tribe");
  // Deep inside the polar sheet: iced at the start, feathering at half melt.
  const sampleY = Math.max(2, Math.floor(game.height() * 0.08));
  const sampleX = Math.floor(game.width() / 2);
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      tribe.conquer(game.ref(sampleX + dx, sampleY + dy));
    }
  }

  const scaleIce = primitiveTerrainCapacityScale(
    tribe,
    game.map(),
    config,
    [],
    0,
  );
  const melt = config.climateMeltTicks();
  // The sheet's edge is warped per column, so "half melt" is not guaranteed to
  // be half-thawed at this row. Find the first tick where the row is in the
  // feather (0 < ice < 1) and sample there.
  const sampleTile = game.ref(sampleX, sampleY);
  let midTick = 0;
  for (let t = 0; t <= melt; t += 50) {
    const ice = config.climateTileIceFractionAtTick(game.map(), sampleTile, t);
    if (ice > 0 && ice < 1) {
      midTick = t;
      break;
    }
  }
  expect(midTick).toBeGreaterThan(0);
  const scaleMid = primitiveTerrainCapacityScale(
    tribe,
    game.map(),
    config,
    [],
    midTick,
  );
  const scaleThaw = primitiveTerrainCapacityScale(
    tribe,
    game.map(),
    config,
    [],
    melt,
  );

  // The unclamped per-tile scale (the carrying floor hides small differences
  // on a 35-tile tribe) opens up as the sheet passes over the rows.
  expect(scaleIce).toBeLessThan(scaleMid);
  expect(scaleMid).toBeLessThan(scaleThaw);
  expect(
    primitiveTerrainAdjustedCapacity(
      config.carryingCapacityTiles(tribe),
      tribe,
      game.map(),
      config,
      [],
      melt,
    ),
  ).toBeGreaterThanOrEqual(
    primitiveTerrainAdjustedCapacity(
      config.carryingCapacityTiles(tribe),
      tribe,
      game.map(),
      config,
      [],
      0,
    ),
  );
});

test("hut seizure: animal pack razes instantly, Neanderthal does not", async () => {
  const tribeInfo = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe");
  const packInfo = new PlayerInfo("pack", PlayerType.Bot, null, "pack");
  packInfo.setIsAnimalPack(true);
  const neaInfo = new PlayerInfo("nea", PlayerType.Bot, null, "nea");
  neaInfo.setIsNeanderthal(true);
  const game = await setup("big_plains", { infiniteTroops: true }, [
    tribeInfo,
    packInfo,
    neaInfo,
  ]);
  const tribe = game.player("tribe");
  const pack = game.player("pack");
  const nea = game.player("nea");
  tribe.addGold(200_000n);

  const buildHut = (x: number, y: number) => {
    const t = game.ref(x, y);
    tribe.conquer(t);
    const hut = tribe.buildUnit(UnitType.Hut, t, {});
    const exec = new HutExecution(hut);
    game.addExecution(exec);
    return { hut, t };
  };

  const packHut = buildHut(50, 50);
  const neaHut = buildHut(70, 70);
  game.addExecution(new PlayerExecution(tribe));
  game.executeNextTick(); // init
  game.executeNextTick(); // first tick → anchor lifespans

  pack.conquer(packHut.t);
  nea.conquer(neaHut.t);
  game.executeNextTick(); // capture → seizure response
  game.executeNextTick();

  expect(packHut.hut.isActive()).toBe(false); // animal pack razes it instantly
  expect(neaHut.hut.isActive()).toBe(true); // Neanderthal only accelerates decay
});
