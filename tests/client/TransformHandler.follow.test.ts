import { afterEach, describe, expect, it, vi } from "vitest";
import { DragEvent } from "../../src/client/InputHandler";
import {
  FOLLOW_MAX_LOOK_AHEAD_TILES,
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

/** Build a handler whose local player is a Primitive tribe at `name`. */
function makeFollowHandler(name: { x: number; y: number; size?: number }): {
  handler: TransformHandler;
  game: GameView;
  player: PlayerView;
} {
  const game = makeGameView({ width: 100, height: 80 });
  const player = makePlayerView({
    game,
    data: { spawnTile: game.ref(23, 17), age: Age.Primitive },
    nameData: makeNameViewData({ x: name.x, y: name.y, size: name.size ?? 12 }),
  });
  // GameView.myPlayer() returns the memoized _myPlayer field directly.
  (game as any)._myPlayer = player;
  const handler = new TransformHandler(game, new EventBus(), makeInputElement());
  // Stop the constructor's persistent follow interval so tests can drive
  // followTick()/goTo() deterministically (also nulls target via clearTarget()).
  handler.destroy();
  return { handler, game, player };
}

/** Recenter the view so screenCenter() sits exactly on (x, y). */
function centerViewOn(handler: TransformHandler, x: number, y: number) {
  const c0 = handler.screenCenter();
  (handler as any).offsetX += x - c0.screenX;
  (handler as any).offsetY += y - c0.screenY;
}

describe("TransformHandler follow-cam", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults follow ON for a Primitive tribe and honors the toggle", () => {
    const { handler } = makeFollowHandler({ x: 44, y: 31 });

    expect(handler.isFollowing()).toBe(true);

    handler.setFollow(false);
    expect(handler.isFollowing()).toBe(false);

    handler.setFollow(true);
    expect(handler.isFollowing()).toBe(true);
  });

  it("eases the camera toward the tribe centroid over ticks", () => {
    const { handler } = makeFollowHandler({ x: 44, y: 31 });
    // Freeze the primitive zoom so easing is pure position (no scale coupling).
    (handler as any).scale = PRIMITIVE_TRIBE_CAMERA_ZOOM;

    // Steady 16ms/tick clock for goTo's finite-difference dt.
    let t = 200000;
    vi.spyOn(window.performance, "now").mockImplementation(() => {
      t += 16;
      return t;
    });

    // Start the view 50 tiles left of the centroid.
    centerViewOn(handler, 44 - 50, 31);
    const startDx = Math.abs(handler.screenCenter().screenX - 44);
    expect(startDx).toBe(50);

    // Follow retargets onto the centroid...
    (handler as any).followTick();
    expect((handler as any).target).toMatchObject({ x: 44, y: 31 });

    // ...stop the auto goTo interval but keep the target, then step easing.
    const iv = (handler as any).intervalID;
    if (iv !== null) clearInterval(iv);
    (handler as any).intervalID = null;

    for (let i = 0; i < 300 && (handler as any).target !== null; i++) {
      (handler as any).goTo();
    }

    const endDx = Math.abs(handler.screenCenter().screenX - 44);
    expect(endDx).toBeLessThan(startDx);
    expect(endDx).toBeLessThanOrEqual(2); // goTo self-clears within 2 tiles
  });

  it("does NOT retarget for a sub-deadzone centroid nudge", () => {
    const { handler, player } = makeFollowHandler({ x: 44, y: 31 });
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);
    // Hold the primitive zoom so the scale gate doesn't force a retarget.
    (handler as any).scale = PRIMITIVE_TRIBE_CAMERA_ZOOM;
    centerViewOn(handler, 44, 31);

    // Centroid essentially where the view already is → inside the deadzone.
    (handler as any).followTick();
    expect((handler as any).target).toBeNull();

    // A 1-tile nudge stays inside the deadzone → still no retarget.
    player.nameData = makeNameViewData({ x: 45, y: 31, size: 12 });
    (handler as any).followTick();
    expect((handler as any).target).toBeNull();
  });

  it("retargets once the centroid leaves the deadzone", () => {
    const { handler, player } = makeFollowHandler({ x: 44, y: 31 });
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);
    (handler as any).scale = PRIMITIVE_TRIBE_CAMERA_ZOOM;
    centerViewOn(handler, 44, 31);

    (handler as any).followTick();
    expect((handler as any).target).toBeNull();

    // Jump the tribe far to the right → leaves the deadzone → retarget.
    player.nameData = makeNameViewData({ x: 74, y: 31, size: 12 });
    (handler as any).followTick();

    const target = (handler as any).target;
    expect(target).not.toBeNull();
    expect(target.y).toBe(31);
    // Frozen clock ⇒ zero sampled velocity ⇒ zero look-ahead ⇒ exact centroid.
    expect(target.x).toBe(74);
    expect(target.x).toBeLessThanOrEqual(74 + FOLLOW_MAX_LOOK_AHEAD_TILES);
    (handler as any).clearTarget();
  });

  it("suspends follow on manual drag and re-engages after the idle window", () => {
    const { handler } = makeFollowHandler({ x: 44, y: 31 });
    let mockNow = 100000;
    vi.spyOn(window.performance, "now").mockImplementation(() => mockNow);

    // Baseline: follow retargets (view starts far from the centroid).
    (handler as any).followTick();
    expect((handler as any).target).not.toBeNull();
    (handler as any).clearTarget();

    // Manual drag suspends follow.
    handler.onMove(new DragEvent(5, 5));
    (handler as any).followTick();
    expect((handler as any).target).toBeNull();

    // After the idle window elapses, follow re-engages on its own.
    mockNow = 100000 + 2500 + 1;
    (handler as any).followTick();
    expect((handler as any).target).not.toBeNull();
    (handler as any).clearTarget();
  });

  it("computeFollowTarget yields the centroid and primitive scale", () => {
    const { handler } = makeFollowHandler({ x: 44, y: 31 });
    vi.spyOn(window.performance, "now").mockImplementation(() => 100000);

    const goal = (handler as any).computeFollowTarget();
    expect(goal).not.toBeNull();
    expect(goal.cell).toMatchObject({ x: 44, y: 31 });
    expect(goal.scale).toBe(PRIMITIVE_TRIBE_CAMERA_ZOOM);
  });
});
