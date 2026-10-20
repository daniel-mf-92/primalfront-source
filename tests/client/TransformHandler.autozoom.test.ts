import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOZOOM_SCALE_MAX,
  AUTOZOOM_SCALE_MIN,
  AUTOZOOM_SPREAD_ANCHOR,
  PRIMITIVE_TRIBE_CAMERA_ZOOM,
  TransformHandler,
} from "../../src/client/TransformHandler";
import { EventBus } from "../../src/core/EventBus";
import { Age } from "../../src/core/game/Game";
import { GameView } from "../../src/client/view/GameView";
import { PlayerView } from "../../src/client/view/PlayerView";
import {
  makeGameView,
  makeNameViewData,
  makePlayerView,
} from "../util/viewStubs";

function makeInputElement(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 600,
      }) as DOMRect,
  });
  return el;
}

/**
 * Build a handler whose local player is a Primitive tribe whose name box has
 * the given `size` (the spread proxy — font size ∝ territory extent).
 */
function makeAutoZoomHandler(size: number): {
  handler: TransformHandler;
  game: GameView;
  player: PlayerView;
} {
  const game = makeGameView({ width: 100, height: 80 });
  const player = makePlayerView({
    game,
    data: { spawnTile: game.ref(23, 17), age: Age.Primitive },
    nameData: makeNameViewData({ x: 44, y: 31, size }),
  });
  (game as any)._myPlayer = player;
  const handler = new TransformHandler(game, new EventBus(), makeInputElement());
  // Stop the constructor's persistent follow interval so the tests can query
  // computeFollowTarget() deterministically.
  handler.destroy();
  return { handler, game, player };
}

/** The adaptive scale computeFollowTarget() would hold for the current state. */
function scaleFor(handler: TransformHandler): number {
  const goal = (handler as any).computeFollowTarget();
  expect(goal).not.toBeNull();
  return goal.scale as number;
}

describe("TransformHandler auto-zoom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds the anchor zoom for a normal, still tribe", () => {
    // spread == anchor, zero velocity ⇒ exactly the flat primitive zoom.
    const { handler } = makeAutoZoomHandler(AUTOZOOM_SPREAD_ANCHOR);
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);
    expect(scaleFor(handler)).toBeCloseTo(PRIMITIVE_TRIBE_CAMERA_ZOOM, 6);
  });

  it("zooms IN (higher scale) for a small/tight tribe", () => {
    const { handler } = makeAutoZoomHandler(3);
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);
    const scale = scaleFor(handler);
    // Tight tribe pushes past the anchor toward the intimate max.
    expect(scale).toBeGreaterThan(PRIMITIVE_TRIBE_CAMERA_ZOOM);
    expect(scale).toBeCloseTo(AUTOZOOM_SCALE_MAX, 6);
  });

  it("zooms OUT (lower scale) for a spread-out tribe", () => {
    const { handler } = makeAutoZoomHandler(45);
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);
    const scale = scaleFor(handler);
    expect(scale).toBeLessThan(PRIMITIVE_TRIBE_CAMERA_ZOOM);
    expect(scale).toBeCloseTo(AUTOZOOM_SCALE_MIN, 6);
  });

  it("scale decreases monotonically as the spread signal grows, staying in band", () => {
    const spreads = [1, 3, 6, 9, 12, 18, 25, 35, 45, 80, 200];
    let prev = Infinity;
    let sawStrictDecrease = false;
    for (const s of spreads) {
      const { handler } = makeAutoZoomHandler(s);
      vi.spyOn(window.performance, "now").mockImplementation(() => 100000);
      const scale = scaleFor(handler);
      // Monotone non-increasing in spread.
      expect(scale).toBeLessThanOrEqual(prev + 1e-9);
      if (scale < prev - 1e-9) sawStrictDecrease = true;
      // Always clamped inside the primitive band.
      expect(scale).toBeGreaterThanOrEqual(AUTOZOOM_SCALE_MIN - 1e-9);
      expect(scale).toBeLessThanOrEqual(AUTOZOOM_SCALE_MAX + 1e-9);
      prev = scale;
      vi.restoreAllMocks();
    }
    // The signal actually moves the zoom (not a flat constant).
    expect(sawStrictDecrease).toBe(true);
  });

  it("folds in centroid speed: a fast-migrating tribe zooms out vs a still one", () => {
    // Same spread; the only difference is sampled follow velocity.
    const { handler: still } = makeAutoZoomHandler(AUTOZOOM_SPREAD_ANCHOR);
    const { handler: fast } = makeAutoZoomHandler(AUTOZOOM_SPREAD_ANCHOR);
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);

    (fast as any).followVelX = 30;
    (fast as any).followVelY = 30;

    const stillScale = scaleFor(still);
    const fastScale = scaleFor(fast);
    expect(fastScale).toBeLessThan(stillScale);
    expect(fastScale).toBeGreaterThanOrEqual(AUTOZOOM_SCALE_MIN - 1e-9);
  });

  it("leaves zoom alone (null scale) outside the Primitive age", () => {
    const game = makeGameView({ width: 100, height: 80 });
    const player = makePlayerView({
      game,
      data: { spawnTile: game.ref(23, 17), age: Age.Modern },
      nameData: makeNameViewData({ x: 44, y: 31, size: 40 }),
    });
    (game as any)._myPlayer = player;
    const handler = new TransformHandler(
      game,
      new EventBus(),
      makeInputElement(),
    );
    handler.destroy();
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);

    const goal = (handler as any).computeFollowTarget();
    expect(goal).not.toBeNull();
    expect(goal.scale).toBeNull();
  });
});
