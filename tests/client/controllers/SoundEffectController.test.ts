import { beforeEach, describe, expect, it } from "vitest";

import { SoundEffectController } from "../../../src/client/controllers/SoundEffectController";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";

type UnitOpts = {
  id?: number;
  type: UnitType;
  isActive?: boolean;
  reachedTarget?: boolean;
  createdAt?: number;
  owner?: unknown;
};

function fakeUnit(o: UnitOpts) {
  return {
    id: () => o.id ?? 1,
    type: () => o.type,
    isActive: () => o.isActive ?? false,
    reachedTarget: () => o.reachedTarget ?? false,
    createdAt: () => o.createdAt ?? -1,
    owner: () => o.owner,
  };
}

function fakePlayer(over: Partial<{ id: number; age: number }> = {}) {
  return {
    id: () => over.id ?? 1,
    age: () => over.age ?? 0,
    wood: () => 0,
    rocks: () => 0,
    meat: () => 0,
    fish: () => 0,
    slaves: () => 0,
  };
}

function makeHarness(opts: {
  player?: unknown;
  units?: ReturnType<typeof fakeUnit>[];
  ticks?: number;
}) {
  const eventBus = new EventBus();
  const sounds: string[] = [];
  eventBus.on(PlaySoundEffectEvent, (e) => sounds.push(e.effect));
  const units = opts.units ?? [];
  const game = {
    myPlayer: () => opts.player ?? null,
    ticks: () => opts.ticks ?? 5,
    unit: (id: number) => units.find((u) => u.id() === id),
    updatesSinceLastTick: () => ({
      [GameUpdateType.Unit]: units.map((u) => ({ id: u.id() })),
      [GameUpdateType.ConquestEvent]: [],
    }),
  };
  const controller = new SoundEffectController(game as any, eventBus);
  return { controller, sounds };
}

describe("SoundEffectController game-feel cues", () => {
  let player: ReturnType<typeof fakePlayer>;

  beforeEach(() => {
    player = fakePlayer();
  });

  it("plays era-advance (not the chat message ping) when the local player advances an age", () => {
    let age = 0;
    const agingPlayer = { ...fakePlayer(), age: () => age };
    const { controller, sounds } = makeHarness({ player: agingPlayer, ticks: 5 });
    controller.tick(); // primes lastLocalAge = 0
    age = 1;
    controller.tick(); // age increased → era cue
    expect(sounds).toContain("era-advance");
    expect(sounds).not.toContain("message");
  });

  it("plays silo-built when the local player's missile silo is constructed", () => {
    const unit = fakeUnit({
      id: 2,
      type: UnitType.MissileSilo,
      isActive: true,
      createdAt: 5,
      owner: player,
    });
    const { controller, sounds } = makeHarness({ player, units: [unit], ticks: 5 });
    controller.tick();
    expect(sounds).toContain("silo-built");
  });

  it("does not play silo-built for another player's missile silo", () => {
    const enemy = fakePlayer({ id: 2 });
    const unit = fakeUnit({
      id: 3,
      type: UnitType.MissileSilo,
      isActive: true,
      createdAt: 5,
      owner: enemy,
    });
    const { controller, sounds } = makeHarness({ player, units: [unit], ticks: 5 });
    controller.tick();
    expect(sounds).not.toContain("silo-built");
  });

  it("plays warship-lost exactly once when the local player's warship dies", () => {
    const unit = fakeUnit({
      id: 4,
      type: UnitType.Warship,
      isActive: false,
      owner: player,
    });
    const { controller, sounds } = makeHarness({ player, units: [unit], ticks: 5 });
    controller.tick();
    controller.tick(); // the dead unit lingers — the cue must not replay
    expect(sounds.filter((s) => s === "warship-lost")).toHaveLength(1);
  });

  it("does not play warship-lost for an enemy warship", () => {
    const enemy = fakePlayer({ id: 9 });
    const unit = fakeUnit({
      id: 5,
      type: UnitType.Warship,
      isActive: false,
      owner: enemy,
    });
    const { controller, sounds } = makeHarness({ player, units: [unit], ticks: 5 });
    controller.tick();
    expect(sounds).not.toContain("warship-lost");
  });

  it("plays sam-hit when a nuke is intercepted (inactive, target not reached)", () => {
    const unit = fakeUnit({
      id: 6,
      type: UnitType.AtomBomb,
      isActive: false,
      reachedTarget: false,
    });
    const { controller, sounds } = makeHarness({ player, units: [unit], ticks: 5 });
    controller.tick();
    expect(sounds).toContain("sam-hit");
    expect(sounds).not.toContain("atom-hit");
  });

  it("plays the detonation cue (not sam-hit) when a nuke reaches its target", () => {
    const unit = fakeUnit({
      id: 7,
      type: UnitType.HydrogenBomb,
      isActive: false,
      reachedTarget: true,
    });
    const { controller, sounds } = makeHarness({ player, units: [unit], ticks: 5 });
    controller.tick();
    expect(sounds).toContain("hydrogen-hit");
    expect(sounds).not.toContain("sam-hit");
  });
});
