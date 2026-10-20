import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_PING_COOLDOWN_MS,
  CameraDirectorController,
} from "../../../src/client/controllers/CameraDirectorController";
import { EventBus } from "../../../src/core/EventBus";
import { MessageType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { GoToPositionEvent } from "../../../src/client/TransformHandler";

/** Fake tile: game.x()/game.y() below just read these back. */
type Tile = { x: number; y: number };

interface Attack {
  id: string;
  attackerID: number;
  targetID: number;
  troops: number;
  retreating: boolean;
}

interface HarnessCfg {
  incomingAttacks?: Attack[];
  outgoingAttacks?: Attack[];
  updates?: Record<number, unknown[]>;
  units?: Record<number, Tile>;
  /** smallID → attacker player centroid. */
  players?: Record<number, { x: number; y: number; size?: number }>;
  alive?: boolean;
  spawn?: boolean;
  myLoc?: { x: number; y: number; size?: number };
  /** Monotonic clock the controller reads via its now() seam. */
  clock?: { t: number };
}

/**
 * Subclass to make the clock deterministic (the real controller reads
 * performance.now()); everything else is the production controller.
 */
class TestDirector extends CameraDirectorController {
  constructor(
    eventBus: any,
    game: any,
    transformHandler: any,
    private readonly clock: { t: number },
  ) {
    super(eventBus, game, transformHandler);
  }
  protected now(): number {
    return this.clock.t;
  }
}

function makeHarness(cfg: HarnessCfg) {
  const clock = cfg.clock ?? { t: 0 };
  const me = {
    smallID: () => 1,
    isAlive: () => cfg.alive ?? true,
    nameLocation: () => cfg.myLoc ?? { x: 100, y: 100, size: 10 },
    incomingAttacks: () => cfg.incomingAttacks ?? [],
    outgoingAttacks: () => cfg.outgoingAttacks ?? [],
  };
  const game = {
    myPlayer: () => me,
    isAlive: () => true,
    inSpawnPhase: () => cfg.spawn ?? false,
    ticks: () => 10,
    updatesSinceLastTick: () => cfg.updates ?? {},
    unit: (id: number) => {
      const t = cfg.units?.[id];
      return t === undefined ? undefined : { lastTile: () => t };
    },
    x: (t: Tile) => t.x,
    y: (t: Tile) => t.y,
    playerBySmallID: (id: number) => {
      const p = cfg.players?.[id];
      if (p === undefined) return { isPlayer: () => false };
      return {
        isPlayer: () => true,
        nameLocation: () => ({ x: p.x, y: p.y, size: p.size ?? 8 }),
      };
    },
  };

  const eventBus = new EventBus();
  const gotos: GoToPositionEvent[] = [];
  eventBus.on(GoToPositionEvent, (e) => gotos.push(e));

  const transformHandler = {
    setFollow: vi.fn(),
    isFollowing: vi.fn(() => true),
  };

  const controller = new TestDirector(eventBus, game, transformHandler, clock);
  return { controller, gotos, transformHandler, cfg, clock };
}

function raid(over: Partial<Attack> = {}): Attack {
  return {
    id: over.id ?? "a1",
    attackerID: over.attackerID ?? 2,
    targetID: over.targetID ?? 1,
    troops: over.troops ?? 5000,
    retreating: over.retreating ?? false,
  };
}

const disposeAll: CameraDirectorController[] = [];
afterEach(() => {
  for (const c of disposeAll.splice(0)) c.dispose();
});
function track<T extends CameraDirectorController>(c: T): T {
  disposeAll.push(c);
  return c;
}

describe("CameraDirectorController", () => {
  it("flies to an incoming attack and drops follow before the ping", () => {
    const { controller, gotos, transformHandler } = makeHarness({
      incomingAttacks: [raid()],
      players: { 2: { x: 140, y: 140 } },
    });
    track(controller);

    const setFollowCalls: boolean[] = [];
    transformHandler.setFollow.mockImplementation((v: boolean) =>
      setFollowCalls.push(v),
    );

    controller.tick();

    // setFollow(false) was called, and it happened BEFORE any GoTo emit.
    expect(transformHandler.setFollow).toHaveBeenCalledWith(false);
    expect(setFollowCalls[0]).toBe(false);
    expect(gotos).toHaveLength(1);
    // Ping target = midpoint of tribe (100,100) and attacker (140,140).
    expect(gotos[0]).toMatchObject({ x: 120, y: 120 });
  });

  it("suppresses a second (new) drama inside the cooldown window", () => {
    const clock = { t: 0 };
    const h = makeHarness({
      incomingAttacks: [raid({ id: "a1" })],
      players: { 2: { x: 140, y: 140 } },
      clock,
    });
    track(h.controller);

    h.controller.tick(); // first raid → pings
    expect(h.gotos).toHaveLength(1);

    // A brand-new raid (different id) arrives well within the cooldown.
    clock.t += AUTO_PING_COOLDOWN_MS - 1;
    h.cfg.incomingAttacks = [raid({ id: "a2", attackerID: 2 })];
    h.controller.tick();

    expect(h.gotos).toHaveLength(1); // still just the first ping

    // Once the cooldown elapses, the next new raid is allowed through.
    clock.t += 2;
    h.cfg.incomingAttacks = [raid({ id: "a3", attackerID: 2 })];
    h.controller.tick();
    expect(h.gotos).toHaveLength(2);
  });

  it("does not ping the same sustained raid twice", () => {
    const clock = { t: 0 };
    const h = makeHarness({
      incomingAttacks: [raid({ id: "a1" })],
      players: { 2: { x: 140, y: 140 } },
      clock,
    });
    track(h.controller);

    h.controller.tick();
    clock.t += AUTO_PING_COOLDOWN_MS * 5; // long past cooldown
    h.controller.tick(); // same attack id still incoming
    expect(h.gotos).toHaveLength(1);
  });

  it("setEnabled(false) suppresses all pings", () => {
    const { controller, gotos, transformHandler } = makeHarness({
      incomingAttacks: [raid()],
      players: { 2: { x: 140, y: 140 } },
    });
    track(controller);

    controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(false);

    controller.tick();
    expect(gotos).toHaveLength(0);
    expect(transformHandler.setFollow).not.toHaveBeenCalled();
  });

  it("does NOT ping on the player's own orders (outgoing attack / attack request)", () => {
    const { controller, gotos, transformHandler } = makeHarness({
      incomingAttacks: [],
      outgoingAttacks: [raid({ id: "mine", attackerID: 1, targetID: 2 })],
      // ATTACK_REQUEST is the player's own order — not in the drama allowlist.
      updates: {
        [GameUpdateType.DisplayEvent]: [
          { playerID: 1, messageType: MessageType.ATTACK_REQUEST },
        ],
      },
      players: { 2: { x: 140, y: 140 } },
    });
    track(controller);

    controller.tick();
    expect(gotos).toHaveLength(0);
    expect(transformHandler.setFollow).not.toHaveBeenCalledWith(false);
  });

  it("flies to an inbound nuke (UnitIncoming) aimed at the local player", () => {
    const { controller, gotos } = makeHarness({
      updates: {
        [GameUpdateType.UnitIncoming]: [
          {
            playerID: 1,
            unitID: 7,
            messageType: MessageType.HYDROGEN_BOMB_INBOUND,
          },
        ],
      },
      units: { 7: { x: 105, y: 96 } },
    });
    track(controller);

    controller.tick();
    expect(gotos).toHaveLength(1);
    expect(gotos[0]).toMatchObject({ x: 105, y: 96 });
  });

  it("ignores drama addressed to a DIFFERENT player", () => {
    const { controller, gotos } = makeHarness({
      updates: {
        [GameUpdateType.UnitIncoming]: [
          { playerID: 99, unitID: 7, messageType: MessageType.NUKE_INBOUND },
        ],
      },
      units: { 7: { x: 105, y: 96 } },
    });
    track(controller);

    controller.tick();
    expect(gotos).toHaveLength(0);
  });

  it("does not ping during the spawn phase", () => {
    const { controller, gotos } = makeHarness({
      spawn: true,
      incomingAttacks: [raid()],
      players: { 2: { x: 140, y: 140 } },
    });
    track(controller);

    controller.tick();
    expect(gotos).toHaveLength(0);
  });

  it("suppresses a far, low-salience raid below threshold", () => {
    // Attacker very far away → proximity weight hits the floor; a small raid's
    // importance × floor stays under SALIENCE_THRESHOLD.
    const { controller, gotos } = makeHarness({
      incomingAttacks: [raid({ troops: 1 })],
      players: { 2: { x: 100000, y: 100000 } },
    });
    track(controller);

    controller.tick();
    expect(gotos).toHaveLength(0);
  });
});
