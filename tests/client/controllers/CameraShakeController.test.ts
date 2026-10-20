import { describe, expect, it } from "vitest";

import { CameraShakeController } from "../../../src/client/controllers/CameraShakeController";
import { ScreenShakeEvent } from "../../../src/client/render/ScreenShake";
import { SendRaidIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";

type UnitOpts = {
  id?: number;
  type: UnitType;
  isActive?: boolean;
  reachedTarget?: boolean;
};

function fakeUnit(o: UnitOpts) {
  return {
    id: () => o.id ?? 1,
    type: () => o.type,
    isActive: () => o.isActive ?? false,
    reachedTarget: () => o.reachedTarget ?? false,
  };
}

function makeHarness(units: ReturnType<typeof fakeUnit>[]) {
  const eventBus = new EventBus();
  const shakes: number[] = [];
  eventBus.on(ScreenShakeEvent, (e) => shakes.push(e.magnitude));
  const game = {
    ticks: () => 5,
    unit: (id: number) => units.find((u) => u.id() === id),
    myPlayer: () => null,
    updatesSinceLastTick: () => ({
      [GameUpdateType.Unit]: units.map((u) => ({ id: u.id() })),
    }),
  };
  const controller = new CameraShakeController(game as any, eventBus);
  return { controller, shakes };
}

type IncomingAttack = { id: string; troops: number };
type Conquest = { conquerorId: string; conqueredId: string };

// A harness for the primitive-era combat path: a mutable local player + a
// controllable tick clock so cooldown/aggregation behaviour is observable.
function makeCombatHarness() {
  const eventBus = new EventBus();
  const shakes: number[] = [];
  eventBus.on(ScreenShakeEvent, (e) => shakes.push(e.magnitude));
  const state = {
    tick: 0,
    incomingAttacks: [] as IncomingAttack[],
    tilesOwned: 100,
    conquests: [] as Conquest[],
  };
  const myPlayer = {
    id: () => "ME",
    incomingAttacks: () => state.incomingAttacks,
    numTilesOwned: () => state.tilesOwned,
  };
  const game = {
    ticks: () => state.tick,
    unit: () => undefined,
    myPlayer: () => myPlayer,
    updatesSinceLastTick: () => ({
      [GameUpdateType.Unit]: [],
      [GameUpdateType.ConquestEvent]: state.conquests,
    }),
  };
  const controller = new CameraShakeController(game as any, eventBus);
  // Consume the baseline tick so tilesOwned is seeded (no phantom tile-loss
  // jolt on first observation) and clear any incidental shakes.
  controller.tick();
  shakes.length = 0;
  return { controller, shakes, state, eventBus };
}

describe("CameraShakeController", () => {
  it("shakes once when an atom bomb detonates", () => {
    const unit = fakeUnit({
      type: UnitType.AtomBomb,
      isActive: false,
      reachedTarget: true,
    });
    const { controller, shakes } = makeHarness([unit]);
    controller.tick();
    expect(shakes).toEqual([0.55]);
  });

  it("shakes the hardest for a hydrogen bomb", () => {
    const hbomb = fakeUnit({
      id: 1,
      type: UnitType.HydrogenBomb,
      isActive: false,
      reachedTarget: true,
    });
    const atom = fakeUnit({
      id: 2,
      type: UnitType.AtomBomb,
      isActive: false,
      reachedTarget: true,
    });
    const { controller, shakes } = makeHarness([hbomb, atom]);
    controller.tick();
    expect(Math.max(...shakes)).toBe(1);
    expect(shakes).toContain(0.55);
  });

  it("does not shake for an intercepted nuke (inactive, target not reached)", () => {
    const unit = fakeUnit({
      type: UnitType.AtomBomb,
      isActive: false,
      reachedTarget: false,
    });
    const { controller, shakes } = makeHarness([unit]);
    controller.tick();
    expect(shakes).toHaveLength(0);
  });

  it("does not shake while a nuke is still in flight (active)", () => {
    const unit = fakeUnit({
      type: UnitType.HydrogenBomb,
      isActive: true,
      reachedTarget: false,
    });
    const { controller, shakes } = makeHarness([unit]);
    controller.tick();
    expect(shakes).toHaveLength(0);
  });

  it("does not shake for non-nuke units", () => {
    const unit = fakeUnit({
      type: UnitType.Warship,
      isActive: false,
      reachedTarget: true,
    });
    const { controller, shakes } = makeHarness([unit]);
    controller.tick();
    expect(shakes).toHaveLength(0);
  });

  it("shakes only once for a detonated nuke that lingers across ticks", () => {
    const unit = fakeUnit({
      type: UnitType.MIRVWarhead,
      isActive: false,
      reachedTarget: true,
    });
    const { controller, shakes } = makeHarness([unit]);
    controller.tick();
    controller.tick();
    expect(shakes).toEqual([0.7]);
  });
});

describe("CameraShakeController — primitive-era combat", () => {
  it("jolts with a bounded, troop-scaled magnitude when a new attack lands on the local player", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.incomingAttacks = [{ id: "a1", troops: 200 }];
    controller.tick();
    // base 0.12 + 200 * 0.0004 = 0.20, under the 0.4 cap.
    expect(shakes).toHaveLength(1);
    expect(shakes[0]).toBeCloseTo(0.2, 5);
    expect(shakes[0]).toBeGreaterThan(0);
    expect(shakes[0]).toBeLessThanOrEqual(0.4);
  });

  it("caps the attack jolt so a huge army can never nauseate", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.incomingAttacks = [{ id: "a1", troops: 100000 }];
    controller.tick();
    expect(shakes).toEqual([0.4]);
  });

  it("only jolts once for the same ongoing attack across ticks", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.incomingAttacks = [{ id: "a1", troops: 200 }];
    state.tick = 1;
    controller.tick();
    // Same attack still present many ticks later — must not re-shake.
    state.tick = 20;
    controller.tick();
    expect(shakes).toHaveLength(1);
  });

  it("aggregates a burst of simultaneous attacks into ONE max-sized jolt", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.incomingAttacks = [
      { id: "a1", troops: 100 },
      { id: "a2", troops: 100000 }, // the biggest threat sizes the jolt
      { id: "a3", troops: 50 },
    ];
    controller.tick();
    expect(shakes).toEqual([0.4]);
  });

  it("suppresses a per-tick attack barrage via the cooldown (no seizure)", () => {
    const { controller, shakes, state } = makeCombatHarness();
    // A brand-new attack every single tick for 5 consecutive ticks.
    for (let t = 1; t <= 5; t++) {
      state.tick = t;
      state.incomingAttacks = [
        ...state.incomingAttacks,
        { id: `a${t}`, troops: 150 },
      ];
      controller.tick();
    }
    // 5 attack-ticks, but the 4-tick cooldown collapses them to far fewer jolts.
    expect(shakes.length).toBeLessThanOrEqual(2);
    expect(shakes.length).toBeGreaterThanOrEqual(1);
    for (const m of shakes) expect(m).toBeLessThanOrEqual(0.4);
  });

  it("collapses a 40-tile loss in one tick into a single bounded jolt", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.tilesOwned = 60; // lost 40 tiles this tick
    controller.tick();
    // 40 * 0.012 = 0.48, clamped to the 0.35 cap.
    expect(shakes).toEqual([0.35]);
  });

  it("folds a sustained tile bleed across ticks into a single jolt (cooldown)", () => {
    const { controller, shakes, state } = makeCombatHarness();
    // Lose 5 tiles every tick for 5 consecutive ticks (6-tick cooldown).
    for (let t = 1; t <= 5; t++) {
      state.tick = t;
      state.tilesOwned -= 5;
      controller.tick();
    }
    // The bleed folds into a single jolt inside the cooldown window.
    expect(shakes).toHaveLength(1);
    expect(shakes[0]).toBeGreaterThan(0);
    expect(shakes[0]).toBeLessThanOrEqual(0.35);
  });

  it("delivers the heaviest combat jolt when the local player is conquered", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.conquests = [{ conquerorId: "ENEMY", conqueredId: "ME" }];
    controller.tick();
    expect(shakes).toEqual([0.85]);
  });

  it("delivers a triumphant jolt when the local player conquers someone", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.conquests = [{ conquerorId: "ME", conqueredId: "VICTIM" }];
    controller.tick();
    expect(shakes).toEqual([0.45]);
  });

  it("ignores conquests that do not involve the local player", () => {
    const { controller, shakes, state } = makeCombatHarness();
    state.tick = 1;
    state.conquests = [{ conquerorId: "A", conqueredId: "B" }];
    controller.tick();
    expect(shakes).toHaveLength(0);
  });

  it("jolts when the local player launches a raid (SendRaidIntentEvent)", () => {
    const { controller, shakes, eventBus, state } = makeCombatHarness();
    eventBus.emit(new SendRaidIntentEvent("TARGET"));
    state.tick = 1;
    controller.tick();
    expect(shakes).toEqual([0.18]);
  });

  it("collapses a rapid raid-button mash into a single jolt", () => {
    const { controller, shakes, eventBus, state } = makeCombatHarness();
    eventBus.emit(new SendRaidIntentEvent("T1"));
    eventBus.emit(new SendRaidIntentEvent("T2"));
    eventBus.emit(new SendRaidIntentEvent("T3"));
    state.tick = 1;
    controller.tick();
    expect(shakes).toEqual([0.18]);
  });
});
