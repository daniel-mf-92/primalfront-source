import { Config } from "../src/core/configuration/Config";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { TribeSpawner } from "../src/core/execution/TribeSpawner";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

// Module §7 — Neanderthal tribes: a primitive NPC people that booms early then
// goes extinct by the end of the Primitive era (no money → no advance, mammoth
// boom/bust, escalating climate attrition, admixture absorption).

function makeConfig(): Config {
  const gameConfig = {
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
  } as unknown as GameConfig;
  return new TestConfig(gameConfig, new UserSettings(), false);
}

function neanderthalInfo(name = "neander"): PlayerInfo {
  const info = new PlayerInfo(name, PlayerType.Bot, null, name);
  info.setIsNeanderthal(true);
  return info;
}

describe("Neanderthal — config curves (the boom-bust mechanic)", () => {
  const config = makeConfig();

  test("mammoth abundance is the unified ice clock", () => {
    const melt = config.climateMeltTicks();
    expect(config.climateIceFractionAtTick(0)).toBeCloseTo(1, 5);
    expect(config.climateIceFractionAtTick(melt / 2)).toBeCloseTo(0.5, 4);
    expect(config.climateIceFractionAtTick(melt)).toBe(0);
    expect(config.climateIceFractionAtTick(melt * 2)).toBe(0); // clamped, never negative
  });

  test("regen multiplier booms with abundance, collapses without it", () => {
    const peak = config.neanderthalRegenMult(1);
    const bust = config.neanderthalRegenMult(0);
    expect(peak).toBeGreaterThan(1); // boom while herds last
    expect(bust).toBeLessThan(1); // collapse once hunted out
    expect(bust).toBeGreaterThanOrEqual(0); // never negative
    // Monotonic in abundance.
    expect(config.neanderthalRegenMult(0.5)).toBeGreaterThan(bust);
    expect(config.neanderthalRegenMult(0.5)).toBeLessThan(peak);
  });

  test("climate attrition is zero under ice, then escalates as ice recedes", () => {
    const fullIce = config.neanderthalAttritionForIce(1);
    const mostlyIce = config.neanderthalAttritionForIce(0.9);
    const midThaw = config.neanderthalAttritionForIce(0.5);
    const receded = config.neanderthalAttritionForIce(0);

    expect(fullIce).toBe(0);
    expect(mostlyIce).toBeLessThan(0.01);
    expect(midThaw).toBeGreaterThan(mostlyIce);
    expect(receded).toBeGreaterThan(midThaw);
    expect(receded).toBeCloseTo(config.neanderthalMaxAttritionFraction(), 5);
    // Convex (slow-start) ramp: midpoint is below the linear halfway point.
    expect(midThaw).toBeLessThan(receded / 2);
  });

  test("the unified climate clock is in the Primitive-escape window", () => {
    // Sanity on the timing intent: mammoths/Neanderthals do not collapse instantly.
    expect(config.climateMeltTicks()).toBeGreaterThanOrEqual(1800); // >=3 min @10Hz
    expect(config.neanderthalRegenMult(1)).toBeGreaterThan(1);
    expect(config.neanderthalRegenMult(0)).toBeLessThan(1);
    expect(config.neanderthalAttritionForIce(0.9)).toBeLessThan(
      config.neanderthalAttritionForIce(0.2),
    );
  });
});

describe("Neanderthal — starting population (most of any tribe)", () => {
  const config = makeConfig();

  test("Neanderthals start with strictly more than a normal bot", () => {
    const normalBot = new PlayerInfo("bot", PlayerType.Bot, null, "bot");
    const neander = neanderthalInfo();
    const botStart = config.startManpower(normalBot);
    const neanderStart = config.startManpower(neander);
    expect(neanderStart).toBeGreaterThan(botStart);
    expect(neanderStart).toBe(
      Math.round(botStart * config.neanderthalStartTroopMult()),
    );
  });
});

describe("Neanderthal — no money, no advance (extinction root cause)", () => {
  let game: Game;
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: false });
  });

  test("addGold is a no-op for Neanderthals (never any money)", () => {
    const player = game.addPlayer(neanderthalInfo());
    const before = player.gold();
    player.addGold(1_000_000n);
    expect(player.gold()).toBe(before); // gold never increases
    expect(player.gold()).toBe(0n); // and they start with none
  });

  test("a normal bot CAN bank gold (contrast — proves the gate is targeted)", () => {
    const bot = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot2"),
    );
    bot.addGold(1000n);
    expect(bot.gold()).toBe(1000n);
  });

  test("Neanderthals can never meet advance criteria / advance age", () => {
    const player = game.addPlayer(neanderthalInfo());
    expect(player.isNeanderthal()).toBe(true);
    expect(player.meetsAdvanceCriteria()).toBe(false);
    expect(player.canAdvanceAge()).toBe(false);
    expect(player.advanceAge()).toBe(false);
  });

  test("the Neanderthal flag propagates PlayerInfo → Player", () => {
    const player = game.addPlayer(neanderthalInfo());
    expect(player.isNeanderthal()).toBe(true);
    expect(player.isAnimalPack()).toBe(false); // mutually exclusive
  });
});

describe("Neanderthal — spawner classification", () => {
  let game: Game;
  beforeEach(async () => {
    game = await setup("plains");
  });

  test("produces Neanderthals + packs, never both, deterministic per gameID", () => {
    const gameID = "neander-determinism-test";
    const spawn = (gid: string) =>
      new TribeSpawner(game, gid)
        .spawnTribes(300)
        // playerInfo is private on SpawnExecution; tests may read it.
        .map((e) => (e as unknown as { playerInfo: PlayerInfo }).playerInfo);

    const infos = spawn(gameID);
    const neanderthals = infos.filter((i) => i.isNeanderthal);
    const packs = infos.filter((i) => i.isAnimalPack);

    // Both categories are actually produced at the configured ratios.
    expect(neanderthals.length).toBeGreaterThan(0);
    expect(packs.length).toBeGreaterThan(0);
    // Mutually exclusive: no info is both Neanderthal and pack.
    expect(infos.some((i) => i.isNeanderthal && i.isAnimalPack)).toBe(false);
    // Neanderthals get an unmistakable name.
    expect(neanderthals[0].name).toContain("Neanderthals");

    // Deterministic: same gameID ⇒ identical classification sequence.
    const again = spawn(gameID);
    expect(again.map((i) => i.isNeanderthal)).toEqual(
      infos.map((i) => i.isNeanderthal),
    );
    expect(again.map((i) => i.isAnimalPack)).toEqual(
      infos.map((i) => i.isAnimalPack),
    );
  });
});

describe("Neanderthal — lifecycle integration (real per-tick boom→bust)", () => {
  test("booms early (meat + troop gain), busts after extinction tick", async () => {
    const game = await setup("plains");
    const player = game.addPlayer(neanderthalInfo()); // starts at 30k troops
    const cfg = game.config();

    // Drive the REAL per-tick lifecycle code (mammoth hunt + regen + attrition)
    // at controlled ticks. processNeanderthalLifecycle is private; tests may
    // call it. baseRegen is the generic bot regen the method scales around.
    const exec = new PlayerExecution(player);
    exec.init(game, 0);
    const run = (
      exec as unknown as {
        processNeanderthalLifecycle: (ticks: number, baseRegen: number) => void;
      }
    ).processNeanderthalLifecycle.bind(exec);

    // EARLY (tick 0): mammoths abundant ⇒ meat windfall + regen boom.
    const meatBefore = player.meat();
    const troopsBefore = player.troops();
    run(0, 200);
    expect(player.meat()).toBeGreaterThan(meatBefore); // hunted mammoth meat
    expect(player.troops()).toBeGreaterThan(troopsBefore); // boom: extra regen

    // LATE (past extinction tick): no mammoths + full climate attrition ⇒ the
    // tribe is bleeding population every tick (net loss), driving extinction.
    const beforeBust = player.troops();
    run(cfg.climateMeltTicks() + 1, 200);
    expect(player.troops()).toBeLessThan(beforeBust);
  });
});
